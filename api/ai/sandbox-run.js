// =============================================================================
// POST /api/ai/sandbox-run
//
// Sandbox REAL do agente — usa o mesmo runtime de produção (runner + tools),
// mas em modo completamente isolado: sem DB writes, sem WhatsApp, sem CRM.
//
// DIFERENÇA do /api/ai/sandbox:
//   - Carrega companyData e catálogo reais (leitura somente)
//   - Usa buildPromptFromConfig (mesmo do runtime de produção)
//   - Suporta knowledge_base inline quando agent_id fornecido
//   - Simula tools (via sandboxMode no runner) — o LLM decide usar as tools,
//     mas a execução é interceptada e retorna resultado simulado
//   - Mantém memória conversacional entre turnos (via estado no frontend)
//
// MULTI-TENANT / SEGURANÇA:
//   - JWT + membership obrigatórios (igual ao sandbox básico)
//   - company_id validado antes de qualquer query
//   - agent_id (opcional) validado com eq(company_id) antes do uso
//   - Nenhuma escrita em banco: zero side effects em produção
//
// BODY:
//   {
//     company_id:      string           (UUID da empresa)
//     prompt_config:   FlatPromptConfig (config em memória)
//     agent_name?:     string           (nome persona)
//     messages:        ChatMessage[]    (histórico user/assistant)
//     sandbox_memory?: SandboxMemory   (memória acumulada em memória local)
//     agent_id?:       string           (UUID do agente salvo — para knowledge_base)
//   }
//
// RESPOSTA:
//   { success: true,  reply, tool_events, updated_sandbox_memory }
//   { success: false, error }
// =============================================================================

import { createClient }                       from '@supabase/supabase-js';
import { getOpenAIClient }                    from '../lib/openai/client.js';
import { fetchParentOpenAISettingsForSystem } from '../lib/openai/settingsDb.js';
import { buildPromptFromConfig }              from '../lib/agents/promptTemplate.js';
import { runAgentWithConfig }                 from '../lib/agents/runner.js';
import { getToolsForAgent }                   from '../lib/agents/toolDefinitions.js';
import { compose }                            from '../lib/agents/responseComposer.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const MAX_HISTORY_TURNS  = 15;    // turnos máximos enviados ao modelo
const MAX_MSG_LENGTH     = 2000;  // caracteres por mensagem
const MAX_AGENT_NAME_LEN = 80;
const MAX_REPLY_TOKENS   = 512;
const MAX_CATALOG_ITEMS  = 20;
const SANDBOX_TIMEOUT_MS = 15_000; // timeout total da execução do sandbox

// Campos permitidos no prompt_config
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

// Limite do bloco [MEMÓRIA] no extra_context (espelha agentExecutor.js)
const MEM_PROMPT_MAX_CHARS = 1200;

// ── Clientes Supabase ─────────────────────────────────────────────────────────

function getAnonSupabase(authHeader) {
  const url    = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anon   = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !anon) return null;
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });
}

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Autenticação ──────────────────────────────────────────────────────────────

async function validateCaller(req, companyId) {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !String(authHeader).startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Autenticação necessária' };
  }

  const callerClient = getAnonSupabase(String(authHeader));
  if (!callerClient) {
    return { ok: false, status: 503, error: 'Supabase não configurado' };
  }

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

// ── Validação do prompt_config ────────────────────────────────────────────────

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

// ── Sanitização do histórico ──────────────────────────────────────────────────

function sanitizeMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) return [];
  return rawMessages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: String(m.content).trim().slice(0, MAX_MSG_LENGTH) }))
    .filter(m => m.content.length > 0)
    .slice(-(MAX_HISTORY_TURNS * 2));
}

// ── Enriquecimento de tool_events com mídia real (sandbox only) ───────────────
//
// Injeta media_url e media_type nos eventos send_media usando uma query
// READ-ONLY ao catálogo da empresa. Usa cache por usage_role para evitar
// queries repetidas no mesmo turno. Nunca envia mídia externamente.

const INTENT_TO_USAGE_ROLE = {
  presentation: 'hero',
  proof:        'testimonial',
  detail:       'demo',
};

async function enrichMediaToolEvents(svc, companyId, events) {
  if (!events.length || !svc || !companyId) return events;

  // Cache por usage_role dentro desta execução para evitar queries duplicadas.
  const cache = {};

  async function fetchMediaForRole(usageRole) {
    if (Object.prototype.hasOwnProperty.call(cache, usageRole)) return cache[usageRole];

    try {
      const { data } = await svc
        .from('catalog_item_media')
        .select('media_type, company_media_library!inner(preview_url)')
        .eq('company_id', companyId)
        .eq('usage_role',  usageRole)
        .eq('is_active',   true)
        .eq('use_in_ai',   true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      const result = data?.company_media_library?.preview_url
        ? { media_url: data.company_media_library.preview_url, media_type: data.media_type ?? 'image' }
        : null;

      cache[usageRole] = result;
      return result;
    } catch {
      cache[usageRole] = null;
      return null;
    }
  }

  const enriched = [];
  for (const ev of events) {
    if (ev.tool !== 'send_media') {
      enriched.push(ev);
      continue;
    }
    const usageRole = INTENT_TO_USAGE_ROLE[ev.args?.intent] ?? 'hero';
    const media = await fetchMediaForRole(usageRole);
    enriched.push(media
      ? { ...ev, args: { ...ev.args, media_url: media.media_url, media_type: media.media_type } }
      : ev
    );
  }
  return enriched;
}

// ── Carregamento de dados da empresa ─────────────────────────────────────────

async function loadCompanyData(svc, companyId) {
  const { data, error } = await svc
    .from('companies')
    .select(`
      id, name, nome_fantasia, timezone, default_currency,
      pais, cidade, estado, cep, logradouro, bairro, numero,
      country_code, telefone_principal,
      email_principal, site_principal, ramo_atividade,
      ponto_referencia, horario_atendimento, ai_profile
    `)
    .eq('id', companyId)
    .maybeSingle();

  if (error) {
    console.warn('[SANDBOX-RUN] Falha ao carregar companyData:', error.message);
    return null;
  }
  return data;
}

// ── Carregamento do catálogo ──────────────────────────────────────────────────

async function loadCatalog(svc, companyId) {
  const select = 'id, name, description, default_price, availability_status';

  const [productsResult, servicesResult] = await Promise.allSettled([
    svc.from('products')
      .select(select)
      .eq('company_id', companyId)
      .eq('available_for_ai', true)
      .eq('is_active', true)
      .limit(MAX_CATALOG_ITEMS),
    svc.from('services')
      .select(select)
      .eq('company_id', companyId)
      .eq('available_for_ai', true)
      .eq('is_active', true)
      .limit(MAX_CATALOG_ITEMS),
  ]);

  const products = productsResult.status === 'fulfilled'
    ? (productsResult.value.data ?? [])
    : [];
  const services = servicesResult.status === 'fulfilled'
    ? (servicesResult.value.data ?? [])
    : [];

  return { products, services };
}

// ── Carregamento da knowledge_base do agente salvo ────────────────────────────

async function loadAgentKnowledge(svc, agentId, companyId) {
  const { data } = await svc
    .from('lovoo_agents')
    .select('knowledge_base, knowledge_mode, allowed_tools, model, model_config')
    .eq('id', agentId)
    .eq('company_id', companyId)
    .maybeSingle();

  return data ?? null;
}

// ── Memória da simulação ──────────────────────────────────────────────────────

/**
 * Formata o objeto sandbox_memory como bloco [MEMÓRIA] para o extra_context.
 * Lógica simplificada de buildMemorySection (agentExecutor.js) — sem lógica de staleness
 * pois a memória do sandbox é sempre recente (vive na sessão do frontend).
 */
function buildSandboxMemorySection(sandboxMemory) {
  if (!sandboxMemory || typeof sandboxMemory !== 'object') return null;
  if (!sandboxMemory.summary || typeof sandboxMemory.summary !== 'string') return null;
  if (!sandboxMemory.summary.trim()) return null;

  const lines = [sandboxMemory.summary.trim().slice(0, 300)];

  if (Array.isArray(sandboxMemory.open_loops) && sandboxMemory.open_loops.length > 0) {
    lines.push(`Aguardando resposta: ${sandboxMemory.open_loops.join(', ')}`);
  }

  const meta = [];
  if (sandboxMemory.conversation_stage) meta.push(`Estágio: ${sandboxMemory.conversation_stage}`);
  if (sandboxMemory.interaction_count)  meta.push(`Interações: ${sandboxMemory.interaction_count}`);
  if (meta.length > 0) lines.push(meta.join(' | '));

  return `[MEMÓRIA]\n${lines.join('\n')}`.slice(0, MEM_PROMPT_MAX_CHARS);
}

/**
 * Extrai e valida o bloco <!-- mem: {...} --> da resposta do LLM.
 * Mesma lógica de extractMemoryBlock em agentExecutor.js.
 */
function extractSandboxMemory(rawResponse) {
  const match = rawResponse.match(/<!--\s*mem:\s*(\{[\s\S]*?\})\s*-->/i);

  const cleanResponse = match
    ? rawResponse.replace(match[0], '').trim()
    : rawResponse.trim();

  if (!match) return { cleanResponse, memoryPayload: null };

  let parsed = null;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return { cleanResponse, memoryPayload: null };
  }

  // Validação estrutural mínima
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { cleanResponse, memoryPayload: null };
  }

  const hasSummary = typeof parsed.summary === 'string' && parsed.summary.trim().length > 0;
  const hasFacts   = parsed.facts && typeof parsed.facts === 'object' && Object.keys(parsed.facts).length > 0;
  if (!hasSummary && !hasFacts) return { cleanResponse, memoryPayload: null };

  return { cleanResponse, memoryPayload: parsed };
}

/**
 * Faz merge seguro da memória sandbox.
 * Simplificado em relação ao writeMemory de produção:
 * sem sanitizeFacts (não há anti-injection necessário no sandbox).
 */
function mergeSandboxMemory(existing, payload) {
  const safe = (existing && typeof existing === 'object') ? existing : {};
  const now  = new Date().toISOString();

  const mergedFacts = {
    ...(safe.facts && typeof safe.facts === 'object' ? safe.facts : {}),
    ...(payload.facts && typeof payload.facts === 'object' ? payload.facts : {}),
  };

  function safeList(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(i => typeof i === 'string' && i.length > 0).slice(0, 3);
  }

  return {
    v:                   2,
    summary:             (payload.summary ?? safe.summary ?? '').slice(0, 300),
    facts:               Object.fromEntries(Object.entries(mergedFacts).slice(0, 10)),
    intents:             safeList(payload.intents    ?? safe.intents    ?? []),
    objections:          safeList(payload.objections ?? safe.objections ?? []),
    open_loops:          safeList(payload.open_loops ?? safe.open_loops ?? []),
    conversation_stage:  (payload.conversation_stage ?? safe.conversation_stage ?? 'prospecto').slice(0, 40),
    interaction_count:   (typeof safe.interaction_count === 'number' ? safe.interaction_count : 0) + 1,
    last_interaction_at: now,
    updated_at:          now,
  };
}

// ── Montagem do extra_context sandbox ─────────────────────────────────────────

/**
 * Monta o extra_context para o runner, com:
 *   - Bloco [MEMÓRIA] da sandbox_memory (se existir)
 *   - Histórico da conversa ([CONTATO]/[AGENTE])
 *   - Lista compacta do catálogo (se disponível)
 *
 * Intencionalmente simplificado em relação ao buildExtraContext de produção:
 * sem catalog matching, sem comparação, sem item_of_interest.
 * O agente ainda recebe contexto suficiente para se comportar de forma realista.
 */
function buildSandboxExtraContext({ sandboxMemory, messages, catalog }) {
  const sections = [];

  // 1. Memória acumulada (se houver)
  const memSection = buildSandboxMemorySection(sandboxMemory);
  if (memSection) sections.push(memSection);

  // 2. Histórico da conversa (exceto a última mensagem do usuário que já vai em userMessage)
  const historyMessages = messages.slice(0, -1); // remove última (atual do usuário)
  if (historyMessages.length > 0) {
    const lines = historyMessages.map(m => {
      const prefix = m.role === 'user' ? '[CONTATO]' : '[AGENTE]';
      return `${prefix}: ${m.content}`;
    });
    sections.push(`Histórico da conversa (últimas ${historyMessages.length} mensagens):\n${lines.join('\n')}`);
  }

  // 3. Catálogo compacto (se disponível)
  const allItems = [
    ...(catalog?.products ?? []),
    ...(catalog?.services ?? []),
  ].slice(0, MAX_CATALOG_ITEMS);

  if (allItems.length > 0) {
    const catalogLines = allItems.map(item => {
      const price = item.default_price != null ? ` — R$ ${Number(item.default_price).toFixed(2)}` : '';
      return `• ${item.name}${price}`;
    });
    sections.push(`Produtos e serviços disponíveis:\n${catalogLines.join('\n')}`);
  }

  return sections.join('\n\n');
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

  const {
    company_id,
    prompt_config,
    agent_name,
    messages,
    sandbox_memory,
    agent_id,
  } = req.body ?? {};

  if (!company_id || typeof company_id !== 'string') {
    return res.status(400).json({ success: false, error: 'company_id é obrigatório.' });
  }

  const configValidation = validateSandboxConfig(prompt_config);
  if (!configValidation.ok) {
    return res.status(400).json({ success: false, error: `prompt_config inválido: ${configValidation.reason}` });
  }

  const sanitizedMessages = sanitizeMessages(messages);
  const lastMsg = sanitizedMessages.at(-1);
  if (!lastMsg || lastMsg.role !== 'user') {
    return res.status(400).json({ success: false, error: 'Última mensagem deve ser do usuário.' });
  }

  // agent_id é opcional — validar formato se presente
  const safeAgentId = (typeof agent_id === 'string' && agent_id.trim().length > 0)
    ? agent_id.trim()
    : null;

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

  // ── 4. Carregar dados (read-only, service_role) ─────────────────────────────

  const svc = getServiceSupabase();
  if (!svc) {
    return res.status(503).json({ success: false, error: 'Supabase service não configurado.' });
  }

  const [companyData, catalog] = await Promise.all([
    loadCompanyData(svc, company_id),
    loadCatalog(svc, company_id),
  ]);

  // Carregar knowledge_base se agent_id fornecido e validado
  let agentKnowledge = null;
  if (safeAgentId) {
    agentKnowledge = await loadAgentKnowledge(svc, safeAgentId, company_id);
  }

  // ── 5. Montar agente sintético ──────────────────────────────────────────────

  const safeAgentName = typeof agent_name === 'string'
    ? agent_name.replace(/<[^>]*>/g, '').trim().slice(0, MAX_AGENT_NAME_LEN)
    : '';

  // Prompt base via buildPromptFromConfig (mesmo do runtime de produção)
  const builtPrompt = buildPromptFromConfig(prompt_config, companyData);
  if (!builtPrompt) {
    return res.status(400).json({ success: false, error: 'Falha ao montar prompt do agente.' });
  }

  // Nome do assistente: injetar no início do prompt se fornecido
  const agentPrompt = safeAgentName
    ? `Seu nome é "${safeAgentName}". Use-o ao se apresentar.\n\n${builtPrompt}`
    : builtPrompt;

  // Conhecimento inline:
  //   - Se agent_id foi fornecido e o agente salvo tem knowledge_base → usa inline
  //   - Nunca RAG no sandbox (sem embeddings, sem match_agent_chunks)
  const knowledgeBase = agentKnowledge?.knowledge_base?.trim() || null;
  const knowledgeMode = knowledgeBase ? 'inline' : 'none';

  // Tools do agente salvo (se disponível); ou conjunto padrão em modo criação
  const allowedTools = Array.isArray(agentKnowledge?.allowed_tools)
    ? agentKnowledge.allowed_tools
    : [];

  const syntheticAgent = {
    id:                   safeAgentId ?? 'sandbox',
    name:                 safeAgentName || 'Agente sandbox',
    prompt:               agentPrompt,
    knowledge_base:       knowledgeBase,
    knowledge_mode:       knowledgeMode,
    knowledge_base_config: {},
    model:                agentKnowledge?.model ?? openaiSettings.model,
    model_config:         agentKnowledge?.model_config ?? { temperature: 0.7, max_tokens: MAX_REPLY_TOKENS },
    allowed_tools:        allowedTools,
  };

  // Forçar max_tokens dentro do limite do sandbox (desempenho + custo)
  if (!syntheticAgent.model_config.max_tokens || syntheticAgent.model_config.max_tokens > MAX_REPLY_TOKENS) {
    syntheticAgent.model_config = { ...syntheticAgent.model_config, max_tokens: MAX_REPLY_TOKENS };
  }

  // ── 6. Montar extra_context com memória + histórico + catálogo ──────────────

  const extraContext = buildSandboxExtraContext({
    sandboxMemory: sandbox_memory ?? null,
    messages:      sanitizedMessages,
    catalog,
  });

  // ── 7. Executar runner em modo sandbox ──────────────────────────────────────

  const runCtx = {
    userMessage:  lastMsg.content,
    extra_context: extraContext || undefined,
    company_id,
    channel:      'sandbox',
    lead_id:      null,
    conversation_id: null,
    locked_opportunity_id: null,
    item_of_interest: null,
    model_config: syntheticAgent.model_config,
  };

  // Timeout de segurança — garante que o handler não excede SANDBOX_TIMEOUT_MS
  let runResult;
  try {
    const runPromise = runAgentWithConfig(syntheticAgent, 'sandbox', runCtx, { sandboxMode: true });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('sandbox_timeout')), SANDBOX_TIMEOUT_MS)
    );
    runResult = await Promise.race([runPromise, timeoutPromise]);
  } catch (err) {
    if (err?.message === 'sandbox_timeout') {
      console.warn('[SANDBOX-RUN] Timeout de execução atingido');
      return res.status(504).json({ success: false, error: 'Tempo limite excedido. Tente novamente.' });
    }
    console.error('[SANDBOX-RUN] Erro no runner:', err?.message ?? err);
    return res.status(500).json({ success: false, error: 'Erro ao executar o agente. Tente novamente.' });
  }

  if (!runResult.ok) {
    return res.status(500).json({ success: false, error: `Agente indisponível: ${runResult.errorCode}` });
  }

  // ── 8. Extrair e mesclar memória sandbox ────────────────────────────────────

  const { cleanResponse, memoryPayload } = extractSandboxMemory(runResult.result);

  let updatedSandboxMemory = sandbox_memory ?? null;
  if (memoryPayload) {
    updatedSandboxMemory = mergeSandboxMemory(sandbox_memory ?? null, memoryPayload);
  }

  // ── 9. Dividir resposta em blocos (mesmo pipeline do WhatsApp) ─────────────
  //
  // Reutiliza responseComposer.compose para replicar o comportamento real do
  // agente no WhatsApp: até 10 blocos de ~300 chars, separados por parágrafo
  // ou sentença. O frontend exibe cada bloco como uma bolha separada com delay.

  const finalReply     = cleanResponse || runResult.result;
  const composerResult = compose({ raw_response: finalReply });

  const replyBlocks = (composerResult.success && Array.isArray(composerResult.output?.blocks))
    ? composerResult.output.blocks.map(b => b.content).filter(Boolean)
    : [finalReply];

  // ── 10. Enriquecer eventos send_media com preview de mídia real ─────────────
  //
  // Lookup READ-ONLY em catalog_item_media + company_media_library para obter
  // uma URL de mídia real da empresa, filtrada por company_id e usage_role.
  // Sem envio externo — apenas injeção de media_url/media_type nos args do evento.
  // Cache por usage_role evita queries repetidas no mesmo turno.

  const toolEvents = await enrichMediaToolEvents(svc, companyId, runResult.sandbox_tool_events ?? []);

  // Indicar na UI se o agente real usa RAG mas o sandbox está com inline/none
  const ragActive  = agentKnowledge?.knowledge_mode === 'rag' || agentKnowledge?.knowledge_mode === 'hybrid';
  const ragNotice  = ragActive && !knowledgeBase
    ? 'Conhecimento vetorial (RAG) não simulado neste ambiente.'
    : null;

  return res.status(200).json({
    success:                true,
    reply:                  finalReply,        // backward compat — string completa
    reply_blocks:           replyBlocks,       // array de blocos para renderização progressiva
    tool_events:            toolEvents,
    updated_sandbox_memory: updatedSandboxMemory,
    rag_notice:             ragNotice,
  });
}
