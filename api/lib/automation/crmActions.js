// =====================================================
// CRM ACTIONS — Etapa 4 do núcleo mínimo backend
//
// Ações CRM prioritárias para o executor backend.
// Sem imports de src/ — usa supabaseAdmin como parâmetro.
//
// Suportadas:
//   move_opportunity  — RPC move_opportunity + fallback direto
//   update_lead       — atualiza campos diretos do lead
//   assign_owner      — define responsible_user_id no lead
//   add_tag           — busca/cria tag e vincula ao lead
//   remove_tag        — remove vínculo de tag do lead
// =====================================================

// ---------------------------------------------------------------------------
// Utilitário: resolver leadId a partir do contexto
// ---------------------------------------------------------------------------

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
// Ação: mover oportunidade de stage
// Usa RPC atômica (atualiza posição + histórico).
// Fallback: atualiza stage_id direto se sem posição no funil.
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
    console.warn('[crmActions] moveOpportunity: sem posição no funil — usando fallback direto')
    const { error } = await supabase
      .from('opportunities')
      .update({ stage_id: stageId, updated_at: new Date().toISOString() })
      .eq('id', opportunityId)
      .eq('company_id', context.companyId)

    if (error) throw new Error(`Erro ao mover oportunidade (fallback): ${error.message}`)

    return { executed: true, action: 'move_opportunity', opportunityId, stageId, method: 'fallback' }
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
// Valida membership na empresa via company_users antes de atribuir.
// Coluna real: responsible_user_id
// ---------------------------------------------------------------------------

async function assignOwner(config, context, supabase) {
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) throw new Error('leadId ausente no contexto')

  const ownerId = config.userId
  if (!ownerId) throw new Error('userId não configurado na ação assign_owner')

  const { data: member } = await supabase
    .from('company_users')
    .select('user_id')
    .eq('user_id', ownerId)
    .eq('company_id', context.companyId)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) throw new Error(`Usuário ${ownerId} não encontrado ou inativo na empresa`)

  const { error } = await supabase
    .from('leads')
    .update({ responsible_user_id: ownerId, updated_at: new Date().toISOString() })
    .eq('id', Number(leadId))
    .eq('company_id', context.companyId)

  if (error) throw new Error(`Erro ao atribuir responsável: ${error.message}`)

  return { executed: true, action: 'assign_owner', leadId, ownerId }
}

// ---------------------------------------------------------------------------
// Ação: adicionar tag ao lead
// Busca tag pelo nome — cria se não existir.
// Idempotente: não duplica se vínculo já existe.
// ---------------------------------------------------------------------------

const TAG_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#F97316']

async function addTag(config, context, supabase) {
  const leadId = await resolveLeadId(context, supabase)
  if (!leadId) throw new Error('leadId ausente no contexto')

  const tagName = config.tagName
  if (!tagName) throw new Error('tagName não configurado na ação add_tag')

  // Buscar tag existente
  let { data: tag } = await supabase
    .from('lead_tags')
    .select('id')
    .eq('company_id', context.companyId)
    .eq('name', tagName)
    .eq('is_active', true)
    .maybeSingle()

  // Criar tag se não existir
  if (!tag) {
    const color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]
    const { data: newTag, error: tagError } = await supabase
      .from('lead_tags')
      .insert({
        company_id: context.companyId,
        name:       tagName,
        color,
        is_active:  true,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (tagError) throw new Error(`Erro ao criar tag "${tagName}": ${tagError.message}`)
    tag = newTag
  }

  // Verificar se vínculo já existe
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

      case 'assign_owner':
        return await assignOwner(config, context, supabase)

      case 'add_tag':
        return await addTag(config, context, supabase)

      case 'remove_tag':
        return await removeTag(config, context, supabase)

      default:
        console.log(`[crmActions] ação não suportada nesta etapa: ${actionType} — skipped`)
        return { skipped: true, reason: `ação CRM não suportada nesta etapa: ${actionType}` }
    }
  } catch (err) {
    console.error(`[crmActions] erro em ${actionType}:`, err?.message)
    throw err
  }
}
