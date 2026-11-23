// @vitest-environment jsdom
// Capabilities decidem as mutações de canal. O nome do provider não autoriza.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChannelCrmAdapter, ChannelCrmCapabilities } from '../../../../types/channel-crm-adapter'
import { UAZAPI_CHANNEL_CAPABILITIES } from '../uazapiChannelAdapter'

const permissions = vi.hoisted(() => ({
  canEditLead: vi.fn(() => true),
  canAssignLead: vi.fn(() => true),
  canReassignOwnLeads: vi.fn(() => false),
}))

const chatApiMock = vi.hoisted(() => ({
  getCompanyInstances: vi.fn(),
  updateContactInfo: vi.fn(),
  uploadMedia: vi.fn(),
  scheduleMessage: vi.fn(),
  cancelScheduledMessage: vi.fn(),
  supabase: { rpc: vi.fn() },
}))

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  auth: { getSession: vi.fn() },
}))

const apiMock = vi.hoisted(() => ({
  createLead: vi.fn(),
  updateLead: vi.fn(),
}))

const fetchMock = vi.hoisted(() => vi.fn())
const createUazapiChannelAdapterMock = vi.hoisted(() => vi.fn())

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
  useLeadPermissions: () => permissions,
}))

vi.mock('../../../../services/chat/chatApi', () => ({ chatApi: chatApiMock }))
vi.mock('../../../../lib/supabase', () => ({ supabase: supabaseMock }))
vi.mock('../../../../services/api', () => ({ api: apiMock }))
vi.mock('@emoji-mart/data', () => ({ default: {} }))
vi.mock('@emoji-mart/react', () => ({ default: () => null }))

vi.mock('../../../LeadModal', () => ({
  LeadModal: () => <div data-testid="lead-modal" />,
}))
vi.mock('../../../Calendar/ActivityModal', () => ({
  ActivityModal: () => <div data-testid="activity-modal" />,
}))
vi.mock('../../../TagSelectorPopover', () => ({ TagSelectorPopover: () => null }))
vi.mock('../../../InternalNotes', () => ({
  InternalNotes: ({ leadId }: { leadId: number }) => <div data-testid="internal-notes">{leadId}</div>,
}))
vi.mock('../BibliotecaV2', () => ({
  BibliotecaV2: () => <div data-testid="biblioteca-v2" />,
}))
vi.mock('../uazapiChannelAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../uazapiChannelAdapter')>()
  return {
    ...actual,
    createUazapiChannelAdapter: createUazapiChannelAdapterMock,
  }
})
vi.mock('../OpportunitiesSection', () => ({
  OpportunitiesSection: ({ leadId }: { leadId?: number | null }) => (
    <div data-testid="opportunities-section">{leadId == null ? 'none' : String(leadId)}</div>
  ),
}))
vi.mock('../../InstanceSelector', () => ({
  InstanceSelector: ({ onSelectInstance }: { onSelectInstance: (id: string) => void }) => (
    <button type="button" onClick={() => onSelectInstance('instance-2')}>trocar-instancia</button>
  ),
}))
vi.mock('../../UserSelector', () => ({
  UserSelector: ({
    onSelectUser,
    disabled,
  }: {
    onSelectUser: (id: string) => void
    disabled?: boolean
  }) => (
    <button type="button" disabled={disabled} onClick={() => onSelectUser('user-2')}>
      atribuir-responsavel
    </button>
  ),
}))

import { LeadPanel } from '../LeadPanel'

const COMPANY_ID = 'company-test-001'
const CONV_A = 'conv-uazapi-aaa'

const BLOCKED: ChannelCrmCapabilities = {
  supportsPhoneFallback: false,
  supportsExplicitLink: false,
  supportsAutoCreateOnAssign: false,
  supportsContactUpdateByPhone: false,
  supportsChatAssignmentSync: false,
  canChangeConversationInstance: false,
  supportsScheduledWhatsApp: false,
  supportsConversationMediaLibrary: false,
  supportsAiSummarize: false,
  supportsLibraryDropToComposer: false,
}

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

const LEAD = {
  id: 42,
  name: 'Lead Cadastro',
  phone: '5511999887766',
  email: 'lead@example.com',
  responsible_user_id: 'user-1',
}

const PENDING_SCHEDULE = {
  id: 'sched-1',
  conversation_id: CONV_A,
  company_id: COMPANY_ID,
  instance_id: 'instance-1',
  created_by: 'user-1',
  message_type: 'text' as const,
  content: 'lembrete',
  scheduled_for: new Date('2026-12-01T12:00:00.000Z'),
  status: 'pending' as const,
  recurring_type: 'none' as const,
  recurring_config: {},
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
}

function leadQuery(data: unknown) {
  const api: Record<string, unknown> = {}
  api.select = () => api
  api.eq = () => api
  api.is = () => api
  api.maybeSingle = () => Promise.resolve({ data, error: null })
  return api
}

function adapter(
  caps: ChannelCrmCapabilities,
  channel: ChannelCrmAdapter['channel'] = 'uazapi',
  conversation: Record<string, unknown> | null = CONV_ROW
): ChannelCrmAdapter {
  return {
    channel,
    conversationId: CONV_A,
    companyId: COMPANY_ID,
    capabilities: caps,
    loadConversation: vi.fn().mockResolvedValue(conversation),
    loadContact: vi.fn().mockResolvedValue(conversation ? CONTACT : null),
    resolveAssociatedLead: vi.fn().mockResolvedValue(conversation ? LEAD : null),
    getAverageResponseTime: vi.fn().mockResolvedValue('5m'),
    loadScheduledMessages: vi.fn().mockResolvedValue(caps.supportsScheduledWhatsApp ? [PENDING_SCHEDULE] : []),
  }
}

function renderWith(next: ChannelCrmAdapter) {
  return render(
    <LeadPanel
      conversationId={CONV_A}
      companyId={COMPANY_ID}
      userId="user-1"
      adapter={next}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  permissions.canEditLead.mockReturnValue(true)
  permissions.canAssignLead.mockReturnValue(true)
  permissions.canReassignOwnLeads.mockReturnValue(false)
  chatApiMock.getCompanyInstances.mockResolvedValue([
    { id: 'instance-1', instance_name: 'Instancia A' },
    { id: 'instance-2', instance_name: 'Instancia B' },
  ])
  chatApiMock.updateContactInfo.mockResolvedValue(undefined)
  chatApiMock.uploadMedia.mockResolvedValue('https://files.example.test/nota.txt')
  chatApiMock.scheduleMessage.mockResolvedValue(undefined)
  chatApiMock.cancelScheduledMessage.mockResolvedValue(undefined)
  chatApiMock.supabase.rpc.mockResolvedValue({ data: { success: true }, error: null })
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'leads') return leadQuery(null)
    const chain: Record<string, unknown> = {}
    chain.update = () => chain
    chain.eq = () => chain
    chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(resolve, reject)
    return chain
  })
  supabaseMock.rpc.mockResolvedValue({ data: [{ id: 'user-2', email: 'user-2@example.test' }], error: null })
  supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'session-token' } } })
  apiMock.createLead.mockResolvedValue({ id: 77 })
  apiMock.updateLead.mockResolvedValue({})
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
  createUazapiChannelAdapterMock.mockImplementation(() => adapter(UAZAPI_CHANNEL_CAPABILITIES))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('confirm', vi.fn(() => true))
  vi.stubGlobal('alert', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openInfo(next: ChannelCrmAdapter) {
  renderWith(next)
  await waitFor(() => expect(screen.getByText('leadPanel.tabs.info')).toBeTruthy())
  await waitFor(() => expect(screen.getByText('atribuir-responsavel')).toBeTruthy())
}

describe('LeadPanel — capabilities', () => {
  it('sem adapter explícito usa o factory Uazapi e mantém as ações do canal', async () => {
    render(
      <LeadPanel conversationId={CONV_A} companyId={COMPANY_ID} userId="user-1" />
    )
    await waitFor(() => {
      expect(createUazapiChannelAdapterMock).toHaveBeenCalledWith({
        conversationId: CONV_A,
        companyId: COMPANY_ID,
      })
    })
    await waitFor(() => expect(screen.getByText('trocar-instancia')).toBeTruthy())
    expect(screen.getByText('leadPanel.tabs.schedule')).toBeTruthy()
    expect(screen.getByText('leadPanel.tabs.library')).toBeTruthy()
  })

  it('capabilities Uazapi, mesmo com channel meta, ainda trocam a instância', async () => {
    await openInfo(adapter(UAZAPI_CHANNEL_CAPABILITIES, 'meta'))
    await waitFor(() => expect(screen.getByText('trocar-instancia')).toBeTruthy())
    fireEvent.click(screen.getByText('trocar-instancia'))
    await waitFor(() => {
      expect(chatApiMock.supabase.rpc).toHaveBeenCalledWith(
        'change_conversation_instance',
        expect.objectContaining({
          p_conversation_id: CONV_A,
          p_new_instance_id: 'instance-2',
          p_company_id: COMPANY_ID,
        })
      )
    })
  })

  it('capabilities desligadas não executam mutações Uazapi, mesmo com channel uazapi', async () => {
    const blocked = adapter(BLOCKED, 'uazapi')
    await openInfo(blocked)

    expect(screen.queryByText('trocar-instancia')).toBeNull()
    expect(screen.queryByText('leadPanel.tabs.library')).toBeNull()
    expect(chatApiMock.getCompanyInstances).not.toHaveBeenCalled()
    expect(chatApiMock.updateContactInfo).not.toHaveBeenCalled()
    expect(supabaseMock.from).not.toHaveBeenCalledWith('leads')
    expect(blocked.loadScheduledMessages).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('atribuir-responsavel'))
    expect(apiMock.createLead).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('leadPanel.tabs.schedule'))
    expect(screen.queryByText('leadPanel.schedule.scheduleMessageOpen')).toBeNull()
    expect(screen.getByText('leadPanel.schedule.activities')).toBeTruthy()
    fireEvent.click(screen.getByText('leadPanel.schedule.activities'))
    expect(screen.getByTestId('activity-modal')).toBeTruthy()
    expect(chatApiMock.scheduleMessage).not.toHaveBeenCalled()
    expect(chatApiMock.uploadMedia).not.toHaveBeenCalled()
    expect(chatApiMock.cancelScheduledMessage).not.toHaveBeenCalled()
    expect(chatApiMock.supabase.rpc).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Notas'))
    expect(screen.queryByText('Resumir com IA')).toBeNull()
    expect(screen.getByTestId('internal-notes').textContent).toBe('42')
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/chat/summarize-lead-note',
      expect.anything()
    )
    expect(screen.queryByTestId('biblioteca-v2')).toBeNull()
  })

  it('com lead já resolvido, a atribuição atualiza o lead e não cria outro nem sincroniza o chat', async () => {
    const caps = { ...BLOCKED, supportsPhoneFallback: false }
    await openInfo(adapter(caps))
    fireEvent.click(screen.getByText('atribuir-responsavel'))
    await waitFor(() => expect(apiMock.updateLead).toHaveBeenCalledWith(42, expect.objectContaining({
      company_id: COMPANY_ID,
      responsible_user_id: 'user-2',
    })))
    expect(apiMock.createLead).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/leads/sync-chat-assignment',
      expect.anything()
    )
  })

  it('Uazapi sem lead no telefone cria o lead e não sincroniza atribuição de chat', async () => {
    const current = adapter(UAZAPI_CHANNEL_CAPABILITIES, 'uazapi', { ...CONV_ROW, lead_id: null })
    current.resolveAssociatedLead = vi.fn().mockResolvedValue(null)
    await openInfo(current)
    fireEvent.click(screen.getByText('atribuir-responsavel'))
    await waitFor(() => expect(apiMock.createLead).toHaveBeenCalledWith(expect.objectContaining({
      company_id: COMPANY_ID,
      phone: CONV_ROW.contact_phone,
      responsible_user_id: 'user-2',
    })))
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/leads/sync-chat-assignment',
      expect.anything()
    )
  })

  it('Uazapi com lead encontrado por telefone atualiza o responsável e sincroniza o chat', async () => {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return leadQuery({ id: 42, responsible_user_id: 'user-1', phone: CONV_ROW.contact_phone })
      }
      const chain: Record<string, unknown> = {}
      chain.update = () => chain
      chain.eq = () => chain
      chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(resolve, reject)
      return chain
    })
    await openInfo(adapter(UAZAPI_CHANNEL_CAPABILITIES))
    fireEvent.click(screen.getByText('atribuir-responsavel'))
    await waitFor(() => expect(apiMock.updateLead).toHaveBeenCalled())
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/leads/sync-chat-assignment',
        expect.objectContaining({ method: 'POST' })
      )
    })
    expect(apiMock.createLead).not.toHaveBeenCalled()
  })

  it('permissão de atribuição continua obrigatória com a capability ligada', async () => {
    permissions.canAssignLead.mockReturnValue(false)
    await openInfo(adapter(UAZAPI_CHANNEL_CAPABILITIES))
    const button = screen.getByText('atribuir-responsavel') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(apiMock.createLead).not.toHaveBeenCalled()
    expect(apiMock.updateLead).not.toHaveBeenCalled()
  })

  it('agendamento Uazapi ainda envia, faz upload e cancela', async () => {
    await openInfo(adapter(UAZAPI_CHANNEL_CAPABILITIES))
    fireEvent.click(screen.getByText('leadPanel.tabs.schedule'))
    fireEvent.click(screen.getByText('leadPanel.schedule.scheduleMessageOpen'))
    fireEvent.change(screen.getByPlaceholderText('leadPanel.schedule.messagePlaceholder'), {
      target: { value: 'ola' },
    })
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, {
      target: { value: '2026-12-02' },
    })
    fireEvent.change(document.querySelector('input[type="time"]') as HTMLInputElement, {
      target: { value: '09:30' },
    })
    fireEvent.click(screen.getByText('leadPanel.schedule.upload'))
    const file = new File(['nota'], 'nota.txt', { type: 'text/plain' })
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    })
    fireEvent.click(screen.getByText('leadPanel.schedule.confirmSchedule'))
    await waitFor(() => expect(chatApiMock.uploadMedia).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(chatApiMock.scheduleMessage).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: /cancelShort/ }))
    fireEvent.click(screen.getByRole('button', { name: /modalConfirmCancel/ }))
    await waitFor(() => {
      expect(chatApiMock.cancelScheduledMessage).toHaveBeenCalledWith('sched-1', COMPANY_ID)
    })
  })

  it('resumo de IA continua disponível na Uazapi e ausente quando a capability está desligada', async () => {
    await openInfo(adapter(UAZAPI_CHANNEL_CAPABILITIES))
    fireEvent.click(screen.getByText('Notas'))
    fireEvent.click(screen.getByText('Resumir com IA'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chat/summarize-lead-note',
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  it('troca de adapter não conserva lead da conversa anterior', async () => {
    const first = adapter(UAZAPI_CHANNEL_CAPABILITIES)
    const view = renderWith(first)
    await waitFor(() => expect(screen.getByTestId('opportunities-section').textContent).toBe('42'))

    const second = adapter(BLOCKED, 'uazapi', null)
    view.rerender(
      <LeadPanel
        conversationId="conv-uazapi-bbb"
        companyId={COMPANY_ID}
        userId="user-1"
        adapter={second}
      />
    )

    await waitFor(() => expect(screen.getByText('Notas')).toBeTruthy())
    expect(screen.queryByTestId('opportunities-section')).toBeNull()
    fireEvent.click(screen.getByText('Notas'))
    expect(screen.getByText('Nenhum lead associado a esta conversa.')).toBeTruthy()
    expect(screen.queryByTestId('internal-notes')).toBeNull()
    expect(screen.queryByTestId('biblioteca-v2')).toBeNull()
  })

  it('LeadModal e oportunidades permanecem com as mutações de canal desligadas', async () => {
    await openInfo(adapter(BLOCKED))
    expect(screen.getByTestId('opportunities-section').textContent).toBe('42')
    fireEvent.click(screen.getByText('leadPanel.contact.editLeadFull'))
    expect(screen.getByTestId('lead-modal')).toBeTruthy()
    expect(chatApiMock.updateContactInfo).not.toHaveBeenCalled()
    expect(apiMock.createLead).not.toHaveBeenCalled()
  })
})
