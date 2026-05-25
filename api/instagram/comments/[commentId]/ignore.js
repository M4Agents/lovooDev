// =============================================================================
// PATCH /api/instagram/comments/[commentId]/ignore
//
// Marca um comentário como ignorado (somente banco — sem chamada à Meta).
// =============================================================================

import { getSupabaseAdmin }        from '../../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../../lib/instagram/validateInstagramCaller.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const svc = getSupabaseAdmin();
  const { commentId } = req.query ?? {};

  if (!commentId || !UUID_REGEX.test(String(commentId))) {
    return res.status(400).json({ error: 'commentId inválido' });
  }

  const { data: comment } = await svc
    .from('instagram_comments')
    .select('id, company_id, connection_id')
    .eq('id', commentId)
    .maybeSingle();

  if (!comment) return res.status(404).json({ error: 'Comentário não encontrado' });

  const auth = await validateInstagramCaller(req, svc, comment.company_id);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const now = new Date().toISOString();
  await svc
    .from('instagram_comments')
    .update({ status: 'ignored', updated_at: now })
    .eq('id', commentId);

  svc.from('instagram_audit_logs').insert({
    company_id:    comment.company_id,
    connection_id: comment.connection_id,
    action:        'comment_ignored',
    performed_by:  auth.userId,
    metadata:      { comment_id: commentId },
  }).then(() => {}).catch(() => {});

  return res.status(200).json({ ok: true, status: 'ignored' });
}
