// =====================================================
// UAZAPI CHANNEL ADAPTER — META-L1.3
// =====================================================
// Encapsula as leituras de canal usadas no fetchData do LeadPanel.
// Preserva contratos, payloads, fallback por telefone e ordem atuais.
// Não altera APIs, tabelas ou o comportamento visual da Uazapi.

import { supabase } from '../../../lib/supabase'
import { brMobilePhoneLookupValues } from '../../../lib/phone/canonicalizeBrMobile'
import { chatApi } from '../../../services/chat/chatApi'
import type {
  AssociatedLeadSnapshot,
  ChannelConversationRow,
  ChannelCrmAdapter,
  ChannelCrmCapabilities,
  ChannelLeadLookupInput,
} from '../../../types/channel-crm-adapter'
import type { ChatContact, ChatScheduledMessage } from '../../../types/whatsapp-chat'

export const UAZAPI_CHANNEL_CAPABILITIES: ChannelCrmCapabilities = {
  supportsPhoneFallback: true,
  supportsExplicitLink: false,
  supportsAutoCreateOnAssign: true,
  supportsContactUpdateByPhone: true,
  supportsChatAssignmentSync: true,
  canChangeConversationInstance: true,
  supportsScheduledWhatsApp: true,
  supportsConversationMediaLibrary: true,
  supportsAiSummarize: true,
  supportsLibraryDropToComposer: true,
}

const ASSOCIATED_LEAD_SELECT = 'id, name, phone, email, responsible_user_id'

export interface UazapiChannelAdapterParams {
  conversationId: string
  companyId: string
}

async function loadUazapiConversation(
  companyId: string,
  conversationId: string
): Promise<ChannelConversationRow | null> {
  const { data } = await supabase
    .from('chat_conversations')
    .select('*')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .maybeSingle()

  return (data as ChannelConversationRow | null) ?? null
}

async function resolveUazapiAssociatedLead(
  companyId: string,
  conversation: ChannelLeadLookupInput
): Promise<AssociatedLeadSnapshot | null> {
  if (conversation.lead_id) {
    const { data } = await supabase
      .from('leads')
      .select(ASSOCIATED_LEAD_SELECT)
      .eq('id', conversation.lead_id)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .maybeSingle()
    if (data) return data as AssociatedLeadSnapshot
  }

  const phones = brMobilePhoneLookupValues(conversation.contact_phone)
  if (phones.length === 0) return null

  const { data: byNormalized } = await supabase
    .from('leads')
    .select(ASSOCIATED_LEAD_SELECT)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .in('phone_normalized', phones)
    .limit(1)
    .maybeSingle()
  if (byNormalized) return byNormalized as AssociatedLeadSnapshot

  const { data: byPhone } = await supabase
    .from('leads')
    .select(ASSOCIATED_LEAD_SELECT)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .in('phone', phones)
    .limit(1)
    .maybeSingle()

  return (byPhone as AssociatedLeadSnapshot | null) ?? null
}

async function calculateUazapiAverageResponseTime(conversationId: string): Promise<string> {
  try {
    const { data: messages, error } = await supabase
      .from('chat_messages')
      .select('timestamp, direction')
      .eq('conversation_id', conversationId)
      .order('timestamp', { ascending: true })

    if (error || !messages || messages.length < 2) {
      return '--'
    }

    const responseTimes: number[] = []

    for (let i = 0; i < messages.length - 1; i++) {
      if (messages[i].direction === 'inbound') {
        for (let j = i + 1; j < messages.length; j++) {
          if (messages[j].direction === 'outbound') {
            const inboundTime = new Date(messages[i].timestamp).getTime()
            const outboundTime = new Date(messages[j].timestamp).getTime()
            const diffMs = outboundTime - inboundTime

            if (diffMs > 0) {
              responseTimes.push(diffMs)
            }
            break
          }
        }
      }
    }

    if (responseTimes.length === 0) {
      return '--'
    }

    const avgMs = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length

    const minutes = Math.floor(avgMs / (1000 * 60))
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) {
      return `${days}d`
    }
    if (hours > 0) {
      return `${hours}h`
    }
    if (minutes > 0) {
      return `${minutes}m`
    }
    return '<1m'
  } catch (error) {
    console.error('Erro ao calcular tempo médio de resposta:', error)
    return '--'
  }
}

export function createUazapiChannelAdapter(
  params: UazapiChannelAdapterParams
): ChannelCrmAdapter {
  const { conversationId, companyId } = params

  return {
    channel: 'uazapi',
    conversationId,
    companyId,
    capabilities: UAZAPI_CHANNEL_CAPABILITIES,

    async loadConversation() {
      return loadUazapiConversation(companyId, conversationId)
    },

    async loadContact(phone) {
      return chatApi.getContactInfo(companyId, phone as string) as Promise<ChatContact | null>
    },

    async resolveAssociatedLead(conversation) {
      return resolveUazapiAssociatedLead(companyId, conversation)
    },

    async getAverageResponseTime() {
      return calculateUazapiAverageResponseTime(conversationId)
    },

    async loadScheduledMessages() {
      return chatApi.getScheduledMessages(companyId, conversationId) as Promise<ChatScheduledMessage[]>
    },
  }
}
