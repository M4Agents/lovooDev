// =============================================================================
// POST /api/instagram/conversations/[conversationId]/send-media
//
// Envia um anexo (imagem, vídeo, áudio) para um participante Instagram
// via Meta Graph API, usando URL pública do Supabase Storage.
//
// Body:
//   media_url              (string, URL pública do Supabase Storage)
//   media_type             ('image' | 'video' | 'audio')
//   reply_to_ig_message_id (string, opcional)
//
// SEGURANÇA:
//   - Nunca aceitar company_id, connection_id, ig_participant_id do frontend
//   - service_role apenas após validação de auth + RBAC
// =============================================================================

import { getSupabaseAdmin }        from '../../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../../lib/instagram/validateInstagramCaller.js';
import { decryptInstagramToken }   from '../../../lib/instagram/tokenCrypto.js';

const GRAPH_API_VERSION     = 'v21.0';
const META_FETCH_TIMEOUT_MS = 20_000;

const ALLOWED_MEDIA_TYPES = new Set(['image', 'video', 'audio']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { conversationId } = req.query;
  const { media_url, media_type, reply_to_ig_message_id } = req.body ?? {};

  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId é obrigatório' });
  }
  if (typeof media_url !== 'string' || !media_url.startsWith('https://')) {
    return res.status(400).json({ error: 'media_url inválida' });
  }
  if (!ALLOWED_MEDIA_TYPES.has(media_type)) {
    return res.status(400).json({ error: 'media_type inválido. Use: image, video ou audio' });
  }

  const svc = getSupabaseAdmin();

  // ── 1. Buscar conversa ─────────────────────────────────────────────────────
  const { data: conversation, error: convErr } = await svc
    .from('instagram_conversations')
    .select('id, company_id, connection_id, ig_participant_id')
    .eq('id', conversationId)
    .maybeSingle();

  if (convErr || !conversation) {
    return res.status(404).json({ error: 'Conversa não encontrada' });
  }

  // ── 2. Autenticar caller ───────────────────────────────────────────────────
  const auth = await validateInstagramCaller(req, svc, conversation.company_id);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── 3. Buscar conexão ──────────────────────────────────────────────────────
  const { data: connection, error: connErr } = await svc
    .from('instagram_connections')
    .select('id, instagram_user_id, ig_webhook_id, access_token_enc, status')
    .eq('id', conversation.connection_id)
    .maybeSingle();

  if (connErr || !connection) {
    return res.status(422).json({ error: 'Conexão Instagram não encontrada' });
  }

  if (connection.status !== 'active') {
    return res.status(422).json({
      error:   'connection_inactive',
      message: 'Conta Instagram desconectada ou expirada. Reconecte em Configurações.',
    });
  }
  if (!connection.access_token_enc) {
    return res.status(403).json({ error: 'connection_inactive' });
  }

  // ── 4. Descriptografar token ───────────────────────────────────────────────
  let accessToken;
  try {
    accessToken = decryptInstagramToken(connection.access_token_enc);
  } catch {
    return res.status(500).json({ error: 'Erro ao processar credenciais da conexão' });
  }

  // ── 5. Enviar via Meta Graph API ───────────────────────────────────────────
  // ig_webhook_id = IGBID real (meData.user_id para page-backed accounts).
  // A API de mensagens exige o IGBID; usar ig_webhook_id como fonte primária.
  const igBusinessId = connection.ig_webhook_id ?? connection.instagram_user_id;
  const metaUrl = `https://graph.instagram.com/${GRAPH_API_VERSION}/${igBusinessId}/messages`;

  let metaMessageId  = null;

  // Handover Protocol: assume controle da thread se outro app for o Primary Receiver.
  async function tryTakeThreadControl(participantId) {
    try {
      const takeRes  = await fetch(
        `https://graph.instagram.com/${GRAPH_API_VERSION}/${igBusinessId}/take_thread_control`,
        {
          method:  'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ recipient: { id: participantId } }),
        }
      );
      const takeData = await takeRes.json();
      const ok = takeRes.ok && takeData.success === true;
      console.log('[ig/send-media] take_thread_control ok=%s', ok);
      return ok;
    } catch (_e) { return false; }
  }

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), META_FETCH_TIMEOUT_MS);

    const metaBody = {
      recipient: { id: conversation.ig_participant_id },
      message: {
        attachment: {
          type:    media_type,
          payload: { url: media_url },
        },
      },
    };

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

    // Se Handover Protocol bloqueou (subcode 2534037), tomar controle e reenviar.
    if (metaData.error?.error_subcode === 2534037) {
      const took = await tryTakeThreadControl(conversation.ig_participant_id);
      if (took) {
        try {
          const r2 = await fetch(metaUrl, {
            method:  'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify(metaBody),
          });
          const d2 = await r2.json();
          if (r2.ok && !d2.error) { metaRes = r2; metaData = d2; }
        } catch (_e) { /* mantém erro original */ }
      }
    }

    if (!metaRes.ok || metaData.error) {
      const errCode = metaData.error?.code;
      const errMsg  = metaData.error?.message ?? '';

      console.error('[ig/send-media] Meta error code:%s subcode:%s msg:%s', errCode, metaData.error?.error_subcode ?? 'none', errMsg);

      if (errCode === 10 || errMsg.toLowerCase().includes('outside the allowed window')) {
        return res.status(422).json({
          error:   'reply_window_expired',
          message: 'Janela de 24h expirada. Não é possível enviar mídia para esta conversa.',
        });
      }
      if (errCode === 190 || errMsg.toLowerCase().includes('access token')) {
        return res.status(422).json({
          error:   'token_expired',
          message: 'Token expirado. Reconecte a conta Instagram em Configurações.',
        });
      }
      if (metaRes.status === 429 || errCode === 32 || errCode === 613) {
        return res.status(429).json({
          error:   'rate_limit',
          message: 'Limite de envio atingido. Aguarde alguns minutos e tente novamente.',
        });
      }

      return res.status(502).json({
        error:   'meta_send_failed',
        message: 'Falha ao enviar mídia. Tente novamente.',
      });
    }

    metaMessageId = metaData.message_id ?? null;
  } catch (err) {
    const isTimeout = err?.name === 'AbortError';
    console.error('[ig/send-media] fetch error:', err?.name, err?.message);
    return res.status(isTimeout ? 504 : 502).json({
      error:   isTimeout ? 'meta_timeout' : 'meta_api_unavailable',
      message: isTimeout
        ? 'Tempo de resposta da API do Instagram excedido. Tente novamente.'
        : 'API do Instagram indisponível. Tente novamente.',
    });
  }

  // ── 6. Persistir mensagem outbound ─────────────────────────────────────────
  const now = new Date().toISOString();

  const { data: savedMessage, error: insertErr } = await svc
    .from('instagram_messages')
    .insert({
      conversation_id:         conversationId,
      company_id:              conversation.company_id,
      ig_message_id:           metaMessageId ?? `local_${Date.now()}`,
      direction:               'outbound',
      message_type:            media_type,
      content:                 null,
      media_url:               media_url,
      sent_by:                 auth.userId,
      status:                  'sent',
      timestamp:               now,
      reply_to_ig_message_id:  reply_to_ig_message_id ?? null,
    })
    .select('id, ig_message_id, direction, message_type, content, media_url, sent_by, status, timestamp, created_at')
    .single();

  if (insertErr) {
    console.error('[ig/send-media] failed to persist message:', insertErr.message);
  }

  // ── 7. Atualizar última mensagem da conversa ────────────────────────────────
  const preview = `[${media_type}]`;
  await svc
    .from('instagram_conversations')
    .update({
      last_message_at:      now,
      last_message_preview: preview,
      updated_at:           now,
    })
    .eq('id', conversationId);

  return res.status(200).json({
    message: savedMessage ?? {
      id:           null,
      ig_message_id: metaMessageId,
      direction:    'outbound',
      message_type: media_type,
      content:      null,
      media_url:    media_url,
      sent_by:      auth.userId,
      status:       'sent',
      timestamp:    now,
      created_at:   now,
    },
  });
}
