// =============================================================================
// api/lib/agents/triggerPendingMessage.js
//
// Dispara o pipeline completo do agente para a última mensagem inbound sem
// resposta de uma conversa. Usado exclusivamente por attachAgent quando
// respond_on_activation = true no company_agent_assignment.
//
// PROBLEMA QUE RESOLVE:
//   Quando um agente é ativado via automação (ex: opportunity.stage_changed),
//   existe um intervalo de segundos entre a chegada da mensagem do lead e a
//   ativação efetiva do agente. A mensagem do lead foi processada com
//   ai_state = ai_inactive, então o router a ignorou. Após a ativação, o
//   agente aguarda uma nova mensagem que pode nunca chegar.
//
//   Com respond_on_activation = true, este módulo verifica se há uma mensagem
//   inbound sem resposta e executa o pipeline completo (LLM → envio) como se
//   a mensagem tivesse acabado de chegar.
//
// GARANTIAS:
//   - Fire-and-forget: chamado sem await — nunca bloqueia o attachAgent
//   - Idempotente: se já existe resposta outbound após o último inbound, aborta
//   - Fail-safe: qualquer erro é logado mas nunca propagado para o caller
//   - Multi-tenant: todo acesso ao banco inclui company_id
//   - Respeita ai_state: o orchestrator re-valida do banco antes de prosseguir
//
// FLUXO:
//   1. Buscar conversa (ai_state + instance)
//   2. Buscar última mensagem inbound sem resposta subsequente
//   3. Montar RouterDecision sintético
//   4. Executar pipeline: orchestrate → buildContext → executeAgent → compose → sendBlocks
// =============================================================================

import { randomUUID }            from 'crypto'
import { orchestrateExecution }  from './conversationOrchestrator.js'
import { buildContext }          from './contextBuilder.js'
import { executeAgent }          from './agentExecutor.js'
import { compose }               from './responseComposer.js'
import { sendBlocks }            from './whatsappGateway.js'

/**
 * Busca a última mensagem inbound da conversa que ainda não tem resposta
 * outbound após ela.
 *
 * @returns {object|null} - mensagem encontrada ou null se não aplicável
 */
async function findUnansweredInbound(supabase, { companyId, conversationId }) {
  const { data: recent } = await supabase
    .from('chat_messages')
    .select('id, content, direction, created_at')
    .eq('conversation_id', conversationId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (!recent || recent.length === 0) return null

  const lastInbound = recent.find(m => m.direction === 'inbound')
  if (!lastInbound) return null

  // Se existe qualquer outbound DEPOIS do último inbound → já foi respondido
  const hasOutboundAfter = recent.some(
    m => m.direction === 'outbound' && new Date(m.created_at) > new Date(lastInbound.created_at)
  )
  if (hasOutboundAfter) return null

  return lastInbound
}

/**
 * Dispara o pipeline do agente para a última mensagem inbound sem resposta.
 *
 * Sempre chamado fire-and-forget:
 *   triggerPendingMessage({ ... }, svc).catch(err => console.error(...))
 *
 * @param {{ companyId, conversationId, assignmentId, agentId, capabilities, pricePolicy }} params
 * @param {object} supabase - cliente service_role
 */
export async function triggerPendingMessage(
  { companyId, conversationId, assignmentId, agentId, capabilities, pricePolicy },
  supabase
) {
  const tag = '[triggerPendingMessage]'

  // ── 1. Revalidar conversa ─────────────────────────────────────────────────
  const { data: conv } = await supabase
    .from('chat_conversations')
    .select('id, ai_state, contact_phone, instance_id, last_instance_id')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (!conv) {
    console.warn(`${tag} conversa não encontrada — abortando`, { conversationId, companyId })
    return
  }

  if (conv.ai_state !== 'ai_active') {
    console.log(`${tag} ai_state = ${conv.ai_state} — abortando (agente não está ativo)`)
    return
  }

  // ── 2. Buscar mensagem inbound sem resposta ───────────────────────────────
  const pendingMessage = await findUnansweredInbound(supabase, { companyId, conversationId })

  if (!pendingMessage) {
    console.log(`${tag} nenhuma mensagem inbound sem resposta — abortando`, { conversationId })
    return
  }

  console.log(`${tag} mensagem pendente encontrada — disparando pipeline`, {
    conversationId,
    messageId:   pendingMessage.id,
    preview:     (pendingMessage.content ?? '').slice(0, 60),
    assignmentId
  })

  // ── 3. Montar RouterDecision sintético ────────────────────────────────────
  // O orchestrator re-valida ai_state do banco — o valor aqui é apenas
  // informativo e não é usado para decisões de segurança.
  const instanceId = conv.last_instance_id ?? conv.instance_id ?? null

  const decision = {
    should_process:       true,
    skip_reason:          null,
    // rule_id sintético: não aponta para agent_routing_rules real (activation)
    rule_id:              randomUUID(),
    assignment_id:        assignmentId,
    agent_id:             agentId,
    capabilities:         capabilities ?? {},
    price_display_policy: pricePolicy  ?? 'disabled',
    conversation: {
      id:               conv.id,
      ai_state:         conv.ai_state,
      ai_assignment_id: assignmentId,
      contact_phone:    conv.contact_phone
    },
    event: {
      event_type:        'message.received',
      channel:           'whatsapp',
      company_id:        companyId,
      instance_id:       instanceId,
      conversation_id:   conversationId,
      uazapi_message_id: null,
      source_type:       'activation_trigger',
      source_identifier: null,
      message_text:      pendingMessage.content ?? '',
      saved_message_id:  pendingMessage.id,
      timestamp:         new Date(pendingMessage.created_at).getTime()
    }
  }

  // ── 4. Executar pipeline completo ─────────────────────────────────────────

  const orchResult = await orchestrateExecution(decision)
  if (!orchResult.success) {
    console.log(`${tag} orchestrator abortou:`, orchResult.skip_reason, { conversationId })
    return
  }

  const buildResult = await buildContext(orchResult.context)
  if (!buildResult.success) {
    console.log(`${tag} contextBuilder abortou:`, buildResult.skip_reason, { conversationId })
    return
  }

  const execResult = await executeAgent(buildResult.output)
  if (!execResult.success) {
    console.log(`${tag} agentExecutor abortou:`, execResult.skip_reason, { conversationId })
    return
  }

  const composerResult = compose(execResult.output)
  if (!composerResult.success) {
    console.log(`${tag} responseComposer abortou:`, composerResult.skip_reason, { conversationId })
    return
  }

  await sendBlocks(composerResult.output)

  console.log(`${tag} pipeline concluído com sucesso`, {
    conversationId,
    blocks: composerResult.output?.blocks?.length ?? 0
  })
}
