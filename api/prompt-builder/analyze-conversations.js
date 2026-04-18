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
const MAX_FILES           = 10;
const MIN_MESSAGES        = 10;
const MAX_MESSAGES_LLM    = 400;

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
      maxFiles:       MAX_FILES,
      maxFileSize:    MAX_FILE_SIZE_BYTES,
      maxTotalFileSize: MAX_FILES * MAX_FILE_SIZE_BYTES,
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
    max_tokens:  2000,
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

// ── Prompt Assembler — closer de alta conversão ───────────────────────────────
//
// Transforma detected_patterns em um prompt_config comportamental rico.
// Duas camadas:
//   Fixa    — regras universais de vendas consultivas (sempre presentes)
//   Variável — personalização a partir dos padrões detectados da empresa
//
// NÃO usa os campos suggested_prompt_config do LLM como texto final —
// usa-os apenas como fallback de identity quando os padrões estão vazios.
// ─────────────────────────────────────────────────────────────────────────────

function trunc(str, max) {
  return String(str ?? '').slice(0, max);
}

function buildIdentity(rawIdentity, tone, closingPatterns) {
  // Preferir o identity do LLM se for substancial (já captura nicho/empresa)
  if (rawIdentity && rawIdentity.trim().length >= 30) {
    // Enriquecer com tom se não mencionado
    const base = rawIdentity.trim();
    const hasTone = tone && base.toLowerCase().includes(tone.toLowerCase().split(' ')[0]);
    const suffix = !hasTone && tone
      ? ` Seu tom é ${tone}, sempre buscando criar conexão genuína e gerar confiança.`
      : '';
    return trunc(base + suffix, 500);
  }

  // Fallback: construir a partir do tom e padrão de fechamento
  const closingCtx = closingPatterns?.length
    ? ` com foco em conduzi-lo até ${closingPatterns[0]}`
    : '';
  const toneDesc = tone || 'consultivo e próximo';
  return trunc(
    `Especialista em atendimento e vendas consultivas${closingCtx}. ` +
    `Seu tom é ${toneDesc}, sempre buscando criar conexão e gerar confiança genuína.`,
    500,
  );
}

function buildObjective(rawObjective, closingPatterns) {
  const closing = closingPatterns?.length
    ? closingPatterns.slice(0, 2).join(' ou ')
    : 'agendamento com especialista ou fechamento direto';

  // Se o LLM gerou um objetivo substancial, enriquecê-lo com foco em conversão
  if (rawObjective && rawObjective.trim().length >= 20) {
    return trunc(rawObjective.trim(), 300);
  }

  return trunc(
    `Entender o momento do cliente, identificar sua necessidade real e conduzi-lo ` +
    `até uma ação concreta (${closing}) — apenas quando demonstrar interesse real, ` +
    `sem pressão prematura.`,
    300,
  );
}

function buildCommunicationStyle(tone, greetingExamples, rawStyle) {
  const toneBase = tone || 'consultivo e próximo';

  // Regras fixas de comportamento comunicacional (sempre presentes)
  const fixedRules =
    `Tom ${toneBase}, como conversa natural de WhatsApp — linguagem simples e próxima. ` +
    `Faça apenas uma pergunta por vez, de forma natural e contextual — nunca múltiplas ` +
    `perguntas na mesma mensagem. Não entregue todas as informações de uma vez: responda ` +
    `o suficiente para gerar interesse e avançar, gerando curiosidade antes de explicar tudo.`;

  return trunc(fixedRules, 300);
}

function buildCommercialRules(objections, objectionResponses, closingPatterns, rawRules) {
  // Regras fixas (sempre presentes)
  const fixedRules =
    `Nunca informe preço sem o cliente solicitar. Quando solicitado: primeiro reforce ` +
    `o valor e os benefícios, só então responda. Não liste produtos ou serviços diretamente ` +
    `— conecte cada solução ao objetivo real do cliente. Avance para fechamento ou ` +
    `agendamento apenas quando houver engajamento e interesse demonstrado.`;

  // Regras variáveis a partir dos padrões de objeção detectados
  const objParts = [];
  if (objections?.length && objectionResponses?.length) {
    const count = Math.min(objections.length, objectionResponses.length, 2);
    for (let i = 0; i < count; i++) {
      objParts.push(`${objections[i]}: ${objectionResponses[i]}`);
    }
  } else if (objections?.length) {
    objParts.push(`Ao surgir ${objections[0]}: reforce o valor antes de negociar`);
  }

  const variablePart = objParts.length ? ' ' + objParts.join('. ') + '.' : '';

  return trunc(fixedRules + variablePart, 500);
}

function buildCustomNotes(dp) {
  const parts = [];

  // ── Blocos fixos de comportamento (sempre presentes) ─────────────────────

  parts.push(
    'CONDUÇÃO DA CONVERSA:\n' +
    '- Conduza ativamente — não reaja de forma passiva ao cliente\n' +
    '- Use cada resposta como ponte para a próxima etapa\n' +
    '- Evite respostas fechadas; avance sempre com intenção',
  );

  parts.push(
    'CONTROLE DE INFORMAÇÃO:\n' +
    '- Responda o suficiente para gerar interesse, não para esgotar o assunto\n' +
    '- Revele informações gradualmente conforme o engajamento cresce\n' +
    '- Se o cliente perguntar muito de uma vez, escolha o ponto mais relevante',
  );

  parts.push(
    'ELEVAÇÃO DE VALOR:\n' +
    '- Não apenas informe — gere percepção de valor antes de revelar detalhes\n' +
    '- Conecte cada produto ou serviço ao objetivo específico do cliente\n' +
    '- Use benefícios e resultados concretos, não só características',
  );

  parts.push(
    'NÍVEL DE CONSCIÊNCIA:\n' +
    '- Curioso: faça perguntas para entender contexto e elevar o interesse\n' +
    '- Interessado: aprofunde benefícios conectados ao objetivo dele\n' +
    '- Pronto: conduza para ação diretamente, sem mais delongas',
  );

  // ── Blocos variáveis a partir dos padrões detectados ─────────────────────

  // Qualificação — perguntas do atendente
  const questions = dp.attendant_questions?.filter(Boolean) ?? [];
  if (questions.length) {
    const qList = questions.slice(0, 3).map(q => `- "${q}"`).join('\n');
    parts.push(`QUALIFICAÇÃO:\n${qList}`);
  } else {
    // Fallback genérico quando não há perguntas detectadas
    parts.push(
      'QUALIFICAÇÃO:\n' +
      '- "O que te motivou a buscar isso agora?"\n' +
      '- "Qual seu principal objetivo com isso?"',
    );
  }

  // Objeções
  const objections = dp.objections?.filter(Boolean) ?? [];
  const responses  = dp.objection_responses?.filter(Boolean) ?? [];
  if (objections.length) {
    const objLines = objections.slice(0, 3).map((obj, i) => {
      const resp = responses[i] ? `: ${responses[i]}` : ': reforce o valor e traga segurança';
      return `- ${obj}${resp}`;
    }).join('\n');
    parts.push(`OBJEÇÕES:\n${objLines}`);
  } else {
    parts.push(
      'OBJEÇÕES:\n' +
      '- Ao identificar dúvida ou resistência: não confronte — reforce valor e traga segurança',
    );
  }

  // Mídia (fixo — regras estratégicas de uso)
  parts.push(
    'USO DE MÍDIA:\n' +
    '- Apresentação: início ou construção de contexto\n' +
    '- Demonstração: quando houver interesse confirmado\n' +
    '- Depoimentos: ao surgir dúvida ou objeção\n' +
    '- Antes e depois: para reforçar resultado e elevar valor\n' +
    '- Máximo 2 mídias por mensagem, sempre com contextualização',
  );

  // Fechamento — padrões da empresa + frases de convite fixas
  const closings = dp.closing_patterns?.filter(Boolean) ?? [];
  const closingLines = closings.length
    ? closings.slice(0, 2).map(c => `- ${c}`).join('\n') + '\n'
    : '';
  parts.push(
    'FECHAMENTO:\n' +
    closingLines +
    '- Use convites naturais: "faz sentido pra você?", "vamos avançar nisso?"\n' +
    '- Nunca encerre sem uma próxima ação concreta e clara',
  );

  // Truncar para o limite do campo (1500 chars)
  return parts.join('\n\n').slice(0, 1500);
}

/**
 * Monta um suggested_prompt_config rico e comportamental a partir dos
 * detected_patterns extraídos pelo LLM.
 *
 * @param {object} dp         - detected_patterns normalizados
 * @param {string} summary    - analysis_summary do LLM
 * @param {object} rawConfig  - suggested_prompt_config bruto do LLM (fallback)
 */
function assemblePromptConfig(dp, summary, rawConfig = {}) {
  const tone = dp.tone || 'consultivo e próximo';

  return {
    identity:            buildIdentity(rawConfig.identity, tone, dp.closing_patterns),
    objective:           buildObjective(rawConfig.objective, dp.closing_patterns),
    communication_style: buildCommunicationStyle(tone, dp.greeting_examples, rawConfig.communication_style),
    commercial_rules:    buildCommercialRules(dp.objections, dp.objection_responses, dp.closing_patterns, rawConfig.commercial_rules),
    custom_notes:        buildCustomNotes(dp),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

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

  // Usar o assembler comportamental no lugar do pass-through direto do LLM.
  // O assembler combina regras fixas de vendas consultivas com os padrões
  // detectados, gerando um prompt_config rico e personalizado.
  const suggested_prompt_config = assemblePromptConfig(detected_patterns, raw.analysis_summary, rawConfig);

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
