// =============================================================================
// GET /api/agents/company-config?company_id=<uuid>
//
// Retorna os company_agent_assignments e as routing rules fallback da empresa.
// Também retorna a lista de lovoo_agents disponíveis (para o select de troca).
//
// AUTENTICAÇÃO: JWT + membership ativa na empresa (qualquer role pode ler).
// MULTI-TENANT: company_id validado contra company_users do caller.
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

  // ── Buscar assignments da empresa ─────────────────────────────────────────

  const { data: assignments, error: assignErr } = await supabaseAdmin
    .from('company_agent_assignments')
    .select(`
      id,
      company_id,
      agent_id,
      channel,
      display_name,
      capabilities,
      price_display_policy,
      is_active,
      created_at,
      updated_at,
      lovoo_agents ( id, name )
    `)
    .eq('company_id', company_id)
    .order('created_at', { ascending: true });

  if (assignErr) {
    console.error('[company-config] Erro ao buscar assignments:', assignErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao carregar configurações.' });
  }

  // ── Buscar routing rules fallback da empresa ──────────────────────────────

  const { data: routingRules, error: routingErr } = await supabaseAdmin
    .from('agent_routing_rules')
    .select(`
      id,
      company_id,
      assignment_id,
      channel,
      priority,
      is_fallback,
      is_active,
      description,
      created_at,
      updated_at,
      company_agent_assignments ( id, display_name, channel )
    `)
    .eq('company_id', company_id)
    .eq('is_fallback', true)
    .order('priority', { ascending: true });

  if (routingErr) {
    console.error('[company-config] Erro ao buscar routing rules:', routingErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao carregar regras de roteamento.' });
  }

  // ── Buscar agentes disponíveis (para o select de troca) ───────────────────
  // Usa service_role — lovoo_agents tem RLS restrita à empresa-pai,
  // mas o admin de qualquer empresa precisa ver os agentes ao trocar o assignment.
  //
  // FILTRO: incluir apenas agentes conversacionais, ou seja, agentes que:
  //   - NÃO possuem nenhum binding, OU
  //   - possuem bindings EXCLUSIVAMENTE no namespace 'chat:'
  // Agentes com bindings em 'products:' ou 'services:' são de governança SaaS
  // e não devem aparecer no painel de configuração de empresa.

  const { data: allAgents, error: agentsErr } = await supabaseAdmin
    .from('lovoo_agents')
    .select('id, name, agent_use_bindings(use_id)')
    .order('name', { ascending: true });

  if (agentsErr) {
    console.warn('[company-config] Aviso: não foi possível carregar agentes disponíveis:', agentsErr.message);
  }

  // Filtrar agentes conversacionais: sem binding OU apenas bindings 'chat:*'
  const availableAgents = (allAgents ?? []).filter((a) => {
    const bindings = a.agent_use_bindings ?? [];
    return bindings.length === 0 || bindings.every((b) => b.use_id?.startsWith('chat:'));
  });

  // #region agent log
  fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '37d3c1' },
    body: JSON.stringify({
      sessionId: '37d3c1',
      location: 'company-config.js:available_agents_filter',
      message: 'available_agents após filtro conversacional',
      data: {
        total_before_filter: (allAgents ?? []).length,
        total_after_filter:  availableAgents.length,
        agents_returned:     availableAgents.map((a) => a.name),
        agents_excluded:     (allAgents ?? []).filter((a) => !availableAgents.includes(a)).map((a) => ({
          name:     a.name,
          bindings: (a.agent_use_bindings ?? []).map((b) => b.use_id)
        }))
      },
      hypothesisId: 'H-A',
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion

  // ── Normalizar resposta ───────────────────────────────────────────────────

  const normalizedAssignments = (assignments ?? []).map((a) => ({
    id:                   a.id,
    company_id:           a.company_id,
    agent_id:             a.agent_id,
    agent_name:           a.lovoo_agents?.name ?? null,
    channel:              a.channel,
    display_name:         a.display_name,
    capabilities:         a.capabilities ?? {},
    price_display_policy: a.price_display_policy,
    is_active:            a.is_active,
    created_at:           a.created_at,
    updated_at:           a.updated_at
  }));

  const normalizedRules = (routingRules ?? []).map((r) => ({
    id:                          r.id,
    company_id:                  r.company_id,
    assignment_id:               r.assignment_id,
    assignment_display_name:     r.company_agent_assignments?.display_name ?? null,
    assignment_channel:          r.company_agent_assignments?.channel ?? null,
    channel:                     r.channel,
    priority:                    r.priority,
    is_fallback:                 r.is_fallback,
    is_active:                   r.is_active,
    description:                 r.description,
    created_at:                  r.created_at,
    updated_at:                  r.updated_at
  }));

  return res.status(200).json({
    success: true,
    data: {
      assignments:             normalizedAssignments,
      routing_rules_fallback:  normalizedRules,
      available_agents:        availableAgents.map((a) => ({ id: a.id, name: a.name }))
    }
  });
}
