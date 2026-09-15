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
  OnboardingStep,
  OnboardingCompletePayload,
  OnboardingStartResponse,
} from '../types/meta-whatsapp'

// ── Constantes ────────────────────────────────────────────────────────────────

// Exact match — fonte: developers.facebook.com/docs/whatsapp/embedded-signup
const ACCEPTED_ORIGIN    = 'https://www.facebook.com' as const
const META_ID_RE         = /^[0-9]+$/     // idêntica a complete.js
const RENEW_THRESHOLD_MS = 60_000         // renovar sessão 60 s antes de expirar

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
}

// ── Parser fail-closed ────────────────────────────────────────────────────────

function parseWaEmbeddedSignup(event: MessageEvent): WaEventResult {
  if (event.origin !== ACCEPTED_ORIGIN)                        return { kind: 'IGNORE' }
  const raw = event.data as Record<string, unknown> | null | undefined
  if (typeof raw !== 'object' || raw === null)                  return { kind: 'IGNORE' }
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

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMetaOnboarding(
  options?: UseMetaOnboardingOptions,
): UseMetaOnboardingResult {
  const { company } = useCompany()
  const companyId   = company?.id ?? null

  const [step,            setStep]           = useState<OnboardingStep>('idle')
  const [onboardingError, setOnboardingError] = useState<string | null>(null)

  // Refs — acessíveis em closures assíncronas sem causar re-render
  const stepRef           = useRef<OnboardingStep>('idle')   // mirror do step
  const flowGenRef        = useRef(0)                        // geração monotônica
  const sessionRef        = useRef<OnboardingStartResponse | null>(null)
  const pendingRef        = useRef<PendingComplete>({})      // correlação FINISH+code
  const isCompletingRef   = useRef(false)                    // lock anti-double-complete
  const listenerRef       = useRef<((e: MessageEvent) => void) | null>(null)
  const sessionExpiryRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onSuccessRef      = useRef(options?.onSuccess)
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

  // ── startNewSession ──────────────────────────────────────────────────────
  // Pré-cria sessão via /start e carrega SDK. Resultado descartado se gen obsoleto.
  // Nunca chamar durante popup_open ou completing.

  const startNewSession = useCallback(async (myGen: number): Promise<void> => {
    if (!companyId) return

    clearExpiryTimer()
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
  // Chamado de dois streams: FINISH (message event) e FB.login callback.
  // Suporta os dois timings: FINISH→code e code→FINISH.
  // Aguarda ambas as peças antes de disparar /complete.

  function tryComplete(myGen: number): void {
    const { code, wabaId, phoneNumberId } = pendingRef.current
    if (typeof code   !== 'string' || code.length   === 0) return
    if (typeof wabaId !== 'string' || wabaId.length === 0) return
    if (isCompletingRef.current) return

    isCompletingRef.current = true
    removeMessageListener()   // idempotente — pode já ter sido removido no FINISH
    clearExpiryTimer()

    const session = sessionRef.current
    if (!session) { isCompletingRef.current = false; return }

    setStepAndRef('completing')

    // #region agent log — debug 0b23ea (complete_attempt) — H-B H-C
    void (() => { const _p={sessionId:'0b23ea',location:'useMetaOnboarding.ts:complete_attempt',message:'complete_attempt',data:{event:'complete_attempt',generation:myGen,currentGeneration:flowGenRef.current,hasCode:typeof code==='string'&&code.length>0,hasWabaId:typeof wabaId==='string'&&wabaId.length>0},timestamp:Date.now()}; console.debug('[meta-onboarding-debug]',_p); fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0b23ea'},body:JSON.stringify(_p)}).catch(()=>{}); })();
    // #endregion

    const payload: OnboardingCompletePayload = {
      state:   session.state,
      code,                           // valor original, sem mutação
      waba_id: wabaId,
      ...(phoneNumberId ? { phone_number_id: phoneNumberId } : {}),
      // company_id: NUNCA — complete.js retorna 400 se presente (linha 161)
    }

    metaWhatsAppApi.completeOnboarding(payload)
      .then(() => {
        if (myGen !== flowGenRef.current) return    // company mudou — descartar
        isCompletingRef.current = false
        pendingRef.current      = {}
        sessionRef.current      = null
        // idle ANTES de onSuccess para que o step já esteja limpo quando refresh()
        // disparar o re-render; evita que qualquer código posterior nesta closure
        // interfira no lifecycle iniciado por onSuccess.
        setStepAndRef('idle')
        onSuccessRef.current?.()                   // → refresh() da lista de instâncias
        // Não preparar nova sessão após sucesso — painel decide quando retomar
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

  // ── useEffect: mount + company change ────────────────────────────────────

  useEffect(() => {
    // enabled=false → limpar e permanecer idle (somente lifecycle — não é autorização)
    if (!companyId || options?.enabled === false) {
      removeMessageListener()
      clearExpiryTimer()
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
      clearExpiryTimer()
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
    pendingRef.current = {}
    setStepAndRef('popup_open')

    // Instalar listener de forma síncrona ANTES do FB.login
    const listener = (event: MessageEvent): void => {
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
        removeMessageListener()   // FINISH obtido — não há mais eventos WA esperados
        tryComplete(myGen)
        return
      }

      // CANCEL ou ERROR
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

        const code = response.authResponse?.code

        if (typeof code !== 'string' || code.length === 0) {
          // Sem code — CANCEL, erro interno do SDK ou popup fechado pelo OS
          // Não afirmar que é CANCEL — pode ser outro motivo sem code
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
    clearExpiryTimer()
    sessionRef.current      = null
    pendingRef.current      = {}
    isCompletingRef.current = false
    setOnboardingError(null)
    setStepAndRef('idle')
    if (companyId && enabledRef.current) void startNewSession(flowGenRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  // ── Retorno ───────────────────────────────────────────────────────────────

  return { step, onboardingError, triggerPopup, cancelFlow, isReady: step === 'ready' }
}
