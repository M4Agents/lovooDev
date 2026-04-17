// =============================================================================
// POST /api/prompt-builder/analyze-conversations
//
// Recebe até 3 arquivos .txt exportados do WhatsApp, parseia, anonimiza e
// envia ao LLM para gerar uma análise estruturada de padrões de atendimento.
//
// AUTENTICAÇÃO: JWT + membership ativa
// MULTI-TENANT:  company_id validado do caller
// STATELESS:     nenhum arquivo ou análise é persistido
// =============================================================================

import { createClient }                      from '@supabase/supabase-js';
import formidable                             from 'formidable';
import fs                                     from 'fs';
import { getOpenAIClient }                    from '../lib/openai/client.js';
import { fetchParentOpenAISettingsForSystem } from '../lib/openai/settingsDb.js';
import {
  parseWhatsAppText,
  calculateQuality,
  formatConversationForLLM,
} from '../lib/agents/whatsappParser.js';
import { validatePromptConfig } from '../lib/agents/promptTemplate.js';

// ── Config Vercel (necessário para multipart) ─────────────────────────────────

export const config = { api: { bodyParser: false } };

// ── Constantes ────────────────────────────────────────────────────────────────

const SUPABASE_URL     = 'https://etzdsywunlpbgxkphuil.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB por arquivo
const MAX_FILES           = 3;
const MIN_MESSAGES        = 10;
const MAX_MESSAGES_LLM    = 250;

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

  return { ok: true, callerId: user.id };
}

// ── Parsing multipart ─────────────────────────────────────────────────────────

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFiles:    MAX_FILES,
      maxFileSize: MAX_FILE_SIZE_BYTES,
      keepExtensions: true,
    });

    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

// ── Limpeza de temp files ─────────────────────────────────────────────────────

function cleanupTempFiles(files) {
  const all = Array.isArray(files) ? files : [files];
  for (const f of all) {
    try {
      if (f?.filepath) fs.unlinkSync(f.filepath);
    } catch {
      // ignorar erros de limpeza
    }
  }
}

// ── Prompt LLM ────────────────────────────────────────────────────────────────

function buildAnalysisPrompt(conversationText) {
  return {
    system: `Você é um analisador de conversas comerciais de WhatsApp.

Sua função é ler conversas reais entre ATENDENTE e CLIENTE e extrair padrões úteis para configurar um agente de IA de atendimento e vendas.

IMPORTANTE:
- Não resumir de forma genérica
- Não inventar informações
- Não copiar literalmente grandes trechos da conversa
- Analisar comportamento, padrões, linguagem, objeções e condução
- Retornar apenas JSON válido
- Sem markdown
- Sem texto antes ou depois do JSON

A conversa já foi anonimizada.
Os papéis possíveis são apenas:
- ATENDENTE
- CLIENTE`,

    user: `Analise a conversa abaixo e retorne exatamente este JSON:

{
  "analysis_summary": "string",
  "detected_patterns": {
    "tone": "string",
    "greeting_examples": ["string"],
    "frequent_customer_questions": ["string"],
    "attendant_questions": ["string"],
    "objections": ["string"],
    "objection_responses": ["string"],
    "closing_patterns": ["string"],
    "handoff_triggers": ["string"],
    "terms_to_avoid": ["string"]
  },
  "suggested_prompt_config": {
    "identity": "string",
    "objective": "string",
    "communication_style": "string",
    "commercial_rules": "string",
    "custom_notes": "string"
  }
}

REGRAS DE ANÁLISE:

1. analysis_summary: resumo em 1–2 frases do estilo geral do atendimento. Foque em tom, objetivo e condução. Máximo 300 caracteres.

2. detected_patterns.tone: tom predominante do ATENDENTE (ex: empático, direto, informal, consultivo).

3. greeting_examples: até 3 exemplos curtos de saudação real usada pelo ATENDENTE. Se não houver, use [].

4. frequent_customer_questions: até 5 padrões de perguntas do CLIENTE. Não copiar literal — abstrair o padrão.

5. attendant_questions: até 5 perguntas usadas pelo ATENDENTE para qualificar ou conduzir o cliente.

6. objections: até 5 objeções recorrentes levantadas pelo CLIENTE.

7. objection_responses: até 5 padrões de resposta do ATENDENTE às objeções. Foco em estratégia, não texto literal.

8. closing_patterns: até 5 formas de fechamento ou encaminhamento usadas pelo ATENDENTE.

9. handoff_triggers: situações onde o atendimento foi transferido para humano ou outra etapa. Se não houver, use [].

10. terms_to_avoid: até 5 comportamentos ou frases inadequadas observadas. Se não houver, use [].

11. suggested_prompt_config: preencher com base nos padrões identificados:
- identity: quem o agente deve ser (evite mencionar IA)
- objective: objetivo comercial do atendimento
- communication_style: estilo e tom de comunicação ideal
- commercial_rules: regras comerciais inferidas da conversa
- custom_notes: observações adicionais relevantes

RESTRIÇÕES:
- Máximo 5 itens por array
- Nunca usar null — use "" ou [] se vazio
- Ser conservador quando houver dúvida
- Não mencionar "IA", "prompt" ou termos técnicos nos campos de config
- Retornar apenas JSON válido

CONVERSA:
${conversationText}`,
  };
}

// ── Chamada ao LLM ────────────────────────────────────────────────────────────

async function callLLM(conversationText, companyId) {
  const settings = await fetchParentOpenAISettingsForSystem(companyId, supabaseAdmin);
  const openai   = getOpenAIClient(settings);

  const { system, user } = buildAnalysisPrompt(conversationText);

  const response = await openai.chat.completions.create({
    model:       settings?.model ?? 'gpt-4.1-mini',
    temperature: 0.3,
    max_tokens:  1600,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user   },
    ],
  });

  return response.choices?.[0]?.message?.content?.trim() ?? '';
}

function tryParseAnalysis(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* continua */ }
    }
    return null;
  }
}

function safeString(val, maxLen = 500) {
  return typeof val === 'string' ? val.trim().slice(0, maxLen) : '';
}

/**
 * Limita um array a N itens string, aplica trim + slice por item,
 * e remove duplicatas por comparação case-insensitive.
 */
function safeArray(val, maxItems = 5, maxLen = 120) {
  if (!Array.isArray(val)) return [];

  const seen = new Set();
  const result = [];

  for (const v of val) {
    const s   = String(v ?? '').trim().slice(0, maxLen);
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    result.push(s);
    if (result.length >= maxItems) break;
  }

  return result;
}

function normalizeAnalysis(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const dp = raw.detected_patterns ?? {};

  const detected_patterns = {
    tone:                        safeString(dp.tone, 120),
    greeting_examples:           safeArray(dp.greeting_examples),
    frequent_customer_questions: safeArray(dp.frequent_customer_questions),
    attendant_questions:         safeArray(dp.attendant_questions),
    objections:                  safeArray(dp.objections),
    objection_responses:         safeArray(dp.objection_responses),
    closing_patterns:            safeArray(dp.closing_patterns),
    handoff_triggers:            safeArray(dp.handoff_triggers),
    terms_to_avoid:              safeArray(dp.terms_to_avoid),
  };

  const rawConfig = raw.suggested_prompt_config ?? {};
  const suggested_prompt_config = {
    identity:             safeString(rawConfig.identity,            500),
    objective:            safeString(rawConfig.objective,           300),
    communication_style:  safeString(rawConfig.communication_style, 300),
    commercial_rules:     safeString(rawConfig.commercial_rules,    500),
    custom_notes:         safeString(rawConfig.custom_notes,        800),
  };

  // Validar o suggested_prompt_config — se inválido, retornar null para não
  // poluir o builder com dados inconsistentes
  const validation    = validatePromptConfig(suggested_prompt_config);
  const configIsValid = validation.valid || validation.errors?.every(e => e.reason !== 'required');

  return {
    analysis_summary:        safeString(raw.analysis_summary, 400),
    detected_patterns,
    suggested_prompt_config: configIsValid ? suggested_prompt_config : null,
  };
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // 1. Extrair company_id do body (via query ou field)
  const companyIdQuery = req.query?.company_id;

  // Precisamos parsear primeiro para obter o company_id dos fields
  let parsedFields = null;
  let parsedFiles  = null;
  let tempFiles    = [];

  try {
    const { fields, files } = await parseMultipart(req);
    parsedFields = fields;
    parsedFiles  = files;

    // Normalizar files para array (formidable v3+)
    const fileList = parsedFiles?.conversations
      ? (Array.isArray(parsedFiles.conversations) ? parsedFiles.conversations : [parsedFiles.conversations])
      : [];
    tempFiles = fileList;

    const companyId = companyIdQuery
      || (Array.isArray(parsedFields?.company_id) ? parsedFields.company_id[0] : parsedFields?.company_id)
      || '';

    if (!companyId) {
      cleanupTempFiles(tempFiles);
      return res.status(400).json({ error: 'company_id obrigatório' });
    }

    // 2. Autenticar caller
    const caller = await validateCaller(req, companyId);
    if (!caller.ok) {
      cleanupTempFiles(tempFiles);
      return res.status(caller.status).json({ error: caller.error });
    }

    // 3. Validar arquivos
    if (!fileList.length) {
      cleanupTempFiles(tempFiles);
      return res.status(400).json({ error: 'Nenhum arquivo enviado. Envie até 3 arquivos .txt.' });
    }

    for (const file of fileList) {
      const mime = file.mimetype ?? '';
      const ext  = (file.originalFilename ?? '').split('.').pop()?.toLowerCase();
      if (!mime.includes('text') && ext !== 'txt') {
        cleanupTempFiles(tempFiles);
        return res.status(400).json({ error: `Arquivo inválido: apenas .txt é aceito (recebido: ${mime})` });
      }
    }

    // 4. Ler e parsear cada arquivo
    const allMessages = [];
    const qualityScores = [];

    for (const file of fileList) {
      const text = fs.readFileSync(file.filepath, 'utf-8');

      if (text.trim().length < 50) {
        continue; // ignorar arquivo muito pequeno ou vazio
      }

      const { messages, format } = parseWhatsAppText(text);

      if (format === 'unknown' || messages.length < MIN_MESSAGES) {
        continue; // ignorar conversa inválida ou muito curta
      }

      const quality = calculateQuality(messages);
      qualityScores.push(quality.score);
      allMessages.push(...messages);
    }

    // 5. Limpar temp files ANTES da chamada ao LLM
    cleanupTempFiles(tempFiles);
    tempFiles = [];

    if (allMessages.length < MIN_MESSAGES) {
      return res.status(422).json({
        error: 'Conversas insuficientes para análise. Verifique se os arquivos são exportações válidas do WhatsApp com pelo menos 10 mensagens.',
      });
    }

    // 6. Preparar texto para LLM
    const conversationText = formatConversationForLLM(allMessages, MAX_MESSAGES_LLM);

    // 7. Chamar LLM
    const rawOutput    = await callLLM(conversationText, companyId);
    const parsedOutput = tryParseAnalysis(rawOutput);
    const analysis     = normalizeAnalysis(parsedOutput);

    if (!analysis) {
      console.warn('[PROMPT_ANALYSIS] LLM returned unparseable output', {
        company_id:       companyId,
        message_count:    allMessages.length,
        output_length:    rawOutput.length,
      });
      return res.status(502).json({
        error: 'A análise retornou um resultado inválido. Tente novamente.',
      });
    }

    // 8. Calcular score agregado de qualidade
    const avgScore = qualityScores.length > 0
      ? Math.round(qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length)
      : 30;

    const qualityLabel = avgScore >= 70 ? 'boa' : avgScore >= 40 ? 'razoável' : 'insuficiente';

    // 9. Log estruturado para acompanhamento de qualidade (sem expor conteúdo)
    const dp = analysis.detected_patterns;
    console.log('[PROMPT_ANALYSIS]', JSON.stringify({
      company_id:                  companyId,
      conversation_count:          fileList.length,
      message_count:               allMessages.length,
      quality_score:               avgScore,
      quality_label:               qualityLabel,
      has_valid_suggested_config:  analysis.suggested_prompt_config !== null,
      detected: {
        has_tone:          !!dp.tone,
        greeting_count:    dp.greeting_examples.length,
        questions_count:   dp.frequent_customer_questions.length,
        objections_count:  dp.objections.length,
        handoff_count:     dp.handoff_triggers.length,
      },
    }));

    return res.status(200).json({
      success: true,
      conversation_analysis: analysis,
      quality: {
        score: avgScore,
        label: qualityLabel,
      },
    });

  } catch (err) {
    cleanupTempFiles(tempFiles);
    console.error('[analyze-conversations] Erro:', err?.message ?? err);

    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Arquivo muito grande. Limite: 2 MB por arquivo.' });
    }

    return res.status(500).json({
      error: 'Erro interno ao processar as conversas. Tente novamente.',
    });
  }
}
