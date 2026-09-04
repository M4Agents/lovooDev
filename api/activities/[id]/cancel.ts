// =============================================================================
// POST /api/activities/[id]/cancel
//
// Cancela uma atividade alterando seu status para 'cancelled'.
//
// ATENÇÃO — DISTINÇÃO IMPORTANTE:
//   - CANCELAR (este endpoint): status = 'cancelled', atividade permanece no banco.
//   - EXCLUIR (calendarApi.deleteActivity): DELETE físico da linha.
//   Estes dois comportamentos são DISTINTOS e não devem ser confundidos.
//   Este endpoint NÃO realiza DELETE. O DELETE físico permanece via Supabase
//   direto no calendarApi.ts (será migrado para endpoint separado em Fase 1B).
//
// AUTENTICAÇÃO : JWT (anon key) + membership ativa em company_users
// MULTI-TENANT : activity validada com WHERE id AND company_id
//
// FASE 3 — calendar.activity_cancelled:
//   Adicionar dispatchCalendarTrigger aqui após o UPDATE bem-sucedido.
// =============================================================================

import {
  validateCaller,
  fetchOwnedActivity,
  isUUID,
  ACTIVITY_SELECT,
} from '../../lib/activities/activityAuth.js'
import { dispatchCalendarTrigger } from '../../lib/automation/dispatchCalendarTrigger.js'

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use POST.' })
  }

  const activityId = req.query?.id as string | undefined
  const { company_id } = req.body ?? {}

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

  // ── Verificar que a atividade pertence à empresa ──────────────────────────
  const currentActivity = await fetchOwnedActivity(activityId, companyId, supabase)
  if (!currentActivity) {
    return res.status(404).json({ success: false, error: 'Atividade não encontrada' })
  }

  // ── Idempotência: salvar status anterior para evitar re-dispatch ─────────
  // calendar.activity_cancelled representa uma TRANSIÇÃO real.
  // Se a atividade já estava 'cancelled', não disparar novamente.
  // DELETE físico (calendarApi.deleteActivity) NÃO dispara este evento.
  const previousStatus: string = currentActivity.status ?? ''

  // ── UPDATE: marcar como cancelada ────────────────────────────────────────
  const { data: updated, error: updateError } = await supabase
    .from('lead_activities')
    .update({
      status:     'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', activityId)
    .eq('company_id', companyId)   // garantia multi-tenant
    .select(ACTIVITY_SELECT)
    .single()

  if (updateError) {
    console.error('[activities/[id]/cancel] erro ao cancelar atividade:', updateError.message)
    return res.status(500).json({ success: false, error: 'Erro ao cancelar atividade' })
  }

  // ── Fase 3 — calendar.activity_cancelled ─────────────────────────────────
  // Disparar somente em transição real: status anterior != 'cancelled'.
  // Se já estava 'cancelled', endpoint retorna sucesso mas trigger NÃO é re-disparado.
  // DELETE físico via calendarApi.deleteActivity NÃO passa por aqui — não gera este evento.
  //
  // await garante execução antes de res.json() (Vercel encerra Lambda após res).
  if (previousStatus !== 'cancelled') {
    const eventMetadata = { previous_status: previousStatus }
    try {
      await dispatchCalendarTrigger('calendar.activity_cancelled', updated, companyId, eventMetadata)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[activities/[id]/cancel] dispatchCalendarTrigger falhou (não crítico):', msg)
    }
  }

  return res.status(200).json({ success: true, data: updated })
}
