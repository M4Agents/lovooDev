// @vitest-environment jsdom
// Adapter Meta: sem tabelas Uazapi, sem fallback por telefone, referência estável.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MetaChatConversation } from '../../../../types/meta-whatsapp'

const supabaseFrom = vi.hoisted(() => vi.fn())
const metaApi = vi.hoisted(() => ({
  getConversations: vi.fn(),
  searchConversationLeads: vi.fn(),
  linkConversationLead: vi.fn(),
}))
const chatApi = vi.hoisted(() => ({
  getContactInfo: vi.fn(),
  getScheduledMessages: vi.fn(),
  getCompanyInstances: vi.fn(),
  updateContactInfo: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: supabaseFrom },
}))
vi.mock('../../../../services/metaWhatsAppApi', () => ({
  metaWhatsAppApi: metaApi,
}))
vi.mock('../../../../services/chat/chatApi', () => ({ chatApi }))

import { createMetaChannelAdapter, useMetaChannelAdapter, META_CHANNEL_CAPABILITIES } from '../metaChannelAdapter'

const COMPANY_ID = 'company-test-001'
const CONV_ID = '11111111-1111-4111-8111-111111111111'

function metaRow(leadId: number | null): MetaChatConversation {
  return {
    id: CONV_ID,
    instance_id: 'instance-meta-1',
    wa_id: '5511900000011',
    contact_name: 'Contato Meta',
    status: 'active',
    unread_count: 0,
    last_message_at: null,
    last_message_preview: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    lead_id: leadId,
    profile_picture_url: null,
  }
}

function leadQuery(data: unknown) {
  const api: Record<string, unknown> = {}
  api.select = () => api
  api.eq = () => api
  api.is = () => api
  api.maybeSingle = () => Promise.resolve({ data, error: null })
  return api
}

beforeEach(() => {
  supabaseFrom.mockReset()
  metaApi.getConversations.mockReset()
  metaApi.searchConversationLeads.mockReset()
  metaApi.linkConversationLead.mockReset()
  chatApi.getContactInfo.mockReset()
  chatApi.getScheduledMessages.mockReset()
})

describe('metaChannelAdapter', () => {
  it('não consulta tabelas nem APIs Uazapi e não associa lead por telefone', async () => {
    supabaseFrom.mockImplementation((table: string) => {
      if (table !== 'leads') throw new Error(`tabela inesperada: ${table}`)
      return leadQuery({
        id: 42,
        name: 'Lead Vinculado',
        phone: '5511900000011',
        email: null,
        responsible_user_id: 'user-1',
      })
    })
    metaApi.getConversations.mockResolvedValue([metaRow(42)])
    const adapter = createMetaChannelAdapter({
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
    })

    const conversation = await adapter.loadConversation()
    const contact = await adapter.loadContact(conversation?.contact_phone)
    const lead = await adapter.resolveAssociatedLead({ lead_id: conversation?.lead_id, contact_phone: conversation?.contact_phone })
    const average = await adapter.getAverageResponseTime()
    const scheduled = await adapter.loadScheduledMessages()

    expect(conversation?.lead_id).toBe(42)
    expect(contact?.name).toBe('Contato Meta')
    expect(lead?.id).toBe(42)
    expect(average).toBe('--')
    expect(scheduled).toEqual([])
    expect(metaApi.getConversations).toHaveBeenCalledTimes(1)
    expect(metaApi.getConversations).toHaveBeenCalledWith(COMPANY_ID, { id: CONV_ID })
    expect(chatApi.getContactInfo).not.toHaveBeenCalled()
    expect(chatApi.getScheduledMessages).not.toHaveBeenCalled()
    expect(supabaseFrom).toHaveBeenCalledTimes(1)
    expect(supabaseFrom).toHaveBeenCalledWith('leads')
  })

  it('sem lead_id não consulta leads', async () => {
    metaApi.getConversations.mockResolvedValue([metaRow(null)])
    const adapter = createMetaChannelAdapter({
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
    })
    const conversation = await adapter.loadConversation()
    const lead = await adapter.resolveAssociatedLead(conversation ?? {})
    expect(conversation?.lead_id).toBeNull()
    expect(lead).toBeNull()
    expect(supabaseFrom).not.toHaveBeenCalled()
  })

  it('capabilities Meta deixam as operações Uazapi desligadas e o vínculo explícito ligado', () => {
    expect(META_CHANNEL_CAPABILITIES).toEqual({
      supportsPhoneFallback: false,
      supportsExplicitLink: true,
      supportsAutoCreateOnAssign: false,
      supportsContactUpdateByPhone: false,
      supportsChatAssignmentSync: false,
      canChangeConversationInstance: false,
      supportsScheduledWhatsApp: false,
      supportsConversationMediaLibrary: false,
      supportsAiSummarize: false,
      supportsLibraryDropToComposer: false,
    })
  })

  it('mantém a mesma referência enquanto conversa e empresa não mudam', () => {
    const { result, rerender } = renderHook(
      (props: { companyId: string; conversationId: string | null }) =>
        useMetaChannelAdapter(props.companyId, props.conversationId, {
          beginCanonicalRead: () => null,
          publishCanonicalConversation: () => {},
        }),
      { initialProps: { companyId: COMPANY_ID, conversationId: CONV_ID } },
    )
    const first = result.current
    rerender({ companyId: COMPANY_ID, conversationId: CONV_ID })
    expect(result.current).toBe(first)

    rerender({ companyId: 'company-test-002', conversationId: CONV_ID })
    expect(result.current).not.toBe(first)
  })

  it('não conserva lead em memória depois do POST', async () => {
    metaApi.getConversations.mockResolvedValue([metaRow(null)])
    metaApi.linkConversationLead.mockResolvedValue({ status: 'linked', leadId: 7 })
    const adapter = createMetaChannelAdapter({
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
    })

    await adapter.linkExplicitLead?.({ leadId: 7, expectedLeadId: null }, () => true)
    const conversation = await adapter.loadConversation()

    expect(conversation?.lead_id).toBeNull()
    expect(metaApi.getConversations).toHaveBeenCalledWith(COMPANY_ID, { id: CONV_ID })
  })

  it('adapter recriado lê o lead persistido na releitura por id', async () => {
    metaApi.getConversations.mockResolvedValue([metaRow(42)])
    const first = createMetaChannelAdapter({
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
    })
    await first.loadConversation()

    const second = createMetaChannelAdapter({
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
    })
    const conversation = await second.loadConversation()

    expect(conversation?.lead_id).toBe(42)
    expect(metaApi.getConversations).toHaveBeenCalledTimes(2)
    expect(metaApi.getConversations).toHaveBeenNthCalledWith(2, COMPANY_ID, { id: CONV_ID })
  })
})
