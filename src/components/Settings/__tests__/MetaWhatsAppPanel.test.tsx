// @vitest-environment jsdom
// =============================================================================
// src/components/Settings/__tests__/MetaWhatsAppPanel.test.tsx
//
// Integration wiring contracts do MetaWhatsAppPanel.
// Mocka os três boundaries de hook; NÃO repete internals do useMetaOnboarding.
//
// Infraestrutura: Vitest 4 · @testing-library/react 16 · jsdom 25
// Environment:    jsdom (per-file — não afeta suíte node existente)
//
// Nota: @testing-library/jest-dom não instalado → sem toBeInTheDocument/toBeDisabled.
// Usa element.disabled (DOM property) e expect(...).toBeNull() (Vitest built-in).
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MetaWhatsAppPanel } from '../MetaWhatsAppPanel'
import type { UseMetaOnboardingResult } from '../../../hooks/useMetaOnboarding'
import type { MetaWhatsAppInstance } from '../../../types/meta-whatsapp'

// ── i18n mock — resolução determinística contra JSON PT-BR real ───────────────
// Sem inicialização de provider: importa o JSON e resolve as chaves diretamente.
// Interpolação simples ({{count}}) também suportada.

import settingsAppPt from '../../../locales/pt-BR/settings.app.json'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>): string => {
      const parts = key.split('.')
      let node: unknown = settingsAppPt
      for (const part of parts) {
        if (typeof node !== 'object' || node === null) return key
        node = (node as Record<string, unknown>)[part]
      }
      if (typeof node !== 'string') return key
      if (!opts) return node
      return node.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? `{{${k}}}`))
    },
  }),
}))

// ── Mocks dos três boundaries de hook ─────────────────────────────────────────

vi.mock('../../../hooks/useCompany', () => ({ useCompany: vi.fn() }))
vi.mock('../../../hooks/useMetaWhatsAppInstances', () => ({
  useMetaWhatsAppInstances: vi.fn(),
}))
vi.mock('../../../hooks/useMetaOnboarding', () => ({
  useMetaOnboarding: vi.fn(),
}))

import { useCompany }              from '../../../hooks/useCompany'
import { useMetaWhatsAppInstances } from '../../../hooks/useMetaWhatsAppInstances'
import { useMetaOnboarding }        from '../../../hooks/useMetaOnboarding'

// ── Valores sintéticos ────────────────────────────────────────────────────────

const COMPANY = { id: 'company-test-001' }

// Instância sintética para PANEL-G01.
// waba_id e phone_number_id intencionalmente distintos e reconhecíveis:
// confirmamos que NÃO aparecem no DOM.
const FAKE_INSTANCE: MetaWhatsAppInstance = {
  id:              'inst-test-001',
  phone_number_id: '112233445566',      // deve NÃO aparecer no DOM
  waba_id:         '998877665544',      // deve NÃO aparecer no DOM
  display_name:    'Test Company',      // aparece como display_name
  phone_number:    '+55 11 98765-4321', // aparece como número legítimo — OK
  verified_name:   'Test Verified',
  status:          'connected',
  created_at:      '2026-01-01T00:00:00.000Z',
  updated_at:      '2026-01-01T00:00:00.000Z',
}

// ── Estado padrão ─────────────────────────────────────────────────────────────
// Criado fresh em cada beforeEach para evitar vazamento entre testes.

let mockRefresh:      ReturnType<typeof vi.fn> = vi.fn()
let mockTriggerPopup: ReturnType<typeof vi.fn> = vi.fn()
let mockCancelFlow:   ReturnType<typeof vi.fn> = vi.fn()

function makeOnboardingResult(
  overrides: Partial<UseMetaOnboardingResult> = {},
): UseMetaOnboardingResult {
  return {
    step:            'ready',
    onboardingError: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    triggerPopup:    mockTriggerPopup as unknown as () => void,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cancelFlow:      mockCancelFlow as unknown as () => void,
    isReady:         true,
    ...overrides,
  }
}

// RTL auto-cleanup não é garantido no ambiente jsdom per-file — forçar explicitamente.
afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  mockRefresh      = vi.fn()
  mockTriggerPopup = vi.fn()
  mockCancelFlow   = vi.fn()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useCompany).mockReturnValue({ company: COMPANY } as any)
  vi.mocked(useMetaWhatsAppInstances).mockReturnValue({
    instances: [],
    loading:   false,
    error:     null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    refresh:   mockRefresh as unknown as () => void,
  })
  vi.mocked(useMetaOnboarding).mockReturnValue(makeOnboardingResult())
})

// =============================================================================
describe('MetaWhatsAppPanel — integration wiring', () => {

  // ── I. enabled prop wiring ──────────────────────────────────────────────────
  // Prova que enabled = Boolean(company?.id) && !loading && !error
  // É calculado com os três hooks ANTES dos early returns — todos os casos testáveis.

  describe('enabled wiring (contrato I)', () => {
    it('PANEL-I01: sem company → useMetaOnboarding recebe enabled=false', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useCompany).mockReturnValue({ company: null } as any)
      render(<MetaWhatsAppPanel />)
      expect(vi.mocked(useMetaOnboarding)).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false }),
      )
    })

    it('PANEL-I02: company + loading=true → enabled=false', () => {
      vi.mocked(useMetaWhatsAppInstances).mockReturnValue({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      instances: [], loading: true, error: null, refresh: mockRefresh as unknown as () => void,
      })
      render(<MetaWhatsAppPanel />)
      expect(vi.mocked(useMetaOnboarding)).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false }),
      )
    })

    it('PANEL-I03: company + GET error → enabled=false', () => {
      vi.mocked(useMetaWhatsAppInstances).mockReturnValue({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        instances: [], loading: false, error: 'Acesso negado', refresh: mockRefresh as unknown as () => void,
      })
      render(<MetaWhatsAppPanel />)
      expect(vi.mocked(useMetaOnboarding)).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false }),
      )
    })

    it('PANEL-I04: company + loaded + sem error → enabled=true', () => {
      // Estado default do beforeEach: company presente, loading=false, error=null
      render(<MetaWhatsAppPanel />)
      expect(vi.mocked(useMetaOnboarding)).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true }),
      )
    })
  })

  // ── J. onSuccess wiring ─────────────────────────────────────────────────────
  // Prova que onSuccess passado ao hook == refresh de useMetaWhatsAppInstances.

  it('PANEL-J01: onSuccess passado ao hook chama refresh exatamente 1x', () => {
    let capturedOnSuccess: (() => void) | undefined
    vi.mocked(useMetaOnboarding).mockImplementation((opts) => {
      capturedOnSuccess = opts?.onSuccess
      return makeOnboardingResult()
    })

    render(<MetaWhatsAppPanel />)

    expect(typeof capturedOnSuccess).toBe('function')
    capturedOnSuccess!()
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  // ── A. Loading GET ──────────────────────────────────────────────────────────
  // Botões de conexão ausentes enquanto GET está em curso.

  it('PANEL-A01: loading → botão de conexão ausente', () => {
    vi.mocked(useMetaWhatsAppInstances).mockReturnValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      instances: [], loading: true, error: null, refresh: mockRefresh as unknown as () => void,
    })
    render(<MetaWhatsAppPanel />)
    expect(screen.queryByRole('button', { name: /Conectar WhatsApp/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Conectar outro número/ })).toBeNull()
  })

  // ── B. GET error ────────────────────────────────────────────────────────────
  // Erro GET visível; "Tentar novamente" chama refresh, não cancelFlow.

  it('PANEL-B01: GET error → mensagem visível, retry chama refresh 1x, cancelFlow zero', () => {
    vi.mocked(useMetaWhatsAppInstances).mockReturnValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      instances: [], loading: false, error: 'Erro de rede', refresh: mockRefresh as unknown as () => void,
    })
    render(<MetaWhatsAppPanel />)

    // Mensagem de erro do GET visível
    screen.getByText('Erro de rede')

    // Único botão "Tentar novamente" neste estado (GET error = early return)
    fireEvent.click(screen.getByRole('button', { name: /Tentar novamente/ }))
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(mockCancelFlow).not.toHaveBeenCalled()
  })

  // ── C. empty + loading_session ──────────────────────────────────────────────
  // Botão desabilitado com texto de progresso; triggerPopup não chamado na renderização.

  it('PANEL-C01: empty + loading_session → botão disabled + "Preparando conexão..."', () => {
    vi.mocked(useMetaOnboarding).mockReturnValue(makeOnboardingResult({
      step:    'loading_session',
      isReady: false,
    }))
    render(<MetaWhatsAppPanel />)
    const btn = screen.getByRole('button', { name: /Preparando conexão/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(mockTriggerPopup).not.toHaveBeenCalled()
  })

  // ── D. empty + ready ────────────────────────────────────────────────────────
  // Botão habilitado; click chama triggerPopup exatamente uma vez.

  it('PANEL-D01: empty + ready → botão enabled, click chama triggerPopup 1x', () => {
    // Estado default: step=ready, isReady=true
    render(<MetaWhatsAppPanel />)
    const btn = screen.getByRole('button', { name: /Conectar WhatsApp/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    expect(mockTriggerPopup).toHaveBeenCalledTimes(1)
  })

  // ── E. empty + popup_open ───────────────────────────────────────────────────
  // Botão desabilitado durante popup; label permanece normal (não "Preparando...").

  it('PANEL-E01: empty + popup_open → botão disabled, label normal, triggerPopup zero', () => {
    vi.mocked(useMetaOnboarding).mockReturnValue(makeOnboardingResult({
      step:    'popup_open',
      isReady: false,
    }))
    render(<MetaWhatsAppPanel />)
    // Label normal (popup_open não é isProcessing) → "Conectar WhatsApp"
    const btn = screen.getByRole('button', { name: /Conectar WhatsApp/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    // Renderização pura não deve chamar triggerPopup
    expect(mockTriggerPopup).not.toHaveBeenCalled()
  })

  // ── F. empty + completing ───────────────────────────────────────────────────
  // Botão desabilitado com texto de conclusão; triggerPopup zero.

  it('PANEL-F01: empty + completing → botão disabled + "Finalizando..."', () => {
    vi.mocked(useMetaOnboarding).mockReturnValue(makeOnboardingResult({
      step:    'completing',
      isReady: false,
    }))
    render(<MetaWhatsAppPanel />)
    const btn = screen.getByRole('button', { name: /Finalizando/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(mockTriggerPopup).not.toHaveBeenCalled()
  })

  // ── G. connected + ready ────────────────────────────────────────────────────
  // Instância renderizada com display_name + phone_number legítimo.
  // IDs técnicos (waba_id, phone_number_id) não aparecem no DOM.
  // Botão "Conectar outro número" enabled; click chama triggerPopup.

  it('PANEL-G01: connected + ready → instância, addButton enabled, IDs técnicos ausentes', () => {
    vi.mocked(useMetaWhatsAppInstances).mockReturnValue({
      instances: [FAKE_INSTANCE],
      loading:   false,
      error:     null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      refresh:   mockRefresh as unknown as () => void,
    })
    render(<MetaWhatsAppPanel />)

    // display_name visível
    screen.getByText('Test Company')
    // phone_number legítimo visível (DIFERENTE de phone_number_id)
    screen.getByText('+55 11 98765-4321')

    // Botão de adicionar outro número habilitado
    const addBtn = screen.getByRole('button', { name: /Conectar outro número/ }) as HTMLButtonElement
    expect(addBtn.disabled).toBe(false)
    fireEvent.click(addBtn)
    expect(mockTriggerPopup).toHaveBeenCalledTimes(1)

    // IDs técnicos não expostos no DOM
    expect(screen.queryByText('998877665544')).toBeNull()   // waba_id
    expect(screen.queryByText('112233445566')).toBeNull()   // phone_number_id
  })

  // ── H. onboardingError ──────────────────────────────────────────────────────
  // Erro de onboarding visível e separado do GET error (GET error=null neste cenário).
  // "Tentar novamente" chama cancelFlow, não refresh.

  it('PANEL-H01: onboardingError → erro visível, retry → cancelFlow 1x, refresh zero', () => {
    vi.mocked(useMetaOnboarding).mockReturnValue(makeOnboardingResult({
      step:            'idle',
      isReady:         false,
      onboardingError: 'Erro no fluxo de conexão Meta',
    }))
    render(<MetaWhatsAppPanel />)

    // Mensagem de erro visível (GET error=null → sem ambiguidade com PANEL-B01)
    screen.getByText('Erro no fluxo de conexão Meta')

    // Retry → cancelFlow, não refresh
    fireEvent.click(screen.getByRole('button', { name: /Tentar novamente/ }))
    expect(mockCancelFlow).toHaveBeenCalledTimes(1)
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
