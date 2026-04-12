// =====================================================
// EXECUTOR — núcleo mínimo de execução de flows
// Etapa 1: travessia básica + registro de estado
//
// Suportado:   start, trigger, end
// Não suportado (Etapa 1): condition, action, message,
//   delay, distribution — skipped com log claro.
//
// Todas as funções recebem `supabase` (supabaseAdmin)
// como parâmetro — sem importar nada de src/.
// =====================================================

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
        variables:      {},
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

/**
 * Resolve a ação de um nó.
 *
 * Etapa 1 — suportados:
 *   start / trigger → { triggered: true }
 *   end             → { ended: true }
 *
 * Demais tipos: { skipped: true, reason } — sem crash.
 */
async function executeNodeAction(node, context) {
  switch (node.type) {
    case 'trigger':
    case 'start':
      return { triggered: true, data: context.triggerData }

    case 'end':
      return { ended: true }

    default:
      console.log(`[executor] nó não suportado nesta etapa: ${node.type} (id: ${node.id}) — skipped`)
      return { skipped: true, reason: `tipo não suportado nesta etapa: ${node.type}` }
  }
}

async function processNode(node, allNodes, allEdges, context, supabase) {
  console.log(`[executor] nó: ${node.id} (${node.type})`)

  await createLog(context, node, 'started', null, null, supabase)

  try {
    const result = await executeNodeAction(node, context)

    // Nó de fim: registrar e parar a recursão
    if (result?.ended) {
      await createLog(context, node, 'success', result, null, supabase)
      await updateExecutedNodes(context.executionId, node.id, 'success', result, null, supabase)
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
// Orquestrador principal — chamado por trigger-event.ts
// ---------------------------------------------------------------------------

export async function processFlowAsync(flow, execution, supabase) {
  try {
    console.log(`[executor] iniciando flow: ${flow.id}`)

    const triggerNode = (flow.nodes || []).find(n => n.type === 'trigger' || n.type === 'start')
    if (!triggerNode) throw new Error('Nó trigger/start não encontrado no flow')

    const firstTrigger = (triggerNode.data?.triggers || []).find(t => t.enabled)

    const context = {
      executionId:   execution.id,
      flowId:        flow.id,
      companyId:     execution.company_id,
      triggerData:   execution.trigger_data,
      variables:     execution.variables || {},
      leadId:        execution.lead_id,
      opportunityId: execution.opportunity_id,
      instanceId:    firstTrigger?.config?.instanceId ?? null,
    }

    await processNode(triggerNode, flow.nodes, flow.edges || [], context, supabase)

    // Verificar se algum nó pausou a execução (suporte futuro a user_input)
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
  }
}
