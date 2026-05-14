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
