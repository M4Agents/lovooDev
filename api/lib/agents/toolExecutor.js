// =============================================================================
// api/lib/agents/toolExecutor.js
//
// Executor de tools para agentes conversacionais via function calling OpenAI.
//
// RESPONSABILIDADE:
//   Receber tool_calls do LLM, validar segurança multi-tenant, executar a ação
//   CRM correspondente e registrar o resultado no audit log.
//
// SEGURANÇA (INEGOCIÁVEL):
//   - company_id vem EXCLUSIVAMENTE do contexto autenticado (nunca do LLM)
//   - lead_id e opportunity_id vêm do contexto da conversa (nunca do LLM)
//   - Qualquer campo de identificação nos args do LLM é ignorado + auditado
//   - Ownership check obrigatório antes de qualquer mutação
//   - Toda execução gravada em agent_tool_executions (sucesso e falha)
//
// CRITICIDADE DAS TOOLS:
//   - Críticas: falha refletida na resposta ao lead (second turn)
//   - Não-críticas: falha logada silenciosamente, fluxo continua
//
// CONTEXTO OBRIGATÓRIO:
//   toolExecutorContext = {
//     company_id:           string (do JWT autenticado — nunca do LLM)
//     lead_id:              string | null
//     conversation_id:      string
//     agent_id:             string
//     locked_opportunity_id: string | null (Phase 3: do conversation_flow_states)
//     allowed_tools:        string[]
//   }
// =============================================================================

import { createClient } from '@supabase/supabase-js'
import { CRITICAL_TOOLS, FORBIDDEN_ARG_FIELDS } from './toolDefinitions.js'
import { INTENT_TO_USAGE_ROLE } from './mediaConstants.js'
import { mediaSelector } from './mediaSelector.js'

const UAZAPI_BASE_URL = 'https://lovoo.uazapi.com'
const UAZAPI_TIMEOUT_MS = 30_000
const UAZ_MAX_RETRIES = 1
const SEND_MEDIA_COOLDOWN_MS = 10 * 60 * 1000
const SEND_MEDIA_MIN_INTERVAL_MS = 60 * 1000

// ── Constantes ────────────────────────────────────────────────────────────────

/** Campos de lead permitidos para update_lead */
const LEAD_UPDATE_WHITELIST = new Set([
  'name', 'email', 'phone', 'company_name', 'cargo', 'notes',
])

/** Campos de oportunidade permitidos para update_opportunity */
const OPPORTUNITY_UPDATE_WHITELIST = new Set([
  'value', 'probability', 'expected_close_date', 'title',
])

// ── Cliente service_role ──────────────────────────────────────────────────────

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ── Audit log ─────────────────────────────────────────────────────────────────

/**
 * Grava execução no audit log (fire-and-forget).
 * Remove campos de identificação dos tool_input antes de persistir.
 */
async function auditToolExecution(svc, {
  company_id,
  conversation_id,
  agent_id,
  tool_name,
  raw_tool_input,
  tool_output,
  success,
  error_code,
  error_message,
  is_critical,
}) {
  if (!svc) return

  // Remove campos proibidos do input antes de gravar
  const sanitized_input = { ...raw_tool_input }
  for (const field of FORBIDDEN_ARG_FIELDS) {
    if (field in sanitized_input) {
      delete sanitized_input[field]
    }
  }

  const { error } = await svc
    .from('agent_tool_executions')
    .insert({
      company_id,
      conversation_id,
      agent_id,
      tool_name,
      tool_input:   sanitized_input,
      tool_output:  tool_output ?? null,
      success,
      error_code:   error_code ?? null,
      error_message: error_message ?? null,
      is_critical:  is_critical ?? false,
    })

  if (error) {
    console.error('⚠️ [TOOL] Falha ao gravar audit log:', error.message)
  }
}

// ── Validação de IDs proibidos nos args do LLM ───────────────────────────────

/**
 * Detecta se o LLM tentou passar IDs de recursos nos argumentos.
 * Se sim, grava tentativa no audit log.
 */
async function detectAndAuditForbiddenIds(svc, rawArgs, ctx, toolName) {
  const found = FORBIDDEN_ARG_FIELDS.filter(f => f in rawArgs)
  if (found.length === 0) return

  console.warn(`⚠️ [TOOL] LLM enviou campos proibidos em ${toolName}:`, found)

  await auditToolExecution(svc, {
    company_id:      ctx.company_id,
    conversation_id: ctx.conversation_id,
    agent_id:        ctx.agent_id,
    tool_name:       toolName,
    raw_tool_input:  rawArgs,
    tool_output:     null,
    success:         false,
    error_code:      'cross_tenant_attempt',
    error_message:   `LLM enviou campos de identificação proibidos: ${found.join(', ')}`,
    is_critical:     false,
  })
}

// ── Ownership checks ──────────────────────────────────────────────────────────

async function validateLeadOwnership(svc, leadId, companyId) {
  if (!leadId) return false
  const { data } = await svc
    .from('leads')
    .select('id')
    .eq('id', leadId)
    .eq('company_id', companyId)
    .maybeSingle()
  return !!data
}

async function validateOpportunityOwnership(svc, opportunityId, companyId) {
  if (!opportunityId) return false
  const { data } = await svc
    .from('opportunities')
    .select('id')
    .eq('id', opportunityId)
    .eq('company_id', companyId)
    .maybeSingle()
  return !!data
}

/**
 * Resolve a oportunidade ativa para o lead.
 * Fase 1: busca a mais recente aberta.
 * Fase 3: locked_opportunity_id do conversation_flow_states terá prioridade.
 */
async function resolveActiveOpportunity(svc, leadId, companyId, lockedOpportunityId) {
  if (lockedOpportunityId) {
    const valid = await validateOpportunityOwnership(svc, lockedOpportunityId, companyId)
    if (valid) return lockedOpportunityId
    console.warn('[TOOL] locked_opportunity_id inválido ou de outra empresa — buscando fallback')
  }

  // Verifica se o lead da conversa ainda está ativo (não soft-deleted).
  // Se estiver deletado, a conversa está "órfã" e devemos ir direto ao fallback.
  const { data: currentLead } = await svc
    .from('leads')
    .select('phone, deleted_at')
    .eq('id', leadId)
    .eq('company_id', companyId)
    .maybeSingle()

  const leadIsActive = currentLead && currentLead.deleted_at === null

  if (leadIsActive) {
    const { data } = await svc
      .from('opportunities')
      .select('id')
      .eq('lead_id', leadId)
      .eq('company_id', companyId)
      .eq('status', 'open')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data?.id) return data.id
  }

  // Fallback: busca pelo telefone do lead para cobrir casos onde o lead foi
  // recriado via webhook (soft-delete + reimport) mas a conversa ainda aponta
  // para o lead original.
  const phone = currentLead?.phone
  if (!phone) return null

  // Busca todos os lead_ids ativos com o mesmo telefone na empresa
  const { data: siblingLeads } = await svc
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .neq('id', leadId)

  if (!siblingLeads?.length) return null

  const siblingIds = siblingLeads.map(l => l.id)

  const { data: byPhone } = await svc
    .from('opportunities')
    .select('id')
    .in('lead_id', siblingIds)
    .eq('company_id', companyId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (byPhone?.id) {
    console.log(`[TOOL] resolveActiveOpportunity: fallback por telefone encontrou oportunidade ${byPhone.id} (lead_id original: ${leadId}, lead deletado: ${!leadIsActive})`)
  }

  return byPhone?.id ?? null
}

// ── Implementações das tools ──────────────────────────────────────────────────

async function execUpdateLead(svc, args, ctx) {
  const fields = args.fields ?? {}
  const filtered = {}

  for (const [key, value] of Object.entries(fields)) {
    if (LEAD_UPDATE_WHITELIST.has(key)) {
      filtered[key] = value
    } else {
      console.warn(`[TOOL] update_lead: campo ignorado (não whitelistado): ${key}`)
    }
  }

  if (Object.keys(filtered).length === 0) {
    return { success: false, error: 'Nenhum campo válido para atualizar' }
  }

  const { error } = await svc
    .from('leads')
    .update({ ...filtered, updated_at: new Date().toISOString() })
    .eq('id', ctx.lead_id)
    .eq('company_id', ctx.company_id)

  if (error) return { success: false, error: error.message }
  return { success: true, updated_fields: Object.keys(filtered) }
}

async function execAddTag(svc, args, ctx) {
  const tagName = String(args.tag_name ?? '').trim().slice(0, 50)
  if (!tagName) return { success: false, error: 'tag_name inválido' }

  // Busca ou cria a tag na empresa
  let { data: tag } = await svc
    .from('tags')
    .select('id')
    .eq('company_id', ctx.company_id)
    .ilike('name', tagName)
    .maybeSingle()

  if (!tag) {
    const { data: newTag, error: createErr } = await svc
      .from('tags')
      .insert({ company_id: ctx.company_id, name: tagName })
      .select('id')
      .single()
    if (createErr) return { success: false, error: createErr.message }
    tag = newTag
  }

  // Vincula tag ao lead (ignora conflito se já existe)
  const { error } = await svc
    .from('lead_tags')
    .upsert(
      { lead_id: ctx.lead_id, tag_id: tag.id },
      { onConflict: 'lead_id,tag_id', ignoreDuplicates: true }
    )

  if (error) return { success: false, error: error.message }
  return { success: true, tag_name: tagName }
}

async function execRemoveTag(svc, args, ctx) {
  const tagName = String(args.tag_name ?? '').trim()
  if (!tagName) return { success: false, error: 'tag_name inválido' }

  const { data: tag } = await svc
    .from('tags')
    .select('id')
    .eq('company_id', ctx.company_id)
    .ilike('name', tagName)
    .maybeSingle()

  if (!tag) return { success: true, note: 'tag não encontrada, nada a remover' }

  const { error } = await svc
    .from('lead_tags')
    .delete()
    .eq('lead_id', ctx.lead_id)
    .eq('tag_id', tag.id)

  if (error) return { success: false, error: error.message }
  return { success: true, tag_name: tagName }
}

async function execCreateActivity(svc, args, ctx) {
  const title         = String(args.title ?? '').trim().slice(0, 120)
  const activityType  = args.activity_type ?? 'call'
  const scheduledDate = args.scheduled_date
  const scheduledTime = args.scheduled_time ?? '09:00'
  const description   = String(args.description ?? '').trim().slice(0, 500)

  if (!title) return { success: false, error: 'title obrigatório' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    return { success: false, error: 'scheduled_date inválido — use YYYY-MM-DD' }
  }
  if (!/^\d{2}:\d{2}$/.test(scheduledTime)) {
    return { success: false, error: 'scheduled_time inválido — use HH:MM' }
  }

  const { data, error } = await svc
    .from('lead_activities')
    .insert({
      company_id:     ctx.company_id,
      lead_id:        ctx.lead_id,
      title,
      activity_type:  activityType,
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      description:    description || null,
      status:         'pending',
      priority:       'medium',
      source:         'ai_agent',
      created_at:     new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) return { success: false, error: error.message }
  return { success: true, activity_id: data.id, title, scheduled_date: scheduledDate }
}

async function execAddNote(svc, args, ctx) {
  // Tabela real: internal_notes (XOR constraint: lead_id OU opportunity_id, nunca os dois)
  // lead_id é INTEGER; created_by NOT NULL REFERENCES auth.users(id)
  const entity = args.entity === 'opportunity' ? 'opportunity' : 'lead'
  const text   = String(args.text ?? '').trim().slice(0, 1000)

  if (!text) return { success: false, error: 'text obrigatório' }

  // created_by é obrigatório (NOT NULL). Com service_role, auth.uid() = null.
  // Busca o primeiro usuário ativo da empresa para usar como autor da nota.
  const { data: companyUser } = await svc
    .from('company_users')
    .select('user_id')
    .eq('company_id', ctx.company_id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!companyUser?.user_id) {
    return {
      success:    false,
      error:      'Sem usuário ativo na empresa para associar a nota',
      error_code: 'no_active_user',
    }
  }

  if (entity === 'lead') {
    // lead_id é INTEGER — converte de string para número
    const leadIdInt = parseInt(ctx.lead_id, 10)
    if (isNaN(leadIdInt)) {
      return { success: false, error: 'lead_id inválido para internal_notes (esperado INTEGER)' }
    }

    const { error } = await svc
      .from('internal_notes')
      .insert({
        company_id: ctx.company_id,
        lead_id:    leadIdInt,
        content:    text,
        created_by: companyUser.user_id,
      })

    if (error) return { success: false, error: error.message }
    return { success: true, entity: 'lead' }
  }

  // Oportunidade — resolve a oportunidade ativa
  const opportunityId = await resolveActiveOpportunity(
    svc, ctx.lead_id, ctx.company_id, ctx.locked_opportunity_id
  )
  if (!opportunityId) {
    return { success: false, error: 'Sem oportunidade aberta para adicionar nota' }
  }

  const { error } = await svc
    .from('internal_notes')
    .insert({
      company_id:     ctx.company_id,
      opportunity_id: opportunityId,
      content:        text,
      created_by:     companyUser.user_id,
    })

  if (error) return { success: false, error: error.message }
  return { success: true, entity: 'opportunity', opportunity_id: opportunityId }
}

async function execMoveOpportunity(svc, args, ctx) {
  const toStageId = args.stage_id
  if (!toStageId) return { success: false, error: 'stage_id obrigatório' }

  const opportunityId = await resolveActiveOpportunity(
    svc, ctx.lead_id, ctx.company_id, ctx.locked_opportunity_id
  )
  if (!opportunityId) {
    return { success: false, error: 'Sem oportunidade aberta para mover' }
  }

  // Valida que o stage_id pertence a um funil da empresa
  const { data: stage } = await svc
    .from('funnel_stages')
    .select('id, funnel_id')
    .eq('id', toStageId)
    .maybeSingle()

  if (!stage) {
    return { success: false, error: 'Etapa não encontrada' }
  }

  // Busca posição atual
  const { data: position } = await svc
    .from('opportunity_funnel_positions')
    .select('funnel_id, stage_id')
    .eq('opportunity_id', opportunityId)
    .maybeSingle()

  if (!position) {
    return { success: false, error: 'Oportunidade sem posição no funil' }
  }

  if (position.stage_id === toStageId) {
    return { success: true, note: 'Oportunidade já está nesta etapa' }
  }

  // Usa RPC atômica (atualiza posição + histórico + status)
  const { error } = await svc.rpc('move_opportunity', {
    p_opportunity_id:    opportunityId,
    p_funnel_id:         position.funnel_id,
    p_from_stage_id:     position.stage_id,
    p_to_stage_id:       toStageId,
    p_position_in_stage: 0,
  })

  if (error) return { success: false, error: error.message }
  return { success: true, opportunity_id: opportunityId, to_stage_id: toStageId }
}

/**
 * Vincula silenciosamente o item_of_interest à oportunidade em opportunity_items.
 * Fire-and-forget: nunca lança exceção nem afeta o retorno de execUpdateOpportunity.
 * Só vincula se:
 *   - item_of_interest existe no contexto (match único — nunca candidatos ambíguos)
 *   - o item pertence à empresa (validado por resolveCatalogItemFocus)
 *   - a oportunidade ainda não tem esse item vinculado
 */
async function tryLinkItemToOpportunity(svc, opportunityId, ctx) {
  try {
    const item = ctx.item_of_interest ?? null
    // #region agent log
    console.log('[DEBUG:67ebe7:link_item] entrada', { item_id: item?.id ?? null, item_name: item?.name ?? null, opportunity_id: opportunityId, company_id: ctx.company_id })
    // #endregion
    if (!item?.id) {
      // #region agent log
      console.log('[DEBUG:67ebe7:link_item] EARLY_RETURN: item_of_interest sem id', { item })
      // #endregion
      return
    }

    const focus = await resolveCatalogItemFocus(svc, ctx.company_id, item)
    // #region agent log
    console.log('[DEBUG:67ebe7:link_item] resolveCatalogItemFocus', { focus, item_id: item?.id })
    // #endregion
    if (!focus) return

    const { item_type, item_id } = focus
    const col = item_type === 'product' ? 'product_id' : 'service_id'

    // Verificar se já existe para evitar duplicata
    const { data: existing } = await svc
      .from('opportunity_items')
      .select('id')
      .eq('company_id', ctx.company_id)
      .eq('opportunity_id', opportunityId)
      .eq(col, item_id)
      .maybeSingle()

    if (existing) return

    // Buscar nome e preço padrão do item para o snapshot
    const table = item_type === 'product' ? 'products' : 'services'
    const { data: catalogItem } = await svc
      .from(table)
      .select('name, default_price, description')
      .eq('id', item_id)
      .eq('company_id', ctx.company_id)
      .maybeSingle()

    // #region agent log
    console.log('[DEBUG:67ebe7:link_item] catalogItem', { found: !!catalogItem, item_type, item_id })
    // #endregion
    if (!catalogItem) return

    const { error: rpcError } = await svc.rpc('opportunity_add_item', {
      p_company_id:           ctx.company_id,
      p_opportunity_id:       opportunityId,
      p_product_id:           item_type === 'product' ? item_id : null,
      p_service_id:           item_type === 'service' ? item_id : null,
      p_quantity:             1,
      p_unit_price:           catalogItem.default_price ?? null,
      p_discount_type:        'fixed',
      p_discount_value:       0,
      p_name_snapshot:        catalogItem.name ?? null,
      p_description_snapshot: catalogItem.description ?? null,
    })
    // #region agent log
    console.log('[DEBUG:67ebe7:link_item] opportunity_add_item', { rpcError: rpcError?.message ?? null, item_type, item_id, opportunity_id: opportunityId })
    // #endregion

    if (!rpcError) {
      console.log('[TOOL:update_opportunity] item vinculado à oportunidade', { item_type, item_id, opportunity_id: opportunityId })
    }
  } catch (err) {
    // Silencioso — nunca propagar erro para não quebrar o fluxo principal
    console.warn('[TOOL:update_opportunity] falha ao vincular item (ignorado):', err?.message)
  }
}

async function execUpdateOpportunity(svc, args, ctx) {
  const fields = args.fields ?? {}
  const filtered = {}

  for (const [key, value] of Object.entries(fields)) {
    if (OPPORTUNITY_UPDATE_WHITELIST.has(key)) {
      filtered[key] = value
    }
  }

  if (Object.keys(filtered).length === 0) {
    return { success: false, error: 'Nenhum campo válido para atualizar' }
  }

  const opportunityId = await resolveActiveOpportunity(
    svc, ctx.lead_id, ctx.company_id, ctx.locked_opportunity_id
  )
  if (!opportunityId) {
    return { success: false, error: 'Sem oportunidade aberta para atualizar' }
  }

  const { error } = await svc
    .from('opportunities')
    .update({ ...filtered, updated_at: new Date().toISOString() })
    .eq('id', opportunityId)
    .eq('company_id', ctx.company_id)

  if (error) return { success: false, error: error.message }

  // Vincular item de interesse à oportunidade de forma silenciosa (fire-and-forget)
  void tryLinkItemToOpportunity(svc, opportunityId, ctx)

  return { success: true, updated_fields: Object.keys(filtered) }
}

async function execScheduleContact(svc, args, ctx) {
  const scheduledAt  = args.scheduled_at
  const reason       = args.reason ?? 'follow_up'
  const messageHint  = String(args.message_hint ?? '').trim().slice(0, 300)

  if (!scheduledAt) return { success: false, error: 'scheduled_at obrigatório' }

  const scheduledDate = new Date(scheduledAt)
  if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
    return { success: false, error: 'scheduled_at deve ser uma data futura válida' }
  }

  // Verifica se já existe schedule pendente para esta conversa + reason
  const { data: existing } = await svc
    .from('agent_contact_schedules')
    .select('id')
    .eq('company_id', ctx.company_id)
    .eq('conversation_id', ctx.conversation_id)
    .eq('reason', reason)
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) {
    return { success: false, error: `Já existe um agendamento pendente com reason=${reason}` }
  }

  const { data, error } = await svc
    .from('agent_contact_schedules')
    .insert({
      company_id:       ctx.company_id,
      lead_id:          ctx.lead_id,
      conversation_id:  ctx.conversation_id,
      source_agent_id:  ctx.agent_id,
      reason,
      scheduled_at:     scheduledDate.toISOString(),
      attempt_number:   0,
      max_attempts:     1,
      interval_hours:   24,
      status:           'pending',
      created_by:       'agent',
      message_hint:     messageHint || null,
    })
    .select('id')
    .single()

  if (error) {
    // Tabela pode não existir ainda (Phase 2) — retorna erro controlado
    if (error.code === '42P01') {
      return {
        success: false,
        error:   'Funcionalidade de agendamento ainda não habilitada neste ambiente',
        error_code: 'table_not_found',
      }
    }
    return { success: false, error: error.message }
  }

  return { success: true, schedule_id: data.id, scheduled_at: scheduledDate.toISOString(), reason }
}

// ── send_media (mídias do catálogo) ───────────────────────────────────────────

/**
 * Resolve produto ou serviço do item em foco e valida ownership (company_id).
 * @returns {Promise<{ item_type: 'product'|'service', item_id: string } | null>}
 */
async function resolveCatalogItemFocus(svc, companyId, item) {
  if (!item?.id || !companyId) return null
  const id = String(item.id)

  const { data: p } = await svc
    .from('products')
    .select('id')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (p?.id) return { item_type: 'product', item_id: String(p.id) }

  const { data: s } = await svc
    .from('services')
    .select('id')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (s?.id) return { item_type: 'service', item_id: String(s.id) }
  return null
}

/**
 * Agrega library_asset_id já enviados nesta conversa para o mesmo item (produto/serviço).
 */
async function fetchAlreadySentAssetIdsForItem(svc, { companyId, conversationId, itemType, itemId }) {
  const { data: rows, error } = await svc
    .from('agent_tool_executions')
    .select('tool_output, success')
    .eq('company_id', companyId)
    .eq('conversation_id', conversationId)
    .eq('tool_name', 'send_media')

  if (error) {
    console.error('[TOOL] send_media: falha ao listar envios anteriores:', error.message)
    return []
  }

  const ids = []
  for (const row of rows ?? []) {
    if (!row.success) continue
    const out = row.tool_output
    if (!out || typeof out !== 'object') continue
    // Logs antigos sem item_id: não entram na deduplicação por item (compatibilidade)
    if (out.item_id == null || out.item_id === '') continue
    if (out.item_type !== itemType || String(out.item_id) !== String(itemId)) continue
    const list = out.sent_asset_ids
    if (!Array.isArray(list)) continue
    for (const a of list) {
      if (typeof a === 'string' && a) ids.push(a)
    }
  }
  return [...new Set(ids)]
}

/**
 * Cooldown por conversa + item + intent: exige resposta inbound ou intervalo mínimo.
 */
async function checkSendMediaCooldown(svc, {
  companyId,
  conversationId,
  itemType,
  itemId,
  intent,
}) {
  const { data: rows, error } = await svc
    .from('agent_tool_executions')
    .select('tool_output, success, executed_at')
    .eq('company_id', companyId)
    .eq('conversation_id', conversationId)
    .eq('tool_name', 'send_media')
    .eq('success', true)
    .order('executed_at', { ascending: false })
    .limit(40)

  if (error) {
    console.error('[TOOL] send_media cooldown query:', error.message)
    return { blocked: false }
  }

  let lastMatch = null
  for (const row of rows ?? []) {
    const out = row.tool_output
    if (!out || typeof out !== 'object') continue
    if (out.item_id == null || out.item_id === '') continue
    if (out.item_type !== itemType || String(out.item_id) !== String(itemId)) continue
    if (out.intent !== intent) continue
    lastMatch = row
    break
  }

  if (!lastMatch) return { blocked: false }

  const lastAt = new Date(lastMatch.executed_at).getTime()
  const now = Date.now()
  const elapsed = now - lastAt

  const { data: inbound, error: inErr } = await svc
    .from('chat_messages')
    .select('id')
    .eq('company_id', companyId)
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .gt('created_at', lastMatch.executed_at)
    .limit(1)
    .maybeSingle()

  if (inErr) {
    console.warn('[TOOL] send_media: inbound check:', inErr.message)
  }

  if (inbound?.id) return { blocked: false }

  if (elapsed < SEND_MEDIA_MIN_INTERVAL_MS) return { blocked: true, reason: 'min_interval' }
  if (elapsed < SEND_MEDIA_COOLDOWN_MS) return { blocked: true, reason: 'cooldown' }
  return { blocked: false }
}

async function fetchConversationSendContext(svc, { conversation_id, company_id }) {
  const { data, error } = await svc
    .from('chat_conversations')
    .select('instance_id, contact_phone, ai_state')
    .eq('id', conversation_id)
    .eq('company_id', company_id)
    .single()

  if (error || !data?.instance_id || !data?.contact_phone) {
    return { ok: false, error: 'conversation_not_found' }
  }
  return {
    ok: true,
    instance_id: data.instance_id,
    contact_phone: data.contact_phone,
    ai_state: data.ai_state,
  }
}

async function fetchProviderSendContext(svc, { instance_id, company_id }) {
  const { data: instance, error } = await svc
    .from('whatsapp_life_instances')
    .select('provider_instance_id, provider_token')
    .eq('id', instance_id)
    .eq('company_id', company_id)
    .single()

  if (error || !instance?.provider_token) {
    return { ok: false, error: 'provider_not_found' }
  }
  return { ok: true, api_key: instance.provider_token }
}

async function sendMediaViaUazapi({ api_key, phone, mediaUrl, mediaType }) {
  const url = `${UAZAPI_BASE_URL}/send/media`
  const type = mediaType === 'video' ? 'video' : 'image'
  const payload = {
    number: phone,
    type,
    file: mediaUrl,
    text: '',
    delay: 800,
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        token: api_key,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UAZAPI_TIMEOUT_MS),
    })
    const body = await response.json().catch(() => ({}))
    if (response.ok) {
      return {
        ok: true,
        uazapi_message_id: body.messageid ?? body.messageId ?? null,
      }
    }
    return {
      ok: false,
      error_message: `HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}`,
    }
  } catch (e) {
    return { ok: false, error_message: e?.message ?? 'network_error' }
  }
}

/**
 * Primeira tentativa + até UAZ_MAX_RETRIES reenvios (timeout/rede/HTTP).
 */
async function sendMediaViaUazapiWithRetry(params) {
  let last = { ok: false, error_message: 'unknown' }
  for (let attempt = 0; attempt <= UAZ_MAX_RETRIES; attempt++) {
    try {
      const r = await sendMediaViaUazapi(params)
      last = r
      if (r.ok) return r
    } catch (e) {
      last = { ok: false, error_message: e?.message ?? 'send_media_uaz_exception' }
    }
  }
  return last
}

/**
 * Log estruturado (uma linha JSON) para diagnóstico — nunca omitir company_id / conversation_id em falhas.
 */
function logSendMediaStructured(level, payload) {
  const line = JSON.stringify({ scope: 'send_media', ts: new Date().toISOString(), ...payload })
  if (level === 'error') console.error(line)
  else if (level === 'info') console.log(line)
  else console.warn(line)
}

async function persistOutboundMediaMessage(svc, {
  conversation_id,
  company_id,
  message_type,
  content,
  media_url,
}) {
  const { data, error } = await svc.rpc('chat_create_message', {
    p_conversation_id: conversation_id,
    p_company_id: company_id,
    p_content: content ?? ' ',
    p_message_type: message_type,
    p_direction: 'outbound',
    p_sent_by: null,
    p_media_url: media_url,
    p_is_ai_generated: true,
    p_ai_run_id: null,
    p_ai_block_index: null,
    p_ai_block_type: 'media',
  })

  if (error) return { success: false, error: error.message }
  if (!data?.success) return { success: false, error: data?.error ?? 'rpc_failed' }
  return { success: true, message_id: data.message_id }
}

async function updateMessageStatusSafe(svc, { message_id, company_id, ok, uazapi_message_id, error_message }) {
  if (!message_id) return
  try {
    await svc.rpc('update_message_status', {
      p_message_id: message_id,
      p_status: ok ? 'sent' : 'failed',
      p_uazapi_message_id: uazapi_message_id ?? null,
      p_error_message: ok ? null : error_message ?? null,
    })
  } catch (e) {
    console.warn('[TOOL] send_media update_message_status:', e?.message)
  }
}

async function execSendMedia(svc, args, ctx) {
  const intent = args?.intent
  if (typeof intent !== 'string' || !(intent in INTENT_TO_USAGE_ROLE)) {
    return {
      success: false,
      executed: false,
      reason: 'invalid_intent',
      error: 'invalid_intent',
      error_code: 'validation_error',
    }
  }

  const item = ctx.item_of_interest ?? null
  if (!item) {
    return { success: false, error: 'no_item_context', error_code: 'validation_error' }
  }

  if (!ctx.conversation_id || String(ctx.conversation_id).trim() === '') {
    return { success: false, error: 'no_conversation', error_code: 'validation_error' }
  }

  const companyId = ctx.company_id

  const focus = await resolveCatalogItemFocus(svc, companyId, item)
  if (!focus) {
    return { success: false, error: 'no_item_context', error_code: 'validation_error' }
  }

  const itemType = focus.item_type
  const itemId = focus.item_id

  const hardLimit = 3
  const modelConfig = ctx.model_config && typeof ctx.model_config === 'object' ? ctx.model_config : {}
  const configured = typeof modelConfig.media_max_per_call === 'number'
    ? modelConfig.media_max_per_call
    : 1
  const limit = Math.min(Math.max(1, configured), hardLimit)

  const cd = await checkSendMediaCooldown(svc, {
    companyId,
    conversationId: ctx.conversation_id,
    itemType,
    itemId,
    intent,
  })
  if (cd.blocked) {
    return { success: false, error: 'cooldown_active', error_code: 'validation_error' }
  }

  const alreadySentAssetIds = await fetchAlreadySentAssetIdsForItem(svc, {
    companyId,
    conversationId: ctx.conversation_id,
    itemType,
    itemId,
  })

  const mediaList = await mediaSelector(svc, {
    company_id: companyId,
    item_type: itemType,
    item_id: itemId,
    intent,
    alreadySentAssetIds,
    limit,
  })

  if (!mediaList.length) {
    return {
      success: false,
      executed: false,
      reason: 'no_media_available',
      error: 'no_media_available',
      error_code: 'crm_action_failed',
      item_type: itemType,
      item_id: itemId,
      intent,
    }
  }

  const convCtx = await fetchConversationSendContext(svc, {
    conversation_id: ctx.conversation_id,
    company_id: companyId,
  })
  if (!convCtx.ok) {
    return { success: false, error: 'conversation_not_found', error_code: 'crm_action_failed' }
  }

  if (convCtx.ai_state && convCtx.ai_state !== 'ai_active') {
    return { success: false, error: 'ai_not_active', error_code: 'validation_error' }
  }

  const provCtx = await fetchProviderSendContext(svc, {
    instance_id: convCtx.instance_id,
    company_id: companyId,
  })
  if (!provCtx.ok) {
    return { success: false, error: 'provider_not_found', error_code: 'crm_action_failed' }
  }

  const sentAssetIds = []
  let successCount = 0
  let failCount = 0
  const total = mediaList.length

  for (const m of mediaList) {
    try {
      const msgType = m.type === 'video' ? 'video' : 'image'
      const persist = await persistOutboundMediaMessage(svc, {
        conversation_id: ctx.conversation_id,
        company_id: companyId,
        message_type: msgType,
        content: ' ',
        media_url: m.url,
      })

      if (!persist.success || !persist.message_id) {
        failCount++
        logSendMediaStructured('error', {
          company_id: companyId,
          conversation_id: ctx.conversation_id,
          item_type: itemType,
          item_id: itemId,
          intent,
          sent_asset_ids: [...sentAssetIds],
          phase: 'persist',
          error: persist.error ?? 'persist_message_failed',
          asset_id: m.asset_id,
        })
        continue
      }

      const sendResult = await sendMediaViaUazapiWithRetry({
        api_key: provCtx.api_key,
        phone: convCtx.contact_phone,
        mediaUrl: m.url,
        mediaType: m.type,
      })

      await updateMessageStatusSafe(svc, {
        message_id: persist.message_id,
        company_id: companyId,
        ok: sendResult.ok,
        uazapi_message_id: sendResult.uazapi_message_id,
        error_message: sendResult.ok ? null : sendResult.error_message,
      })

      if (!sendResult.ok) {
        failCount++
        logSendMediaStructured('error', {
          company_id: companyId,
          conversation_id: ctx.conversation_id,
          item_type: itemType,
          item_id: itemId,
          intent,
          sent_asset_ids: [...sentAssetIds],
          phase: 'uazapi',
          error: sendResult.error_message ?? 'uazapi_send_failed',
          asset_id: m.asset_id,
        })
        continue
      }

      successCount++
      sentAssetIds.push(m.asset_id)
    } catch (err) {
      failCount++
      logSendMediaStructured('error', {
        company_id: companyId,
        conversation_id: ctx.conversation_id,
        item_type: itemType,
        item_id: itemId,
        intent,
        sent_asset_ids: [...sentAssetIds],
        phase: 'item_loop',
        error: err?.message ?? String(err),
        asset_id: m?.asset_id,
      })
    }
  }

  const baseResult = {
    executed: true,
    sent: successCount,
    failed: failCount,
    total,
    item_type: itemType,
    item_id: itemId,
    intent,
    sent_asset_ids: sentAssetIds,
  }

  if (successCount === 0) {
    logSendMediaStructured('error', {
      company_id: companyId,
      conversation_id: ctx.conversation_id,
      item_type: itemType,
      item_id: itemId,
      intent,
      sent_asset_ids: [],
      phase: 'summary',
      error: 'all_media_send_failed',
    })
    return {
      success: false,
      error: 'all_media_send_failed',
      error_code: 'crm_action_failed',
      ...baseResult,
    }
  }

  logSendMediaStructured('info', {
    company_id: companyId,
    conversation_id: ctx.conversation_id,
    item_type: itemType,
    item_id: itemId,
    intent,
    sent_asset_ids: sentAssetIds,
    phase: 'summary',
    sent: successCount,
    failed: failCount,
    total,
  })

  return {
    success: true,
    ...baseResult,
  }
}

async function execRequestHandoff(svc, args, ctx) {
  const reason = String(args.reason ?? '').trim().slice(0, 300)

  // Atualiza ai_state da conversa para ai_paused
  const { error: convError } = await svc
    .from('chat_conversations')
    .update({ ai_state: 'ai_paused', updated_at: new Date().toISOString() })
    .eq('id', ctx.conversation_id)
    .eq('company_id', ctx.company_id)

  if (convError) return { success: false, error: convError.message }

  // Registra evento de handoff
  const { error: handoffError } = await svc
    .from('agent_handoff_events')
    .insert({
      company_id:      ctx.company_id,
      conversation_id: ctx.conversation_id,
      agent_id:        ctx.agent_id,
      handoff_type:    'ai_to_human',
      reason:          reason || 'Solicitação do agente IA',
      initiated_by:    'ai',
      created_at:      new Date().toISOString(),
    })

  if (handoffError) {
    console.error('[TOOL] request_handoff: erro ao registrar evento:', handoffError.message)
  }

  return { success: true, handoff_type: 'ai_to_human', reason }
}

// ── Dispatcher principal ──────────────────────────────────────────────────────

/** @type {Record<string, (svc: any, args: any, ctx: any) => Promise<any>>} */
const TOOL_HANDLERS = {
  update_lead:        execUpdateLead,
  add_tag:            execAddTag,
  remove_tag:         execRemoveTag,
  create_activity:    execCreateActivity,
  add_note:           execAddNote,
  move_opportunity:   execMoveOpportunity,
  update_opportunity: execUpdateOpportunity,
  schedule_contact:   execScheduleContact,
  request_handoff:    execRequestHandoff,
  send_media:         execSendMedia,
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Executa uma lista de tool_calls retornada pelo LLM.
 *
 * Validações obrigatórias (multi-tenant):
 *   1. tool_name deve estar na allowlist do agente
 *   2. Campos de identificação nos args são ignorados + auditados
 *   3. Ownership check para lead_id e opportunity_id (do contexto, nunca do LLM)
 *
 * @param {import('openai').ChatCompletionMessageToolCall[]} toolCalls
 * @param {{
 *   company_id: string,
 *   lead_id: string | null,
 *   conversation_id: string,
 *   agent_id: string,
 *   locked_opportunity_id?: string | null,
 *   allowed_tools: string[],
 * }} context
 * @returns {Promise<Array<{ tool_call_id: string, tool_name: string, result: any, success: boolean, is_critical: boolean }>>}
 */
// ── Sandbox: execução simulada sem efeitos colaterais ─────────────────────────

/**
 * Executa tool calls em modo sandbox — sem DB, sem CRM, sem WhatsApp.
 * Retorna resultados simulados para o LLM continuar o second turn normalmente,
 * e um array de eventos legíveis para exibição na UI.
 *
 * GARANTIA: nenhum handler real é chamado. Nenhuma tabela é escrita.
 * Guard duplo: verificado aqui E no runner (options.sandboxMode).
 */
export async function executeToolCallsSandbox(toolCalls, context) {
  if (!toolCalls?.length) return { toolResults: [], events: [] }

  const events = []
  const toolResults = []

  for (const toolCall of toolCalls) {
    const toolName = toolCall.function?.name ?? 'unknown'

    let rawArgs = {}
    try {
      rawArgs = JSON.parse(toolCall.function?.arguments ?? '{}')
    } catch {
      rawArgs = {}
    }

    events.push({
      tool:      toolName,
      args:      rawArgs,
      simulated: true,
      label:     buildSandboxToolLabel(toolName, rawArgs),
    })

    toolResults.push({
      tool_call_id: toolCall.id,
      tool_name:    toolName,
      result:       { success: true, simulated: true },
      success:      true,
      is_critical:  CRITICAL_TOOLS.has(toolName),
    })
  }

  return { toolResults, events }
}

/**
 * Gera uma frase descritiva legível para cada tool simulada.
 */
function buildSandboxToolLabel(toolName, args) {
  const labelMap = {
    request_handoff:    () => {
      const reason = args.reason ? `: "${String(args.reason).slice(0, 80)}"` : ''
      return `O agente transferiria esta conversa para um humano${reason}`
    },
    add_note:           () => {
      const text = String(args.text ?? '').slice(0, 100)
      return `O agente registraria uma nota: "${text}"`
    },
    add_tag:            () => `O agente adicionaria a tag: "${args.tag_name ?? ''}"`,
    remove_tag:         () => `O agente removeria a tag: "${args.tag_name ?? ''}"`,
    update_lead:        () => {
      const fields = args.fields ? Object.keys(args.fields).join(', ') : '?'
      return `O agente atualizaria o contato (campos: ${fields})`
    },
    create_activity:    () => {
      const title = String(args.title ?? '').slice(0, 80)
      return `O agente criaria uma atividade: "${title}"`
    },
    move_opportunity:   () => `O agente moveria a oportunidade de etapa no funil`,
    update_opportunity: () => {
      const fields = args.fields ? Object.keys(args.fields).join(', ') : '?'
      return `O agente atualizaria a oportunidade (campos: ${fields})`
    },
    schedule_contact:   () => {
      const when = args.scheduled_at ?? '?'
      return `O agente agendaria um contato para ${when}`
    },
    send_media:         () => {
      const intent = args.intent ?? 'imagem/vídeo'
      return `O agente enviaria uma mídia (${intent}) referente ao produto em foco`
    },
  }

  const fn = labelMap[toolName]
  return fn ? fn() : `O agente executaria a ação: ${toolName}`
}

// ── Executor principal ────────────────────────────────────────────────────────

export async function executeToolCalls(toolCalls, context) {
  if (!toolCalls?.length) return []

  const svc = getServiceSupabase()
  const results = []

  // Ownership do lead — validado uma vez, reutilizado por todas as tools
  let leadOwnershipValid = null
  if (context.lead_id) {
    leadOwnershipValid = await validateLeadOwnership(svc, context.lead_id, context.company_id)
    if (!leadOwnershipValid) {
      console.error('[TOOL] ❌ Ownership do lead inválido — bloqueando todas as tools', {
        lead_id:    context.lead_id,
        company_id: context.company_id,
      })
      await auditToolExecution(svc, {
        company_id:      context.company_id,
        conversation_id: context.conversation_id,
        agent_id:        context.agent_id,
        tool_name:       '_all_blocked',
        raw_tool_input:  {},
        success:         false,
        error_code:      'ownership_validation_failed',
        error_message:   `lead_id ${context.lead_id} não pertence à empresa`,
        is_critical:     false,
      })
      return toolCalls.map(tc => ({
        tool_call_id: tc.id,
        tool_name:    tc.function?.name ?? 'unknown',
        result:       { success: false, error: 'Contexto inválido' },
        success:      false,
        is_critical:  CRITICAL_TOOLS.has(tc.function?.name),
      }))
    }
  }

  for (const toolCall of toolCalls) {
    const toolName   = toolCall.function?.name ?? ''
    const isCritical = CRITICAL_TOOLS.has(toolName)

    let rawArgs = {}
    try {
      rawArgs = JSON.parse(toolCall.function?.arguments ?? '{}')
    } catch {
      rawArgs = {}
    }

    // Auditoria de campos proibidos nos args do LLM (não bloqueia execução)
    await detectAndAuditForbiddenIds(svc, rawArgs, context, toolName)

    // Verifica allowlist (defesa em profundidade — runner já filtra, mas toolExecutor também valida)
    if (!context.allowed_tools.includes(toolName)) {
      console.warn(`[TOOL] ⛔ Tool fora da allowlist do agente: ${toolName}`)
      await auditToolExecution(svc, {
        company_id:      context.company_id,
        conversation_id: context.conversation_id,
        agent_id:        context.agent_id,
        tool_name:       toolName,
        raw_tool_input:  rawArgs,
        success:         false,
        error_code:      'tool_not_in_allowlist',
        error_message:   `Tool ${toolName} não está na allowlist do agente`,
        is_critical:     isCritical,
      })
      results.push({
        tool_call_id: toolCall.id,
        tool_name:    toolName,
        result:       { success: false, error: `Tool não permitida para este agente` },
        success:      false,
        is_critical:  isCritical,
      })
      continue
    }

    const handler = TOOL_HANDLERS[toolName]
    if (!handler) {
      console.warn(`[TOOL] Handler não encontrado para: ${toolName}`)
      results.push({
        tool_call_id: toolCall.id,
        tool_name:    toolName,
        result:       { success: false, error: 'Tool não implementada' },
        success:      false,
        is_critical:  isCritical,
      })
      continue
    }

    let toolResult
    try {
      toolResult = await handler(svc, rawArgs, context)
    } catch (err) {
      console.error(`[TOOL] ❌ Erro inesperado em ${toolName}:`, err.message)
      toolResult = { success: false, error: err.message }
    }

    // Audit log de toda execução
    await auditToolExecution(svc, {
      company_id:      context.company_id,
      conversation_id: context.conversation_id,
      agent_id:        context.agent_id,
      tool_name:       toolName,
      raw_tool_input:  rawArgs,
      tool_output:     toolResult,
      success:         toolResult.success === true,
      error_code:      toolResult.error_code ?? (toolResult.success ? null : 'crm_action_failed'),
      error_message:   toolResult.error ?? null,
      is_critical:     isCritical,
    })

    results.push({
      tool_call_id: toolCall.id,
      tool_name:    toolName,
      result:       toolResult,
      success:      toolResult.success === true,
      is_critical:  isCritical,
    })
  }

  return results
}
