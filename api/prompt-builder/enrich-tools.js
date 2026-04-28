// =============================================================================
// POST /api/prompt-builder/enrich-tools
//
// Enriquece um advancedText existente com instruções de uso das tools ativas,
// usando o LLM para preservar todo o conteúdo original e inserir apenas
// instruções pontuais na seção [INFORMAÇÕES ADICIONAIS].
//
// AUTENTICAÇÃO: JWT + membership ativa
// MULTI-TENANT: company_id validado via membership do caller
//
// BODY:
//   {
//     company_id:   string    (UUID da empresa)
//     advancedText: string    (prompt atual com marcadores de seção)
//     allowedTools: string[]  (chaves das tools ativas — validadas contra whitelist)
//   }
//
// RESPOSTA:
//   { success: true,  suggestedPrompt: string }
//   { success: false, error: string           }
//
// NOTA: O resultado é apenas uma SUGESTÃO — não é salvo automaticamente.
//   O frontend exibe um diff para o usuário aprovar antes de aplicar.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { getOpenAIClient } from '../lib/openai/client.js';
import { fetchParentOpenAISettingsForSystem } from '../lib/openai/settingsDb.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const SUPABASE_URL     = 'https://etzdsywunlpbgxkphuil.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const MAX_ADVANCED_TEXT = 5000;
const MAX_TOOLS         = 9;

// ── Catálogo server-side (fonte autoritativa para o LLM) ──────────────────────
//
// NUNCA expor este catálogo ao frontend.
// Frontend usa promptSuggestion em toolCatalog.ts (texto amigável para o usuário).
// Estes hints são instruções técnicas otimizadas para o LLM.

const TOOL_PROMPT_HINTS = {
  update_lead:
    'Quando o cliente informar nome, e-mail, telefone ou empresa durante a conversa, use a ferramenta update_lead para registrar essas informações automaticamente no CRM.',
  add_tag:
    'Use a ferramenta add_tag para marcar o cliente com etiquetas relevantes como "qualificado", "sem interesse" ou "aguardando retorno" conforme o andamento da conversa.',
  add_note:
    'Use a ferramenta add_note para registrar observações internas relevantes sobre o cliente ou sobre pontos importantes da conversa que a equipe precise saber.',
  update_opportunity:
    'Use a ferramenta update_opportunity para atualizar o valor estimado, probabilidade de fechamento ou previsão de fechamento quando o cliente der sinais concretos de avanço.',
  move_opportunity:
    'Use a ferramenta move_opportunity para avançar o card da oportunidade no funil quando o cliente demonstrar progresso real, como confirmar interesse ou solicitar proposta.',
  create_activity:
    'Use a ferramenta create_activity para agendar reuniões, ligações ou compromissos que forem confirmados pelo cliente durante a conversa.',
  schedule_contact:
    'Use a ferramenta schedule_contact para programar um retorno automático ao cliente na data que ele próprio indicar ou combinar.',
  request_handoff:
    'Use a ferramenta request_handoff para transferir o atendimento para um atendente humano quando o cliente solicitar falar com uma pessoa ou quando a situação exigir intervenção humana.',
  send_media:
    'Use a ferramenta send_media para enviar imagens ou vídeos do produto ou serviço em foco, de acordo com a intenção identificada na conversa (apresentação, detalhe técnico ou prova social).',
};

/** Whitelist autoritativa — qualquer tool fora desta lista é rejeitada com 400. */
const ALLOWED_TOOL_KEYS = new Set(Object.keys(TOOL_PROMPT_HINTS));

// ── Autenticação (idêntica ao padrão de generate.js) ─────────────────────────

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

  return { ok: true, callerId: user.id, role: membership.role };
}

// ── Prompts do LLM ────────────────────────────────────────────────────────────

function getEnrichSystemPrompt() {
  return `Você é um especialista em edição de prompts de agentes conversacionais para WhatsApp.

Sua tarefa é enriquecer um prompt existente adicionando instruções de uso das ferramentas (ações) do agente.

REGRAS ABSOLUTAS — NUNCA VIOLE:
- Retorne APENAS o texto do prompt enriquecido, sem markdown, sem explicações, sem comentários
- PRESERVE exatamente todo o conteúdo existente — não remova, não modifique, não resuma nenhum texto existente
- PRESERVE a estrutura de seções: [IDENTIDADE], [OBJETIVO], [ESTILO DE COMUNICAÇÃO], [REGRAS DE ATENDIMENTO], [INFORMAÇÕES ADICIONAIS]
- NÃO crie novas seções além das 5 existentes
- NÃO invente ferramentas além das fornecidas
- NÃO mencione termos técnicos como "ferramenta", "tool", "API", "função" no texto inserido — use linguagem natural
- Antes de inserir uma instrução, verifique se ela já existe no prompt — se já existir, NÃO repita

ONDE INSERIR:
- Adicione as instruções das ferramentas APENAS ao final da seção [INFORMAÇÕES ADICIONAIS]
- Se a seção [INFORMAÇÕES ADICIONAIS] não existir no prompt, crie-a ao final com o conteúdo das instruções
- Separe as instruções adicionadas do conteúdo anterior com uma linha em branco

FORMATO DE SAÍDA:
- Retorne o prompt completo com as instruções inseridas
- Mantenha exatamente os marcadores de seção: [IDENTIDADE], [OBJETIVO], etc.`;
}

function getEnrichUserMessage(advancedText, activeHints) {
  const hintLines = activeHints
    .map(({ key, hint }) => `- ${key}: ${hint}`)
    .join('\n');

  return `PROMPT ATUAL (preserve todo o conteúdo):
${advancedText}

FERRAMENTAS ATIVAS (adicione instruções de uso somente para estas):
${hintLines}

Retorne o prompt enriquecido agora.`;
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

  const { company_id, advancedText, allowedTools } = req.body ?? {};

  if (!company_id || typeof company_id !== 'string') {
    return res.status(400).json({ success: false, error: 'company_id é obrigatório.' });
  }

  if (!advancedText || typeof advancedText !== 'string' || advancedText.trim().length < 20) {
    return res.status(400).json({ success: false, error: 'advancedText inválido ou muito curto.' });
  }

  if (advancedText.length > MAX_ADVANCED_TEXT) {
    return res.status(400).json({ success: false, error: `advancedText excede o limite de ${MAX_ADVANCED_TEXT} caracteres.` });
  }

  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    return res.status(400).json({ success: false, error: 'allowedTools deve ser um array não vazio.' });
  }

  if (allowedTools.length > MAX_TOOLS) {
    return res.status(400).json({ success: false, error: `allowedTools excede o limite de ${MAX_TOOLS} ferramentas.` });
  }

  // Validar cada tool contra a whitelist
  const unknownTools = allowedTools.filter(t => typeof t !== 'string' || !ALLOWED_TOOL_KEYS.has(t));
  if (unknownTools.length > 0) {
    return res.status(400).json({
      success: false,
      error:   `Ferramentas desconhecidas: ${unknownTools.join(', ')}`,
    });
  }

  // ── 2. Autenticar caller ────────────────────────────────────────────────────

  const auth = await validateCaller(req, company_id);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }

  // ── 3. Verificar OpenAI ─────────────────────────────────────────────────────

  const openaiSettings = await fetchParentOpenAISettingsForSystem();
  if (!openaiSettings.enabled) {
    return res.status(503).json({ success: false, error: 'Serviço de IA não disponível.' });
  }

  const client = getOpenAIClient();
  if (!client) {
    return res.status(503).json({ success: false, error: 'Cliente OpenAI não configurado.' });
  }

  // ── 4. Montar hints das tools ativas (somente as da whitelist) ──────────────

  const activeHints = allowedTools.map(key => ({
    key,
    hint: TOOL_PROMPT_HINTS[key],
  }));

  // ── 5. Chamar LLM ───────────────────────────────────────────────────────────

  const systemPrompt = getEnrichSystemPrompt();
  const userMessage  = getEnrichUserMessage(advancedText.trim(), activeHints);

  let suggestedPrompt = '';

  try {
    const signal     = AbortSignal.timeout(openaiSettings.timeout_ms);
    const completion = await client.chat.completions.create(
      {
        model:       openaiSettings.model,
        temperature: 0.2,
        max_tokens:  2000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  },
        ],
      },
      { signal },
    );

    suggestedPrompt = completion.choices[0]?.message?.content?.trim() ?? '';
  } catch (llmErr) {
    console.error('[ENRICH_TOOLS] Erro LLM:', llmErr?.message);
    return res.status(500).json({ success: false, error: 'Erro ao gerar sugestão. Tente novamente.' });
  }

  if (!suggestedPrompt) {
    return res.status(500).json({ success: false, error: 'Resposta vazia do modelo. Tente novamente.' });
  }

  // ── 6. Validação de segurança: suggestedPrompt não pode ser menor que o original ──

  if (suggestedPrompt.length < advancedText.trim().length * 0.8) {
    console.warn('[ENRICH_TOOLS] suggestedPrompt muito menor que o original — descartado', {
      original_len:  advancedText.length,
      suggested_len: suggestedPrompt.length,
      company_id,
    });
    return res.status(500).json({
      success: false,
      error:   'A sugestão gerada parece incompleta. Tente novamente.',
    });
  }

  console.log('[ENRICH_TOOLS:success]', {
    company_id,
    caller_id:     auth.callerId,
    tools_count:   activeHints.length,
    original_len:  advancedText.length,
    suggested_len: suggestedPrompt.length,
  });

  return res.status(200).json({
    success:         true,
    suggestedPrompt,
  });
}
