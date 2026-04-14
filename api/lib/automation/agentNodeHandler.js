// @ts-check
/**
 * agentNodeHandler.js
 *
 * Executa o nó `execute_agent` no motor de automação backend.
 * Reutiliza runAgentWithConfig() (runner.ts) sem criar novo pipeline LLM.
 *
 * Contrato de retorno (estruturado, nunca lança — exceto quando onError === 'stop'):
 *   { executed: true,  agentId, agentName, result_preview, full_result_length,
 *     variable_saved, truncated, fallback, input_tokens, output_tokens,
 *     estimated_cost_usd, duration_ms }
 *   { skipped: true, reason: '<motivo legível>' }
 *
 * Regras de segurança:
 *   - Tools desabilitadas na v1 (allowed_tools: [])
 *   - Output nunca salvo completo em logs — apenas preview de 200 chars
 *   - Variáveis sanitizadas antes de entrar no prompt (trim + truncar)
 *   - Isolamento multi-tenant: agente resolvido por id + company_id
 */

'use strict'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const VARIABLE_NAME_RE   = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const VARIABLE_NAME_MAX  = 64
const OUTPUT_MAX_LEN     = 10_000
const OUTPUT_PREVIEW_LEN = 200
const VAR_VALUE_MAX_LEN  = 500

// ---------------------------------------------------------------------------
// substituteVariables — reimplementada localmente (runner.ts não exporta)
// ---------------------------------------------------------------------------

/**
 * Substitui tokens {{chave}} no texto pelos valores do mapa.
 * Tokens sem correspondência são mantidos literalmente.
 *
 * @param {string} text
 * @param {Record<string, string>} variables
 * @returns {string}
 */
function substituteVariables(text, variables) {
  if (!variables || Object.keys(variables).length === 0) return text
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`)
}

// ---------------------------------------------------------------------------
// sanitizeVariables — limita valores antes de injetar no prompt
// ---------------------------------------------------------------------------

/**
 * Converte todos os valores para string, remove espaços extremos e limita
 * em VAR_VALUE_MAX_LEN caracteres para reduzir superfície de prompt injection.
 *
 * @param {Record<string, any>} vars
 * @returns {Record<string, string>}
 */
function sanitizeVariables(vars) {
  const result = {}
  for (const key in (vars || {})) {
    let val = vars[key]
    if (val === null || val === undefined) val = ''
    else if (typeof val !== 'string') val = String(val)
    result[key] = val.trim().slice(0, VAR_VALUE_MAX_LEN)
  }
  return result
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

/**
 * Executa o nó execute_agent dentro do motor de automação.
 *
 * @param {object} node     - Nó do flow (shape React Flow)
 * @param {object} context  - AutomationContext corrente
 * @param {object} supabase - Cliente Supabase Admin (service_role)
 * @returns {Promise<object>}
 */
export async function executeAgentNode(node, context, supabase) {
  const config = node?.data?.config ?? {}

  // ----------------------------------------------------------------
  // A. Validar campos obrigatórios de config
  // ----------------------------------------------------------------
  if (!config.agentId || typeof config.agentId !== 'string' || !config.agentId.trim()) {
    return { skipped: true, reason: 'config.agentId ausente no nó execute_agent' }
  }

  if (!config.promptTemplate || typeof config.promptTemplate !== 'string' || !config.promptTemplate.trim()) {
    return { skipped: true, reason: 'config.promptTemplate ausente no nó execute_agent' }
  }

  if (!config.saveToVariable || typeof config.saveToVariable !== 'string') {
    return { skipped: true, reason: 'config.saveToVariable ausente no nó execute_agent' }
  }

  // ----------------------------------------------------------------
  // B. Validar saveToVariable — nome de variável seguro
  // ----------------------------------------------------------------
  const varName = config.saveToVariable.trim().slice(0, VARIABLE_NAME_MAX)

  if (!VARIABLE_NAME_RE.test(varName)) {
    return {
      skipped: true,
      reason: `saveToVariable inválido: "${varName}" — use apenas letras, números e underscores, começando com letra ou _`,
    }
  }

  // ----------------------------------------------------------------
  // C. Validar context obrigatório
  // ----------------------------------------------------------------
  if (!context?.companyId) {
    return { skipped: true, reason: 'context.companyId ausente — execute_agent não pode ser executado' }
  }

  if (!context?.executionId) {
    return { skipped: true, reason: 'context.executionId ausente — execute_agent não pode ser executado' }
  }

  // ----------------------------------------------------------------
  // D. Resolver agente com isolamento multi-tenant
  //    Não usar resolveAgent() — este usa use_id/bindings global.
  //    Aqui o agente é selecionado diretamente pelo usuário (por ID).
  // ----------------------------------------------------------------
  const { data: agentRow, error: agentErr } = await supabase
    .from('lovoo_agents')
    .select('id, name, prompt, knowledge_base, knowledge_mode, knowledge_base_config, model, model_config, allowed_tools')
    .eq('id', config.agentId)
    .eq('company_id', context.companyId)
    .eq('is_active', true)
    .maybeSingle()

  if (agentErr) {
    console.error('[agentNodeHandler] erro ao resolver agente:', agentErr.message)
    return { skipped: true, reason: 'erro ao buscar agente no banco' }
  }

  if (!agentRow) {
    return { skipped: true, reason: `agente não encontrado ou inativo (id: ${config.agentId})` }
  }

  // ----------------------------------------------------------------
  // E. Sanitizar variáveis e renderizar prompt
  // ----------------------------------------------------------------
  const safeVars = sanitizeVariables(context.variables)

  const renderedPrompt = substituteVariables(config.promptTemplate.trim(), safeVars)

  // ----------------------------------------------------------------
  // F. Montar AgentRunContext
  // ----------------------------------------------------------------
  const agentCtx = {
    userMessage:     renderedPrompt,
    company_id:      context.companyId,
    lead_id:         context.leadId          ?? null,
    conversation_id: context.conversationId  ?? null,
    channel:         'automation',
    variables:       safeVars,
    user_id:         null,
  }

  // ----------------------------------------------------------------
  // G. Chamar runner — tools DESABILITADAS na v1
  //    runAgentWithConfig(agent, useId, ctx)
  //    Override de allowed_tools para [] evita function calling.
  // ----------------------------------------------------------------
  const { runAgentWithConfig } = await import('../agents/runner.js')

  const agentForRun = { ...agentRow, allowed_tools: [] }

  const startMs = Date.now()
  let runResult

  try {
    runResult = await runAgentWithConfig(
      agentForRun,
      'automation:execute_agent:v1',
      agentCtx,
    )
  } catch (err) {
    console.error('[agentNodeHandler] runAgentWithConfig lançou exceção inesperada:', err?.message)
    if (config.onError === 'stop') {
      throw new Error(`execute_agent falhou: ${err?.message ?? 'erro desconhecido'}`)
    }
    return {
      executed:    false,
      skipped:     true,
      reason:      'agent_exception',
      error:       err?.message ?? 'erro desconhecido',
      duration_ms: Date.now() - startMs,
    }
  }

  const durationMs = Date.now() - startMs

  // ----------------------------------------------------------------
  // H. Tratar ok: false do runner (OpenAI indisponível, config inválida)
  // ----------------------------------------------------------------
  if (!runResult?.ok) {
    console.warn('[agentNodeHandler] runner retornou ok: false —', runResult?.errorCode)
    if (config.onError === 'stop') {
      throw new Error(`execute_agent falhou: ${runResult?.errorCode ?? 'erro desconhecido'}`)
    }
    return {
      executed:    false,
      skipped:     true,
      reason:      'agent_error',
      error_code:  runResult?.errorCode ?? null,
      duration_ms: durationMs,
    }
  }

  // ----------------------------------------------------------------
  // I. Extrair e limitar output
  //    runAgentWithConfig retorna `result` (campo string), não `text`
  // ----------------------------------------------------------------
  let fullResult = runResult.result ?? ''
  let truncated  = false

  if (fullResult.length > OUTPUT_MAX_LEN) {
    fullResult = fullResult.slice(0, OUTPUT_MAX_LEN)
    truncated  = true
  }

  // ----------------------------------------------------------------
  // J. Persistir variável — memória primeiro (sincrono),
  //    banco como best-effort (async, falha não quebra execução)
  // ----------------------------------------------------------------

  // J.1 Em memória — disponível imediatamente para os nós seguintes
  context.variables[varName] = fullResult

  // J.2 No banco — garante persistência entre pause/resume
  try {
    const { error: updateErr } = await supabase
      .from('automation_executions')
      .update({ variables: context.variables })
      .eq('id', context.executionId)
      .eq('company_id', context.companyId)

    if (updateErr) {
      console.warn('[agentNodeHandler] falha ao persistir variável no banco (best-effort):', updateErr.message)
    }
  } catch (dbErr) {
    console.warn('[agentNodeHandler] exceção ao persistir variável no banco (best-effort):', dbErr?.message)
  }

  // ----------------------------------------------------------------
  // K. Retornar output resumido — NUNCA o texto completo nos logs
  // ----------------------------------------------------------------
  return {
    executed:           true,
    agentId:            agentRow.id,
    agentName:          agentRow.name,
    result_preview:     fullResult.slice(0, OUTPUT_PREVIEW_LEN),
    full_result_length: fullResult.length,
    variable_saved:     varName,
    truncated,
    fallback:           runResult.fallback ?? false,
    input_tokens:       runResult.input_tokens        ?? null,
    output_tokens:      runResult.output_tokens       ?? null,
    estimated_cost_usd: runResult.estimated_cost_usd  ?? null,
    duration_ms:        durationMs,
  }
}
