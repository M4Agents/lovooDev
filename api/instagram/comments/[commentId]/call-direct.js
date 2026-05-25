// =============================================================================
// POST /api/instagram/comments/[commentId]/call-direct
//
// "Chamar no Direct" — envia private reply via Meta e cria/vincula DM thread.
//
// Body: { "text": "mensagem privada" }
//
// CONCEITO ARQUITETURAL:
//   - Ação INDEPENDENTE da resposta pública
//   - NÃO altera status do comentário
//   - Apenas seta private_reply_sent = true e preenche conversation_id
//   - A navegação para a DM é decisão do usuário (botão "Abrir conversa")
//
// Fluxo:
//   1. Validar JWT + RBAC
//   2. Resolver comment → company_id, connection_id, ig_user_id
//   3. Verificar janela de 7 dias (Meta limita private reply)
//   4. Descriptografar token
//   5. POST /v21.0/{ig_user_id}/messages {recipient:{comment_id}} → Meta
//   6. Upsert instagram_conversations com thread_id retornado
//   7. Insert instagram_messages outbound
//   8. Update instagram_comments: private_reply_sent=true, conversation_id
//   9. Audit log: private_reply_sent
//
// SEGURANÇA:
//   - company_id, connection_id, ig_user_id sempre do banco
//   - scope: instagram_business_manage_messages (já existente)
// =============================================================================

import { getSupabaseAdmin }        from '../../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../../lib/instagram/validateInstagramCaller.js';
import { decryptInstagramToken }   from '../../../lib/instagram/tokenCrypto.js';

const GRAPH_API_VERSION    = 'v21.0';
const UUID_REGEX           = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX_BYTES       = 1000;
const PRIVATE_REPLY_WINDOW = 7 * 24 * 60 * 60 * 1000; // 7 dias em ms

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const svc = getSupabaseAdmin();
  const { commentId } = req.query ?? {};

  if (!commentId || !UUID_REGEX.test(String(commentId))) {
    return res.status(400).json({ error: 'commentId inválido' });
  }

  const { text } = req.body ?? {};
  const trimmedText = typeof text === 'string' ? text.trim() : '';

  if (!trimmedText) return res.status(400).json({ error: 'text é obrigatório' });
  if (Buffer.byteLength(trimmedText, 'utf8') > TEXT_MAX_BYTES) {
    return res.status(400).json({ error: `Mensagem excede ${TEXT_MAX_BYTES} bytes` });
  }

  // ── 1. Resolver comment ─────────────────────────────────────────────────────
  const { data: comment } = await svc
    .from('instagram_comments')
    .select('id, company_id, connection_id, ig_comment_id, ig_user_id, ig_username, timestamp, conversation_id')
    .eq('id', commentId)
    .maybeSingle();

  if (!comment) return res.status(404).json({ error: 'Comentário não encontrado' });

  // ── 2. Verificar janela de 7 dias ───────────────────────────────────────────
  const commentAge = Date.now() - new Date(comment.timestamp).getTime();
  if (commentAge > PRIVATE_REPLY_WINDOW) {
    return res.status(422).json({
      error:   'private_reply_window_expired',
      message: 'Comentário muito antigo para Direct (limite de 7 dias da Meta).',
    });
  }

  // ── 3. Validar caller ───────────────────────────────────────────────────────
  const auth = await validateInstagramCaller(req, svc, comment.company_id);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // ── 4. Buscar conexão ───────────────────────────────────────────────────────
  const { data: connection } = await svc
    .from('instagram_connections')
    .select('id, instagram_user_id, access_token_enc, status')
    .eq('id', comment.connection_id)
    .maybeSingle();

  if (!connection) return res.status(422).json({ error: 'Conexão Instagram não encontrada' });
  if (connection.status !== 'active') {
    return res.status(422).json({ error: 'connection_inactive', message: 'Conta Instagram desconectada.' });
  }

  // ── 5. Descriptografar token ────────────────────────────────────────────────
  let accessToken;
  try {
    accessToken = decryptInstagramToken(connection.access_token_enc);
  } catch {
    return res.status(500).json({ error: 'Erro ao processar credenciais da conexão' });
  }

  // ── 6. Enviar private reply via Meta ────────────────────────────────────────
  const metaUrl  = `https://graph.instagram.com/${GRAPH_API_VERSION}/${connection.instagram_user_id}/messages`;
  const metaBody = {
    recipient: { comment_id: comment.ig_comment_id },
    message:   { text: trimmedText },
  };

  let metaMessageId = null;
  let metaThreadId  = null;

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 15_000);

    let metaRes, metaData;
    try {
      metaRes  = await fetch(metaUrl, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body:   JSON.stringify(metaBody),
        signal: controller.signal,
      });
      metaData = await metaRes.json();
    } finally {
      clearTimeout(timeout);
    }

    if (!metaRes.ok || metaData.error) {
      const errCode = metaData.error?.code;
      const errMsg  = metaData.error?.message ?? '';
      console.error('[ig/call-direct] Meta error:', errCode, errMsg);

      if (errCode === 10900 || errMsg.toLowerCase().includes('comment too old')) {
        return res.status(422).json({
          error:   'private_reply_window_expired',
          message: 'Comentário muito antigo para Direct (limite de 7 dias da Meta).',
        });
      }
      if (errCode === 190 || errMsg.toLowerCase().includes('access token')) {
        return res.status(422).json({ error: 'token_expired', message: 'Token expirado. Reconecte a conta Instagram.' });
      }
      if (metaRes.status === 429 || errCode === 32 || errCode === 613) {
        return res.status(429).json({ error: 'rate_limit', message: 'Limite atingido. Aguarde e tente novamente.' });
      }

      return res.status(502).json({ error: 'meta_direct_failed', message: 'Falha ao enviar Direct. Tente novamente.' });
    }

    metaMessageId = metaData.message_id ?? null;
    // A Meta retorna recipient_id que é o thread_id (IGSID do participante)
    metaThreadId  = metaData.recipient_id ?? comment.ig_user_id;
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: 'timeout', message: 'Timeout. Tente novamente.' });
    }
    return res.status(502).json({ error: 'meta_direct_failed', message: 'Falha ao enviar Direct.' });
  }

  // ── 7. Upsert instagram_conversations ──────────────────────────────────────
  const now = new Date().toISOString();

  let conversationId = comment.conversation_id;

  if (!conversationId) {
    // Tenta encontrar conversa existente pelo participante
    const { data: existingConv } = await svc
      .from('instagram_conversations')
      .select('id')
      .eq('company_id', comment.company_id)
      .eq('connection_id', comment.connection_id)
      .eq('ig_participant_id', comment.ig_user_id)
      .maybeSingle();

    if (existingConv) {
      conversationId = existingConv.id;
    } else {
      const { data: newConv } = await svc
        .from('instagram_conversations')
        .insert({
          company_id:            comment.company_id,
          connection_id:         comment.connection_id,
          ig_thread_id:          metaThreadId,
          ig_participant_id:     comment.ig_user_id,
          participant_username:  comment.ig_username,
          status:                'active',
          unread_count:          0,
          last_message_at:       now,
          last_message_preview:  trimmedText.slice(0, 100),
          created_at:            now,
          updated_at:            now,
        })
        .select('id')
        .single();

      conversationId = newConv?.id ?? null;
    }
  } else {
    // Atualizar last_message da conversa existente
    svc.from('instagram_conversations').update({
      last_message_at:      now,
      last_message_preview: trimmedText.slice(0, 100),
      updated_at:           now,
    }).eq('id', conversationId).then(() => {}).catch(() => {});
  }

  // ── 8. Insert outbound message ─────────────────────────────────────────────
  if (conversationId && metaMessageId) {
    svc.from('instagram_messages').insert({
      conversation_id: conversationId,
      company_id:      comment.company_id,
      ig_message_id:   metaMessageId,
      direction:       'outbound',
      message_type:    'text',
      content:         trimmedText,
      sent_by:         auth.userId,
      status:          'sent',
      timestamp:       now,
      created_at:      now,
      updated_at:      now,
    }).then(() => {}).catch(() => {});
  }

  // ── 9. Atualizar comentário ─────────────────────────────────────────────────
  // IMPORTANTE: NÃO altera status — apenas flags de direct
  await svc
    .from('instagram_comments')
    .update({
      private_reply_sent: true,
      conversation_id:    conversationId,
      updated_at:         now,
    })
    .eq('id', commentId);

  // ── 10. Audit log ───────────────────────────────────────────────────────────
  svc.from('instagram_audit_logs').insert({
    company_id:    comment.company_id,
    connection_id: comment.connection_id,
    action:        'private_reply_sent',
    performed_by:  auth.userId,
    metadata: {
      comment_id:      commentId,
      ig_comment_id:   comment.ig_comment_id,
      conversation_id: conversationId,
      ig_user_id:      comment.ig_user_id,
    },
  }).then(() => {}).catch(() => {});

  return res.status(200).json({
    ok: true,
    conversation_id: conversationId,
    private_reply_sent: true,
  });
}
