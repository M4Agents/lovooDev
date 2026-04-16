// =============================================================================
// POST /api/ai/run
//
// Executa um agente funcional via use_id (runAgent).
// Usado pelo Agente de Suporte na tela de configuração de agentes
// e por outros agentes funcionais que requerem contexto de usuário autenticado.
//
// AUTENTICAÇÃO: JWT + membership ativa
// MULTI-TENANT: company_id validado via membership do caller
//
// BODY:
//   {
//     use_id:       string   (ex: 'system:support_assistant:agent_config')
//     userMessage:  string   (mensagem do usuário)
//     company_id:   string   (UUID da empresa)
//     extra_context?: string (contexto adicional — ex: seção atual da UI)
//   }
//
// RESPOSTA:
//   { success: true,  result: string }
//   { success: false, error: string  }
//
// NOTA: O agente referenciado pelo use_id deve existir em lovoo_agents e
//   ter um agent_use_binding correspondente. Se não existir, a resposta é
//   um fallback estático (conforme fallback_mode em uses.ts).
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { runAgent }     from '../lib/agents/runner.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const SUPABASE_URL     = 'https://etzdsywunlpbgxkphuil.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Use_ids permitidos neste endpoint (subset de VALID_USE_IDS). */
const ALLOWED_USE_IDS = new Set([
  'system:support_assistant:agent_config',
  'system:support_assistant:general_help',
]);

/** Comprimento máximo da mensagem do usuário. */
const MAX_USER_MESSAGE_LENGTH = 2000;

/** Comprimento máximo do extra_context. */
const MAX_EXTRA_CONTEXT_LENGTH = 3000;

// ── Autenticação ──────────────────────────────────────────────────────────────

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

  // ── 1. Validar body ─────────────────────────────────────────────────────────

  const { use_id, userMessage, company_id, extra_context } = req.body ?? {};

  if (!company_id || typeof company_id !== 'string') {
    return res.status(400).json({ success: false, error: 'company_id é obrigatório.' });
  }

  if (!use_id || typeof use_id !== 'string') {
    return res.status(400).json({ success: false, error: 'use_id é obrigatório.' });
  }

  if (!ALLOWED_USE_IDS.has(use_id)) {
    return res.status(400).json({ success: false, error: `use_id não permitido: ${use_id}` });
  }

  if (!userMessage || typeof userMessage !== 'string' || !userMessage.trim()) {
    return res.status(400).json({ success: false, error: 'userMessage é obrigatório.' });
  }

  // ── 2. Autenticar caller ────────────────────────────────────────────────────

  const auth = await validateCaller(req, company_id);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }

  // ── 3. Montar contexto e executar agente ────────────────────────────────────

  const ctx = {
    userMessage:   userMessage.trim().slice(0, MAX_USER_MESSAGE_LENGTH),
    company_id,
    user_id:       auth.callerId,
    channel:       'web',
    extra_context: typeof extra_context === 'string'
      ? extra_context.trim().slice(0, MAX_EXTRA_CONTEXT_LENGTH)
      : undefined,
  };

  let runResult;
  try {
    runResult = await runAgent(use_id, ctx);
  } catch (runErr) {
    console.error('[AI:RUN] Erro ao executar agente:', {
      use_id,
      company_id,
      error: runErr.message,
    });
    return res.status(500).json({ success: false, error: 'Erro ao executar agente.' });
  }

  // ── 4. Tratar resultado ─────────────────────────────────────────────────────

  if (!runResult.ok) {
    const errorCode = runResult.errorCode ?? 'unknown_error';

    console.warn('[AI:RUN] Agente retornou ok=false:', {
      use_id,
      company_id,
      errorCode,
    });

    // Retorna 200 para o frontend — o fallback estático é uma resposta válida
    return res.status(200).json({
      success: false,
      error:   errorCode,
    });
  }

  // fallback estático também é retornado como sucesso (runResult.ok = true)
  return res.status(200).json({
    success:  true,
    result:   runResult.result,
    fallback: runResult.fallback ?? false,
  });
}
