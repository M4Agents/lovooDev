// =====================================================
// CHANNEL CRM ADAPTER — contrato de canal do LeadPanel
// =====================================================
// Operações específicas de provedor (Uazapi / futuro Meta).
// O CRM compartilhado (leads, oportunidades, tags, notas, atividades)
// NÃO entra neste contrato.
//
// META-L1.3: somente o caminho Uazapi é implementado.
// Não há métodos exclusivos de Meta nesta fase.

import type { ChatContact, ChatScheduledMessage } from './whatsapp-chat'

export type ChannelCrmChannel = 'uazapi' | 'meta'

export interface ChannelCrmCapabilities {
  /** Uazapi atual: resolve lead por lead_id e, se necessário, por telefone. */
  readonly supportsPhoneFallback: boolean
  /** Vínculo explícito criar/buscar/vincular. Uazapi: false. */
  readonly supportsExplicitLink: boolean
  /** Atribuir responsável cria lead se não houver. Uazapi: true. */
  readonly supportsAutoCreateOnAssign: boolean
  /** RPC change_conversation_instance. Uazapi: true. */
  readonly canChangeConversationInstance: boolean
  /** Fila chat_scheduled_messages. Uazapi: true. */
  readonly supportsScheduledWhatsApp: boolean
  /** Mídias da thread no painel Biblioteca. Uazapi: true. */
  readonly supportsConversationMediaLibrary: boolean
  /** POST /api/chat/summarize-lead-note. Uazapi: true. */
  readonly supportsAiSummarize: boolean
  /** Drag-and-drop da biblioteca para o composer. Uazapi: true. */
  readonly supportsLibraryDropToComposer: boolean
}

export interface ChannelLeadLookupInput {
  lead_id?: number | null
  contact_phone?: string | null
}

export interface AssociatedLeadSnapshot {
  id: number
  name: string
  phone?: string
  email?: string
  responsible_user_id?: string | null
}

/**
 * Linha de conversa do canal. Campos usados pelo LeadPanel hoje.
 * Extras do SELECT * da Uazapi são permitidos.
 */
export interface ChannelConversationRow {
  id: string
  instance_id?: string | null
  contact_phone?: string | null
  contact_name?: string | null
  lead_id?: number | null
  company_name?: string | null
  [key: string]: unknown
}

/**
 * Contrato mínimo usado pelo carregamento principal do LeadPanel.
 * Sem mídia da thread, sem resumo IA, sem troca de instância:
 * essas dependências permanecem internas nesta fase.
 */
export interface ChannelCrmAdapter {
  readonly channel: ChannelCrmChannel
  readonly conversationId: string
  readonly companyId: string
  readonly capabilities: ChannelCrmCapabilities

  loadConversation(): Promise<ChannelConversationRow | null>
  loadContact(phone: string | null | undefined): Promise<ChatContact | null>
  resolveAssociatedLead(conversation: ChannelLeadLookupInput): Promise<AssociatedLeadSnapshot | null>
  getAverageResponseTime(): Promise<string>
  loadScheduledMessages(): Promise<ChatScheduledMessage[]>
}
