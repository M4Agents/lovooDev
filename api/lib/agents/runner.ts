// =====================================================
// Runner de agentes — orquestração da execução via OpenAI.
//
// Responsabilidade:
//   1. Validar use_id e regras de segurança (requires_context)
//   2. Resolver o agente vinculado ao uso
//   3. Executar via OpenAI com o prompt configurado
//   4. Retornar fallback se não houver agente ou OpenAI indisponível
//
// Features NÃO devem chamar OpenAI diretamente — devem usar runAgent().
// Nunca importar no frontend — server-side exclusivo.
// =====================================================

import { getOpenAIClient } from '../openai/client.js'
import { fetchParentOpenAISettingsForSystem } from '../openai/settingsDb.js'
import { isOpenAIApiKeyConfigured } from '../openai/config.js'
import { resolveAgent } from './resolver.js'
import { getUseMeta, VALID_USE_IDS } from './uses.js'

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
 */
export async function runAgent(
  useId: string,
  ctx: AgentRunContext
): Promise<AgentRunResult> {
  // 1. Valida use_id
  if (!VALID_USE_IDS.has(useId)) {
    return { ok: false, errorCode: 'invalid_use_id', use_id: useId }
  }

  // 2. Regras de segurança por uso
  const meta = getUseMeta(useId)

  if (meta.requires_context && !ctx.extra_context?.trim()) {
    return { ok: false, errorCode: 'missing_required_context', use_id: useId }
  }

  // 3. Verifica disponibilidade OpenAI
  if (!isOpenAIApiKeyConfigured()) {
    return handleFallback(useId, meta.fallback_mode, 'openai_not_configured')
  }

  const openaiSettings = await fetchParentOpenAISettingsForSystem()
  if (!openaiSettings.enabled) {
    return handleFallback(useId, meta.fallback_mode, 'openai_disabled')
  }

  const client = getOpenAIClient()
  if (!client) {
    return handleFallback(useId, meta.fallback_mode, 'openai_client_null')
  }

  // 4. Resolve agente
  const resolved = await resolveAgent(useId)

  if (!resolved.found) {
    if (resolved.reason === 'no_binding' || resolved.reason === 'agent_inactive') {
      return handleFallback(useId, meta.fallback_mode, resolved.reason)
    }
    return { ok: false, errorCode: resolved.reason, use_id: useId }
  }

  const { agent } = resolved

  // 5. Monta system prompt
  const systemParts: string[] = []

  if (agent.prompt?.trim()) {
    systemParts.push(agent.prompt.trim())
  }

  if (agent.knowledge_base?.trim()) {
    systemParts.push(`\n\nBase de conhecimento:\n${agent.knowledge_base.trim()}`)
  }

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

    return {
      ok:       true,
      result,
      agent_id: agent.id,
      use_id:   useId,
      fallback: false,
    }
  } catch {
    return handleFallback(useId, meta.fallback_mode, 'openai_execution_failed')
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
