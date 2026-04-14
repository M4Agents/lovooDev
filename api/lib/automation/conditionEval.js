// =====================================================
// CONDITION EVALUATOR — Etapa 3 do núcleo mínimo backend
//
// Extração fiel da lógica de evaluateCondition do
// AutomationEngine.ts, adaptada para ESM e recebendo
// supabase (admin) como parâmetro.
//
// v2: logging estruturado + tracing de dados ausentes
// v3: resolveLeadId centralizado em contextUtils.js
// Sem imports de src/ — standalone.
// =====================================================

import { resolveLeadId } from './contextUtils.js'

// ---------------------------------------------------------------------------
// Logging estruturado
// ---------------------------------------------------------------------------

/**
 * Emite log padronizado e retorna objeto rico { result, actual, expected }
 * que será persistido em output_data pelo executor via createLog.
 */
function condLog(type, { operator, expected, actual, result } = {}) {
  const parts = [`[conditionEval:${type}]`]
  if (operator !== undefined) parts.push(`op=${operator}`)
  if (expected !== undefined) parts.push(`expected=${JSON.stringify(expected)}`)
  if (actual   !== undefined) parts.push(`actual=${JSON.stringify(actual)}`)
  parts.push(`→ ${result}`)
  console.log(parts.join(' '))
  return { result, actual, expected }
}

/**
 * Emite aviso quando dado essencial está ausente e retorna objeto
 * { result: false, reason } que será persistido em output_data.
 */
function condMissing(type, reason) {
  console.warn(`[conditionEval:${type}] false — ${reason}`)
  return { result: false, reason }
}

// ---------------------------------------------------------------------------
// Utilitários internos
// ---------------------------------------------------------------------------

function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj)
}

// ---------------------------------------------------------------------------
// Avaliadores por tipo de condição
// ---------------------------------------------------------------------------

async function evaluateLeadField(config, context, supabase) {
  const TYPE = 'lead_field'
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) return condMissing(TYPE, 'leadId ausente no contexto')

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', Number(leadId))
    .maybeSingle()

  if (!lead) return condMissing(TYPE, `lead ${leadId} não encontrado`)

  const { field, operator, value } = config
  const fieldValue = getNestedValue(lead, field)

  let result = false
  switch (operator) {
    case 'equals':       result = fieldValue == value;  break
    case 'not_equals':   result = fieldValue != value;  break
    case 'contains':     result = String(fieldValue || '').toLowerCase().includes(String(value || '').toLowerCase()); break
    case 'not_contains': result = !String(fieldValue || '').toLowerCase().includes(String(value || '').toLowerCase()); break
    case 'is_empty':     result = !fieldValue || fieldValue === '' || fieldValue === null; break
    case 'is_not_empty': result = !!fieldValue && fieldValue !== ''; break
    case 'greater_than': result = Number(fieldValue) > Number(value); break
    case 'less_than':    result = Number(fieldValue) < Number(value); break
    default:             return condMissing(TYPE, `operador desconhecido: ${operator}`)
  }

  return condLog(TYPE, { operator, expected: value, actual: fieldValue, result })
}

async function evaluateLeadTags(config, context, supabase) {
  const TYPE = 'lead_tags'
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) return condMissing(TYPE, 'leadId ausente no contexto')

  const { data: leadTags } = await supabase
    .from('lead_tag_assignments')
    .select('tag_id')
    .eq('lead_id', Number(leadId))

  const leadTagIds = (leadTags || []).map(lt => lt.tag_id)
  const { operator, tags = [] } = config

  let result = false
  switch (operator) {
    case 'has_tag':      result = tags.some(tagId => leadTagIds.includes(tagId));  break
    case 'not_has_tag':  result = !tags.some(tagId => leadTagIds.includes(tagId)); break
    case 'has_any_tag':  result = tags.some(tagId => leadTagIds.includes(tagId));  break
    case 'has_all_tags': result = tags.every(tagId => leadTagIds.includes(tagId)); break
    default:             return condMissing(TYPE, `operador desconhecido: ${operator}`)
  }

  return condLog(TYPE, { operator, expected: tags, actual: leadTagIds, result })
}

async function evaluateLeadSource(config, context, supabase) {
  const TYPE = 'lead_source'
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) return condMissing(TYPE, 'leadId ausente no contexto')

  // Coluna real na tabela é 'origin', não 'source'
  const { data: lead } = await supabase
    .from('leads')
    .select('origin')
    .eq('id', Number(leadId))
    .maybeSingle()

  if (!lead) return condMissing(TYPE, `lead ${leadId} não encontrado`)

  const source = lead.origin
  const { operator, value } = config

  let result = false
  switch (operator) {
    case 'equals':     result = source === value; break
    case 'not_equals': result = source !== value; break
    case 'contains':   result = String(source || '').toLowerCase().includes(String(value || '').toLowerCase()); break
    default:           return condMissing(TYPE, `operador desconhecido: ${operator}`)
  }

  return condLog(TYPE, { operator, expected: value, actual: source, result })
}

async function evaluateLeadCreatedDate(config, context, supabase) {
  const TYPE = 'lead_created_date'
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) return condMissing(TYPE, 'leadId ausente no contexto')

  const { data: lead } = await supabase
    .from('leads')
    .select('created_at')
    .eq('id', Number(leadId))
    .maybeSingle()

  if (!lead)               return condMissing(TYPE, `lead ${leadId} não encontrado`)
  if (!lead.created_at)    return condMissing(TYPE, 'campo created_at ausente')

  const createdAt = new Date(lead.created_at)
  const now = new Date()
  const diffMs   = now.getTime() - createdAt.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  const { operator, value, unit } = config

  let result = false
  switch (operator) {
    case 'is_today':
      result = createdAt.toDateString() === now.toDateString()
      break
    case 'is_yesterday': {
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      result = createdAt.toDateString() === yesterday.toDateString()
      break
    }
    case 'is_this_week':  result = diffDays <= 7;                          break
    case 'is_this_month': result = createdAt.getMonth() === now.getMonth() && createdAt.getFullYear() === now.getFullYear(); break
    case 'is_older_than': {
      const mult = unit === 'weeks' ? 7 : unit === 'months' ? 30 : 1
      result = diffDays > value * mult
      break
    }
    case 'is_newer_than': {
      const mult = unit === 'weeks' ? 7 : unit === 'months' ? 30 : 1
      result = diffDays < value * mult
      break
    }
    default: return condMissing(TYPE, `operador desconhecido: ${operator}`)
  }

  return condLog(TYPE, { operator, expected: `${value} ${unit || 'days'}`, actual: `${Math.round(diffDays)}d atrás`, result })
}

async function evaluateLastInteraction(config, context, supabase) {
  const TYPE = 'last_interaction'
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) return condMissing(TYPE, 'leadId ausente no contexto')

  const { data: messages } = await supabase
    .from('chat_messages')
    .select('created_at')
    .eq('lead_id', Number(leadId))
    .order('created_at', { ascending: false })
    .limit(1)

  const { operator, value, unit } = config

  if (!messages || messages.length === 0) {
    const result = operator === 'never_interacted'
    return condLog(TYPE, { operator, actual: 'sem mensagens', result, reason: 'nenhuma interação registrada' })
  }

  const lastAt = new Date(messages[0].created_at)
  const diffMs = Date.now() - lastAt.getTime()

  let diffInUnit = diffMs / (1000 * 60 * 60 * 24) // default: dias
  if (unit === 'hours') diffInUnit = diffMs / (1000 * 60 * 60)
  if (unit === 'weeks') diffInUnit = diffMs / (1000 * 60 * 60 * 24 * 7)

  let result = false
  switch (operator) {
    case 'is_older_than':    result = diffInUnit > value;  break
    case 'is_newer_than':    result = diffInUnit < value;  break
    case 'never_interacted': result = false;               break
    default:                 return condMissing(TYPE, `operador desconhecido: ${operator}`)
  }

  return condLog(TYPE, { operator, expected: `${value} ${unit || 'days'}`, actual: `${diffInUnit.toFixed(1)} ${unit || 'days'} atrás`, result })
}

async function evaluateLeadScore(config, context, supabase) {
  const TYPE = 'lead_score'
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) return condMissing(TYPE, 'leadId ausente no contexto')

  const { data: lead } = await supabase
    .from('leads')
    .select('score')
    .eq('id', Number(leadId))
    .maybeSingle()

  if (!lead) return condMissing(TYPE, `lead ${leadId} não encontrado`)

  // score null = lead sem pontuação definida; não tratamos como 0 para evitar falsos positivos
  if (lead.score === null || lead.score === undefined) {
    return condMissing(TYPE, 'score ausente (null) no lead')
  }

  const score = lead.score
  const { operator, value } = config

  let result = false
  switch (operator) {
    case 'equals':       result = score === value;                              break
    case 'greater_than': result = score > value;                               break
    case 'less_than':    result = score < value;                               break
    case 'between':      result = score >= value?.min && score <= value?.max;  break
    default:             return condMissing(TYPE, `operador desconhecido: ${operator}`)
  }

  return condLog(TYPE, { operator, expected: value, actual: score, result })
}

async function evaluateOpportunityStage(config, context, supabase) {
  const TYPE = 'opportunity_stage'
  if (!context.opportunityId) return condMissing(TYPE, 'opportunityId ausente no contexto')

  const { data: opp } = await supabase
    .from('opportunities')
    .select('stage_id')
    .eq('id', context.opportunityId)
    .maybeSingle()

  if (!opp) return condMissing(TYPE, `oportunidade ${context.opportunityId} não encontrada`)

  const { operator, value } = config

  let result = false
  switch (operator) {
    case 'is':     result = opp.stage_id === value;                                   break
    case 'is_not': result = opp.stage_id !== value;                                   break
    case 'is_in':  result = Array.isArray(value) && value.includes(opp.stage_id);    break
    default:       return condMissing(TYPE, `operador desconhecido: ${operator}`)
  }

  return condLog(TYPE, { operator, expected: value, actual: opp.stage_id, result })
}

async function evaluateOpportunityValue(config, context, supabase) {
  const TYPE = 'opportunity_value'
  if (!context.opportunityId) return condMissing(TYPE, 'opportunityId ausente no contexto')

  const { data: opp } = await supabase
    .from('opportunities')
    .select('value')
    .eq('id', context.opportunityId)
    .maybeSingle()

  if (!opp) return condMissing(TYPE, `oportunidade ${context.opportunityId} não encontrada`)

  const oppValue = opp.value ?? 0
  const { operator, value } = config

  let result = false
  switch (operator) {
    case 'equals':       result = oppValue === value;                              break
    case 'greater_than': result = oppValue > value;                               break
    case 'less_than':    result = oppValue < value;                               break
    case 'between':      result = oppValue >= value?.min && oppValue <= value?.max; break
    default:             return condMissing(TYPE, `operador desconhecido: ${operator}`)
  }

  return condLog(TYPE, { operator, expected: value, actual: oppValue, result })
}

async function evaluateOpportunityOwner(config, context, supabase) {
  const TYPE = 'opportunity_owner'
  if (!context.opportunityId) return condMissing(TYPE, 'opportunityId ausente no contexto')

  const { data: opp } = await supabase
    .from('opportunities')
    .select('owner_id')
    .eq('id', context.opportunityId)
    .maybeSingle()

  if (!opp) return condMissing(TYPE, `oportunidade ${context.opportunityId} não encontrada`)

  const { operator, value } = config

  let result = false
  switch (operator) {
    case 'is':           result = opp.owner_id === value;  break
    case 'is_not':       result = opp.owner_id !== value;  break
    case 'has_no_owner': result = !opp.owner_id;           break
    default:             return condMissing(TYPE, `operador desconhecido: ${operator}`)
  }

  return condLog(TYPE, { operator, expected: value ?? '(sem dono)', actual: opp.owner_id ?? '(sem dono)', result })
}

async function evaluateOpportunityStageDuration(config, context, supabase) {
  const TYPE = 'opportunity_stage_duration'
  if (!context.opportunityId) return condMissing(TYPE, 'opportunityId ausente no contexto')

  const { data: opp } = await supabase
    .from('opportunities')
    .select('stage_changed_at')
    .eq('id', context.opportunityId)
    .maybeSingle()

  if (!opp)                  return condMissing(TYPE, `oportunidade ${context.opportunityId} não encontrada`)
  if (!opp.stage_changed_at) return condMissing(TYPE, 'stage_changed_at ausente na oportunidade')

  const diffMs = Date.now() - new Date(opp.stage_changed_at).getTime()
  const { operator, value, unit } = config

  let diffInUnit = diffMs / (1000 * 60 * 60 * 24)
  if (unit === 'hours') diffInUnit = diffMs / (1000 * 60 * 60)
  if (unit === 'weeks') diffInUnit = diffMs / (1000 * 60 * 60 * 24 * 7)

  let result = false
  switch (operator) {
    case 'is_longer_than':  result = diffInUnit > value;  break
    case 'is_shorter_than': result = diffInUnit < value;  break
    default:                return condMissing(TYPE, `operador desconhecido: ${operator}`)
  }

  return condLog(TYPE, { operator, expected: `${value} ${unit || 'days'}`, actual: `${diffInUnit.toFixed(1)} ${unit || 'days'}`, result })
}

function evaluateDayOfWeek(config) {
  const TYPE = 'day_of_week'
  const currentDay = new Date().getDay() // 0 = domingo, 6 = sábado
  const { operator, value } = config

  let result = false
  switch (operator) {
    case 'is':     result = currentDay === value;                                break
    case 'is_not': result = currentDay !== value;                               break
    case 'is_in':  result = Array.isArray(value) && value.includes(currentDay); break
    default:       return condMissing(TYPE, `operador desconhecido: ${operator}`)
  }

  return condLog(TYPE, { operator, expected: value, actual: currentDay, result })
}

function evaluateTimeOfDay(config) {
  const TYPE = 'time_of_day'
  const now = new Date()
  const currentTime = now.getHours() * 60 + now.getMinutes()
  const { operator, value } = config

  const parseTime = (t) => {
    if (typeof t !== 'string' || !t.includes(':')) return NaN
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }

  let result = false
  switch (operator) {
    case 'is_between':
      result = currentTime >= parseTime(value?.start) && currentTime <= parseTime(value?.end)
      break
    case 'is_before': result = currentTime < parseTime(value); break
    case 'is_after':  result = currentTime > parseTime(value); break
    default:          return condMissing(TYPE, `operador desconhecido: ${operator}`)
  }

  const hm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  return condLog(TYPE, { operator, expected: value, actual: hm, result })
}

function evaluateDayOfMonth(config) {
  const TYPE = 'day_of_month'
  const now = new Date()
  const currentDay = now.getDate()
  const { operator, value } = config

  let result = false
  switch (operator) {
    case 'is':           result = currentDay === value;                                break
    case 'is_between':   result = currentDay >= value?.start && currentDay <= value?.end; break
    case 'is_first_day': result = currentDay === 1;                                   break
    case 'is_last_day':  result = currentDay === new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); break
    default:             return condMissing(TYPE, `operador desconhecido: ${operator}`)
  }

  return condLog(TYPE, { operator, expected: value, actual: currentDay, result })
}

/** Formato legado: { field, operator, value } sem config.type */
async function evaluateLegacyCondition(config, context, supabase) {
  const TYPE = 'legacy'
  const { field, operator = 'equals', value } = config
  if (!field) return condMissing(TYPE, 'campo "field" ausente na config legada')

  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) return condMissing(TYPE, 'leadId ausente no contexto (legado)')

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', Number(leadId))
    .maybeSingle()

  if (!lead) return condMissing(TYPE, `lead ${leadId} não encontrado (legado)`)

  const fieldValue = getNestedValue(lead, field)

  let result = false
  switch (operator) {
    case 'equals':       result = fieldValue == value;  break
    case 'not_equals':   result = fieldValue != value;  break
    case 'contains':     result = String(fieldValue || '').toLowerCase().includes(String(value || '').toLowerCase()); break
    case 'not_contains': result = !String(fieldValue || '').toLowerCase().includes(String(value || '').toLowerCase()); break
    case 'is_empty':     result = !fieldValue || fieldValue === '' || fieldValue === null; break
    case 'is_not_empty': result = !!fieldValue && fieldValue !== ''; break
    case 'greater_than': result = Number(fieldValue) > Number(value); break
    case 'less_than':    result = Number(fieldValue) < Number(value); break
    default:             return condMissing(TYPE, `operador desconhecido: ${operator}`)
  }

  return condLog(TYPE, { operator, expected: value, actual: fieldValue, result })
}

// ---------------------------------------------------------------------------
// Entry point principal — chamado pelo executor.js
// ---------------------------------------------------------------------------

export async function evaluateCondition(node, context, supabase) {
  const config        = node.data?.config || {}
  const conditionType = config.type
  const nodeId        = node.id || '?'

  try {
    // evalResult: objeto { result, actual?, expected?, reason? } retornado por condLog/condMissing
    let evalResult

    if (!conditionType) {
      console.log(`[conditionEval] nó ${nodeId} sem config.type — avaliando como legado`)
      evalResult = await evaluateLegacyCondition(config, context, supabase)
      return _buildResult(evalResult, 'legacy', config)
    }

    switch (conditionType) {
      case 'lead_field':               evalResult = await evaluateLeadField(config, context, supabase);               break
      case 'lead_tags':                evalResult = await evaluateLeadTags(config, context, supabase);                break
      case 'lead_source':              evalResult = await evaluateLeadSource(config, context, supabase);              break
      case 'lead_created_date':        evalResult = await evaluateLeadCreatedDate(config, context, supabase);        break
      case 'last_interaction':         evalResult = await evaluateLastInteraction(config, context, supabase);         break
      case 'lead_score':               evalResult = await evaluateLeadScore(config, context, supabase);               break
      case 'opportunity_stage':        evalResult = await evaluateOpportunityStage(config, context, supabase);        break
      case 'opportunity_value':        evalResult = await evaluateOpportunityValue(config, context, supabase);        break
      case 'opportunity_owner':        evalResult = await evaluateOpportunityOwner(config, context, supabase);        break
      case 'opportunity_stage_duration': evalResult = await evaluateOpportunityStageDuration(config, context, supabase); break
      case 'day_of_week':              evalResult = evaluateDayOfWeek(config);                                        break
      case 'time_of_day':              evalResult = evaluateTimeOfDay(config);                                        break
      case 'day_of_month':             evalResult = evaluateDayOfMonth(config);                                       break
      default:
        console.warn(`[conditionEval] nó ${nodeId} — tipo não suportado: "${conditionType}" → false`)
        return { result: false, type: conditionType, reason: `tipo de condição não suportado: ${conditionType}` }
    }

    return _buildResult(evalResult, conditionType, config)
  } catch (err) {
    console.error(`[conditionEval] erro inesperado ao avaliar nó ${nodeId} (${conditionType}):`, err?.message)
    return { result: false, type: conditionType, error: err?.message }
  }
}

/**
 * Monta o objeto final de resultado a partir do retorno rico de condLog/condMissing.
 * Garante compatibilidade com executor.js que acessa result?.result para routing.
 */
function _buildResult(evalResult, conditionType, config) {
  // condLog retorna { result, actual, expected }
  // condMissing retorna { result: false, reason }
  const isObject = evalResult !== null && typeof evalResult === 'object'
  const result   = isObject ? !!evalResult.result : !!evalResult

  return {
    result,
    type:     conditionType,
    operator: config.operator     ?? null,
    expected: isObject ? (evalResult.expected ?? config.value ?? null) : (config.value ?? null),
    actual:   isObject ? (evalResult.actual   ?? null)                 : null,
    ...(isObject && evalResult.reason ? { reason: evalResult.reason } : {}),
  }
}
