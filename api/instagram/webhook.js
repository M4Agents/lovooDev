// =============================================================================
// GET|POST /api/instagram/webhook
//
// GET  → Verificação do challenge Meta (setup do webhook no App Dashboard)
// POST → Recebimento de eventos reais (DMs + comentários)
//
// Segurança:
//   - HMAC SHA-256 validado antes de qualquer processamento (fail-closed)
//   - Timing-safe comparison (timingSafeEqual)
//   - company_id NUNCA extraído do payload — resolvido via instagram_connections
//   - Raw body lido antes do parse JSON (bodyParser: false obrigatório)
//
// Idempotência:
//   - Garantida pelas RPCs (ON CONFLICT em ig_message_id e ig_comment_id)
//   - instagram_webhook_events registra todos os eventos recebidos
//
// Sempre retornar 200 para a Meta após HMAC válido
// (Meta faz retry se receber 4xx/5xx após a validação)
// =============================================================================

import { getSupabaseAdmin }           from '../lib/automation/supabaseAdmin.js';
import { readRawBody,
         verifyWebhookSignature }     from '../lib/instagram/verifyWebhookSignature.js';
import { parseDmEvents,
         parseCommentEvents,
         parseReactionEvents,
         parseSkippedMessagingEvents } from '../lib/instagram/parseInstagramWebhook.js';
import { decryptInstagramToken }      from '../lib/instagram/tokenCrypto.js';
import { uploadAvatarToStorage }      from '../lib/instagram/uploadAvatarToStorage.js';

const GRAPH_API_VERSION = 'v21.0';

// Desabilita body parser do Vercel — obrigatório para HMAC validation
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  // ── GET: Meta challenge verification ────────────────────────────────────────
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Ler raw body (antes de qualquer parsing) ───────────────────────────
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch {
    return res.status(400).json({ error: 'Failed to read request body' });
  }

  // ── 2. Validar HMAC (fail-closed: rejeitar imediatamente se inválido) ─────
  const signature = req.headers['x-hub-signature-256'] ?? '';
  const appSecret = process.env.INSTAGRAM_APP_SECRET ?? '';

  if (!verifyWebhookSignature(rawBody, signature, appSecret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // ── 3. Parse JSON ─────────────────────────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  // Validar estrutura mínima
  if (payload.object !== 'instagram' || !Array.isArray(payload.entry)) {
    return res.status(200).json({ ok: true, skipped: 'not_instagram_object' });
  }

  const svc = getSupabaseAdmin();

  // ── 4. Processar cada entry (em paralelo, erros isolados) ─────────────────
  await Promise.allSettled(
    payload.entry.map(entry => processEntry(entry, svc))
  );

  // Meta exige 200 rápido — sempre responder após HMAC válido
  return res.status(200).json({ ok: true });
}

// =============================================================================
// Processamento de uma entry do payload
// =============================================================================

async function processEntry(entry, svc) {
  const igUserId = String(entry.id ?? '');
  if (!igUserId) return;

  // Resolver conexão ativa (company_id NUNCA vem do payload)
  const { data: connection } = await svc
    .from('instagram_connections')
    .select('id, company_id, access_token_enc')
    .eq('instagram_user_id', igUserId)
    .eq('status', 'active')
    .maybeSingle();

  const companyId    = connection?.company_id ?? null;
  const connectionId = connection?.id ?? null;

  // Processar DMs
  for (const ev of parseDmEvents(entry)) {
    await processDmEvent(ev, companyId, connectionId, connection, svc);
  }

  // Processar comentários
  for (const ev of parseCommentEvents(entry)) {
    await processCommentEvent(ev, companyId, connectionId, svc);
  }

  // Processar reações inbound
  for (const ev of parseReactionEvents(entry)) {
    processReactionEvent(ev, companyId, connectionId, svc).catch(() => {});
  }

  // Registrar eventos não tratados como skipped
  for (const ev of parseSkippedMessagingEvents(entry)) {
    await saveWebhookEvent(svc, {
      instagramUserId:  ev.instagramUserId,
      eventType:        ev.eventType,
      igObjectId:       null,
      companyId,
      connectionId,
      rawPayload:       ev.raw,
      processingStatus: 'skipped',
    });
  }
}

// =============================================================================
// DM: salvar event log + chamar RPC
// =============================================================================

async function processDmEvent(ev, companyId, connectionId, connection, svc) {
  // Salvar event log (status inicial: received)
  const eventId = await saveWebhookEvent(svc, {
    instagramUserId:  ev.instagramUserId,
    eventType:        'dm',
    igObjectId:       ev.igMessageId,
    companyId,
    connectionId,
    rawPayload:       ev.raw,
    processingStatus: 'received',
  });

  // Resolver snapshot do conteúdo citado (se for reply)
  let replyToContent   = null;
  let replyToDirection = null;
  if (ev.replyToIgMessageId) {
    const { data: quoted } = await svc
      .from('instagram_messages')
      .select('content, direction')
      .eq('ig_message_id', ev.replyToIgMessageId)
      .maybeSingle();
    replyToContent   = quoted?.content   ?? null;
    replyToDirection = quoted?.direction ?? null;
  }

  // Chamar RPC process_instagram_dm_webhook
  const { data: rpc, error: rpcErr } = await svc.rpc('process_instagram_dm_webhook', {
    p_instagram_user_id:      ev.instagramUserId,
    p_ig_message_id:          ev.igMessageId,
    p_ig_thread_id:           ev.igThreadId,
    p_participant_ig_user_id: ev.participantIgUserId,
    p_direction:              ev.direction,
    p_message_type:           ev.messageType,
    p_content:                ev.content,
    p_media_url:              ev.mediaUrl,
    p_timestamp:              ev.timestamp.toISOString(),
    p_reply_to_ig_message_id: ev.replyToIgMessageId ?? null,
    p_reply_to_content:       replyToContent,
    p_reply_to_direction:     replyToDirection,
  });

  if (!eventId) return;

  if (rpcErr) {
    await updateWebhookEvent(svc, eventId, 'failed', rpcErr.message);
    return;
  }

  const status = rpc?.skipped ? 'skipped' : (rpc?.ok ? 'processed' : 'failed');
  const detail = rpc?.skipped ? rpc.reason : (rpc?.ok ? null : (rpc?.error ?? 'rpc_returned_not_ok'));
  await updateWebhookEvent(svc, eventId, status, detail);

  // Enriquecer perfil do participante (fire-and-forget — não bloqueia resposta Meta)
  if (rpc?.ok && rpc?.conversation_id && ev.participantIgUserId && connection) {
    enrichParticipantIfNeeded(rpc.conversation_id, ev.participantIgUserId, connection, svc).catch(() => {});
  }
}

// =============================================================================
// Enriquecimento do perfil do participante (fire-and-forget)
// =============================================================================
// Chamada após processar uma DM. Busca nome, username e foto na Graph API
// e salva permanentemente no Supabase Storage. Nunca lança exceção.

async function enrichParticipantIfNeeded(conversationId, participantIgsid, connection, svc) {
  try {
    // Verificar se já tem nome (evitar chamadas desnecessárias à Meta)
    const { data: conv } = await svc
      .from('instagram_conversations')
      .select('participant_name, company_id')
      .eq('id', conversationId)
      .maybeSingle();

    if (!conv || conv.participant_name) return;

    // Descriptografar token
    let accessToken;
    try {
      accessToken = decryptInstagramToken(connection.access_token_enc);
    } catch {
      return;
    }

    // Buscar perfil do participante na Graph API
    const profileUrl = new URL(`https://graph.instagram.com/${GRAPH_API_VERSION}/${participantIgsid}`);
    profileUrl.searchParams.set('fields',       'name,username,profile_pic');
    profileUrl.searchParams.set('access_token', accessToken);

    const profileRes  = await fetch(profileUrl.toString(), { signal: AbortSignal.timeout(10_000) });
    const profileData = await profileRes.json();

    if (profileData.error || !profileRes.ok) return;

    const name     = profileData.name     ?? null;
    const username = profileData.username ?? null;
    const picUrl   = profileData.profile_pic ?? null;

    // Fazer upload da foto para storage permanente
    let avatarUrl = null;
    if (picUrl && conv.company_id) {
      avatarUrl = await uploadAvatarToStorage(svc, {
        cdnUrl:    picUrl,
        companyId: conv.company_id,
        filename:  `ig_${participantIgsid}.jpg`,
      });
    }

    // Atualizar conversa
    await svc
      .from('instagram_conversations')
      .update({
        participant_name:     name,
        participant_username: username,
        participant_avatar:   avatarUrl,
        updated_at:           new Date().toISOString(),
      })
      .eq('id', conversationId);

  } catch {
    // Silencioso — não deve impactar o fluxo principal do webhook
  }
}

// =============================================================================
// Comentário: salvar event log + chamar RPC
// =============================================================================

async function processCommentEvent(ev, companyId, connectionId, svc) {
  const eventId = await saveWebhookEvent(svc, {
    instagramUserId:  ev.instagramUserId,
    eventType:        'comment',
    igObjectId:       ev.igCommentId,
    companyId,
    connectionId,
    rawPayload:       ev.raw,
    processingStatus: 'received',
  });

  const { data: rpc, error: rpcErr } = await svc.rpc('process_instagram_comment_webhook', {
    p_instagram_user_id:      ev.instagramUserId,
    p_ig_comment_id:          ev.igCommentId,
    p_ig_media_id:            ev.igMediaId,
    p_ig_user_id:             ev.igUserId,
    p_content:                ev.content,
    p_timestamp:              ev.timestamp.toISOString(),
    p_ig_media_type:          ev.igMediaType,
    p_ig_username:            ev.igUsername,
    p_parent_ig_comment_id:   ev.parentIgCommentId,
  });

  if (!eventId) return;

  if (rpcErr) {
    await updateWebhookEvent(svc, eventId, 'failed', rpcErr.message);
    return;
  }

  const status = rpc?.skipped ? 'skipped' : (rpc?.ok ? 'processed' : 'failed');
  const detail = rpc?.skipped ? rpc.reason : (rpc?.ok ? null : (rpc?.error ?? 'rpc_returned_not_ok'));
  await updateWebhookEvent(svc, eventId, status, detail);
}

// =============================================================================
// Helpers: salvar e atualizar instagram_webhook_events
// =============================================================================

async function saveWebhookEvent(svc, {
  instagramUserId, eventType, igObjectId, companyId, connectionId,
  rawPayload, processingStatus,
}) {
  const { data, error } = await svc
    .from('instagram_webhook_events')
    .insert({
      instagram_user_id: instagramUserId,
      event_type:        eventType,
      ig_object_id:      igObjectId   ?? null,
      company_id:        companyId    ?? null,
      connection_id:     connectionId ?? null,
      raw_payload:       rawPayload,
      processing_status: processingStatus,
      hmac_valid:        true, // só chegamos aqui após HMAC válido
    })
    .select('id')
    .single();

  if (error) {
    console.error('[instagram-webhook] Erro ao salvar webhook event:', error.message);
    return null;
  }

  return data?.id ?? null;
}

async function updateWebhookEvent(svc, eventId, status, errorDetail = null) {
  await svc
    .from('instagram_webhook_events')
    .update({
      processing_status: status,
      error_detail:      errorDetail,
      processed_at:      new Date().toISOString(),
    })
    .eq('id', eventId);
}

// =============================================================================
// processReactionEvent — persiste reação inbound do participante
// Chamado fire-and-forget; não bloqueia resposta à Meta.
// =============================================================================

async function processReactionEvent(ev, companyId, connectionId, svc) {
  if (!ev.igMessageId || !ev.participantIgUserId) return;

  // Localizar mensagem por ig_message_id
  const { data: message } = await svc
    .from('instagram_messages')
    .select('id, company_id')
    .eq('ig_message_id', ev.igMessageId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (!message) return; // mensagem ainda não persistida — ignorar

  if (ev.action === 'unreact') {
    await svc
      .from('instagram_message_reactions')
      .update({ removed_at: new Date().toISOString() })
      .eq('message_id', message.id)
      .eq('actor_ig_id', ev.participantIgUserId);
    return;
  }

  // Normalizar emoji unicode para slug Meta: ❤️ → 'love', etc.
  const emojiSlug = unicodeToEmojiSlug(ev.emoji) ?? 'like';

  await svc
    .from('instagram_message_reactions')
    .upsert({
      message_id:   message.id,
      company_id:   companyId,
      ig_message_id: ev.igMessageId,
      source:       'participant',
      actor_ig_id:  ev.participantIgUserId,
      emoji:        emojiSlug,
      removed_at:   null,
    }, { onConflict: 'message_id,actor_ig_id', ignoreDuplicates: false });
}

/** Mapeamento de emoji unicode → slug Meta */
function unicodeToEmojiSlug(emoji) {
  const map = {
    '❤️': 'love', '❤': 'love',
    '😆': 'haha', '😂': 'haha',
    '😮': 'wow',  '😮‍💨': 'wow',
    '😢': 'sad',  '😭': 'sad',
    '😠': 'angry','😡': 'angry',
    '👍': 'like', '🙂': 'like',
  };
  return emoji ? (map[emoji] ?? null) : null;
}
