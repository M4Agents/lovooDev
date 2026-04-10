// =============================================================================
// api/lib/agents/flowOrchestrator.js
//
// FlowOrchestrator — Orquestrador de fluxo entre agentes IA.
//
// RESPONSABILIDADE:
//   Avaliar condições de transição de estágio em conversation_flow_states
//   após cada mensagem processada e avançar o fluxo quando necessário.
//   Também fornece o agent_id do estágio atual para o conversationRouter.
//
// FLUXO:
//   1. resolveFlowAgent(conversationId, companyId)
//      → retorna { agent_id, flow_state_id } se conversa tem fluxo ativo
//      → retorna null se não há fluxo ativo (router usa agent_routing_rules)
//
//   2. evaluateTransition(conversationId, companyId, toolResults, context)
//      → avalia condições do estágio atual
//      → se satisfeita: UPDATE conversation_flow_states.current_stage_id
//      → se estágio não encontrado: marca como 'abandoned', log de aviso
//
// CONDIÇÕES DE TRANSIÇÃO SUPORTADAS:
//   - lead_field:        campo do lead no banco (ex: status = 'qualified')
//   - tag:               tag adicionada ao lead
//   - message_count:     número de mensagens na sessão (de variables.message_count)
//   - opportunity_stage: stage_id da oportunidade ativa
//   - tool_called:       tool específica foi executada com sucesso
//   - schedule_created:  tool schedule_contact foi executada com sucesso
//
// GOVERNANÇA DE variables:
//   Schema explícito. Campos fora do contrato são rejeitados.
//   Máximo 2KB. Sem truncagem — rejeita se exceder.
//
// SEGURANÇA:
//   company_id obrigatório em toda query.
//   flowOrchestrator nunca confia em dados vindos do LLM.
// =============================================================================

import { createClient } from '@supabase/supabase-js'

// ── Constantes ────────────────────────────────────────────────────────────────

const VARIABLES_MAX_BYTES = 2048

/** Schema de campos permitidos em variables e quem pode escrever cada um */
const VARIABLES_ALLOWED_FIELDS = new Set([
  'message_count',           // flowOrchestrator
  'tool_calls_count',        // toolExecutor (via flowOrchestrator)
  'qualification_score',     // toolExecutor
  'is_qualified',            // flowOrchestrator / toolExecutor
  'activity_created',        // toolExecutor
  'handoff_requested',       // toolExecutor
  'current_stage_entered_at', // flowOrchestrator
  'previous_stage_id',       // flowOrchestrator
  'entry_message_id',        // flowOrchestrator
])

/** Tools cuja chamada bem-sucedida pode disparar transição */
const TRANSITION_TRIGGER_TOOLS = new Set([
  'update_lead',
  'add_tag',
  'create_activity',
  'request_handoff',
  'schedule_contact',
])

// ── Cliente service_role ──────────────────────────────────────────────────────

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ── Governança de variables ───────────────────────────────────────────────────

/**
 * Valida e mescla novas variáveis no estado atual.
 * Rejeita campos fora do schema. Rejeita se exceder 2KB.
 * @returns {{ ok: boolean, variables?: object, error?: string }}
 */
function mergeVariables(currentVariables, updates) {
  const merged = { ...currentVariables }

  for (const [key, value] of Object.entries(updates)) {
    if (!VARIABLES_ALLOWED_FIELDS.has(key)) {
      console.warn(`[FLOW] Campo de variável rejeitado (fora do schema): ${key}`)
      continue
    }
    merged[key] = value
  }

  const serialized = JSON.stringify(merged)
  if (Buffer.byteLength(serialized, 'utf8') > VARIABLES_MAX_BYTES) {
    return {
      ok: false,
      error: `variables excede limite de ${VARIABLES_MAX_BYTES} bytes após atualização`,
    }
  }

  return { ok: true, variables: merged }
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Retorna o agent_id do estágio atual do fluxo para esta conversa.
 * Chamado pelo conversationRouter para determinar qual agente usar.
 *
 * @param {string} conversationId
 * @param {string} companyId
 * @returns {Promise<{ agent_id: string, flow_state_id: string, locked_opportunity_id: string|null } | null>}
 */
export async function resolveFlowAgent(conversationId, companyId) {
  const svc = getServiceSupabase()
  if (!svc) return null

  const { data: flowState } = await svc
    .from('conversation_flow_states')
    .select('id, current_stage_id, flow_definition_id, locked_opportunity_id, variables')
    .eq('conversation_id', conversationId)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .maybeSingle()

  if (!flowState) return null

  const { data: flowDef } = await svc
    .from('agent_flow_definitions')
    .select('id, stages, is_active')
    .eq('id', flowState.flow_definition_id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (!flowDef?.is_active) return null

  const stages = Array.isArray(flowDef.stages) ? flowDef.stages : []
  const currentStage = stages.find(s => s.id === flowState.current_stage_id)

  if (!currentStage?.agent_id) {
    console.warn('[FLOW] Estágio atual sem agent_id configurado:', flowState.current_stage_id)
    return null
  }

  return {
    agent_id:              currentStage.agent_id,
    flow_state_id:         flowState.id,
    locked_opportunity_id: flowState.locked_opportunity_id ?? null,
    variables:             flowState.variables ?? {},
  }
}

/**
 * Avalia condições de transição após uma mensagem ser processada.
 * Se condição satisfeita, avança para o próximo estágio.
 *
 * @param {string} conversationId
 * @param {string} companyId
 * @param {Array<{ tool_name: string, success: boolean, is_critical: boolean }>} toolResults
 * @param {{ lead_id: string | null }} context
 */
export async function evaluateTransition(conversationId, companyId, toolResults, context) {
  const svc = getServiceSupabase()
  if (!svc) return

  const { data: flowState } = await svc
    .from('conversation_flow_states')
    .select('id, current_stage_id, flow_definition_id, variables, locked_opportunity_id')
    .eq('conversation_id', conversationId)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .maybeSingle()

  if (!flowState) return

  const { data: flowDef } = await svc
    .from('agent_flow_definitions')
    .select('stages')
    .eq('id', flowState.flow_definition_id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (!flowDef) return

  const stages = Array.isArray(flowDef.stages) ? flowDef.stages : []
  const currentStage = stages.find(s => s.id === flowState.current_stage_id)

  if (!currentStage) {
    console.warn('[FLOW] Estágio atual não encontrado no flow definition — abandonando:', flowState.current_stage_id)
    await svc
      .from('conversation_flow_states')
      .update({ status: 'abandoned', completed_at: new Date().toISOString() })
      .eq('id', flowState.id)
    return
  }

  const conditions = Array.isArray(currentStage.transition_conditions) ? currentStage.transition_conditions : []

  // Incrementa message_count nas variables
  const currentVars  = flowState.variables ?? {}
  const newVarsMerge = mergeVariables(currentVars, {
    message_count: (currentVars.message_count ?? 0) + 1,
  })

  if (!newVarsMerge.ok) {
    console.warn('[FLOW] Erro ao atualizar variables:', newVarsMerge.error)
  }

  let updatedVariables = newVarsMerge.ok ? newVarsMerge.variables : currentVars

  // Avalia cada condição — para na primeira satisfeita
  for (const condition of conditions) {
    const satisfied = await evaluateCondition(svc, condition, {
      companyId,
      leadId:    context.lead_id,
      variables: updatedVariables,
      toolResults,
      lockedOpportunityId: flowState.locked_opportunity_id,
    })

    if (!satisfied) continue

    const nextStageId = condition.next_stage
    const nextStage   = stages.find(s => s.id === nextStageId)

    if (!nextStage) {
      console.warn(`[FLOW] next_stage '${nextStageId}' não encontrado no flow definition`)
      break
    }

    // Avança para o próximo estágio
    const varsMerge = mergeVariables(updatedVariables, {
      previous_stage_id:        flowState.current_stage_id,
      current_stage_entered_at: new Date().toISOString(),
    })

    const finalVariables = varsMerge.ok ? varsMerge.variables : updatedVariables

    await svc
      .from('conversation_flow_states')
      .update({
        current_stage_id: nextStageId,
        variables:        finalVariables,
      })
      .eq('id', flowState.id)

    console.log(`[FLOW] ✅ Transição: ${flowState.current_stage_id} → ${nextStageId} (condição: ${condition.type})`)
    return
  }

  // Sem transição: apenas atualiza variables com message_count
  if (newVarsMerge.ok) {
    await svc
      .from('conversation_flow_states')
      .update({ variables: updatedVariables })
      .eq('id', flowState.id)
  }
}

/**
 * Trava a oportunidade ativa na conversation_flow_states.
 * Chamado pelo toolExecutor na primeira tool que precisar de opportunity_id.
 *
 * @param {string} conversationId
 * @param {string} companyId
 * @param {string} opportunityId - já validado pelo toolExecutor (ownership ok)
 */
export async function lockOpportunity(conversationId, companyId, opportunityId) {
  const svc = getServiceSupabase()
  if (!svc) return

  const { error } = await svc
    .from('conversation_flow_states')
    .update({ locked_opportunity_id: opportunityId })
    .eq('conversation_id', conversationId)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .is('locked_opportunity_id', null) // só trava se ainda não travado

  if (error) {
    console.error('[FLOW] Erro ao travar opportunity_id:', error.message)
  }
}

// ── Avaliadores de condição ───────────────────────────────────────────────────

async function evaluateCondition(svc, condition, ctx) {
  const { type } = condition

  switch (type) {
    case 'lead_field':
      return evaluateLeadField(svc, condition, ctx)

    case 'tag':
      return evaluateTag(svc, condition, ctx)

    case 'message_count':
      return evaluateMessageCount(condition, ctx)

    case 'opportunity_stage':
      return evaluateOpportunityStage(svc, condition, ctx)

    case 'tool_called':
      return evaluateToolCalled(condition, ctx)

    case 'schedule_created':
      return evaluateScheduleCreated(ctx)

    default:
      console.warn(`[FLOW] Tipo de condição não suportado: ${type}`)
      return false
  }
}

async function evaluateLeadField(svc, condition, ctx) {
  if (!ctx.leadId) return false

  const { data: lead } = await svc
    .from('leads')
    .select(condition.field)
    .eq('id', ctx.leadId)
    .eq('company_id', ctx.companyId)
    .maybeSingle()

  if (!lead) return false

  const value = lead[condition.field]
  const { operator = 'eq', value: expected } = condition

  switch (operator) {
    case 'eq':  return value === expected
    case 'neq': return value !== expected
    case 'gt':  return value > expected
    case 'gte': return value >= expected
    case 'lt':  return value < expected
    case 'lte': return value <= expected
    default:    return false
  }
}

async function evaluateTag(svc, condition, ctx) {
  if (!ctx.leadId) return false

  const { data: tag } = await svc
    .from('tags')
    .select('id')
    .eq('company_id', ctx.companyId)
    .ilike('name', condition.value)
    .maybeSingle()

  if (!tag) return false

  const { data: leadTag } = await svc
    .from('lead_tags')
    .select('tag_id')
    .eq('lead_id', ctx.leadId)
    .eq('tag_id', tag.id)
    .maybeSingle()

  return !!leadTag
}

function evaluateMessageCount(condition, ctx) {
  const count    = ctx.variables?.message_count ?? 0
  const expected = condition.value ?? 0
  const operator = condition.operator ?? 'gte'

  switch (operator) {
    case 'eq':  return count === expected
    case 'gte': return count >= expected
    case 'gt':  return count > expected
    case 'lte': return count <= expected
    case 'lt':  return count < expected
    default:    return false
  }
}

async function evaluateOpportunityStage(svc, condition, ctx) {
  const opportunityId = ctx.lockedOpportunityId
  if (!opportunityId) return false

  const { data: opp } = await svc
    .from('opportunities')
    .select('stage_id')
    .eq('id', opportunityId)
    .eq('company_id', ctx.companyId)
    .maybeSingle()

  return opp?.stage_id === condition.stage_id
}

function evaluateToolCalled(condition, ctx) {
  const toolName = condition.tool

  // Rejeita condições sem tool específica (evita transições acidentais)
  if (!toolName || !TRANSITION_TRIGGER_TOOLS.has(toolName)) {
    console.warn(`[FLOW] Condição tool_called rejeitada: tool '${toolName}' não é uma tool de transição válida`)
    return false
  }

  return ctx.toolResults.some(tr => tr.tool_name === toolName && tr.success)
}

function evaluateScheduleCreated(ctx) {
  return ctx.toolResults.some(tr => tr.tool_name === 'schedule_contact' && tr.success)
}
