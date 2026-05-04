// =============================================================================
// POST /api/agents/company-config-create-assignment
//
// Cria o primeiro vínculo canal ↔ agente (company_agent_assignments) para uma
// empresa e adiciona automaticamente uma routing rule fallback vinculada.
//
// AUTENTICAÇÃO: JWT + membership ativa + role admin/system_admin/super_admin.
// MULTI-TENANT:
//   - company_id validado contra company_users do caller
//   - agent_id validado contra lovoo_agents.company_id (cross-tenant guard)
// IDEMPOTÊNCIA: retorna 409 se o par (company_id, agent_id, channel) já existir.
// CONSISTÊNCIA:
//   - assignment é criado primeiro; routing rule fallback em seguida.
//   - se a routing rule falhar, o assignment permanece válido (a tela renderiza).
//   - o erro da routing rule é logado como warning — não reverte o assignment.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { validateOperatingSchedule } from '../lib/agents/scheduleValidator.js';

const SUPABASE_URL     = 'https://etzdsywunlpbgxkphuil.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const WRITE_ROLES        = ['admin', 'system_admin', 'super_admin'];
const VALID_CHANNELS     = ['whatsapp', 'web', 'email', 'sms'];
const VALID_PRICE_POLICIES = ['disabled', 'fixed_only', 'range_allowed', 'consult_only'];

// ── Validação de caller (JWT + membership + role) ─────────────────────────────
// Padrão idêntico ao company-config-update-assignment.js

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

  const {
    company_id,
    agent_id,
    channel,
    display_name,
    capabilities,
    price_display_policy,
    operating_schedule,
  } = req.body ?? {};

  // ── Validação de campos obrigatórios ──────────────────────────────────────

  if (!company_id) {
    return res.status(400).json({ success: false, error: 'company_id é obrigatório.' });
  }
  if (!agent_id) {
    return res.status(400).json({ success: false, error: 'agent_id é obrigatório.' });
  }
  if (!channel || !VALID_CHANNELS.includes(channel)) {
    return res.status(400).json({
      success: false,
      error: `channel inválido. Valores permitidos: ${VALID_CHANNELS.join(', ')}.`
    });
  }
  const trimmedName = typeof display_name === 'string' ? display_name.trim() : '';
  if (!trimmedName) {
    return res.status(400).json({ success: false, error: 'display_name é obrigatório e não pode estar vazio.' });
  }
  if (price_display_policy !== undefined && !VALID_PRICE_POLICIES.includes(price_display_policy)) {
    return res.status(400).json({
      success: false,
      error: `price_display_policy inválido. Valores permitidos: ${VALID_PRICE_POLICIES.join(', ')}.`
    });
  }

  // ── Validar operating_schedule (se enviado) ───────────────────────────────

  if (operating_schedule !== undefined) {
    const scheduleValidation = validateOperatingSchedule(operating_schedule);
    if (!scheduleValidation.valid) {
      return res.status(400).json({ success: false, error: scheduleValidation.reason });
    }
  }

  // ── Validar caller (JWT + membership) ─────────────────────────────────────
  // company_id do body NÃO é confiado cegamente: validateCaller confirma que
  // o caller tem membership ativa nessa empresa específica.

  const auth = await validateCaller(req, company_id);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }

  // ── Validar role de escrita explícito ─────────────────────────────────────

  if (!WRITE_ROLES.includes(auth.role)) {
    return res.status(403).json({
      success: false,
      error: 'Permissão insuficiente. Requer role admin, system_admin ou super_admin.'
    });
  }

  // ── Cross-tenant guard: agent_id deve pertencer à empresa alvo ───────────
  // Impede que um caller use agent_id de outra empresa no assignment.

  const { data: agentExists, error: agentErr } = await supabaseAdmin
    .from('lovoo_agents')
    .select('id')
    .eq('id', agent_id)
    .eq('company_id', company_id)
    .eq('agent_type', 'conversational')
    .eq('is_active', true)
    .maybeSingle();

  if (agentErr) {
    console.error('[company-config-create-assignment] Erro ao validar agente:', agentErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao validar agente.' });
  }

  if (!agentExists) {
    return res.status(400).json({
      success: false,
      error: 'Agente não encontrado ou não pertence a esta empresa.'
    });
  }

  // ── Conflict guard: UNIQUE (company_id, agent_id, channel) ───────────────
  // Verificação explícita antes do INSERT para retornar 409 claro ao usuário.

  const { data: duplicate } = await supabaseAdmin
    .from('company_agent_assignments')
    .select('id')
    .eq('company_id', company_id)
    .eq('agent_id', agent_id)
    .eq('channel', channel)
    .maybeSingle();

  if (duplicate) {
    return res.status(409).json({
      success: false,
      error: 'Já existe um assignment para este agente e canal nesta empresa.'
    });
  }

  // ── Montar capabilities com merge seguro nos campos conhecidos ────────────

  const DEFAULT_CAPABILITIES = {
    can_auto_reply:              false,
    can_send_media:              true,
    can_inform_prices:           false,
    can_update_lead:             false,
    can_update_opportunity:      false,
    can_move_opportunity_stage:  false,
    can_request_handoff:         true,
  };

  let finalCapabilities = { ...DEFAULT_CAPABILITIES };
  if (capabilities && typeof capabilities === 'object') {
    const KNOWN_CAPS = ['can_auto_reply', 'can_inform_prices'];
    for (const cap of KNOWN_CAPS) {
      if (cap in capabilities) {
        finalCapabilities[cap] = Boolean(capabilities[cap]);
      }
    }
  }

  // ── INSERT em company_agent_assignments ───────────────────────────────────

  const { data: newAssignment, error: insertErr } = await supabaseAdmin
    .from('company_agent_assignments')
    .insert({
      company_id:           company_id,
      agent_id:             agent_id,
      channel:              channel,
      display_name:         trimmedName,
      capabilities:         finalCapabilities,
      price_display_policy: VALID_PRICE_POLICIES.includes(price_display_policy)
                              ? price_display_policy
                              : 'disabled',
      operating_schedule:   operating_schedule ?? null,
      is_active:            true,
    })
    .select('id, company_id, agent_id, channel, display_name, capabilities, price_display_policy, operating_schedule, is_active, created_at, updated_at, lovoo_agents(id, name)')
    .single();

  if (insertErr) {
    console.error('[company-config-create-assignment] Erro ao criar assignment:', insertErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao criar assignment.' });
  }

  // ── INSERT em agent_routing_rules (fallback catch-all) ────────────────────
  // Criado automaticamente para garantir que o agente seja ativado.
  // Se falhar, o assignment permanece válido e a tela renderiza corretamente.

  const { error: routingErr } = await supabaseAdmin
    .from('agent_routing_rules')
    .insert({
      company_id:         company_id,
      assignment_id:      newAssignment.id,
      channel:            channel,
      event_type:         null,
      source_type:        null,
      source_identifier:  null,
      priority:           999,
      is_fallback:        true,
      is_active:          true,
      description:        `Fallback automático — ${trimmedName}`,
    });

  if (routingErr) {
    console.warn(
      '[company-config-create-assignment] Assignment criado, mas routing rule fallback falhou:',
      routingErr.message,
      { assignment_id: newAssignment.id, company_id }
    );
  } else {
    console.log('[company-config-create-assignment] Assignment + routing rule criados:', {
      assignment_id: newAssignment.id,
      company_id,
      agent_id,
      channel,
      by: auth.callerId
    });
  }

  // ── Normalizar e retornar ─────────────────────────────────────────────────

  return res.status(201).json({
    success: true,
    data: {
      id:                   newAssignment.id,
      company_id:           newAssignment.company_id,
      agent_id:             newAssignment.agent_id,
      agent_name:           newAssignment.lovoo_agents?.name ?? null,
      channel:              newAssignment.channel,
      display_name:         newAssignment.display_name,
      capabilities:         newAssignment.capabilities,
      price_display_policy: newAssignment.price_display_policy,
      operating_schedule:   newAssignment.operating_schedule ?? null,
      is_active:            newAssignment.is_active,
      created_at:           newAssignment.created_at,
      updated_at:           newAssignment.updated_at,
    }
  });
}
