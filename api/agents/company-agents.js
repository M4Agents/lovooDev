// =============================================================================
// GET /api/agents/company-agents?company_id=<uuid>
//
// Lista os agentes conversacionais de uma empresa.
//
// AUTENTICAÇÃO: JWT + membership ativa (qualquer role pode listar).
// MULTI-TENANT: retorna apenas agentes onde lovoo_agents.company_id = company_id do caller.
// FILTRO: agent_type = 'conversational' — nunca expõe agentes funcionais.
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = 'https://etzdsywunlpbgxkphuil.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ── Validação de caller (JWT + membership) ────────────────────────────────────

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

  // Verificar membership ativa na empresa
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
  // #region agent log
  try {
  // #endregion
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use GET.' });
  }
  if (!SERVICE_ROLE_KEY) {
    return res.status(500).json({ success: false, error: 'Configuração interna inválida.' });
  }

  const company_id = req.query?.company_id;

  if (!company_id) {
    return res.status(400).json({ success: false, error: 'company_id é obrigatório.' });
  }

  // ── Validar caller ────────────────────────────────────────────────────────

  const auth = await validateCaller(req, company_id);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }

  // ── Buscar agentes conversacionais da empresa ─────────────────────────────
  // Filtro duplo: company_id + agent_type — nunca expõe agentes de outra empresa
  // nem agentes funcionais (utilitários do SaaS).

  const { data: agents, error: agentsErr } = await supabaseAdmin
    .from('lovoo_agents')
    .select('id, name, description, is_active, model, prompt, prompt_config, prompt_version, knowledge_mode, model_config, allowed_tools, created_at, updated_at')
    .eq('company_id', company_id)
    .eq('agent_type', 'conversational')
    .order('created_at', { ascending: true });

  if (agentsErr) {
    // #region agent log
    console.error('[company-agents] ERRO:', JSON.stringify({ code: agentsErr.code, message: agentsErr.message, details: agentsErr.details, hint: agentsErr.hint }));
    return res.status(500).json({
      success: false,
      error:   'Erro ao carregar agentes.',
      _debug:  { code: agentsErr.code, message: agentsErr.message, details: agentsErr.details, hint: agentsErr.hint }
    });
    // #endregion
  }

  return res.status(200).json({
    success: true,
    data:    agents ?? []
  });
  // #region agent log
  } catch (uncaught) {
    console.error('[company-agents] EXCEÇÃO NÃO TRATADA:', uncaught?.message, uncaught?.stack);
    return res.status(500).json({
      success: false,
      error:   'Exceção interna.',
      _debug:  { uncaught_message: uncaught?.message, uncaught_stack: uncaught?.stack?.slice(0, 500) }
    });
  }
  // #endregion
}

