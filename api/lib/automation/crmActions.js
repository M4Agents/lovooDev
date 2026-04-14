// =====================================================
// CRM ACTIONS — núcleo mínimo backend
//
// Ações CRM suportadas:
//   move_opportunity        — RPC move_opportunity (via opportunity_funnel_positions)
//   update_lead             — atualiza campos diretos do lead
//   assign_lead_owner       — define responsible_user_id no lead
//   assign_opportunity_owner— define owner_user_id na oportunidade
//   assign_owner            — alias legado → assign_lead_owner (warning)
//   add_tag                 — busca/cria tag e vincula ao lead
//   remove_tag              — remove vínculo de tag do lead
//   win_opportunity         — status = 'won' + closed_at
//   lose_opportunity        — status = 'lost' + closed_at
//   create_opportunity      — cria nova oportunidade para o lead
//   set_custom_field        — upsert em lead_custom_values
//   attach_agent            — ativa agente de IA na conversa (ai_state = ai_active)
//   detach_agent            — desativa agente de IA na conversa (ai_state = ai_inactive)
//
// resolveLeadId centralizado em contextUtils.js
// Sem imports de src/ — usa supabaseAdmin como parâmetro.
// =====================================================

import { resolveLeadId } from './contextUtils.js'

// ---------------------------------------------------------------------------
// Utilitário: validar membership do usuário na empresa
// ---------------------------------------------------------------------------

async function validateMembership(userId, companyId, supabase) {
  const { data } = await supabase
    .from('company_users')
    .select('user_id')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle()
  return !!data
}

// ---------------------------------------------------------------------------
// Ação: mover oportunidade de stage
// Depende exclusivamente da RPC move_opportunity.
// opportunities.stage_id NÃO existe no schema — o stage fica em
// opportunity_funnel_positions, que é o que a RPC atualiza atomicamente.
// ---------------------------------------------------------------------------

async function moveOpportunity(config, context, supabase) {
  const opportunityId = context.opportunityId
  const stageId = config.stageId

  if (!opportunityId) throw new Error('opportunityId ausente no contexto')
  if (!stageId)       throw new Error('stageId não configurado na ação move_opportunity')

  const { data: position, error: posError } = await supabase
    .from('opportunity_funnel_positions')
    .select('funnel_id, stage_id')
    .eq('opportunity_id', opportunityId)
    .maybeSingle()

  if (posError) throw new Error(`Erro ao buscar posição no funil: ${posError.message}`)

  if (!position) {
    throw new Error(`Oportunidade ${opportunityId} não tem posição registrada no funil — não é possível mover sem RPC`)
  }

  const { error } = await supabase.rpc('move_opportunity', {
    p_opportunity_id:    opportunityId,
    p_funnel_id:         position.funnel_id,
    p_from_stage_id:     position.stage_id,
    p_to_stage_id:       stageId,
    p_position_in_stage: 0,
  })

  if (error) throw new Error(`Erro na RPC move_opportunity: ${error.message}`)
  return { executed: true, action: 'move_opportunity', opportunityId, stageId, method: 'rpc' }
}

// ---------------------------------------------------------------------------
// Ação: atualizar campos do lead
// ---------------------------------------------------------------------------

async function updateLead(config, context, supabase) {
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) throw new Error('leadId ausente no contexto e sem opportunityId para resolver')

  const fields = config.fields
  if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
    throw new Error('Nenhum campo configurado para atualização do lead')
  }

  const { error } = await supabase
    .from('leads')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', Number(leadId))
    .eq('company_id', context.companyId)

  if (error) throw new Error(`Erro ao atualizar lead: ${error.message}`)
  return { executed: true, action: 'update_lead', leadId, fields: Object.keys(fields) }
}

// ---------------------------------------------------------------------------
// Ação: atribuir responsável ao lead
// Coluna: leads.responsible_user_id
// ---------------------------------------------------------------------------

async function assignLeadOwner(config, context, supabase) {
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) throw new Error('leadId ausente no contexto')

  const ownerId = config.userId
  if (!ownerId) throw new Error('userId não configurado na ação assign_lead_owner')

  const valid = await validateMembership(ownerId, context.companyId, supabase)
  if (!valid) throw new Error(`Usuário ${ownerId} não encontrado ou inativo na empresa`)

  const { error } = await supabase
    .from('leads')
    .update({ responsible_user_id: ownerId, updated_at: new Date().toISOString() })
    .eq('id', Number(leadId))
    .eq('company_id', context.companyId)

  if (error) throw new Error(`Erro ao atribuir responsável ao lead: ${error.message}`)
  return { executed: true, action: 'assign_lead_owner', leadId, ownerId }
}

// ---------------------------------------------------------------------------
// Ação: atribuir responsável à oportunidade
// Coluna: opportunities.owner_user_id (não owner_id)
// ---------------------------------------------------------------------------

async function assignOpportunityOwner(config, context, supabase) {
  const opportunityId = context.opportunityId
  if (!opportunityId) throw new Error('opportunityId ausente no contexto')

  const ownerId = config.userId
  if (!ownerId) throw new Error('userId não configurado na ação assign_opportunity_owner')

  const valid = await validateMembership(ownerId, context.companyId, supabase)
  if (!valid) throw new Error(`Usuário ${ownerId} não encontrado ou inativo na empresa`)

  const { error } = await supabase
    .from('opportunities')
    .update({ owner_user_id: ownerId, updated_at: new Date().toISOString() })
    .eq('id', opportunityId)
    .eq('company_id', context.companyId)

  if (error) throw new Error(`Erro ao atribuir responsável à oportunidade: ${error.message}`)
  return { executed: true, action: 'assign_opportunity_owner', opportunityId, ownerId }
}

// ---------------------------------------------------------------------------
// Ação: adicionar tag ao lead
// ---------------------------------------------------------------------------

const TAG_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#F97316']

async function addTag(config, context, supabase) {
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) throw new Error('leadId ausente no contexto')

  const tagName = config.tagName
  if (!tagName) throw new Error('tagName não configurado na ação add_tag')

  let { data: tag } = await supabase
    .from('lead_tags')
    .select('id')
    .eq('company_id', context.companyId)
    .eq('name', tagName)
    .eq('is_active', true)
    .maybeSingle()

  if (!tag) {
    const color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]
    const { data: newTag, error: tagError } = await supabase
      .from('lead_tags')
      .insert({ company_id: context.companyId, name: tagName, color, is_active: true, created_at: new Date().toISOString() })
      .select('id')
      .single()

    if (tagError) throw new Error(`Erro ao criar tag "${tagName}": ${tagError.message}`)
    tag = newTag
  }

  const { data: existing } = await supabase
    .from('lead_tag_assignments')
    .select('id')
    .eq('lead_id', Number(leadId))
    .eq('tag_id', tag.id)
    .maybeSingle()

  if (existing) {
    return { executed: true, action: 'add_tag', leadId, tagName, tagId: tag.id, alreadyExists: true }
  }

  const { error } = await supabase
    .from('lead_tag_assignments')
    .insert({ lead_id: Number(leadId), tag_id: tag.id, created_at: new Date().toISOString() })

  if (error) throw new Error(`Erro ao vincular tag ao lead: ${error.message}`)
  return { executed: true, action: 'add_tag', leadId, tagName, tagId: tag.id }
}

// ---------------------------------------------------------------------------
// Ação: remover tag do lead
// ---------------------------------------------------------------------------

async function removeTag(config, context, supabase) {
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) throw new Error('leadId ausente no contexto')

  const tagName = config.tagName
  if (!tagName) throw new Error('tagName não configurado na ação remove_tag')

  const { data: tag } = await supabase
    .from('lead_tags')
    .select('id')
    .eq('company_id', context.companyId)
    .eq('name', tagName)
    .eq('is_active', true)
    .maybeSingle()

  if (!tag) {
    return { executed: true, action: 'remove_tag', leadId, tagName, notFound: true }
  }

  const { error } = await supabase
    .from('lead_tag_assignments')
    .delete()
    .eq('lead_id', Number(leadId))
    .eq('tag_id', tag.id)

  if (error) throw new Error(`Erro ao remover tag: ${error.message}`)
  return { executed: true, action: 'remove_tag', leadId, tagName, tagId: tag.id }
}

// ---------------------------------------------------------------------------
// Ação: marcar oportunidade como ganha
// Colunas reais: status, closed_at, actual_close_date, value, loss_reason
// ---------------------------------------------------------------------------

async function winOpportunity(config, context, supabase) {
  const opportunityId = context.opportunityId
  if (!opportunityId) throw new Error('opportunityId ausente no contexto')

  const now  = new Date()
  const updates = {
    status:            'won',
    closed_at:         now.toISOString(),
    actual_close_date: now.toISOString().split('T')[0],
    updated_at:        now.toISOString(),
  }

  if (config.finalValue !== undefined && config.finalValue !== null) {
    updates.value = config.finalValue
  }

  if (config.description) updates.description = config.description

  const { error } = await supabase
    .from('opportunities')
    .update(updates)
    .eq('id', opportunityId)
    .eq('company_id', context.companyId)

  if (error) throw new Error(`Erro ao marcar oportunidade como ganha: ${error.message}`)
  return { executed: true, action: 'win_opportunity', opportunityId }
}

// ---------------------------------------------------------------------------
// Ação: marcar oportunidade como perdida
// ---------------------------------------------------------------------------

async function loseOpportunity(config, context, supabase) {
  const opportunityId = context.opportunityId
  if (!opportunityId) throw new Error('opportunityId ausente no contexto')

  const now = new Date()
  const updates = {
    status:            'lost',
    closed_at:         now.toISOString(),
    actual_close_date: now.toISOString().split('T')[0],
    updated_at:        now.toISOString(),
  }

  if (config.lossReason)   updates.loss_reason  = config.lossReason
  if (config.description)  updates.description  = config.description

  const { error } = await supabase
    .from('opportunities')
    .update(updates)
    .eq('id', opportunityId)
    .eq('company_id', context.companyId)

  if (error) throw new Error(`Erro ao marcar oportunidade como perdida: ${error.message}`)
  return { executed: true, action: 'lose_opportunity', opportunityId, lossReason: config.lossReason || null }
}

// ---------------------------------------------------------------------------
// Ação: criar oportunidade para o lead
// opportunities NÃO tem funnel_id/stage_id diretos:
// a posição fica em opportunity_funnel_positions.
// ---------------------------------------------------------------------------

async function createOpportunity(config, context, supabase) {
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) throw new Error('leadId ausente no contexto')

  let { funnelId, stageId } = config

  // Resolver funil se não especificado
  if (!funnelId) {
    const { data: funnel } = await supabase
      .from('sales_funnels')
      .select('id')
      .eq('company_id', context.companyId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!funnel) throw new Error('Nenhum funil ativo encontrado para criar a oportunidade')
    funnelId = funnel.id
  }

  // Resolver stage inicial se não especificado
  if (!stageId) {
    const { data: stage } = await supabase
      .from('funnel_stages')
      .select('id')
      .eq('funnel_id', funnelId)
      .order('order_index', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!stage) throw new Error('Nenhuma etapa encontrada no funil')
    stageId = stage.id
  }

  // Buscar nome do lead para title padrão
  const { data: lead } = await supabase
    .from('leads')
    .select('name')
    .eq('id', Number(leadId))
    .maybeSingle()

  // Criar oportunidade (sem funnel_id/stage_id — ficam em opportunity_funnel_positions)
  const { data: opp, error: oppError } = await supabase
    .from('opportunities')
    .insert({
      company_id:  context.companyId,
      lead_id:     Number(leadId),
      title:       config.title || lead?.name || 'Nova oportunidade',
      value:       config.value || 0,
      probability: config.probability || 50,
      status:      'open',
      created_at:  new Date().toISOString(),
      updated_at:  new Date().toISOString(),
    })
    .select('id')
    .single()

  if (oppError) throw new Error(`Erro ao criar oportunidade: ${oppError.message}`)

  // Registrar posição no funil
  const { error: posError } = await supabase
    .from('opportunity_funnel_positions')
    .insert({
      opportunity_id:   opp.id,
      lead_id:          Number(leadId),
      funnel_id:        funnelId,
      stage_id:         stageId,
      position_in_stage: 0,
      entered_stage_at: new Date().toISOString(),
      updated_at:       new Date().toISOString(),
    })

  if (posError) {
    console.warn(`[crmActions] createOpportunity: oportunidade criada (${opp.id}) mas erro ao registrar posição no funil: ${posError.message}`)
  }

  return { executed: true, action: 'create_opportunity', opportunityId: opp.id, leadId, funnelId, stageId }
}

// ---------------------------------------------------------------------------
// Ação: definir campo personalizado do lead
// Upsert em lead_custom_values (field_id deve existir previamente).
// ---------------------------------------------------------------------------

async function setCustomField(config, context, supabase) {
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) throw new Error('leadId ausente no contexto')

  const fieldId = config.customFieldId
  const value   = config.customFieldValue

  if (!fieldId) throw new Error('customFieldId não configurado na ação set_custom_field')
  if (value === undefined || value === null || value === '') {
    throw new Error('customFieldValue não configurado na ação set_custom_field')
  }

  // Verificar se já existe valor para este campo
  const { data: existing } = await supabase
    .from('lead_custom_values')
    .select('id')
    .eq('lead_id', Number(leadId))
    .eq('field_id', fieldId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('lead_custom_values')
      .update({ value: String(value), updated_at: new Date().toISOString() })
      .eq('id', existing.id)

    if (error) throw new Error(`Erro ao atualizar campo personalizado: ${error.message}`)
    return { executed: true, action: 'set_custom_field', leadId, fieldId, value, result: 'updated' }
  }

  const { error } = await supabase
    .from('lead_custom_values')
    .insert({ lead_id: Number(leadId), field_id: fieldId, value: String(value) })

  if (error) throw new Error(`Erro ao criar valor de campo personalizado: ${error.message}`)
  return { executed: true, action: 'set_custom_field', leadId, fieldId, value, result: 'created' }
}

// ---------------------------------------------------------------------------
// Ativar agente de IA em uma conversa — define ai_state = 'ai_active'
//
// Regras de idempotência e troca controlada:
//   - se ai_inactive → ativa normalmente
//   - se ai_active + mesmo assignment → skip ("já ativo")
//   - se ai_active + assignment diferente + config.force !== true → skip ("outro agente ativo")
//   - se ai_active + assignment diferente + config.force === true → substitui agente
// ---------------------------------------------------------------------------

async function attachAgent(config, context, supabase) {
  const { companyId, conversationId } = context
  const agentId  = config.agentId
  const force    = config.force === true

  // Validações obrigatórias
  if (!agentId)        return { skipped: true, reason: '[attach_agent] agentId obrigatório na configuração' }
  if (!companyId)      return { skipped: true, reason: '[attach_agent] companyId obrigatório no contexto' }
  if (!conversationId) return { skipped: true, reason: 'conversationId obrigatório para attach_agent — conversa não encontrada no contexto' }

  // Buscar assignment ativo da empresa para o agente selecionado
  const { data: assignment, error: assignErr } = await supabase
    .from('company_agent_assignments')
    .select('id')
    .eq('company_id', companyId)
    .eq('agent_id', agentId)
    .eq('is_active', true)
    .maybeSingle()

  if (assignErr) throw new Error(`[attach_agent] erro ao buscar assignment: ${assignErr.message}`)
  if (!assignment) throw new Error(`[attach_agent] agente ${agentId} não encontrado ou inativo para a empresa ${companyId}`)

  // Buscar estado atual da conversa (multi-tenant)
  const { data: conv, error: convErr } = await supabase
    .from('chat_conversations')
    .select('id, ai_state, ai_assignment_id')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (convErr) throw new Error(`[attach_agent] erro ao buscar conversa: ${convErr.message}`)
  if (!conv)   throw new Error(`[attach_agent] conversa ${conversationId} não encontrada na empresa ${companyId}`)

  const previousAiState      = conv.ai_state
  const previousAssignmentId = conv.ai_assignment_id

  // Lógica de idempotência e troca controlada
  if (previousAiState === 'ai_active') {
    if (previousAssignmentId === assignment.id) {
      return {
        skipped: true,
        reason: 'Agente já está ativo nesta conversa',
        action: 'attach_agent',
        conversationId,
        assignmentId: assignment.id,
        previousAiState,
        newAiState: 'ai_active'
      }
    }

    // Assignment diferente — só substitui se force = true
    if (!force) {
      return {
        skipped: true,
        reason: 'Conversa já possui outro agente ativo. Use force: true para substituir.',
        action: 'attach_agent',
        conversationId,
        previousAssignmentId,
        newAssignmentId: assignment.id
      }
    }
  }

  const { error: updateErr } = await supabase
    .from('chat_conversations')
    .update({ ai_state: 'ai_active', ai_assignment_id: assignment.id })
    .eq('id', conversationId)
    .eq('company_id', companyId)

  if (updateErr) throw new Error(`[attach_agent] erro ao ativar agente: ${updateErr.message}`)

  const replaced = previousAiState === 'ai_active' && previousAssignmentId !== assignment.id
  console.log(`[attach_agent] agente ${agentId} ${replaced ? 'substituído' : 'ativado'} na conversa ${conversationId}`)

  return {
    executed: true,
    action: 'attach_agent',
    conversationId,
    agentId,
    assignmentId: assignment.id,
    previousAiState,
    newAiState: 'ai_active',
    previousAssignmentId,
    newAssignmentId: assignment.id,
    replaced
  }
}

// ---------------------------------------------------------------------------
// Desativar agente de IA em uma conversa — define ai_state = 'ai_inactive'
//
// Idempotente: se já estiver inativo, retorna skipped.
// ---------------------------------------------------------------------------

async function detachAgent(config, context, supabase) {
  const { companyId, conversationId } = context

  // Validações obrigatórias
  if (!companyId)      return { skipped: true, reason: '[detach_agent] companyId obrigatório no contexto' }
  if (!conversationId) return { skipped: true, reason: 'conversationId obrigatório para detach_agent — conversa não encontrada no contexto' }

  // Buscar estado atual da conversa (multi-tenant + idempotência)
  const { data: conv, error: convErr } = await supabase
    .from('chat_conversations')
    .select('id, ai_state, ai_assignment_id')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (convErr) throw new Error(`[detach_agent] erro ao buscar conversa: ${convErr.message}`)
  if (!conv)   throw new Error(`[detach_agent] conversa ${conversationId} não encontrada na empresa ${companyId}`)

  const previousAiState      = conv.ai_state
  const previousAssignmentId = conv.ai_assignment_id

  // Idempotência: já está inativo e sem assignment
  if (previousAiState === 'ai_inactive' && previousAssignmentId === null) {
    return {
      skipped: true,
      reason: 'Agente já está inativo nesta conversa',
      action: 'detach_agent',
      conversationId,
      previousAiState,
      newAiState: 'ai_inactive'
    }
  }

  const { error: updateErr } = await supabase
    .from('chat_conversations')
    .update({ ai_state: 'ai_inactive', ai_assignment_id: null })
    .eq('id', conversationId)
    .eq('company_id', companyId)

  if (updateErr) throw new Error(`[detach_agent] erro ao desativar agente: ${updateErr.message}`)

  console.log(`[detach_agent] agente desativado na conversa ${conversationId}`)
  return {
    executed: true,
    action: 'detach_agent',
    conversationId,
    previousAiState,
    newAiState: 'ai_inactive',
    previousAssignmentId,
    newAssignmentId: null
  }
}

// ---------------------------------------------------------------------------
// Entry point principal — chamado pelo executor.js
// ---------------------------------------------------------------------------

export async function executeCrmAction(node, context, supabase) {
  const config = node.data?.config || {}
  const actionType = config.actionType

  console.log(`[crmActions] executando: ${actionType}`)

  try {
    switch (actionType) {
      case 'move_opportunity':
        return await moveOpportunity(config, context, supabase)

      case 'update_lead':
        return await updateLead(config, context, supabase)

      case 'assign_lead_owner':
        return await assignLeadOwner(config, context, supabase)

      case 'assign_opportunity_owner':
        return await assignOpportunityOwner(config, context, supabase)

      // Alias legado — redireciona para assign_lead_owner com warning
      case 'assign_owner':
        console.warn('[crmActions] WARN: "assign_owner" é legado — use "assign_lead_owner". Redirecionando.')
        return await assignLeadOwner(config, context, supabase)

      case 'add_tag':
        return await addTag(config, context, supabase)

      case 'remove_tag':
        return await removeTag(config, context, supabase)

      case 'win_opportunity':
        return await winOpportunity(config, context, supabase)

      case 'lose_opportunity':
        return await loseOpportunity(config, context, supabase)

      case 'create_opportunity':
        return await createOpportunity(config, context, supabase)

      case 'set_custom_field':
        return await setCustomField(config, context, supabase)

      case 'attach_agent':
        return await attachAgent(config, context, supabase)

      case 'detach_agent':
        return await detachAgent(config, context, supabase)

      default:
        console.log(`[crmActions] ação não suportada nesta etapa: ${actionType} — skipped`)
        return { skipped: true, reason: `ação CRM não suportada nesta etapa: ${actionType}` }
    }
  } catch (err) {
    console.error(`[crmActions] erro em ${actionType}:`, err?.message)
    throw err
  }
}
