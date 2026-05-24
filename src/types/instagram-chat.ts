// =====================================================
// INSTAGRAM CHAT — TIPOS TYPESCRIPT ISOLADOS
// =====================================================
// NÃO modificar whatsapp-chat.ts para adicionar tipos Instagram.

// =====================================================
// ENTIDADES DO BANCO
// =====================================================

export interface InstagramConnection {
  id: string
  instagram_user_id: string
  instagram_username: string
  profile_picture_url: string | null
  /** active = pronto para uso; qualquer outro valor = inativo/requer ação do usuário */
  status: 'active' | 'revoked' | 'error' | 'expired' | 'reauth_required'
  created_at: string
}

export interface InstagramChatConversation {
  id: string
  company_id: string
  connection_id: string
  ig_thread_id: string
  /** IGSID — recipient.id usado para envio de mensagem via Meta API */
  ig_participant_id: string
  participant_name: string | null
  participant_username: string | null
  participant_avatar: string | null
  lead_id: string | null
  status: 'active' | 'archived'
  unread_count: number
  last_message_preview: string | null
  last_message_at: string | null
  assigned_to: string | null
  created_at: string
  updated_at: string
}

export interface InstagramMessageReaction {
  emoji: string
  source: 'business' | 'participant'
  actor_ig_id: string
  user_id: string | null
}

export interface InstagramChatMessage {
  id: string
  conversation_id: string
  company_id: string
  ig_message_id: string
  direction: 'inbound' | 'outbound'
  message_type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'unsupported'
  content: string | null
  media_url: string | null
  sent_by: string | null
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'sending'
  timestamp: string
  created_at: string
  /** ig_message_id da mensagem citada */
  reply_to_ig_message_id: string | null
  /** snapshot do conteúdo citado para exibição */
  reply_to_content: string | null
  /** direction da mensagem citada */
  reply_to_direction: 'inbound' | 'outbound' | null
  /** reações ativas nesta mensagem */
  reactions: InstagramMessageReaction[]
}

// =====================================================
// FILTROS
// =====================================================

export type InstagramFilterType = 'all' | 'unread' | 'assigned' | 'unassigned'

export interface InstagramChannelFilter {
  type: InstagramFilterType
  search?: string
}

// =====================================================
// PAYLOADS
// =====================================================

export interface InstagramSendMessagePayload {
  text: string
  reply_to_ig_message_id?: string | null
}

export interface InstagramReactPayload {
  ig_message_id: string
  emoji: 'love' | 'haha' | 'wow' | 'sad' | 'angry' | 'like'
  action: 'react' | 'unreact'
}

// =====================================================
// SELETOR DE CANAL
// =====================================================

export type ChatChannel = 'whatsapp' | 'instagram'
