// =============================================================================
// useMetaOnboarding.ts — Orquestrador do Embedded Signup Meta WhatsApp
//
// Fluxo: company ativa → /start no mount → SDK carregado → ready
//        click → FB.login → correlação FINISH+code → /complete → onSuccess
//
// Restrições: nunca company_id no /complete; nunca reutilizar state após
// tentativa encerrada; origin somente https://www.facebook.com (exact match);
// nunca /start e FB.login no mesmo click.
// =============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { loadFacebookSdk }  from '../lib/facebookSdk'
import { metaWhatsAppApi }  from '../services/metaWhatsAppApi'
import { useCompany }       from './useCompany'
import type {
  CompleteResult,
  MetaWabaSelectionOption,
  OnboardingCompletePayload,
  OnboardingStartResponse,
  OnboardingStep,
} from '../types/meta-whatsapp'

// ── Constantes ────────────────────────────────────────────────────────────────

// Exact match — fonte: developers.facebook.com/docs/whatsapp/embedded-signup
const ACCEPTED_ORIGIN    = 'https://www.facebook.com' as const
const META_ID_RE         = /^[0-9]+$/     // idêntica a complete.js
const RENEW_THRESHOLD_MS = 60_000         // renovar sessão 60 s antes de expirar
const FINISH_GRACE_MS    = 5_000          // janela conservadora de espera pelo evento FINISH
const LATE_DIAG_MS       = 10_000         // janela do listener diagnóstico tardio (após F3)

// ── Tipos internos ────────────────────────────────────────────────────────────

interface WaFinishData { wabaId: string; phoneNumberId?: string }

type WaEventResult =
  | { kind: 'FINISH'; data: WaFinishData }
  | { kind: 'CANCEL' }
  | { kind: 'ERROR'  }
  | { kind: 'IGNORE' }

interface PendingComplete {
  code?:          string
  wabaId?:        string
  phoneNumberId?: string
}

// ── Interfaces públicas ───────────────────────────────────────────────────────

export interface UseMetaOnboardingOptions {
  /**
   * Se false, o hook permanece idle sem criar sessão.
   * Padrão: true (undefined → habilitado).
   * SOMENTE lifecycle/UX — nunca usar como autorização.
   */
  enabled?: boolean
  /** Chamado após /complete bem-sucedido. Tipicamente dispara refresh da lista. */
  onSuccess?: () => void
}

export interface UseMetaOnboardingResult {
  step:            OnboardingStep
  onboardingError: string | null
  /** Iniciar popup FB.login — chamar diretamente no onClick. No-op se step !== 'ready'. */
  triggerPopup:    () => void
  /** Cancelar fluxo e preparar nova sessão. */
  cancelFlow:      () => void
  isReady:         boolean    // alias: step === 'ready'
  /** Opções de WABA disponíveis para seleção. Não-null somente em awaiting_selection. */
  selectionOptions: MetaWabaSelectionOption[] | null
  /**
   * Selecionar um WABA/número durante awaiting_selection.
   * @param index - O option.index exato recebido do backend (não a posição no array).
   * No-op se step !== 'awaiting_selection' ou se já houver seleção em andamento.
   */
  selectWaba:       (index: number) => void
}

// ── Parser fail-closed ────────────────────────────────────────────────────────

function parseWaEmbeddedSignup(event: MessageEvent): WaEventResult {
  if (event.origin !== ACCEPTED_ORIGIN)                        return { kind: 'IGNORE' }

  // ── S7.6: Normalização de event.data (object | JSON string) ──────────────
  // Meta pode enviar event.data como object (v4+) ou como JSON string (v2/mobile).
  // A origin já foi validada — a normalização não relaxa nenhuma validação funcional.
  // Regras fail-closed:
  //   object não-array não-null → usar diretamente
  //   string → JSON.parse em try/catch
  //             resultado: precisa ser object, non-null, non-array → usar
  //             qualquer outro resultado → IGNORE
  //   qualquer outro tipo → IGNORE
  let raw: Record<string, unknown>
  if (typeof event.data === 'object' && event.data !== null && !Array.isArray(event.data)) {
    raw = event.data as Record<string, unknown>
  } else if (typeof event.data === 'string') {
    try {
      const _parsed: unknown = JSON.parse(event.data)
      if (typeof _parsed !== 'object' || _parsed === null || Array.isArray(_parsed)) {
        return { kind: 'IGNORE' }
      }
      raw = _parsed as Record<string, unknown>
    } catch {
      return { kind: 'IGNORE' }           // JSON sintaticamente inválido
    }
  } else {
    return { kind: 'IGNORE' }             // número, boolean, undefined, etc.
  }
  // ── fim S7.6 ──────────────────────────────────────────────────────────────

  if (raw['type'] !== 'WA_EMBEDDED_SIGNUP')                    return { kind: 'IGNORE' }

  const evt = raw['event']
  if (evt === 'CANCEL')                                        return { kind: 'CANCEL' }
  if (evt === 'ERROR')                                         return { kind: 'ERROR'  }
  if (evt !== 'FINISH')                                        return { kind: 'IGNORE' }

  const data   = raw['data'] as Record<string, unknown> | null | undefined
  const wabaId = data?.['waba_id']
  if (typeof wabaId !== 'string' || !META_ID_RE.test(wabaId)) return { kind: 'ERROR'  }

  const phoneId = data?.['phone_number_id']
  if (phoneId !== undefined) {
    if (typeof phoneId !== 'string' || !META_ID_RE.test(phoneId)) return { kind: 'ERROR' }
    return { kind: 'FINISH', data: { wabaId, phoneNumberId: phoneId } }
  }
  return { kind: 'FINISH', data: { wabaId } }
}

// ── mapSelectionError ─────────────────────────────────────────────────────────
// Mapeia códigos de erro de /resolve-waba para mensagens seguras ao usuário.
// Nenhuma informação técnica sensível deve aparecer na UI.

function mapSelectionError(code: string): string {
  switch (code) {
    case 'invalid_continuation':
      return 'Seleção expirada. Inicie a conexão novamente.'
    case 'phone_number_already_connected':
      return 'Este número já está conectado. Verifique a lista de instâncias.'
    case 'invalid_selection':
      return 'Seleção inválida. Tente iniciar a conexão novamente.'
    case 'forbidden':
      return 'Sem permissão para esta operação. Verifique suas configurações.'
    case 'internal_error':
      return 'Erro interno ao conectar número. Tente novamente mais tarde.'
    default:
      return 'Erro ao conectar número. Verifique sua conexão e tente novamente.'
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMetaOnboarding(
  options?: UseMetaOnboardingOptions,
): UseMetaOnboardingResult {
  const { company } = useCompany()
  const companyId   = company?.id ?? null

  const [step,            setStep]           = useState<OnboardingStep>('idle')
  const [onboardingError, setOnboardingError] = useState<string | null>(null)
  // selectionOptions: estado de renderização — atualizado junto com selectionOptionsRef
  const [selectionOptions, setSelectionOptions] = useState<MetaWabaSelectionOption[] | null>(null)

  // Refs — acessíveis em closures assíncronas sem causar re-render
  const stepRef           = useRef<OnboardingStep>('idle')   // mirror do step
  const flowGenRef        = useRef(0)                        // geração monotônica
  const sessionRef        = useRef<OnboardingStartResponse | null>(null)
  const pendingRef        = useRef<PendingComplete>({})      // correlação FINISH+code
  const isCompletingRef   = useRef(false)                    // lock anti-double-complete
  const listenerRef       = useRef<((e: MessageEvent) => void) | null>(null)
  const sessionExpiryRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const recoveryTimerRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onSuccessRef      = useRef(options?.onSuccess)
  // Refs S7 — seleção de WABA (múltiplos WABAs acessíveis)
  // continuation_token: somente memória — nunca storage, URL, logs ou Supabase
  const selectionTokenRef   = useRef<string | null>(null)
  const selectionOptionsRef = useRef<MetaWabaSelectionOption[] | null>(null)
  const isSelectingRef      = useRef(false)   // lock anti-double-select

  // Refs S7.5 — listener diagnóstico tardio (R4: FINISH após F3)
  // Separado do listener funcional — somente console.log, sem efeito no fluxo.
  //
  // Lifecycle per-instance via useRef:
  //   lateDiagActiveRef:   guarda booleana imediata (set false em removeLateDiagListener)
  //   lateDiagListenerRef: função registrada em window (para removeEventListener direto)
  //   lateDiagTimerRef:    ID do timer de auto-remoção (para clearTimeout)
  //
  // Não há mutable state module-level: cada instância gerencia seu próprio lifecycle.
  const lateDiagActiveRef   = useRef(false)
  const lateDiagListenerRef = useRef<((e: MessageEvent) => void) | null>(null)
  const lateDiagTimerRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /**
   * Ref estável de enabled — closures assíncronas consultam sem re-capturar.
   * Sincronizado durante o render (não via effect) para eliminar a janela
   * entre render e commit em que uma closure poderia observar valor antigo.
   */
  const enabledRef        = useRef(options?.enabled !== false)
  // Atribuição direta durante render — não é side effect externo
  enabledRef.current      = options?.enabled !== false

  useEffect(() => { onSuccessRef.current = options?.onSuccess }, [options?.onSuccess])

  // ── Helpers síncronos ────────────────────────────────────────────────────

  function setStepAndRef(s: OnboardingStep): void {
    stepRef.current = s
    setStep(s)
  }

  function removeMessageListener(): void {
    if (!listenerRef.current) return
    window.removeEventListener('message', listenerRef.current)
    listenerRef.current = null
  }

  function clearExpiryTimer(): void {
    clearTimeout(sessionExpiryRef.current)
    sessionExpiryRef.current = undefined
  }

  function clearRecoveryTimer(): void {
    clearTimeout(recoveryTimerRef.current)
    recoveryTimerRef.current = undefined
  }

  // ── Helpers de diagnóstico tardio (S7.5) ────────────────────────────────
  // Puramente observabilidade — nenhuma interação com fluxo funcional.

  // Remove o listener diagnóstico tardio ativo (se houver).
  // lateDiagActiveRef.current = false é a guarda imediata (per-instance).
  // removeEventListener remove o listener fisicamente da window.
  function removeLateDiagListener(): void {
    lateDiagActiveRef.current = false                     // guarda imediata per-instance
    if (lateDiagListenerRef.current) {
      window.removeEventListener('message', lateDiagListenerRef.current)
      lateDiagListenerRef.current = null
    }
    clearTimeout(lateDiagTimerRef.current)
    lateDiagTimerRef.current = undefined
  }

  // Instala um listener diagnóstico separado por LATE_DIAG_MS após F3 adquirir o lock.
  // Detecta FINISH tardio (R4) sem interferir no fluxo funcional.
  // Log seguro: somente origin, payloadType, type e event. Nunca data, IDs ou tokens.
  //
  // Lifecycle per-instance: removeLateDiagListener() seta lateDiagActiveRef.current = false
  // e remove o listener da window diretamente. Cada instância do hook gerencia seus
  // próprios refs — sem mutable state compartilhado entre instâncias.
  function installLateDiagListener(): void {
    removeLateDiagListener()                  // limpa listener anterior desta instância
    lateDiagActiveRef.current = true          // ativa guarda per-instance

    const diagListener = (event: MessageEvent): void => {
      // Guarda per-instance — desativada imediatamente por removeLateDiagListener()
      if (!lateDiagActiveRef.current) return

      // Extrair type/event do payload sem logar conteúdo de data.
      let _payloadType: 'object' | 'string' | null = null
      let _dt: unknown
      let _de: unknown

      if (typeof event.data === 'object' && event.data !== null) {
        _payloadType = 'object'
        _dt = (event.data as Record<string, unknown>)['type']
        _de = (event.data as Record<string, unknown>)['event']
      } else if (typeof event.data === 'string') {
        try {
          const _p = JSON.parse(event.data) as Record<string, unknown>
          if (typeof _p === 'object' && _p !== null) {
            _payloadType = 'string'
            _dt = _p['type']
            _de = _p['event']
          }
        } catch { /* JSON inválido — ignorar */ }
      }

      if (_payloadType === null) return   // payload não reconhecível — ignorar

      // Filtro: somente WA_EMBEDDED_SIGNUP ou origins Facebook
      const _originStr = String(event.origin)
      if (
        _dt !== 'WA_EMBEDDED_SIGNUP' &&
        !_originStr.includes('facebook') &&
        !_originStr.includes('fb.com')
      ) return

      // Log seguro — somente metadados do envelope, nunca conteúdo de data
      console.log('[meta-finish-diag-late]', {
        origin:      event.origin,
        payloadType: _payloadType,
        type:        _dt,
        event:       _de,
      })
    }

    lateDiagListenerRef.current = diagListener
    window.addEventListener('message', diagListener)

    // Auto-remoção após LATE_DIAG_MS — seta active=false e remove listener da window
    lateDiagTimerRef.current = setTimeout(() => {
      removeLateDiagListener()
    }, LATE_DIAG_MS)
  }

  // Helper centralizado para limpar todo o estado de seleção S7.
  // Manter selectionTokenRef e selectionOptionsRef sincronizados com state aqui.
  // Token mantido SOMENTE em memória — nunca persistir.
  function clearSelectionState(): void {
    selectionTokenRef.current   = null
    selectionOptionsRef.current = null
    isSelectingRef.current      = false
    setSelectionOptions(null)
  }

  // ── startNewSession ──────────────────────────────────────────────────────
  // Pré-cria sessão via /start e carrega SDK. Resultado descartado se gen obsoleto.
  // Nunca chamar durante popup_open ou completing.

  const startNewSession = useCallback(async (myGen: number): Promise<void> => {
    if (!companyId) return

    clearRecoveryTimer()    // defensivo — nova sessão descarta qualquer fallback pendente
    clearExpiryTimer()
    removeLateDiagListener()  // defensivo — nova sessão encerra janela diagnóstica tardia
    clearSelectionState()   // limpar seleção pendente antes de iniciar nova sessão
    sessionRef.current      = null
    pendingRef.current      = {}
    isCompletingRef.current = false
    setStepAndRef('loading_session')
    setOnboardingError(null)

    let session: OnboardingStartResponse
    try {
      session = await metaWhatsAppApi.startOnboarding(companyId)
    } catch (err: unknown) {
      if (myGen !== flowGenRef.current) return
      setStepAndRef('idle')
      setOnboardingError(err instanceof Error ? err.message : 'Erro ao preparar conexão Meta')
      return
    }
    if (myGen !== flowGenRef.current) return

    try {
      await loadFacebookSdk(session.app_id)   // idempotente — reutiliza Promise mesmo appId
    } catch (err: unknown) {
      if (myGen !== flowGenRef.current) return
      setStepAndRef('idle')
      setOnboardingError(err instanceof Error ? err.message : 'Erro ao carregar SDK Meta')
      return
    }
    if (myGen !== flowGenRef.current) return

    sessionRef.current = session

    const expiresMs = new Date(session.expires_at).getTime()

    // Fail-closed: expires_at inválido (NaN) → não habilitar popup, não criar timer
    // NaN <= 0 é false em JS → setTimeout(fn, NaN) dispara em ~1 ms → loop infinito
    // Botão NUNCA fica ready com sessão inválida.
    // Retry explícito via cancelFlow() — sem loop automático de /start.
    if (!Number.isFinite(expiresMs)) {
      sessionRef.current = null
      setOnboardingError('Erro ao preparar sessão de conexão')
      setStepAndRef('idle')
      return
    }

    const delay = expiresMs - Date.now() - RENEW_THRESHOLD_MS
    if (delay <= 0) {
      void startNewSession(myGen)   // sessão muito próxima do limite — renovar já
      return
    }
    sessionExpiryRef.current = setTimeout(() => {
      // Renovar somente em ready E ainda habilitado — não interromper popup_open/completing
      if (stepRef.current === 'ready' && enabledRef.current) void startNewSession(flowGenRef.current)
    }, delay)

    setStepAndRef('ready')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  // ── tryComplete ──────────────────────────────────────────────────────────
  // Chamado de três streams: FINISH (message event), FB.login callback e
  // timer de discovery fallback. Suporta os dois timings: FINISH→code e
  // code→FINISH. Com allowDiscovery=true, permite completar sem wabaId.
  //
  // Ordem do lock (sincronamente, antes de qualquer await):
  //   1. generation guard
  //   2. validar code
  //   3. decidir suficiência: wabaId OU allowDiscovery
  //   4. verificar isCompletingRef
  //   5. setar isCompletingRef = true
  //   6. clearRecoveryTimer
  //   7. removeMessageListener
  //   8. clearExpiryTimer
  //   9. construir payload
  //  10. POST

  function tryComplete(myGen: number, opts: { allowDiscovery?: boolean } = {}): void {
    // 1. Generation guard — descarta chamadas de gerações obsoletas
    if (myGen !== flowGenRef.current) return

    const { code, wabaId, phoneNumberId } = pendingRef.current

    // 2. code sempre obrigatório em ambos os caminhos
    if (typeof code !== 'string' || code.length === 0) return

    // 3. Suficiência: wabaId presente → normal; ausente → somente se allowDiscovery
    if (!wabaId && !opts.allowDiscovery) return

    // 4. Lock anti-double-complete
    if (isCompletingRef.current) return

    // 5. Adquirir lock sincronamente — nenhum await antes deste ponto
    isCompletingRef.current = true
    clearRecoveryTimer()        // 6. cancelar timer de fallback pendente
    removeMessageListener()     // 7. idempotente — pode já ter sido removido no FINISH
    clearExpiryTimer()          // 8.

    const session = sessionRef.current
    if (!session) { isCompletingRef.current = false; return }

    setStepAndRef('completing')

    // Mode derivado dos dados reais — nunca de opts.allowDiscovery diretamente
    const mode: 'normal' | 'discovery' = wabaId ? 'normal' : 'discovery'

    // #region agent log — debug 0b23ea (complete_attempt) — H-B H-C
    void (() => { const _p={sessionId:'0b23ea',location:'useMetaOnboarding.ts:complete_attempt',message:'complete_attempt',data:{event:'complete_attempt',mode,generation:myGen,currentGeneration:flowGenRef.current,hasCode:typeof code==='string'&&code.length>0,hasWabaId:typeof wabaId==='string'&&wabaId.length>0},timestamp:Date.now()}; console.debug('[meta-onboarding-debug]',_p); fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0b23ea'},body:JSON.stringify(_p)}).catch(()=>{}); })();
    // #endregion

    // 9. Payload: waba_id e phone_number_id incluídos condicionalmente.
    //    Discovery path → estritamente { state, code } sem waba_id ou phone_number_id.
    //    phone_number_id somente quando wabaId também existe (não inventar no discovery).
    const payload: OnboardingCompletePayload = {
      state: session.state,
      code,                                       // valor original, sem mutação
      ...(wabaId                   ? { waba_id:         wabaId       } : {}),
      ...(wabaId && phoneNumberId  ? { phone_number_id: phoneNumberId } : {}),
      // company_id: NUNCA — complete.js retorna 400 se presente
    }

    // 10. POST /complete — retorna CompleteResult (discriminated union)
    metaWhatsAppApi.completeOnboarding(payload)
      .then((result: CompleteResult) => {
        if (myGen !== flowGenRef.current) return    // company mudou — descartar

        if (result.kind === 'connected') {
          // Caminho normal: instância criada — encerrar fluxo e notificar.
          // idle ANTES de onSuccess para que o step já esteja limpo quando refresh()
          // disparar o re-render; evita que qualquer código posterior nesta closure
          // interfira no lifecycle iniciado por onSuccess.
          isCompletingRef.current = false
          pendingRef.current      = {}
          sessionRef.current      = null
          setStepAndRef('idle')
          onSuccessRef.current?.()                  // → refresh() da lista de instâncias
          // Não preparar nova sessão após sucesso — painel decide quando retomar
        } else {
          // kind === 'selection': múltiplos WABAs — aguardar escolha do usuário.
          // Armazenar token e opções em refs (fonte operacional) e state (renderização).
          // NÃO chamar onSuccess — fluxo ainda não está concluído.
          selectionTokenRef.current   = result.continuation_token
          selectionOptionsRef.current = result.options
          isCompletingRef.current     = false
          pendingRef.current          = {}
          sessionRef.current          = null
          setSelectionOptions(result.options)
          setStepAndRef('awaiting_selection')
        }
      })
      .catch((err: unknown) => {
        if (myGen !== flowGenRef.current) return
        isCompletingRef.current = false
        pendingRef.current      = {}
        sessionRef.current      = null             // state consumido — não reutilizar
        setOnboardingError(err instanceof Error ? err.message : 'Erro ao finalizar conexão')
        // Nova sessão somente se ainda habilitado — evitar /start em painel descartado
        if (enabledRef.current) void startNewSession(myGen)
        else setStepAndRef('idle')
      })
  }

  // ── scheduleDiscoveryFallback ─────────────────────────────────────────────
  // Agenda POST /complete sem waba_id após FINISH_GRACE_MS caso FINISH não chegue.
  // O timer NÃO verifica wabaId antecipadamente: tryComplete lê o snapshot atual
  // e usa caminho normal se wabaId estiver disponível (tornando a race mais robusta).

  function scheduleDiscoveryFallback(myGen: number): void {
    clearRecoveryTimer()   // garantir que não há timer duplicado
    recoveryTimerRef.current = setTimeout(() => {
      if (myGen !== flowGenRef.current) return   // gen guard
      if (isCompletingRef.current) return        // já completando
      // S7.5: instalar listener diagnóstico tardio ANTES de tryComplete remover o
      // funcional — detecta R4 (FINISH chega após F3 adquirir lock).
      // Puramente observabilidade — nenhum efeito no fluxo funcional.
      installLateDiagListener()
      tryComplete(myGen, { allowDiscovery: true })
    }, FINISH_GRACE_MS)
  }

  // ── useEffect: mount + company change ────────────────────────────────────

  useEffect(() => {
    // enabled=false → limpar e permanecer idle (somente lifecycle — não é autorização)
    if (!companyId || options?.enabled === false) {
      removeMessageListener()
      clearRecoveryTimer()
      clearExpiryTimer()
      clearSelectionState()
      sessionRef.current      = null
      pendingRef.current      = {}
      isCompletingRef.current = false
      setStepAndRef('idle')
      setOnboardingError(null)
      return
    }

    void startNewSession(flowGenRef.current)

    return () => {
      // Unmount, company change ou enabled→false — incrementar gen descarta async em voo
      // SEM setState (componente pode estar sendo desmontado)
      flowGenRef.current += 1
      removeMessageListener()
      clearRecoveryTimer()
      clearExpiryTimer()
      removeLateDiagListener()   // encerrar listener diagnóstico tardio se ativo
      // Limpar selection state: token fica somente em memória — sem persistência
      selectionTokenRef.current   = null
      selectionOptionsRef.current = null
      isSelectingRef.current      = false
      // Nota: setSelectionOptions NÃO é chamado aqui (componente pode estar desmontando)
      sessionRef.current      = null
      pendingRef.current      = {}
      isCompletingRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, options?.enabled])

  // ── triggerPopup ─────────────────────────────────────────────────────────

  const triggerPopup = useCallback((): void => {
    if (stepRef.current !== 'ready') return
    const session = sessionRef.current
    if (!session) return
    if (!window.FB) return   // SDK não disponível — nunca entrar em popup_open sem FB

    const myGen = flowGenRef.current
    clearRecoveryTimer()    // defensivo — descarta fallback de tentativa anterior
    pendingRef.current = {}
    setStepAndRef('popup_open')

    // Instalar listener de forma síncrona ANTES do FB.login
    const listener = (event: MessageEvent): void => {
      // #region diag-finish — remover após diagnóstico do FINISH event
      // Captura TODA mensagem recebida antes de qualquer filtro — visible em DevTools.
      // Permite confirmar se Meta envia de origem diferente de www.facebook.com.
      // Não loga conteúdo — apenas origin, type e event.
      if (typeof event.data === 'object' && event.data !== null) {
        const _dt = (event.data as Record<string, unknown>)['type']
        const _de = (event.data as Record<string, unknown>)['event']
        if (_dt === 'WA_EMBEDDED_SIGNUP' || String(event.origin).includes('facebook') || String(event.origin).includes('fb.com')) {
          console.log('[meta-finish-diag]', { origin: event.origin, type: _dt, event: _de })
        }
      } else if (typeof event.data === 'string') {
        // #region diag-finish-str — R2: detecta payload WA enviado como JSON string
        // Embedded Signup v2 enviava data como string; v4 envia como object.
        // NÃO passa ao parser funcional — somente diagnóstico.
        // NÃO loga o string original nem parsed.data (pode conter waba_id, phone_number_id).
        try {
          const _parsed = JSON.parse(event.data) as Record<string, unknown>
          if (typeof _parsed === 'object' && _parsed !== null) {
            const _dt = _parsed['type']
            const _de = _parsed['event']
            if (_dt === 'WA_EMBEDDED_SIGNUP' || String(event.origin).includes('facebook') || String(event.origin).includes('fb.com')) {
              console.log('[meta-finish-diag-str]', { origin: event.origin, type: _dt, event: _de })
            }
          }
        } catch { /* JSON inválido — ignorar silenciosamente */ }
        // #endregion diag-finish-str
      }
      // #endregion diag-finish

      const result = parseWaEmbeddedSignup(event)
      if (result.kind === 'IGNORE') return

      // #region agent log — debug 0b23ea (window_message) — H-B H-C
      void (() => { const _p={sessionId:'0b23ea',location:'useMetaOnboarding.ts:window_message',message:'window_message',data:{event:'window_message',generation:myGen,currentGeneration:flowGenRef.current,origin:event.origin,dataType:typeof event.data,embeddedEvent:result.kind},timestamp:Date.now()}; console.debug('[meta-onboarding-debug]',_p); fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0b23ea'},body:JSON.stringify(_p)}).catch(()=>{}); })();
      // #endregion

      if (result.kind === 'FINISH') {
        // Salvar wabaId — code pode ainda não ter chegado (timing: FINISH→code)
        // NÃO limpar pendingRef — code ainda pode chegar pelo FB.login callback
        pendingRef.current.wabaId        = result.data.wabaId
        pendingRef.current.phoneNumberId = result.data.phoneNumberId
        clearRecoveryTimer()      // FINISH chegou — cancelar discovery fallback
        removeMessageListener()   // FINISH obtido — não há mais eventos WA esperados
        tryComplete(myGen)
        return
      }

      // CANCEL ou ERROR
      clearRecoveryTimer()      // sem FINISH esperado — cancelar fallback
      removeMessageListener()
      pendingRef.current = {}
      sessionRef.current = null   // state antigo não deve ser reutilizado
      if (result.kind === 'ERROR') setOnboardingError('Erro no fluxo de conexão Meta')
      setStepAndRef('idle')
      // Preparar nova sessão somente se ainda habilitado — evita loading_session indevido
      if (enabledRef.current) void startNewSession(myGen)
    }

    listenerRef.current = listener
    window.addEventListener('message', listener)

    // #region agent log — debug 0b23ea (fb_login_call) — H-A H-D
    void (() => { const _p={sessionId:'0b23ea',location:'useMetaOnboarding.ts:fb_login_call',message:'fb_login_call',data:{event:'fb_login_call',generation:myGen,currentGeneration:flowGenRef.current,step:stepRef.current,hasSession:!!sessionRef.current,hasFB:!!window.FB},timestamp:Date.now()}; console.debug('[meta-onboarding-debug]',_p); fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0b23ea'},body:JSON.stringify(_p)}).catch(()=>{}); })();
    // #endregion

    window.FB?.login(
      (response) => {
        // #region agent log — debug 0b23ea (fb_login_callback) — H-A H-B H-D
        void (() => { const _p={sessionId:'0b23ea',location:'useMetaOnboarding.ts:fb_login_callback',message:'fb_login_callback',data:{event:'fb_login_callback',generation:myGen,currentGeneration:flowGenRef.current,step:stepRef.current,status:response.status,hasAuthResponse:response.authResponse!==null&&response.authResponse!==undefined,hasCode:typeof response.authResponse?.code==='string'&&(response.authResponse?.code?.length??0)>0},timestamp:Date.now()}; console.debug('[meta-onboarding-debug]',_p); fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0b23ea'},body:JSON.stringify(_p)}).catch(()=>{}); })();
        // #endregion

        // Guard: ignorar se popup_open já foi encerrado (ex: CANCEL via message)
        if (stepRef.current !== 'popup_open') return

        // #region diag-authresponse-shape — remover após diagnóstico do authResponse
        // Emite somente os NOMES das propriedades de authResponse — nunca valores.
        // Permite identificar se o FB SDK inclui sessionInfo/grantedScopes/outros
        // no authResponse com featureType='' + sessionInfoVersion='3'.
        // TODO: remover após diagnóstico confirmado.
        console.info('[meta-auth-response-shape]', {
          keys: Object.keys(response.authResponse ?? {}).sort(),
        })
        // #endregion diag-authresponse-shape

        const code = response.authResponse?.code

        if (typeof code !== 'string' || code.length === 0) {
          // Sem code — CANCEL, erro interno do SDK ou popup fechado pelo OS
          // Não afirmar que é CANCEL — pode ser outro motivo sem code
          clearRecoveryTimer()    // sem code, sem recovery possível
          removeMessageListener()
          pendingRef.current = {}
          setStepAndRef('idle')
          // Nova sessão somente se habilitado — evita loading_session indevido
          if (enabledRef.current) void startNewSession(myGen)
          return
        }

        // Salvar code — wabaId pode ainda não ter chegado (timing: code→FINISH)
        pendingRef.current.code = code
        tryComplete(myGen)

        // Se tryComplete não completou (wabaId ausente), agendar discovery fallback.
        // Verificar generation e lock para evitar timer órfão.
        if (myGen === flowGenRef.current && !isCompletingRef.current && !pendingRef.current.wabaId) {
          scheduleDiscoveryFallback(myGen)
        }
      },
      {
        config_id:                      session.config_id,
        response_type:                  'code',
        override_default_response_type: true,
        extras:                         { setup: {}, featureType: '', sessionInfoVersion: '3' },
      },
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  // ── cancelFlow ───────────────────────────────────────────────────────────

  const cancelFlow = useCallback((): void => {
    flowGenRef.current += 1   // invalida todos os async em voo
    removeMessageListener()
    clearRecoveryTimer()
    clearExpiryTimer()
    removeLateDiagListener()   // encerrar listener diagnóstico tardio se ativo
    clearSelectionState()
    sessionRef.current      = null
    pendingRef.current      = {}
    isCompletingRef.current = false
    setOnboardingError(null)
    setStepAndRef('idle')
    if (companyId && enabledRef.current) void startNewSession(flowGenRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  // ── selectWaba ────────────────────────────────────────────────────────────
  // Aciona a resolução de seleção de WABA/número em awaiting_selection.
  //
  // Usa refs como fonte operacional (evita stale closure):
  //   selectionOptionsRef → fonte de verdade das opções
  //   selectionTokenRef   → continuation token (somente memória)
  //   isSelectingRef      → lock anti-double-submit
  //
  // O índice recebido é o option.index exato — NÃO a posição no array.

  const selectWaba = useCallback((index: number): void => {
    // Guard 1: estado correto
    if (stepRef.current !== 'awaiting_selection') return
    // Guard 2: lock anti-double-submit
    if (isSelectingRef.current) return

    // Validar index: inteiro >= 0 E presente nas opções armazenadas
    if (!Number.isInteger(index) || index < 0) return
    const opts = selectionOptionsRef.current
    if (!opts || opts.length === 0) return
    const matchedOption = opts.find(o => o.index === index)
    if (!matchedOption) return

    // Token obrigatório
    const token = selectionTokenRef.current
    if (!token) return

    // Adquirir lock sincronamente — nenhum await antes deste ponto
    isSelectingRef.current = true
    const myGen = flowGenRef.current
    setStepAndRef('resolving_selection')

    metaWhatsAppApi.resolveWabaSelection(token, matchedOption.index)
      .then(() => {
        if (myGen !== flowGenRef.current) return   // generation guard — company mudou
        clearSelectionState()
        setStepAndRef('idle')
        onSuccessRef.current?.()                   // → refresh() da lista de instâncias
      })
      .catch((err: unknown) => {
        if (myGen !== flowGenRef.current) return
        clearSelectionState()
        setStepAndRef('idle')
        const code = err instanceof Error ? err.message : ''
        setOnboardingError(mapSelectionError(code))
        // NÃO iniciar nova sessão automaticamente — usuário decide próxima ação.
        // NÃO retry automático para nenhum código de erro.
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])   // refs são estáveis — sem deps de valor

  // ── Retorno ───────────────────────────────────────────────────────────────

  return {
    step,
    onboardingError,
    triggerPopup,
    cancelFlow,
    isReady: step === 'ready',
    selectionOptions,
    selectWaba,
  }
}
