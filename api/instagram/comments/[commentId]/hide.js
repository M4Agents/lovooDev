// =============================================================================
// POST /api/instagram/comments/[commentId]/hide
//
// Oculta um comentário Instagram via Meta Graph API.
//
// Fluxo:
//   1. Validar JWT + RBAC
//   2. Resolver company_id, connection_id do banco
//   3. POST /v21.0/{ig_comment_id} {hide: true} → Meta
//   4. Atualizar status = 'hidden'
//   5. Audit log: comment_hidden
//
// SEGURANÇA:
//   - company_id e connection_id sempre do banco
//   - scope: instagram_business_manage_comments
// =============================================================================

import { getSupabaseAdmin }        from '../../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../../lib/instagram/validateInstagramCaller.js';
import { decryptInstagramToken }   from '../../../lib/instagram/tokenCrypto.js';

const GRAPH_API_VERSION = 'v21.0';
const UUID_REGEX        = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const { data: comment } = await svc
    .from('instagram_comments')
    .select('id, company_id, connection_id, ig_comment_id')
    .eq('id', commentId)
    .maybeSingle();

  if (!comment) return res.status(404).json({ error: 'Comentário não encontrado' });

  const auth = await validateInstagramCaller(req, svc, comment.company_id);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { data: connection } = await svc
    .from('instagram_connections')
    .select('id, access_token_enc, status')
    .eq('id', comment.connection_id)
    .maybeSingle();

  if (!connection) return res.status(422).json({ error: 'Conexão Instagram não encontrada' });
  if (connection.status !== 'active') {
    return res.status(422).json({ error: 'connection_inactive', message: 'Conta Instagram desconectada.' });
  }
  if (!connection.access_token_enc) {
    return res.status(403).json({ error: 'connection_inactive' });
  }

  let accessToken;
  try {
    accessToken = decryptInstagramToken(connection.access_token_enc);
  } catch {
    return res.status(500).json({ error: 'Erro ao processar credenciais da conexão' });
  }

  const metaUrl = `https://graph.instagram.com/${GRAPH_API_VERSION}/${comment.ig_comment_id}`;

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
        body:   JSON.stringify({ hide: true }),
        signal: controller.signal,
      });
      metaData = await metaRes.json();
    } finally {
      clearTimeout(timeout);
    }

    if (!metaRes.ok || metaData.error) {
      const errCode = metaData.error?.code;
      const errMsg  = metaData.error?.message ?? '';
      console.error('[ig/comments/hide] Meta error:', errCode, errMsg);

      if (errCode === 190 || errMsg.toLowerCase().includes('access token')) {
        return res.status(422).json({ error: 'token_expired', message: 'Token expirado. Reconecte a conta Instagram.' });
      }
      if (metaRes.status === 429 || errCode === 32 || errCode === 613) {
        return res.status(429).json({ error: 'rate_limit', message: 'Limite atingido. Aguarde e tente novamente.' });
      }

      return res.status(502).json({ error: 'meta_hide_failed', message: 'Falha ao ocultar comentário.' });
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: 'timeout', message: 'Timeout. Tente novamente.' });
    }
    return res.status(502).json({ error: 'meta_hide_failed', message: 'Falha ao ocultar comentário.' });
  }

  const now = new Date().toISOString();
  await svc
    .from('instagram_comments')
    .update({ status: 'hidden', updated_at: now })
    .eq('id', commentId);

  svc.from('instagram_audit_logs').insert({
    company_id:    comment.company_id,
    connection_id: comment.connection_id,
    action:        'comment_hidden',
    performed_by:  auth.userId,
    metadata:      { comment_id: commentId, ig_comment_id: comment.ig_comment_id },
  }).then(() => {}).catch(() => {});

  return res.status(200).json({ ok: true, status: 'hidden' });
}
