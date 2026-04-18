// =============================================================================
// POST /api/prompt-builder/generate
//
// Prompt Builder data-driven: gera um prompt_config validado para um agente
// conversacional usando dados reais do sistema (empresa + catálogo) como
// fonte primária, com input do usuário apenas como complemento.
//
// AUTENTICAÇÃO: JWT + membership ativa (admin, manager, seller ou superior)
// MULTI-TENANT: dados buscados sempre pelo company_id validado do caller
//
// FLUXO:
//   1. Validar JWT + membership
//   2. Buscar companyData + catalogSummary do banco (fonte primária)
//   3. Sanitizar userAnswers (fonte complementar)
//   4. Chamar OpenAI com prompt builder controlado pelo SaaS
//   5. Tentar JSON.parse → retry automático se falhar
//   6. Extrair apenas os 5 campos conhecidos
//   7. validatePromptConfig → 422 se inválido
//   8. sanitizePromptConfig (modo save) → 422 se padrão bloqueado
//   9. normalizeField em cada campo
//  10. Retornar prompt_config para preview (NÃO salva automaticamente)
//
// NOTA ARQUITETURAL:
//   Este endpoint usa OpenAI diretamente — o Prompt Builder é uma feature
//   de plataforma (SaaS), não um agente configurável por cliente. O system
//   prompt é controlado em código (não em lovoo_agents) para garantir que
//   o builder nunca seja alterado por usuários finais.
// =============================================================================

import { createClient }                        from '@supabase/supabase-js';
import { getOpenAIClient }                     from '../lib/openai/client.js';
import { fetchParentOpenAISettingsForSystem }   from '../lib/openai/settingsDb.js';
import { validatePromptConfig, sanitizePromptConfig, normalizeField } from '../lib/agents/promptTemplate.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const SUPABASE_URL     = 'https://etzdsywunlpbgxkphuil.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

/** Campos aceitos no output do LLM — qualquer campo extra é descartado. */
const KNOWN_OUTPUT_FIELDS = ['identity', 'objective', 'communication_style', 'commercial_rules', 'custom_notes'];

/** Máximo de itens do catálogo enviados ao LLM (economia de tokens). */
const MAX_CATALOG_ITEMS = 15;

/**
 * Comprimento máximo por campo de userAnswers — alinhado com PROMPT_CONFIG_SCHEMA.
 * custom_notes aceita 1500 chars para preservar o output completo do assembler (P1–P9).
 * Os outros campos seguem os limites do schema (identity e objective não são userAnswers).
 */
// #region agent log
fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cf8832'},body:JSON.stringify({sessionId:'cf8832',location:'generate.js:module-load',message:'Módulo carregado (ANSWER_MAX_BY_FIELD inicializado)',data:{},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
// #endregion
const ANSWER_MAX_BY_FIELD = {
  objective:           300,
  communication_style: 300,
  commercial_rules:    500,
  custom_notes:        1500,
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

// ── Fetchers de dados do sistema ──────────────────────────────────────────────

async function fetchCompanyData(companyId) {
  // Dados estáveis da empresa — usados apenas para persona e nicho do agente.
  // Dados operacionais (telefone, e-mail, site, horário, endereço) são
  // injetados em runtime via buildPromptFromConfig(Seção B) e NÃO devem
  // entrar aqui para evitar congelamento no prompt_config gerado.
  const { data, error } = await supabaseAdmin
    .from('companies')
    .select(`
      id, name, nome_fantasia, ramo_atividade,
      cidade, estado,
      descricao_empresa
    `)
    .eq('id', companyId)
    .maybeSingle();

  if (error) throw new Error(`fetchCompanyData: ${error.message}`);
  return data ?? null;
}

async function fetchCatalogSummary(companyId) {
  // ai_notes é dado operacional (instruções de como agir com cada produto) —
  // injetado em runtime via extra_context e NÃO deve entrar na geração para
  // evitar congelamento de comportamento específico no prompt_config.
  const baseSelect = 'name, description, catalog_categories ( name )';

  const [productsRes, servicesRes] = await Promise.allSettled([
    supabaseAdmin
      .from('products')
      .select(baseSelect)
      .eq('company_id', companyId)
      .eq('available_for_ai', true)
      .eq('is_active', true)
      .limit(MAX_CATALOG_ITEMS),
    supabaseAdmin
      .from('services')
      .select(baseSelect)
      .eq('company_id', companyId)
      .eq('available_for_ai', true)
      .eq('is_active', true)
      .limit(MAX_CATALOG_ITEMS),
  ]);

  const products = productsRes.status === 'fulfilled' ? (productsRes.value.data ?? []) : [];
  const services = servicesRes.status === 'fulfilled' ? (servicesRes.value.data ?? []) : [];

  return [...products, ...services].slice(0, MAX_CATALOG_ITEMS);
}

// ── Formatação do contexto para o LLM ─────────────────────────────────────────

function formatCompanyContext(company) {
  if (!company) return 'Dados da empresa não disponíveis.';

  // Apenas contexto estável — nome, nicho, localização e descrição.
  // Dados operacionais (telefone, e-mail, site, horário, endereço) são
  // injetados automaticamente em runtime e não devem constar aqui.
  const lines = [];
  const nome  = company.nome_fantasia || company.name;

  if (nome)                    lines.push(`Nome: ${nome}`);
  if (company.ramo_atividade)  lines.push(`Área de atuação: ${company.ramo_atividade}`);

  const location = [company.cidade, company.estado].filter(Boolean).join(', ');
  if (location)                lines.push(`Localização: ${location}`);

  if (company.descricao_empresa) lines.push(`Descrição: ${String(company.descricao_empresa).trim()}`);

  return lines.length > 0 ? lines.join('\n') : 'Dados básicos não preenchidos.';
}

function formatCatalogContext(items) {
  if (!items || items.length === 0) return 'Nenhum item de catálogo cadastrado.';

  // ai_notes não entra na geração — é comportamento operacional por produto,
  // injetado em runtime via extra_context pelo agentExecutor.
  return items.map(item => {
    const cat   = item.catalog_categories?.name;
    const label = cat ? `${item.name} (${cat})` : item.name;
    const desc  = item.description ? ` — ${item.description.slice(0, 120)}` : '';
    return `• ${label}${desc}`;
  }).join('\n');
}

function formatUserAnswers(answers) {
  if (!answers || typeof answers !== 'object') return 'Nenhuma resposta fornecida.';

  const fields = ['objective', 'communication_style', 'commercial_rules', 'custom_notes'];
  const labels = {
    objective:           'Objetivo',
    communication_style: 'Tom de comunicação',
    commercial_rules:    'Regras comerciais',
    custom_notes:        'Informações adicionais',
  };

  const lines = fields
    .filter(f => typeof answers[f] === 'string' && answers[f].trim())
    .map(f => `${labels[f]}: ${String(answers[f]).slice(0, ANSWER_MAX_BY_FIELD[f] ?? 500)}`);

  return lines.length > 0 ? lines.join('\n') : 'Nenhuma resposta fornecida.';
}

// ── System prompt do builder (controlado pelo SaaS) ───────────────────────────

function getBuilderSystemPrompt() {
  return `Você é um especialista em configuração de agentes de vendas conversacionais para WhatsApp.

Sua tarefa é gerar um JSON válido com as seguintes chaves:
identity, objective, communication_style, commercial_rules, custom_notes

REGRAS CRÍTICAS:
- Retorne APENAS JSON válido, sem texto adicional, sem markdown, sem explicações
- Use os dados da empresa para entender o negócio (nome, área, localização, descrição)
- Use o catálogo como referência do que é vendido ou oferecido pela empresa
- Use as respostas do usuário apenas como complemento e refinamento
- NÃO invente informações que não estejam nos dados fornecidos
- NÃO inclua scripts de fluxo, passos sequenciais ou listas numeradas de ações
- NÃO mencione termos técnicos do sistema (prompts, pipeline, contexto extra, etc.)
- Campos opcionais podem ser omitidos (string vazia ou ausentes) se não houver informação

DADOS QUE NÃO DEVEM APARECER NOS CAMPOS GERADOS:
Os campos abaixo são injetados automaticamente pelo sistema em cada atendimento.
NÃO os inclua em nenhum campo do JSON gerado — eles serão contraditos ou duplicados:
- telefone, celular, WhatsApp, e-mail, site ou URL
- horário de atendimento ou funcionamento
- endereço, CEP, bairro, cidade (como dado específico de contato)
- instruções de indisponibilidade ou estoque de produtos específicos

DEFINIÇÃO DOS CAMPOS:
- identity: descrição concisa de quem é o agente e sua especialidade (obrigatório, 20–500 chars)
- objective: objetivo principal do agente em uma frase clara (obrigatório, 20–300 chars)
- communication_style: tom e estilo de comunicação desejado (opcional, 10–300 chars)
- commercial_rules: regras comerciais estratégicas, ex: não informar preços sem elevar valor (opcional, 10–500 chars)
- custom_notes: comportamento estratégico e padrões de condução das conversas (opcional, 10–1500 chars)

FORMATO DE RESPOSTA (único formato aceito — sem nada antes ou depois):
{"identity":"...","objective":"...","communication_style":"...","commercial_rules":"...","custom_notes":"..."}`;
}

function getBuilderUserMessage(companyData, catalogItems, userAnswers) {
  return `DADOS DA EMPRESA:
${formatCompanyContext(companyData)}

PRODUTOS E SERVIÇOS CADASTRADOS:
${formatCatalogContext(catalogItems)}

RESPOSTAS DO USUÁRIO:
${formatUserAnswers(userAnswers)}

Gere o JSON agora.`;
}

// ── Pipeline de validação do output ──────────────────────────────────────────

/**
 * Tenta extrair JSON do output do LLM.
 * Tenta parse direto primeiro; se falhar, tenta extrair bloco JSON da string.
 */
function tryParseJSON(text) {
  if (!text || typeof text !== 'string') return null;

  // Tentativa 1: parse direto
  try {
    return JSON.parse(text.trim());
  } catch {
    // Tentativa 2: extrair primeiro bloco {...} da string (caso o LLM adicionou texto)
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Extrai apenas os campos conhecidos do objeto parseado.
 * Descarta campos extras. Descarta valores não-string.
 */
function extractKnownFields(parsed) {
  const result = {};
  for (const field of KNOWN_OUTPUT_FIELDS) {
    if (typeof parsed[field] === 'string' && parsed[field].trim()) {
      result[field] = parsed[field];
    }
  }
  return result;
}

// ── Chamada ao LLM com retry ──────────────────────────────────────────────────

/**
 * Executa chamada ao OpenAI com o prompt do builder.
 * Retorna o texto bruto da resposta.
 */
async function callBuilderLLM(client, model, timeoutMs, systemPrompt, userMessage, messages = []) {
  const signal = AbortSignal.timeout(timeoutMs);

  const allMessages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userMessage },
    ...messages,
  ];

  const completion = await client.chat.completions.create(
    {
      model,
      temperature: 0.3, // baixa temperatura: saída mais determinística para JSON
      max_tokens:  1024,
      messages:    allMessages,
    },
    { signal }
  );

  return completion.choices[0]?.message?.content?.trim() ?? '';
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

  const { userAnswers = {}, company_id } = req.body ?? {};

  if (!company_id || typeof company_id !== 'string') {
    return res.status(400).json({ success: false, error: 'company_id é obrigatório.' });
  }

  // ── 2. Autenticar caller ────────────────────────────────────────────────────

  const auth = await validateCaller(req, company_id);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }

  console.log('[PROMPT_BUILDER:start]', {
    company_id,
    caller_id:    auth.callerId,
    has_answers:  Object.keys(userAnswers).length > 0,
  });

  // #region agent log
  fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cf8832'},body:JSON.stringify({sessionId:'cf8832',location:'generate.js:handler-start',message:'Handler executou — auth ok',data:{company_id,role:auth.role},timestamp:Date.now(),hypothesisId:'A-B-C-D'})}).catch(()=>{});
  // #endregion

  // ── 3. Verificar OpenAI ─────────────────────────────────────────────────────

  const openaiSettings = await fetchParentOpenAISettingsForSystem();
  // #region agent log
  fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cf8832'},body:JSON.stringify({sessionId:'cf8832',location:'generate.js:openai-settings',message:'OpenAI settings carregadas',data:{enabled:openaiSettings?.enabled,model:openaiSettings?.model},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  if (!openaiSettings.enabled) {
    return res.status(503).json({ success: false, error: 'Serviço de IA não disponível.' });
  }

  const client = getOpenAIClient();
  if (!client) {
    return res.status(503).json({ success: false, error: 'Cliente OpenAI não configurado.' });
  }

  // ── 4. Buscar dados do sistema ──────────────────────────────────────────────

  let companyData   = null;
  let catalogItems  = [];

  try {
    [companyData, catalogItems] = await Promise.all([
      fetchCompanyData(company_id),
      fetchCatalogSummary(company_id),
    ]);
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cf8832'},body:JSON.stringify({sessionId:'cf8832',location:'generate.js:data-fetch-ok',message:'Dados buscados com sucesso',data:{has_company:Boolean(companyData),catalog_count:catalogItems.length,company_keys:companyData?Object.keys(companyData):[]},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
    // #endregion
  } catch (fetchErr) {
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cf8832'},body:JSON.stringify({sessionId:'cf8832',location:'generate.js:data-fetch-error',message:'ERRO ao buscar dados',data:{error:fetchErr?.message},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    console.error('[PROMPT_BUILDER] Erro ao buscar dados:', fetchErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao carregar dados da empresa.' });
  }

  // ── 5. Chamar LLM (1ª tentativa) ───────────────────────────────────────────

  const systemPrompt = getBuilderSystemPrompt();
  const userMessage  = getBuilderUserMessage(companyData, catalogItems, userAnswers);

  let rawOutput = '';
  let parsed    = null;

  try {
    rawOutput = await callBuilderLLM(
      client,
      openaiSettings.model,
      openaiSettings.timeout_ms,
      systemPrompt,
      userMessage,
    );
    parsed = tryParseJSON(rawOutput);
  } catch (llmErr) {
    console.error('[PROMPT_BUILDER] Erro na chamada LLM:', llmErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao gerar prompt. Tente novamente.' });
  }

  // ── 6. Retry se JSON inválido ───────────────────────────────────────────────

  if (!parsed) {
    console.warn('[PROMPT_BUILDER:retry]', {
      company_id,
      reason:     'invalid_json_first_attempt',
      raw_length: rawOutput.length,
    });

    const retryUserMessage = `O JSON que você gerou não pôde ser processado. \
Retorne APENAS o JSON válido, sem texto adicional, sem markdown, sem explicações. \
Use exatamente este formato:
{"identity":"...","objective":"...","communication_style":"...","commercial_rules":"...","custom_notes":"..."}`;

    try {
      const retryOutput = await callBuilderLLM(
        client,
        openaiSettings.model,
        openaiSettings.timeout_ms,
        systemPrompt,
        userMessage,
        // Multi-turn: inclui resposta anterior + correção
        [
          { role: 'assistant', content: rawOutput },
          { role: 'user',      content: retryUserMessage },
        ]
      );
      parsed = tryParseJSON(retryOutput);
    } catch (retryErr) {
      console.error('[PROMPT_BUILDER] Erro no retry LLM:', retryErr.message);
    }

    if (!parsed) {
      console.error('[PROMPT_BUILDER:invalid_json]', {
        company_id,
        reason: 'invalid_json_after_retry',
      });
      return res.status(422).json({
        success: false,
        error:   'invalid_prompt_config',
        details: [{ field: '_root', reason: 'json_parse_failed_after_retry' }],
      });
    }
  }

  // ── 7. Extrair apenas campos conhecidos ────────────────────────────────────

  const extracted = extractKnownFields(parsed);

  // ── 8. Validar schema ──────────────────────────────────────────────────────

  const validation = validatePromptConfig(extracted);
  if (!validation.valid) {
    console.warn('[PROMPT_BUILDER] Validação falhou:', validation.errors);
    return res.status(422).json({
      success: false,
      error:   'invalid_prompt_config',
      details: validation.errors,
    });
  }

  // ── 9. Sanitizar (modo save — lança se bloqueado) ──────────────────────────

  let sanitized;
  try {
    sanitized = sanitizePromptConfig(extracted, 'save');
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cf8832'},body:JSON.stringify({sessionId:'cf8832',location:'generate.js:sanitize-ok',message:'sanitizePromptConfig ok',data:{fields:Object.keys(sanitized)},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{});
    // #endregion
  } catch (blocked) {
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cf8832'},body:JSON.stringify({sessionId:'cf8832',location:'generate.js:sanitize-blocked',message:'BLOQUEADO por sanitizePromptConfig',data:{blocked:String(blocked)},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    console.warn('[PROMPT_BUILDER] Sanitização bloqueada:', blocked);
    return res.status(422).json({
      success: false,
      error:   'invalid_prompt_config',
      details: [blocked],
    });
  }

  // ── 10. Normalizar campos ──────────────────────────────────────────────────

  const promptConfig = {};
  for (const field of KNOWN_OUTPUT_FIELDS) {
    if (typeof sanitized[field] === 'string') {
      promptConfig[field] = normalizeField(sanitized[field]);
    }
  }

  // ── 11. Retornar para preview (NÃO salva) ──────────────────────────────────

  console.log('[PROMPT_BUILDER:success]', {
    company_id,
    has_catalog:            catalogItems.length > 0,
    catalog_count:          catalogItems.length,
    has_company_data:       Boolean(companyData),
    fields_generated:       Object.keys(promptConfig),
  });

  return res.status(200).json({
    success:       true,
    prompt_config: promptConfig,
    meta: {
      company_name:   companyData?.nome_fantasia || companyData?.name || null,
      catalog_count:  catalogItems.length,
      data_sources:   {
        company_data:  Boolean(companyData),
        catalog:       catalogItems.length > 0,
        user_answers:  Object.keys(userAnswers).length > 0,
      },
    },
  });
}
