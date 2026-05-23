// =============================================================================
// POST /api/instagram/conversations/[conversationId]/create-lead
//
// Converte um Instagram Contact em Lead real do CRM.
//
// AUTENTICAÇÃO : JWT via Authorization: Bearer <token>
// AUTORIZAÇÃO  : RBAC — super_admin, system_admin, partner (+assignment),
//                admin, manager, seller
// MULTI-TENANT : company_id resolvido da conversa (banco), NUNCA do payload
// CRIAÇÃO      : RPC create_or_link_instagram_lead (transação atômica)
// PÓS-CRIAÇÃO  : dispatchLeadCreatedTrigger (lead_created)
//              : handleLeadReentry (lead_linked)
//
// Campos bloqueados no payload: rejeita com 400 se enviados.
// =============================================================================

import { validateInstagramCaller }      from '../../../lib/instagram/validateInstagramCaller.js';
import { dispatchLeadCreatedTrigger }   from '../../../lib/automation/dispatchLeadCreatedTrigger.js';
import { handleLeadReentry }            from '../../../lib/leads/handleLeadReentry.js';
import { getSupabaseAdmin }             from '../../../lib/automation/supabaseAdmin.js';

// Campos que nunca devem ser aceitos do payload (retorno 400 se presentes)
const BLOCKED_FIELDS = new Set([
  'company_id', 'connection_id', 'lead_id', 'origin', 'responsible_user_id',
  'role', 'permissions', 'plan_id', 'is_active', 'is_over_plan',
  'deleted_at', 'created_at', 'updated_at',
  'password', 'token', 'secret', 'authorization', 'jwt', 'api_key',
]);

const UUID_REGEX  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use POST.' });
  }

  // ── 1. Client service_role ────────────────────────────────────────────────
  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ success: false, error: 'Configuração interna inválida.' });
  }

  // ── 2. conversationId da rota dinâmica ────────────────────────────────────
  const { conversationId } = req.query ?? {};

  if (!conversationId || !UUID_REGEX.test(String(conversationId))) {
    return res.status(400).json({ success: false, error: 'conversationId inválido.' });
  }

  // ── 3. Validar payload ────────────────────────────────────────────────────
  const body = req.body ?? {};

  for (const field of BLOCKED_FIELDS) {
    if (field in body) {
      return res.status(400).json({
        success: false,
        error:   `Campo não permitido no payload: ${field}`,
        field,
      });
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
      return res.status(400).json({
        success: false,
        error:   'Telefone deve ter pelo menos 10 dígitos.',
      });
    }
  }

  if (trimmedEmail && !EMAIL_REGEX.test(trimmedEmail)) {
    return res.status(400).json({ success: false, error: 'Formato de email inválido.' });
  }

  // ── 4. Resolver company_id a partir da conversa (banco, nunca do payload) ─
  const { data: conv, error: convErr } = await svc
    .from('instagram_conversations')
    .select('id, company_id')
    .eq('id', conversationId)
    .maybeSingle();

  if (convErr) {
    console.error('[ig/create-lead] erro ao buscar conversa:', convErr.message);
    return res.status(500).json({ success: false, error: 'Erro interno.' });
  }

  if (!conv) {
    return res.status(404).json({ success: false, error: 'Conversa não encontrada.' });
  }

  const companyId = conv.company_id;

  // ── 5. Autenticar + autorizar caller (RBAC + partner + Trilha 2) ──────────
  const auth = await validateInstagramCaller(req, svc, companyId);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }

  // ── 6. Chamar RPC transacional ────────────────────────────────────────────
  const ipAddress = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').slice(0, 100) || null;
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 512) || null;

  const { data: rpc, error: rpcErr } = await svc.rpc('create_or_link_instagram_lead', {
    p_conversation_id: conversationId,
    p_name:            trimmedName,
    p_performed_by:    auth.userId,
    p_phone:           trimmedPhone || null,
    p_email:           trimmedEmail || null,
    p_ip_address:      ipAddress,
    p_user_agent:      userAgent,
  });

  if (rpcErr) {
    console.error('[ig/create-lead] erro PostgREST na RPC:', rpcErr.message);
    return res.status(500).json({ success: false, error: 'Erro interno ao processar.' });
  }

  // ── 7. Mapear erros de negócio da RPC ─────────────────────────────────────
  if (!rpc?.success) {
    const code = rpc?.error;

    if (code === 'conversation_not_found') {
      return res.status(404).json({ success: false, error: 'Conversa não encontrada.' });
    }
    if (code === 'validation_error') {
      return res.status(400).json({ success: false, error: rpc?.detail ?? 'Dados inválidos.' });
    }
    if (code === 'plan_limit_exceeded') {
      return res.status(422).json({
        success:     false,
        error:       'Limite de leads do plano atingido.',
        max_allowed: rpc?.max_allowed ?? null,
        current:     rpc?.current     ?? null,
      });
    }
    if (code === 'social_profile_conflict') {
      return res.status(409).json({ success: false, error: 'Conflito no perfil social.' });
    }

    console.error('[ig/create-lead] RPC retornou erro não mapeado:', code, rpc);
    return res.status(500).json({ success: false, error: 'Erro interno.' });
  }

  const { action, lead_id, social_profile_id, matched_by, is_duplicate } = rpc;

  // ── 8. Pós-processamento (fire-and-forget — nunca desfaz a RPC) ──────────
  // Falhas aqui não revertem a criação/vinculação do lead.
  if (action === 'lead_created') {
    dispatchLeadCreatedTrigger(
      { companyId, leadId: lead_id, source: 'instagram' },
      svc,
    ).catch(err => console.error('[ig/create-lead] dispatchLeadCreatedTrigger error:', err?.message));
  }

  if (action === 'lead_linked') {
    handleLeadReentry({
      newLeadId:       lead_id,
      existingLeadId:  lead_id,
      companyId,
      source:          'instagram',
      originChannel:   'instagram',
      externalEventId: conversationId,
      metadata:        { conversation_id: conversationId, matched_by: matched_by ?? null },
      supabase:        svc,
    }).catch(err => console.error('[ig/create-lead] handleLeadReentry error:', err?.message));
  }

  // ── 9. Resposta ────────────────────────────────────────────────────────────
  const httpStatus = action === 'lead_created' ? 201 : 200;

  const responseBody = {
    success:         true,
    action,
    lead_id,
    conversation_id: conversationId,
  };

  if (action === 'lead_created' || action === 'lead_linked') {
    responseBody.social_profile_id = social_profile_id ?? null;
    responseBody.is_duplicate      = is_duplicate      ?? false;
  }

  if (action === 'lead_linked') {
    responseBody.matched_by = matched_by ?? null;
  }

  return res.status(httpStatus).json(responseBody);
}
