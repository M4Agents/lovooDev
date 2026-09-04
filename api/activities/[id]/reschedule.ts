// =============================================================================
// POST /api/activities/[id]/reschedule
//
// Reagenda uma atividade para nova data/hora.
//
// COMPORTAMENTO (conforme decisão D1 do plano):
//   - Atualiza scheduled_date e scheduled_time
//   - Define status = 'pending'   (garante elegibilidade nos crons futuros)
//   - Define notification_sent = false   (permite nova notificação)
//   - NÃO atualiza scheduled_datetime diretamente (coluna GENERATED ALWAYS)
//   - Valida que a nova data/hora é futura (antes de enviar ao banco)
//
// AUTENTICAÇÃO : JWT (anon key) + membership ativa em company_users
// MULTI-TENANT : activity validada com WHERE id AND company_id
//
// NOTA — scheduled_datetime GENERATED ALWAYS:
//   A coluna scheduled_datetime é gerada automaticamente pela expressão:
//     (scheduled_date::text || ' ' || scheduled_time::text)::timestamptz
//   O banco possui CHECK (scheduled_datetime >= NOW()).
//   Portanto, scheduled_date + scheduled_time devem resultar em datetime futuro.
//   A validação aqui é em UTC — consistente com o timezone padrão do Supabase.
//
// FASE 1B — Google Calendar sync:
//   O campo google_event_id é retornado no data.
//   Quando google_event_id != null: calendarApi.ts deve chamar:
//     POST /api/google-calendar/sync/update-event
//     body: { activity_id }
//     header: Authorization: Bearer <token>
//
// FASE 3 — calendar.activity_rescheduled:
//   Adicionar dispatchCalendarTrigger aqui após o UPDATE bem-sucedido.
// =============================================================================

import {
  validateCaller,
  fetchOwnedActivity,
  isUUID,
  ACTIVITY_SELECT,
  mapConstraintError,
} from '../../lib/activities/activityAuth.js'
import { dispatchCalendarTrigger } from '../../lib/automation/dispatchCalendarTrigger.js'

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use POST.' })
  }

  const activityId = req.query?.id as string | undefined
  const { company_id, scheduled_date, scheduled_time } = req.body ?? {}

  // ── Validação básica ──────────────────────────────────────────────────────
  if (!activityId || !isUUID(activityId)) {
    return res.status(400).json({ success: false, error: 'ID da atividade inválido' })
  }
  if (!company_id) {
    return res.status(400).json({ success: false, error: 'company_id é obrigatório no body' })
  }
  if (!scheduled_date || !DATE_REGEX.test(scheduled_date)) {
    return res.status(400).json({ success: false, error: 'scheduled_date é obrigatório (formato: YYYY-MM-DD)' })
  }
  if (!scheduled_time || !TIME_REGEX.test(scheduled_time)) {
    return res.status(400).json({ success: false, error: 'scheduled_time é obrigatório (formato: HH:MM ou HH:MM:SS)' })
  }

  // ── Validar que nova data/hora é futura (UTC) ─────────────────────────────
  // Normaliza o tempo para HH:MM:00 se necessário e constrói ISO 8601 UTC
  const timePart = scheduled_time.length === 5 ? `${scheduled_time}:00` : scheduled_time
  const newDatetime = new Date(`${scheduled_date}T${timePart}Z`)

  if (isNaN(newDatetime.getTime())) {
    return res.status(400).json({ success: false, error: 'Data ou hora inválida' })
  }
  if (newDatetime <= new Date()) {
    return res.status(422).json({ success: false, error: 'A nova data/hora deve ser no futuro' })
  }

  // ── Auth + membership ─────────────────────────────────────────────────────
  const authResult = await validateCaller(req, company_id)
  if (!authResult.ok) {
    return res.status(authResult.status).json({ success: false, error: authResult.error })
  }
  const { ctx } = authResult
  const { companyId, supabase } = ctx

  // ── Verificar que a atividade pertence à empresa ──────────────────────────
  const currentActivity = await fetchOwnedActivity(activityId, companyId, supabase)
  if (!currentActivity) {
    return res.status(404).json({ success: false, error: 'Atividade não encontrada' })
  }

  // ── Idempotência: verificar se data/hora realmente mudaram ───────────────
  // calendar.activity_rescheduled só é disparado quando há mudança real.
  // Se mesma data E mesmo horário forem enviados, o UPDATE ocorre normalmente
  // (idempotente para o banco) mas o trigger NÃO é disparado.
  const previousScheduledDate:     string = currentActivity.scheduled_date     ?? ''
  const previousScheduledTime:     string = currentActivity.scheduled_time     ?? ''
  const previousScheduledDatetime: string = currentActivity.scheduled_datetime ?? ''
  const scheduleActuallyChanged =
    scheduled_date !== previousScheduledDate ||
    scheduled_time !== previousScheduledTime

  // ── UPDATE: reagendar ─────────────────────────────────────────────────────
  // NOTA: NÃO incluir scheduled_datetime — é GENERATED ALWAYS
  // O banco recalcula scheduled_datetime automaticamente com base em scheduled_date + scheduled_time
  const { data: updated, error: updateError } = await supabase
    .from('lead_activities')
    .update({
      scheduled_date,
      scheduled_time,
      status:            'pending',     // D1: sempre voltar para pending
      notification_sent: false,         // D1: reset para nova notificação
      updated_at:        new Date().toISOString(),
    })
    .eq('id', activityId)
    .eq('company_id', companyId)        // garantia multi-tenant
    .select(ACTIVITY_SELECT)
    .single()

  if (updateError) {
    console.error('[activities/[id]/reschedule] erro ao reagendar atividade:', updateError.message)
    const constraintErr = mapConstraintError(updateError.message)
    if (constraintErr) {
      return res.status(constraintErr.status).json({ success: false, error: constraintErr.error })
    }
    return res.status(500).json({ success: false, error: 'Erro ao reagendar atividade' })
  }

  // ── Fase 3 — calendar.activity_rescheduled ────────────────────────────────
  // Disparar somente se data OU hora realmente mudaram.
  // Se mesma data/hora enviadas novamente → UPDATE ocorre mas trigger NÃO dispara.
  //
  // event_metadata inclui valores anteriores para uso em filtros/variáveis futuras.
  // O snapshot (updated) representa o estado APÓS o reagendamento.
  //
  // await garante execução antes de res.json() (Vercel encerra Lambda após res).
  if (scheduleActuallyChanged) {
    const eventMetadata = {
      previous_scheduled_date:     previousScheduledDate,
      previous_scheduled_time:     previousScheduledTime,
      previous_scheduled_datetime: previousScheduledDatetime,
    }
    try {
      await dispatchCalendarTrigger('calendar.activity_rescheduled', updated, companyId, eventMetadata)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[activities/[id]/reschedule] dispatchCalendarTrigger falhou (não crítico):', msg)
    }
  }

  return res.status(200).json({ success: true, data: updated })
}
