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
import { resolveAgent } from './resolver.js'
import { getUseMeta, VALID_USE_IDS } from './uses.js'
import { retrieveAgentContext } from './retriever.js'
import { writeExecutionLog, type ExecutionLogEntry } from './logger.js'
import { estimateCost } from './pricing.js'

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
}

export type AgentRunSuccess = {
  ok: true
  result: string
  agent_id: string
  use_id: string
  fallback: false
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

  // 5a. Prompt base do agente (sempre presente quando configurado)
  // Variáveis do contexto ({{chave}}) são substituídas antes de montar o prompt.
  if (agent.prompt?.trim()) {
    systemParts.push(substituteVariables(agent.prompt.trim(), ctx.variables))
  }

  // 5b. Base de conhecimento inline (modes: inline, hybrid)
  if (
    (knowledgeMode === 'inline' || knowledgeMode === 'hybrid') &&
    agent.knowledge_base?.trim()
  ) {
    systemParts.push(`\n\nBase de conhecimento:\n${agent.knowledge_base.trim()}`)
  }

  // 5c. Contexto RAG via retriever vetorial (modes: rag, hybrid)
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

  // 5d. Contexto de execução (extra_context, ex.: tela atual para support_assistant)
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
      { ok: true, result, agent_id: agent.id, use_id: useId, fallback: false },
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
