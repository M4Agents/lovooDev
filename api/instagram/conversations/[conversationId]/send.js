// =============================================================================
// POST /api/instagram/conversations/[conversationId]/send
//
// Envia uma mensagem de texto para um participante Instagram via Meta Graph API.
//
// Body: { "text": "mensagem" }
//
// Fluxo:
//   1. Validar método + payload
//   2. Buscar conversa → resolver company_id, connection_id, ig_participant_id
//   3. Autenticar caller via JWT + RBAC
//   4. Buscar conexão → validar status active
//   5. Descriptografar token AES-256-GCM
//   6. Enviar para Meta Graph API (graph.instagram.com/v21.0/{ig_user_id}/messages)
//   7. Persistir mensagem outbound em instagram_messages
//   8. Atualizar last_message_at/preview em instagram_conversations
//   9. Registrar audit log
//
// SEGURANÇA:
//   - Nunca aceitar company_id, connection_id, ig_participant_id do frontend
//   - Nunca logar access_token
//   - service_role usado apenas após validação de auth + RBAC
// =============================================================================

import { getSupabaseAdmin }        from '../../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../../lib/instagram/validateInstagramCaller.js';
import { decryptInstagramToken }   from '../../../lib/instagram/tokenCrypto.js';

const GRAPH_API_VERSION = 'v21.0';
const TEXT_MAX_BYTES    = 1000;
const META_FETCH_TIMEOUT_MS = 15_000;

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
  if (Buffer.byteLength(trimmedText, 'utf8') > TEXT_MAX_BYTES) {
    return res.status(400).json({ error: `Mensagem excede ${TEXT_MAX_BYTES} bytes` });
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

  // ── 5. Resolver snapshot do conteúdo citado (antes do envio Meta) ──────────
  // Necessário para incluir prefixo de contexto no texto enviado ao Instagram,
  // já que a API não suporta reply_to nativo em mensagens outbound.
  let replyToContent   = null;
  let replyToDirection = null;
  if (reply_to_ig_message_id && typeof reply_to_ig_message_id === 'string') {
    const { data: quoted } = await svc
      .from('instagram_messages')
      .select('content, direction')
      .eq('ig_message_id', reply_to_ig_message_id)
      .maybeSingle();
    replyToContent   = quoted?.content   ?? null;
    replyToDirection = quoted?.direction ?? null;
  }

  // Montar texto para Meta: se há citação com conteúdo textual, adicionar prefixo
  let textForMeta = trimmedText;
  if (replyToContent) {
    const snippet   = replyToContent.length > 80
      ? replyToContent.slice(0, 80) + '…'
      : replyToContent;
    const prefixed  = `↩ ${snippet}\n\n${trimmedText}`;
    // Só usar o prefixo se não ultrapassar o limite de bytes da Meta
    if (Buffer.byteLength(prefixed, 'utf8') <= TEXT_MAX_BYTES) {
      textForMeta = prefixed;
    }
  }

  // ── 6. Enviar via Meta Graph API ───────────────────────────────────────────
  // instagram_user_id armazena o IGBID real (meData.id do /me) para contas novas.
  // ig_webhook_id armazena o Facebook Page ID (meData.user_id) — usado para webhook matching.
  // Para a API de mensagens usar sempre o IGBID do Instagram (instagram_user_id).
  // Fallback para ig_webhook_id apenas em conexões antigas onde instagram_user_id = IGSID legado.
  const igBusinessId = connection.instagram_user_id ?? connection.ig_webhook_id;
  const metaUrl = `https://graph.instagram.com/${GRAPH_API_VERSION}/${igBusinessId}/messages`;

  // #region agent log [449c25]
  try {
    const meRes  = await fetch(`https://graph.instagram.com/me?fields=id,username,user_id&access_token=${accessToken}`);
    const meData = await meRes.json();
    console.log('[debug:449c25] send-token-identity db_instagram_user_id=%s db_ig_webhook_id=%s igBusinessId=%s me_id=%s me_username=%s me_user_id=%s me_error=%s',
      connection.instagram_user_id, connection.ig_webhook_id, igBusinessId,
      meData.id, meData.username, meData.user_id,
      meData.error ? JSON.stringify(meData.error) : 'none');
  } catch (_e) {
    console.log('[debug:449c25] send-token-identity /me call failed:', _e?.message);
  }
  // #endregion

  let metaMessageId   = null;
  let metaSendFailed  = false;
  let metaFailReason  = null;

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), META_FETCH_TIMEOUT_MS);

    let metaRes, metaData;
    try {
      const metaBody = {
        recipient: { id: conversation.ig_participant_id },
        message:   { text: textForMeta },
      };

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

      console.error('[ig/send] Meta error code:%s msg:%s igBusinessId=%s participantId=%s', errCode, errMsg, igBusinessId, conversation.ig_participant_id);

      if (errCode === 10 || errMsg.toLowerCase().includes('outside the allowed window')) {
        return res.status(422).json({
          error:   'reply_window_expired',
          message: 'Janela de 24h expirada. Não é possível responder esta mensagem.',
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

      if (errCode === 551 || errMsg.toLowerCase().includes('block')) {
        return res.status(422).json({
          error:   'user_blocked',
          message: 'O usuário bloqueou mensagens desta conta Instagram.',
        });
      }

      return res.status(502).json({
        error:   'meta_send_failed',
        message: 'Falha ao enviar mensagem. Tente novamente.',
      });
    }

    metaMessageId = metaData.message_id ?? null;
  } catch (err) {
    const isTimeout = err?.name === 'AbortError';
    console.error('[ig/send] fetch error:', err?.name, err?.message);

    // Timeout: salvar mensagem como failed para o usuário saber que foi tentada
    if (isTimeout) {
      const failedTs = new Date().toISOString();
      svc.from('instagram_messages').insert({
        conversation_id: conversationId,
        company_id:      conversation.company_id,
        ig_message_id:   `failed_${Date.now()}`,
        direction:       'outbound',
        message_type:    'text',
        content:         trimmedText,
        sent_by:         auth.userId,
        status:          'failed',
        timestamp:       failedTs,
      }).then(() => {}).catch(() => {});
    }

    return res.status(isTimeout ? 504 : 502).json({
      error:   isTimeout ? 'meta_timeout' : 'meta_api_unavailable',
      message: isTimeout
        ? 'Tempo de resposta da API do Instagram excedido. Tente novamente.'
        : 'API do Instagram indisponível. Tente novamente.',
    });
  }

  // ── 7. Persistir mensagem outbound ─────────────────────────────────────────
  const now = new Date().toISOString();

  // content armazena o texto ORIGINAL (sem prefixo) — o CRM exibe o bloco de citação separado
  const { data: savedMessage, error: insertErr } = await svc
    .from('instagram_messages')
    .insert({
      conversation_id:         conversationId,
      company_id:              conversation.company_id,
      ig_message_id:           metaMessageId ?? `local_${Date.now()}`,
      direction:               'outbound',
      message_type:            'text',
      content:                 trimmedText,
      sent_by:                 auth.userId,
      status:                  'sent',
      timestamp:               now,
      reply_to_ig_message_id:  reply_to_ig_message_id ?? null,
      reply_to_content:        replyToContent,
      reply_to_direction:      replyToDirection,
    })
    .select('id, ig_message_id, direction, message_type, content, sent_by, status, timestamp, created_at, reply_to_ig_message_id, reply_to_content, reply_to_direction')
    .single();

  if (insertErr) {
    // Mensagem foi enviada com sucesso na Meta — não bloquear resposta por falha de log
    console.error('[ig/send] failed to persist message:', insertErr.message);
  }

  // ── 8. Atualizar última mensagem da conversa ────────────────────────────────
  await svc
    .from('instagram_conversations')
    .update({
      last_message_at:      now,
      last_message_preview: trimmedText.slice(0, 100),
      updated_at:           now,
    })
    .eq('id', conversationId);

  // ── 9. Audit log ───────────────────────────────────────────────────────────
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

  return res.status(200).json({
    message: savedMessage ?? {
      id:           null,
      ig_message_id: metaMessageId,
      direction:    'outbound',
      message_type: 'text',
      content:      trimmedText,
      sent_by:      auth.userId,
      status:       'sent',
      timestamp:    now,
      created_at:   now,
    },
  });
}
