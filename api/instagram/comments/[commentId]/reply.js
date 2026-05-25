// =============================================================================
// POST /api/instagram/comments/[commentId]/reply
//
// Responde publicamente a um comentário Instagram via Meta Graph API.
//
// Body: { "text": "resposta" }
//
// Fluxo:
//   1. Validar JWT + RBAC
//   2. Resolver company_id, connection_id do comentário (banco)
//   3. Descriptografar token
//   4. POST /v21.0/{ig_comment_id}/replies → Meta
//   5. Atualizar instagram_comments: replied_at, reply_content, status='replied'
//   6. Audit log: comment_replied
//
// SEGURANÇA:
//   - company_id e connection_id resolvidos do banco — nunca do payload
//   - scope: instagram_business_manage_comments
// =============================================================================

import { getSupabaseAdmin }        from '../../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../../lib/instagram/validateInstagramCaller.js';
import { decryptInstagramToken }   from '../../../lib/instagram/tokenCrypto.js';

const GRAPH_API_VERSION = 'v21.0';
const UUID_REGEX        = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX_BYTES    = 1000;

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

  if (!trimmedText) {
    return res.status(400).json({ error: 'text é obrigatório' });
  }
  if (Buffer.byteLength(trimmedText, 'utf8') > TEXT_MAX_BYTES) {
    return res.status(400).json({ error: `Resposta excede ${TEXT_MAX_BYTES} bytes` });
  }

  // ── 1. Resolver company_id do comentário ────────────────────────────────────
  const { data: comment, error: commentErr } = await svc
    .from('instagram_comments')
    .select('id, company_id, connection_id, ig_comment_id, status')
    .eq('id', commentId)
    .maybeSingle();

  if (commentErr || !comment) {
    return res.status(404).json({ error: 'Comentário não encontrado' });
  }

  // ── 2. Validar caller ───────────────────────────────────────────────────────
  const auth = await validateInstagramCaller(req, svc, comment.company_id);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // ── 3. Buscar conexão ───────────────────────────────────────────────────────
  const { data: connection } = await svc
    .from('instagram_connections')
    .select('id, instagram_user_id, access_token_enc, status')
    .eq('id', comment.connection_id)
    .maybeSingle();

  if (!connection) return res.status(422).json({ error: 'Conexão Instagram não encontrada' });
  if (connection.status !== 'active') {
    return res.status(422).json({
      error:   'connection_inactive',
      message: 'Conta Instagram desconectada. Reconecte em Configurações.',
    });
  }

  // ── 4. Descriptografar token ────────────────────────────────────────────────
  let accessToken;
  try {
    accessToken = decryptInstagramToken(connection.access_token_enc);
  } catch {
    return res.status(500).json({ error: 'Erro ao processar credenciais da conexão' });
  }

  // ── 5. Enviar reply via Meta ────────────────────────────────────────────────
  const metaUrl = `https://graph.instagram.com/${GRAPH_API_VERSION}/${comment.ig_comment_id}/replies`;

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
        body:   JSON.stringify({ message: trimmedText }),
        signal: controller.signal,
      });
      metaData = await metaRes.json();
    } finally {
      clearTimeout(timeout);
    }

    if (!metaRes.ok || metaData.error) {
      const errCode = metaData.error?.code;
      const errMsg  = metaData.error?.message ?? '';

      console.error('[ig/comments/reply] Meta error:', errCode, errMsg);

      if (errCode === 190 || errMsg.toLowerCase().includes('access token')) {
        return res.status(422).json({ error: 'token_expired', message: 'Token expirado. Reconecte a conta Instagram.' });
      }
      if (metaRes.status === 429 || errCode === 32 || errCode === 613) {
        return res.status(429).json({ error: 'rate_limit', message: 'Limite atingido. Aguarde e tente novamente.' });
      }

      return res.status(502).json({ error: 'meta_reply_failed', message: 'Falha ao responder comentário. Tente novamente.' });
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: 'timeout', message: 'Timeout na comunicação com Meta. Tente novamente.' });
    }
    console.error('[ig/comments/reply] fetch error:', err?.message);
    return res.status(502).json({ error: 'meta_reply_failed', message: 'Falha ao responder comentário.' });
  }

  // ── 6. Atualizar comentário no banco ────────────────────────────────────────
  const now = new Date().toISOString();
  await svc
    .from('instagram_comments')
    .update({
      replied_at:    now,
      replied_by:    auth.userId,
      reply_content: trimmedText,
      status:        'replied',
      updated_at:    now,
    })
    .eq('id', commentId);

  // ── 7. Audit log ────────────────────────────────────────────────────────────
  svc.from('instagram_audit_logs').insert({
    company_id:    comment.company_id,
    connection_id: comment.connection_id,
    action:        'comment_replied',
    performed_by:  auth.userId,
    metadata:      { comment_id: commentId, ig_comment_id: comment.ig_comment_id },
  }).then(() => {}).catch(() => {});

  return res.status(200).json({ ok: true, status: 'replied' });
}
