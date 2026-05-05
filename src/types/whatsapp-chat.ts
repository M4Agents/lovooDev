// =====================================================
// WHATSAPP CHAT - TIPOS TYPESCRIPT ISOLADOS
// =====================================================
// Tipos isolados para o sistema de chat WhatsApp
// NÃO MODIFICA tipos existentes do whatsapp-life.ts

// =====================================================
// TIPOS PRINCIPAIS DO CHAT
// =====================================================

export interface ChatConversation {
  id: string
  company_id: string
  instance_id: string
  contact_phone: string
  contact_name?: string
  profile_picture_url?: string
  company_name?: string  // NOVO: nome da empresa do lead
  lead_id?: number
  is_lead_over_plan?: boolean
  assigned_to?: {
    id: string
    email: string
  }
  last_message_at?: Date
  last_message_content?: string
  last_message_direction?: 'inbound' | 'outbound'
  unread_count: number
  status: 'active' | 'archived'
  ai_state?: 'ai_inactive' | 'ai_active' | 'ai_paused' | 'ai_suggested'
  ai_assignment_id?: string
  instance_name?: string
  instance_status?: string
  instance_deleted?: boolean
  created_at: Date
  updated_at: Date
}

export interface ChatMessage {
  id: string
  conversation_id: string
  company_id: string
  instance_id: string
  message_type: 'text' | 'image' | 'document' | 'audio' | 'video'
  content?: string
  media_url?: string
  direction: 'inbound' | 'outbound'
  status: 'draft' | 'scheduled' | 'sent' | 'delivered' | 'read' | 'failed' | 'sending'
  is_scheduled: boolean
  scheduled_for?: Date
  sent_by?: string
  uazapi_message_id?: string
  timestamp: Date
  created_at: Date
  updated_at: Date
  // Campos de reply
  reply_to_message_id?: string
  reply_to_content?: string
  reply_to_direction?: 'inbound' | 'outbound'
  reply_to_message_type?: 'text' | 'image' | 'document' | 'audio' | 'video'
}

export interface ChatContact {
  id: string
  company_id: string
  phone_number: string
  name?: string
  email?: string
  profile_picture_url?: string
  lead_source?: string
  deal_value?: number
  first_contact_at?: Date
  last_activity_at?: Date
  total_messages: number
  notes?: string
  tags: string[]
  custom_fields: Record<string, any>
  created_at: Date
  updated_at: Date
}

export interface ChatScheduledMessage {
  id: string
  conversation_id: string
  company_id: string
  instance_id: string
  instance_name?: string
  created_by: string
  message_type: 'text' | 'image' | 'document'
  content: string
  media_url?: string
  scheduled_for: Date
  status: 'pending' | 'sent' | 'failed' | 'cancelled'
  recurring_type: 'none' | 'daily' | 'weekly' | 'monthly'
  recurring_config: Record<string, any>
  sent_at?: Date
  error_message?: string
  created_at: Date
  updated_at: Date
  contact_phone?: string
  contact_name?: string
  cancel_if_lead_replies?: boolean
  cancel_scope?: 'next_only' | 'all_future'
  recurring_parent_id?: string
}

// =====================================================
// TIPOS PARA FILTROS E BUSCA
// =====================================================

export interface ConversationFilter {
  type: 'all' | 'assigned' | 'unassigned' | 'unread'
  search?: string
  instance_id?: string
}

export interface MessageFilter {
  conversation_id: string
  limit?: number
  offset?: number
}

export interface ContactFilter {
  company_id: string
  phone_number?: string
  search?: string
}

// =====================================================
// TIPOS PARA FORMULÁRIOS
// =====================================================

export interface SendMessageForm {
  content: string
  message_type: 'text' | 'image' | 'document' | 'audio' | 'video'
  media_file?: File
  media_url?: string
  reply_to_message_id?: string
}

export interface ScheduleMessageForm {
  content: string
  message_type: 'text' | 'image' | 'video' | 'audio' | 'document'
  media_file?: File
  media_url?: string
  scheduled_date: string
  scheduled_time: string
  timezone: string
  recurring_type: 'none' | 'daily' | 'weekly' | 'monthly'
  recurring_config?: {
    end_date?: string
    days_of_week?: number[]
    day_of_month?: number
  }
  cancel_if_lead_replies?: boolean
  cancel_scope?: 'next_only' | 'all_future'
}

export interface ContactInfoForm {
  name?: string
  email?: string
  lead_source?: string
  deal_value?: number
  notes?: string
  tags: string[]
  custom_fields: Record<string, any>
}

export interface AssignConversationForm {
  conversation_id: string
  assigned_to?: string
}

// =====================================================
// TIPOS PARA COMPONENTES
// =====================================================

export interface ChatLayoutProps {
  companyId: string
  userId: string
  initialConversationId?: string
  hideConversationSidebar?: boolean
}

export interface ConversationSidebarProps {
  conversations: ChatConversation[]
  selectedConversation?: string
  filter: ConversationFilter
  loading: boolean
  onSelectConversation: (id: string) => void
  onFilterChange: (filter: ConversationFilter) => void
  onRefresh: () => void
}

export interface ChatAreaProps {
  conversationId: string
  companyId: string
  userId: string
}

export interface LeadPanelProps {
  conversationId: string
  companyId: string
  userId: string
}

export interface MessageBubbleProps {
  message: ChatMessage
  isOwn: boolean
  showTimestamp?: boolean
}

export interface MessageInputProps {
  onSendMessage: (message: SendMessageForm) => void
  onScheduleMessage: (message: ScheduleMessageForm) => void
  disabled?: boolean
  placeholder?: string
}

// =====================================================
// TIPOS PARA HOOKS
// =====================================================

export interface UseChatDataReturn {
  // Estados
  instances: any[]
  conversations: ChatConversation[]
  selectedInstance?: string
  selectedConversation?: string
  filter: ConversationFilter
  
  // Loading states
  instancesLoading: boolean
  conversationsLoading: boolean
  
  // Actions
  setSelectedInstance: (id: string) => void
  setSelectedConversation: (id: string) => void
  setFilter: (filter: ConversationFilter) => void
  refreshConversations: () => void
}

export interface UseMessagesReturn {
  messages: ChatMessage[]
  loading: boolean
  error?: string
  sendMessage: (message: SendMessageForm) => Promise<void>
  loadMore: () => void
  hasMore: boolean
  markAsRead: () => void
}

export interface UseScheduledMessagesReturn {
  scheduledMessages: ChatScheduledMessage[]
  loading: boolean
  error?: string
  scheduleMessage: (message: ScheduleMessageForm) => Promise<void>
  cancelMessage: (id: string) => Promise<void>
  refreshScheduled: () => void
}

export interface UseContactInfoReturn {
  contact?: ChatContact
  loading: boolean
  error?: string
  updateContact: (data: ContactInfoForm) => Promise<void>
  refreshContact: () => void
}

export interface UseAssignmentsReturn {
  assignConversation: (conversationId: string, userId?: string) => Promise<void>
  loading: boolean
  error?: string
}

// =====================================================
// TIPOS PARA API RESPONSES
// =====================================================

export interface ChatApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface ConversationsResponse extends ChatApiResponse {
  data?: ChatConversation[]
}

export interface MessagesResponse extends ChatApiResponse {
  data?: ChatMessage[]
}

export interface ContactResponse extends ChatApiResponse {
  data?: ChatContact
}

export interface ScheduledMessagesResponse extends ChatApiResponse {
  data?: ChatScheduledMessage[]
}

// =====================================================
// TIPOS PARA CONFIGURAÇÕES
// =====================================================

export interface ChatConfig {
  maxMessageLength: number
  allowedFileTypes: string[]
  maxFileSize: number
  autoRefreshInterval: number
  messagePageSize: number
}

export interface ChatNotification {
  id: string
  type: 'new_message' | 'assignment' | 'scheduled_sent' | 'error'
  title: string
  message: string
  conversation_id?: string
  timestamp: Date
  read: boolean
}

// =====================================================
// CONSTANTES
// =====================================================

export const CHAT_CONSTANTS = {
  MAX_MESSAGE_LENGTH: 4096,
  MAX_FILE_SIZE: 16 * 1024 * 1024, // 16MB
  ALLOWED_FILE_TYPES: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg'
  ],
  AUTO_REFRESH_INTERVAL: 30000, // 30 segundos
  MESSAGE_PAGE_SIZE: 50,
  
  ROUTES: {
    MAIN: '/chat',
    CONVERSATION: '/chat/:conversationId',
  },
  
  STORAGE_KEYS: {
    SELECTED_INSTANCE: 'chat_selected_instance',
    FILTER_STATE: 'chat_filter_state',
    SIDEBAR_COLLAPSED: 'chat_sidebar_collapsed',
  }
} as const

// =====================================================
// GUARDS E VALIDAÇÕES
// =====================================================

export const isValidMessageType = (type: string): type is ChatMessage['message_type'] => {
  return ['text', 'image', 'document', 'audio', 'video'].includes(type)
}

export const isValidFilterType = (type: string): type is ConversationFilter['type'] => {
  return ['all', 'assigned', 'unassigned'].includes(type)
}

export const getMessageStatusColor = (status: ChatMessage['status']): string => {
  switch (status) {
    case 'sent':
      return 'text-blue-600'
    case 'delivered':
      return 'text-green-600'
    case 'read':
      return 'text-green-700'
    case 'failed':
      return 'text-red-600'
    case 'scheduled':
      return 'text-yellow-600'
    default:
      return 'text-gray-600'
  }
}

export const formatPhoneNumber = (phone: string): string => {
  // Remove caracteres não numéricos
  const cleaned = phone.replace(/\D/g, '')
  
  // Formatar para padrão brasileiro
  if (cleaned.length === 11) {
    return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`
  } else if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 6)}-${cleaned.slice(6)}`
  }
  
  return phone
}

export const formatTimestamp = (timestamp: Date): string => {
  const now = new Date()
  const diff = now.getTime() - timestamp.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  
  if (minutes < 1) return 'Agora'
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  
  return timestamp.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  })
}
