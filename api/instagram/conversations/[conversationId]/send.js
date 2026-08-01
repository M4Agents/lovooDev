// =============================================================================
// POST /api/instagram/conversations/[conversationId]/send
//
// Envia uma mensagem de texto para um participante Instagram via Meta Graph API.
// Responsabilidades deste endpoint:
//   1. Validar método + payload HTTP
//   2. Autenticar caller via JWT + RBAC (validateInstagramCaller)
//   3. Delegar envio ao serviço compartilhado instagramMessageService
//   4. Registrar audit log
//
// Lógica de envio extraída para:
//   api/lib/instagram/instagramMessageService.js
//
// SEGURANÇA:
//   - Nunca aceitar company_id, connection_id, ig_participant_id do frontend
//   - Nunca logar access_token
//   - service_role usado apenas após validação de auth + RBAC
// =============================================================================

import { getSupabaseAdmin }        from '../../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../../lib/instagram/validateInstagramCaller.js';
import { sendInstagramMessage }    from '../../../lib/instagram/instagramMessageService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { conversationId } = req.query;
  const { text, reply_to_ig_message_id } = req.body ?? {};

  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId é obrigatório' });
  }

  const trimmedText = typeof text === 'string' ? text.trim() : '';
  if (!trimmedText) {
    return res.status(400).json({ error: 'text é obrigatório e não pode ser vazio' });
  }

  const svc = getSupabaseAdmin();

  // ── 1. Buscar conversa para validar company_id antes do RBAC ──────────────
  const { data: conversation, error: convErr } = await svc
    .from('instagram_conversations')
    .select('id, company_id, connection_id, ig_participant_id')
    .eq('id', conversationId)
    .maybeSingle();

  if (convErr || !conversation) {
    return res.status(404).json({ error: 'Conversa não encontrada' });
  }

  // ── 2. Autenticar caller via JWT + RBAC ────────────────────────────────────
  const auth = await validateInstagramCaller(req, svc, conversation.company_id);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── 3. Delegar envio ao serviço compartilhado ──────────────────────────────
  const result = await sendInstagramMessage({
    supabase:             svc,
    conversationId,
    companyId:            conversation.company_id,
    text:                 trimmedText,
    sentBy:               auth.userId,      // UUID do usuário autenticado
    origin:               'manual',
    automationExecutionId: null,
    automationNodeId:     null,
    replyToIgMessageId:   reply_to_ig_message_id ?? null,
  });

  if (!result.ok) {
    // Mapear errorType para código HTTP compatível com a resposta anterior da API
    const statusMap = {
      validation:          400,
      connection_inactive: 422,
      token_error:         500,
      meta_window_expired: 422,
      token_expired:       422,
      rate_limit:          429,
      user_blocked:        422,
      meta_error:          502,
      meta_timeout:        504,
      db_error:            500,
    };

    const messageMap = {
      connection_inactive: 'Conta Instagram desconectada ou expirada. Reconecte em Configurações.',
      meta_window_expired: 'Janela de 24h expirada. Não é possível responder esta mensagem.',
      token_expired:       'Token expirado. Reconecte a conta Instagram em Configurações.',
      rate_limit:          'Limite de envio atingido. Aguarde alguns minutos e tente novamente.',
      user_blocked:        'O usuário bloqueou mensagens desta conta Instagram.',
      meta_error:          'Falha ao enviar mensagem. Tente novamente.',
      meta_timeout:        'Tempo de resposta da API do Instagram excedido. Tente novamente.',
    };

    const status  = statusMap[result.errorType]  ?? 502;
    const message = messageMap[result.errorType] ?? result.error;

    return res.status(status).json({
      error:   result.errorType ?? 'send_failed',
      message,
    });
  }

  // ── 4. Audit log (fire-and-forget — não bloquear resposta) ─────────────────
  svc.from('instagram_audit_logs').insert({
    company_id:    conversation.company_id,
    connection_id: conversation.connection_id,
    action:        'message_sent',
    performed_by:  auth.userId,
    metadata: {
      conversation_id: conversationId,
      message_length:  trimmedText.length,
    },
  }).then(() => {}).catch(() => {});

  return res.status(200).json({ message: result.savedMessage });
}
