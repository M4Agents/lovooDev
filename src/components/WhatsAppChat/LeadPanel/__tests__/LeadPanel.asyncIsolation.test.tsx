// @vitest-environment jsdom
// Isolamento do carregamento do LeadPanel.
// A geração da requisição decide qual resposta pode pintar a tela.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChannelCrmAdapter, ChannelCrmCapabilities } from '../../../../types/channel-crm-adapter'
import { UAZAPI_CHANNEL_CAPABILITIES } from '../uazapiChannelAdapter'

const saveMode = vi.hoisted(() => ({ double: false }))
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
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}))

vi.mock('../../../../services/api', () => ({
  api: { createLead: vi.fn(), updateLead: vi.fn() },
}))

vi.mock('@emoji-mart/data', () => ({ default: {} }))
vi.mock('@emoji-mart/react', () => ({ default: () => null }))

vi.mock('../../../LeadModal', () => ({
  LeadModal: ({
    isOpen,
    onSave,
  }: {
    isOpen: boolean
    onSave: () => Promise<void>
  }) =>
    isOpen ? (
      <button
        type="button"
        onClick={() => {
          void onSave()
          if (saveMode.double) void onSave()
        }}
      >
        salvar-lead
      </button>
    ) : null,
}))

vi.mock('../../../Calendar/ActivityModal', () => ({ ActivityModal: () => null }))
vi.mock('../../../TagSelectorPopover', () => ({ TagSelectorPopover: () => null }))
vi.mock('../../../InternalNotes', () => ({
  InternalNotes: ({ leadId }: { leadId: number }) => (
    <div data-testid="internal-notes">{leadId}</div>
  ),
}))
vi.mock('../BibliotecaV2', () => ({
  BibliotecaV2: () => <div data-testid="biblioteca-v2" />,
}))
vi.mock('../OpportunitiesSection', () => ({
  OpportunitiesSection: ({
    leadId,
    leadName,
  }: {
    leadId?: number | null
    leadName?: string
  }) => (
    <div data-testid="opportunities-section">{`${leadId ?? 'none'}|${leadName ?? ''}`}</div>
  ),
}))
vi.mock('../../InstanceSelector', () => ({ InstanceSelector: () => <div data-testid="instance-selector" /> }))
vi.mock('../../UserSelector', () => ({ UserSelector: () => <div data-testid="user-selector" /> }))
vi.mock('../uazapiChannelAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../uazapiChannelAdapter')>()
  return { ...actual, createUazapiChannelAdapter: createUazapiChannelAdapterMock }
})

import { LeadPanel } from '../LeadPanel'

const COMPANY_A = 'company-test-001'
const COMPANY_B = 'company-test-002'
const CONV_A = 'conv-async-aaa'
const CONV_B = 'conv-async-bbb'

interface Snapshot {
  leadId: number
  tag: string
  name: string
  phone: string
  conversationId: string
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function snapshot(partial: Snapshot) {
  return {
    tag: partial.tag,
    name: partial.name,
    conv: {
      id: partial.conversationId,
      instance_id: 'instance-1',
      contact_phone: partial.phone,
      contact_name: partial.name,
      lead_id: partial.leadId,
      company_name: partial.tag,
    },
    contact: {
      id: `contact-${partial.leadId}`,
      company_id: COMPANY_A,
      phone_number: partial.phone,
      name: partial.name,
      total_messages: 1,
      tags: [partial.tag],
      custom_fields: {},
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    },
    lead: {
      id: partial.leadId,
      name: partial.name,
      phone: partial.phone,
      responsible_user_id: 'user-1',
    },
  }
}

const SNAP_A = snapshot({
  leadId: 11,
  tag: 'tag-conversa-a',
  name: 'Nome Conversa A',
  phone: '5511900000011',
  conversationId: CONV_A,
})
const SNAP_B = snapshot({
  leadId: 22,
  tag: 'tag-conversa-b',
  name: 'Nome Conversa B',
  phone: '5511900000022',
  conversationId: CONV_B,
})
const SNAP_OLD = snapshot({
  leadId: 20,
  tag: 'tag-reload-antigo',
  name: 'Nome Reload Antigo',
  phone: '5511900000020',
  conversationId: CONV_A,
})
const SNAP_NEW = snapshot({
  leadId: 30,
  tag: 'tag-reload-novo',
  name: 'Nome Reload Novo',
  phone: '5511900000030',
  conversationId: CONV_A,
})
const SNAP_SAVED = snapshot({
  leadId: 99,
  tag: 'tag-lead-salvo',
  name: 'Nome Lead Salvo',
  phone: '5511900000099',
  conversationId: CONV_A,
})

function adapterFrom(
  loadConversation: ChannelCrmAdapter['loadConversation'],
  companyId = COMPANY_A,
  conversationId = CONV_A,
  capabilities: ChannelCrmCapabilities = UAZAPI_CHANNEL_CAPABILITIES
): ChannelCrmAdapter {
  return {
    channel: 'uazapi',
    conversationId,
    companyId,
    capabilities,
    loadConversation,
    loadContact: vi.fn(async (phone) => {
      const known = [SNAP_A, SNAP_B, SNAP_OLD, SNAP_NEW, SNAP_SAVED]
      return known.find((item) => item.contact.phone_number === phone)?.contact ?? null
    }),
    resolveAssociatedLead: vi.fn(async (conv) => {
      const known = [SNAP_A, SNAP_B, SNAP_OLD, SNAP_NEW, SNAP_SAVED]
      return known.find((item) => item.lead.id === conv.lead_id)?.lead ?? null
    }),
    getAverageResponseTime: vi.fn().mockResolvedValue('5m'),
    loadScheduledMessages: vi.fn().mockResolvedValue([]),
  }
}

function panel(props: {
  conversationId?: string
  companyId?: string
  adapter?: ChannelCrmAdapter
  onLeadSaved?: () => void
}) {
  return (
    <LeadPanel
      conversationId={props.conversationId ?? CONV_A}
      companyId={props.companyId ?? COMPANY_A}
      userId="user-1"
      adapter={props.adapter}
      onLeadSaved={props.onLeadSaved}
    />
  )
}

async function visible(marker: string) {
  await waitFor(() => expect(screen.getByText(marker)).toBeTruthy())
}

beforeEach(() => {
  saveMode.double = false
  createUazapiChannelAdapterMock.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('LeadPanel — isolamento assíncrono', () => {
  it('resposta da conversa A não pinta a conversa B', async () => {
    const first = deferred<typeof SNAP_A.conv | null>()
    const second = deferred<typeof SNAP_B.conv | null>()
    let call = 0
    const channel = adapterFrom(() => {
      call += 1
      return call === 1 ? first.promise : second.promise
    })
    const view = render(panel({ adapter: channel, conversationId: CONV_A }))

    view.rerender(panel({ adapter: channel, conversationId: CONV_B }))
    expect(screen.getByText('leadPanel.loading')).toBeTruthy()
    expect(screen.queryByText(SNAP_A.tag)).toBeNull()

    await act(async () => {
      second.resolve(SNAP_B.conv)
    })
    await visible(SNAP_B.tag)
    expect(screen.getByTestId('opportunities-section').textContent).toBe('22|Nome Conversa B')

    await act(async () => {
      first.resolve(SNAP_A.conv)
      await first.promise
    })
    expect(screen.getByText(SNAP_B.tag)).toBeTruthy()
    expect(screen.queryByText(SNAP_A.tag)).toBeNull()
    expect(screen.getByTestId('opportunities-section').textContent).toBe('22|Nome Conversa B')
  })

  it('resposta da empresa A não pinta a empresa B', async () => {
    const first = deferred<typeof SNAP_A.conv | null>()
    const second = deferred<typeof SNAP_B.conv | null>()
    let call = 0
    const channel = adapterFrom(() => {
      call += 1
      return call === 1 ? first.promise : second.promise
    })
    const view = render(panel({ adapter: channel, companyId: COMPANY_A }))

    view.rerender(panel({ adapter: channel, companyId: COMPANY_B }))
    expect(screen.queryByText(SNAP_A.tag)).toBeNull()
    expect(screen.queryByText('leadPanel.tabs.info')).toBeNull()

    await act(async () => {
      second.resolve(SNAP_B.conv)
    })
    await visible(SNAP_B.tag)

    await act(async () => {
      first.resolve(SNAP_A.conv)
      await first.promise
    })
    expect(screen.getByText(SNAP_B.tag)).toBeTruthy()
    expect(screen.queryByText(SNAP_A.tag)).toBeNull()
    expect(screen.getByTestId('opportunities-section').textContent).toBe('22|Nome Conversa B')
  })

  it('resposta antiga nula não apaga a conversa atual', async () => {
    const first = deferred<typeof SNAP_A.conv | null>()
    const second = deferred<typeof SNAP_B.conv | null>()
    let call = 0
    const channel = adapterFrom(() => {
      call += 1
      return call === 1 ? first.promise : second.promise
    })
    const view = render(panel({ adapter: channel, conversationId: CONV_A }))
    view.rerender(panel({ adapter: channel, conversationId: CONV_B }))

    await act(async () => {
      second.resolve(SNAP_B.conv)
    })
    await visible(SNAP_B.tag)

    await act(async () => {
      first.resolve(null)
      await first.promise
    })
    expect(screen.getByTestId('opportunities-section').textContent).toBe('22|Nome Conversa B')
    expect(screen.getByText(SNAP_B.tag)).toBeTruthy()
  })

  it('erro da requisição atual não reapresenta o contexto anterior', async () => {
    const first = deferred<typeof SNAP_A.conv | null>()
    const second = deferred<typeof SNAP_B.conv | null>()
    let call = 0
    const channel = adapterFrom(() => {
      call += 1
      return call === 1 ? first.promise : second.promise
    })
    const view = render(panel({ adapter: channel, conversationId: CONV_A }))
    await act(async () => {
      first.resolve(SNAP_A.conv)
    })
    await visible(SNAP_A.tag)

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    view.rerender(panel({ adapter: channel, conversationId: CONV_B }))
    expect(screen.queryByText(SNAP_A.tag)).toBeNull()
    expect(screen.queryByText('leadPanel.tabs.info')).toBeNull()

    await act(async () => {
      second.reject(new Error('falha de rede'))
      await second.promise.catch(() => undefined)
    })

    await waitFor(() => expect(screen.getByText('leadPanel.tabs.info')).toBeTruthy())
    expect(screen.queryByText(SNAP_A.tag)).toBeNull()
    expect(screen.queryByTestId('opportunities-section')).toBeNull()
    fireEvent.click(screen.getByText('Notas'))
    expect(screen.getByText('Nenhum lead associado a esta conversa.')).toBeTruthy()
    expect(screen.queryByTestId('internal-notes')).toBeNull()
    consoleError.mockRestore()
  })

  it('finally antigo não desliga o loading da requisição atual', async () => {
    const first = deferred<typeof SNAP_A.conv | null>()
    const second = deferred<typeof SNAP_B.conv | null>()
    let call = 0
    const channel = adapterFrom(() => {
      call += 1
      return call === 1 ? first.promise : second.promise
    })
    const view = render(panel({ adapter: channel, companyId: COMPANY_A }))
    view.rerender(panel({ adapter: channel, companyId: COMPANY_B }))

    await act(async () => {
      first.resolve(SNAP_A.conv)
      await first.promise
    })

    expect(screen.queryByText('leadPanel.tabs.info')).toBeNull()
    expect(screen.getByText('leadPanel.loading')).toBeTruthy()
    expect(screen.queryByText(SNAP_A.tag)).toBeNull()

    await act(async () => {
      second.resolve(SNAP_B.conv)
    })
    await visible(SNAP_B.tag)
    expect(screen.queryByText(SNAP_A.tag)).toBeNull()
  })

  it('duas cargas do mesmo contexto fora de ordem mantêm a mais recente', async () => {
    const older = deferred<typeof SNAP_OLD.conv | null>()
    const newer = deferred<typeof SNAP_NEW.conv | null>()
    let call = 0
    const channel = adapterFrom(() => {
      call += 1
      if (call === 1) return Promise.resolve(SNAP_A.conv)
      if (call === 2) return older.promise
      return newer.promise
    })
    saveMode.double = true
    render(panel({ adapter: channel }))
    await visible(SNAP_A.tag)

    fireEvent.click(screen.getByText('leadPanel.contact.editLeadFull'))
    fireEvent.click(screen.getByText('salvar-lead'))

    await act(async () => {
      newer.resolve(SNAP_NEW.conv)
    })
    await visible(SNAP_NEW.tag)
    expect(screen.getByTestId('opportunities-section').textContent).toBe('30|Nome Reload Novo')

    await act(async () => {
      older.resolve(SNAP_OLD.conv)
      await older.promise
    })
    expect(screen.getByText(SNAP_NEW.tag)).toBeTruthy()
    expect(screen.queryByText(SNAP_OLD.tag)).toBeNull()
    expect(screen.queryByText(SNAP_A.tag)).toBeNull()
    expect(screen.getByTestId('opportunities-section').textContent).toBe('30|Nome Reload Novo')
  })

  it('unmount invalida a requisição pendente', async () => {
    const pending = deferred<typeof SNAP_A.conv | null>()
    const channel = adapterFrom(() => pending.promise)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = render(panel({ adapter: channel }))
    expect(screen.getByText('leadPanel.loading')).toBeTruthy()

    view.unmount()
    await act(async () => {
      pending.resolve(SNAP_A.conv)
      await pending.promise
    })

    expect(screen.queryByText(SNAP_A.tag)).toBeNull()
    expect(screen.queryByTestId('opportunities-section')).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('troca de adapter com os mesmos ids descarta a resposta do adapter anterior', async () => {
    const previous = deferred<typeof SNAP_A.conv | null>()
    const current = deferred<typeof SNAP_B.conv | null>()
    const first = adapterFrom(() => previous.promise, COMPANY_A, CONV_A)
    const second = adapterFrom(() => current.promise, COMPANY_A, CONV_A)
    const view = render(panel({ adapter: first, conversationId: CONV_A, companyId: COMPANY_A }))

    view.rerender(panel({ adapter: second, conversationId: CONV_A, companyId: COMPANY_A }))
    expect(screen.queryByText(SNAP_A.tag)).toBeNull()

    await act(async () => {
      current.resolve(SNAP_B.conv)
    })
    await visible(SNAP_B.tag)

    await act(async () => {
      previous.resolve(SNAP_A.conv)
      await previous.promise
    })
    expect(screen.getByText(SNAP_B.tag)).toBeTruthy()
    expect(screen.queryByText(SNAP_A.tag)).toBeNull()
    expect(screen.getByTestId('opportunities-section').textContent).toBe('22|Nome Conversa B')
  })

  it('onLeadSaved recarrega o mesmo contexto e publica o dado novo', async () => {
    const onLeadSaved = vi.fn()
    let call = 0
    const channel = adapterFrom(() => {
      call += 1
      return Promise.resolve(call === 1 ? SNAP_A.conv : SNAP_SAVED.conv)
    })
    render(panel({ adapter: channel, onLeadSaved }))
    await visible(SNAP_A.tag)

    fireEvent.click(screen.getByText('leadPanel.contact.editLeadFull'))
    fireEvent.click(screen.getByText('salvar-lead'))

    await visible(SNAP_SAVED.tag)
    expect(screen.getByTestId('opportunities-section').textContent).toBe('99|Nome Lead Salvo')
    expect(screen.queryByText(SNAP_A.tag)).toBeNull()
    expect(onLeadSaved).toHaveBeenCalledTimes(1)
  })

  it('sem adapter continua no factory Uazapi e mostra o painel atual', async () => {
    createUazapiChannelAdapterMock.mockImplementation((params: { conversationId: string; companyId: string }) =>
      adapterFrom(async () => SNAP_A.conv, params.companyId, params.conversationId)
    )

    render(
      <LeadPanel conversationId={CONV_A} companyId={COMPANY_A} userId="user-1" />
    )

    await waitFor(() => {
      expect(createUazapiChannelAdapterMock).toHaveBeenCalledWith({
        conversationId: CONV_A,
        companyId: COMPANY_A,
      })
    })
    await visible(SNAP_A.tag)
    expect(screen.getByText('leadPanel.tabs.info')).toBeTruthy()
    expect(screen.getByText('leadPanel.tabs.schedule')).toBeTruthy()
    expect(screen.getByText('leadPanel.tabs.library')).toBeTruthy()
    expect(screen.getByText('Notas')).toBeTruthy()
    expect(screen.getByTestId('opportunities-section').textContent).toBe('11|Nome Conversa A')
    expect(screen.getByText('leadPanel.contact.sendingInstance')).toBeTruthy()
    expect(screen.getByText('leadPanel.contact.noInstances')).toBeTruthy()
  })
})
