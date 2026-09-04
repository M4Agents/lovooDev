// =============================================================================
// PATCH /api/activities/[id]
//
// Atualiza campos permitidos de uma atividade existente.
//
// AUTENTICAÇÃO : JWT (anon key) + membership ativa em company_users
// MULTI-TENANT : activity validada com WHERE id AND company_id
// WHITELIST    : somente campos explicitamente permitidos são atualizados
// ASSIGNED_TO  : mudança é detectada mas NÃO dispara trigger (preparado para Fase 3)
//
// CAMPOS PERMITIDOS via PATCH (whitelist explícita):
//   title, description, activity_type, duration_minutes, reminder_minutes,
//   priority, visibility, assigned_to, sync_to_google
//
// CAMPOS PROIBIDOS (não podem ser atualizados via este endpoint):
//   scheduled_date, scheduled_time   → usar /reschedule (reseta status + notification_sent)
//   scheduled_datetime               → GENERATED ALWAYS, jamais atualizado diretamente
//   status, completed_at, completed_by, company_id, lead_id,
//   owner_user_id, created_by, notification_sent
//   → Para alterar status: usar /complete, /cancel, /reschedule
//
// FASE 1B — Google Calendar sync:
//   O campo google_event_id é retornado no data.
//   Quando google_event_id != null: calendarApi.ts deve chamar:
//     POST /api/google-calendar/sync/update-event
//     body: { activity_id }
//     header: Authorization: Bearer <token>
//   O sync é fire-and-forget.
//
// FASE 3 — calendar.activity_assigned:
//   O código já detecta mudança de assigned_to.
//   Quando Fase 3 for implementada, adicionar após o UPDATE:
//     if (assignedToChanged) dispatchCalendarTrigger('calendar.activity_assigned', ...)
// =============================================================================

import {
  validateCaller,
  fetchOwnedActivity,
  isUUID,
  ACTIVITY_SELECT,
  mapConstraintError,
} from '../lib/activities/activityAuth.js'
import { dispatchCalendarTrigger } from '../lib/automation/dispatchCalendarTrigger.js'

const VALID_ACTIVITY_TYPES = ['call', 'meeting', 'email', 'task', 'follow_up', 'demo', 'other'] as const
const VALID_PRIORITIES     = ['low', 'medium', 'high', 'urgent'] as const
const VALID_VISIBILITY     = ['private', 'shared', 'public'] as const

// Whitelist explícita — NUNCA atualizar colunas fora desta lista.
// NOTA: scheduled_date e scheduled_time foram REMOVIDOS intencionalmente.
//   Qualquer mudança de agenda (data ou hora) deve usar POST /api/activities/[id]/reschedule,
//   que reseta status = 'pending' e notification_sent = false, garantindo a invariante
//   de que todo reagendamento aciona nova notificação. Ter dois caminhos com regras
//   diferentes para a mesma mudança é proibido.
const ALLOWED_UPDATE_FIELDS = new Set([
  'title',
  'description',
  'activity_type',
  'duration_minutes',
  'reminder_minutes',
  'priority',
  'visibility',
  'assigned_to',
  'sync_to_google',
])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'PATCH') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use PATCH.' })
  }

  const activityId = req.query?.id as string | undefined
  const { company_id, ...bodyFields } = req.body ?? {}

  // ── Validação básica ──────────────────────────────────────────────────────
  if (!activityId || !isUUID(activityId)) {
    return res.status(400).json({ success: false, error: 'ID da atividade inválido' })
  }
  if (!company_id) {
    return res.status(400).json({ success: false, error: 'company_id é obrigatório no body' })
  }

  // ── Auth + membership ─────────────────────────────────────────────────────
  const authResult = await validateCaller(req, company_id)
  if (!authResult.ok) {
    return res.status(authResult.status).json({ success: false, error: authResult.error })
  }
  const { ctx } = authResult
  const { companyId, supabase } = ctx

  // ── Buscar atividade atual (validando company_id) ─────────────────────────
  const currentActivity = await fetchOwnedActivity(activityId, companyId, supabase)
  if (!currentActivity) {
    return res.status(404).json({ success: false, error: 'Atividade não encontrada' })
  }

  // ── Filtrar campos pela whitelist ─────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = {}
  for (const [key, value] of Object.entries(bodyFields)) {
    if (ALLOWED_UPDATE_FIELDS.has(key) && value !== undefined) {
      updates[key] = value
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, error: 'Nenhum campo válido fornecido para atualização' })
  }

  // ── Validações de campos específicos ─────────────────────────────────────
  if ('title' in updates) {
    if (typeof updates.title !== 'string' || !updates.title.trim()) {
      return res.status(400).json({ success: false, error: 'title não pode ser vazio' })
    }
    updates.title = updates.title.trim()
  }

  if ('activity_type' in updates) {
    if (!(VALID_ACTIVITY_TYPES as readonly string[]).includes(updates.activity_type)) {
      return res.status(400).json({
        success: false,
        error: `activity_type inválido. Valores aceitos: ${VALID_ACTIVITY_TYPES.join(', ')}`,
      })
    }
  }

  if ('priority' in updates) {
    if (!(VALID_PRIORITIES as readonly string[]).includes(updates.priority)) {
      return res.status(400).json({
        success: false,
        error: `priority inválido. Valores aceitos: ${VALID_PRIORITIES.join(', ')}`,
      })
    }
  }

  if ('visibility' in updates) {
    if (!(VALID_VISIBILITY as readonly string[]).includes(updates.visibility)) {
      return res.status(400).json({
        success: false,
        error: `visibility inválido. Valores aceitos: ${VALID_VISIBILITY.join(', ')}`,
      })
    }
  }

  if ('assigned_to' in updates && updates.assigned_to !== null) {
    if (!isUUID(updates.assigned_to)) {
      return res.status(400).json({ success: false, error: 'assigned_to deve ser um UUID válido' })
    }
    // Validar que o responsável é membro ativo da empresa
    const { data: member, error: memberErr } = await supabase
      .from('company_users')
      .select('user_id')
      .eq('user_id', updates.assigned_to)
      .eq('company_id', companyId)
      .eq('is_active', true)
      .maybeSingle()

    if (memberErr) {
      console.error('[activities/[id]] erro ao validar assigned_to:', memberErr.message)
      return res.status(500).json({ success: false, error: 'Erro ao validar responsável' })
    }
    if (!member) {
      return res.status(400).json({ success: false, error: 'assigned_to não é membro ativo da empresa' })
    }
  }

  // ── Detectar mudança de assigned_to para trigger calendar.activity_assigned ──
  // Disparar sempre que assigned_to muda de valor (incluindo UUID → null).
  // Casos:
  //   null → UUID A       → assignedToChanged = true  → dispatch
  //   UUID A → UUID B     → assignedToChanged = true  → dispatch
  //   UUID A → UUID A     → assignedToChanged = false → no dispatch
  //   UUID A → null       → assignedToChanged = true  → dispatch (atribuição removida)
  //   campo não enviado   → 'assigned_to' not in updates → no dispatch
  const previousAssignedTo: string | null = currentActivity.assigned_to ?? null
  const assignedToInPayload               = 'assigned_to' in updates
  const newAssignedTo: string | null      = assignedToInPayload ? (updates.assigned_to ?? null) : previousAssignedTo
  const assignedToChanged                 = assignedToInPayload && newAssignedTo !== previousAssignedTo

  // ── UPDATE via service_role ───────────────────────────────────────────────
  // NOTA: scheduled_datetime é GENERATED ALWAYS — jamais incluir no update
  updates.updated_at = new Date().toISOString()
  delete updates.scheduled_datetime // segurança extra

  const { data: updated, error: updateError } = await supabase
    .from('lead_activities')
    .update(updates)
    .eq('id', activityId)
    .eq('company_id', companyId)   // garantia multi-tenant na query
    .select(ACTIVITY_SELECT)
    .single()

  if (updateError) {
    console.error('[activities/[id]] erro ao atualizar atividade:', updateError.message)
    const constraintErr = mapConstraintError(updateError.message)
    if (constraintErr) {
      return res.status(constraintErr.status).json({ success: false, error: constraintErr.error })
    }
    return res.status(500).json({ success: false, error: 'Erro ao atualizar atividade' })
  }

  // ── Fase 3 — calendar.activity_assigned ──────────────────────────────────
  // Disparar somente quando assigned_to realmente mudou de valor.
  // Comportamento de UUID → null: representa remoção de atribuição.
  //   O evento é disparado — o nome 'activity_assigned' cobre "atribuição alterada",
  //   não exclusivamente "atribuição adicionada". Flows que usam
  //   send_user_activity_notification farão skip seguro quando assigned_to = null.
  //
  // event_metadata inclui previous_assigned_to para contexto futuro (ex: notificar
  // quem foi removido). NÃO usado para autorização.
  //
  // await garante execução antes de res.json() (Vercel encerra Lambda após res).
  if (assignedToChanged) {
    const eventMetadata = {
      previous_assigned_to: previousAssignedTo,
      new_assigned_to:      newAssignedTo,
    }
    try {
      await dispatchCalendarTrigger('calendar.activity_assigned', updated, companyId, eventMetadata)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[activities/[id]] dispatchCalendarTrigger falhou (não crítico):', msg)
    }
  }

  return res.status(200).json({ success: true, data: updated })
}
