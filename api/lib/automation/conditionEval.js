// =====================================================
// CONDITION EVALUATOR — Etapa 3 do núcleo mínimo backend
//
// Extração fiel da lógica de evaluateCondition do
// AutomationEngine.ts, adaptada para ESM e recebendo
// supabase (admin) como parâmetro.
//
// Sem imports de src/ — standalone.
// =====================================================

// ---------------------------------------------------------------------------
// Utilitários internos
// ---------------------------------------------------------------------------

function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj)
}

/**
 * Resolve leadId a partir do contexto.
 * Se context.leadId for null, tenta buscar via opportunityId.
 */
async function resolveLeadId(context, supabase) {
  if (context.leadId) return context.leadId
  if (!context.opportunityId) return null

  const { data: opp } = await supabase
    .from('opportunities')
    .select('lead_id')
    .eq('id', context.opportunityId)
    .maybeSingle()

  return opp?.lead_id || null
}

// ---------------------------------------------------------------------------
// Avaliadores por tipo de condição
// ---------------------------------------------------------------------------

async function evaluateLeadField(config, context, supabase) {
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) return false

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', Number(leadId))
    .maybeSingle()

  if (!lead) return false

  const fieldValue = getNestedValue(lead, config.field)
  const { operator, value } = config

  switch (operator) {
    case 'equals':       return fieldValue == value
    case 'not_equals':   return fieldValue != value
    case 'contains':     return String(fieldValue || '').toLowerCase().includes(String(value || '').toLowerCase())
    case 'not_contains': return !String(fieldValue || '').toLowerCase().includes(String(value || '').toLowerCase())
    case 'is_empty':     return !fieldValue || fieldValue === '' || fieldValue === null
    case 'is_not_empty': return !!fieldValue && fieldValue !== ''
    case 'greater_than': return Number(fieldValue) > Number(value)
    case 'less_than':    return Number(fieldValue) < Number(value)
    default:             return false
  }
}

async function evaluateLeadTags(config, context, supabase) {
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) return false

  const { data: leadTags } = await supabase
    .from('lead_tag_assignments')
    .select('tag_id')
    .eq('lead_id', Number(leadId))

  const leadTagIds = (leadTags || []).map(lt => lt.tag_id)
  const { operator, tags = [] } = config

  switch (operator) {
    case 'has_tag':      return tags.some(tagId => leadTagIds.includes(tagId))
    case 'not_has_tag':  return !tags.some(tagId => leadTagIds.includes(tagId))
    case 'has_any_tag':  return tags.some(tagId => leadTagIds.includes(tagId))
    case 'has_all_tags': return tags.every(tagId => leadTagIds.includes(tagId))
    default:             return false
  }
}

async function evaluateLeadSource(config, context, supabase) {
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) return false

  // Coluna real na tabela é 'origin', não 'source'
  const { data: lead } = await supabase
    .from('leads')
    .select('origin')
    .eq('id', Number(leadId))
    .maybeSingle()

  if (!lead) return false

  const source = lead.origin
  const { operator, value } = config

  switch (operator) {
    case 'equals':     return source === value
    case 'not_equals': return source !== value
    case 'contains':   return String(source || '').toLowerCase().includes(String(value || '').toLowerCase())
    default:           return false
  }
}

async function evaluateLeadCreatedDate(config, context, supabase) {
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) return false

  const { data: lead } = await supabase
    .from('leads')
    .select('created_at')
    .eq('id', Number(leadId))
    .maybeSingle()

  if (!lead) return false

  const createdAt = new Date(lead.created_at)
  const now = new Date()
  const diffMs = now.getTime() - createdAt.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  const { operator, value, unit } = config

  switch (operator) {
    case 'is_today': return createdAt.toDateString() === now.toDateString()
    case 'is_yesterday': {
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      return createdAt.toDateString() === yesterday.toDateString()
    }
    case 'is_this_week':  return diffDays <= 7
    case 'is_this_month': return createdAt.getMonth() === now.getMonth() && createdAt.getFullYear() === now.getFullYear()
    case 'is_older_than': {
      const mult = unit === 'weeks' ? 7 : unit === 'months' ? 30 : 1
      return diffDays > value * mult
    }
    case 'is_newer_than': {
      const mult = unit === 'weeks' ? 7 : unit === 'months' ? 30 : 1
      return diffDays < value * mult
    }
    default: return false
  }
}

async function evaluateLastInteraction(config, context, supabase) {
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) return false

  const { data: messages } = await supabase
    .from('chat_messages')
    .select('created_at')
    .eq('lead_id', Number(leadId))
    .order('created_at', { ascending: false })
    .limit(1)

  if (!messages || messages.length === 0) {
    return config.operator === 'never_interacted'
  }

  const diffMs = Date.now() - new Date(messages[0].created_at).getTime()
  const { operator, value, unit } = config

  let diffInUnit = diffMs / (1000 * 60 * 60 * 24) // default: dias
  if (unit === 'hours')  diffInUnit = diffMs / (1000 * 60 * 60)
  if (unit === 'weeks')  diffInUnit = diffMs / (1000 * 60 * 60 * 24 * 7)

  switch (operator) {
    case 'is_older_than':   return diffInUnit > value
    case 'is_newer_than':   return diffInUnit < value
    case 'never_interacted':return false
    default:                return false
  }
}

async function evaluateLeadScore(config, context, supabase) {
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) return false

  const { data: lead } = await supabase
    .from('leads')
    .select('score')
    .eq('id', Number(leadId))
    .maybeSingle()

  if (!lead) return false

  const score = lead.score || 0
  const { operator, value } = config

  switch (operator) {
    case 'equals':       return score === value
    case 'greater_than': return score > value
    case 'less_than':    return score < value
    case 'between':      return score >= value?.min && score <= value?.max
    default:             return false
  }
}

async function evaluateOpportunityStage(config, context, supabase) {
  if (!context.opportunityId) return false

  const { data: opp } = await supabase
    .from('opportunities')
    .select('stage_id')
    .eq('id', context.opportunityId)
    .maybeSingle()

  if (!opp) return false

  const { operator, value } = config

  switch (operator) {
    case 'is':     return opp.stage_id === value
    case 'is_not': return opp.stage_id !== value
    case 'is_in':  return Array.isArray(value) && value.includes(opp.stage_id)
    default:       return false
  }
}

async function evaluateOpportunityValue(config, context, supabase) {
  if (!context.opportunityId) return false

  const { data: opp } = await supabase
    .from('opportunities')
    .select('value')
    .eq('id', context.opportunityId)
    .maybeSingle()

  if (!opp) return false

  const oppValue = opp.value || 0
  const { operator, value } = config

  switch (operator) {
    case 'equals':       return oppValue === value
    case 'greater_than': return oppValue > value
    case 'less_than':    return oppValue < value
    case 'between':      return oppValue >= value?.min && oppValue <= value?.max
    default:             return false
  }
}

async function evaluateOpportunityOwner(config, context, supabase) {
  if (!context.opportunityId) return false

  const { data: opp } = await supabase
    .from('opportunities')
    .select('owner_id')
    .eq('id', context.opportunityId)
    .maybeSingle()

  if (!opp) return false

  const { operator, value } = config

  switch (operator) {
    case 'is':           return opp.owner_id === value
    case 'is_not':       return opp.owner_id !== value
    case 'has_no_owner': return !opp.owner_id
    default:             return false
  }
}

async function evaluateOpportunityStageDuration(config, context, supabase) {
  if (!context.opportunityId) return false

  const { data: opp } = await supabase
    .from('opportunities')
    .select('stage_changed_at')
    .eq('id', context.opportunityId)
    .maybeSingle()

  if (!opp?.stage_changed_at) return false

  const diffMs = Date.now() - new Date(opp.stage_changed_at).getTime()
  const { operator, value, unit } = config

  let diffInUnit = diffMs / (1000 * 60 * 60 * 24) // default: dias
  if (unit === 'hours') diffInUnit = diffMs / (1000 * 60 * 60)
  if (unit === 'weeks') diffInUnit = diffMs / (1000 * 60 * 60 * 24 * 7)

  switch (operator) {
    case 'is_longer_than':  return diffInUnit > value
    case 'is_shorter_than': return diffInUnit < value
    default:                return false
  }
}

function evaluateDayOfWeek(config) {
  const currentDay = new Date().getDay() // 0 = domingo, 6 = sábado
  const { operator, value } = config

  switch (operator) {
    case 'is':     return currentDay === value
    case 'is_not': return currentDay !== value
    case 'is_in':  return Array.isArray(value) && value.includes(currentDay)
    default:       return false
  }
}

function evaluateTimeOfDay(config) {
  const now = new Date()
  const currentTime = now.getHours() * 60 + now.getMinutes()
  const { operator, value } = config

  const parseTime = (t) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }

  switch (operator) {
    case 'is_between': return currentTime >= parseTime(value?.start) && currentTime <= parseTime(value?.end)
    case 'is_before':  return currentTime < parseTime(value)
    case 'is_after':   return currentTime > parseTime(value)
    default:           return false
  }
}

function evaluateDayOfMonth(config) {
  const now = new Date()
  const currentDay = now.getDate()
  const { operator, value } = config

  switch (operator) {
    case 'is':           return currentDay === value
    case 'is_between':   return currentDay >= value?.start && currentDay <= value?.end
    case 'is_first_day': return currentDay === 1
    case 'is_last_day':  return currentDay === new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    default:             return false
  }
}

/** Formato legado: { field, operator, value } sem config.type */
async function evaluateLegacyCondition(config, context, supabase) {
  const { field, operator = 'equals', value } = config
  if (!field) return false

  const leadId = await resolveLeadId(context, supabase)
  let fieldValue = null

  if (leadId) {
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', Number(leadId))
      .maybeSingle()

    if (lead) fieldValue = getNestedValue(lead, field)
  }

  switch (operator) {
    case 'equals':       return fieldValue == value
    case 'not_equals':   return fieldValue != value
    case 'contains':     return String(fieldValue || '').toLowerCase().includes(String(value || '').toLowerCase())
    case 'not_contains': return !String(fieldValue || '').toLowerCase().includes(String(value || '').toLowerCase())
    case 'is_empty':     return !fieldValue || fieldValue === '' || fieldValue === null
    case 'is_not_empty': return !!fieldValue && fieldValue !== ''
    case 'greater_than': return Number(fieldValue) > Number(value)
    case 'less_than':    return Number(fieldValue) < Number(value)
    default:             return false
  }
}

// ---------------------------------------------------------------------------
// Entry point principal — chamado pelo executor.js
// ---------------------------------------------------------------------------

export async function evaluateCondition(node, context, supabase) {
  const config = node.data?.config || {}
  const conditionType = config.type

  try {
    let result = false

    if (!conditionType) {
      result = await evaluateLegacyCondition(config, context, supabase)
      return { result, type: 'legacy', field: config.field, operator: config.operator, value: config.value }
    }

    switch (conditionType) {
      case 'lead_field':
        result = await evaluateLeadField(config, context, supabase)
        break
      case 'lead_tags':
        result = await evaluateLeadTags(config, context, supabase)
        break
      case 'lead_source':
        result = await evaluateLeadSource(config, context, supabase)
        break
      case 'lead_created_date':
        result = await evaluateLeadCreatedDate(config, context, supabase)
        break
      case 'last_interaction':
        result = await evaluateLastInteraction(config, context, supabase)
        break
      case 'lead_score':
        result = await evaluateLeadScore(config, context, supabase)
        break
      case 'opportunity_stage':
        result = await evaluateOpportunityStage(config, context, supabase)
        break
      case 'opportunity_value':
        result = await evaluateOpportunityValue(config, context, supabase)
        break
      case 'opportunity_owner':
        result = await evaluateOpportunityOwner(config, context, supabase)
        break
      case 'opportunity_stage_duration':
        result = await evaluateOpportunityStageDuration(config, context, supabase)
        break
      case 'day_of_week':
        result = evaluateDayOfWeek(config)
        break
      case 'time_of_day':
        result = evaluateTimeOfDay(config)
        break
      case 'day_of_month':
        result = evaluateDayOfMonth(config)
        break
      default:
        console.warn(`[conditionEval] tipo não suportado: ${conditionType} — retornando false`)
        result = false
    }

    console.log(`[conditionEval] ${conditionType} → ${result} (op: ${config.operator}, val: ${JSON.stringify(config.value)})`)

    return { result, type: conditionType, operator: config.operator, value: config.value }
  } catch (err) {
    console.error(`[conditionEval] erro ao avaliar ${conditionType}:`, err?.message)
    // Retorna false em caso de erro — não crasha o flow
    return { result: false, type: conditionType, error: err?.message }
  }
}
