// @ts-check
/**
 * distributionHandler.js
 *
 * Executa o nó `distribution` no motor de automação backend.
 * Suporta apenas estratégia `round_robin` nesta versão.
 *
 * Contrato de retorno (sempre estruturado, nunca lança exception):
 *   { executed: true,  method, selectedUserId, eligibleUserIds, indexUsed, assignedLead, assignedOpportunity }
 *   { skipped: true, reason: '<motivo legível>' }
 */

'use strict'

/**
 * Executa a distribuição de um lead/oportunidade entre usuários elegíveis.
 *
 * @param {object} node      - Nó do flow (shape React Flow: config em node.data.config)
 * @param {object} context   - Contexto corrente da execução (companyId, leadId, opportunityId…)
 * @param {object} supabase  - Cliente Supabase Admin (service_role)
 * @returns {Promise<object>} Resultado estruturado da execução
 */
export async function executeDistribution(node, context, supabase) {
  const config = node?.data?.config ?? {}

  // ----------------------------------------------------------------
  // A. Validação de contexto obrigatório
  // ----------------------------------------------------------------
  if (!context?.companyId) {
    return { skipped: true, reason: 'context.companyId ausente — distribuição não pode ser executada' }
  }

  // ----------------------------------------------------------------
  // B. Validação de config
  // ----------------------------------------------------------------
  const method = config.method
  if (!method) {
    return { skipped: true, reason: 'config.method ausente no nó distribution' }
  }

  const configUsers = Array.isArray(config.users) ? config.users : []
  if (configUsers.length === 0) {
    return { skipped: true, reason: 'config.users vazio — nenhum usuário configurado no nó' }
  }

  // ----------------------------------------------------------------
  // C. Apenas round_robin suportado nesta versão
  // ----------------------------------------------------------------
  if (method !== 'round_robin') {
    return { skipped: true, reason: `método '${method}' não suportado nesta versão — use round_robin` }
  }

  // ----------------------------------------------------------------
  // D. Buscar usuários elegíveis: ativos + na lista da config + mesma empresa
  // ----------------------------------------------------------------
  const { data: activeUsers, error: usersError } = await supabase
    .from('company_users')
    .select('user_id')
    .eq('company_id', context.companyId)
    .eq('is_active', true)
    .in('user_id', configUsers)

  if (usersError) {
    return { skipped: true, reason: `erro ao buscar usuários elegíveis: ${usersError.message}` }
  }

  const eligibleUsers = activeUsers ?? []

  if (eligibleUsers.length === 0) {
    return { skipped: true, reason: 'nenhum usuário elegível ativo encontrado na empresa com a configuração atual' }
  }

  // ----------------------------------------------------------------
  // E. Chamar RPC atômica para obter próximo índice de round-robin
  // ----------------------------------------------------------------
  const { data: rpcResult, error: rpcError } = await supabase.rpc(
    'automation_distribution_next_user',
    {
      p_company_id: context.companyId,
      p_user_count: eligibleUsers.length,
    }
  )

  if (rpcError) {
    return { skipped: true, reason: `erro na RPC de round-robin: ${rpcError.message}` }
  }

  // rpcResult é o INTEGER retornado pela função
  const nextIndex = typeof rpcResult === 'number' ? rpcResult : 0

  // ----------------------------------------------------------------
  // F. Índice seguro e seleção do usuário
  // ----------------------------------------------------------------
  const safeIndex    = nextIndex % eligibleUsers.length
  const selectedUser = eligibleUsers[safeIndex]
  const selectedUserId = selectedUser.user_id

  // ----------------------------------------------------------------
  // G. Atribuições — falhas parciais não quebram a execução inteira
  // ----------------------------------------------------------------
  let assignedLead        = false
  let assignedOpportunity = false
  const assignmentErrors  = []

  if (context.leadId) {
    const { error: leadError } = await supabase
      .from('leads')
      .update({ responsible_user_id: selectedUserId })
      .eq('id', context.leadId)
      .eq('company_id', context.companyId)

    if (leadError) {
      assignmentErrors.push(`lead ${context.leadId}: ${leadError.message}`)
    } else {
      assignedLead = true
    }
  }

  if (context.opportunityId) {
    const { error: oppError } = await supabase
      .from('opportunities')
      .update({ owner_user_id: selectedUserId })
      .eq('id', context.opportunityId)
      .eq('company_id', context.companyId)

    if (oppError) {
      assignmentErrors.push(`opportunity ${context.opportunityId}: ${oppError.message}`)
    } else {
      assignedOpportunity = true
    }
  }

  // ----------------------------------------------------------------
  // H. Nenhuma entidade atribuível — retorno informativo (não erro)
  // ----------------------------------------------------------------
  if (!context.leadId && !context.opportunityId) {
    return {
      skipped: true,
      reason: 'nenhuma entidade atribuível encontrada no context (leadId e opportunityId ausentes)',
    }
  }

  // ----------------------------------------------------------------
  // I. Resultado rico — sempre estruturado para o createLog do executor
  // ----------------------------------------------------------------
  return {
    executed:            true,
    method:              'round_robin',
    selectedUserId,
    eligibleUserIds:     eligibleUsers.map((u) => u.user_id),
    indexUsed:           safeIndex,
    assignedLead,
    assignedOpportunity,
    ...(assignmentErrors.length > 0 && { assignmentErrors }),
  }
}
