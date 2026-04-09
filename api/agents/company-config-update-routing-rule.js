// =============================================================================
// POST /api/agents/company-config/update-routing-rule
//
// Ativa ou desativa uma routing rule da empresa (MVP: apenas is_active).
//
// AUTENTICAÇÃO: JWT + membership ativa + role admin/system_admin/super_admin.
// MULTI-TENANT: routing_rule.company_id validado contra company_id do request.
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = 'https://etzdsywunlpbgxkphuil.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const WRITE_ROLES = ['admin', 'system_admin', 'super_admin'];

// ── Validação de caller (JWT + membership + role) ─────────────────────────────

async function validateCaller(req, companyId) {
  const anonKey    = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const authHeader = req.headers?.authorization;

  if (!authHeader || !String(authHeader).startsWith('Bearer ') || !anonKey) {
    return { ok: false, status: 401, error: 'Autenticação necessária' };
  }

  const callerClient = createClient(SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: String(authHeader) } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) {
    return { ok: false, status: 401, error: 'Sessão inválida ou expirada' };
  }

  const { data: membership } = await callerClient
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();

  if (!membership) {
    return { ok: false, status: 403, error: 'Acesso negado à empresa' };
  }

  return { ok: true, callerId: user.id, role: membership.role };
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use POST.' });
  }
  if (!SERVICE_ROLE_KEY) {
    return res.status(500).json({ success: false, error: 'Configuração interna inválida.' });
  }

  const { company_id, routing_rule_id, is_active } = req.body ?? {};

  // ── Validação de entrada ───────────────────────────────────────────────────

  if (!company_id || !routing_rule_id) {
    return res.status(400).json({
      success: false,
      error: 'company_id e routing_rule_id são obrigatórios.'
    });
  }

  if (is_active === undefined) {
    return res.status(400).json({ success: false, error: 'is_active é obrigatório.' });
  }

  // ── Validar caller (JWT + membership + role) ──────────────────────────────

  const auth = await validateCaller(req, company_id);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }

  if (!WRITE_ROLES.includes(auth.role)) {
    return res.status(403).json({
      success: false,
      error: 'Permissão insuficiente. Requer role admin, system_admin ou super_admin.'
    });
  }

  // ── Verificar que a regra pertence à empresa (cross-tenant guard) ──────────

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('agent_routing_rules')
    .select('id, company_id, is_active')
    .eq('id', routing_rule_id)
    .eq('company_id', company_id)
    .maybeSingle();

  if (fetchErr || !existing) {
    return res.status(404).json({
      success: false,
      error: 'Regra de roteamento não encontrada ou não pertence a esta empresa.'
    });
  }

  // ── Aplicar UPDATE ─────────────────────────────────────────────────────────

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('agent_routing_rules')
    .update({ is_active: Boolean(is_active) })
    .eq('id', routing_rule_id)
    .eq('company_id', company_id)
    .select('id, is_active, updated_at')
    .single();

  if (updateErr) {
    console.error('[company-config/update-routing-rule] Erro ao atualizar:', updateErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao salvar alteração.' });
  }

  console.log('[company-config/update-routing-rule] Routing rule atualizada:', {
    routing_rule_id,
    company_id,
    is_active: Boolean(is_active),
    by: auth.callerId
  });

  return res.status(200).json({ success: true, data: updated });
}
