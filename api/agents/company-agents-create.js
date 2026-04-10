// =============================================================================
// POST /api/agents/company-agents/create
//
// Cria um agente conversacional para a empresa do caller.
//
// AUTENTICAÇÃO: JWT + membership ativa + role admin/system_admin/super_admin.
// MULTI-TENANT: company_id SEMPRE derivado do JWT — body ignorado.
// SEGURANÇA:
//   - agent_type forçado como 'conversational' — nunca vem do body
//   - company_id do body ignorado — sempre usa o company_id do caller
//   - RAG bloqueado (knowledge_mode: apenas 'none' ou 'inline')
//   - campos sensíveis fora da whitelist são ignorados
//
// OBRIGATÓRIO:
//   - name (string não vazia)
//   - prompt (string não vazia)
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = 'https://etzdsywunlpbgxkphuil.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const WRITE_ROLES          = ['admin', 'system_admin', 'super_admin'];
const VALID_KNOWLEDGE_MODES = ['none', 'inline']; // RAG bloqueado no MVP
const DEFAULT_MODEL        = 'gpt-4.1-mini';

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

  // company_id vem do body apenas para identificar membership — será validado
  // e substituído pelo company_id real do JWT no INSERT.
  const {
    company_id,
    name,
    description,
    prompt,
    model,
    knowledge_mode,
    is_active,
    model_config
  } = req.body ?? {};

  // ── Validação de entrada ───────────────────────────────────────────────────

  if (!company_id) {
    return res.status(400).json({ success: false, error: 'company_id é obrigatório.' });
  }

  const trimmedName   = typeof name   === 'string' ? name.trim()   : '';
  const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';

  if (!trimmedName) {
    return res.status(400).json({ success: false, error: 'name é obrigatório e não pode estar vazio.' });
  }

  if (!trimmedPrompt) {
    return res.status(400).json({ success: false, error: 'prompt é obrigatório e não pode estar vazio.' });
  }

  const resolvedKnowledgeMode = VALID_KNOWLEDGE_MODES.includes(knowledge_mode) ? knowledge_mode : 'none';

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

  // ── Montar payload — company_id do JWT, agent_type forçado ────────────────

  const insertPayload = {
    company_id:     auth.callerCompanyId,   // SEMPRE do JWT — nunca do body
    agent_type:     'conversational',        // SEMPRE forçado
    name:           trimmedName,
    description:    typeof description === 'string' ? description.trim() || null : null,
    prompt:         trimmedPrompt,
    model:          typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL,
    knowledge_mode: resolvedKnowledgeMode,
    is_active:      is_active === false ? false : true,
    model_config:   (typeof model_config === 'object' && model_config !== null) ? model_config : {}
    // knowledge_base e knowledge_base_config bloqueados no MVP (sem RAG)
  };

  // ── INSERT ─────────────────────────────────────────────────────────────────

  const { data: agent, error: insertErr } = await supabaseAdmin
    .from('lovoo_agents')
    .insert(insertPayload)
    .select('id, name, description, is_active, model, prompt, knowledge_mode, model_config, agent_type, company_id, created_at, updated_at')
    .single();

  if (insertErr) {
    console.error('[company-agents/create] Erro ao criar agente:', insertErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao criar agente.' });
  }

  console.log('[company-agents/create] Agente criado:', {
    agent_id:   agent.id,
    company_id: agent.company_id,
    name:       agent.name,
    by:         auth.callerId
  });

  return res.status(201).json({ success: true, data: agent });
}
