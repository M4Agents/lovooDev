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
// MODOS DE PROMPT:
//   - structured: envia prompt_config + prompt_version
//                 → backend valida + monta prompt
//                 → UPDATE atômico com WHERE prompt_version = N
//                 → 409 se rowsAffected = 0 (conflito de versão)
//   - legacy:     envia prompt (string)
//                 → salvo diretamente, prompt_config permanece NULL
//                 → sem verificação de versão
//   - metadata:   sem prompt nem prompt_config (ex: toggle is_active)
//                 → sem verificação de versão
//   - nunca aceitar prompt + prompt_config juntos
//
// prompt_version é incrementado em todo UPDATE (structured, legacy e metadata).
//
// OBRIGATÓRIO:
//   - company_id (para lookup de membership)
//   - agent_id
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { validatePromptConfig } from '../lib/agents/promptConfigValidator.js';
import { assemblePrompt }        from '../lib/agents/promptAssembler.js';
import { VALID_TOOL_NAMES }      from '../lib/agents/validTools.js';
import {
  validatePromptConfig as validateFlatConfig,
  buildPromptFromConfig,
} from '../lib/agents/promptTemplate.js';

const SUPABASE_URL     = 'https://etzdsywunlpbgxkphuil.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const WRITE_ROLES           = ['admin', 'system_admin', 'super_admin'];
const VALID_KNOWLEDGE_MODES  = ['none', 'inline'];

function sanitizeAllowedTools(raw) {
  if (!Array.isArray(raw)) return null;  // null = campo não enviado, não alterar no banco
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
    agent_id,
    name,
    description,
    prompt,
    prompt_config,
    prompt_version,
    model,
    knowledge_mode,
    is_active,
    model_config,
    allowed_tools,
  } = req.body ?? {};

  // ── Validação mínima ───────────────────────────────────────────────────────

  if (!company_id || !agent_id) {
    return res.status(400).json({ success: false, error: 'company_id e agent_id são obrigatórios.' });
  }

  // Mutex: nunca aceitar prompt + prompt_config juntos
  const hasPrompt       = typeof prompt === 'string' && prompt.trim().length > 0;
  const hasPromptConfig = prompt_config !== undefined && prompt_config !== null;

  if (hasPrompt && hasPromptConfig) {
    return res.status(400).json({ success: false, error: 'prompt_and_config_conflict' });
  }

  // Structured requer prompt_version
  if (hasPromptConfig && (typeof prompt_version !== 'number' || !Number.isInteger(prompt_version))) {
    return res.status(400).json({ success: false, error: 'prompt_version é obrigatório para atualização estruturada.' });
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

  // ── Cross-tenant guard ────────────────────────────────────────────────────
  // Confirma que o agente pertence à empresa do caller antes de qualquer escrita.

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('lovoo_agents')
    .select('id, company_id, agent_type, prompt_version')
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
      error:   'Agente não encontrado ou não pertence a esta empresa.'
    });
  }

  // ── Resolver campos de prompt ─────────────────────────────────────────────

  let finalPrompt      = undefined;
  let finalPromptConfig = undefined;  // undefined = não alterar

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

  } else if (hasPrompt) {
    // Modo legacy: salvar prompt diretamente
    finalPrompt = prompt.trim();
    if (!finalPrompt) {
      return res.status(400).json({ success: false, error: 'prompt não pode estar vazio.' });
    }
  }

  // ── Montar updatePayload — whitelist estrita ──────────────────────────────
  // agent_type e company_id são IMUTÁVEIS.

  const updatePayload = {
    prompt_version: supabaseAdmin.rpc ? undefined : undefined  // placeholder — ver abaixo
  };
  delete updatePayload.prompt_version;

  // prompt_version sempre incrementado
  // (para structured: será sobrescrito pelo UPDATE atômico abaixo)

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

  if (finalPrompt !== undefined) {
    updatePayload.prompt = finalPrompt;
  }

  if (finalPromptConfig !== undefined) {
    updatePayload.prompt_config = finalPromptConfig;
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

  const sanitizedTools = sanitizeAllowedTools(allowed_tools);
  if (sanitizedTools !== null) {
    updatePayload.allowed_tools = sanitizedTools;
  }

  if (Object.keys(updatePayload).length === 0) {
    return res.status(400).json({ success: false, error: 'Nenhum campo válido para atualizar.' });
  }

  // Sempre incrementar prompt_version via expressão SQL
  // Para structured: UPDATE WHERE prompt_version = N (optimistic lock)
  // Para legacy/metadata: UPDATE sem restrição de versão

  let updatedAgent;

  if (hasPromptConfig) {
    // ── Structured update com optimistic lock atômico ─────────────────────
    // Usa .eq('prompt_version', prompt_version) + .update({ prompt_version: supabase.rpc('+1') })
    // Como o SDK não suporta incremento nativo, usamos rpc via SQL raw.
    // Solução: update com .eq prompt_version + increment via update payload.
    //
    // NOTA: Supabase JS SDK não suporta SET col = col + 1 diretamente.
    // Usamos uma RPC simples ou a abordagem de verificar rowsAffected via
    // update com filtro de versão + SET prompt_version = prompt_version + 1
    // via RPC do Postgres.
    //
    // Abordagem adotada: update com eq no prompt_version e um campo de versão
    // calculado no payload. O SDK retorna os dados atualizados; se não retornar
    // nada (data === null ou array vazio), foi conflito.

    const { data: updatedData, error: updateErr } = await supabaseAdmin
      .from('lovoo_agents')
      .update({
        ...updatePayload,
        prompt_version: existing.prompt_version + 1,
      })
      .eq('id', agent_id)
      .eq('company_id', auth.callerCompanyId)  // cross-tenant guard
      .eq('agent_type', 'conversational')
      .eq('prompt_version', prompt_version)    // OPTIMISTIC LOCK
      .select('id, name, description, is_active, model, prompt, prompt_config, prompt_version, knowledge_mode, model_config, allowed_tools, agent_type, company_id, updated_at')
      .maybeSingle();

    if (updateErr) {
      console.error('[company-agents/update] Erro ao atualizar agente:', updateErr.message);
      return res.status(500).json({ success: false, error: 'Erro ao atualizar agente.' });
    }

    if (!updatedData) {
      // rowsAffected = 0 → conflito de versão
      return res.status(409).json({
        success: false,
        error:   'conflict',
        message: 'Agente foi modificado por outra sessão. Recarregue e tente novamente.'
      });
    }

    updatedAgent = updatedData;

  } else {
    // ── Legacy/metadata update — sem verificação de versão ────────────────
    // Incrementa prompt_version para manter rastreabilidade.

    const { data: updatedData, error: updateErr } = await supabaseAdmin
      .from('lovoo_agents')
      .update({
        ...updatePayload,
        prompt_version: existing.prompt_version + 1,
      })
      .eq('id', agent_id)
      .eq('company_id', auth.callerCompanyId)  // cross-tenant guard
      .eq('agent_type', 'conversational')
      .select('id, name, description, is_active, model, prompt, prompt_config, prompt_version, knowledge_mode, model_config, allowed_tools, agent_type, company_id, updated_at')
      .single();

    if (updateErr) {
      console.error('[company-agents/update] Erro ao atualizar agente:', updateErr.message);
      return res.status(500).json({ success: false, error: 'Erro ao atualizar agente.' });
    }

    updatedAgent = updatedData;
  }

  console.log('[company-agents/update] Agente atualizado:', {
    agent_id:        updatedAgent.id,
    company_id:      updatedAgent.company_id,
    fields:          Object.keys(updatePayload),
    prompt_version:  updatedAgent.prompt_version,
    mode:            hasPromptConfig ? 'structured' : 'legacy',
    by:              auth.callerId
  });

  return res.status(200).json({ success: true, data: updatedAgent });
}
