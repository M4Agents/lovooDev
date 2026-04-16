// =============================================================================
// POST /api/agents/company-agents-delete
//
// Exclui permanentemente um agente conversacional da empresa.
//
// AUTENTICAÇÃO: JWT + membership ativa + role admin/system_admin/super_admin.
// MULTI-TENANT: confirma que o agente pertence ao company_id do caller (JWT).
// SEGURANÇA:
//   - company_id do body ignorado — sempre usa o company_id do caller (JWT)
//   - somente agent_type 'conversational' pode ser excluído por esta rota
//   - DELETE físico — operação irreversível
//
// OBRIGATÓRIO:
//   - company_id (para lookup de membership)
//   - agent_id
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
    auth:   { persistSession: false, autoRefreshToken: false }
  });

  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) {
    return { ok: false, status: 401, error: 'Sessão inválida ou expirada' };
  }

  const { data: membership } = await callerClient
    .from('company_users')
    .select('role, company_id')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();

  if (!membership) {
    return { ok: false, status: 403, error: 'Acesso negado à empresa' };
  }

  return { ok: true, callerId: user.id, role: membership.role, callerCompanyId: membership.company_id };
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

  const { company_id, agent_id } = req.body ?? {};

  if (!company_id || !agent_id) {
    return res.status(400).json({ success: false, error: 'company_id e agent_id são obrigatórios.' });
  }

  // ── Validar caller (JWT + membership + role) ──────────────────────────────

  const auth = await validateCaller(req, company_id);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }

  if (!WRITE_ROLES.includes(auth.role)) {
    return res.status(403).json({
      success: false,
      error:   'Permissão insuficiente. Requer role admin, system_admin ou super_admin.'
    });
  }

  // ── Cross-tenant guard: confirmar que o agente pertence à empresa do caller ─

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('lovoo_agents')
    .select('id, company_id, name, agent_type')
    .eq('id', agent_id)
    .eq('company_id', auth.callerCompanyId)  // company_id do JWT — nunca do body
    .eq('agent_type', 'conversational')       // apenas agentes conversacionais
    .maybeSingle();

  if (fetchErr) {
    console.error('[company-agents/delete] Erro ao buscar agente:', fetchErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao validar agente.' });
  }

  if (!existing) {
    return res.status(404).json({
      success: false,
      error:   'Agente não encontrado ou não pertence a esta empresa.'
    });
  }

  // ── DELETE físico ─────────────────────────────────────────────────────────

  const { error: deleteErr } = await supabaseAdmin
    .from('lovoo_agents')
    .delete()
    .eq('id', agent_id)
    .eq('company_id', auth.callerCompanyId)  // double-check cross-tenant
    .eq('agent_type', 'conversational');

  if (deleteErr) {
    console.error('[company-agents/delete] Erro ao excluir agente:', deleteErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao excluir agente.' });
  }

  console.log('[company-agents/delete] Agente excluído:', {
    agent_id:   agent_id,
    agent_name: existing.name,
    company_id: auth.callerCompanyId,
    by:         auth.callerId
  });

  return res.status(200).json({ success: true, deleted_id: agent_id });
}
