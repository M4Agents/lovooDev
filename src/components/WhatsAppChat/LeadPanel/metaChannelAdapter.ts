// Adapter da conversa Meta para o LeadPanel compartilhado.
// Lê a conversa pela API já publicada. Não consulta chat Uazapi e não
// associa lead por telefone.

import { useMemo, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import { metaWhatsAppApi } from '../../../services/metaWhatsAppApi'
import type { MetaChatConversation } from '../../../types/meta-whatsapp'
import type { ChatContact, ChatScheduledMessage } from '../../../types/whatsapp-chat'
import type {
  AssociatedLeadSnapshot,
  ChannelConversationRow,
  ChannelCrmAdapter,
  ChannelCrmCapabilities,
  ChannelLeadLookupInput,
} from '../../../types/channel-crm-adapter'

export const META_CHANNEL_CAPABILITIES: ChannelCrmCapabilities = {
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
}

const ASSOCIATED_LEAD_SELECT = 'id, name, phone, email, responsible_user_id'

export interface CanonicalReadToken {
  seq: number
  epoch: number
  companyId: string
  instanceId: string
}

export interface MetaChannelAdapterParams {
  conversationId: string
  companyId: string
  /** Marca o início da leitura para o árbitro da lista. Não entra na identidade do adapter. */
  beginCanonicalRead?: () => CanonicalReadToken | null
  /** Publica a linha persistida depois do GET. Não entra na identidade do adapter. */
  publishCanonicalConversation?: (
    token: CanonicalReadToken,
    row: MetaChatConversation | null,
  ) => void
}

function toConversationRow(
  row: MetaChatConversation,
  leadId: number | null,
): ChannelConversationRow {
  return {
    id: row.id,
    instance_id: row.instance_id,
    contact_phone: row.wa_id,
    contact_name: row.contact_name,
    lead_id: leadId,
    company_name: null,
  }
}

export function createMetaChannelAdapter(
  params: MetaChannelAdapterParams,
): ChannelCrmAdapter {
  const {
    conversationId,
    companyId,
    beginCanonicalRead,
    publishCanonicalConversation,
  } = params
  let loadedRow: ChannelConversationRow | null = null

  return {
    channel: 'meta',
    conversationId,
    companyId,
    capabilities: META_CHANNEL_CAPABILITIES,

    async loadConversation() {
      const token = beginCanonicalRead?.() ?? null
      const listed = await metaWhatsAppApi.getConversations(companyId, {
        id: conversationId,
      })
      const row = listed.find((item) => item.id === conversationId) ?? null
      if (token) publishCanonicalConversation?.(token, row)
      if (!row) {
        loadedRow = null
        return null
      }
      loadedRow = toConversationRow(row, row.lead_id ?? null)
      return loadedRow
    },

    async loadContact(phone) {
      if (!phone || !loadedRow || loadedRow.id !== conversationId) return null
      const now = new Date()
      const contact: ChatContact = {
        id: `meta-contact:${conversationId}`,
        company_id: companyId,
        phone_number: phone,
        name: loadedRow.contact_name ?? undefined,
        total_messages: 0,
        tags: [],
        custom_fields: {},
        created_at: now,
        updated_at: now,
      }
      return contact
    },

    async resolveAssociatedLead(conversation: ChannelLeadLookupInput) {
      if (conversation.lead_id == null) return null
      const { data, error } = await supabase
        .from('leads')
        .select(ASSOCIATED_LEAD_SELECT)
        .eq('id', conversation.lead_id)
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .maybeSingle()
      if (error || !data) return null
      return data as AssociatedLeadSnapshot
    },

    async getAverageResponseTime() {
      return '--'
    },

    async loadScheduledMessages() {
      return [] as ChatScheduledMessage[]
    },

    searchLinkableLeads(query: string) {
      return metaWhatsAppApi.searchConversationLeads(companyId, conversationId, query)
    },

    linkExplicitLead(input, isStillCurrent) {
      return metaWhatsAppApi.linkConversationLead(
        companyId,
        conversationId,
        input.leadId,
        input.expectedLeadId,
        isStillCurrent,
      )
    },
  }
}

export interface MetaListSync {
  beginCanonicalRead: () => CanonicalReadToken | null
  publishCanonicalConversation: (
    token: CanonicalReadToken,
    row: MetaChatConversation | null,
  ) => void
}

export function useMetaChannelAdapter(
  companyId: string,
  conversationId: string | null,
  listSync: MetaListSync | null,
): ChannelCrmAdapter | null {
  const syncRef = useRef(listSync)
  syncRef.current = listSync

  return useMemo(() => {
    if (!conversationId || !companyId) return null
    return createMetaChannelAdapter({
      conversationId,
      companyId,
      beginCanonicalRead: () => syncRef.current?.beginCanonicalRead() ?? null,
      publishCanonicalConversation: (token, row) => {
        syncRef.current?.publishCanonicalConversation(token, row)
      },
    })
  }, [companyId, conversationId])
}
