// =============================================================================
// POST /api/instagram/comments/[commentId]/create-lead
//
// Converte um Instagram Comment em Lead real do CRM.
//
// Body: { "name": "...", "phone": "...", "email": "..." }
//
// Usa RPC transacional: create_lead_from_instagram_comment
// Deduplicação: phone → email → social profile
// Após sucesso: status = 'converted_to_lead', lead_id preenchido
// Se comment.conversation_id existir: sincroniza lead_id na conversa
//
// SEGURANÇA:
//   - company_id resolvido do comentário (banco) — nunca do payload
//   - validateInstagramCaller (JWT + RBAC + membership)
// =============================================================================

import { getSupabaseAdmin }         from '../../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller }  from '../../../lib/instagram/validateInstagramCaller.js';
import { dispatchLeadCreatedTrigger } from '../../../lib/automation/dispatchLeadCreatedTrigger.js';
import { handleLeadReentry }          from '../../../lib/leads/handleLeadReentry.js';

const UUID_REGEX  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BLOCKED_FIELDS = new Set([
  'company_id', 'connection_id', 'lead_id', 'origin', 'responsible_user_id',
  'role', 'permissions', 'plan_id', 'is_active', 'is_over_plan',
  'deleted_at', 'created_at', 'updated_at',
  'password', 'token', 'secret', 'authorization', 'jwt', 'api_key',
]);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Método não permitido.' });

  let svc;
  try { svc = getSupabaseAdmin(); }
  catch { return res.status(500).json({ success: false, error: 'Configuração interna inválida.' }); }

  const { commentId } = req.query ?? {};
  if (!commentId || !UUID_REGEX.test(String(commentId))) {
    return res.status(400).json({ success: false, error: 'commentId inválido.' });
  }

  const body = req.body ?? {};
  for (const field of BLOCKED_FIELDS) {
    if (field in body) {
      return res.status(400).json({ success: false, error: `Campo não permitido: ${field}` });
    }
  }

  const { name, phone, email } = body;
  const trimmedName  = typeof name  === 'string' ? name.trim()  : '';
  const trimmedPhone = typeof phone === 'string' ? phone.trim() : null;
  const trimmedEmail = typeof email === 'string' ? email.trim() : null;

  if (!trimmedName) {
    return res.status(400).json({ success: false, error: 'name é obrigatório.' });
  }
  if (!trimmedPhone && !trimmedEmail) {
    return res.status(400).json({ success: false, error: 'phone ou email é obrigatório.' });
  }
  if (trimmedPhone) {
    const digits = trimmedPhone.replace(/[^0-9]/g, '');
    if (digits.length < 10) {
      return res.status(400).json({ success: false, error: 'Telefone deve ter pelo menos 10 dígitos.' });
    }
  }
  if (trimmedEmail && !EMAIL_REGEX.test(trimmedEmail)) {
    return res.status(400).json({ success: false, error: 'Formato de email inválido.' });
  }

  // ── Resolver company_id do comentário ─────────────────────────────────────
  const { data: comment, error: commentErr } = await svc
    .from('instagram_comments')
    .select('id, company_id, connection_id, ig_user_id')
    .eq('id', commentId)
    .maybeSingle();

  if (commentErr || !comment) {
    return res.status(404).json({ success: false, error: 'Comentário não encontrado.' });
  }

  const auth = await validateInstagramCaller(req, svc, comment.company_id);
  if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

  const ipAddress = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').slice(0, 100) || null;
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 512) || null;

  // ── Chamar RPC transacional ────────────────────────────────────────────────
  const { data: rpc, error: rpcErr } = await svc.rpc('create_lead_from_instagram_comment', {
    p_comment_id:   commentId,
    p_name:         trimmedName,
    p_performed_by: auth.userId,
    p_phone:        trimmedPhone || null,
    p_email:        trimmedEmail || null,
    p_ip_address:   ipAddress,
    p_user_agent:   userAgent,
  });

  if (rpcErr) {
    console.error('[ig/comment/create-lead] RPC error:', rpcErr.message);
    return res.status(500).json({ success: false, error: 'Erro interno ao processar.' });
  }

  if (!rpc?.success) {
    const code = rpc?.error;
    if (code === 'comment_not_found') return res.status(404).json({ success: false, error: 'Comentário não encontrado.' });
    if (code === 'validation_error')  return res.status(400).json({ success: false, error: rpc?.detail ?? 'Dados inválidos.' });
    if (code === 'plan_limit_exceeded') {
      return res.status(422).json({
        success: false,
        error:   'plan_limit_exceeded',
        message: 'Limite de leads do plano atingido.',
      });
    }
    console.error('[ig/comment/create-lead] RPC retornou erro:', code, rpc);
    return res.status(500).json({ success: false, error: 'Erro interno.' });
  }

  const { action, lead_id } = rpc;

  // ── Pós-processamento (fire-and-forget) ────────────────────────────────────
  if (action === 'lead_created') {
    dispatchLeadCreatedTrigger(
      { companyId: comment.company_id, leadId: lead_id, source: 'instagram' },
      svc,
    ).catch(err => console.error('[ig/comment/create-lead] dispatchLeadCreatedTrigger:', err?.message));
  }

  if (action === 'lead_linked') {
    handleLeadReentry({
      newLeadId:       lead_id,
      existingLeadId:  lead_id,
      companyId:       comment.company_id,
      source:          'instagram',
      originChannel:   'instagram',
      externalEventId: commentId,
      metadata:        { comment_id: commentId, ig_user_id: comment.ig_user_id },
      supabase:        svc,
    }).catch(err => console.error('[ig/comment/create-lead] handleLeadReentry:', err?.message));
  }

  return res.status(action === 'lead_created' ? 201 : 200).json({
    success: true,
    action,
    lead_id,
  });
}
