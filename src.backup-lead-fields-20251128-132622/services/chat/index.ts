// =====================================================
// CHAT SERVICES - EXPORTS PRINCIPAIS
// =====================================================
// Arquivo de índice para facilitar importações dos serviços
// NÃO MODIFICA serviços existentes

// API principal do chat
export { ChatApi, chatApi } from './chatApi'

// Tipos dos serviços
export type {
  ChatConversation,
  ChatMessage,
  ChatContact,
  ChatScheduledMessage,
  ConversationFilter,
  SendMessageForm,
  ScheduleMessageForm,
  ContactInfoForm
} from '../../types/whatsapp-chat'
