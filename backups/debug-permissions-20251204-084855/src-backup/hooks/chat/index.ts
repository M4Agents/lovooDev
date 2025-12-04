// =====================================================
// CHAT HOOKS - EXPORTS PRINCIPAIS
// =====================================================
// Arquivo de índice para facilitar importações dos hooks
// NÃO MODIFICA hooks existentes

// Hook principal
export { useChatData, useConversationSearch, useChatStats } from './useChatData'

// Tipos dos hooks
export type { 
  UseChatDataReturn,
  UseMessagesReturn,
  UseScheduledMessagesReturn,
  UseContactInfoReturn,
  UseAssignmentsReturn
} from '../../types/whatsapp-chat'
