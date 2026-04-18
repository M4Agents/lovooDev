// =====================================================
// Runner de agentes — orquestração da execução via OpenAI.
//
// Responsabilidade:
//   1. Validar use_id e regras de segurança (requires_context)
//   2. Resolver o agente vinculado ao uso
//   3. Montar system prompt conforme knowledge_mode do agente:
//      - none    → prompt + contexto de execução
//      - inline  → prompt + knowledge_base (texto livre)
//      - rag     → prompt + contextText do retriever vetorial
//      - hybrid  → prompt + knowledge_base + contextText do retriever
//   4. Executar via OpenAI
//   5. Retornar fallback se não houver agente ou OpenAI indisponível
//
// LOGGING:
//   Cada execução é registrada via writeExecutionLog() (fire-and-forget).
//   invalid_use_id não é logado — decisão de escopo do MVP.
//   Ver docs/adr/ADR-001-ai-agent-logging-and-costs.md
//
// CUSTO ESTIMADO:
//   estimated_cost_usd é estimativa operacional (não faturamento real).
//   Calculado com base em pricing.ts — nunca dependente de chamada externa.
//
// Features NÃO devem chamar OpenAI diretamente — devem usar runAgent().
// Nunca importar no frontend — server-side exclusivo.
// =====================================================

import { getOpenAIClient } from '../openai/client.js'
import { fetchParentOpenAISettingsForSystem } from '../openai/settingsDb.js'
import { isOpenAIApiKeyConfigured } from '../openai/config.js'
import { resolveAgent, type ResolvedAgent } from './resolver.js'
import { getUseMeta, VALID_USE_IDS } from './uses.js'
import { retrieveAgentContext } from './retriever.js'
import { writeExecutionLog, type ExecutionLogEntry } from './logger.js'
import { estimateCost } from './pricing.js'
import { getToolsForAgent } from './toolDefinitions.js'
import { executeToolCalls, executeToolCallsSandbox } from './toolExecutor.js'

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type AgentRunContext = {
  /** Mensagem ou input principal do usuário / feature. */
  userMessage: string
  /** Canal de origem (ex.: whatsapp, web). Opcional, usado em logs. */
  channel?: string
  /** Tipo de entidade relacionada (ex.: lead, product). Opcional. */
  entity_type?: string
  /** ID da entidade relacionada. Opcional. */
  entity_id?: string
  /**
   * Contexto extra obrigatório para usos com requires_context = true.
   * Ex.: para suporte, é o contexto da tela atual / funcionalidade.
   */
  extra_context?: string
  /** company_id do consumidor (para log e rastreabilidade — não altera lógica). */
  company_id?: string
  /**
   * UUID do usuário que disparou a execução.
   * NULL em contextos sem sessão: WhatsApp webhook, automações, etc.
   */
  user_id?: string
  /**
   * Variáveis de substituição aplicadas ao prompt do agente antes da execução.
   * Tokens no formato {{chave}} no prompt são substituídos pelos valores informados.
   * Ex.: { product_name: 'Notebook Pro', product_description: 'Ultra-slim laptop' }
   */
  variables?: Record<string, string>
  /**
   * Diretriz global de governança de IA, controlada exclusivamente pela empresa-pai.
   * Injetada obrigatoriamente no TOPO do system prompt, antes do prompt do agente.
   * NUNCA logada, NUNCA exposta em responses ou debug.
   */
  system_policy?: string
  /**
   * ID do lead da conversa — vem do contexto autenticado do backend.
   * Passado ao toolExecutor para ownership check e ações CRM.
   * NUNCA aceitar do LLM diretamente.
   */
  lead_id?: string | null
  /**
   * ID da conversa WhatsApp — vem do contexto autenticado.
   * Usado pelo toolExecutor para audit log de tool executions.
   */
  conversation_id?: string | null
  /**
   * ID da oportunidade travada para esta conversa (Phase 3: vem do flow state).
   * null = toolExecutor busca a mais recente aberta do lead.
   */
  locked_opportunity_id?: string | null
  /**
   * Item de catálogo em foco (produto ou serviço) — vem do ContextBuilder/matcher.
   * Usado por tools como send_media; nunca confiar em IDs vindos do LLM.
   */
  item_of_interest?: Record<string, unknown> | null
  /** model_config do agente (ex.: media_max_per_call) — somente backend. */
  model_config?: Record<string, unknown>
}

export type ToolCallResult = {
  tool_call_id: string
  tool_name:    string
  result:       Record<string, unknown>
  success:      boolean
  is_critical:  boolean
}

/** Evento de tool simulada em modo sandbox (sem efeitos reais). */
export type SandboxToolEvent = {
  tool:      string
  args:      Record<string, unknown>
  simulated: true
  label:     string
}

export type AgentRunSuccess = {
  ok: true
  result: string
  agent_id: string
  use_id: string
  fallback: false
  /** Resultados das tool calls executadas nesta rodada. Vazio se agente sem tools ou sem chamadas. */
  tool_results: ToolCallResult[]
  /** Eventos de tools simuladas (sandbox_mode only). Undefined em execuções reais. */
  sandbox_tool_events?: SandboxToolEvent[]
}

export type AgentRunFallback = {
  ok: true
  result: string
  agent_id: null
  use_id: string
  fallback: true
}

export type AgentRunError = {
  ok: false
  errorCode: string
  use_id: string
}

export type AgentRunResult = AgentRunSuccess | AgentRunFallback | AgentRunError

// ── Fallbacks estáticos ───────────────────────────────────────────────────────

const STATIC_FALLBACKS: Record<string, string> = {
  'system:support_assistant:general_help':
    'Não encontrei um agente configurado para suporte no momento. ' +
    'Consulte a documentação do sistema ou entre em contato com o administrador.',
}

function getStaticFallback(useId: string): string {
  return (
    STATIC_FALLBACKS[useId] ??
    'Recurso de IA não disponível no momento. Tente novamente em instantes.'
  )
}

// ── Substituição de variáveis ─────────────────────────────────────────────────

/**
 * Substitui tokens {{chave}} no texto pelos valores informados em `variables`.
 * Tokens sem correspondência são mantidos literalmente.
 */
function substituteVariables(text: string, variables?: Record<string, string>): string {
  if (!variables || Object.keys(variables).length === 0) return text
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => variables[key] ?? match)
}

// ── Runner ────────────────────────────────────────────────────────────────────

/**
 * Executa um agente vinculado a um uso funcional.
 *
 * Fluxo:
 *   1. Valida use_id
 *   2. Verifica regras de segurança (requires_context)
 *   3. Verifica disponibilidade da OpenAI
 *   4. Resolve agente via resolver.ts
 *   5. Se não há agente → fallback (static ou error)
 *   6. Monta system prompt e executa via OpenAI
 *   7. Retorna resultado ou fallback em caso de falha
 *   8. Registra log de execução (fire-and-forget)
 */
export async function runAgent(
  useId: string,
  ctx: AgentRunContext
): Promise<AgentRunResult> {
  // Marca o início para cálculo de duration_ms no log
  const startMs = Date.now()

  // Contexto base de log (compartilhado em todos os pontos de saída)
  const logBase = {
    use_id:              useId,
    consumer_company_id: ctx.company_id ?? null,
    user_id:             ctx.user_id ?? null,
    channel:             ctx.channel ?? null,
  }

  // Helper: envia o log fire-and-forget e retorna o resultado
  function logAndReturn<T extends AgentRunResult>(
    result: T,
    entry: Omit<ExecutionLogEntry, 'use_id' | 'consumer_company_id' | 'user_id' | 'channel'>
  ): T {
    void writeExecutionLog({
      ...logBase,
      ...entry,
      duration_ms: Date.now() - startMs,
    } as ExecutionLogEntry)
    return result
  }

  // 1. Valida use_id
  // invalid_use_id NÃO é logado — decisão de escopo do MVP
  if (!VALID_USE_IDS.has(useId)) {
    return { ok: false, errorCode: 'invalid_use_id', use_id: useId }
  }

  // 2. Regras de segurança por uso
  const meta = getUseMeta(useId)

  if (meta.requires_context && !ctx.extra_context?.trim()) {
    const result: AgentRunError = { ok: false, errorCode: 'missing_required_context', use_id: useId }
    return logAndReturn(result, {
      status:      'error_missing_context',
      error_code:  'missing_required_context',
      is_fallback: false,
    })
  }

  // 3. Verifica disponibilidade OpenAI
  if (!isOpenAIApiKeyConfigured()) {
    const isFallback = meta.fallback_mode === 'static'
    return logAndReturn(
      handleFallback(useId, meta.fallback_mode, 'openai_not_configured'),
      {
        status:      'fallback_openai_unavailable',
        error_code:  'openai_not_configured',
        is_fallback: isFallback,
      }
    )
  }

  const openaiSettings = await fetchParentOpenAISettingsForSystem()
  if (!openaiSettings.enabled) {
    const isFallback = meta.fallback_mode === 'static'
    return logAndReturn(
      handleFallback(useId, meta.fallback_mode, 'openai_disabled'),
      {
        status:      'fallback_openai_unavailable',
        error_code:  'openai_disabled',
        is_fallback: isFallback,
      }
    )
  }

  const client = getOpenAIClient()
  if (!client) {
    const isFallback = meta.fallback_mode === 'static'
    return logAndReturn(
      handleFallback(useId, meta.fallback_mode, 'openai_client_null'),
      {
        status:      'fallback_openai_unavailable',
        error_code:  'openai_client_null',
        is_fallback: isFallback,
      }
    )
  }

  // 4. Resolve agente
  const resolved = await resolveAgent(useId)

  if (!resolved.found) {
    if (resolved.reason === 'no_binding' || resolved.reason === 'agent_inactive') {
      const isFallback = meta.fallback_mode === 'static'
      return logAndReturn(
        handleFallback(useId, meta.fallback_mode, resolved.reason),
        {
          status:      'fallback_no_agent',
          error_code:  resolved.reason,
          is_fallback: isFallback,
        }
      )
    }
    const result: AgentRunError = { ok: false, errorCode: resolved.reason, use_id: useId }
    return logAndReturn(result, {
      status:      'error_db',
      error_code:  'db_error',
      is_fallback: false,
    })
  }

  const { agent } = resolved

  // 5. Monta system prompt conforme knowledge_mode
  const knowledgeMode = agent.knowledge_mode ?? 'inline'
  const systemParts: string[] = []

  // 5a. Diretriz global de governança — sempre no TOPO, antes de tudo.
  // Injetada apenas se presente; nunca logada ou exposta.
  if (ctx.system_policy?.trim()) {
    systemParts.push(ctx.system_policy.trim() + '\n\n---\n\n')
  }

  // 5b. Prompt base do agente (sempre presente quando configurado)
  // Variáveis do contexto ({{chave}}) são substituídas antes de montar o prompt.
  if (agent.prompt?.trim()) {
    systemParts.push(substituteVariables(agent.prompt.trim(), ctx.variables))
  }

  // 5c. Base de conhecimento inline (modes: inline, hybrid)
  if (
    (knowledgeMode === 'inline' || knowledgeMode === 'hybrid') &&
    agent.knowledge_base?.trim()
  ) {
    systemParts.push(`\n\nBase de conhecimento:\n${agent.knowledge_base.trim()}`)
  }

  // 5d. Contexto RAG via retriever vetorial (modes: rag, hybrid)
  if (knowledgeMode === 'rag' || knowledgeMode === 'hybrid') {
    // A query combina a mensagem do usuário com o extra_context, pois o
    // embedding deve representar o mesmo conteúdo que será enviado ao LLM.
    const ragQuery = [ctx.userMessage, ctx.extra_context?.trim()]
      .filter(Boolean)
      .join('\n\n')

    const { contextText } = await retrieveAgentContext(
      { id: agent.id, knowledge_base_config: agent.knowledge_base_config },
      ragQuery
    )

    if (contextText) {
      systemParts.push(`\n\n${contextText}`)
    }
    // Se o retriever não retornar chunks (sem documentos, embedding falhou, etc.)
    // o runner continua normalmente sem injetar contexto RAG — sem erro.
  }

  // 5e. Contexto de execução (extra_context, ex.: tela atual para support_assistant)
  if (ctx.extra_context?.trim()) {
    systemParts.push(`\n\nContexto atual:\n${ctx.extra_context.trim()}`)
  }

  const systemPrompt = systemParts.join('').trim() || 'Você é um assistente útil.'

  // 6. Parâmetros do modelo
  const modelConfig = agent.model_config as {
    temperature?: number
    max_tokens?: number
  }

  const temperature =
    typeof modelConfig.temperature === 'number' &&
    modelConfig.temperature >= 0 &&
    modelConfig.temperature <= 2
      ? modelConfig.temperature
      : 0.7

  const maxTokens =
    typeof modelConfig.max_tokens === 'number' && modelConfig.max_tokens >= 64
      ? modelConfig.max_tokens
      : 1024

  // 7. Executa via OpenAI
  try {
    const signal = AbortSignal.timeout(openaiSettings.timeout_ms)

    const completion = await client.chat.completions.create(
      {
        model: agent.model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: 'system',  content: systemPrompt },
          { role: 'user',    content: ctx.userMessage },
        ],
      },
      { signal }
    )

    const result = completion.choices[0]?.message?.content?.trim() ?? ''

    const usage       = completion.usage
    const inputTokens  = usage?.prompt_tokens     ?? null
    const outputTokens = usage?.completion_tokens ?? null
    const totalTokens  = usage?.total_tokens      ?? null
    const estimatedCost = estimateCost(agent.model, inputTokens, outputTokens)

    return logAndReturn(
      { ok: true, result, agent_id: agent.id, use_id: useId, fallback: false, tool_results: [] },
      {
        status:            'success',
        agent_id:          agent.id,
        model:             agent.model,
        knowledge_mode:    knowledgeMode as 'none' | 'inline' | 'rag' | 'hybrid',
        is_fallback:       false,
        input_tokens:      inputTokens,
        output_tokens:     outputTokens,
        total_tokens:      totalTokens,
        estimated_cost_usd: estimatedCost,
      }
    )
  } catch {
    const isFallback = meta.fallback_mode === 'static'
    return logAndReturn(
      handleFallback(useId, meta.fallback_mode, 'openai_execution_failed'),
      {
        status:         isFallback ? 'fallback_openai_failed' : 'error_openai',
        error_code:     'openai_execution_failed',
        agent_id:       agent.id,
        model:          agent.model,
        knowledge_mode: knowledgeMode as 'none' | 'inline' | 'rag' | 'hybrid',
        is_fallback:    isFallback,
      }
    )
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function handleFallback(
  useId: string,
  fallbackMode: 'static' | 'none',
  errorCode: string
): AgentRunResult {
  if (fallbackMode === 'static') {
    return {
      ok:       true,
      result:   getStaticFallback(useId),
      agent_id: null,
      use_id:   useId,
      fallback: true,
    }
  }
  return { ok: false, errorCode, use_id: useId }
}

// ── Runner com agente pré-resolvido (agentes conversacionais) ─────────────────

/**
 * Executa um agente já resolvido externamente, bypasando o resolveAgent().
 *
 * USO EXCLUSIVO: agentes conversacionais onde o agente é determinado por
 * company_agent_assignments (multi-tenant por empresa), não por agent_use_bindings
 * (global). O caller (agentExecutor.js) é responsável pelo log completo,
 * incluindo os campos conversacionais (conversation_id, session_id, etc.)
 * que writeExecutionLog() do logger.ts não suporta.
 *
 * Reusa toda a lógica de: montagem de system prompt, knowledge_mode (inline/rag/hybrid),
 * substituição de variáveis, call OpenAI, token counting e estimativa de custo.
 *
 * NÃO chama writeExecutionLog() internamente — log é responsabilidade do caller.
 * NÃO valida VALID_USE_IDS — agente já foi validado pelo ContextBuilder.
 * NÃO usa fallback estático — sem fallback para agentes conversacionais no MVP.
 *
 * @param agent  Agente já resolvido (vem do ContextBuilderOutput.agent)
 * @param useId  Use-id para rastreabilidade de logs (não é validado aqui)
 * @param ctx    Contexto de execução (userMessage, extra_context, etc.)
 */
export async function runAgentWithConfig(
  agent: ResolvedAgent,
  useId: string,
  ctx: AgentRunContext,
  options?: { sandboxMode?: boolean }
): Promise<AgentRunResult & { input_tokens?: number | null; output_tokens?: number | null; total_tokens?: number | null; estimated_cost_usd?: number | null; sandbox_tool_events?: SandboxToolEvent[] }> {
  // Verifica disponibilidade da OpenAI (mesma lógica do runAgent)
  if (!isOpenAIApiKeyConfigured()) {
    return { ok: false, errorCode: 'openai_not_configured', use_id: useId }
  }

  const openaiSettings = await fetchParentOpenAISettingsForSystem()
  if (!openaiSettings.enabled) {
    return { ok: false, errorCode: 'openai_disabled', use_id: useId }
  }

  const client = getOpenAIClient()
  if (!client) {
    return { ok: false, errorCode: 'openai_client_null', use_id: useId }
  }

  // Monta system prompt conforme knowledge_mode (lógica extraída do runAgent)
  const knowledgeMode = agent.knowledge_mode ?? 'inline'
  const systemParts: string[] = []

  // [1] Diretriz global de governança — sempre no TOPO, antes de tudo.
  // Injetada apenas se presente; nunca logada ou exposta.
  if (ctx.system_policy?.trim()) {
    systemParts.push(ctx.system_policy.trim() + '\n\n---\n\n')
  }

  // [2] Prompt base do agente com substituição de variáveis ({{chave}})
  if (agent.prompt?.trim()) {
    systemParts.push(substituteVariables(agent.prompt.trim(), ctx.variables))
  }

  // [3] Base de conhecimento inline (modes: inline, hybrid)
  if (
    (knowledgeMode === 'inline' || knowledgeMode === 'hybrid') &&
    agent.knowledge_base?.trim()
  ) {
    systemParts.push(`\n\nBase de conhecimento:\n${agent.knowledge_base.trim()}`)
  }

  // [4] Contexto RAG via retriever vetorial (modes: rag, hybrid)
  if (knowledgeMode === 'rag' || knowledgeMode === 'hybrid') {
    const ragQuery = [ctx.userMessage, ctx.extra_context?.trim()]
      .filter(Boolean)
      .join('\n\n')

    const { contextText } = await retrieveAgentContext(
      { id: agent.id, knowledge_base_config: agent.knowledge_base_config },
      ragQuery
    )

    if (contextText) {
      systemParts.push(`\n\n${contextText}`)
    }
  }

  // [5] Contexto de execução (histórico, contato, catálogo — montado pelo agentExecutor)
  if (ctx.extra_context?.trim()) {
    systemParts.push(`\n\nContexto atual:\n${ctx.extra_context.trim()}`)
  }

  const systemPrompt = systemParts.join('').trim() || 'Você é um assistente útil.'

  // Parâmetros do modelo
  const modelConfig = agent.model_config as { temperature?: number; max_tokens?: number }

  const temperature =
    typeof modelConfig.temperature === 'number' &&
    modelConfig.temperature >= 0 &&
    modelConfig.temperature <= 2
      ? modelConfig.temperature
      : 0.7

  const maxTokens =
    typeof modelConfig.max_tokens === 'number' && modelConfig.max_tokens >= 64
      ? modelConfig.max_tokens
      : 1024

  // Declara tools filtradas pela allowlist do agente
  const agentAllowedTools: string[] = Array.isArray(agent.allowed_tools) ? agent.allowed_tools : []
  const toolDefinitions = getToolsForAgent(agentAllowedTools)
  const hasTools = toolDefinitions.length > 0


  // Executa via OpenAI
  try {
    const signal = AbortSignal.timeout(openaiSettings.timeout_ms)

    const firstMessages: Parameters<typeof client.chat.completions.create>[0]['messages'] = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: ctx.userMessage },
    ]

    const firstCompletion = await client.chat.completions.create(
      {
        model:        agent.model,
        temperature,
        max_tokens:   maxTokens,
        messages:     firstMessages,
        ...(hasTools ? { tools: toolDefinitions as any, tool_choice: 'auto' } : {}),
      },
      { signal }
    )

    const firstChoice = firstCompletion.choices[0]
    const toolCalls   = firstChoice?.message?.tool_calls ?? []

    let finalResult = firstChoice?.message?.content?.trim() ?? ''
    let totalInputTokens  = firstCompletion.usage?.prompt_tokens     ?? null
    let totalOutputTokens = firstCompletion.usage?.completion_tokens ?? null
    let totalTokensCount  = firstCompletion.usage?.total_tokens      ?? null
    // Hoistado para o escopo do try — acessível no return final
    let toolResults: ToolCallResult[] = []
    let sandboxToolEvents: SandboxToolEvent[] | undefined = undefined

    // Se o LLM retornou tool calls, executa e faz second turn
    if (hasTools && toolCalls.length > 0) {
      const toolContext = {
        company_id:            ctx.company_id ?? '',
        lead_id:               ctx.lead_id ?? null,
        conversation_id:       ctx.conversation_id ?? '',
        agent_id:              agent.id,
        locked_opportunity_id: ctx.locked_opportunity_id ?? null,
        allowed_tools:         agentAllowedTools,
        item_of_interest:      ctx.item_of_interest ?? null,
        model_config:          (agent.model_config as Record<string, unknown> | undefined) ?? ctx.model_config ?? {},
      }

      if (options?.sandboxMode) {
        // Guard duplo: sandbox_mode bloqueia todos os efeitos reais
        const sandboxResult = await executeToolCallsSandbox(toolCalls as any, toolContext)
        toolResults        = sandboxResult.toolResults as ToolCallResult[]
        sandboxToolEvents  = sandboxResult.events
      } else {
        toolResults = (await executeToolCalls(toolCalls as any, toolContext)) as ToolCallResult[]
      }

      // Monta mensagens para o second turn
      const toolResultMessages: Parameters<typeof client.chat.completions.create>[0]['messages'] = [
        firstChoice.message as any,
        ...toolResults.map(tr => ({
          role:         'tool' as const,
          tool_call_id: tr.tool_call_id,
          content:      JSON.stringify(tr.result),
        })),
      ]

      // Verifica se alguma tool crítica falhou
      const criticalFailed = toolResults.some(tr => tr.is_critical && !tr.success)

      // Second turn: LLM gera resposta final com base nos resultados das tools
      const secondSignal = AbortSignal.timeout(openaiSettings.timeout_ms)
      const secondCompletion = await client.chat.completions.create(
        {
          model:       agent.model,
          temperature,
          max_tokens:  maxTokens,
          messages: [
            ...firstMessages,
            ...toolResultMessages,
          ],
        },
        { signal: secondSignal }
      )

      const secondChoice = secondCompletion.choices[0]
      finalResult = secondChoice?.message?.content?.trim() ?? ''

      // Acumula tokens dos dois turns
      totalInputTokens  = (totalInputTokens  ?? 0) + (secondCompletion.usage?.prompt_tokens     ?? 0)
      totalOutputTokens = (totalOutputTokens ?? 0) + (secondCompletion.usage?.completion_tokens ?? 0)
      totalTokensCount  = (totalTokensCount  ?? 0) + (secondCompletion.usage?.total_tokens      ?? 0)

      if (criticalFailed) {
        console.warn('[RUNNER] Second turn gerado após falha em tool crítica', {
          agent_id: agent.id,
          failed_tools: toolResults.filter(tr => tr.is_critical && !tr.success).map(tr => tr.tool_name),
        })
      }
    }

    const estimatedCost = estimateCost(agent.model, totalInputTokens, totalOutputTokens)

    return {
      ok:                  true,
      result:              finalResult,
      agent_id:            agent.id,
      use_id:              useId,
      fallback:            false,
      // Resultados das tools executadas — usados pelo agentExecutor para evaluateTransition
      tool_results:        toolResults as ToolCallResult[],
      // Presente apenas em sandbox_mode — undefined em execuções reais
      sandbox_tool_events: sandboxToolEvents,
      input_tokens:        totalInputTokens,
      output_tokens:       totalOutputTokens,
      total_tokens:        totalTokensCount,
      estimated_cost_usd:  estimatedCost,
    }
  } catch {
    return { ok: false, errorCode: 'openai_execution_failed', use_id: useId }
  }
}
