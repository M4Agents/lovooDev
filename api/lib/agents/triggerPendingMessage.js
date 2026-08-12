// =============================================================================
// api/lib/agents/triggerPendingMessage.js
//
// Dispara o enqueue da última mensagem inbound sem resposta de uma conversa,
// para que o batch pipeline a processe. Usado exclusivamente por attachAgent
// quando respond_on_activation = true no company_agent_assignment.
//
// PROBLEMA QUE RESOLVE:
//   Quando um agente é ativado via automação (ex: opportunity.stage_changed),
//   existe um intervalo de segundos entre a chegada da mensagem do lead e a
//   ativação efetiva do agente. A mensagem do lead foi processada com
//   ai_state = ai_inactive, então o router a ignorou. Após a ativação, o
//   agente aguarda uma nova mensagem que pode nunca chegar.
//
//   Com respond_on_activation = true, este módulo verifica se há uma mensagem
//   inbound sem resposta e a enfileira via enqueueMessage para processamento
//   pelo batch pipeline (process-message-buffer cron).
//
// GARANTIAS:
//   - Fire-and-forget: chamado sem await — nunca bloqueia o attachAgent
//   - Idempotente: se já existe resposta outbound após o último inbound, aborta;
//     se a mensagem já está no buffer, enqueueMessage retorna duplicate=true
//   - Fail-safe: qualquer erro é logado mas nunca propagado para o caller
//   - Multi-tenant: todo acesso ao banco inclui company_id
//   - Respeita ai_state: verificado antes de enfileirar
//   - Guards explícitos: uazapi_message_id e instanceId devem estar presentes
//
// FLUXO:
//   1. Buscar conversa (ai_state + instance)
//   2. Buscar última mensagem inbound sem resposta subsequente
//   3. Validar uazapi_message_id e instanceId
//   4. Resolver windowSeconds do model_config do agente
//   5. Enfileirar via enqueueMessage → batch pipeline (process-message-buffer cron)
//
// LATÊNCIA CONHECIDA (V1):
//   respond_on_activation → enqueue → aguarda cron (0–60s) → batch → LLM → resposta
//   Tempo esperado com windowSeconds=30: ~40 a ~120 segundos após ativação.
//   Objetivo desta implementação: garantir entrega e eliminar falha silenciosa.
//   Otimização de latência é melhoria futura separada.
// =============================================================================

import { enqueueMessage } from './messageBufferService.js'

/**
 * Busca a última mensagem inbound da conversa que ainda não tem resposta
 * outbound após ela.
 *
 * @returns {object|null} mensagem encontrada ou null se não aplicável
 */
async function findUnansweredInbound(supabase, { companyId, conversationId }) {
  const { data: recent } = await supabase
    .from('chat_messages')
    .select('id, content, direction, created_at, uazapi_message_id, message_type')
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
 * Enfileira a última mensagem inbound sem resposta para o batch pipeline.
 *
 * Sempre chamado fire-and-forget:
 *   triggerPendingMessage({ ... }, svc).catch(err => console.error(...))
 *
 * @param {{ companyId, conversationId, assignmentId, agentId, capabilities, pricePolicy }} params
 * @param {object} supabase - cliente service_role (recebido do caller — não criar novo)
 */
export async function triggerPendingMessage(
  { companyId, conversationId, assignmentId, agentId, capabilities, pricePolicy },
  supabase
) {
  const tag = '[triggerPendingMessage]'

  // ── Validar parâmetros obrigatórios ───────────────────────────────────────
  if (!companyId || !conversationId || !assignmentId) {
    console.warn(`${tag} parâmetros obrigatórios ausentes — abortando`, {
      companyId: !!companyId,
      conversationId: !!conversationId,
      assignmentId: !!assignmentId,
    })
    return
  }

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

  console.log(`${tag} mensagem pendente encontrada — preparando enqueue`, {
    conversationId,
    messageId:   pendingMessage.id,
    preview:     (pendingMessage.content ?? '').slice(0, 60),
    assignmentId,
  })

  // ── 3. Validar dados necessários para o enqueue ───────────────────────────
  if (!pendingMessage.uazapi_message_id) {
    console.warn(`${tag} uazapi_message_id ausente — enqueue abortado`, {
      conversationId,
      messageId: pendingMessage.id,
    })
    return
  }

  const instanceId = conv.last_instance_id ?? conv.instance_id ?? null

  if (!instanceId) {
    console.warn(`${tag} instanceId ausente (last_instance_id e instance_id são null) — enqueue abortado`, {
      conversationId,
    })
    return
  }

  // ── 4. Resolver janela de agrupamento do agente ───────────────────────────
  // Busca model_config.message_grouping_window_s em lovoo_agents.
  // Filtro obrigatório por id + company_id (tenant-safe).
  // Fallback: 30s (mesmo default da UI — GROUPING_WINDOW_DEFAULT).
  let windowSeconds = 30

  if (agentId) {
    const { data: agentRow } = await supabase
      .from('lovoo_agents')
      .select('model_config')
      .eq('id', agentId)
      .eq('company_id', companyId)
      .maybeSingle()

    const rawWindow = agentRow?.model_config?.message_grouping_window_s
    if (Number.isInteger(rawWindow) && rawWindow >= 1 && rawWindow <= 120) {
      windowSeconds = rawWindow
    }
  }

  // ── 5. Enfileirar para o batch pipeline ───────────────────────────────────
  // Usa o client supabase recebido pelo caller (já é service_role).
  // Não cria novo createClient.
  // O lote será processado pelo cron process-message-buffer (a cada minuto).
  const enqueueResult = await enqueueMessage({
    svc:                     supabase,
    companyId,
    conversationId,
    assignmentId,
    channel:                 'whatsapp',
    windowSeconds,
    maxBatchDurationSeconds: 120,
    providerMessageId:       pendingMessage.uazapi_message_id,
    instanceId,
    messageText:             pendingMessage.content      ?? '',
    messageType:             pendingMessage.message_type ?? 'text',
    receivedAt:              new Date(pendingMessage.created_at),
    payload:                 {},
  })

  if (enqueueResult.duplicate) {
    console.log(`${tag} mensagem já no buffer (duplicate) — skip`, {
      conversationId,
      batchId: enqueueResult.batch_id,
    })
    return
  }

  console.log(`${tag} mensagem enfileirada com sucesso`, {
    conversationId,
    batchId:      enqueueResult.batch_id,
    messageId:    pendingMessage.id,
    windowSeconds,
  })
}
