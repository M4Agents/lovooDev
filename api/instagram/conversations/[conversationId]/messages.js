// =============================================================================
// GET /api/instagram/conversations/[conversationId]/messages
//
// Lista mensagens de uma conversa Instagram.
//
// Query params:
//   limit  (opcional) — número de mensagens (padrão: 50, max: 100)
//
// RBAC: ALLOWED_ROLES (seller+)
// Segurança: company_id resolvido da conversa, nunca do frontend.
// =============================================================================

import { getSupabaseAdmin }        from '../../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../../lib/instagram/validateInstagramCaller.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { conversationId } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);

  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId é obrigatório' });
  }

  const svc = getSupabaseAdmin();

  // Resolve company_id a partir da conversa — nunca aceitar do frontend
  const { data: conversation, error: convErr } = await svc
    .from('instagram_conversations')
    .select('company_id')
    .eq('id', conversationId)
    .maybeSingle();

  if (convErr || !conversation) {
    return res.status(404).json({ error: 'Conversa não encontrada' });
  }

  const auth = await validateInstagramCaller(req, svc, conversation.company_id);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const { data, error } = await svc
    .from('instagram_messages')
    .select([
      'id', 'conversation_id', 'company_id', 'ig_message_id',
      'direction', 'message_type', 'content', 'media_url',
      'sent_by', 'status', 'timestamp', 'created_at',
    ].join(', '))
    .eq('conversation_id', conversationId)
    .order('timestamp', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[ig/messages] query error:', error.message);
    return res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }

  return res.status(200).json({ messages: data ?? [] });
}
