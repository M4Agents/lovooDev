// =============================================================================
// POST /api/instagram/conversations/[conversationId]/react
//
// Envia ou remove uma reação em uma mensagem Instagram via Meta Graph API.
//
// Body:
//   ig_message_id : string (Meta mid da mensagem)
//   emoji         : 'love' | 'haha' | 'wow' | 'sad' | 'angry' | 'like'
//   action        : 'react' | 'unreact'  (padrão: 'react')
//
// Fluxo:
//   1. Validar e resolver company_id da conversa
//   2. Autenticar caller (JWT + RBAC)
//   3. Buscar conexão e descriptografar token
//   4. Chamar Meta Graph API (send_reaction)
//   5. Upsert em instagram_message_reactions
//
// SEGURANÇA:
//   - company_id, connection_id resolvidos do banco — nunca do frontend
//   - token nunca logado
// =============================================================================

import { getSupabaseAdmin }        from '../../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../../lib/instagram/validateInstagramCaller.js';
import { decryptInstagramToken }   from '../../../lib/instagram/tokenCrypto.js';

const GRAPH_API_VERSION = 'v21.0';
const META_TIMEOUT_MS   = 10_000;

// Meta aceita slug ou unicode neste endpoint
const VALID_EMOJIS = new Set(['love', 'haha', 'wow', 'sad', 'angry', 'like']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { conversationId }           = req.query;
  const { ig_message_id, emoji, action = 'react' } = req.body ?? {};

  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId é obrigatório' });
  }
  if (!ig_message_id || typeof ig_message_id !== 'string') {
    return res.status(400).json({ error: 'ig_message_id é obrigatório' });
  }
  if (!VALID_EMOJIS.has(emoji)) {
    return res.status(400).json({
      error:   'emoji inválido',
      allowed: [...VALID_EMOJIS],
    });
  }
  if (action !== 'react' && action !== 'unreact') {
    return res.status(400).json({ error: 'action deve ser "react" ou "unreact"' });
  }

  const svc = getSupabaseAdmin();

  // ── 1. Resolver conversa ───────────────────────────────────────────────────
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
    .select('id, instagram_user_id, access_token_enc, status')
    .eq('id', conversation.connection_id)
    .maybeSingle();

  if (connErr || !connection) {
    return res.status(422).json({ error: 'Conexão Instagram não encontrada' });
  }
  if (connection.status !== 'active') {
    return res.status(422).json({
      error:   'connection_inactive',
      message: 'Conta Instagram desconectada. Reconecte em Configurações.',
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

  // ── 5. Chamar Meta Graph API ───────────────────────────────────────────────
  const metaUrl = `https://graph.instagram.com/${GRAPH_API_VERSION}/${connection.instagram_user_id}/messages`;

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), META_TIMEOUT_MS);

    let metaRes, metaData;
    try {
      metaRes = await fetch(metaUrl, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: conversation.ig_participant_id },
          sender_action: action === 'react' ? 'react' : 'unreact',
          payload: {
            message_id: ig_message_id,
            emoji,
          },
        }),
        signal: controller.signal,
      });
      metaData = await metaRes.json();
    } finally {
      clearTimeout(timeout);
    }

    if (!metaRes.ok || metaData.error) {
      const errCode = metaData?.error?.code;
      const errMsg  = metaData?.error?.message ?? '';

      if (errCode === 190 || errMsg.toLowerCase().includes('access token')) {
        return res.status(422).json({
          error:   'token_expired',
          message: 'Token expirado. Reconecte a conta Instagram em Configurações.',
        });
      }

      console.error('[ig/react] Meta error:', errCode, errMsg);
      return res.status(502).json({
        error:   'meta_react_failed',
        message: 'Falha ao enviar reação. Tente novamente.',
      });
    }
  } catch (err) {
    const isTimeout = err?.name === 'AbortError';
    console.error('[ig/react] fetch error:', err?.name);
    return res.status(isTimeout ? 504 : 502).json({
      error:   isTimeout ? 'meta_timeout' : 'meta_api_unavailable',
      message: isTimeout ? 'Tempo de resposta excedido.' : 'API indisponível.',
    });
  }

  // ── 6. Localizar a mensagem no banco ───────────────────────────────────────
  const { data: message } = await svc
    .from('instagram_messages')
    .select('id')
    .eq('ig_message_id', ig_message_id)
    .eq('company_id', conversation.company_id)
    .maybeSingle();

  if (!message) {
    return res.status(200).json({ ok: true, persisted: false });
  }

  // ── 7. Upsert instagram_message_reactions ─────────────────────────────────
  if (action === 'unreact') {
    await svc
      .from('instagram_message_reactions')
      .update({ removed_at: new Date().toISOString() })
      .eq('message_id', message.id)
      .eq('actor_ig_id', connection.instagram_user_id);
  } else {
    await svc
      .from('instagram_message_reactions')
      .upsert({
        message_id:   message.id,
        company_id:   conversation.company_id,
        ig_message_id,
        source:       'business',
        actor_ig_id:  connection.instagram_user_id,
        user_id:      auth.userId,
        emoji,
        removed_at:   null,
      }, { onConflict: 'message_id,actor_ig_id', ignoreDuplicates: false });
  }

  return res.status(200).json({ ok: true, persisted: true });
}
