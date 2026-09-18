// @vitest-environment jsdom
// =============================================================================
// src/hooks/__tests__/useMetaOnboarding.test.ts
//
// Contratos críticos do Embedded Signup: parser, lifecycle, correlação,
// single-complete, generation guard, enabled, timers e StrictMode.
//
// Infraestrutura: Vitest 4 · @testing-library/react 16 · jsdom 25
// Environment:    jsdom (per-file — não afeta suíte node existente)
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import React from 'react'
import { useMetaOnboarding } from '../useMetaOnboarding'
import type { UseMetaOnboardingResult } from '../useMetaOnboarding'

// ── Mocks (hoisted pelo Vitest antes dos imports do módulo) ──────────────────

vi.mock('../useCompany', () => ({ useCompany: vi.fn() }))

vi.mock('../../services/metaWhatsAppApi', () => ({
  metaWhatsAppApi: { startOnboarding: vi.fn(), completeOnboarding: vi.fn(), resolveWabaSelection: vi.fn() },
}))

vi.mock('../../lib/facebookSdk', () => ({ loadFacebookSdk: vi.fn() }))

import { useCompany }      from '../useCompany'
import { metaWhatsAppApi } from '../../services/metaWhatsAppApi'
import { loadFacebookSdk } from '../../lib/facebookSdk'

// ── Valores sintéticos (zero tokens/codes/states reais) ──────────────────────

const COMPANY_A      = { id: 'company-aaaa-0001' }
const COMPANY_B      = { id: 'company-bbbb-0002' }
const FAKE_STATE     = 'state-fake-0000-0000'
const FAKE_APP_ID    = '11111111'
const FAKE_CONFIG_ID = '22222222'
const FAKE_CODE      = 'auth-code-fake-xxxx'
const FAKE_WABA_ID   = '333333333333'
const FAKE_PHONE_ID  = '444444444444'
const RENEW_MS       = 60_000   // igual ao RENEW_THRESHOLD_MS interno do hook

// ── Fixtures S7 ──────────────────────────────────────────────────────────────
const FAKE_INSTANCE = {
  id:              'inst-h-001',
  phone_number_id: '555555555555',
  waba_id:         '666666666666',
  phone_number:    '+55 11 99999-0001',
  verified_name:   null,
  status:          'connected' as const,
}
const FAKE_CONNECTED_RESULT = { kind: 'connected' as const, instance: FAKE_INSTANCE }
const FAKE_CONTINUATION_TOKEN = 'FAKE_CONT_TOKEN_FOR_TESTS'
const FAKE_SELECTION_OPTIONS = [
  { index: 5, label: '+55 11 99999-0005', name: 'WABA Cinco'  },
  { index: 7, label: '+55 11 99999-0007', name: null           },
]
const FAKE_SELECTION_RESULT = {
  kind:               'selection' as const,
  continuation_token: FAKE_CONTINUATION_TOKEN,
  options:            FAKE_SELECTION_OPTIONS,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(o: Partial<{
  expires_at: string; state: string; app_id: string; config_id: string
}> = {}) {
  return {
    state:      FAKE_STATE,
    app_id:     FAKE_APP_ID,
    config_id:  FAKE_CONFIG_ID,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ...o,
  }
}

function dispatchWaMsg(data: unknown, origin = 'https://www.facebook.com') {
  window.dispatchEvent(new MessageEvent('message', { origin, data }))
}

const dispatchFinish = (wabaId = FAKE_WABA_ID, phoneId?: string) =>
  dispatchWaMsg({
    type: 'WA_EMBEDDED_SIGNUP',
    event: 'FINISH',
    data: { waba_id: wabaId, ...(phoneId !== undefined ? { phone_number_id: phoneId } : {}) },
  })

const dispatchCancel = () => dispatchWaMsg({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL' })
const dispatchError  = () => dispatchWaMsg({ type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR' })

// ── S7.6 helpers ─────────────────────────────────────────────────────────────
// dispatchWaStrMsg: serializa data como JSON string (simula Meta v2/mobile).
function dispatchWaStrMsg(data: unknown, origin = 'https://www.facebook.com') {
  window.dispatchEvent(new MessageEvent('message', { origin, data: JSON.stringify(data) }))
}

// dispatchWaRawStrMsg: despacha raw como string literal sem JSON.stringify.
// Usar para testar JSON sintaticamente inválido (S76-05).
function dispatchWaRawStrMsg(raw: string, origin = 'https://www.facebook.com') {
  window.dispatchEvent(new MessageEvent('message', { origin, data: raw }))
}

// ── Setup global ──────────────────────────────────────────────────────────────

let capturedLoginCb: ((r: unknown) => void) | null = null

beforeEach(() => {
  vi.clearAllMocks()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useCompany).mockReturnValue({ company: COMPANY_A } as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(loadFacebookSdk).mockResolvedValue(undefined as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(metaWhatsAppApi.startOnboarding).mockResolvedValue(makeSession() as any)
  // completeOnboarding retorna CompleteResult — default: connected (preserva testes existentes)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValue(FAKE_CONNECTED_RESULT as any)
  // resolveWabaSelection retorna OnboardingCompleteInstance por padrão
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(metaWhatsAppApi.resolveWabaSelection).mockResolvedValue(FAKE_INSTANCE as any)
  capturedLoginCb = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).FB = {
    login: vi.fn((cb: (r: unknown) => void) => { capturedLoginCb = cb }),
  }
})

afterEach(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).FB
  // ── S7.5 ROOT-CAUSE FIX: flush React 18 passive effects ──────────────
  // Contexto: Vitest executa afterEach em ordem LIFO — este hook roda ANTES
  // do afterEach(cleanup) global registrado pelo RTL (que o importa antes).
  //
  // Problema: RTL cleanup() usa act() SÍNCRONO internamente. No React 18,
  // act() síncrono NÃO garante flush de useEffect cleanups (passive effects).
  // Estes são agendados via React scheduler (MessageChannel) e só são
  // flushed com await act() assíncrono.
  //
  // Solução: chamar cleanup() explicitamente aqui (remove do tracking do RTL),
  // depois await act() para flushar os passive effects agendados. O afterEach
  // do RTL então encontra o set vazio e vira no-op.
  //
  // Cobre: F3 tests, H16 e qualquer teste que instale installLateDiagListener.
  cleanup()
  await act(async () => {})
})

// Montar o hook e aguardar estado ready
async function renderReady(opts: { enabled?: boolean; onSuccess?: () => void } = {}) {
  const { enabled = true, onSuccess } = opts
  const r = renderHook(() => useMetaOnboarding({ enabled, onSuccess }))
  await act(async () => {})
  return r
}

// Levar o hook de ready até completing (FINISH → code, completeOnboarding é chamado)
// Não aguarda resolução do complete: útil para testes que precisam do step 'completing'.
async function triggerComplete(result: { readonly current: UseMetaOnboardingResult }) {
  act(() => { result.current.triggerPopup() })
  await act(async () => { dispatchFinish() })
  await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })
}

// ── 1. PARSER BOUNDARY ───────────────────────────────────────────────────────
// Contratos testados via dispatch de MessageEvent com o hook em popup_open.
// Parser interno não é exportado — contratos exercitados pela API pública.

describe('Parser boundary', () => {
  async function inPopupOpen() {
    const hook = await renderReady()
    act(() => { hook.result.current.triggerPopup() })
    expect(hook.result.current.step).toBe('popup_open')
    return hook
  }

  it('PARSER-01: origin errado → IGNORE, step permanece popup_open', async () => {
    const { result } = await inPopupOpen()
    await act(async () => {
      dispatchWaMsg({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL' }, 'https://evil.com')
    })
    expect(result.current.step).toBe('popup_open')
  })

  it('PARSER-02: subdomínio facebook.com → IGNORE', async () => {
    const { result } = await inPopupOpen()
    await act(async () => {
      dispatchWaMsg({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL' }, 'https://m.facebook.com')
    })
    expect(result.current.step).toBe('popup_open')
  })

  it('PARSER-03: type ausente → IGNORE', async () => {
    const { result } = await inPopupOpen()
    await act(async () => { dispatchWaMsg({ event: 'CANCEL' }) })
    expect(result.current.step).toBe('popup_open')
  })

  it('PARSER-04: type diferente → IGNORE (step permanece popup_open)', async () => {
    // type !== 'WA_EMBEDDED_SIGNUP' → parseWaEmbeddedSignup retorna IGNORE
    const { result } = await inPopupOpen()
    await act(async () => {
      dispatchWaMsg({ type: 'OTHER_SIGNUP_TYPE', event: 'CANCEL' })
    })
    expect(result.current.step).toBe('popup_open')
  })

  it('PARSER-05: CANCEL → fluxo encerrado', async () => {
    const { result } = await inPopupOpen()
    await act(async () => { dispatchCancel() })
    expect(result.current.step).not.toBe('popup_open')
    expect(result.current.step).not.toBe('completing')
  })

  it('PARSER-06: ERROR → step encerrado, retry iniciado', async () => {
    // onboardingError é transiente: startNewSession chama setOnboardingError(null)
    // antes de await /start. Contrato observável: step sai de popup_open + retry é iniciado.
    const { result } = await inPopupOpen()
    await act(async () => { dispatchError() })
    expect(result.current.step).not.toBe('popup_open')
    expect(result.current.step).not.toBe('completing')
    // 1 (mount) + 1 (retry pós-ERROR)
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(2)
  })

  it('PARSER-07: FINISH waba_id numérico válido → aceito (code ainda pendente)', async () => {
    const { result } = await inPopupOpen()
    await act(async () => { dispatchFinish(FAKE_WABA_ID) })
    // sem code → tryComplete retorna early; listener removido; sem erro
    expect(result.current.onboardingError).toBeNull()
    expect(result.current.step).toBe('popup_open')
  })

  it('PARSER-08: FINISH waba_id alfanumérico → tratado como ERROR (step encerrado)', async () => {
    // META_ID_RE = /^[0-9]+$/ — letras reprovam
    const { result } = await inPopupOpen()
    await act(async () => { dispatchFinish('invalid-abc') })
    expect(result.current.step).not.toBe('popup_open')
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(2)
  })

  it('PARSER-09: FINISH waba_id vazio → ERROR (step encerrado)', async () => {
    // META_ID_RE.test('') === false → ERROR
    const { result } = await inPopupOpen()
    await act(async () => { dispatchFinish('') })
    expect(result.current.step).not.toBe('popup_open')
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(2)
  })

  it('PARSER-10: FINISH waba_id null → ERROR (step encerrado)', async () => {
    const { result } = await inPopupOpen()
    await act(async () => {
      dispatchWaMsg({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: null } })
    })
    expect(result.current.step).not.toBe('popup_open')
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(2)
  })

  it('PARSER-11: FINISH phone_number_id numérico válido → aceito', async () => {
    const { result } = await inPopupOpen()
    await act(async () => { dispatchFinish(FAKE_WABA_ID, FAKE_PHONE_ID) })
    expect(result.current.onboardingError).toBeNull()
  })

  it('PARSER-12: FINISH phone_number_id alfanumérico → ERROR (step encerrado)', async () => {
    const { result } = await inPopupOpen()
    await act(async () => { dispatchFinish(FAKE_WABA_ID, 'invalid-phone') })
    expect(result.current.step).not.toBe('popup_open')
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(2)
  })

  it('PARSER-13: FINISH phone_number_id vazio → ERROR (step encerrado)', async () => {
    // '' não passa META_ID_RE → ERROR
    const { result } = await inPopupOpen()
    await act(async () => { dispatchFinish(FAKE_WABA_ID, '') })
    expect(result.current.step).not.toBe('popup_open')
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(2)
  })

  it('PARSER-14: FINISH data null → ERROR (step encerrado)', async () => {
    // data null → data?.['waba_id'] = undefined → typeof undefined !== "string" → ERROR
    const { result } = await inPopupOpen()
    await act(async () => {
      dispatchWaMsg({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: null })
    })
    expect(result.current.step).not.toBe('popup_open')
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(2)
  })
})

// ── 2. LIFECYCLE / ENABLED ───────────────────────────────────────────────────

describe('Lifecycle / enabled', () => {
  it('TC-A01: enabled=false → zero startOnboarding, step idle', async () => {
    const { result } = renderHook(() => useMetaOnboarding({ enabled: false }))
    await act(async () => {})
    expect(result.current.step).toBe('idle')
    expect(metaWhatsAppApi.startOnboarding).not.toHaveBeenCalled()
  })

  it('TC-B01: false → true → exatamente um start, ready', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMetaOnboarding({ enabled }),
      { initialProps: { enabled: false } },
    )
    await act(async () => {})
    expect(metaWhatsAppApi.startOnboarding).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await act(async () => {})
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(1)
    expect(result.current.step).toBe('ready')
  })

  it('TC-C01: true → false → step idle, zero /start novo', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMetaOnboarding({ enabled }),
      { initialProps: { enabled: true } },
    )
    await act(async () => {})
    expect(result.current.step).toBe('ready')

    vi.mocked(metaWhatsAppApi.startOnboarding).mockClear()
    rerender({ enabled: false })
    await act(async () => {})
    expect(result.current.step).toBe('idle')
    expect(metaWhatsAppApi.startOnboarding).not.toHaveBeenCalled()
  })

  it('TC-D01: expires_at inválido → idle + onboardingError, nunca ready', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(metaWhatsAppApi.startOnboarding).mockResolvedValue(makeSession({ expires_at: 'not-a-date' }) as any)
    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})
    expect(result.current.step).toBe('idle')
    expect(result.current.isReady).toBe(false)
    expect(result.current.onboardingError).not.toBeNull()
  })

  it('TC-D02: expires_at inválido → cancelFlow inicia nova sessão válida', async () => {
    vi.mocked(metaWhatsAppApi.startOnboarding)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce(makeSession({ expires_at: 'not-a-date' }) as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(makeSession() as any)

    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})
    expect(result.current.onboardingError).not.toBeNull()

    await act(async () => { result.current.cancelFlow() })
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(2)
    expect(result.current.step).toBe('ready')
    expect(result.current.onboardingError).toBeNull()
  })
})

// ── 3. CORRELAÇÃO FINISH ↔ CODE ──────────────────────────────────────────────

describe('Correlação FINISH ↔ code', () => {
  it('TC-E: FINISH → code → exatamente um completeOnboarding', async () => {
    const onSuccess = vi.fn()
    const { result } = await renderReady({ onSuccess })
    act(() => { result.current.triggerPopup() })

    await act(async () => { dispatchFinish() })
    // code ainda não chegou → tryComplete retornou early
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
    expect(result.current.step).toBe('popup_open')

    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })
    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
    expect(result.current.step).toBe('idle')
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('TC-F: code → FINISH → exatamente um completeOnboarding', async () => {
    const onSuccess = vi.fn()
    const { result } = await renderReady({ onSuccess })
    act(() => { result.current.triggerPopup() })

    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })
    // wabaId ainda não chegou → tryComplete retornou early
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
    expect(result.current.step).toBe('popup_open')

    await act(async () => { dispatchFinish() })
    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
    expect(result.current.step).toBe('idle')
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('TC-EF01: payload: state, code, waba_id presentes; ZERO company_id', async () => {
    vi.mocked(metaWhatsAppApi.startOnboarding)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(makeSession({ state: 'specific-state-abc' }) as any)
    const { result } = await renderReady()
    act(() => { result.current.triggerPopup() })
    await act(async () => { dispatchFinish(FAKE_WABA_ID) })
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = vi.mocked(metaWhatsAppApi.completeOnboarding).mock.calls[0][0] as any
    expect(payload.state).toBe('specific-state-abc')
    expect(payload.code).toBe(FAKE_CODE)
    expect(payload.waba_id).toBe(FAKE_WABA_ID)
    expect(payload).not.toHaveProperty('company_id')
    expect(payload).not.toHaveProperty('phone_number_id')
  })

  it('TC-EF02: phone_number_id incluído no payload somente quando presente no FINISH', async () => {
    const { result } = await renderReady()
    act(() => { result.current.triggerPopup() })
    await act(async () => { dispatchFinish(FAKE_WABA_ID, FAKE_PHONE_ID) })
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = vi.mocked(metaWhatsAppApi.completeOnboarding).mock.calls[0][0] as any
    expect(payload.phone_number_id).toBe(FAKE_PHONE_ID)
  })
})

// ── 4. CANCEL / ERROR / NO-CODE — enabledRef guards (regressão 1D.3) ─────────

describe('CANCEL / ERROR / no-code', () => {
  it('TC-G01: CANCEL + enabled=true → idle + nova sessão preparada', async () => {
    const { result } = await renderReady()
    act(() => { result.current.triggerPopup() })
    await act(async () => { dispatchCancel() })
    // 1 (mount) + 1 (pós-CANCEL)
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(2)
    expect(result.current.step).toBe('ready')
  })

  it('TC-H01: CANCEL → retry em voo → enabled=false descarta sessão stale (gen guard)', async () => {
    // Prova o generation guard: CANCEL inicia retry, enabled=false incrementa gen antes
    // da resolução → resposta stale é descartada, step permanece idle.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolveRetry!: (s: any) => void
    vi.mocked(metaWhatsAppApi.startOnboarding)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce(makeSession() as any)           // sessão inicial
      .mockImplementationOnce(() => new Promise(r => { resolveRetry = r }))  // retry pendente

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMetaOnboarding({ enabled }),
      { initialProps: { enabled: true } },
    )
    await act(async () => {})
    act(() => { result.current.triggerPopup() })
    expect(result.current.step).toBe('popup_open')

    // CANCEL: listener processa → startNewSession iniciado, /start pendente
    act(() => { dispatchCancel() })

    // enabled=false enquanto retry está em voo → cleanup incrementa gen
    rerender({ enabled: false })
    await act(async () => {})
    expect(result.current.step).toBe('idle')

    // Retry resolve → gen antigo ≠ gen atual → descartado
    await act(async () => { resolveRetry(makeSession()) })
    expect(result.current.step).toBe('idle')   // NOT ready — sessão stale descartada
    expect(result.current.onboardingError).toBeNull()
  })

  it('TC-I01: ERROR + enabled=true → onboardingError definido + retry iniciado', async () => {
    // onboardingError persiste somente quando o retry também falha.
    // startNewSession chama setOnboardingError(null) ANTES de await /start;
    // se o retry falhar, um novo erro é definido e permanece visível.
    vi.mocked(metaWhatsAppApi.startOnboarding)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce(makeSession() as any)
      .mockRejectedValue(new Error('Falha no retry'))

    const { result } = await renderReady()
    act(() => { result.current.triggerPopup() })
    await act(async () => { dispatchError() })
    expect(result.current.onboardingError).not.toBeNull()
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(2)
  })

  it('TC-J01: callback FB sem code + enabled=true → idle + nova sessão', async () => {
    const { result } = await renderReady()
    act(() => { result.current.triggerPopup() })
    await act(async () => { capturedLoginCb?.({ authResponse: null }) })
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(2)
  })

  it('TC-J02: callback sem code → retry em voo → enabled=false descarta sessão stale (gen guard)', async () => {
    // Callback de FB sem code (step=popup_open) inicia retry.
    // enabled=false antes da resolução do retry prova que gen guard descarta stale.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolveRetry!: (s: any) => void
    vi.mocked(metaWhatsAppApi.startOnboarding)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce(makeSession() as any)
      .mockImplementationOnce(() => new Promise(r => { resolveRetry = r }))

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMetaOnboarding({ enabled }),
      { initialProps: { enabled: true } },
    )
    await act(async () => {})
    act(() => { result.current.triggerPopup() })
    expect(result.current.step).toBe('popup_open')

    // callback sem code (step=popup_open, enabled=true) → startNewSession pendente
    act(() => { capturedLoginCb?.({ authResponse: null }) })

    // enabled=false enquanto retry está em voo
    rerender({ enabled: false })
    await act(async () => {})

    // Retry resolve → gen guard → descartado
    await act(async () => { resolveRetry(makeSession()) })
    expect(result.current.step).toBe('idle')
    expect(result.current.onboardingError).toBeNull()
  })

  it('TC-J03: FINISH tardio após callback-sem-code não ressuscita complete', async () => {
    const { result } = await renderReady()
    act(() => { result.current.triggerPopup() })
    // callback sem code → fluxo invalidado; listener removido
    await act(async () => { capturedLoginCb?.({ authResponse: null }) })
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockClear()
    // FINISH tardio — listener já foi removido
    await act(async () => { dispatchFinish() })
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
  })
})

// ── 5. COMPLETE ──────────────────────────────────────────────────────────────

describe('Complete', () => {
  it('TC-K01: sucesso → um completeOnboarding, um onSuccess, step idle', async () => {
    const onSuccess = vi.fn()
    const { result } = await renderReady({ onSuccess })
    await triggerComplete(result)
    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(result.current.step).toBe('idle')
  })

  it('TC-K02: onSuccess → enabled=false → closure não inicia nova sessão', async () => {
    // Prova o contrato da correção 1D.3 (setStepAndRef antes de onSuccess):
    // onSuccess dispara rerender com enabled=false; nenhuma ação posterior da closure
    // antiga: zero startOnboarding, zero onboardingError stale, step permanece idle.
    let doDisable = () => {}
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMetaOnboarding({
        enabled,
        onSuccess: () => doDisable(),
      }),
      { initialProps: { enabled: true } },
    )
    doDisable = () => rerender({ enabled: false })

    await act(async () => {})
    vi.mocked(metaWhatsAppApi.startOnboarding).mockClear()

    await triggerComplete(result)
    await act(async () => {})  // flush rerender + cleanup disparado por onSuccess

    expect(result.current.step).toBe('idle')
    expect(metaWhatsAppApi.startOnboarding).not.toHaveBeenCalled()
    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
    expect(result.current.onboardingError).toBeNull()
  })

  it('TC-L01: segundo FINISH ignorado após listener removido → um único complete', async () => {
    const { result } = await renderReady()
    act(() => { result.current.triggerPopup() })
    await act(async () => { dispatchFinish() })   // listener removido
    await act(async () => { dispatchFinish() })   // ignorado — listener já removido
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })
    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
  })

  it('TC-M01: /complete falha → onboardingError + retry (retry falho mantém erro visível)', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockRejectedValue(new Error('Falha /complete'))
    vi.mocked(metaWhatsAppApi.startOnboarding)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce(makeSession() as any)
      .mockRejectedValue(new Error('Falha /start retry'))

    const { result } = await renderReady()
    await triggerComplete(result)
    expect(result.current.onboardingError).not.toBeNull()
    // 1 initial + 1 retry
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(2)
  })

  it('TC-M02: /complete falha + enabled=false → zero start novo', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockRejectedValue(new Error('Falha'))
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMetaOnboarding({ enabled }),
      { initialProps: { enabled: true } },
    )
    await act(async () => {})
    act(() => { result.current.triggerPopup() })
    await act(async () => { dispatchFinish() })

    // disabled antes do code → FB callback retorna early (stepRef ≠ popup_open)
    rerender({ enabled: false })
    vi.mocked(metaWhatsAppApi.startOnboarding).mockClear()
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })
    expect(metaWhatsAppApi.startOnboarding).not.toHaveBeenCalled()
    expect(result.current.step).toBe('idle')
  })
})

// ── 6. COMPANY CHANGE / GENERATION GUARD ─────────────────────────────────────

describe('Company change / generation guard', () => {
  it('TC-N01: company A→B durante /start A → resposta A descartada, B usa seu próprio state', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolveA!: (s: any) => void
    vi.mocked(metaWhatsAppApi.startOnboarding)
      .mockImplementationOnce(() => new Promise(r => { resolveA = r }))   // A: pendente
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(makeSession() as any)                              // B: imediato

    const { result, rerender } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})
    // /start A está pendente
    expect(result.current.step).toBe('loading_session')

    // Company muda para B
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useCompany).mockReturnValue({ company: COMPANY_B } as any)
    act(() => { rerender() })
    await act(async () => {})   // B prepara sessão e fica ready
    expect(result.current.step).toBe('ready')

    // B chamou startOnboarding com o ID correto
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenLastCalledWith(COMPANY_B.id)

    // Resposta stale de A chega
    await act(async () => { resolveA(makeSession({ state: 'stale-from-a' })) })
    // Geração antiga → descartada; step continua ready (sessão de B)
    expect(result.current.step).toBe('ready')
    expect(result.current.onboardingError).toBeNull()
  })

  it('TC-O01: company muda durante /complete → onSuccess A descartado, fluxo B intacto', async () => {
    let resolveComplete!: () => void
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => new Promise<any>(r => { resolveComplete = () => r({}) }),
    )
    vi.mocked(metaWhatsAppApi.startOnboarding)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce(makeSession() as any)   // A: sessão inicial
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(makeSession() as any)        // B: nova sessão

    const onSuccess = vi.fn()
    const { result, rerender } = renderHook(
      () => useMetaOnboarding({ enabled: true, onSuccess }),
    )
    await act(async () => {})
    act(() => { result.current.triggerPopup() })
    await act(async () => { dispatchFinish() })
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })
    // /complete de A está pendente...

    // Company muda para B antes do /complete resolver
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useCompany).mockReturnValue({ company: COMPANY_B } as any)
    act(() => { rerender() })
    await act(async () => {})   // B prepara sessão → ready
    expect(result.current.step).toBe('ready')   // B está pronto

    // /complete de A resolve
    await act(async () => { resolveComplete() })
    // generation guard: gen A ≠ gen B → onSuccess descartado
    expect(onSuccess).not.toHaveBeenCalled()
    // B não foi sobrescrito pelo /complete stale de A
    expect(result.current.step).toBe('ready')
    expect(result.current.onboardingError).toBeNull()
  })
})

// ── 7. TIMERS ────────────────────────────────────────────────────────────────

describe('Timers (fake timers)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('TIMER-P: sessão perto do threshold → renova automaticamente', async () => {
    const delay = 100
    const expiresAt = new Date(Date.now() + RENEW_MS + delay).toISOString()
    vi.mocked(metaWhatsAppApi.startOnboarding)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce(makeSession({ expires_at: expiresAt }) as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(makeSession() as any)

    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})
    expect(result.current.step).toBe('ready')

    // Timer dispara → startNewSession (segunda chamada)
    await act(async () => { vi.advanceTimersByTime(delay + 10) })
    await act(async () => {})
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(2)
    expect(result.current.step).toBe('ready')
  })

  it('TIMER-Q: popup_open → stepRef ≠ ready → timer não renova sessão', async () => {
    const delay = 100
    const expiresAt = new Date(Date.now() + RENEW_MS + delay).toISOString()
    vi.mocked(metaWhatsAppApi.startOnboarding)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(makeSession({ expires_at: expiresAt }) as any)

    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})
    expect(result.current.step).toBe('ready')

    act(() => { result.current.triggerPopup() })
    expect(result.current.step).toBe('popup_open')

    vi.mocked(metaWhatsAppApi.startOnboarding).mockClear()
    await act(async () => { vi.advanceTimersByTime(delay + 10) })
    await act(async () => {})
    // stepRef era popup_open → guard impediu renovação
    expect(metaWhatsAppApi.startOnboarding).not.toHaveBeenCalled()
    expect(result.current.step).toBe('popup_open')
  })

  it('TIMER-R: completing → tryComplete limpou timer → zero startOnboarding ao avançar tempo', async () => {
    // tryComplete chama clearExpiryTimer() antes de setStepAndRef('completing').
    // Avançar o relógio além do threshold de renovação não deve disparar startOnboarding.
    const delay = 100
    const expiresAt = new Date(Date.now() + RENEW_MS + delay).toISOString()

    let resolveComplete!: () => void
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockImplementation(
      // completeOnboarding retorna CompleteResult — usar FAKE_CONNECTED_RESULT para step=idle
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => new Promise<any>(r => { resolveComplete = () => r(FAKE_CONNECTED_RESULT) }),
    )
    vi.mocked(metaWhatsAppApi.startOnboarding)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(makeSession({ expires_at: expiresAt }) as any)

    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})
    expect(result.current.step).toBe('ready')

    // Levar para completing (completeOnboarding fica pendente)
    await triggerComplete(result)
    expect(result.current.step).toBe('completing')

    vi.mocked(metaWhatsAppApi.startOnboarding).mockClear()

    // Avançar além do threshold — timer foi limpo por tryComplete → nenhum renewal
    await act(async () => { vi.advanceTimersByTime(delay + 10) })
    await act(async () => {})
    expect(metaWhatsAppApi.startOnboarding).not.toHaveBeenCalled()
    expect(result.current.step).toBe('completing')

    // Limpar: resolver complete para evitar promise pendente no teardown
    await act(async () => { resolveComplete() })
    expect(result.current.step).toBe('idle')
  })
})

// ── 8. F3 — DISCOVERY FALLBACK (FINISH_GRACE_MS) ─────────────────────────────
// Garante o comportamento de recovery sem FINISH:
//   • code + FINISH dentro de 5s  → POST normal com waba_id (FINISH cancela o timer)
//   • code, sem FINISH, 5s+       → exatamente 1 POST sem waba_id
//   • FINISH antes do callback    → normal, sem timer agendado
//   • isCompletingRef setado pelo timer → FINISH tardio ignorado  (RACE-B)
//   • wabaId presente quando timer dispara → normal path           (RACE-A)
//   • cancelFlow / unmount        → timer cancelado, 0 POST
//   • callback sem code           → timer NÃO agendado
//   • discovery error             → sem segunda completion
//   • discovery success           → onSuccess exatamente 1x

describe('F3 — Discovery fallback (FINISH_GRACE_MS)', () => {
  const FINISH_GRACE_MS = 5_000   // deve espelhar o internal FINISH_GRACE_MS do hook

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  // ── F3-T1: code + FINISH dentro de 5s → POST normal com waba_id ────────────
  it('F3-T1: code chega + FINISH antes de 5s → 1 POST normal com waba_id, timer cancelado', async () => {
    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})
    expect(result.current.step).toBe('ready')

    act(() => { result.current.triggerPopup() })

    // Code chega → tryComplete (wabaId ausente → early return) → timer agendado
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()

    // FINISH chega antes de 5s → clearRecoveryTimer + tryComplete normal
    await act(async () => { vi.advanceTimersByTime(FINISH_GRACE_MS - 1_000) })
    await act(async () => { dispatchFinish() })
    await act(async () => {})

    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = vi.mocked(metaWhatsAppApi.completeOnboarding).mock.calls[0][0] as any
    expect(payload.waba_id).toBe(FAKE_WABA_ID)
    expect(payload).toHaveProperty('waba_id')

    // Avançar além do timer original — timer foi cancelado → 0 POST adicional
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
  })

  // ── F3-T2: code sem FINISH → antes: 0 POST; após 5s: 1 POST sem waba_id ───
  it('F3-T2: code sem FINISH — antes de 5s: 0 POST; após 5s: 1 POST discovery sem waba_id', async () => {
    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})
    expect(result.current.step).toBe('ready')

    act(() => { result.current.triggerPopup() })
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })

    // Antes do timeout: zero POSTs
    await act(async () => { vi.advanceTimersByTime(FINISH_GRACE_MS - 1) })
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()

    // Após timeout: exatamente 1 POST sem waba_id
    await act(async () => { vi.advanceTimersByTime(2) })
    await act(async () => {})

    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = vi.mocked(metaWhatsAppApi.completeOnboarding).mock.calls[0][0] as any
    expect(payload).not.toHaveProperty('waba_id')
    expect(payload).not.toHaveProperty('phone_number_id')
    expect(payload.code).toBe(FAKE_CODE)
    expect(typeof payload.state).toBe('string')
  })

  // ── F3-T3: FINISH durante grace period → timer cancelado → POST normal ─────
  it('F3-T3: FINISH chega durante grace period → clearRecoveryTimer + POST normal', async () => {
    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})

    act(() => { result.current.triggerPopup() })
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })

    // Dentro da janela (t=2000 < 5000)
    await act(async () => { vi.advanceTimersByTime(2_000) })
    await act(async () => { dispatchFinish() })
    await act(async () => {})

    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = vi.mocked(metaWhatsAppApi.completeOnboarding).mock.calls[0][0] as any
    expect(payload.waba_id).toBe(FAKE_WABA_ID)

    // Timer foi cancelado — avançar além do ponto original → 0 POST adicional
    await act(async () => { vi.advanceTimersByTime(FINISH_GRACE_MS) })
    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
  })

  // ── F3-T4 (RACE-B): timer dispara → isCompletingRef=true → FINISH tardio ignorado ─
  it('F3-T4 (RACE-B): timer dispara primeiro → discovery POST → FINISH tardio → exatamente 1 POST', async () => {
    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})

    act(() => { result.current.triggerPopup() })
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })

    // Timer dispara → tryComplete(allowDiscovery) → isCompletingRef=true → POST discovery
    await act(async () => { vi.advanceTimersByTime(FINISH_GRACE_MS + 1) })
    await act(async () => {})

    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const discoveryPayload = vi.mocked(metaWhatsAppApi.completeOnboarding).mock.calls[0][0] as any
    expect(discoveryPayload).not.toHaveProperty('waba_id')

    // FINISH tardio — listener já removido por tryComplete → ignorado
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockClear()
    await act(async () => { dispatchFinish() })
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()   // RACE-B provado

    expect(result.current.step).toBe('idle')   // discovery POST resolveu
  })

  // ── RACE-A: FINISH durante grace period → normal path toma precedência ─────
  // RACE-A: timer agendado, FINISH chega durante a janela.
  // clearRecoveryTimer() no FINISH handler cancela o timer.
  // POST usa caminho normal com waba_id — normal sempre preferível quando wabaId disponível.
  it('F3-RACE-A: FINISH durante grace period → clearRecoveryTimer + POST normal com waba_id', async () => {
    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})

    act(() => { result.current.triggerPopup() })
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })

    // Avançar parcialmente (dentro da janela)
    await act(async () => { vi.advanceTimersByTime(FINISH_GRACE_MS - 500) })

    // FINISH chega → clearRecoveryTimer → tryComplete normal com waba_id
    await act(async () => { dispatchFinish() })
    await act(async () => {})

    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = vi.mocked(metaWhatsAppApi.completeOnboarding).mock.calls[0][0] as any
    expect(payload.waba_id).toBe(FAKE_WABA_ID)   // RACE-A: normal path, não discovery

    // Timer foi cancelado — 0 POSTs adicionais
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
  })

  // ── F3-T5: generation muda (cancelFlow) → timer cancelado → 0 POST ─────────
  it('F3-T5: cancelFlow durante grace period → clearRecoveryTimer → 0 POST', async () => {
    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})

    act(() => { result.current.triggerPopup() })
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })

    // cancelFlow: gen++, clearRecoveryTimer
    await act(async () => { result.current.cancelFlow() })

    // Avançar além de FINISH_GRACE_MS — timer foi cancelado
    await act(async () => { vi.advanceTimersByTime(FINISH_GRACE_MS + 1) })
    await act(async () => {})
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
  })

  // ── F3-T6: unmount com timer pendente → cleanup cancela timer → 0 POST ──────
  it('F3-T6: unmount com timer pendente → clearRecoveryTimer no cleanup → 0 POST', async () => {
    const { result, unmount } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})
    expect(result.current.step).toBe('ready')

    act(() => { result.current.triggerPopup() })
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })

    // Timer agendado (5000ms). Unmount → cleanup: gen++, clearRecoveryTimer
    unmount()

    // Timer foi cancelado pelo cleanup → 0 POST
    await act(async () => { vi.advanceTimersByTime(FINISH_GRACE_MS + 1) })
    await act(async () => {})
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
  })

  // ── F3-T7: unmount direto com timer pendente → 0 POST ─────────────────────
  it('F3-T7: unmount com timer pendente → clearRecoveryTimer → 0 POST', async () => {
    const { result, unmount } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})

    act(() => { result.current.triggerPopup() })
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })

    // Unmount → cleanup do useEffect cancela o timer
    unmount()

    await act(async () => { vi.advanceTimersByTime(FINISH_GRACE_MS + 1) })
    await act(async () => {})
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
  })

  // ── F3-T8: callback sem code → timer NÃO agendado → 0 POST após 5s ─────────
  it('F3-T8: callback sem code → clearRecoveryTimer defensivo, timer NÃO agendado', async () => {
    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})

    act(() => { result.current.triggerPopup() })

    // Callback sem code — o fallback não deve ser agendado
    await act(async () => { capturedLoginCb?.({ authResponse: null }) })

    // Avançar além de FINISH_GRACE_MS — nenhum timer para disparar
    await act(async () => { vi.advanceTimersByTime(FINISH_GRACE_MS + 1) })
    await act(async () => {})
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
    expect(result.current.step).not.toBe('completing')
  })

  // ── F3-T9: FINISH antes do callback → caminho normal, sem timer agendado ───
  it('F3-T9: FINISH antes do callback → normal, isCompletingRef=true impede fallback', async () => {
    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})

    act(() => { result.current.triggerPopup() })

    // FINISH primeiro — code ainda não chegou → tryComplete retorna early
    await act(async () => { dispatchFinish() })
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()

    // Code chega → tryComplete: code + wabaId presentes → normal path → 1 POST
    // isCompletingRef=true → condição de fallback não satisfeita → timer NÃO agendado
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })
    await act(async () => {})

    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = vi.mocked(metaWhatsAppApi.completeOnboarding).mock.calls[0][0] as any
    expect(payload.waba_id).toBe(FAKE_WABA_ID)

    // Avançar além de FINISH_GRACE_MS — timer nunca foi agendado → 0 POST adicional
    await act(async () => { vi.advanceTimersByTime(FINISH_GRACE_MS + 1) })
    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
  })

  // ── F3-T10: discovery error → onboardingError, sem segunda completion ────────
  it('F3-T10: backend discovery retorna erro → completeOnboarding 1x, sem segunda completion automática', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockRejectedValue(new Error('no_waba_authorized'))
    vi.mocked(metaWhatsAppApi.startOnboarding)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce(makeSession() as any)    // sessão inicial
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(makeSession() as any)        // retry após erro

    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})

    act(() => { result.current.triggerPopup() })
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })

    // Timer dispara → discovery POST → falha
    await act(async () => { vi.advanceTimersByTime(FINISH_GRACE_MS + 1) })
    await act(async () => {})

    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)

    // Sem segunda completion automática
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockClear()
    await act(async () => { vi.advanceTimersByTime(FINISH_GRACE_MS + 1) })
    await act(async () => {})
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
  })

  // ── F3-T11: discovery success → onSuccess exatamente 1x, step idle ──────────
  it('F3-T11: discovery success → completeOnboarding 1x, onSuccess 1x, step idle', async () => {
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useMetaOnboarding({ enabled: true, onSuccess }))
    await act(async () => {})

    act(() => { result.current.triggerPopup() })
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })

    // Timer dispara → discovery POST → sucesso (mock padrão resolve com {})
    await act(async () => { vi.advanceTimersByTime(FINISH_GRACE_MS + 1) })
    await act(async () => {})

    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(result.current.step).toBe('idle')
  })

  // ── F3-T12 (RACE-B confirmação): timer → isCompletingRef → FINISH bloqueado ─
  it('F3-T12 (RACE-B): discovery adquiriu lock → FINISH tardio NÃO gera segundo POST', async () => {
    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})

    act(() => { result.current.triggerPopup() })
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })

    // Timer dispara → tryComplete({allowDiscovery:true}) → isCompletingRef=true → POST discovery
    await act(async () => { vi.advanceTimersByTime(FINISH_GRACE_MS + 1) })
    await act(async () => {})

    const postCount = vi.mocked(metaWhatsAppApi.completeOnboarding).mock.calls.length
    expect(postCount).toBe(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dPayload = vi.mocked(metaWhatsAppApi.completeOnboarding).mock.calls[0][0] as any
    expect(dPayload).not.toHaveProperty('waba_id')   // é discovery

    // FINISH tardio — listener já removido por tryComplete → ignorado
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockClear()
    await act(async () => { dispatchFinish() })
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()   // RACE-B confirmado

    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(0) // ainda exatamente 1 total
  })
})

// ── 10. STRICTMODE ───────────────────────────────────────────────────────────

describe('StrictMode', () => {
  it('TC-S01: timer da tentativa descartada (gen=0) não renova sessão — stale proof', async () => {
    // StrictMode: mount → cleanup (gen=0→1) → remount (gen=1).
    // startNewSession(0): gen check falha ANTES de definir o timer → timer nunca é criado.
    // startNewSession(1): gen check passa → define o timer da renovação.
    // Prova observável: somente 1 renewal dispara (não 2).
    //
    // ATENÇÃO: o mock de renewal usa makeSession() (expiry 10min) para evitar loop infinito.
    // Se o renewal receber a mesma sessão expirada (delay <= 0), startNewSession é chamado
    // imediatamente de novo → loop → OOM. O renewal deve ter expiry longo.
    vi.useFakeTimers()
    try {
      const delay = 100
      const expiresAt = new Date(Date.now() + RENEW_MS + delay).toISOString()
      // StrictMode chama startOnboarding 2x (gen=0 e gen=1); renewal usa makeSession() (10min).
      vi.mocked(metaWhatsAppApi.startOnboarding)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValueOnce(makeSession({ expires_at: expiresAt }) as any)  // gen=0 (descartado)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValueOnce(makeSession({ expires_at: expiresAt }) as any)  // gen=1 (timer 100ms)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValue(makeSession() as any)                               // renewal (10min, sem loop)

      const { result } = renderHook(
        () => useMetaOnboarding({ enabled: true }),
        { wrapper: React.StrictMode },
      )
      await act(async () => {})
      expect(result.current.step).toBe('ready')

      vi.mocked(metaWhatsAppApi.startOnboarding).mockClear()

      // Timer dispara — somente o timer de gen=1 existe; gen=0 foi descartado antes de criar timer
      await act(async () => { vi.advanceTimersByTime(delay + 10) })
      await act(async () => {})

      // Exatamente 1 renewal (gen=1's timer). Se fosse 2, gen=0 também teria criado timer.
      expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(1)
      expect(result.current.step).toBe('ready')
    } finally {
      vi.useRealTimers()
    }
  })
})

// ── 9. FB.login CONTRACT — options passados ao SDK ───────────────────────────
// Garante que os options de FB.login sigam o contrato estável.
// Evita regressão de parâmetros extras que alterem o comportamento do SDK Meta
// (ex: `feature: 'whatsapp_embedded_signup'` ativa enforcement que bloqueia o flow).
describe('FB.login contract — options', () => {
  it('FB-OPT-01: triggerPopup passa featureType vazio e NÃO passa a propriedade `feature`', async () => {
    let capturedOptions: unknown

    // Substituir o mock padrão por um que também captura o segundo argumento.
    // O beforeEach já colocou window.FB — apenas sobrescreve login para este teste.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).FB.login = vi.fn((cb: (r: unknown) => void, opts: unknown) => {
      capturedLoginCb = cb
      capturedOptions = opts
    })

    const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})

    act(() => { result.current.triggerPopup() })
    await act(async () => {})

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).FB.login).toHaveBeenCalledTimes(1)

    const opts = capturedOptions as Record<string, unknown>
    expect(opts.config_id).toBe(FAKE_CONFIG_ID)
    expect(opts.response_type).toBe('code')
    expect(opts.override_default_response_type).toBe(true)

    const extras = opts.extras as Record<string, unknown>
    expect(extras.setup).toEqual({})
    expect(extras.featureType).toBe('')
    expect(extras.sessionInfoVersion).toBe('3')

    // REGRESSÃO GUARD: `feature` NÃO deve estar presente nos extras.
    // Se presente, o Meta SDK pode rejeitar o flow sem status BSP/TP.
    expect('feature' in extras).toBe(false)
  })

  // ── FB-OPT-02: log de shape do authResponse — somente keys, nunca valores ──
  // Garante que a instrumentação diagnóstica [meta-auth-response-shape] emite
  // apenas os NOMES das propriedades de authResponse — nunca valores sensíveis.
  it('FB-OPT-02: [meta-auth-response-shape] loga somente keys do authResponse, nunca valores', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    try {
      const { result } = renderHook(() => useMetaOnboarding({ enabled: true }))
      await act(async () => {})

      // Simular callback com authResponse que contém campos potencialmente sensíveis
      act(() => { result.current.triggerPopup() })
      await act(async () => {})

      // Fornecer authResponse fictício com campos sensíveis misturados com campos extras
      // que o FB SDK real poderia incluir (sessionInfo, grantedScopes, etc.)
      const fakeAuthResponse = {
        code:          'SECRET_CODE',
        sessionInfo:   { waba_id: 'SECRET_WABA', phone_number_id: 'SECRET_PHONE' },
        grantedScopes: 'SECRET_SCOPE',
        userID:        'SECRET_USER',
      }
      act(() => { capturedLoginCb?.({ status: 'connected', authResponse: fakeAuthResponse }) })
      await act(async () => {})

      // Localizar a chamada com prefixo [meta-auth-response-shape]
      const shapeCall = infoSpy.mock.calls.find(
        (args) => args[0] === '[meta-auth-response-shape]'
      )
      expect(shapeCall).toBeDefined()

      const payload = shapeCall![1] as { keys: string[] }

      // Verificar estrutura: somente { keys: string[] }
      expect(Object.keys(payload)).toEqual(['keys'])
      expect(Array.isArray(payload.keys)).toBe(true)

      // Verificar que as keys esperadas estão presentes (authResponse tinha 4 campos)
      expect(payload.keys).toContain('code')
      expect(payload.keys).toContain('sessionInfo')
      expect(payload.keys).toContain('grantedScopes')
      expect(payload.keys).toContain('userID')
      expect(payload.keys).toHaveLength(4)

      // Verificar que NENHUM VALOR sensível aparece na representação serializada do log
      const serialized = JSON.stringify(infoSpy.mock.calls)
      expect(serialized).not.toContain('SECRET_CODE')
      expect(serialized).not.toContain('SECRET_WABA')
      expect(serialized).not.toContain('SECRET_PHONE')
      expect(serialized).not.toContain('SECRET_SCOPE')
      expect(serialized).not.toContain('SECRET_USER')
    } finally {
      infoSpy.mockRestore()
    }
  })
})

// =============================================================================
// S7 — Seleção de WABA (múltiplos WABAs acessíveis)
// =============================================================================

describe('S7 — WABA selection flow', () => {

  // ── H1: connected preservado ─────────────────────────────────────────────
  it('H1: completeOnboarding connected → step idle + onSuccess 1x (fluxo existente preservado)', async () => {
    const onSuccess = vi.fn()
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_CONNECTED_RESULT as never)
    const { result } = await renderReady({ onSuccess })

    await triggerComplete(result)
    await act(async () => {})

    expect(result.current.step).toBe('idle')
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(result.current.selectionOptions).toBeNull()
  })

  // ── H2: selection → awaiting_selection ───────────────────────────────────
  it('H2: completeOnboarding selection → step awaiting_selection com opções', async () => {
    const onSuccess = vi.fn()
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
    const { result } = await renderReady({ onSuccess })

    await triggerComplete(result)
    await act(async () => {})

    expect(result.current.step).toBe('awaiting_selection')
    expect(result.current.selectionOptions).toEqual(FAKE_SELECTION_OPTIONS)
  })

  // ── H3: awaiting_selection NÃO chama onSuccess ───────────────────────────
  it('H3: awaiting_selection NÃO chama onSuccess', async () => {
    const onSuccess = vi.fn()
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
    const { result } = await renderReady({ onSuccess })

    await triggerComplete(result)
    await act(async () => {})

    expect(result.current.step).toBe('awaiting_selection')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  // ── H4: seleção válida → resolving_selection ─────────────────────────────
  it('H4: selectWaba com index válido → step resolving_selection (antes da resposta)', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
    // Suspender resolve para capturar o estado intermediate
    let resolveFn!: () => void
    vi.mocked(metaWhatsAppApi.resolveWabaSelection).mockReturnValueOnce(
      new Promise((resolve) => { resolveFn = () => resolve(FAKE_INSTANCE as never) }),
    )
    const { result } = await renderReady()
    await triggerComplete(result)
    await act(async () => {})
    expect(result.current.step).toBe('awaiting_selection')

    act(() => { result.current.selectWaba(FAKE_SELECTION_OPTIONS[0].index) })
    expect(result.current.step).toBe('resolving_selection')

    // cleanup
    await act(async () => { resolveFn() })
  })

  // ── H5: sucesso → onSuccess exatamente 1x ────────────────────────────────
  it('H5: selectWaba sucesso → step idle + onSuccess exatamente 1x + selectionOptions null', async () => {
    const onSuccess = vi.fn()
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
    vi.mocked(metaWhatsAppApi.resolveWabaSelection).mockResolvedValueOnce(FAKE_INSTANCE as never)
    const { result } = await renderReady({ onSuccess })

    await triggerComplete(result)
    await act(async () => {})
    act(() => { result.current.selectWaba(FAKE_SELECTION_OPTIONS[0].index) })
    await act(async () => {})

    expect(result.current.step).toBe('idle')
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(result.current.selectionOptions).toBeNull()
  })

  // ── H6: double click → exatamente 1 POST ─────────────────────────────────
  it('H6: dois clicks rápidos em selectWaba → exatamente 1 POST resolveWabaSelection', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
    let resolveFn!: () => void
    vi.mocked(metaWhatsAppApi.resolveWabaSelection).mockReturnValueOnce(
      new Promise((resolve) => { resolveFn = () => resolve(FAKE_INSTANCE as never) }),
    )
    const { result } = await renderReady()
    await triggerComplete(result)
    await act(async () => {})

    // Dois clicks síncronos
    act(() => {
      result.current.selectWaba(FAKE_SELECTION_OPTIONS[0].index)
      result.current.selectWaba(FAKE_SELECTION_OPTIONS[0].index)
    })

    expect(vi.mocked(metaWhatsAppApi.resolveWabaSelection)).toHaveBeenCalledTimes(1)
    // cleanup
    await act(async () => { resolveFn() })
  })

  // ── H7: index inexistente → zero request ─────────────────────────────────
  it('H7: selectWaba com index inexistente nas opções → nenhum POST', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
    const { result } = await renderReady()
    await triggerComplete(result)
    await act(async () => {})

    act(() => { result.current.selectWaba(999) })
    await act(async () => {})

    expect(vi.mocked(metaWhatsAppApi.resolveWabaSelection)).not.toHaveBeenCalled()
    expect(result.current.step).toBe('awaiting_selection')
  })

  // ── H8: cancel limpa token/options ───────────────────────────────────────
  it('H8: cancelFlow em awaiting_selection limpa token e options', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
    const { result } = await renderReady()
    await triggerComplete(result)
    await act(async () => {})
    expect(result.current.selectionOptions).toEqual(FAKE_SELECTION_OPTIONS)

    act(() => { result.current.cancelFlow() })
    await act(async () => {})

    expect(result.current.selectionOptions).toBeNull()
    // step deve ter saído de awaiting_selection
    expect(result.current.step).not.toBe('awaiting_selection')
  })

  // ── H9: unmount limpa ────────────────────────────────────────────────────
  it('H9: unmount em awaiting_selection limpa refs (sem crash)', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
    const { result, unmount } = await renderReady()
    await triggerComplete(result)
    await act(async () => {})
    expect(result.current.step).toBe('awaiting_selection')

    // Unmount não deve lançar
    expect(() => { act(() => { unmount() }) }).not.toThrow()
  })

  // ── H10: company change limpa ─────────────────────────────────────────────
  it('H10: company change em awaiting_selection limpa selectionOptions', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValue(FAKE_CONNECTED_RESULT as any)
    const { result, rerender } = await renderReady()
    await triggerComplete(result)
    await act(async () => {})
    expect(result.current.step).toBe('awaiting_selection')

    // Trocar company
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useCompany).mockReturnValue({ company: COMPANY_B } as any)
    rerender()
    await act(async () => {})

    expect(result.current.selectionOptions).toBeNull()
  })

  // ── H11: invalid_continuation → sem retry automático ─────────────────────
  it('H11: resolveWabaSelection → invalid_continuation → idle + erro + SEM startNewSession', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
    vi.mocked(metaWhatsAppApi.resolveWabaSelection).mockRejectedValueOnce(
      new Error('invalid_continuation'),
    )
    const { result } = await renderReady()
    await triggerComplete(result)
    await act(async () => {})

    act(() => { result.current.selectWaba(FAKE_SELECTION_OPTIONS[0].index) })
    await act(async () => {})

    expect(result.current.step).toBe('idle')
    expect(result.current.onboardingError).toContain('Seleção expirada')
    // startOnboarding NÃO deve ter sido chamado novamente (apenas 1 vez no mount)
    expect(vi.mocked(metaWhatsAppApi.startOnboarding)).toHaveBeenCalledTimes(1)
  })

  // ── H12: 403 → sem retry automático ──────────────────────────────────────
  it('H12: resolveWabaSelection → forbidden → idle + erro seguro + SEM startNewSession', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
    vi.mocked(metaWhatsAppApi.resolveWabaSelection).mockRejectedValueOnce(
      new Error('forbidden'),
    )
    const { result } = await renderReady()
    await triggerComplete(result)
    await act(async () => {})

    act(() => { result.current.selectWaba(FAKE_SELECTION_OPTIONS[0].index) })
    await act(async () => {})

    expect(result.current.step).toBe('idle')
    expect(result.current.onboardingError).toBeTruthy()
    expect(vi.mocked(metaWhatsAppApi.startOnboarding)).toHaveBeenCalledTimes(1)
  })

  // ── H13: 500 → sem retry automático ──────────────────────────────────────
  it('H13: resolveWabaSelection → internal_error → idle + erro seguro + SEM startNewSession', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
    vi.mocked(metaWhatsAppApi.resolveWabaSelection).mockRejectedValueOnce(
      new Error('internal_error'),
    )
    const { result } = await renderReady()
    await triggerComplete(result)
    await act(async () => {})

    act(() => { result.current.selectWaba(FAKE_SELECTION_OPTIONS[0].index) })
    await act(async () => {})

    expect(result.current.step).toBe('idle')
    expect(result.current.onboardingError).toContain('Erro interno')
    expect(vi.mocked(metaWhatsAppApi.startOnboarding)).toHaveBeenCalledTimes(1)
  })

  // ── H14: network error → sem retry automático ─────────────────────────────
  it('H14: resolveWabaSelection → erro de rede → idle + erro seguro + SEM startNewSession', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
    vi.mocked(metaWhatsAppApi.resolveWabaSelection).mockRejectedValueOnce(
      new Error('Failed to fetch'),
    )
    const { result } = await renderReady()
    await triggerComplete(result)
    await act(async () => {})

    act(() => { result.current.selectWaba(FAKE_SELECTION_OPTIONS[0].index) })
    await act(async () => {})

    expect(result.current.step).toBe('idle')
    expect(result.current.onboardingError).toBeTruthy()
    expect(vi.mocked(metaWhatsAppApi.startOnboarding)).toHaveBeenCalledTimes(1)
  })

  // ── H15: 409 → NÃO onSuccess e sem retry ─────────────────────────────────
  it('H15: resolveWabaSelection → phone_number_already_connected → NÃO onSuccess + SEM retry', async () => {
    const onSuccess = vi.fn()
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
    vi.mocked(metaWhatsAppApi.resolveWabaSelection).mockRejectedValueOnce(
      new Error('phone_number_already_connected'),
    )
    const { result } = await renderReady({ onSuccess })
    await triggerComplete(result)
    await act(async () => {})

    act(() => { result.current.selectWaba(FAKE_SELECTION_OPTIONS[0].index) })
    await act(async () => {})

    expect(result.current.step).toBe('idle')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(result.current.onboardingError).toContain('já está conectado')
    expect(vi.mocked(metaWhatsAppApi.startOnboarding)).toHaveBeenCalledTimes(1)
  })

  // ── H16: F3 preservado ────────────────────────────────────────────────────
  it('H16: discovery fallback (F3) preservado — sem wabaId → scheduleDiscoveryFallback', async () => {
    vi.useFakeTimers()
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValue(FAKE_CONNECTED_RESULT as never)
    const onSuccess = vi.fn()
    const { result } = await renderReady({ onSuccess })

    act(() => { result.current.triggerPopup() })
    // Somente code, sem FINISH
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })

    // Avançar FINISH_GRACE_MS para disparar o fallback
    await act(async () => { vi.advanceTimersByTime(5_100) })
    await act(async () => {})

    expect(result.current.step).toBe('idle')
    expect(onSuccess).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  // ── H17: FINISH normal preservado ────────────────────────────────────────
  it('H17: FINISH normal → completeOnboarding connected → idle + onSuccess 1x', async () => {
    const onSuccess = vi.fn()
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_CONNECTED_RESULT as never)
    const { result } = await renderReady({ onSuccess })

    await triggerComplete(result)
    await act(async () => {})

    expect(result.current.step).toBe('idle')
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(vi.mocked(metaWhatsAppApi.completeOnboarding)).toHaveBeenCalledTimes(1)
  })

  // ── H18: token nunca em console ──────────────────────────────────────────
  it('H18: continuation_token nunca aparece nos logs de console', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const logSpy   = vi.spyOn(console, 'log').mockImplementation(() => {})
    const infoSpy  = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warnSpy  = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errSpy   = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
      vi.mocked(metaWhatsAppApi.resolveWabaSelection).mockResolvedValueOnce(FAKE_INSTANCE as never)
      const { result } = await renderReady()
      await triggerComplete(result)
      await act(async () => {})
      act(() => { result.current.selectWaba(FAKE_SELECTION_OPTIONS[0].index) })
      await act(async () => {})

      const allCalls = [
        ...debugSpy.mock.calls,
        ...logSpy.mock.calls,
        ...infoSpy.mock.calls,
        ...warnSpy.mock.calls,
        ...errSpy.mock.calls,
      ]
      const serialized = JSON.stringify(allCalls)
      expect(serialized).not.toContain(FAKE_CONTINUATION_TOKEN)
    } finally {
      debugSpy.mockRestore()
      logSpy.mockRestore()
      infoSpy.mockRestore()
      warnSpy.mockRestore()
      errSpy.mockRestore()
    }
  })

  // ── H19: selectWaba usa option.index real, não posição no array ───────────
  it('H19: selectWaba envia option.index real como selected_index (não posição no array)', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValueOnce(FAKE_SELECTION_RESULT as never)
    vi.mocked(metaWhatsAppApi.resolveWabaSelection).mockResolvedValueOnce(FAKE_INSTANCE as never)
    const { result } = await renderReady()
    await triggerComplete(result)
    await act(async () => {})

    // Clicar no segundo elemento (posição 1 no array, mas option.index = 7)
    const secondOption = FAKE_SELECTION_OPTIONS[1]
    act(() => { result.current.selectWaba(secondOption.index) })
    await act(async () => {})

    expect(vi.mocked(metaWhatsAppApi.resolveWabaSelection)).toHaveBeenCalledWith(
      FAKE_CONTINUATION_TOKEN,
      7,   // option.index real — não a posição 1
    )
  })
})

// =============================================================================
// S7.5 — Diagnósticos de FINISH event (observabilidade apenas)
// =============================================================================
// Estes testes cobrem os blocos de diagnóstico temporário:
//   [meta-finish-diag]      — payload object (existente — verificar preservação)
//   [meta-finish-diag-str]  — payload JSON string (R2)
//   [meta-finish-diag-late] — FINISH após F3 adquirir lock (R4)
//
// NENHUM destes testes verifica chamadas a completeOnboarding por vias novas.
// O comportamento FUNCIONAL permanece idêntico ao descrito nos testes anteriores.
// =============================================================================

describe('S7.5 — Diagnósticos de FINISH (observabilidade)', () => {
  // Espelha as constantes internas do hook
  const FINISH_GRACE_MS = 5_000
  const LATE_DIAG_MS    = 10_000

  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.useFakeTimers()
  })

  afterEach(() => {
    logSpy.mockRestore()
    vi.useRealTimers()
  })

  // Helper: monta hook + abre popup
  async function setupWithPopup() {
    const hookResult = renderHook(() => useMetaOnboarding({ enabled: true }))
    await act(async () => {})
    act(() => { hookResult.result.current.triggerPopup() })
    await act(async () => {})
    return hookResult
  }

  // Helper: envia code sem wabaId (→ scheduleDiscoveryFallback) e dispara F3.
  // Usa dois avanços separados (padrão dos testes F3 existentes que passam).
  async function sendCodeAndFireF3() {
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })
    // Dois avanços separados → padrão correto para vitest fake timers + act
    await act(async () => { vi.advanceTimersByTime(FINISH_GRACE_MS - 1) })
    await act(async () => { vi.advanceTimersByTime(2) })   // dispara F3 → installLateDiagListener
    await act(async () => {})                               // flush completeOnboarding
  }

  // ── D1: diagnóstico object preservado ──────────────────────────────────────
  it('D1: FINISH como object → [meta-finish-diag] logado (comportamento preservado)', async () => {
    await setupWithPopup()

    // Listener funcional ativo — dispatchar FINISH direto (sem act: só console.log)
    dispatchWaMsg({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: FAKE_WABA_ID } })

    const diagCall = logSpy.mock.calls.find(args => args[0] === '[meta-finish-diag]')
    expect(diagCall).toBeDefined()
    const payload = diagCall![1] as Record<string, unknown>
    expect(payload.origin).toBe('https://www.facebook.com')
    expect(payload.type).toBe('WA_EMBEDDED_SIGNUP')
    expect(payload.event).toBe('FINISH')
    // Somente estes 3 campos — nenhum conteúdo de data
    expect(Object.keys(payload).sort()).toEqual(['event', 'origin', 'type'])
  })

  // ── D2: JSON string WA_EMBEDDED_SIGNUP → [meta-finish-diag-str] ───────────
  it('D2: FINISH como JSON string → [meta-finish-diag-str] logado, completeOnboarding NÃO chamado', async () => {
    await setupWithPopup()

    const strPayload = JSON.stringify({
      type:  'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data:  { waba_id: FAKE_WABA_ID, phone_number_id: FAKE_PHONE_ID },
    })

    // Dispatch com data como string — NÃO processado pelo parser funcional
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://www.facebook.com',
      data:   strPayload,
    }))

    // [meta-finish-diag-str] deve aparecer
    const strDiagCall = logSpy.mock.calls.find(args => args[0] === '[meta-finish-diag-str]')
    expect(strDiagCall).toBeDefined()
    const strPayloadLogged = strDiagCall![1] as Record<string, unknown>
    expect(strPayloadLogged.origin).toBe('https://www.facebook.com')
    expect(strPayloadLogged.type).toBe('WA_EMBEDDED_SIGNUP')
    expect(strPayloadLogged.event).toBe('FINISH')
    expect(Object.keys(strPayloadLogged).sort()).toEqual(['event', 'origin', 'type'])

    // completeOnboarding NÃO chamado — parser funcional não processa string
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
  })

  // ── D3: JSON string inválido → sem throw, sem log de conteúdo ──────────────
  it('D3: string inválida (não JSON) → não lança, não loga conteúdo', async () => {
    await setupWithPopup()

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://www.facebook.com',
      data:   '{ broken json {{{}',
    }))

    // Nenhum log de diagnóstico WA deve aparecer
    const anyWaDiag = logSpy.mock.calls.find(
      args => typeof args[0] === 'string' && (args[0] as string).startsWith('[meta-finish-diag')
    )
    expect(anyWaDiag).toBeUndefined()
    // Nenhuma exceção (vitest captura throws não tratados)
  })

  // ── D4: string com IDs → log nunca contém IDs ─────────────────────────────
  it('D4: JSON string WA com IDs sensíveis → log [meta-finish-diag-str] não contém IDs', async () => {
    const sensitiveWabaId  = '999888777000111'
    const sensitivePhoneId = '111000777888999'

    await setupWithPopup()

    const strPayload = JSON.stringify({
      type:  'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data:  { waba_id: sensitiveWabaId, phone_number_id: sensitivePhoneId },
    })

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://www.facebook.com',
      data:   strPayload,
    }))

    const serialized = JSON.stringify(logSpy.mock.calls)
    expect(serialized).not.toContain(sensitiveWabaId)
    expect(serialized).not.toContain(sensitivePhoneId)
  })

  // ── D5: FINISH após F3 → [meta-finish-diag-late] logado, sem segundo POST ──
  it('D5: FINISH chega após F3 adquirir lock → [meta-finish-diag-late] logado, zero segundo complete', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValue(FAKE_CONNECTED_RESULT)
    // Capturar unmount para garantir cleanup explícito dentro do contexto do teste
    // (evitar que listener residual interfira nos testes seguintes)
    const { unmount } = await setupWithPopup()
    await sendCodeAndFireF3()

    // F3 completou — zerar contagem para detectar apenas chamadas tardias
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockClear()

    // FINISH tardio: listener funcional já removido pelo F3, late listener ativo
    dispatchWaMsg({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: FAKE_WABA_ID } })

    // [meta-finish-diag-late] deve ter sido logado
    const lateCall = logSpy.mock.calls.find(args => args[0] === '[meta-finish-diag-late]')
    expect(lateCall).toBeDefined()
    const latePayload = lateCall![1] as Record<string, unknown>
    expect(latePayload.origin).toBe('https://www.facebook.com')
    expect(latePayload.payloadType).toBe('object')
    expect(latePayload.type).toBe('WA_EMBEDDED_SIGNUP')
    expect(latePayload.event).toBe('FINISH')

    // Nenhum segundo completeOnboarding
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()

    // Cleanup explícito dentro do contexto do teste (fake timers ainda ativos).
    // await act(async () => {}) após unmount() força o flush das passive effects
    // diferidas do React 18 (useEffect cleanup), garantindo que
    // removeLateDiagListener() já rodou antes de D6 começar.
    unmount()
    await act(async () => {})
  })

  // ── D6: listener tardio desativado em unmount ─────────────────────────────
  // Verifica que unmount → cleanup → removeLateDiagListener define active=false,
  // bloqueando o log mesmo que o removeEventListener não seja síncrono em JSDOM.
  it('D6: unmount durante janela diagnóstica tardia → active=false, sem log após unmount', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValue(FAKE_CONNECTED_RESULT)
    const { unmount } = await setupWithPopup()
    await sendCodeAndFireF3()

    // Unmount → cleanup → lateDiagActiveRef.current = false.
    // await act(async () => {}) força flush das passive effects do React 18
    // para que removeLateDiagListener() rode antes do dispatch abaixo.
    unmount()
    await act(async () => {})
    logSpy.mockClear()

    // Dispatch síncrono — não precisa de act (só console.log, sem state React)
    dispatchWaMsg({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: FAKE_WABA_ID } })

    const lateCall = logSpy.mock.calls.find(args => args[0] === '[meta-finish-diag-late]')
    expect(lateCall).toBeUndefined()
  })

  // ── D7: listener tardio desativado em company change ─────────────────────
  it('D7: company change durante janela → active=false, sem log tardio', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValue(FAKE_CONNECTED_RESULT)
    const { rerender } = await setupWithPopup()
    await sendCodeAndFireF3()

    // Company change → dep change → cleanup → lateDiagActiveRef.current = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useCompany).mockReturnValue({ company: COMPANY_B } as any)
    rerender()
    await act(async () => {})   // flush cleanup + novo effect
    logSpy.mockClear()

    // Dispatch síncrono — active=false bloqueia o log
    dispatchWaMsg({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: FAKE_WABA_ID } })

    const lateCall = logSpy.mock.calls.find(args => args[0] === '[meta-finish-diag-late]')
    expect(lateCall).toBeUndefined()
  })

  // ── D8: listener tardio desativado após LATE_DIAG_MS ─────────────────────
  // Dois avanços separados espelham o padrão dos testes F3 existentes.
  it('D8: janela LATE_DIAG_MS expirada → active=false, sem log tardio', async () => {
    vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValue(FAKE_CONNECTED_RESULT)
    const { unmount } = await setupWithPopup()
    await sendCodeAndFireF3()

    // Avançar além da janela — timer auto-remove dispara → active=false
    await act(async () => { vi.advanceTimersByTime(LATE_DIAG_MS - 1) })
    await act(async () => { vi.advanceTimersByTime(2) })   // dispara timer de auto-remoção
    await act(async () => {})
    logSpy.mockClear()

    // Dispatch síncrono — active=false bloqueia o log
    dispatchWaMsg({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: FAKE_WABA_ID } })

    const lateCall = logSpy.mock.calls.find(args => args[0] === '[meta-finish-diag-late]')
    expect(lateCall).toBeUndefined()

    // Cleanup explícito
    unmount()
  })
})

// =============================================================================
// S7.6 — JSON String FINISH support
// =============================================================================
// Cobre a normalização adicionada em parseWaEmbeddedSignup para aceitar
// event.data como JSON string (comportamento confirmado em runtime — R2).
//
// Cada teste espelha um caso do parser OBJECT existente, garantindo que
// a path JSON-string produz exatamente a mesma semântica.
// =============================================================================

describe('S7.6 — JSON String FINISH support', () => {
  // Helper: monta hook e deixa em popup_open
  async function inPopupOpen() {
    const hook = await renderReady()
    act(() => { hook.result.current.triggerPopup() })
    expect(hook.result.current.step).toBe('popup_open')
    return hook
  }

  // ── S76-01: FINISH string com waba_id + phone_number_id ───────────────────
  it('S76-01: FINISH string válido (waba_id + phone_number_id) → complete com ambos os IDs', async () => {
    const { result } = await inPopupOpen()

    await act(async () => {
      dispatchWaStrMsg({
        type:  'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data:  { waba_id: FAKE_WABA_ID, phone_number_id: FAKE_PHONE_ID },
      })
    })
    // FINISH recebido — salvar wabaId; sem code ainda → step permanece popup_open
    expect(result.current.onboardingError).toBeNull()

    // Enviar code → tryComplete → completeOnboarding
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })
    await act(async () => {})

    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(metaWhatsAppApi.completeOnboarding).mock.calls[0][0] as Record<string, unknown>
    expect(payload['waba_id']).toBe(FAKE_WABA_ID)
    expect(payload['phone_number_id']).toBe(FAKE_PHONE_ID)
    expect(result.current.step).toBe('idle')
  })

  // ── S76-02: FINISH string sem phone_number_id ─────────────────────────────
  it('S76-02: FINISH string com waba_id sem phone_number_id → complete sem phoneId', async () => {
    const { result } = await inPopupOpen()

    await act(async () => {
      dispatchWaStrMsg({
        type:  'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data:  { waba_id: FAKE_WABA_ID },
      })
    })
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })
    await act(async () => {})

    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(metaWhatsAppApi.completeOnboarding).mock.calls[0][0] as Record<string, unknown>
    expect(payload['waba_id']).toBe(FAKE_WABA_ID)
    expect(payload['phone_number_id']).toBeUndefined()
    expect(result.current.step).toBe('idle')
  })

  // ── S76-03: CANCEL string → mesma semântica object ────────────────────────
  it('S76-03: CANCEL string → fluxo encerrado (mesmo comportamento object)', async () => {
    const { result } = await inPopupOpen()

    await act(async () => {
      dispatchWaStrMsg({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL' })
    })

    expect(result.current.step).not.toBe('popup_open')
    expect(result.current.step).not.toBe('completing')
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
  })

  // ── S76-04: ERROR string → mesma semântica object ─────────────────────────
  it('S76-04: ERROR string → onboardingError setado + retry', async () => {
    const { result } = await inPopupOpen()

    await act(async () => {
      dispatchWaStrMsg({ type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR' })
    })

    expect(result.current.step).not.toBe('popup_open')
    expect(result.current.step).not.toBe('completing')
    // 1 (mount) + 1 (retry pós-ERROR)
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(2)
  })

  // ── S76-05: JSON sintaticamente inválido → IGNORE ─────────────────────────
  // Usa dispatchWaRawStrMsg para garantir string sintaticamente inválida real.
  it('S76-05: raw string JSON inválido → IGNORE, sem throw, sem complete', async () => {
    const { result } = await inPopupOpen()

    // String com JSON inválido — NÃO gerada por JSON.stringify
    await act(async () => { dispatchWaRawStrMsg('{ broken json {{{') })

    expect(result.current.step).toBe('popup_open')
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
  })

  // ── S76-06: JSON "null" → IGNORE ─────────────────────────────────────────
  it('S76-06: string JSON null → IGNORE', async () => {
    const { result } = await inPopupOpen()

    await act(async () => { dispatchWaRawStrMsg('null') })

    expect(result.current.step).toBe('popup_open')
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
  })

  // ── S76-07: JSON array → IGNORE ──────────────────────────────────────────
  it('S76-07: string JSON array → IGNORE', async () => {
    const { result } = await inPopupOpen()

    await act(async () => {
      dispatchWaStrMsg([{ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL' }])
    })

    expect(result.current.step).toBe('popup_open')
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
  })

  // ── S76-08: JSON primitivo → IGNORE ──────────────────────────────────────
  it('S76-08: string JSON primitivo (número) → IGNORE', async () => {
    const { result } = await inPopupOpen()

    await act(async () => { dispatchWaRawStrMsg('42') })

    expect(result.current.step).toBe('popup_open')
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
  })

  // ── S76-09: type incorreto → IGNORE ──────────────────────────────────────
  it('S76-09: string com type incorreto → IGNORE, step permanece popup_open', async () => {
    const { result } = await inPopupOpen()

    await act(async () => {
      dispatchWaStrMsg({ type: 'OTHER_SIGNUP_TYPE', event: 'CANCEL' })
    })

    expect(result.current.step).toBe('popup_open')
  })

  // ── S76-10: FINISH string sem waba_id → fail-closed ──────────────────────
  it('S76-10: FINISH string sem waba_id → ERROR (fail-closed, mesmo que object)', async () => {
    const { result } = await inPopupOpen()

    await act(async () => {
      dispatchWaStrMsg({
        type:  'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data:  {},       // waba_id ausente → typeof undefined !== 'string' → ERROR
      })
    })

    expect(result.current.step).not.toBe('popup_open')
    expect(metaWhatsAppApi.startOnboarding).toHaveBeenCalledTimes(2)
    expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
  })

  // ── S76-11: FINISH string → code → complete 1x ───────────────────────────
  it('S76-11: FINISH string → code → completeOnboarding exatamente 1 vez', async () => {
    await inPopupOpen()

    // FINISH string chega primeiro
    await act(async () => {
      dispatchWaStrMsg({
        type:  'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data:  { waba_id: FAKE_WABA_ID, phone_number_id: FAKE_PHONE_ID },
      })
    })

    // Code chega depois
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })
    await act(async () => {})

    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
  })

  // ── S76-12: code → FINISH string antes de F3 ─────────────────────────────
  it('S76-12: code → FINISH string dentro de 5s → F3 cancelado, complete 1x', async () => {
    vi.useFakeTimers()
    try {
      await inPopupOpen()

      // Code chega primeiro → scheduleDiscoveryFallback agendado
      await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })

      // FINISH string chega dentro de 5s → cancela F3
      await act(async () => {
        dispatchWaStrMsg({
          type:  'WA_EMBEDDED_SIGNUP',
          event: 'FINISH',
          data:  { waba_id: FAKE_WABA_ID },
        })
      })
      await act(async () => {})

      // Avançar além de FINISH_GRACE_MS — F3 não deve disparar (cancelado)
      await act(async () => { vi.advanceTimersByTime(6_000) })
      await act(async () => {})

      expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // ── S76-13: FINISH object + FINISH string duplicados → complete 1x ────────
  it('S76-13: FINISH object + FINISH string duplicados → completeOnboarding 1 vez', async () => {
    await inPopupOpen()

    // FINISH object chega primeiro — listener instalado antes do FB.login
    await act(async () => { dispatchFinish(FAKE_WABA_ID, FAKE_PHONE_ID) })

    // FINISH string chega depois — listener já removido pelo FINISH object
    await act(async () => {
      dispatchWaStrMsg({
        type:  'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data:  { waba_id: FAKE_WABA_ID, phone_number_id: FAKE_PHONE_ID },
      })
    })

    // Code
    await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })
    await act(async () => {})

    expect(metaWhatsAppApi.completeOnboarding).toHaveBeenCalledTimes(1)
  })

  // ── S76-14: FINISH string depois de F3 adquirir lock ─────────────────────
  it('S76-14: FINISH string depois de F3 adquirir lock → não inicia segundo complete', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(metaWhatsAppApi.completeOnboarding).mockResolvedValue(FAKE_CONNECTED_RESULT)
      const { unmount } = await renderReady()
      act(() => { renderHook(() => useMetaOnboarding({ enabled: true })) })

      // Montar hook e ir para popup_open
      const hook = renderHook(() => useMetaOnboarding({ enabled: true }))
      await act(async () => {})
      act(() => { hook.result.current.triggerPopup() })

      // Code sem FINISH → scheduleDiscoveryFallback
      await act(async () => { capturedLoginCb?.({ authResponse: { code: FAKE_CODE } }) })

      // F3 dispara → lock adquirido → completeOnboarding em voo
      await act(async () => { vi.advanceTimersByTime(5_100) })
      await act(async () => {})

      vi.mocked(metaWhatsAppApi.completeOnboarding).mockClear()

      // FINISH string tardio — isCompletingRef=true bloqueia segundo complete
      await act(async () => {
        dispatchWaStrMsg({
          type:  'WA_EMBEDDED_SIGNUP',
          event: 'FINISH',
          data:  { waba_id: FAKE_WABA_ID },
        })
      })

      expect(metaWhatsAppApi.completeOnboarding).not.toHaveBeenCalled()
      unmount()
      hook.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
