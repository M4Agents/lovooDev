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
// MODOS DE PROMPT:
//   - structured: envia prompt_config (JSONB) — backend valida + monta prompt
//   - legacy:     envia prompt (string)       — salvo diretamente
//   - nunca aceitar prompt + prompt_config juntos
//
// OBRIGATÓRIO:
//   - name (string não vazia)
//   - prompt (legacy) OU prompt_config (structured) — nunca ambos
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { validatePromptConfig } from '../lib/agents/promptConfigValidator.js';
import { assemblePrompt }        from '../lib/agents/promptAssembler.js';
import { VALID_TOOL_NAMES }      from '../lib/agents/validTools.js';
import {
  validatePromptConfig as validateFlatConfig,
  buildPromptFromConfig,
} from '../lib/agents/promptTemplate.js';
import {
  detectOperationalContent,
  OPERATIONAL_SCORE_THRESHOLD,
} from '../lib/agents/kbContentValidator.js';

const SUPABASE_URL     = 'https://etzdsywunlpbgxkphuil.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const WRITE_ROLES           = ['admin', 'system_admin', 'super_admin'];
const VALID_KNOWLEDGE_MODES  = ['none', 'inline'];
const DEFAULT_MODEL          = 'gpt-4.1-mini';

function sanitizeAllowedTools(raw) {
  if (!Array.isArray(raw)) return null;  // null = não enviado, banco usa DEFAULT '[]'
  return [...new Set(raw.filter(t => typeof t === 'string' && VALID_TOOL_NAMES.has(t)))];
}

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

  const {
    company_id,
    name,
    description,
    prompt,
    prompt_config,
    model,
    knowledge_base,
    knowledge_mode,
    is_active,
    model_config,
    allowed_tools,
  } = req.body ?? {};

  // Validação e sanitização da base de conhecimento
  const KB_MAX_LENGTH = 5000;
  const rawKb = typeof knowledge_base === 'string' ? knowledge_base.trim() : '';
  const finalKnowledgeBase = rawKb.length > 0
    ? rawKb.slice(0, KB_MAX_LENGTH)
    : null;

  // ── Validação básica ───────────────────────────────────────────────────────

  if (!company_id) {
    return res.status(400).json({ success: false, error: 'company_id é obrigatório.' });
  }

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    return res.status(400).json({ success: false, error: 'name é obrigatório e não pode estar vazio.' });
  }

  // Mutex: nunca aceitar prompt + prompt_config juntos
  const hasPrompt       = typeof prompt === 'string' && prompt.trim().length > 0;
  const hasPromptConfig = prompt_config !== undefined && prompt_config !== null;

  if (hasPrompt && hasPromptConfig) {
    return res.status(400).json({ success: false, error: 'prompt_and_config_conflict' });
  }
  if (!hasPrompt && !hasPromptConfig) {
    return res.status(400).json({ success: false, error: 'prompt ou prompt_config é obrigatório.' });
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

  // ── Resolver prompt final ─────────────────────────────────────────────────

  let finalPrompt;
  let finalPromptConfig = null;

  if (hasPromptConfig) {
    // Detecta formato: plano (identity string, sem version) vs. estruturado (version === 1)
    const isFlatFormat = typeof prompt_config.identity === 'string' && prompt_config.version === undefined;

    if (isFlatFormat) {
      // Formato plano — valida com promptTemplate.js e gera snapshot sem companyData
      // (companyData é injetado dinamicamente no runtime pelo agentExecutor)
      const flatValidation = validateFlatConfig(prompt_config);
      if (!flatValidation.valid) {
        return res.status(422).json({
          success: false,
          error:   'invalid_prompt_config',
          details: flatValidation.errors,
        });
      }

      // Snapshot do prompt sem companyData — será sobrescrito no runtime
      finalPrompt       = buildPromptFromConfig(prompt_config, null) ?? '';
      finalPromptConfig = prompt_config;

    } else {
      // Formato estruturado (sections + version=1) — validação existente
      const validation = validatePromptConfig(prompt_config);
      if (!validation.ok) {
        return res.status(400).json({ success: false, ...validation.payload });
      }

      const assembly = assemblePrompt(prompt_config);
      if (!assembly.ok) {
        return res.status(400).json({ success: false, ...assembly.payload });
      }

      finalPrompt       = assembly.result.prompt;
      finalPromptConfig = prompt_config;
    }

  } else {
    // Modo legacy: salvar prompt diretamente
    finalPrompt = prompt.trim();
  }

  // ── Montar payload — company_id do JWT, agent_type forçado ────────────────

  const sanitizedTools = sanitizeAllowedTools(allowed_tools);

  // Detecção de conteúdo operacional indevido na KB (logging apenas — não bloqueia)
  if (finalKnowledgeBase) {
    const kbCheck = detectOperationalContent(finalKnowledgeBase);
    if (kbCheck.score >= OPERATIONAL_SCORE_THRESHOLD) {
      console.warn('[KB_VALIDATOR] kb_operational_content_detected', {
        type:       'kb_operational_content_detected',
        company_id: auth.callerCompanyId,
        agent_id:   null,  // ainda não criado
        score:      kbCheck.score,
        flags:      kbCheck.flags,
        kb_length:  finalKnowledgeBase.length,
        timestamp:  new Date().toISOString(),
      });
    }
  }

  // knowledge_mode derivado do conteúdo da KB quando não especificado explicitamente:
  // KB presente → 'inline'; KB ausente → 'none'
  const resolvedKbMode = VALID_KNOWLEDGE_MODES.includes(knowledge_mode)
    ? knowledge_mode
    : (finalKnowledgeBase ? 'inline' : 'none');

  const insertPayload = {
    company_id:     auth.callerCompanyId,   // SEMPRE do JWT — nunca do body
    agent_type:     'conversational',        // SEMPRE forçado
    name:           trimmedName,
    description:    typeof description === 'string' ? description.trim() || null : null,
    prompt:         finalPrompt,
    prompt_config:  finalPromptConfig,
    prompt_version: 1,
    model:          typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL,
    knowledge_base: finalKnowledgeBase,
    knowledge_mode: resolvedKbMode,
    is_active:      is_active === false ? false : true,
    model_config:   (typeof model_config === 'object' && model_config !== null) ? model_config : {}
  };

  if (sanitizedTools !== null) {
    insertPayload.allowed_tools = sanitizedTools;
  }

  // ── INSERT ─────────────────────────────────────────────────────────────────

  const { data: agent, error: insertErr } = await supabaseAdmin
    .from('lovoo_agents')
    .insert(insertPayload)
    .select('id, name, description, is_active, model, prompt, prompt_config, prompt_version, knowledge_base, knowledge_mode, model_config, allowed_tools, agent_type, company_id, created_at, updated_at')
    .single();

  if (insertErr) {
    console.error('[company-agents/create] Erro ao criar agente:', insertErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao criar agente.' });
  }

  console.log('[company-agents/create] Agente criado:', {
    agent_id:   agent.id,
    company_id: agent.company_id,
    name:       agent.name,
    mode:       finalPromptConfig ? 'structured' : 'legacy',
    by:         auth.callerId
  });

  return res.status(201).json({ success: true, data: agent });
}
