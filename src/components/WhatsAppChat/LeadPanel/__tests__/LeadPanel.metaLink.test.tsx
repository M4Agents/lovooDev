// @vitest-environment jsdom
// O mesmo LeadPanel atende a Meta. O vínculo é explícito e não repete POST.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChannelCrmAdapter, ExplicitLinkResult } from '../../../../types/channel-crm-adapter'
import { META_CHANNEL_CAPABILITIES } from '../metaChannelAdapter'
import { UAZAPI_CHANNEL_CAPABILITIES } from '../uazapiChannelAdapter'

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
    userRoles: [],
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
    updateContactInfo: vi.fn(),
    scheduleMessage: vi.fn(),
    supabase: { rpc: vi.fn() },
  },
}))
vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.is = () => chain
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
      return chain
    }),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
}))
vi.mock('../../../../services/api', () => ({
  api: { createLead: vi.fn(), updateLead: vi.fn() },
}))
vi.mock('@emoji-mart/data', () => ({ default: {} }))
vi.mock('@emoji-mart/react', () => ({ default: () => null }))
vi.mock('../../../LeadModal', () => ({ LeadModal: () => null }))
vi.mock('../../../Calendar/ActivityModal', () => ({ ActivityModal: () => <div data-testid="activity-modal" /> }))
vi.mock('../../../TagSelectorPopover', () => ({ TagSelectorPopover: () => null }))
vi.mock('../../../InternalNotes', () => ({
  InternalNotes: ({ leadId }: { leadId: number }) => <div data-testid="internal-notes">{leadId}</div>,
}))
vi.mock('../BibliotecaV2', () => ({ BibliotecaV2: () => <div data-testid="biblioteca-v2" /> }))
vi.mock('../OpportunitiesSection', () => ({
  OpportunitiesSection: ({ leadId }: { leadId?: number | null }) => (
    <div data-testid="opportunities-section">{leadId == null ? 'none' : String(leadId)}</div>
  ),
}))
vi.mock('../../InstanceSelector', () => ({
  InstanceSelector: () => <button type="button">trocar-instancia</button>,
}))
vi.mock('../../UserSelector', () => ({
  UserSelector: ({ onSelectUser }: { onSelectUser: (id: string) => void }) => (
    <button type="button" onClick={() => onSelectUser('user-2')}>atribuir-responsavel</button>
  ),
}))
vi.mock('../uazapiChannelAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../uazapiChannelAdapter')>()
  return { ...actual, createUazapiChannelAdapter: createUazapiChannelAdapterMock }
})

import { LeadPanel } from '../LeadPanel'
import { api } from '../../../../services/api'

const COMPANY_A = 'company-test-001'
const COMPANY_B = 'company-test-002'
const CONV_A = '11111111-1111-4111-8111-111111111111'
const CONV_B = '22222222-2222-4222-8222-222222222222'

function conversation(id: string, leadId: number | null) {
  return {
    id,
    instance_id: 'instance-meta-1',
    contact_phone: '5511900000011',
    contact_name: 'Contato Meta',
    lead_id: leadId,
    company_name: null,
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function metaAdapter(options: {
  companyId?: string
  conversationId?: string
  leadId?: number | null
  link?: ChannelCrmAdapter['linkExplicitLead']
  search?: ChannelCrmAdapter['searchLinkableLeads']
}): ChannelCrmAdapter {
  const leadId = options.leadId ?? null
  const loadConversation = vi.fn(async () => conversation(options.conversationId ?? CONV_A, leadId))
  return {
    channel: 'meta',
    conversationId: options.conversationId ?? CONV_A,
    companyId: options.companyId ?? COMPANY_A,
    capabilities: META_CHANNEL_CAPABILITIES,
    loadConversation,
    loadContact: vi.fn(async () => null),
    resolveAssociatedLead: vi.fn(async () => (
      leadId == null
        ? null
        : { id: leadId, name: 'Lead Vinculado', phone: '5511900000011', responsible_user_id: 'user-1' }
    )),
    getAverageResponseTime: vi.fn(async () => '--'),
    loadScheduledMessages: vi.fn(async () => []),
    searchLinkableLeads: options.search ?? vi.fn(async () => ([
      { id: 7, name: 'Lead Busca', phone: null, email: null },
    ])),
    linkExplicitLead: options.link ?? vi.fn(async () => ({ status: 'linked', leadId: 7 })),
  }
}

function renderMeta(adapter: ChannelCrmAdapter, companyId = adapter.companyId) {
  return render(
    <LeadPanel
      conversationId={adapter.conversationId}
      companyId={companyId}
      userId="user-1"
      adapter={adapter}
    />,
  )
}

async function chooseLead() {
  await waitFor(() => expect(screen.getByText('Vincular lead')).toBeTruthy())
  fireEvent.click(screen.getByText('Vincular lead'))
  fireEvent.change(screen.getByLabelText('busca-lead'), { target: { value: 'ana' } })
  fireEvent.click(screen.getByText('Buscar'))
  await waitFor(() => expect(screen.getByText('Lead Busca')).toBeTruthy())
  fireEvent.click(screen.getByText('Lead Busca'))
}

beforeEach(() => {
  createUazapiChannelAdapterMock.mockReset()
  vi.mocked(api.createLead).mockReset()
})

afterEach(() => {
  cleanup()
})

describe('LeadPanel — vínculo Meta', () => {
  it('usa o mesmo painel e oferece vínculo quando a conversa não tem lead', async () => {
    renderMeta(metaAdapter({}))
    await waitFor(() => expect(screen.getByText('leadPanel.tabs.info')).toBeTruthy())
    expect(screen.getByText('Notas')).toBeTruthy()
    expect(screen.getByText('Vincular lead')).toBeTruthy()
    expect(screen.queryByTestId('opportunities-section')).toBeNull()
  })

  it('conversa vinculada mostra o lead e não oferece outro vínculo', async () => {
    renderMeta(metaAdapter({ leadId: 42 }))
    await waitFor(() => expect(screen.getByTestId('opportunities-section').textContent).toBe('42'))
    expect(screen.queryByText('Vincular lead')).toBeNull()
    fireEvent.click(screen.getByText('Notas'))
    expect(screen.getByTestId('internal-notes').textContent).toBe('42')
  })

  it('busca pelo adapter e só grava depois da confirmação', async () => {
    const search = vi.fn(async () => [{ id: 7, name: 'Lead Busca', phone: null, email: null }])
    const link = vi.fn(async (): Promise<ExplicitLinkResult> => ({ status: 'linked', leadId: 7 }))
    const adapter = metaAdapter({ search, link })
    renderMeta(adapter)
    await chooseLead()

    expect(search).toHaveBeenCalledWith('ana')
    expect(link).not.toHaveBeenCalled()
    expect(screen.getByText('Confirmar vínculo')).toBeTruthy()

    fireEvent.click(screen.getByText('Confirmar vínculo'))
    await waitFor(() => expect(link).toHaveBeenCalledTimes(1))
    expect(link).toHaveBeenCalledWith(
      { leadId: 7, expectedLeadId: null },
      expect.any(Function),
    )
    const payload = link.mock.calls[0][0] as { leadId: number; expectedLeadId: number | null }
    expect(payload).not.toHaveProperty('actor_user_id')
  })

  it('200 recarrega o painel com o lead persistido na releitura', async () => {
    let persistedLeadId: number | null = null
    const adapter = metaAdapter({})
    adapter.loadConversation = vi.fn(async () => conversation(CONV_A, persistedLeadId))
    adapter.resolveAssociatedLead = vi.fn(async () => (
      persistedLeadId == null
        ? null
        : { id: persistedLeadId, name: 'Lead Busca', responsible_user_id: 'user-1' }
    ))
    adapter.linkExplicitLead = vi.fn(async () => {
      persistedLeadId = 7
      return { status: 'linked' as const, leadId: 7 }
    })
    renderMeta(adapter)
    await chooseLead()
    expect(adapter.loadConversation).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Confirmar vínculo'))
    await waitFor(() => expect(screen.getByTestId('opportunities-section').textContent).toBe('7'))
    expect(adapter.loadConversation).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Vincular lead')).toBeNull()
  })

  it('409 relê o vínculo persistido e não repete o POST', async () => {
    let persistedLeadId: number | null = null
    const adapter = metaAdapter({})
    adapter.loadConversation = vi.fn(async () => conversation(CONV_A, persistedLeadId))
    adapter.resolveAssociatedLead = vi.fn(async () => (
      persistedLeadId == null
        ? null
        : { id: persistedLeadId, name: 'Lead Real', responsible_user_id: 'user-1' }
    ))
    adapter.linkExplicitLead = vi.fn(async () => {
      persistedLeadId = 11
      return { status: 'conflict' as const }
    })
    renderMeta(adapter)
    await chooseLead()
    fireEvent.click(screen.getByText('Confirmar vínculo'))
    await waitFor(() => expect(screen.getByTestId('opportunities-section').textContent).toBe('11'))
    expect(screen.getByText(/já foi vinculada/)).toBeTruthy()
    expect(adapter.linkExplicitLead).toHaveBeenCalledTimes(1)
    expect(adapter.loadConversation).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['forbidden', 'não tem permissão'],
    ['not_found', 'não está disponível'],
    ['error', 'Não foi possível vincular'],
  ] as const)('%s não simula sucesso', async (status, text) => {
    const link = vi.fn(async (): Promise<ExplicitLinkResult> => ({ status }))
    renderMeta(metaAdapter({ link }))
    await chooseLead()
    fireEvent.click(screen.getByText('Confirmar vínculo'))
    await waitFor(() => expect(screen.getByText(new RegExp(text))).toBeTruthy())
    expect(screen.queryByTestId('opportunities-section')).toBeNull()
    expect(link).toHaveBeenCalledTimes(1)
  })

  it('troca de conversa e de empresa descartam a seleção', async () => {
    const first = metaAdapter({ conversationId: CONV_A, companyId: COMPANY_A })
    const view = renderMeta(first)
    await chooseLead()
    expect(screen.getByText('Confirmar vínculo')).toBeTruthy()

    const nextConversation = metaAdapter({ conversationId: CONV_B, companyId: COMPANY_A })
    view.rerender(
      <LeadPanel
        conversationId={CONV_B}
        companyId={COMPANY_A}
        userId="user-1"
        adapter={nextConversation}
      />,
    )
    await waitFor(() => expect(screen.getByText('Vincular lead')).toBeTruthy())
    expect(screen.queryByText('Confirmar vínculo')).toBeNull()

    fireEvent.click(screen.getByText('Vincular lead'))
    const nextCompany = metaAdapter({ conversationId: CONV_B, companyId: COMPANY_B })
    view.rerender(
      <LeadPanel
        conversationId={CONV_B}
        companyId={COMPANY_B}
        userId="user-1"
        adapter={nextCompany}
      />,
    )
    await waitFor(() => expect(screen.getByText('Vincular lead')).toBeTruthy())
    expect(screen.queryByText('Confirmar vínculo')).toBeNull()
    expect(screen.queryByLabelText('busca-lead')).toBeNull()
  })

  it('confirmação pendente não dispara um segundo POST', async () => {
    const gate = deferred<ExplicitLinkResult>()
    const link = vi.fn(() => gate.promise)
    renderMeta(metaAdapter({ link }))
    await chooseLead()
    fireEvent.click(screen.getByText('Confirmar vínculo'))
    await waitFor(() => expect(screen.getByText('Vinculando...')).toBeTruthy())
    fireEvent.click(screen.getByText('Vinculando...'))
    expect(link).toHaveBeenCalledTimes(1)
    gate.resolve({ status: 'error' })
    await waitFor(() => expect(screen.getByText('Não foi possível vincular o lead.')).toBeTruthy())
  })

  it('sem adapter continua na Uazapi e não mostra o vínculo Meta', async () => {
    createUazapiChannelAdapterMock.mockImplementation((params: { conversationId: string; companyId: string }) => ({
      channel: 'uazapi',
      conversationId: params.conversationId,
      companyId: params.companyId,
      capabilities: UAZAPI_CHANNEL_CAPABILITIES,
      loadConversation: vi.fn(async () => conversation(params.conversationId, 42)),
      loadContact: vi.fn(async () => null),
      resolveAssociatedLead: vi.fn(async () => ({ id: 42, name: 'Lead Uazapi', responsible_user_id: 'user-1' })),
      getAverageResponseTime: vi.fn(async () => '5m'),
      loadScheduledMessages: vi.fn(async () => []),
    }))
    render(<LeadPanel conversationId={CONV_A} companyId={COMPANY_A} userId="user-1" />)
    await waitFor(() => expect(createUazapiChannelAdapterMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('leadPanel.tabs.library')).toBeTruthy())
    expect(screen.queryByText('Vincular lead')).toBeNull()
    expect(UAZAPI_CHANNEL_CAPABILITIES.supportsExplicitLink).toBe(false)
  })

  it('capabilities Meta bloqueiam instância, biblioteca, resumo e criação de lead', async () => {
    renderMeta(metaAdapter({ leadId: 42 }))
    await waitFor(() => expect(screen.getByText('leadPanel.tabs.info')).toBeTruthy())
    expect(screen.queryByText('trocar-instancia')).toBeNull()
    expect(screen.queryByText('leadPanel.tabs.library')).toBeNull()
    fireEvent.click(screen.getByText('Notas'))
    expect(screen.queryByText('Resumir com IA')).toBeNull()
    fireEvent.click(screen.getByText('leadPanel.tabs.info'))
    await waitFor(() => expect(screen.getByText('atribuir-responsavel')).toBeTruthy())
    fireEvent.click(screen.getByText('atribuir-responsavel'))
    expect(api.createLead).not.toHaveBeenCalled()
  })

  it('a mesma referência de adapter não recarrega em loop', async () => {
    const adapter = metaAdapter({})
    const view = renderMeta(adapter)
    await waitFor(() => expect(adapter.loadConversation).toHaveBeenCalledTimes(1))
    view.rerender(
      <LeadPanel
        conversationId={adapter.conversationId}
        companyId={adapter.companyId}
        userId="user-1"
        adapter={adapter}
      />,
    )
    await waitFor(() => expect(screen.getByText('Vincular lead')).toBeTruthy())
    expect(adapter.loadConversation).toHaveBeenCalledTimes(1)
  })
})
