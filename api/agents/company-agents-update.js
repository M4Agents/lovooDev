// =============================================================================
// POST /api/agents/company-agents/update
//
// Atualiza um agente conversacional da empresa.
//
// AUTENTICAÇÃO: JWT + membership ativa + role admin/system_admin/super_admin.
// MULTI-TENANT: verifica que o agente pertence ao company_id do caller.
// SEGURANÇA:
//   - agent_type NÃO pode ser alterado
//   - company_id NÃO pode ser alterado
//   - RAG bloqueado (knowledge_mode: apenas 'none' ou 'inline')
//   - só os campos da whitelist são atualizados
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

const WRITE_ROLES           = ['admin', 'system_admin', 'super_admin'];
const VALID_KNOWLEDGE_MODES  = ['none', 'inline']; // RAG bloqueado no MVP

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

  const {
    company_id,
    agent_id,
    name,
    description,
    prompt,
    model,
    knowledge_mode,
    is_active,
    model_config
  } = req.body ?? {};

  // ── Validação mínima ───────────────────────────────────────────────────────

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
      error: 'Permissão insuficiente. Requer role admin, system_admin ou super_admin.'
    });
  }

  // ── Cross-tenant guard: agente deve pertencer à empresa do caller ─────────

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('lovoo_agents')
    .select('id, company_id, agent_type')
    .eq('id', agent_id)
    .eq('company_id', auth.callerCompanyId)  // company_id do JWT, não do body
    .eq('agent_type', 'conversational')       // apenas agentes conversacionais
    .maybeSingle();

  if (fetchErr) {
    console.error('[company-agents/update] Erro ao buscar agente:', fetchErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao validar agente.' });
  }

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: 'Agente não encontrado ou não pertence a esta empresa.'
    });
  }

  // ── Montar payload — whitelist estrita ────────────────────────────────────
  // agent_type e company_id são IMUTÁVEIS — nunca incluídos no update.

  const updatePayload = {};

  if (typeof name === 'string') {
    const trimmed = name.trim();
    if (!trimmed) {
      return res.status(400).json({ success: false, error: 'name não pode estar vazio.' });
    }
    updatePayload.name = trimmed;
  }

  if (typeof description !== 'undefined') {
    updatePayload.description = typeof description === 'string' ? description.trim() || null : null;
  }

  if (typeof prompt === 'string') {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return res.status(400).json({ success: false, error: 'prompt não pode estar vazio.' });
    }
    updatePayload.prompt = trimmedPrompt;
  }

  if (typeof model === 'string' && model.trim()) {
    updatePayload.model = model.trim();
  }

  if (knowledge_mode !== undefined) {
    updatePayload.knowledge_mode = VALID_KNOWLEDGE_MODES.includes(knowledge_mode) ? knowledge_mode : 'none';
  }

  if (is_active !== undefined) {
    updatePayload.is_active = Boolean(is_active);
  }

  if (typeof model_config === 'object' && model_config !== null) {
    updatePayload.model_config = model_config;
  }

  if (Object.keys(updatePayload).length === 0) {
    return res.status(400).json({ success: false, error: 'Nenhum campo válido para atualizar.' });
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────────

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('lovoo_agents')
    .update(updatePayload)
    .eq('id', agent_id)
    .eq('company_id', auth.callerCompanyId)  // dupla proteção cross-tenant
    .select('id, name, description, is_active, model, prompt, knowledge_mode, model_config, agent_type, company_id, updated_at')
    .single();

  if (updateErr) {
    console.error('[company-agents/update] Erro ao atualizar agente:', updateErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao atualizar agente.' });
  }

  console.log('[company-agents/update] Agente atualizado:', {
    agent_id:   updated.id,
    company_id: updated.company_id,
    fields:     Object.keys(updatePayload),
    by:         auth.callerId
  });

  return res.status(200).json({ success: true, data: updated });
}
