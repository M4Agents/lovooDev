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
