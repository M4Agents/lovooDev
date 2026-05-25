// =====================================================
// INSTAGRAM COMMENTS — TIPOS TYPESCRIPT ISOLADOS
// =====================================================
// NÃO misturar com instagram-chat.ts (DMs) nem com whatsapp-chat.ts.
// Comentários e DMs são entidades completamente separadas.

// =====================================================
// STATUS DO COMENTÁRIO
// =====================================================
// private_reply_sent é flag booleana ortogonal ao status.
// Um comentário pode ter status 'replied' E private_reply_sent = true.
// 'private_replied' foi removido dos status operacionais.

export type InstagramCommentStatus =
  | 'pending'
  | 'replied'
  | 'hidden'
  | 'ignored'
  | 'converted_to_lead'

// =====================================================
// ENTIDADE PRINCIPAL
// =====================================================

export interface InstagramComment {
  id: string
  company_id: string
  connection_id: string
  ig_comment_id: string
  ig_media_id: string
  ig_media_type: string | null
  ig_user_id: string
  ig_username: string | null
  content: string
  parent_comment_id: string | null
  lead_id: number | null
  /** Preenchido após "Chamar no Direct" (call-direct). Null enquanto não houver DM. */
  conversation_id: string | null
  replied_at: string | null
  reply_content: string | null
  /** Flag ortogonal ao status — true quando "Chamar no Direct" foi enviado */
  private_reply_sent: boolean
  status: InstagramCommentStatus
  timestamp: string
  created_at: string
  updated_at: string
}

// =====================================================
// FILTRO DE COMENTÁRIOS
// =====================================================

export interface InstagramCommentsFilter {
  tab: 'comments' | 'pending'
  connection_id?: string
  search?: string
}

// =====================================================
// PAYLOADS DE AÇÃO
// =====================================================

export interface CommentReplyPayload {
  text: string
}

export interface CallDirectPayload {
  text: string
}

export interface CallDirectResponse {
  ok: boolean
  conversation_id: string
}

export interface CreateCommentLeadPayload {
  name: string
  phone?: string | null
  email?: string | null
}

export interface CreateCommentLeadResponse {
  success: boolean
  action: 'lead_created' | 'lead_linked' | 'already_linked'
  lead_id: number
}
