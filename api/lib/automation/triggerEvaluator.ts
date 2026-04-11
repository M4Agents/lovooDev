// =====================================================
// TRIGGER EVALUATOR
// Lógica pura de avaliação de condições de trigger.
// Sem Supabase, sem estado, sem efeitos colaterais.
// Reutilizável pelo TriggerManager e pelo endpoint backend.
// =====================================================

export type TriggerType =
  | 'lead.created'
  | 'message.received'
  | 'opportunity.created'
  | 'opportunity.stage_changed'
  | 'opportunity.won'
  | 'opportunity.lost'
  | 'opportunity.owner_assigned'
  | 'opportunity.owner_removed'
  | 'tag.added'
  | 'tag.removed'
  | 'schedule.time'

export interface TriggerEvent {
  type: TriggerType
  companyId: string
  data: Record<string, any>
}

interface FlowForEvaluation {
  id: string
  name?: string
  nodes: any[]
  trigger_operator?: string
}

/**
 * Avalia se um fluxo corresponde às condições do evento de trigger.
 * Lê a configuração do StartNode (fonte de verdade) e aplica operador lógico.
 */
export function matchesTriggerConditions(flow: FlowForEvaluation, event: TriggerEvent): boolean {
  const startNode = flow.nodes.find((node: any) => node.type === 'start')
  if (!startNode) return false

  const triggers = startNode.data?.triggers || []
  if (triggers.length === 0) return false

  const operator = startNode.data?.triggerOperator || flow.trigger_operator || 'OR'

  const relevantTriggers = triggers.filter((t: any) => t.enabled && t.type === event.type)
  if (relevantTriggers.length === 0) return false

  const results = relevantTriggers.map((trigger: any) => {
    switch (event.type) {
      case 'opportunity.stage_changed':
        return matchesOpportunityStageChanged(trigger, event.data)
      case 'opportunity.created':
        return matchesOpportunityCreated(trigger, event.data)
      case 'opportunity.won':
        return matchesOpportunityWon(trigger, event.data)
      case 'opportunity.lost':
        return matchesOpportunityLost(trigger, event.data)
      case 'opportunity.owner_assigned':
      case 'opportunity.owner_removed':
        return matchesOpportunityOwner(trigger, event.data)
      case 'tag.added':
      case 'tag.removed':
        return matchesTag(trigger, event.data)
      case 'message.received':
        return matchesMessageReceived(trigger, event.data)
      default:
        return true
    }
  })

  if (operator === 'AND') {
    const allMatch = results.every((r: boolean) => r === true)
    console.log(`🔗 Operador AND: ${allMatch ? '✅ Todos correspondem' : '❌ Nem todos correspondem'}`, {
      flowId: flow.id, flowName: flow.name, totalTriggers: relevantTriggers.length, results
    })
    return allMatch
  }

  const anyMatch = results.some((r: boolean) => r === true)
  console.log(`🔗 Operador OR: ${anyMatch ? '✅ Pelo menos um corresponde' : '❌ Nenhum corresponde'}`, {
    flowId: flow.id, flowName: flow.name, totalTriggers: relevantTriggers.length, results
  })
  return anyMatch
}

export function matchesOpportunityStageChanged(trigger: any, eventData: any): boolean {
  const config = trigger.config || {}

  if (config.funnelId && config.funnelId !== eventData.opportunity?.funnel_id) {
    console.log('❌ Funil não corresponde:', config.funnelId, '!=', eventData.opportunity?.funnel_id)
    return false
  }
  if (config.toStageId && config.toStageId !== eventData.new_stage) {
    console.log('❌ Etapa destino não corresponde:', config.toStageId, '!=', eventData.new_stage)
    return false
  }
  if (config.fromStageId && config.fromStageId !== eventData.old_stage) {
    console.log('❌ Etapa origem não corresponde:', config.fromStageId, '!=', eventData.old_stage)
    return false
  }
  if (config.minValue && eventData.opportunity?.value < config.minValue) {
    console.log('❌ Valor abaixo do mínimo:', eventData.opportunity?.value, '<', config.minValue)
    return false
  }
  if (config.maxValue && eventData.opportunity?.value > config.maxValue) {
    console.log('❌ Valor acima do máximo:', eventData.opportunity?.value, '>', config.maxValue)
    return false
  }

  console.log('✅ Condições de opportunity.stage_changed correspondem')
  return true
}

export function matchesOpportunityCreated(trigger: any, eventData: any): boolean {
  const config = trigger.config || {}

  if (config.funnelId && config.funnelId !== eventData.opportunity?.funnel_id) return false
  if (config.initialStageId && config.initialStageId !== eventData.opportunity?.stage_id) return false
  if (config.minValue && eventData.opportunity?.value < config.minValue) return false
  if (config.maxValue && eventData.opportunity?.value > config.maxValue) return false

  return true
}

export function matchesOpportunityWon(trigger: any, eventData: any): boolean {
  const config = trigger.config || {}

  if (config.funnelId && config.funnelId !== eventData.opportunity?.funnel_id) return false
  if (config.minValue && eventData.opportunity?.value < config.minValue) return false
  if (config.maxValue && eventData.opportunity?.value > config.maxValue) return false

  return true
}

export function matchesOpportunityLost(trigger: any, eventData: any): boolean {
  const config = trigger.config || {}

  if (config.funnelId && config.funnelId !== eventData.opportunity?.funnel_id) return false
  if (config.lostReason && config.lostReason !== eventData.lost_reason) return false
  if (config.minValue && eventData.opportunity?.value < config.minValue) return false
  if (config.maxValue && eventData.opportunity?.value > config.maxValue) return false

  return true
}

export function matchesOpportunityOwner(trigger: any, eventData: any): boolean {
  const config = trigger.config || {}

  if (config.funnelId && config.funnelId !== eventData.opportunity?.funnel_id) return false
  if (config.ownerId && config.ownerId !== eventData.owner_id) return false

  return true
}

export function matchesTag(trigger: any, eventData: any): boolean {
  const config = trigger.config || {}

  if (config.tagId && config.tagId !== eventData.tag_id) return false

  return true
}

export function matchesMessageReceived(trigger: any, eventData: any): boolean {
  const config = trigger.config || {}

  if (config.instanceId && config.instanceId !== eventData.instance_id) {
    console.log('❌ Instância não corresponde:', {
      configured: config.instanceId,
      received: eventData.instance_id,
      configuredName: config.instanceName
    })
    return false
  }

  console.log('✅ Trigger message.received corresponde', {
    instanceId: eventData.instance_id,
    hasFilter: !!config.instanceId
  })
  return true
}
