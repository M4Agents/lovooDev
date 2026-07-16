// =====================================================
// EXECUTOR — núcleo mínimo de execução de flows
// Etapa 7: lock de execução via executionLock.js
//        + user_input + delay + action + condition + message + logs
//
// Suportado:   start, trigger, end, message, condition, action, delay, user_input, distribution
//
// Todas as funções recebem `supabase` (supabaseAdmin)
// como parâmetro — sem importar nada de src/.
// =====================================================

import { acquireLock, releaseLock } from './executionLock.js'
import { getPlanLimits, checkLimit }  from '../plans/limitChecker.js'

// ---------------------------------------------------------------------------
// Resolução de instanceId — fonte única para processFlowAsync e resumeFromNode
//
// Prioridade:
//   1. trigger_data.instance_id  (snake_case — padrão dos dispatchers atuais)
//   2. trigger_data.instanceId   (camelCase  — compatibilidade legado)
//   3. triggerNode config        (config do nó trigger do flow — fallback estático)
// ---------------------------------------------------------------------------

function resolveInstanceId(execution, triggerNode) {
  return (
    execution.trigger_data?.instance_id
    ?? execution.trigger_data?.instanceId
    ?? triggerNode?.data?.triggers?.find(t => t.enabled)?.config?.instanceId
    ?? null
  )
}

// ---------------------------------------------------------------------------
// Validação defensiva do context
//
// Não lança exception — apenas loga e retorna false para que o caller
// possa encerrar a execução de forma controlada sem crashar a Lambda.
// ---------------------------------------------------------------------------

function assertContext(context) {
  const required = ['executionId', 'flowId', 'companyId', 'triggerData', 'variables']
  for (const field of required) {
    if (context[field] === undefined || context[field] === null) {
      console.error('[executor][context inválido] campo obrigatório ausente:', field, {
        executionId:   context.executionId,
        flowId:        context.flowId,
        companyId:     context.companyId,
        missingField:  field,
      })
      return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Registro de estado
// ---------------------------------------------------------------------------

async function createLog(context, node, status, output, errorMessage, supabase) {
  try {
    await supabase.from('automation_logs').insert({
      execution_id:  context.executionId,
      flow_id:       context.flowId,
      company_id:    context.companyId,
      node_id:       node.id,
      node_type:     node.type,
      action:        node.data?.label || node.type,
      status,
      input_data:    node.data?.config ?? null,
      output_data:   output ?? null,
      error_message: errorMessage ?? null,
      executed_at:   new Date().toISOString(),
    })
  } catch (err) {
    // Não crashar a execução por falha de log
    console.error('[executor] createLog falhou:', err?.message)
  }
}

async function updateExecutedNodes(executionId, nodeId, status, output, errorMessage, supabase) {
  try {
    const { data: execution } = await supabase
      .from('automation_executions')
      .select('executed_nodes')
      .eq('id', executionId)
      .single()

    if (!execution) return

    const executedNodes = execution.executed_nodes || []
    executedNodes.push({
      node_id:       nodeId,
      executed_at:   new Date().toISOString(),
      status,
      output:        output ?? null,
      error_message: errorMessage ?? null,
    })

    await supabase
      .from('automation_executions')
      .update({ executed_nodes: executedNodes, current_node_id: nodeId })
      .eq('id', executionId)
  } catch (err) {
    console.error('[executor] updateExecutedNodes falhou:', err?.message)
  }
}

async function completeExecution(executionId, status, errorMessage, supabase) {
  try {
    await supabase
      .from('automation_executions')
      .update({
        status,
        completed_at:  new Date().toISOString(),
        ...(errorMessage ? { error_message: errorMessage } : {}),
      })
      .eq('id', executionId)

    console.log(`[executor] execução ${status}: ${executionId}`)
  } catch (err) {
    console.error('[executor] completeExecution falhou:', err?.message)
  }
}

// ---------------------------------------------------------------------------
// Criação de execução
// ---------------------------------------------------------------------------

export async function createExecution(flow, triggerData, companyId, supabase) {
  // ── ENFORCEMENT: is_over_plan ────────────────────────────────────────────────
  // Flow marcado como excedente pelo plano não pode disparar execuções.
  // O campo is_over_plan deve ser incluído no SELECT do caller (trigger-event.ts).
  if (flow.is_over_plan === true) {
    console.warn(
      '[executor][plan_limit] flow is_over_plan=true — execução bloqueada.',
      `company=${companyId} flow=${flow.id}`
    )
    return null
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── ENFORCEMENT: max_automation_executions_monthly ──────────────────────────
  // Verifica o limite mensal de execuções ANTES de criar a execution.
  //
  // JANELA: mês calendário corrente (date_trunc baseado em UTC).
  // Decisão: mês calendário é simples, auditável e independente de billing_cycle_anchor.
  // TODO futuro: migrar para billing_cycle_anchor quando o módulo de billing estiver maduro.
  //
  // SOFT BLOCK: retorna null (mesmo comportamento de erro de INSERT).
  // O caller (dispatchLeadCreatedTrigger, trigger-event.ts) interpreta null como falha
  // e loga o evento sem crashar o flow nem perder a mensagem.
  try {
    const limits     = await getPlanLimits(supabase, companyId)
    const maxMonthly = limits.max_automation_executions_monthly ?? null

    if (maxMonthly !== null) {
      const now        = new Date()
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

      const { count: monthlyCount, error: countErr } = await supabase
        .from('automation_executions')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .gte('started_at', monthStart)

      if (countErr) {
        console.warn('[executor][plan_limit] falha ao contar execuções mensais:', countErr?.message)
      } else {
        const check = checkLimit(maxMonthly, monthlyCount ?? 0)
        if (!check.allowed) {
          console.warn(
            '[executor][plan_limit] max_automation_executions_monthly atingido — execução bloqueada.',
            `company=${companyId} flow=${flow.id} current=${check.current} max=${check.limit}`
          )
          return null
        }
      }
    }
  } catch (limitErr) {
    // Não crashar a automação por falha no check de limite
    console.error('[executor] erro ao verificar limite max_automation_executions_monthly:', limitErr?.message)
  }
  // ─────────────────────────────────────────────────────────────────────────

  try {
    const { data, error } = await supabase
      .from('automation_executions')
      .insert({
        flow_id:        flow.id,
        company_id:     companyId,
        trigger_data:   triggerData,
        lead_id:        triggerData.lead_id || triggerData.opportunity?.lead_id || null,
        opportunity_id: triggerData.opportunity_id || triggerData.opportunity?.id || null,
        status:         'running',
        variables:      triggerData.variables || {},
        executed_nodes: [],
        started_at:     new Date().toISOString(),
      })
      .select()
      .single()

    if (error) throw error
    return data
  } catch (err) {
    console.error('[executor] createExecution falhou:', err?.message)
    return null
  }
}

// ---------------------------------------------------------------------------
// Travessia do grafo
// ---------------------------------------------------------------------------

function getNextNodes(currentNode, allNodes, allEdges, result) {
  const outgoing = allEdges.filter(e => e.source === currentNode.id)
  if (outgoing.length === 0) return []

  // Condição: escolhe ramo true/false pelo resultado
  if (currentNode.type === 'condition') {
    const handle = result?.result ? 'true' : 'false'
    const edge   = outgoing.find(e => e.sourceHandle === handle)
    if (!edge) return []
    const next = allNodes.find(n => n.id === edge.target)
    return next ? [next] : []
  }

  // Roteador de palavras-chave: segue todos os handles que deram match.
  // Usa filter (não find) para suportar múltiplas edges por handle.
  // Deduplica destinos por node.id para evitar execução dupla.
  if (currentNode.type === 'keyword_router') {
    const matchedHandles = Array.isArray(result?.matchedHandles)
      ? result.matchedHandles
      : ['default']

    const seen = new Set()
    const nextNodes = []

    for (const handle of matchedHandles) {
      const edges = outgoing.filter(e => e.sourceHandle === handle)
      for (const edge of edges) {
        const next = allNodes.find(n => n.id === edge.target)
        if (next && !seen.has(next.id)) {
          seen.add(next.id)
          nextNodes.push(next)
        }
      }
    }

    return nextNodes
  }

  // Delay time_or_response: roteia por handle 'responded' ou 'timeout' conforme resumeReason.
  // result.sourceHandle é definido por _resumeFromNodeInternal antes de chamar getNextNodes.
  // Legacy delay (wait_mode ausente ou 'time') não entra neste bloco — cai no default abaixo.
  if (currentNode.type === 'delay') {
    const waitMode = currentNode.data?.config?.wait_mode
    if (waitMode === 'time_or_response') {
      const sourceHandle = result?.sourceHandle
      if (!sourceHandle) return []
      const edge = outgoing.find(e => e.sourceHandle === sourceHandle)
      if (!edge) return []
      const next = allNodes.find(n => n.id === edge.target)
      return next ? [next] : []
    }
  }

  // Demais tipos: ordenar por posição Y e retornar todos
  return outgoing
    .sort((a, b) => {
      const ya = allNodes.find(n => n.id === a.target)?.position?.y ?? 0
      const yb = allNodes.find(n => n.id === b.target)?.position?.y ?? 0
      return ya - yb
    })
    .map(e => allNodes.find(n => n.id === e.target))
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Pausa em nó user_input
// 1. Envia a pergunta ao usuário via WhatsApp (fail-safe)
// 2. Pausa a execução e salva _awaiting_input nas variables
// ---------------------------------------------------------------------------

async function pauseAtUserInput(node, context, supabase) {
  const config = node.data?.config || {}

  const variableName = config.variable    || 'user_response'
  const timeoutValue = Number(config.timeoutValue) || 24
  const timeoutUnit  = config.timeoutUnit || 'hours'
  const question     = config.question    || 'Responda esta mensagem para continuar.'

  // 1. Enviar a pergunta ao usuário via WhatsApp (antes de pausar)
  let questionSent  = false
  let questionError = null

  try {
    // Nó sintético de texto — reutiliza toda a infra de sendMessageNode
    const questionNode = {
      id:   node.id,
      type: 'message',
      data: {
        label:  node.data?.label || 'user_input',
        config: { messageType: 'text', message: question },
      },
    }

    const { sendMessageNode } = await import('./whatsappSender.js')
    const sendResult = await sendMessageNode(questionNode, context, supabase)

    if (sendResult?.sent) {
      questionSent = true
      console.log(`[executor] user_input: pergunta enviada (to: ${sendResult.to})`)
    } else {
      questionError = sendResult?.reason || 'envio retornou sem confirmação'
      console.warn(`[executor] user_input: pergunta não enviada — ${questionError}`)
    }
  } catch (sendErr) {
    questionError = sendErr?.message || 'erro desconhecido no envio'
    console.error(`[executor] user_input: erro ao enviar pergunta — ${questionError}`)
  }

  // 2. Calcular timeout_at
  const timeoutAt = new Date()
  switch (timeoutUnit) {
    case 'seconds': timeoutAt.setSeconds(timeoutAt.getSeconds() + timeoutValue); break
    case 'minutes': timeoutAt.setMinutes(timeoutAt.getMinutes() + timeoutValue); break
    case 'hours':   timeoutAt.setHours(timeoutAt.getHours()     + timeoutValue); break
    case 'days':    timeoutAt.setDate(timeoutAt.getDate()        + timeoutValue); break
    default:        timeoutAt.setHours(timeoutAt.getHours()      + timeoutValue); break
  }

  // Cópia imutável — não muta context.variables diretamente.
  // _awaiting_input é um marcador interno: persiste no banco mas nunca deve
  // entrar em context.variables em memória nem ser exposto em output_data de API.
  const nextVariables = {
    ...(context.variables || {}),
    _awaiting_input: {
      node_id:        node.id,
      variable_name:  variableName,
      question,
      timeout_value:  timeoutValue,
      timeout_unit:   timeoutUnit,
      question_sent:  questionSent,
      ...(questionError ? { question_error: questionError } : {}),
    },
  }

  // 3. Pausar execução (sempre, independente do resultado do envio)
  const { error: pauseErr } = await supabase
    .from('automation_executions')
    .update({
      status:          'paused',
      paused_at:       new Date().toISOString(),
      timeout_at:      timeoutAt.toISOString(),
      current_node_id: node.id,
      variables:       nextVariables,
    })
    .eq('id', context.executionId)

  if (pauseErr) throw new Error(`Erro ao pausar execução em user_input: ${pauseErr.message}`)

  // Não mutar context.variables: o banco é a fonte de verdade.
  // O flow para imediatamente após este retorno (processNode detecta result.paused === true).
  // Quando o flow for retomado (resumeFromNode), um context novo é construído do banco.

  console.log(`[executor] user_input: execução ${context.executionId} pausada — aguardando "${variableName}" (timeout: ${timeoutValue} ${timeoutUnit})`)

  return {
    paused:        true,
    awaitingInput: true,
    variableName,
    timeoutAt:     timeoutAt.toISOString(),
    questionSent,
    ...(questionError ? { questionError } : {}),
  }
}

/**
 * Resolve a ação de um nó.
 *
 * Suportados:
 *   start / trigger → { triggered: true }
 *   end             → { ended: true }
 *   message         → envio WhatsApp via whatsappSender.js
 *   user_input      → pausa execução aguardando resposta
 *
 * Demais tipos: { skipped: true, reason } — sem crash.
 */
async function executeNodeAction(node, context, supabase) {
  switch (node.type) {
    case 'trigger':
    case 'start':
      return { triggered: true, data: context.triggerData }

    case 'end':
      return { ended: true }

    case 'message': {
      // Nó message configurado como user_input (legado do AutomationEngine)
      if (node.data?.config?.messageType === 'user_input') {
        return await pauseAtUserInput(node, context, supabase)
      }
      const { sendMessageNode } = await import('./whatsappSender.js')
      return await sendMessageNode(node, context, supabase)
    }

    case 'user_input':
      return await pauseAtUserInput(node, context, supabase)

    case 'condition': {
      const { evaluateCondition } = await import('./conditionEval.js')
      return await evaluateCondition(node, context, supabase)
    }

    case 'action': {
      const { executeCrmAction } = await import('./crmActions.js')
      return await executeCrmAction(node, context, supabase)
    }

    case 'delay': {
      const { pauseAtDelay } = await import('./delayHandler.js')
      return await pauseAtDelay(node, context, supabase)
    }

    case 'distribution': {
      const { executeDistribution } = await import('./distributionHandler.js')
      return await executeDistribution(node, context, supabase)
    }

    case 'execute_agent': {
      const { executeAgentNode } = await import('./agentNodeHandler.js')
      return await executeAgentNode(node, context, supabase)
    }

    case 'keyword_router': {
      const { executeKeywordRouter } = await import('./keywordRouter.js')
      return await executeKeywordRouter(node, context)
    }

    default:
      console.log(`[executor] nó não suportado nesta etapa: ${node.type} (id: ${node.id}) — skipped`)
      return { skipped: true, reason: `tipo não suportado nesta etapa: ${node.type}` }
  }
}

async function processNode(node, allNodes, allEdges, context, supabase) {
  console.log(`[executor] nó: ${node.id} (${node.type})`)

  await createLog(context, node, 'started', null, null, supabase)

  try {
    const result = await executeNodeAction(node, context, supabase)

    // Nó de fim: registrar e parar a recursão
    if (result?.ended) {
      await createLog(context, node, 'success', result, null, supabase)
      await updateExecutedNodes(context.executionId, node.id, 'success', result, null, supabase)
      return
    }

    // Nó de delay pausou a execução: registrar e interromper recursão
    if (result?.paused) {
      await createLog(context, node, 'paused', result, null, supabase)
      await updateExecutedNodes(context.executionId, node.id, 'paused', result, null, supabase)
      console.log(`[executor] execução pausada no nó delay: ${node.id} — resume_at: ${result.resumeAt}`)
      return
    }

    await createLog(context, node, 'success', result, null, supabase)
    await updateExecutedNodes(context.executionId, node.id, 'success', result, null, supabase)

    const nextNodes = getNextNodes(node, allNodes, allEdges, result)
    for (const next of nextNodes) {
      await processNode(next, allNodes, allEdges, context, supabase)
    }
  } catch (err) {
    console.error(`[executor] erro no nó ${node.id}:`, err?.message)
    await createLog(context, node, 'error', null, err?.message, supabase)
    await updateExecutedNodes(context.executionId, node.id, 'error', null, err?.message, supabase)
    throw err
  }
}

// ---------------------------------------------------------------------------
// _resumeFromNodeInternal — núcleo compartilhado de retomada
//
// Dois caminhos distintos controlados por alreadyClaimed:
//
// alreadyClaimed = false (legado):
//   - exige execution.status = 'paused'
//   - trata _awaiting_input (salva userResponse, remove marcador)
//   - executa a transição paused → running no banco
//
// alreadyClaimed = true (pós-claim via claim_paused_execution_v1):
//   - a RPC já transitou para running e removeu o marcador
//   - execution.variables já reflete o estado pós-claim
//   - NÃO repete a transição paused → running
//   - NÃO remove marcador (já foi removido)
//   - SE resumeReason = 'lead_response' e claimedMarker.response_variable
//     configurado, salva userResponse nas variables (Opção A)
//   - routeia pelo handle 'responded' ou 'timeout' conforme resumeReason
//
// Em ambos os caminhos:
//   - adquire executionLock para proteção operacional adicional
//   - não cancela schedule (responsabilidade do webhook/cron)
//   - falhas após claim: marca como failed, propaga erro, não reverte para paused
// ---------------------------------------------------------------------------

async function _resumeFromNodeInternal({
  execution,
  flow,
  pausedNodeId,
  supabase,
  userResponse    = undefined,
  resumeReason    = undefined,
  awaitingType    = undefined,
  scheduleId      = undefined,
  alreadyClaimed  = false,
  claimedMarker   = null,
  preAcquiredLock = null,
}) {
  // -------------------------------------------------------------------------
  // Caminho legado: validar status = 'paused' antes de qualquer operação.
  // Caminho pós-claim: a RPC já garantiu a transição — status = 'running'.
  // -------------------------------------------------------------------------
  if (!alreadyClaimed) {
    if (execution.status !== 'paused') {
      console.warn(`[executor] resumeFromNode: execução ${execution.id} não está pausada (status: ${execution.status}) — skip`)
      return { skipped: true, reason: `execução não está pausada (status: ${execution.status})` }
    }
  }

  // -------------------------------------------------------------------------
  // Gestão do executionLock — dois caminhos:
  //
  // Caminho A — preAcquiredLock fornecido pelo caller (webhook):
  //   O caller já adquiriu o lock antes do claim para evitar o cenário
  //   "claim concluído + lock indisponível". O executor usa o lock recebido
  //   e não o libera (responsabilidade do caller no finally externo).
  //   Limitação: lockId não contém executionId — o caller deve garantir
  //   que o lock pertence à execução correta antes de chamar este método.
  //
  // Caminho B — preAcquiredLock ausente (cron e legado):
  //   O executor adquire e libera o lock internamente (comportamento atual).
  // -------------------------------------------------------------------------
  let lock
  const callerOwnedLock = preAcquiredLock !== null

  if (callerOwnedLock) {
    // Validar que o lock recebido é operacionalmente válido
    if (!preAcquiredLock.acquired || typeof preAcquiredLock.lockId !== 'string' || !preAcquiredLock.lockId) {
      throw new Error(
        `[executor] preAcquiredLock inválido para execução ${execution.id} ` +
        `— acquired=${preAcquiredLock.acquired}, lockId=${preAcquiredLock.lockId ?? 'ausente'}`
      )
    }
    lock = preAcquiredLock
    console.log(`[executor] usando lock pré-adquirido pelo caller — execução ${execution.id} (lockId: ${lock.lockId})`)
  } else {
    // Caminho B: adquirir lock internamente
    // Para alreadyClaimed=true: a claim RPC já venceu a corrida atomicamente;
    // o lock protege contra dupla entrada no processNode para a mesma execução.
    lock = await acquireLock(execution.id, supabase)
    if (!lock.acquired) {
      if (alreadyClaimed) {
        // Pós-claim sem preAcquiredLock: a execução está em 'running' com
        // marcador já removido. O caller (cron) deve registrar e fazer retry.
        // completeExecution('failed') NÃO é chamado — o lock pode estar
        // sendo usado por outra instância que processará normalmente.
        const errorMsg =
          `[executor] POST_CLAIM_LOCK_UNAVAILABLE: execução ${execution.id} ` +
          `foi reivindicada mas o lock não pôde ser adquirido — ${lock.reason}`
        console.error(errorMsg)
        throw new Error(errorMsg)
      }
      // Caminho legado: skip silencioso preserva o comportamento atual.
      console.warn(`[executor] resumeFromNode: execução ${execution.id} ignorada — ${lock.reason}`)
      return { skipped: true, reason: lock.reason }
    }
  }

  try {
    const allNodes = flow.nodes || []
    const allEdges = flow.edges || []

    // pausedNodeId é sempre fornecido explicitamente pelo caller.
    // No caminho pós-claim, execution.current_node_id pode ser null
    // (limpo pela RPC) — nunca depender dele para localizar o nó.
    const pausedNode = allNodes.find(n => n.id === pausedNodeId)
    if (!pausedNode) {
      throw new Error(`Nó "${pausedNodeId}" não encontrado no flow — o flow pode ter sido editado após o pause`)
    }

    // -------------------------------------------------------------------------
    // Caminho legado: tratar _awaiting_input e executar claim local
    // -------------------------------------------------------------------------
    let wasAwaitingInput = false

    if (!alreadyClaimed) {
      const awaitingInput = execution.variables?._awaiting_input
      wasAwaitingInput = !!awaitingInput

      if (awaitingInput) {
        // Retomada de user_input — userResponse é obrigatório
        if (userResponse === undefined || userResponse === null || String(userResponse).trim() === '') {
          throw new Error(
            `userResponse é obrigatório para retomar a execução ${execution.id} (aguardando entrada no nó "${awaitingInput.node_id}")`
          )
        }

        const variableName = awaitingInput.variable_name || 'user_response'
        const updatedVariables = { ...(execution.variables || {}) }

        updatedVariables[variableName] = userResponse
        delete updatedVariables._awaiting_input

        const { error: varErr } = await supabase
          .from('automation_executions')
          .update({ variables: updatedVariables })
          .eq('id', execution.id)

        if (varErr) throw new Error(`Erro ao salvar resposta do usuário: ${varErr.message}`)

        execution.variables = updatedVariables

        console.log(`[executor] user_input: resposta salva em context.variables.${variableName}`)
      }

      // Claim legado: transição paused → running e limpeza dos campos de pausa.
      // O caminho pós-claim pula este bloco — a RPC já fez isso atomicamente.
      const { error: resumeErr } = await supabase
        .from('automation_executions')
        .update({
          status:          'running',
          paused_at:       null,
          resume_at:       null,
          timeout_at:      null,
          current_node_id: null,
        })
        .eq('id', execution.id)

      if (resumeErr) {
        throw new Error(`Erro ao retomar execução: ${resumeErr.message}`)
      }
    }

    // -------------------------------------------------------------------------
    // Caminho pós-claim: salvar response_variable se configurada (Opção A).
    //
    // Responsabilidade: executor salva a resposta do lead nas variables.
    // Isso é consistente com o tratamento de _awaiting_input no caminho legado.
    // O webhook entrega userResponse e claimedMarker; o executor persiste.
    // O cancelamento do schedule é responsabilidade do webhook, não do executor.
    //
    // Condições para salvar:
    //   1. alreadyClaimed = true (pós-claim, não duplicar com caminho legado)
    //   2. resumeReason = 'lead_response' (lead respondeu — timeout não tem resposta)
    //   3. claimedMarker.response_variable configurado (editor configurou a variável)
    //   4. userResponse !== undefined (caller entregou a resposta)
    // -------------------------------------------------------------------------
    if (
      alreadyClaimed
      && resumeReason === 'lead_response'
      && claimedMarker?.response_variable
      && userResponse !== undefined
    ) {
      const responseVarName  = claimedMarker.response_variable
      // execution.variables já tem _awaiting_delay_response removido (pós-claim da RPC)
      const updatedVars = { ...(execution.variables || {}), [responseVarName]: userResponse }

      const { error: varErr } = await supabase
        .from('automation_executions')
        .update({ variables: updatedVars })
        .eq('id', execution.id)

      if (varErr) {
        throw new Error(`Erro ao salvar response_variable "${responseVarName}": ${varErr.message}`)
      }

      execution.variables = updatedVars
      console.log(`[executor] delay time_or_response: resposta salva em context.variables.${responseVarName}`)
    }

    // -------------------------------------------------------------------------
    // Construir contexto — mesma lógica para ambos os caminhos
    // -------------------------------------------------------------------------
    const context = {
      executionId:    execution.id,
      flowId:         flow.id,
      companyId:      execution.company_id,
      triggerData:    execution.trigger_data   || {},
      variables:      execution.variables      || {},
      leadId:         execution.lead_id        || execution.trigger_data?.lead_id || null,
      opportunityId:  execution.opportunity_id  || null,
      instanceId:     resolveInstanceId(execution, pausedNode),
      // conversationId: fonte de verdade é trigger_data.conversation_id (snake_case).
      conversationId: execution.trigger_data?.conversation_id
                      ?? execution.trigger_data?.conversationId
                      ?? null,
    }

    if (!assertContext(context)) {
      const errorMsg = 'context inválido após resume — campo obrigatório ausente'
      try {
        await supabase.from('automation_logs').insert({
          execution_id:  execution.id,
          flow_id:       flow.id,
          company_id:    execution.company_id,
          node_id:       pausedNodeId || 'unknown',
          node_type:     'system',
          action:        'resume_context_invalid',
          status:        'error',
          input_data:    null,
          output_data:   {
            missingFields: ['executionId', 'flowId', 'companyId', 'triggerData', 'variables'].filter(
              f => context[f] === undefined || context[f] === null
            ),
            executionId:  context.executionId,
            flowId:       context.flowId,
            companyId:    context.companyId,
          },
          error_message: errorMsg,
          executed_at:   new Date().toISOString(),
        })
      } catch (logErr) {
        console.error('[executor][resumeFromNode] falha ao registrar log de context inválido:', logErr?.message)
      }
      await completeExecution(execution.id, 'failed', errorMsg, supabase)
      return { failed: true, reason: 'context inválido' }
    }

    // -------------------------------------------------------------------------
    // Determinar roteamento para getNextNodes
    //
    // Delay time_or_response: roteia por 'responded' ou 'timeout'.
    //   switch explícito — não usa ternário, não permite fallback silencioso.
    //   Qualquer resumeReason inválido (undefined, typo, valor futuro) lança erro.
    //
    // Delay legado (wait_mode ausente ou 'time'): routingResult = {} → todas as edges.
    // Demais tipos de nó: routingResult = {} → comportamento inalterado.
    // -------------------------------------------------------------------------
    let routingResult = {}

    if (pausedNode.type === 'delay') {
      const waitMode = pausedNode.data?.config?.wait_mode
      if (waitMode === 'time_or_response') {
        switch (resumeReason) {
          case 'lead_response':
            routingResult = { sourceHandle: 'responded' }
            break
          case 'timeout':
            routingResult = { sourceHandle: 'timeout' }
            break
          default:
            throw new Error(
              `resumeReason inválido para delay time_or_response: "${resumeReason}" — ` +
              `esperado 'lead_response' ou 'timeout' ` +
              `(execution: ${execution.id}, node: ${pausedNode.id})`
            )
        }
      }
    }

    const resumeLabel = alreadyClaimed
      ? `delay_time_or_response[${resumeReason}]`
      : (wasAwaitingInput ? 'user_input' : 'delay')

    console.log(`[executor] retomando execução ${execution.id} após ${resumeLabel}: ${pausedNodeId}`)

    const nextNodes = getNextNodes(pausedNode, allNodes, allEdges, routingResult)

    if (nextNodes.length === 0) {
      await completeExecution(execution.id, 'completed', null, supabase)
      console.log(`[executor] execução completada após retomada (sem próximos nós): ${execution.id}`)
      return { completed: true }
    }

    try {
      for (const next of nextNodes) {
        await processNode(next, allNodes, allEdges, context, supabase)
      }
    } catch (err) {
      // Falha após claim: não reverter para 'paused', não recriar marcador.
      // Marcar como failed e propagar — política de retry é do caller/cron.
      console.error(
        `[executor] erro ao retomar execução ${execution.id}` +
        ` (node: ${pausedNodeId}, resumeReason: ${resumeReason ?? 'n/a'}):`,
        err?.message
      )
      await completeExecution(execution.id, 'failed', err?.message, supabase)
      throw err
    }

    const { data: current } = await supabase
      .from('automation_executions')
      .select('status')
      .eq('id', execution.id)
      .single()

    if (current?.status === 'paused') {
      console.log(`[executor] execução pausada novamente após retomada: ${execution.id}`)
      return { paused: true }
    }

    await completeExecution(execution.id, 'completed', null, supabase)
    console.log(`[executor] execução completada após retomada: ${execution.id}`)
    return { completed: true }

  } finally {
    // Liberar lock somente quando o executor é o proprietário (Caminho B).
    // Quando preAcquiredLock foi fornecido (Caminho A), o caller é responsável
    // pela liberação no seu próprio finally.
    if (!callerOwnedLock) {
      await releaseLock(execution.id, lock.lockId, supabase)
    }
  }
}

// ---------------------------------------------------------------------------
// Retomada após delay — chamado por process-schedules e webhook legados
//
// Wrapper posicional que preserva o contrato atual dos callers externos:
//   - api/uazapi-webhook-final.js
//   - api/automation/process-schedules.ts
//   - api/automation/continue-execution.ts
//   - outros callers que usam assinatura posicional
//
// Sempre opera com alreadyClaimed = false (claim legado dentro da função).
// Novos callers pós-claim devem usar resumeClaimedExecution().
// ---------------------------------------------------------------------------

export async function resumeFromNode(execution, flow, pausedNodeId, supabase, userResponse = undefined) {
  return _resumeFromNodeInternal({
    execution,
    flow,
    pausedNodeId,
    supabase,
    userResponse,
    resumeReason:   undefined,
    awaitingType:   undefined,
    scheduleId:     undefined,
    alreadyClaimed: false,
    claimedMarker:  null,
  })
}

// ---------------------------------------------------------------------------
// Retomada pós-claim — para webhook e cron após claim_paused_execution_v1
//
// Contrato:
//   execution    — objeto pós-claim retornado pela RPC (status=running, marcador removido)
//   flow         — flow object com nodes e edges
//   pausedNodeId — id do nó que estava pausado (vem do resultado da find RPC ou do marker)
//   supabase     — cliente supabaseAdmin
//   userResponse — conteúdo da resposta do lead (pode ser null/'' para lead_response)
//   resumeReason — 'lead_response' | 'timeout' (obrigatório para delay time_or_response)
//   awaitingType — 'awaiting_input' | 'delay_response' (contexto para logging)
//   scheduleId   — uuid do schedule (para logging; cancelamento é responsabilidade do webhook)
//   claimedMarker — objeto _awaiting_delay_response original, retornado pela claim RPC
//                   claimedMarker.response_variable: nome da variável onde salvar a resposta
//
// Sempre opera com alreadyClaimed = true:
//   - não repete a transição paused → running
//   - não remove marcador (já removido pela RPC)
//   - routeia pelo resumeReason
// ---------------------------------------------------------------------------

export async function resumeClaimedExecution({
  execution,
  flow,
  pausedNodeId,
  supabase,
  userResponse    = undefined,
  resumeReason,
  awaitingType    = undefined,
  scheduleId      = undefined,
  claimedMarker   = null,
  preAcquiredLock = null,
}) {
  return _resumeFromNodeInternal({
    execution,
    flow,
    pausedNodeId,
    supabase,
    userResponse,
    resumeReason,
    awaitingType,
    scheduleId,
    alreadyClaimed:  true,
    claimedMarker,
    preAcquiredLock,
  })
}

// ---------------------------------------------------------------------------
// Orquestrador principal — chamado por trigger-event.ts
// ---------------------------------------------------------------------------

export async function processFlowAsync(flow, execution, supabase) {
  const lock = await acquireLock(execution.id, supabase)
  if (!lock.acquired) {
    console.warn(`[executor] processFlowAsync: execução ${execution.id} ignorada — ${lock.reason}`)
    return
  }

  try {
    console.log(`[executor] iniciando flow: ${flow.id}`)

    const triggerNode = (flow.nodes || []).find(n => n.type === 'trigger' || n.type === 'start')
    if (!triggerNode) throw new Error('Nó trigger/start não encontrado no flow')

    const context = {
      executionId:    execution.id,
      flowId:         flow.id,
      companyId:      execution.company_id,
      triggerData:    execution.trigger_data   || {},
      variables:      execution.variables      || {},
      leadId:         execution.lead_id        || execution.trigger_data?.lead_id || null,
      opportunityId:  execution.opportunity_id  || null,
      instanceId:     resolveInstanceId(execution, triggerNode),
      conversationId: execution.trigger_data?.conversation_id
                      ?? execution.trigger_data?.conversationId
                      ?? null,
    }

    if (!assertContext(context)) {
      await completeExecution(execution.id, 'failed', 'context inválido — campo obrigatório ausente', supabase)
      return
    }

    await processNode(triggerNode, flow.nodes, flow.edges || [], context, supabase)

    const { data: current } = await supabase
      .from('automation_executions')
      .select('status')
      .eq('id', execution.id)
      .single()

    if (current?.status === 'paused') {
      console.log(`[executor] flow pausado: ${flow.id}`)
      return
    }

    await completeExecution(execution.id, 'completed', null, supabase)
    console.log(`[executor] flow concluído: ${flow.id}`)
  } catch (err) {
    console.error(`[executor] erro no flow ${flow.id}:`, err?.message)
    await completeExecution(execution.id, 'failed', err?.message, supabase)
  } finally {
    await releaseLock(execution.id, lock.lockId, supabase)
  }
}
