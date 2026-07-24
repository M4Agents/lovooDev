// =====================================================
// CONTEXT UTILS — utilitários compartilhados do context
//
// Centraliza helpers que operam sobre o AutomationContext
// para evitar duplicação entre módulos do motor.
//
// Sem imports de src/ — standalone.
// =====================================================

/**
 * Resolve o leadId a partir do context.
 *
 * Prioridade:
 *   1. context._resolvedLeadId  — cache de resolução anterior no mesmo ciclo
 *   2. context.leadId           — definido diretamente na execução
 *   3. banco: opportunities.lead_id via context.opportunityId
 *
 * Após resolver pelo banco, armazena em context._resolvedLeadId para
 * evitar queries repetidas no mesmo ciclo de execução.
 *
 * IMPORTANTE — blindagem de _resolvedLeadId:
 *   - É exclusivamente um cache em memória (escopo do ciclo de execução atual)
 *   - NÃO faz parte do contrato público do AutomationContext
 *   - NÃO deve entrar em context.variables
 *   - NÃO deve entrar em output_data de automation_logs
 *   - NÃO deve ser serializado ou retornado em respostas de API
 *   - NÃO é persistido no banco em nenhum momento
 *   - Não sobrevive entre ciclos: cada resumeFromNode constrói um context novo
 *
 * @param {import('./contextTypes.js').AutomationContext} context
 * @param {object} supabase - cliente supabaseAdmin
 * @returns {Promise<number|null>}
 */
export async function resolveLeadId(context, supabase) {
  // Cache: resolução já feita neste ciclo de execução
  if (context._resolvedLeadId) return context._resolvedLeadId

  // Fonte direta — já presente no context
  if (context.leadId) {
    context._resolvedLeadId = context.leadId
    return context.leadId
  }

  // Sem opportunityId — não há como resolver pelo banco
  if (!context.opportunityId) return null

  const { data: opp } = await supabase
    .from('opportunities')
    .select('lead_id')
    .eq('id', context.opportunityId)
    .maybeSingle()

  const leadId = opp?.lead_id || null

  if (leadId) {
    // Cache interno: evita nova query se outro nó no mesmo ciclo precisar do leadId.
    // Não serializar nem persistir este campo — ver IMPORTANTE acima.
    context._resolvedLeadId = leadId
  }

  return leadId
}

/**
 * Resolve o opportunityId a partir do context.
 *
 * Prioridade:
 *   1. context._resolvedOpportunityId — cache de resolução anterior no mesmo ciclo
 *   2. context.opportunityId          — definido diretamente na execução
 *   3. banco: opportunities mais recente e ativa do lead (via context.leadId)
 *
 * A busca pelo banco filtra status NOT IN ('won', 'lost') para nunca
 * usar uma oportunidade já encerrada, e ordena por created_at DESC para
 * sempre pegar a mais recente.
 *
 * IMPORTANTE — blindagem de _resolvedOpportunityId:
 *   Mesmas regras de _resolvedLeadId: cache em memória, não serializar,
 *   não persistir, não retornar em API, não sobrevive entre ciclos.
 *
 * @param {import('./contextTypes.js').AutomationContext} context
 * @param {object} supabase - cliente supabaseAdmin
 * @returns {Promise<string|null>}
 */
export async function resolveOpportunityId(context, supabase) {
  // Cache: resolução já feita neste ciclo
  if (context._resolvedOpportunityId) return context._resolvedOpportunityId

  // Fonte direta — já presente no context
  if (context.opportunityId) {
    context._resolvedOpportunityId = context.opportunityId
    return context.opportunityId
  }

  // Sem leadId — não há como resolver pelo banco
  const leadId = context.leadId || context._resolvedLeadId
  if (!leadId || !context.companyId) return null

  const { data: opp, error } = await supabase
    .from('opportunities')
    .select('id')
    .eq('lead_id', leadId)
    .eq('company_id', context.companyId)
    .not('status', 'in', '("won","lost")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn('[contextUtils] resolveOpportunityId: erro ao buscar oportunidade:', error.message)
    return null
  }

  const opportunityId = opp?.id || null

  if (opportunityId) {
    context._resolvedOpportunityId = opportunityId
  }

  return opportunityId
}

/**
 * Normaliza telefone para dígitos com DDI 55 quando aplicável.
 * Espelha a regra usada pelo whatsappSender (sem export circular).
 */
function cleanPhoneNumber(phone) {
  let clean = String(phone || '').replace(/\D/g, '')
  if (!clean.startsWith('55') && clean.length <= 11) clean = '55' + clean
  return clean
}

/**
 * Persiste conversation_id na execução para sobreviver a pause/resume (delay).
 *
 * Atualiza:
 *   - context.conversationId / context.triggerData / context.variables (memória)
 *   - automation_executions.trigger_data.conversation_id (fonte de verdade no resume)
 *   - automation_executions.variables.conversation_id (preservado pelo delayHandler)
 *
 * Fail-safe: falha de persistência não aborta o nó chamador (só loga).
 *
 * @param {import('./contextTypes.js').AutomationContext} context
 * @param {string} conversationId
 * @param {object} supabase
 * @returns {Promise<void>}
 */
export async function persistConversationId(context, conversationId, supabase) {
  if (!conversationId || !context?.executionId || !context?.companyId) return

  context.conversationId = conversationId
  context.triggerData = {
    ...(context.triggerData || {}),
    conversation_id: conversationId,
  }
  context.variables = {
    ...(context.variables || {}),
    conversation_id: conversationId,
  }

  try {
    const { data: execution, error: readErr } = await supabase
      .from('automation_executions')
      .select('trigger_data, variables')
      .eq('id', context.executionId)
      .eq('company_id', context.companyId)
      .maybeSingle()

    if (readErr) {
      console.warn('[contextUtils] persistConversationId: falha ao ler execução:', readErr.message)
      return
    }
    if (!execution) {
      console.warn('[contextUtils] persistConversationId: execução não encontrada', {
        executionId: context.executionId,
        companyId: context.companyId,
      })
      return
    }

    const nextTriggerData = {
      ...(execution.trigger_data || {}),
      conversation_id: conversationId,
    }
    const nextVariables = {
      ...(execution.variables || {}),
      ...(context.variables || {}),
      conversation_id: conversationId,
    }

    const { error: writeErr } = await supabase
      .from('automation_executions')
      .update({
        trigger_data: nextTriggerData,
        variables: nextVariables,
      })
      .eq('id', context.executionId)
      .eq('company_id', context.companyId)

    if (writeErr) {
      console.warn('[contextUtils] persistConversationId: falha ao gravar:', writeErr.message)
    }
  } catch (err) {
    console.warn('[contextUtils] persistConversationId: erro inesperado:', err?.message)
  }
}

/**
 * Resolve conversationId para nós que dependem de conversa (ex.: attach_agent).
 *
 * Prioridade:
 *   1. context.conversationId
 *   2. trigger_data.conversation_id / conversationId
 *   3. variables.conversation_id
 *   4. lookup por lead_id na empresa (conversa active mais recente)
 *   5. lookup por telefone do lead (conversa active mais recente)
 *
 * @param {import('./contextTypes.js').AutomationContext} context
 * @param {object} supabase
 * @returns {Promise<{ conversationId: string|null, source: string|null }>}
 */
export async function resolveConversationId(context, supabase) {
  if (context?.conversationId) {
    return { conversationId: context.conversationId, source: 'context' }
  }

  const fromTrigger =
    context?.triggerData?.conversation_id
    ?? context?.triggerData?.conversationId
    ?? null
  if (fromTrigger) {
    return { conversationId: fromTrigger, source: 'trigger_data' }
  }

  const fromVariables = context?.variables?.conversation_id ?? null
  if (fromVariables) {
    return { conversationId: fromVariables, source: 'variables' }
  }

  if (!context?.companyId) {
    return { conversationId: null, source: null }
  }

  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) {
    return { conversationId: null, source: null }
  }

  const { data: byLead, error: byLeadErr } = await supabase
    .from('chat_conversations')
    .select('id')
    .eq('company_id', context.companyId)
    .eq('lead_id', leadId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (byLeadErr) {
    console.warn('[contextUtils] resolveConversationId: erro lookup lead_id:', byLeadErr.message)
  } else if (byLead?.id) {
    return { conversationId: byLead.id, source: 'lead_id_lookup' }
  }

  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('id, phone')
    .eq('id', leadId)
    .eq('company_id', context.companyId)
    .maybeSingle()

  if (leadErr) {
    console.warn('[contextUtils] resolveConversationId: erro ao buscar lead:', leadErr.message)
    return { conversationId: null, source: null }
  }

  if (!lead?.phone) {
    return { conversationId: null, source: null }
  }

  const phone = cleanPhoneNumber(lead.phone)
  const { data: byPhone, error: byPhoneErr } = await supabase
    .from('chat_conversations')
    .select('id')
    .eq('company_id', context.companyId)
    .eq('contact_phone', phone)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (byPhoneErr) {
    console.warn('[contextUtils] resolveConversationId: erro lookup phone:', byPhoneErr.message)
    return { conversationId: null, source: null }
  }

  if (byPhone?.id) {
    return { conversationId: byPhone.id, source: 'phone_lookup' }
  }

  return { conversationId: null, source: null }
}

/**
 * Extrai conversation_id de uma linha de automation_executions (resume/start).
 *
 * @param {{ trigger_data?: object, variables?: object }} execution
 * @returns {string|null}
 */
export function readConversationIdFromExecution(execution) {
  if (!execution) return null
  return (
    execution.trigger_data?.conversation_id
    ?? execution.trigger_data?.conversationId
    ?? execution.variables?.conversation_id
    ?? null
  )
}
