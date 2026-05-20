// =====================================================
// TRIGGER EVALUATOR (JavaScript)
// Lógica pura de avaliação de condições de trigger.
// Sem Supabase, sem estado, sem efeitos colaterais.
// =====================================================

// Valor canônico do campo entryPointConversionSource da Uazapi para mensagens
// geradas via link click-to-chat. Centralizado aqui para evitar hardcode repetido.
const CLICK_TO_CHAT_LINK_SOURCE = 'click_to_chat_link'

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
      case 'lead.created':              return matchesLeadCreated(trigger, event.data)
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

// lead.created — filtro opcional por origem (source)
function matchesLeadCreated(trigger, eventData) {
  const config = trigger.config || {}
  if (config.source && config.source !== 'any') {
    return eventData?.source === config.source
  }
  return true
}

function matchesOpportunityStageChanged(trigger, eventData) {
  const config = trigger.config || {}
  if (config.funnelId    && config.funnelId    !== eventData?.opportunity?.funnel_id) return false
  if (config.toStageId   && config.toStageId   !== eventData?.new_stage)              return false
  if (config.fromStageId && config.fromStageId !== eventData?.old_stage)              return false
  if (config.minValue    && eventData?.opportunity?.value < config.minValue)          return false
  if (config.maxValue    && eventData?.opportunity?.value > config.maxValue)          return false
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

// Normaliza texto: lowercase + remove acentos
function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

// Extrai flags PCRE inline do início do padrão para uso em RegExp do JavaScript.
// Suporta apenas flags válidas no JS: i, m, s.
// Ex: "(?i)padrão"  → { cleanPattern: "padrão", flags: "i" }
// Ex: "(?im)padrão" → { cleanPattern: "padrão", flags: "im" }
// Ex: "padrão"      → { cleanPattern: "padrão", flags: "" }
function extractInlineFlags(pattern) {
  const match = pattern.match(/^\(\?([ims]+)\)([\s\S]*)$/)
  if (!match) return { cleanPattern: pattern, flags: '' }
  const rawFlags = match[1]
  const cleanPattern = match[2]
  const flags = [...new Set(rawFlags.split('').filter(f => 'ims'.includes(f)))].join('')
  return { cleanPattern, flags }
}

function matchesMessageReceived(trigger, eventData) {
  const config = trigger.config || {}

  // Proteção contra loop: ignorar mensagens que não são do lead (outbound, agente, sistema)
  // Tolerante à ausência dos campos — só rejeita quando há indicativo explícito
  if (eventData.direction === 'outbound')        return false
  if (eventData.from_agent === true)             return false
  if (eventData.sender_type === 'agent')         return false
  if (eventData.sender_type === 'system')        return false
  if (eventData.origin === 'system')             return false
  if (eventData.is_from_me === true)             return false

  // Filtro por instância WhatsApp
  if (config.instanceId && config.instanceId !== eventData.instance_id) return false

  // Filtro por tipo de sessão: só dispara em novas conversas
  // Somente bloqueia se o dispatcher explicitamente marcou is_new_conversation = false
  if (config.sessionControl === 'new_conversation' && eventData.is_new_conversation === false) return false

  const comparisonType = config.comparisonType || config.keywordMatch || 'contains'

  // Filtro especial: mensagem gerada por link click-to-chat.
  // Não usa keywords — dispara apenas quando entry_point_source === CLICK_TO_CHAT_LINK_SOURCE.
  // null é tratado como "não veio de link" (versões antigas da Uazapi ou integrações sem metadata).
  if (comparisonType === 'link_origin') {
    if (eventData.entry_point_source !== CLICK_TO_CHAT_LINK_SOURCE) return false
    return true
  }

  // Filtro por palavras-chave / expressão regular
  // Fallback hardened: Array.isArray evita aceitar objeto ou string corrompida do JSONB
  const keywords = Array.isArray(config.keywords)
    ? config.keywords
    : config.keyword
      ? [config.keyword]
      : []

  if (keywords.length > 0) {
    const rawText = String(eventData.text || eventData.message_text || '')

    if (comparisonType === 'regex') {
      // Regex: testar contra texto bruto (não normalizado) para respeitar acentos da expressão.
      // keywords[0] é o único padrão — múltiplos padrões regex não são suportados.
      const pattern = keywords[0] || ''
      if (!pattern) return true
      if (pattern.length > 500) return false
      try {
        const { cleanPattern, flags } = extractInlineFlags(pattern)
        const re = new RegExp(cleanPattern, flags)
        if (!re.test(rawText)) return false
      } catch (_e) {
        // Regex inválida: não disparar (fail-safe)
        return false
      }
    } else {
      // Para contains / equals / all: normalizar texto e keywords (lowercase + sem acentos)
      const text = normalizeText(rawText)
      const normalizedKeywords = keywords.map(normalizeText)

      if (comparisonType === 'equals') {
        if (!normalizedKeywords.some(kw => text === kw)) return false
      } else if (comparisonType === 'all') {
        if (!normalizedKeywords.every(kw => text.includes(kw))) return false
      } else {
        // 'contains' e qualquer outro valor: mensagem deve conter ao menos uma keyword
        if (!normalizedKeywords.some(kw => text.includes(kw))) return false
      }
    }
  }

  return true
}

export {
  CLICK_TO_CHAT_LINK_SOURCE,
  matchesTriggerConditions,
  matchesLeadCreated,
  matchesOpportunityStageChanged,
  matchesOpportunityCreated,
  matchesOpportunityWon,
  matchesOpportunityLost,
  matchesOpportunityOwner,
  matchesTag,
  matchesMessageReceived,
  normalizeText,
  extractInlineFlags,
}
