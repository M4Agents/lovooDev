// =============================================================================
// uazapiChannelAdapter.test.ts — META-L1.3
//
// Caracteriza o carregamento de canal Uazapi extraído do LeadPanel:
//   UA-01  canal e capabilities Uazapi
//   UA-02  conversa filtrada por id + company_id
//   UA-03  conversa ausente → null
//   UA-04  lead_id explícito tem prioridade
//   UA-05  fallback por telefone (phone_normalized, limit 1)
//   UA-06  segundo fallback por phone quando normalized não acha
//   UA-07  sem lead_id e sem telefone → null, sem query de phone
//   UA-08  lead_id inexistente cai no fallback por telefone
//   UA-09  tempo médio inbound→outbound
//   UA-10  menos de 2 mensagens → '--'
//   UA-11  contato e agendadas via chatApi existente
//   UA-12  nunca consulta tabelas Meta
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { brMobilePhoneLookupValues } from '../../../../lib/phone/canonicalizeBrMobile'

const { mockFrom, mockGetContactInfo, mockGetScheduledMessages } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetContactInfo: vi.fn(),
  mockGetScheduledMessages: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: mockFrom },
}))

vi.mock('../../../../services/chat/chatApi', () => ({
  chatApi: {
    getContactInfo: mockGetContactInfo,
    getScheduledMessages: mockGetScheduledMessages,
  },
}))

import {
  UAZAPI_CHANNEL_CAPABILITIES,
  createUazapiChannelAdapter,
} from '../uazapiChannelAdapter'

const COMPANY_ID = 'company-test-001'
const CONV_ID = 'conv-uazapi-001'
const PHONE = '5511999887766'

const LEAD = {
  id: 42,
  name: 'Lead Cadastro',
  phone: PHONE,
  email: 'lead@example.com',
  responsible_user_id: 'user-1',
}

function chain(result: { data: unknown; error: unknown }, extras?: {
  onSelect?: (arg: string) => void
  onEq?: (col: string, val: unknown) => void
  onIs?: (col: string, val: unknown) => void
  onIn?: (col: string, val: unknown) => void
  onLimit?: (n: number) => void
  onOrder?: (col: string, opts: unknown) => void
}) {
  const api: Record<string, unknown> = {}
  api.select = vi.fn((arg: string) => {
    extras?.onSelect?.(arg)
    return api
  })
  api.eq = vi.fn((col: string, val: unknown) => {
    extras?.onEq?.(col, val)
    return api
  })
  api.is = vi.fn((col: string, val: unknown) => {
    extras?.onIs?.(col, val)
    return api
  })
  api.in = vi.fn((col: string, val: unknown) => {
    extras?.onIn?.(col, val)
    return api
  })
  api.limit = vi.fn((n: number) => {
    extras?.onLimit?.(n)
    return api
  })
  api.order = vi.fn((col: string, opts: unknown) => {
    extras?.onOrder?.(col, opts)
    return api
  })
  api.maybeSingle = vi.fn(() => Promise.resolve(result))
  api.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected)
  return api
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetContactInfo.mockResolvedValue({
    id: 'contact-1',
    company_id: COMPANY_ID,
    phone_number: PHONE,
    name: 'Contato Uazapi',
    total_messages: 4,
    tags: [],
    custom_fields: {},
    created_at: new Date(),
    updated_at: new Date(),
  })
  mockGetScheduledMessages.mockResolvedValue([])
})

describe('UazapiChannelAdapter — contrato e capabilities', () => {
  it('UA-01: canal uazapi e capabilities do comportamento atual', () => {
    const adapter = createUazapiChannelAdapter({
      conversationId: CONV_ID,
      companyId: COMPANY_ID,
    })

    expect(adapter.channel).toBe('uazapi')
    expect(adapter.conversationId).toBe(CONV_ID)
    expect(adapter.companyId).toBe(COMPANY_ID)
    expect(adapter.capabilities).toEqual(UAZAPI_CHANNEL_CAPABILITIES)
    expect(adapter.capabilities.supportsPhoneFallback).toBe(true)
    expect(adapter.capabilities.supportsExplicitLink).toBe(false)
    expect(adapter.capabilities.supportsAutoCreateOnAssign).toBe(true)
    expect(adapter.capabilities.supportsContactUpdateByPhone).toBe(true)
    expect(adapter.capabilities.supportsChatAssignmentSync).toBe(true)
    expect(adapter.capabilities.canChangeConversationInstance).toBe(true)
    expect(adapter.capabilities.supportsScheduledWhatsApp).toBe(true)
  })
})

describe('UazapiChannelAdapter — conversa', () => {
  it('UA-02: SELECT * em chat_conversations com id e company_id', async () => {
    const eqs: Array<[string, unknown]> = []
    let selectArg = ''
    mockFrom.mockImplementation((table: string) => {
      expect(table).toBe('chat_conversations')
      return chain(
        { data: { id: CONV_ID, company_id: COMPANY_ID, contact_phone: PHONE }, error: null },
        {
          onSelect: (arg) => { selectArg = arg },
          onEq: (col, val) => eqs.push([col, val]),
        }
      )
    })

    const adapter = createUazapiChannelAdapter({
      conversationId: CONV_ID,
      companyId: COMPANY_ID,
    })
    const conv = await adapter.loadConversation()

    expect(selectArg).toBe('*')
    expect(eqs).toEqual([
      ['id', CONV_ID],
      ['company_id', COMPANY_ID],
    ])
    expect(conv?.id).toBe(CONV_ID)
    expect(conv?.contact_phone).toBe(PHONE)
  })

  it('UA-03: conversa ausente retorna null', async () => {
    mockFrom.mockReturnValue(chain({ data: null, error: null }))
    const adapter = createUazapiChannelAdapter({
      conversationId: CONV_ID,
      companyId: COMPANY_ID,
    })
    await expect(adapter.loadConversation()).resolves.toBeNull()
  })
})

describe('UazapiChannelAdapter — resolução de lead', () => {
  it('UA-04: lead_id explícito consulta leads por id + company_id e não usa telefone', async () => {
    const eqs: Array<[string, unknown]> = []
    let inCalled = false
    mockFrom.mockImplementation((table: string) => {
      expect(table).toBe('leads')
      return chain(
        { data: LEAD, error: null },
        {
          onEq: (col, val) => eqs.push([col, val]),
          onIn: () => { inCalled = true },
        }
      )
    })

    const adapter = createUazapiChannelAdapter({
      conversationId: CONV_ID,
      companyId: COMPANY_ID,
    })
    const lead = await adapter.resolveAssociatedLead({
      lead_id: 42,
      contact_phone: PHONE,
    })

    expect(lead).toEqual(LEAD)
    expect(eqs).toContainEqual(['id', 42])
    expect(eqs).toContainEqual(['company_id', COMPANY_ID])
    expect(inCalled).toBe(false)
  })

  it('UA-05: sem lead_id usa phone_normalized com lookup values e limit(1)', async () => {
    const inCalls: Array<{ col: string; values: unknown }> = []
    let limitN: number | null = null
    mockFrom.mockImplementation(() =>
      chain(
        { data: LEAD, error: null },
        {
          onIn: (col, val) => inCalls.push({ col, values: val }),
          onLimit: (n) => { limitN = n },
        }
      )
    )

    const adapter = createUazapiChannelAdapter({
      conversationId: CONV_ID,
      companyId: COMPANY_ID,
    })
    const lead = await adapter.resolveAssociatedLead({
      lead_id: null,
      contact_phone: PHONE,
    })

    expect(lead).toEqual(LEAD)
    expect(inCalls[0]?.col).toBe('phone_normalized')
    expect(inCalls[0]?.values).toEqual(brMobilePhoneLookupValues(PHONE))
    expect(limitN).toBe(1)
  })

  it('UA-06: se normalized não acha, consulta phone com as mesmas variantes', async () => {
    const inCols: string[] = []
    mockFrom.mockImplementation(() => {
      const isPhoneQuery = inCols.length >= 1
      return chain(
        { data: isPhoneQuery ? LEAD : null, error: null },
        {
          onIn: (col) => { inCols.push(col) },
        }
      )
    })

    const adapter = createUazapiChannelAdapter({
      conversationId: CONV_ID,
      companyId: COMPANY_ID,
    })
    const lead = await adapter.resolveAssociatedLead({
      contact_phone: PHONE,
    })

    expect(inCols).toEqual(['phone_normalized', 'phone'])
    expect(lead).toEqual(LEAD)
  })

  it('UA-07: sem lead_id e sem telefone não consulta leads', async () => {
    const adapter = createUazapiChannelAdapter({
      conversationId: CONV_ID,
      companyId: COMPANY_ID,
    })
    const lead = await adapter.resolveAssociatedLead({
      lead_id: null,
      contact_phone: null,
    })

    expect(lead).toBeNull()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('UA-08: lead_id sem registro cai no fallback por telefone', async () => {
    let call = 0
    mockFrom.mockImplementation(() => {
      call += 1
      if (call === 1) return chain({ data: null, error: null })
      return chain({ data: LEAD, error: null })
    })

    const adapter = createUazapiChannelAdapter({
      conversationId: CONV_ID,
      companyId: COMPANY_ID,
    })
    const lead = await adapter.resolveAssociatedLead({
      lead_id: 99,
      contact_phone: PHONE,
    })

    expect(lead).toEqual(LEAD)
    expect(call).toBeGreaterThan(1)
  })
})

describe('UazapiChannelAdapter — estatísticas e APIs Uazapi', () => {
  it('UA-09: tempo médio usa chat_messages inbound→próximo outbound', async () => {
    let selectArg = ''
    let orderArg: unknown = null
    mockFrom.mockImplementation((table: string) => {
      expect(table).toBe('chat_messages')
      return chain(
        {
          data: [
            { timestamp: '2026-01-01T10:00:00.000Z', direction: 'inbound' },
            { timestamp: '2026-01-01T10:05:00.000Z', direction: 'outbound' },
          ],
          error: null,
        },
        {
          onSelect: (arg) => { selectArg = arg },
          onOrder: (col, opts) => { orderArg = [col, opts] },
        }
      )
    })

    const adapter = createUazapiChannelAdapter({
      conversationId: CONV_ID,
      companyId: COMPANY_ID,
    })
    await expect(adapter.getAverageResponseTime()).resolves.toBe('5m')
    expect(selectArg).toBe('timestamp, direction')
    expect(orderArg).toEqual(['timestamp', { ascending: true }])
  })

  it('UA-10: menos de 2 mensagens retorna --', async () => {
    mockFrom.mockReturnValue(chain({
      data: [{ timestamp: '2026-01-01T10:00:00.000Z', direction: 'inbound' }],
      error: null,
    }))
    const adapter = createUazapiChannelAdapter({
      conversationId: CONV_ID,
      companyId: COMPANY_ID,
    })
    await expect(adapter.getAverageResponseTime()).resolves.toBe('--')
  })

  it('UA-11: contato e agendadas usam chatApi existente, sem payload novo', async () => {
    const adapter = createUazapiChannelAdapter({
      conversationId: CONV_ID,
      companyId: COMPANY_ID,
    })

    await adapter.loadContact(PHONE)
    await adapter.loadScheduledMessages()

    expect(mockGetContactInfo).toHaveBeenCalledWith(COMPANY_ID, PHONE)
    expect(mockGetScheduledMessages).toHaveBeenCalledWith(COMPANY_ID, CONV_ID)
  })

  it('UA-12: nenhuma consulta a tabelas Meta', async () => {
    const tables: string[] = []
    mockFrom.mockImplementation((table: string) => {
      tables.push(table)
      return chain({ data: null, error: null })
    })

    const adapter = createUazapiChannelAdapter({
      conversationId: CONV_ID,
      companyId: COMPANY_ID,
    })
    await adapter.loadConversation()
    await adapter.resolveAssociatedLead({ lead_id: 1, contact_phone: PHONE })
    await adapter.getAverageResponseTime()

    expect(tables.some((t) => t.startsWith('meta_'))).toBe(false)
    expect(tables).not.toContain('meta_conversations')
    expect(tables).not.toContain('meta_messages')
  })
})
