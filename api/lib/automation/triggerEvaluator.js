// =====================================================
// TRIGGER EVALUATOR (JavaScript)
// Lógica pura de avaliação de condições de trigger.
// Sem Supabase, sem estado, sem efeitos colaterais.
// =====================================================

function matchesTriggerConditions(flow, event) {
  const startNode = (flow.nodes || []).find(node => node.type === 'start')
  if (!startNode) return false

  const triggers = startNode.data?.triggers || []
  if (triggers.length === 0) return false

  const operator = startNode.data?.triggerOperator || flow.trigger_operator || 'OR'
  const relevantTriggers = triggers.filter(t => t.enabled && t.type === event.type)
  if (relevantTriggers.length === 0) return false

  const results = relevantTriggers.map(trigger => {
    switch (event.type) {
      case 'opportunity.stage_changed': return matchesOpportunityStageChanged(trigger, event.data)
      case 'opportunity.created':       return matchesOpportunityCreated(trigger, event.data)
      case 'opportunity.won':           return matchesOpportunityWon(trigger, event.data)
      case 'opportunity.lost':          return matchesOpportunityLost(trigger, event.data)
      case 'opportunity.owner_assigned':
      case 'opportunity.owner_removed': return matchesOpportunityOwner(trigger, event.data)
      case 'tag.added':
      case 'tag.removed':               return matchesTag(trigger, event.data)
      case 'message.received':          return matchesMessageReceived(trigger, event.data)
      default: return true
    }
  })

  if (operator === 'AND') return results.every(r => r === true)
  return results.some(r => r === true)
}

function matchesOpportunityStageChanged(trigger, eventData) {
  const config = trigger.config || {}
  if (config.funnelId   && config.funnelId   !== eventData.opportunity?.funnel_id) return false
  if (config.toStageId  && config.toStageId  !== eventData.new_stage)              return false
  if (config.fromStageId && config.fromStageId !== eventData.old_stage)            return false
  if (config.minValue   && eventData.opportunity?.value < config.minValue)         return false
  if (config.maxValue   && eventData.opportunity?.value > config.maxValue)         return false
  return true
}

function matchesOpportunityCreated(trigger, eventData) {
  const config = trigger.config || {}
  if (config.funnelId       && config.funnelId       !== eventData.opportunity?.funnel_id) return false
  if (config.initialStageId && config.initialStageId !== eventData.opportunity?.stage_id)  return false
  if (config.minValue && eventData.opportunity?.value < config.minValue) return false
  if (config.maxValue && eventData.opportunity?.value > config.maxValue) return false
  return true
}

function matchesOpportunityWon(trigger, eventData) {
  const config = trigger.config || {}
  if (config.funnelId && config.funnelId !== eventData.opportunity?.funnel_id) return false
  if (config.minValue && eventData.opportunity?.value < config.minValue)       return false
  if (config.maxValue && eventData.opportunity?.value > config.maxValue)       return false
  return true
}

function matchesOpportunityLost(trigger, eventData) {
  const config = trigger.config || {}
  if (config.funnelId  && config.funnelId  !== eventData.opportunity?.funnel_id) return false
  if (config.lostReason && config.lostReason !== eventData.lost_reason)          return false
  if (config.minValue  && eventData.opportunity?.value < config.minValue)        return false
  if (config.maxValue  && eventData.opportunity?.value > config.maxValue)        return false
  return true
}

function matchesOpportunityOwner(trigger, eventData) {
  const config = trigger.config || {}
  if (config.funnelId && config.funnelId !== eventData.opportunity?.funnel_id) return false
  if (config.ownerId  && config.ownerId  !== eventData.owner_id)               return false
  return true
}

function matchesTag(trigger, eventData) {
  const config = trigger.config || {}
  if (config.tagId && config.tagId !== eventData.tag_id) return false
  return true
}

function matchesMessageReceived(trigger, eventData) {
  const config = trigger.config || {}
  if (config.instanceId && config.instanceId !== eventData.instance_id) return false
  return true
}

module.exports = {
  matchesTriggerConditions,
  matchesOpportunityStageChanged,
  matchesOpportunityCreated,
  matchesOpportunityWon,
  matchesOpportunityLost,
  matchesOpportunityOwner,
  matchesTag,
  matchesMessageReceived
}
