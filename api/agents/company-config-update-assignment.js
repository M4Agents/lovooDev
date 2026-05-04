// =============================================================================
// POST /api/agents/company-config/update-assignment
//
// Atualiza um company_agent_assignment da empresa.
// Campos permitidos: is_active, agent_id, capabilities, price_display_policy.
//
// AUTENTICAÇÃO: JWT + membership ativa + role admin/system_admin/super_admin.
// MULTI-TENANT: assignment.company_id validado contra company_id do request.
// SEGURANÇA: whitelist explícita de campos — extras são ignorados.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { validateOperatingSchedule } from '../lib/agents/scheduleValidator.js';

const SUPABASE_URL     = 'https://etzdsywunlpbgxkphuil.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const WRITE_ROLES = ['admin', 'system_admin', 'super_admin'];

const VALID_PRICE_POLICIES = ['disabled', 'fixed_only', 'range_allowed', 'consult_only'];

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

  const { company_id, assignment_id, is_active, agent_id, capabilities, price_display_policy, operating_schedule } =
    req.body ?? {};

  // ── Validação de entrada ───────────────────────────────────────────────────

  if (!company_id || !assignment_id) {
    return res.status(400).json({
      success: false,
      error: 'company_id e assignment_id são obrigatórios.'
    });
  }

  if (price_display_policy !== undefined && !VALID_PRICE_POLICIES.includes(price_display_policy)) {
    return res.status(400).json({
      success: false,
      error: `price_display_policy inválido: "${price_display_policy}". Valores permitidos: ${VALID_PRICE_POLICIES.join(', ')}.`
    });
  }

  // ── Validar operating_schedule (se enviado) ───────────────────────────────

  if (operating_schedule !== undefined) {
    const scheduleValidation = validateOperatingSchedule(operating_schedule);
    if (!scheduleValidation.valid) {
      return res.status(400).json({ success: false, error: scheduleValidation.reason });
    }
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

  // ── Verificar que o assignment pertence à empresa (cross-tenant guard) ─────

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('company_agent_assignments')
    .select('id, company_id, agent_id')
    .eq('id', assignment_id)
    .eq('company_id', company_id)
    .maybeSingle();

  if (fetchErr || !existing) {
    return res.status(404).json({
      success: false,
      error: 'Assignment não encontrado ou não pertence a esta empresa.'
    });
  }

  // ── Validar agent_id quando informado ─────────────────────────────────────

  if (agent_id !== undefined) {
    const { data: agent } = await supabaseAdmin
      .from('lovoo_agents')
      .select('id')
      .eq('id', agent_id)
      .maybeSingle();

    if (!agent) {
      return res.status(400).json({ success: false, error: 'agent_id não encontrado.' });
    }
  }

  // ── Montar payload com whitelist explícita ────────────────────────────────

  const updatePayload = {};

  if (is_active !== undefined)            updatePayload.is_active            = Boolean(is_active);
  if (agent_id  !== undefined)            updatePayload.agent_id             = agent_id;
  if (price_display_policy !== undefined) updatePayload.price_display_policy = price_display_policy;
  // operating_schedule: null limpa o schedule (sem restrição); objeto = nova config validada
  if (operating_schedule !== undefined)   updatePayload.operating_schedule   = operating_schedule ?? null;

  if (capabilities !== undefined && typeof capabilities === 'object' && capabilities !== null) {
    // Merge apenas as capabilities conhecidas — nunca substituir com campos arbitrários
    const KNOWN_CAPS = ['can_auto_reply', 'can_inform_prices', 'can_send_media'];
    const filteredCaps = {};
    for (const cap of KNOWN_CAPS) {
      if (cap in capabilities) filteredCaps[cap] = Boolean(capabilities[cap]);
    }
    if (Object.keys(filteredCaps).length > 0) {
      // Buscar capabilities atuais para merge seguro
      const { data: current } = await supabaseAdmin
        .from('company_agent_assignments')
        .select('capabilities')
        .eq('id', assignment_id)
        .single();

      updatePayload.capabilities = { ...(current?.capabilities ?? {}), ...filteredCaps };
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return res.status(400).json({ success: false, error: 'Nenhum campo válido para atualizar.' });
  }

  // ── Aplicar UPDATE ─────────────────────────────────────────────────────────

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('company_agent_assignments')
    .update(updatePayload)
    .eq('id', assignment_id)
    .eq('company_id', company_id)
    .select('id, is_active, agent_id, capabilities, price_display_policy, operating_schedule, updated_at')
    .single();

  if (updateErr) {
    console.error('[company-config/update-assignment] Erro ao atualizar:', updateErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao salvar alteração.' });
  }

  console.log('[company-config/update-assignment] Assignment atualizado:', {
    assignment_id,
    company_id,
    fields: Object.keys(updatePayload),
    by: auth.callerId
  });

  return res.status(200).json({ success: true, data: updated });
}
