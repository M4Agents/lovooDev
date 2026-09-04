// =============================================================================
// POST /api/activities/create
//
// Cria uma nova atividade (lead_activities) com validação completa de
// autenticação, membership, company_id e vínculos.
//
// AUTENTICAÇÃO : JWT (anon key) + membership ativa em company_users
// MULTI-TENANT : company_id validado via assertMembership
//                lead_id validado: leads WHERE id = lead_id AND company_id
//                assigned_to validado: company_users WHERE is_active = true
// SERVICE_ROLE : usado somente após auth — para INSERT (bypass RLS seguro)
//
// FASE 1B — Google Calendar sync:
//   O endpoint retorna { success: true, data: { ...activity } }
//   A atividade criada inclui os campos:
//     - id:              UUID da atividade (necessário para sync)
//     - sync_to_google:  boolean (indica se deve sincronizar)
//     - google_event_id: null após criação (preenchido pelo sync)
//   Quando sync_to_google = true, o calendarApi.ts deve chamar:
//     POST /api/google-calendar/sync/create-event
//     body: { activity_id }
//     header: Authorization: Bearer <token>
//   O sync é fire-and-forget (falha não deve reverter a criação).
//
// NÃO IMPLEMENTADO NESTA FASE:
//   - dispatchCalendarTrigger (Fase 3)
//   - automation_executions
//   - Verificação de limite de créditos de automação
// =============================================================================

import { validateCaller, isUUID, ACTIVITY_SELECT, mapConstraintError } from '../lib/activities/activityAuth.js'
import { dispatchCalendarTrigger } from '../lib/automation/dispatchCalendarTrigger.js'

const VALID_ACTIVITY_TYPES = ['call', 'meeting', 'email', 'task', 'follow_up', 'demo', 'other'] as const
const VALID_PRIORITIES     = ['low', 'medium', 'high', 'urgent'] as const
const VALID_VISIBILITY     = ['private', 'shared', 'public'] as const

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use POST.' })
  }

  const {
    company_id,
    lead_id,
    title,
    activity_type,
    scheduled_date,
    scheduled_time,
    description,
    duration_minutes,
    reminder_minutes,
    priority,
    visibility,
    assigned_to,
    sync_to_google,
  } = req.body ?? {}

  // ── Validação de campos obrigatórios ─────────────────────────────────────
  if (!company_id) {
    return res.status(400).json({ success: false, error: 'company_id é obrigatório' })
  }
  if (!lead_id) {
    return res.status(400).json({ success: false, error: 'lead_id é obrigatório' })
  }
  if (isNaN(Number(lead_id))) {
    return res.status(400).json({ success: false, error: 'lead_id deve ser numérico' })
  }
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ success: false, error: 'title é obrigatório' })
  }
  if (!activity_type) {
    return res.status(400).json({ success: false, error: 'activity_type é obrigatório' })
  }
  if (!(VALID_ACTIVITY_TYPES as readonly string[]).includes(activity_type)) {
    return res.status(400).json({
      success: false,
      error: `activity_type inválido. Valores aceitos: ${VALID_ACTIVITY_TYPES.join(', ')}`,
    })
  }
  if (!scheduled_date || !DATE_REGEX.test(scheduled_date)) {
    return res.status(400).json({ success: false, error: 'scheduled_date é obrigatório (formato: YYYY-MM-DD)' })
  }
  if (!scheduled_time || !TIME_REGEX.test(scheduled_time)) {
    return res.status(400).json({ success: false, error: 'scheduled_time é obrigatório (formato: HH:MM ou HH:MM:SS)' })
  }

  // ── Validações opcionais ──────────────────────────────────────────────────
  if (priority !== undefined && !(VALID_PRIORITIES as readonly string[]).includes(priority)) {
    return res.status(400).json({
      success: false,
      error: `priority inválido. Valores aceitos: ${VALID_PRIORITIES.join(', ')}`,
    })
  }
  if (visibility !== undefined && !(VALID_VISIBILITY as readonly string[]).includes(visibility)) {
    return res.status(400).json({
      success: false,
      error: `visibility inválido. Valores aceitos: ${VALID_VISIBILITY.join(', ')}`,
    })
  }
  if (assigned_to !== undefined && assigned_to !== null && !isUUID(assigned_to)) {
    return res.status(400).json({ success: false, error: 'assigned_to deve ser um UUID válido' })
  }

  // ── Auth + membership ─────────────────────────────────────────────────────
  const authResult = await validateCaller(req, company_id)
  if (!authResult.ok) {
    return res.status(authResult.status).json({ success: false, error: authResult.error })
  }
  const { ctx } = authResult
  const { userId, companyId, supabase } = ctx

  // ── Validar lead pertence à empresa ──────────────────────────────────────
  // NUNCA inserir atividade para lead de outra empresa
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id')
    .eq('id', Number(lead_id))
    .eq('company_id', companyId)
    .maybeSingle()

  if (leadError) {
    console.error('[activities/create] erro ao validar lead:', leadError.message)
    return res.status(500).json({ success: false, error: 'Erro ao validar lead' })
  }
  if (!lead) {
    return res.status(403).json({ success: false, error: 'Lead não encontrado ou não pertence à empresa' })
  }

  // ── Validar assigned_to se fornecido ─────────────────────────────────────
  // Garantir que o responsável é membro ativo da empresa
  if (assigned_to !== undefined && assigned_to !== null) {
    const { data: assignedMember, error: memberError } = await supabase
      .from('company_users')
      .select('user_id')
      .eq('user_id', assigned_to)
      .eq('company_id', companyId)
      .eq('is_active', true)
      .maybeSingle()

    if (memberError) {
      console.error('[activities/create] erro ao validar assigned_to:', memberError.message)
      return res.status(500).json({ success: false, error: 'Erro ao validar responsável' })
    }
    if (!assignedMember) {
      return res.status(400).json({ success: false, error: 'assigned_to não é membro ativo da empresa' })
    }
  }

  // ── Montar payload do INSERT ──────────────────────────────────────────────
  // NOTA: scheduled_datetime é GENERATED ALWAYS — não deve ser incluído
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertPayload: Record<string, any> = {
    company_id:    companyId,     // sempre o validado, nunca o do body diretamente
    lead_id:       Number(lead_id),
    title:         title.trim(),
    activity_type,
    scheduled_date,
    scheduled_time,
    owner_user_id: userId,
    created_by:    userId,
  }

  if (description      !== undefined) insertPayload.description      = description
  if (duration_minutes !== undefined) insertPayload.duration_minutes = Number(duration_minutes)
  if (reminder_minutes !== undefined) insertPayload.reminder_minutes = Number(reminder_minutes)
  if (priority         !== undefined) insertPayload.priority         = priority
  if (visibility       !== undefined) insertPayload.visibility       = visibility
  if (sync_to_google   !== undefined) insertPayload.sync_to_google   = Boolean(sync_to_google)
  if (assigned_to !== undefined && assigned_to !== null) {
    insertPayload.assigned_to = assigned_to
  }

  // ── INSERT via service_role ───────────────────────────────────────────────
  const { data: activity, error: insertError } = await supabase
    .from('lead_activities')
    .insert(insertPayload)
    .select(ACTIVITY_SELECT)
    .single()

  if (insertError) {
    console.error('[activities/create] erro ao criar atividade:', insertError.message)
    const constraintErr = mapConstraintError(insertError.message)
    if (constraintErr) {
      return res.status(constraintErr.status).json({ success: false, error: constraintErr.error })
    }
    return res.status(500).json({ success: false, error: 'Erro ao criar atividade' })
  }

  // ── Fase 1B — doc Google Calendar sync ───────────────────────────────────
  // Quando calendarApi.ts migrar para este endpoint:
  //   if (activity.sync_to_google) {
  //     POST /api/google-calendar/sync/create-event
  //     body: { activity_id: activity.id }
  //     header: Authorization: Bearer <token>
  //   }

  // ── Fase 2 — Disparar automação calendar.activity_created ────────────────
  // IMPORTANTE: Vercel encerra a Lambda após res.json(), impedindo fire-and-forget
  // confiável (createExecution nunca completava no padrão sem await).
  // Ver comentário em api/webhook-lead.js linha 972 para evidência histórica.
  //
  // PADRÃO: await + try/catch (igual a webhook-lead.js e webhook/lead/[api_key].js)
  //
  // FAIL-SAFE: o dispatcher internamente nunca lança exceção para o caller.
  // O try/catch aqui é uma proteção secundária.
  // Falha da automação NÃO reverte a atividade — criação já foi confirmada acima.
  // LATÊNCIA: aprox. 7–10 queries extras no Supabase (estimativa 200–500ms adicionais).
  try {
    await dispatchCalendarTrigger('calendar.activity_created', activity, companyId)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[activities/create] dispatchCalendarTrigger falhou (não crítico):', msg)
  }

  return res.status(201).json({ success: true, data: activity })
}
