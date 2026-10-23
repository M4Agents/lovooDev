// @vitest-environment jsdom
// =============================================================================
// MetaWhatsAppPanel — desconexão (MVP5.A4)
// Mocks apenas. Nenhuma desconexão real, Graph ou SQL WRITE.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { MetaWhatsAppPanel } from '../MetaWhatsAppPanel'
import type { UseMetaOnboardingResult } from '../../../hooks/useMetaOnboarding'
import type { MetaWhatsAppInstance } from '../../../types/meta-whatsapp'
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

vi.mock('../../../hooks/useCompany', () => ({ useCompany: vi.fn() }))
vi.mock('../../../hooks/useAccessControl', () => ({ useAccessControl: vi.fn() }))
vi.mock('../../../hooks/useMetaWhatsAppInstances', () => ({
  useMetaWhatsAppInstances: vi.fn(),
}))
vi.mock('../../../hooks/useMetaOnboarding', () => ({
  useMetaOnboarding: vi.fn(),
}))
vi.mock('../../../services/metaWhatsAppApi', () => ({
  metaWhatsAppApi: {
    disconnectInstance: vi.fn(),
  },
}))

import { useCompany } from '../../../hooks/useCompany'
import { useAccessControl } from '../../../hooks/useAccessControl'
import { useMetaWhatsAppInstances } from '../../../hooks/useMetaWhatsAppInstances'
import { useMetaOnboarding } from '../../../hooks/useMetaOnboarding'
import { metaWhatsAppApi } from '../../../services/metaWhatsAppApi'

const COMPANY = { id: 'aaaa0000-0000-0000-0000-000000000001' }
const INSTANCE_ID = 'cccc0000-0000-0000-0000-000000000003'

function makeInstance(status: MetaWhatsAppInstance['status']): MetaWhatsAppInstance {
  return {
    id:              INSTANCE_ID,
    phone_number_id: '112233445566',
    waba_id:         '998877665544',
    display_name:    'Test Company',
    phone_number:    '+55 11 98765-4321',
    verified_name:   'Test Verified',
    status,
    created_at:      '2026-01-01T00:00:00.000Z',
    updated_at:      '2026-01-01T00:00:00.000Z',
  }
}

let mockRefresh: ReturnType<typeof vi.fn>

function makeOnboardingResult(): UseMetaOnboardingResult {
  return {
    step:             'ready',
    onboardingError:  null,
    triggerPopup:     vi.fn() as unknown as () => void,
    cancelFlow:       vi.fn() as unknown as () => void,
    isReady:          true,
    selectionOptions: null,
    selectWaba:       vi.fn() as unknown as (index: number) => void,
  }
}

function setupListed(status: MetaWhatsAppInstance['status'] = 'connected', canConnect = true) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useCompany).mockReturnValue({ company: COMPANY } as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAccessControl).mockReturnValue({ canConnectMetaWhatsApp: canConnect } as any)
  vi.mocked(useMetaWhatsAppInstances).mockReturnValue({
    instances: [makeInstance(status)],
    loading:   false,
    error:     null,
    refresh:   mockRefresh as unknown as () => void,
  })
  vi.mocked(useMetaOnboarding).mockReturnValue(makeOnboardingResult())
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  mockRefresh = vi.fn()
  setupListed()
})

describe('visibilidade da ação Desconectar', () => {
  it('admin autorizado visualiza Desconectar em instância connected', () => {
    render(<MetaWhatsAppPanel />)
    expect(screen.getByRole('button', { name: /^Desconectar$/ })).toBeTruthy()
  })

  it('seller não visualiza', () => {
    setupListed('connected', false)
    render(<MetaWhatsAppPanel />)
    expect(screen.queryByRole('button', { name: /^Desconectar$/ })).toBeNull()
  })

  it('manager não visualiza', () => {
    setupListed('connected', false)
    render(<MetaWhatsAppPanel />)
    expect(screen.queryByRole('button', { name: /^Desconectar$/ })).toBeNull()
  })

  it('partner sem atribuição não visualiza', () => {
    setupListed('connected', false)
    render(<MetaWhatsAppPanel />)
    expect(screen.queryByRole('button', { name: /^Desconectar$/ })).toBeNull()
  })

  it('feature flag / GET indisponível não exibe a ação', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useCompany).mockReturnValue({ company: COMPANY } as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAccessControl).mockReturnValue({ canConnectMetaWhatsApp: true } as any)
    vi.mocked(useMetaWhatsAppInstances).mockReturnValue({
      instances: [],
      loading:   false,
      error:     'Meta WhatsApp não habilitado para esta empresa',
      refresh:   mockRefresh as unknown as () => void,
    })
    vi.mocked(useMetaOnboarding).mockReturnValue(makeOnboardingResult())
    render(<MetaWhatsAppPanel />)
    expect(screen.queryByRole('button', { name: /^Desconectar$/ })).toBeNull()
  })

  it('instância disconnected não exibe ação', () => {
    setupListed('disconnected')
    render(<MetaWhatsAppPanel />)
    expect(screen.getByText('Desconectado')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Desconectar$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Reconectar/ })).toBeNull()
  })

  it('token_revoked não exibe ação', () => {
    setupListed('token_revoked')
    render(<MetaWhatsAppPanel />)
    expect(screen.queryByRole('button', { name: /^Desconectar$/ })).toBeNull()
  })

  it('error não exibe ação', () => {
    setupListed('error')
    render(<MetaWhatsAppPanel />)
    expect(screen.queryByRole('button', { name: /^Desconectar$/ })).toBeNull()
  })
})

describe('confirmação e chamada de API', () => {
  it('clique abre confirmação sem chamar API', () => {
    render(<MetaWhatsAppPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Desconectar WhatsApp Oficial')).toBeTruthy()
    expect(metaWhatsAppApi.disconnectInstance).not.toHaveBeenCalled()
  })

  it('cancelar não chama API', () => {
    render(<MetaWhatsAppPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(metaWhatsAppApi.disconnectInstance).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('confirmar chama API uma única vez com company_id e instance_id', async () => {
    vi.mocked(metaWhatsAppApi.disconnectInstance).mockResolvedValue({
      ok: true, instance_id: INSTANCE_ID, status: 'disconnected',
    })
    render(<MetaWhatsAppPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar desconexão/ }))

    await waitFor(() => {
      expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalledTimes(1)
    })
    expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalledWith(COMPANY.id, INSTANCE_ID)
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(/Instância desconectada/)).toBeTruthy()
  })

  it('requisição em andamento bloqueia duplo envio e cancelar', async () => {
    let resolveDisconnect: (value: { ok: true; instance_id: string; status: 'disconnected' }) => void
    vi.mocked(metaWhatsAppApi.disconnectInstance).mockReturnValue(
      new Promise((resolve) => { resolveDisconnect = resolve }),
    )
    render(<MetaWhatsAppPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar desconexão/ }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Desconectando/ })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /Desconectando/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBeTruthy()

    resolveDisconnect!({ ok: true, instance_id: INSTANCE_ID, status: 'disconnected' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})

describe('erros HTTP', () => {
  async function confirmAndWait() {
    render(<MetaWhatsAppPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar desconexão/ }))
    await waitFor(() => {
      expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalled()
    })
  }

  it('HTTP 400 mostra erro de solicitação inválida e não apresenta sucesso', async () => {
    vi.mocked(metaWhatsAppApi.disconnectInstance).mockRejectedValue(new Error('invalid_request'))
    await confirmAndWait()
    expect(screen.getByText('Solicitação inválida. Atualize a página e tente novamente.')).toBeTruthy()
    expect(screen.queryByText(/Instância desconectada/)).toBeNull()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('HTTP 403 mostra erro adequado e não apresenta sucesso', async () => {
    vi.mocked(metaWhatsAppApi.disconnectInstance).mockRejectedValue(
      new Error('Permissão insuficiente para esta operação'),
    )
    await confirmAndWait()
    expect(screen.getByText('Você não tem permissão para desconectar esta instância.')).toBeTruthy()
    expect(screen.queryByText(/Instância desconectada/)).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('HTTP 404 mostra erro adequado e atualiza a lista', async () => {
    vi.mocked(metaWhatsAppApi.disconnectInstance).mockRejectedValue(new Error('instance_not_found'))
    await confirmAndWait()
    expect(screen.getByText('Instância não encontrada ou indisponível.')).toBeTruthy()
    expect(screen.queryByText(/Instância desconectada/)).toBeNull()
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('HTTP 409 mostra erro adequado e atualiza a lista', async () => {
    vi.mocked(metaWhatsAppApi.disconnectInstance).mockRejectedValue(new Error('instance_state_conflict'))
    await confirmAndWait()
    expect(screen.getByText('O estado atual da instância não permite desconexão.')).toBeTruthy()
    expect(screen.queryByText(/Instância desconectada/)).toBeNull()
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('HTTP 500 mostra erro genérico e não apresenta sucesso', async () => {
    vi.mocked(metaWhatsAppApi.disconnectInstance).mockRejectedValue(new Error('internal_error'))
    await confirmAndWait()
    expect(screen.getByText('Não foi possível desconectar. Tente novamente.')).toBeTruthy()
    expect(screen.queryByText(/Instância desconectada/)).toBeNull()
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})

describe('segurança de superfície', () => {
  it('não exibe token, waba_id ou phone_number_id', () => {
    render(<MetaWhatsAppPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    expect(screen.queryByText('998877665544')).toBeNull()
    expect(screen.queryByText('112233445566')).toBeNull()
    expect(screen.queryByText(/EAAAN|access_token|Bearer/i)).toBeNull()
  })

  it('não chama Graph API no frontend', () => {
    render(<MetaWhatsAppPanel />)
    expect(JSON.stringify(metaWhatsAppApi)).not.toMatch(/graph\.facebook|graph\.whatsapp/i)
  })
})

const COMPANY_B = { id: 'bbbb0000-0000-0000-0000-000000000002' }
const INSTANCE_B_ID = 'dddd0000-0000-0000-0000-000000000004'

function makeInstanceFor(
  id: string,
  displayName: string,
  status: MetaWhatsAppInstance['status'] = 'connected',
): MetaWhatsAppInstance {
  return {
    id,
    phone_number_id: '000000000000',
    waba_id:         '111111111111',
    display_name:    displayName,
    phone_number:    '+55 21 90000-0000',
    verified_name:   displayName,
    status,
    created_at:      '2026-01-01T00:00:00.000Z',
    updated_at:      '2026-01-01T00:00:00.000Z',
  }
}

function mockListed(
  company: { id: string },
  instance: MetaWhatsAppInstance,
  refreshFn: ReturnType<typeof vi.fn>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useCompany).mockReturnValue({ company } as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAccessControl).mockReturnValue({ canConnectMetaWhatsApp: true } as any)
  vi.mocked(useMetaWhatsAppInstances).mockReturnValue({
    instances: [instance],
    loading:   false,
    error:     null,
    refresh:   refreshFn as unknown as () => void,
  })
  vi.mocked(useMetaOnboarding).mockReturnValue(makeOnboardingResult())
}

describe('isolamento visual ao trocar de empresa', () => {
  it('desconexão normal sem troca de empresa continua aplicando sucesso e refresh', async () => {
    vi.mocked(metaWhatsAppApi.disconnectInstance).mockResolvedValue({
      ok: true, instance_id: INSTANCE_ID, status: 'disconnected',
    })
    render(<MetaWhatsAppPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar desconexão/ }))

    await waitFor(() => {
      expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalledTimes(1)
    })
    expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalledWith(COMPANY.id, INSTANCE_ID)
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Instância desconectada/)).toBeTruthy()
  })

  it('troca A → B durante o POST não aplica refresh nem feedback de A em B', async () => {
    let resolveDisconnect: (value: { ok: true; instance_id: string; status: 'disconnected' }) => void
    vi.mocked(metaWhatsAppApi.disconnectInstance).mockReturnValue(
      new Promise((resolve) => { resolveDisconnect = resolve }),
    )
    const refreshA = vi.fn()
    const refreshB = vi.fn()
    const instanceB = makeInstanceFor(INSTANCE_B_ID, 'Empresa B')

    mockListed(COMPANY, makeInstance('connected'), refreshA)
    const { rerender } = render(<MetaWhatsAppPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar desconexão/ }))

    await waitFor(() => {
      expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalledTimes(1)
    })
    expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalledWith(COMPANY.id, INSTANCE_ID)

    mockListed(COMPANY_B, instanceB, refreshB)
    rerender(<MetaWhatsAppPanel />)

    expect(screen.getByText('Empresa B')).toBeTruthy()
    expect(screen.queryByText('Test Company')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()

    await act(async () => {
      resolveDisconnect!({ ok: true, instance_id: INSTANCE_ID, status: 'disconnected' })
    })

    expect(screen.getByText('Empresa B')).toBeTruthy()
    expect(refreshA).not.toHaveBeenCalled()
    expect(refreshB).not.toHaveBeenCalled()
    expect(screen.queryByText(/Instância desconectada/)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Test Company')).toBeNull()
    expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /^Desconectar$/ })).toBeTruthy()
  })

  it('modal de A é invalidado quando a empresa muda antes de confirmar', () => {
    const refreshB = vi.fn()
    const instanceB = makeInstanceFor(INSTANCE_B_ID, 'Empresa B')
    const { rerender } = render(<MetaWhatsAppPanel />)

    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(metaWhatsAppApi.disconnectInstance).not.toHaveBeenCalled()

    mockListed(COMPANY_B, instanceB, refreshB)
    rerender(<MetaWhatsAppPanel />)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(metaWhatsAppApi.disconnectInstance).not.toHaveBeenCalled()
    expect(screen.getByText('Empresa B')).toBeTruthy()
    expect(screen.queryByText('Test Company')).toBeNull()
  })

  it('após invalidar o modal de A, confirmar em B envia apenas o POST de B', async () => {
    const refreshB = vi.fn()
    const instanceB = makeInstanceFor(INSTANCE_B_ID, 'Empresa B')
    vi.mocked(metaWhatsAppApi.disconnectInstance).mockResolvedValue({
      ok: true, instance_id: INSTANCE_B_ID, status: 'disconnected',
    })
    const { rerender } = render(<MetaWhatsAppPanel />)

    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    mockListed(COMPANY_B, instanceB, refreshB)
    rerender(<MetaWhatsAppPanel />)

    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar desconexão/ }))

    await waitFor(() => {
      expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalledTimes(1)
    })
    expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalledWith(COMPANY_B.id, INSTANCE_B_ID)
    expect(refreshB).toHaveBeenCalledTimes(1)
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('troca A → B → A não reaplica resultado da operação antiga', async () => {
    let resolveDisconnect: (value: { ok: true; instance_id: string; status: 'disconnected' }) => void
    vi.mocked(metaWhatsAppApi.disconnectInstance).mockReturnValue(
      new Promise((resolve) => { resolveDisconnect = resolve }),
    )
    const refreshA1 = vi.fn()
    const refreshB = vi.fn()
    const refreshA2 = vi.fn()
    const instanceB = makeInstanceFor(INSTANCE_B_ID, 'Empresa B')

    mockListed(COMPANY, makeInstance('connected'), refreshA1)
    const { rerender } = render(<MetaWhatsAppPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar desconexão/ }))

    await waitFor(() => {
      expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalledTimes(1)
    })

    mockListed(COMPANY_B, instanceB, refreshB)
    rerender(<MetaWhatsAppPanel />)
    mockListed(COMPANY, makeInstance('connected'), refreshA2)
    rerender(<MetaWhatsAppPanel />)

    await act(async () => {
      resolveDisconnect!({ ok: true, instance_id: INSTANCE_ID, status: 'disconnected' })
    })

    expect(screen.getByText('Test Company')).toBeTruthy()
    expect(refreshA1).not.toHaveBeenCalled()
    expect(refreshB).not.toHaveBeenCalled()
    expect(refreshA2).not.toHaveBeenCalled()
    expect(screen.queryByText(/Instância desconectada/)).toBeNull()
    expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalledTimes(1)
  })
})

describe('proteção contra POST duplicado', () => {
  it('dois cliques no mesmo tick produzem um único POST', async () => {
    vi.mocked(metaWhatsAppApi.disconnectInstance).mockReturnValue(
      new Promise(() => { /* pendente de propósito */ }),
    )
    render(<MetaWhatsAppPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    const confirm = screen.getByRole('button', { name: /Confirmar desconexão/ })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalledTimes(1)
    })
  })

  it('guard de duplicidade é liberado após erro e operação posterior funciona', async () => {
    vi.mocked(metaWhatsAppApi.disconnectInstance)
      .mockRejectedValueOnce(new Error('internal_error'))
      .mockResolvedValueOnce({
        ok: true, instance_id: INSTANCE_ID, status: 'disconnected',
      })

    render(<MetaWhatsAppPanel />)
    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar desconexão/ }))

    await waitFor(() => {
      expect(screen.getByText('Não foi possível desconectar. Tente novamente.')).toBeTruthy()
    })
    expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalledTimes(1)
    expect(mockRefresh).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Confirmar desconexão/ }))

    await waitFor(() => {
      expect(metaWhatsAppApi.disconnectInstance).toHaveBeenCalledTimes(2)
    })
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Instância desconectada/)).toBeTruthy()
  })
})
