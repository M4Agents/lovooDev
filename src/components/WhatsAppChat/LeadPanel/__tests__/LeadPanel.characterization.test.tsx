// @vitest-environment jsdom
// =============================================================================
// LeadPanel.characterization.test.tsx — META-L1.3
//
// Documenta o comportamento visível atual do painel Uazapi.
// Não altera o comportamento para facilitar o teste: filhos pesados são
// stubados apenas para isolar as quatro abas e o carregamento.
//
// LP-01  quatro abas após o load
// LP-02  loading inicial
// LP-03  sem adapter → caminho Uazapi (loadConversation do default)
// LP-04  oportunidades recebem lead_id da conversa (pode ser null)
// LP-05  notas bloqueadas sem lead associado
// LP-06  resumo IA só com conversation.lead_id
// LP-07  biblioteca recebe o conversationId
// LP-08  aba Agendar monta quando há instance_id
// LP-09  conversa ausente: abas visíveis, sem oportunidades
// LP-10  troca rápida de conversa recarrega o adapter
// LP-11  adapter injetado é usado; default Uazapi não dispara
// LP-12  erro no load não quebra o painel (loading encerra)
// =============================================================================

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChannelCrmAdapter } from '../../../../types/channel-crm-adapter'
import { UAZAPI_CHANNEL_CAPABILITIES } from '../uazapiChannelAdapter'

const adapterSpies = vi.hoisted(() => ({
  loadConversation: vi.fn(),
  loadContact: vi.fn(),
  resolveAssociatedLead: vi.fn(),
  getAverageResponseTime: vi.fn(),
  loadScheduledMessages: vi.fn(),
}))

const createUazapiChannelAdapterMock = vi.hoisted(() =>
  vi.fn((params: { conversationId: string; companyId: string }) =>
    makeAdapter(params.conversationId, params.companyId)
  )
)

function makeAdapter(
  conversationId: string,
  companyId: string,
  overrides: Partial<ChannelCrmAdapter> = {}
): ChannelCrmAdapter {
  return {
    channel: 'uazapi',
    conversationId,
    companyId,
    capabilities: UAZAPI_CHANNEL_CAPABILITIES,
    loadConversation: adapterSpies.loadConversation,
    loadContact: adapterSpies.loadContact,
    resolveAssociatedLead: adapterSpies.resolveAssociatedLead,
    getAverageResponseTime: adapterSpies.getAverageResponseTime,
    loadScheduledMessages: adapterSpies.loadScheduledMessages,
    ...overrides,
  }
}

vi.mock('../uazapiChannelAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../uazapiChannelAdapter')>()
  return {
    ...actual,
    createUazapiChannelAdapter: createUazapiChannelAdapterMock,
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentRole: 'admin',
    company: { id: 'company-test-001', chat_visibility_by_assigned_to: false },
    user: { id: 'user-1' },
    hasPermission: () => true,
    userRoles: [{ company_id: 'company-test-001', user_id: 'user-1', role: 'admin' }],
  }),
}))

vi.mock('../../../../hooks/useLeadPermissions', () => ({
  useLeadPermissions: () => ({
    canEditLead: () => true,
    canAssignLead: () => true,
    canReassignOwnLeads: () => false,
    currentUserId: 'user-1',
  }),
}))

vi.mock('../../../../services/chat/chatApi', () => ({
  chatApi: {
    getCompanyInstances: vi.fn().mockResolvedValue([]),
    getContactInfo: vi.fn(),
    getScheduledMessages: vi.fn(),
    supabase: { rpc: vi.fn() },
  },
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
}))

vi.mock('../../../../services/api', () => ({
  api: { createLead: vi.fn(), updateLead: vi.fn() },
}))

vi.mock('@emoji-mart/data', () => ({ default: {} }))
vi.mock('@emoji-mart/react', () => ({ default: () => null }))

vi.mock('../../../LeadModal', () => ({
  LeadModal: () => null,
}))

vi.mock('../../../Calendar/ActivityModal', () => ({
  ActivityModal: () => null,
}))

vi.mock('../../../TagSelectorPopover', () => ({
  TagSelectorPopover: () => null,
}))

vi.mock('../../../InternalNotes', () => ({
  InternalNotes: ({ leadId }: { leadId: number }) => (
    <div data-testid="internal-notes">{leadId}</div>
  ),
}))

vi.mock('../BibliotecaV2', () => ({
  BibliotecaV2: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="biblioteca-v2">{conversationId}</div>
  ),
}))

vi.mock('../OpportunitiesSection', () => ({
  OpportunitiesSection: ({ leadId }: { leadId?: number | null }) => (
    <div data-testid="opportunities-section">{leadId == null ? 'none' : String(leadId)}</div>
  ),
}))

vi.mock('../../InstanceSelector', () => ({
  InstanceSelector: () => <div data-testid="instance-selector" />,
}))

vi.mock('../../UserSelector', () => ({
  UserSelector: () => <div data-testid="user-selector" />,
}))

import { LeadPanel } from '../LeadPanel'

const COMPANY_ID = 'company-test-001'
const CONV_A = 'conv-uazapi-aaa'
const CONV_B = 'conv-uazapi-bbb'

const CONV_ROW = {
  id: CONV_A,
  instance_id: 'instance-1',
  contact_phone: '5511999887766',
  contact_name: 'Contato Uazapi',
  lead_id: 42,
  company_name: 'Acme',
}

const CONTACT = {
  id: 'contact-1',
  company_id: COMPANY_ID,
  phone_number: '5511999887766',
  name: 'Contato Uazapi',
  total_messages: 8,
  tags: ['vip'],
  custom_fields: {},
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
}

const ASSOCIATED_LEAD = {
  id: 42,
  name: 'Lead Cadastro',
  phone: '5511999887766',
  email: 'lead@example.com',
  responsible_user_id: 'user-1',
}

function renderPanel(
  props: Partial<{ conversationId: string; adapter: ChannelCrmAdapter }> = {}
) {
  return render(
    <LeadPanel
      conversationId={props.conversationId ?? CONV_A}
      companyId={COMPANY_ID}
      userId="user-1"
      adapter={props.adapter}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  adapterSpies.loadConversation.mockResolvedValue(CONV_ROW)
  adapterSpies.loadContact.mockResolvedValue(CONTACT)
  adapterSpies.resolveAssociatedLead.mockResolvedValue(ASSOCIATED_LEAD)
  adapterSpies.getAverageResponseTime.mockResolvedValue('5m')
  adapterSpies.loadScheduledMessages.mockResolvedValue([])
  createUazapiChannelAdapterMock.mockImplementation((params) =>
    makeAdapter(params.conversationId, params.companyId)
  )
})

afterEach(() => {
  cleanup()
})

describe('LeadPanel — caracterização Uazapi', () => {
  it('LP-02: exibe loading enquanto o snapshot carrega', () => {
    adapterSpies.loadConversation.mockReturnValue(new Promise(() => {}))
    renderPanel()
    expect(screen.getByText('leadPanel.loading')).toBeTruthy()
  })

  it('LP-01: renderiza as quatro abas após o load', async () => {
    renderPanel()
    await waitFor(() => {
      expect(screen.getByText('leadPanel.tabs.info')).toBeTruthy()
    })
    expect(screen.getByText('leadPanel.tabs.schedule')).toBeTruthy()
    expect(screen.getByText('leadPanel.tabs.library')).toBeTruthy()
    expect(screen.getByText('Notas')).toBeTruthy()
  })

  it('LP-03: sem prop adapter cria UazapiChannelAdapter com os ids atuais', async () => {
    renderPanel()
    await waitFor(() => {
      expect(createUazapiChannelAdapterMock).toHaveBeenCalledWith({
        conversationId: CONV_A,
        companyId: COMPANY_ID,
      })
    })
    expect(adapterSpies.loadConversation).toHaveBeenCalledTimes(1)
  })

  it('LP-04: OpportunitiesSection recebe lead_id da conversa, inclusive null', async () => {
    adapterSpies.loadConversation.mockResolvedValue({ ...CONV_ROW, lead_id: null })
    renderPanel()
    await waitFor(() => {
      expect(screen.getByTestId('opportunities-section').textContent).toBe('none')
    })
  })

  it('LP-04b: OpportunitiesSection recebe o lead_id numérico quando a conversa já tem vínculo', async () => {
    renderPanel()
    await waitFor(() => {
      expect(screen.getByTestId('opportunities-section').textContent).toBe('42')
    })
  })

  it('LP-05: notas exigem lead associado', async () => {
    adapterSpies.resolveAssociatedLead.mockResolvedValue(null)
    renderPanel()
    await waitFor(() => screen.getByText('Notas'))
    fireEvent.click(screen.getByText('Notas'))
    expect(screen.getByText('Nenhum lead associado a esta conversa.')).toBeTruthy()
    expect(screen.queryByTestId('internal-notes')).toBeNull()
  })

  it('LP-06: resumo IA só aparece quando conversation.lead_id existe', async () => {
    renderPanel()
    await waitFor(() => screen.getByText('Notas'))
    fireEvent.click(screen.getByText('Notas'))
    expect(screen.getByText('Resumir com IA')).toBeTruthy()
    expect(screen.getByTestId('internal-notes').textContent).toBe('42')
  })

  it('LP-06b: sem conversation.lead_id não mostra resumo IA mesmo com lead resolvido por telefone', async () => {
    adapterSpies.loadConversation.mockResolvedValue({ ...CONV_ROW, lead_id: null })
    renderPanel()
    await waitFor(() => screen.getByText('Notas'))
    fireEvent.click(screen.getByText('Notas'))
    expect(screen.queryByText('Resumir com IA')).toBeNull()
    expect(screen.getByTestId('internal-notes').textContent).toBe('42')
  })

  it('LP-07: Biblioteca recebe o conversationId da conversa atual', async () => {
    renderPanel()
    await waitFor(() => screen.getByText('leadPanel.tabs.library'))
    fireEvent.click(screen.getByText('leadPanel.tabs.library'))
    expect(screen.getByTestId('biblioteca-v2').textContent).toBe(CONV_A)
  })

  it('LP-08: aba Agendar monta o fluxo quando a conversa tem instance_id', async () => {
    renderPanel()
    await waitFor(() => screen.getByText('leadPanel.tabs.schedule'))
    fireEvent.click(screen.getByText('leadPanel.tabs.schedule'))
    expect(screen.getByText('leadPanel.schedule.scheduleMessageOpen')).toBeTruthy()
    expect(screen.getByText('leadPanel.schedule.activities')).toBeTruthy()
  })

  it('LP-09: conversa ausente mantém as abas e não monta oportunidades', async () => {
    adapterSpies.loadConversation.mockResolvedValue(null)
    renderPanel()
    await waitFor(() => screen.getByText('leadPanel.tabs.info'))
    expect(screen.queryByTestId('opportunities-section')).toBeNull()
    expect(adapterSpies.loadContact).not.toHaveBeenCalled()
  })

  it('LP-10: troca rápida de conversa recria o adapter Uazapi com o novo id', async () => {
    const view = renderPanel({ conversationId: CONV_A })
    await waitFor(() => expect(adapterSpies.loadConversation).toHaveBeenCalledTimes(1))

    view.rerender(
      <LeadPanel
        conversationId={CONV_B}
        companyId={COMPANY_ID}
        userId="user-1"
      />
    )

    await waitFor(() => {
      expect(createUazapiChannelAdapterMock).toHaveBeenCalledWith({
        conversationId: CONV_B,
        companyId: COMPANY_ID,
      })
      expect(adapterSpies.loadConversation.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('LP-11: adapter injetado é usado e o factory Uazapi não é chamado', async () => {
    const injectedLoad = vi.fn().mockResolvedValue(CONV_ROW)
    const injected: ChannelCrmAdapter = makeAdapter(CONV_A, COMPANY_ID, {
      loadConversation: injectedLoad,
    })

    renderPanel({ adapter: injected })

    await waitFor(() => expect(injectedLoad).toHaveBeenCalledTimes(1))
    expect(createUazapiChannelAdapterMock).not.toHaveBeenCalled()
  })

  it('LP-12: erro no carregamento encerra o loading sem throw', async () => {
    adapterSpies.loadConversation.mockRejectedValue(new Error('falha de rede'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderPanel()
    await waitFor(() => {
      expect(screen.queryByText('leadPanel.loading')).toBeNull()
    })
    expect(screen.getByText('leadPanel.tabs.info')).toBeTruthy()
    spy.mockRestore()
  })
})
