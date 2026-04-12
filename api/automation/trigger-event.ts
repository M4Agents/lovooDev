// =====================================================
// API: POST /api/automation/trigger-event
//
// Recebe eventos do frontend (autenticado por JWT),
// valida contexto da empresa e oportunidade,
// aplica matchesTriggerConditions nos fluxos ativos
// e retorna quantos fluxos foram ativados.
//
// Inclui:
//   - auditoria persistente em automation_trigger_events
//   - deduplicação por janela de 60 segundos
//
// Sem AutomationEngine — escopo mínimo intencional.
// =====================================================

import { createClient } from '@supabase/supabase-js'
// @ts-ignore — arquivo JS ESM em api/lib/automation
import { matchesTriggerConditions } from '../lib/automation/triggerEvaluator.js'
// @ts-ignore — arquivo JS ESM em api/lib/automation
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
// @ts-ignore — arquivo JS ESM em api/lib/automation
import { createExecution, processFlowAsync } from '../lib/automation/executor.js'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_EVENT_TYPES = ['opportunity.stage_changed'] as const
type AllowedEventType = (typeof ALLOWED_EVENT_TYPES)[number]

// Janela de deduplicação: execuções criadas nos últimos 60 segundos
const DEDUP_WINDOW_MS = 60 * 1000

function isUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_REGEX.test(v)
}

// ---------------------------------------------------------------------------
// Auditoria: inserir registro em automation_trigger_events
// Fail-safe — nunca lança erro.
// ---------------------------------------------------------------------------

type TriggerStatus = 'triggered' | 'not_matched' | 'duplicate' | 'error'

async function logTriggerEvent(
  supabase: any,
  opts: {
    companyId:   string
    flowId:      string | null
    executionId: string | null
    eventType:   string
    status:      TriggerStatus
    matched:     boolean
    reason:      string | null
    dedupKey:    string | null
    payload:     Record<string, any>
  }
): Promise<void> {
  try {
    await supabase.from('automation_trigger_events').insert({
      company_id:   opts.companyId,
      flow_id:      opts.flowId      ?? null,
      execution_id: opts.executionId ?? null,
      event_type:   opts.eventType,
      status:       opts.status,
      matched:      opts.matched,
      reason:       opts.reason      ?? null,
      dedup_key:    opts.dedupKey    ?? null,
      payload:      opts.payload,
      triggered_at: new Date().toISOString(),
    })
  } catch (err: any) {
    // Nunca bloquear o fluxo por falha de auditoria
    console.warn(`[trigger-event][audit] falha ao gravar log (flow: ${opts.flowId}):`, err?.message)
  }
}

// ---------------------------------------------------------------------------
// Deduplicação: verifica se o mesmo flow já foi disparado recentemente
// Chave: company_id + flow_id + (opportunity_id OU lead_id)
// ---------------------------------------------------------------------------

function buildDedupKey(
  companyId: string,
  flowId: string,
  opportunityId: string | null,
  leadId: number | null,
): string {
  const entity = opportunityId ? `opp:${opportunityId}` : leadId ? `lead:${leadId}` : 'no-entity'
  return `${companyId}|${flowId}|${entity}`
}

async function isDuplicate(
  supabase: any,
  companyId: string,
  flowId: string,
  opportunityId: string | null,
  leadId: number | null,
): Promise<boolean> {
  const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString()

  let query = supabase
    .from('automation_executions')
    .select('id')
    .eq('company_id', companyId)
    .eq('flow_id', flowId)
    .gte('started_at', since)
    .limit(1)

  if (opportunityId) {
    query = query.eq('opportunity_id', opportunityId)
  } else if (leadId) {
    query = query.eq('lead_id', leadId)
  }

  const { data } = await query.maybeSingle()
  return !!data
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  // 1. Validar JWT do usuário
  const authorization = req.headers.authorization as string | undefined
  if (!authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Autenticação necessária' })
  }

  const url     = process.env.VITE_SUPABASE_URL     ?? ''
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? ''
  if (!url || !anonKey) {
    return res.status(500).json({ error: 'Supabase não configurado no servidor' })
  }

  const supabaseUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada' })
  }

  // 2. Validar body
  const { event_type, company_id, data } = req.body ?? {}

  if (!ALLOWED_EVENT_TYPES.includes(event_type)) {
    return res.status(400).json({ error: 'event_type não suportado', allowed: [...ALLOWED_EVENT_TYPES] })
  }
  if (!isUUID(company_id)) {
    return res.status(400).json({ error: 'company_id inválido ou ausente' })
  }
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Campo data é obrigatório e deve ser um objeto' })
  }

  const supabaseAdmin = getSupabaseAdmin()

  // Payload resumido — gravado em todos os registros de auditoria
  const auditPayload = {
    event_type,
    opportunity_id: data.opportunity_id || null,
    lead_id:        data.lead_id        || null,
    old_stage:      data.old_stage      || null,
    new_stage:      data.new_stage      || null,
  }

  // 3. Validar membership do usuário na empresa
  const { data: membership } = await supabaseAdmin
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', company_id)
    .maybeSingle()

  if (!membership) {
    return res.status(403).json({ error: 'Sem acesso à empresa informada' })
  }

  // 4. Validar que a oportunidade pertence à empresa (quando presente)
  if (data?.opportunity_id) {
    if (!isUUID(data.opportunity_id)) {
      return res.status(400).json({ error: 'opportunity_id inválido' })
    }
    const { data: opp } = await supabaseAdmin
      .from('opportunities')
      .select('id')
      .eq('id', data.opportunity_id)
      .eq('company_id', company_id)
      .maybeSingle()

    if (!opp) {
      return res.status(403).json({ error: 'Oportunidade não pertence à empresa informada' })
    }
  }

  // 5. Buscar fluxos ativos da empresa
  const { data: flows, error: flowsErr } = await supabaseAdmin
    .from('automation_flows')
    .select('id, name, nodes, edges, trigger_operator')
    .eq('company_id', company_id)
    .eq('is_active', true)

  if (flowsErr) {
    return res.status(500).json({ error: 'Erro ao buscar fluxos', detail: flowsErr.message })
  }

  const allFlows = flows ?? []

  const opportunityId = isUUID(data.opportunity_id) ? data.opportunity_id : null
  const leadId        = data.lead_id ? Number(data.lead_id) : null

  // 6. Avaliar cada flow e registrar auditoria
  const matchedFlows: any[] = []
  const event = { type: event_type as AllowedEventType, data }

  for (const flow of allFlows) {
    const matched = matchesTriggerConditions(flow, event)

    if (!matched) {
      // Registrar not_matched — sem log de console para não poluir
      await logTriggerEvent(supabaseAdmin, {
        companyId:   company_id,
        flowId:      flow.id,
        executionId: null,
        eventType:   event_type,
        status:      'not_matched',
        matched:     false,
        reason:      'flow não corresponde ao evento',
        dedupKey:    null,
        payload:     auditPayload,
      })
      continue
    }

    matchedFlows.push(flow)
  }

  if (matchedFlows.length === 0) {
    console.log(`[trigger-event] event=${event_type} company=${company_id} flows=${allFlows.length} matched=0`)
    return res.status(200).json({ success: true, matched: 0, executions: [] })
  }

  // 7. Processar flows matched com deduplicação
  const executionIds: string[] = []
  let duplicates = 0

  for (const flow of matchedFlows) {
    const dedupKey = buildDedupKey(company_id, flow.id, opportunityId, leadId)

    // 7a. Checar duplicidade
    const duplicate = await isDuplicate(supabaseAdmin, company_id, flow.id, opportunityId, leadId)

    if (duplicate) {
      duplicates++
      console.warn(`[trigger-event][dedup] flow=${flow.id} key=${dedupKey} — ignorado (janela: ${DEDUP_WINDOW_MS / 1000}s)`)

      await logTriggerEvent(supabaseAdmin, {
        companyId:   company_id,
        flowId:      flow.id,
        executionId: null,
        eventType:   event_type,
        status:      'duplicate',
        matched:     true,
        reason:      `já executado nos últimos ${DEDUP_WINDOW_MS / 1000}s`,
        dedupKey,
        payload:     auditPayload,
      })
      continue
    }

    // 7b. Criar execução
    let execution: any = null
    try {
      execution = await createExecution(flow, data, company_id, supabaseAdmin)
    } catch (err: any) {
      console.error(`[trigger-event] erro ao criar execução para flow ${flow.id}:`, err?.message)

      await logTriggerEvent(supabaseAdmin, {
        companyId:   company_id,
        flowId:      flow.id,
        executionId: null,
        eventType:   event_type,
        status:      'error',
        matched:     true,
        reason:      `erro ao criar execução: ${err?.message}`,
        dedupKey,
        payload:     auditPayload,
      })
      continue
    }

    if (!execution) {
      await logTriggerEvent(supabaseAdmin, {
        companyId:   company_id,
        flowId:      flow.id,
        executionId: null,
        eventType:   event_type,
        status:      'error',
        matched:     true,
        reason:      'createExecution retornou null',
        dedupKey,
        payload:     auditPayload,
      })
      continue
    }

    // 7c. Registrar auditoria com execution_id real
    await logTriggerEvent(supabaseAdmin, {
      companyId:   company_id,
      flowId:      flow.id,
      executionId: execution.id,
      eventType:   event_type,
      status:      'triggered',
      matched:     true,
      reason:      null,
      dedupKey,
      payload:     auditPayload,
    })

    executionIds.push(execution.id)

    console.log(`[trigger-event] event=${event_type} flow=${flow.id} execution=${execution.id} status=triggered`)

    // 7d. Processar flow
    await processFlowAsync(flow, execution, supabaseAdmin)
  }

  return res.status(200).json({
    success:    true,
    matched:    matchedFlows.length,
    executions: executionIds,
    duplicates,
  })
}
