// =============================================================================
// POST /api/ai/sandbox
//
// Executa o agente em modo sandbox usando um prompt_config em memória.
// NÃO salva dados, NÃO cria conversas no banco, NÃO altera nenhum agente salvo.
// Usado exclusivamente para preview interativo antes de salvar.
//
// AUTENTICAÇÃO: JWT + membership ativa
// MULTI-TENANT:  company_id validado via membership do caller
//
// BODY:
//   {
//     company_id:    string             (UUID da empresa)
//     messages:      ChatMessage[]      (histórico completo — sem system)
//     prompt_config: FlatPromptConfig   (config em memória, nunca do banco)
//     agent_name?:   string             (nome persona do assistente)
//   }
//
// RESPOSTA:
//   { success: true,  reply: string }
//   { success: false, error: string }
//
// SEGURANÇA:
//   - prompt_config é validado antes do uso (campos permitidos, tamanhos máximos)
//   - messages são truncadas (máximo 10 turnos + última mensagem do usuário)
//   - agent_name é sanitizado (sem HTML, tamanho máximo)
//   - nenhum dado é persistido neste endpoint
// =============================================================================

import { createClient }                       from '@supabase/supabase-js';
import { getOpenAIClient }                    from '../lib/openai/client.js';
import { fetchParentOpenAISettingsForSystem } from '../lib/openai/settingsDb.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const SUPABASE_URL     = 'https://etzdsywunlpbgxkphuil.supabase.co';

/** Máximo de turnos de histórico enviados ao modelo (economiza tokens). */
const MAX_HISTORY_TURNS   = 10;
/** Comprimento máximo por mensagem do histórico. */
const MAX_MSG_LENGTH      = 2000;
/** Comprimento máximo do agent_name. */
const MAX_AGENT_NAME_LEN  = 80;
/** Máximo de tokens na resposta do sandbox. */
const MAX_REPLY_TOKENS    = 512;

// ── Campos permitidos no prompt_config (allowlist explícita) ─────────────────

const ALLOWED_CONFIG_FIELDS = new Set([
  'identity', 'objective', 'communication_style', 'commercial_rules', 'custom_notes',
]);
const MAX_FIELD_LENGTHS = {
  identity:            500,
  objective:           300,
  communication_style: 300,
  commercial_rules:    500,
  custom_notes:        800,
};

// ── Autenticação ──────────────────────────────────────────────────────────────

async function validateCaller(req, companyId) {
  const anonKey    = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const authHeader = req.headers?.authorization;

  if (!authHeader || !String(authHeader).startsWith('Bearer ') || !anonKey) {
    return { ok: false, status: 401, error: 'Autenticação necessária' };
  }

  const callerClient = createClient(SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: String(authHeader) } },
    auth:   { persistSession: false, autoRefreshToken: false },
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

  return { ok: true };
}

// ── Validação do prompt_config (sandbox — mais permissivo que o modo save) ───

function validateSandboxConfig(config) {
  if (!config || typeof config !== 'object') {
    return { ok: false, reason: 'prompt_config inválido' };
  }
  if (typeof config.identity !== 'string' || config.identity.trim().length < 10) {
    return { ok: false, reason: 'identity muito curto ou ausente' };
  }
  if (typeof config.objective !== 'string' || config.objective.trim().length < 10) {
    return { ok: false, reason: 'objective muito curto ou ausente' };
  }
  return { ok: true };
}

// ── Monta o system prompt a partir do prompt_config + agent_name ──────────────

function buildSandboxSystemPrompt(config, agentName) {
  const parts = [];

  // Nome do assistente (persona)
  if (agentName) {
    parts.push(`Seu nome é "${agentName}". Use-o ao se apresentar.`);
  }

  // Campos do prompt_config (apenas campos permitidos, tamanho limitado)
  const labels = {
    identity:            'Identidade',
    objective:           'Objetivo',
    communication_style: 'Estilo de comunicação',
    commercial_rules:    'Regras comerciais',
    custom_notes:        'Contexto adicional',
  };

  for (const field of ALLOWED_CONFIG_FIELDS) {
    const value = config[field];
    if (typeof value === 'string' && value.trim()) {
      const maxLen = MAX_FIELD_LENGTHS[field] ?? 500;
      parts.push(`## ${labels[field]}\n${value.trim().slice(0, maxLen)}`);
    }
  }

  parts.push(
    '---',
    'Este é um ambiente de simulação para teste antes de publicar o agente.',
    'Responda como o assistente configurado acima. Seja natural, direto e útil.',
  );

  return parts.join('\n\n');
}

// ── Sanitização do histórico de mensagens ────────────────────────────────────

function sanitizeMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) return [];

  return rawMessages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({
      role:    m.role,
      content: String(m.content).trim().slice(0, MAX_MSG_LENGTH),
    }))
    .filter(m => m.content.length > 0)
    // Manter apenas os últimos MAX_HISTORY_TURNS turnos (cada turno = user + assistant)
    .slice(-(MAX_HISTORY_TURNS * 2));
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

  // ── 1. Validar body ─────────────────────────────────────────────────────────

  const { company_id, messages, prompt_config, agent_name } = req.body ?? {};

  if (!company_id || typeof company_id !== 'string') {
    return res.status(400).json({ success: false, error: 'company_id é obrigatório.' });
  }

  const configValidation = validateSandboxConfig(prompt_config);
  if (!configValidation.ok) {
    return res.status(400).json({ success: false, error: `prompt_config inválido: ${configValidation.reason}` });
  }

  const sanitizedMessages = sanitizeMessages(messages);
  // Deve haver pelo menos uma mensagem do usuário no final
  const lastMsg = sanitizedMessages.at(-1);
  if (!lastMsg || lastMsg.role !== 'user') {
    return res.status(400).json({ success: false, error: 'Última mensagem deve ser do usuário.' });
  }

  // ── 2. Autenticar caller ────────────────────────────────────────────────────

  const auth = await validateCaller(req, company_id);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }

  // ── 3. Verificar cliente OpenAI ─────────────────────────────────────────────

  const openaiSettings = await fetchParentOpenAISettingsForSystem();
  if (!openaiSettings.enabled) {
    return res.status(503).json({ success: false, error: 'Serviço de IA não disponível.' });
  }

  const client = getOpenAIClient();
  if (!client) {
    return res.status(503).json({ success: false, error: 'Cliente OpenAI não configurado.' });
  }

  // ── 4. Montar prompt e chamar OpenAI ────────────────────────────────────────

  const safeAgentName  = typeof agent_name === 'string'
    ? agent_name.replace(/<[^>]*>/g, '').trim().slice(0, MAX_AGENT_NAME_LEN)
    : '';

  const systemPrompt = buildSandboxSystemPrompt(prompt_config, safeAgentName);

  let reply = '';
  try {
    const signal     = AbortSignal.timeout(openaiSettings.timeout_ms ?? 30_000);
    const completion = await client.chat.completions.create(
      {
        model:       openaiSettings.model,
        temperature: 0.7,
        max_tokens:  MAX_REPLY_TOKENS,
        messages:    [
          { role: 'system', content: systemPrompt },
          ...sanitizedMessages,
        ],
      },
      { signal },
    );

    reply = completion.choices?.[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    console.error('[AI:SANDBOX] Erro na chamada OpenAI:', err.message);
    return res.status(500).json({ success: false, error: 'Erro ao consultar IA. Tente novamente.' });
  }

  if (!reply) {
    return res.status(500).json({ success: false, error: 'IA retornou resposta vazia.' });
  }

  return res.status(200).json({ success: true, reply });
}
