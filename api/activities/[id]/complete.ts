// =============================================================================
// POST /api/activities/[id]/complete
//
// Marca uma atividade como concluída.
// Preserva exatamente o comportamento do calendarApi.ts:
//   - status = 'completed'
//   - completed_at = now()
//   - completed_by = userId autenticado (não do body — nunca confiar no frontend)
//   - completion_notes = opcional
//   - Notificações pending/sent da atividade são marcadas como 'read' (fire-and-forget)
//
// AUTENTICAÇÃO : JWT (anon key) + membership ativa em company_users
// MULTI-TENANT : activity validada com WHERE id AND company_id
//
// FASE 3 — calendar.activity_completed:
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
  const { company_id, completion_notes } = req.body ?? {}

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
  const { userId, companyId, supabase } = ctx

  // ── Verificar que a atividade pertence à empresa ──────────────────────────
  const currentActivity = await fetchOwnedActivity(activityId, companyId, supabase)
  if (!currentActivity) {
    return res.status(404).json({ success: false, error: 'Atividade não encontrada' })
  }

  // ── Idempotência: salvar status anterior para evitar re-dispatch ─────────
  // calendar.activity_completed representa uma TRANSIÇÃO real.
  // Se a atividade já estava 'completed', não disparar novamente.
  const previousStatus: string = currentActivity.status ?? ''

  const now = new Date().toISOString()

  // ── UPDATE: marcar como concluída ─────────────────────────────────────────
  const updatePayload: Record<string, any> = {
    status:       'completed',
    completed_at: now,
    completed_by: userId,          // sempre o usuário autenticado, nunca do body
    updated_at:   now,
  }

  // completion_notes: incluir somente se fornecido (preservar null se não enviado)
  if (completion_notes !== undefined) {
    updatePayload.completion_notes = completion_notes
  }

  const { data: updated, error: updateError } = await supabase
    .from('lead_activities')
    .update(updatePayload)
    .eq('id', activityId)
    .eq('company_id', companyId)   // garantia multi-tenant
    .select(ACTIVITY_SELECT)
    .single()

  if (updateError) {
    console.error('[activities/[id]/complete] erro ao concluir atividade:', updateError.message)
    return res.status(500).json({ success: false, error: 'Erro ao concluir atividade' })
  }

  // ── Marcar notificações como lidas (fire-and-forget) ──────────────────────
  // Mesmo comportamento do calendarApi.ts — falha não deve reverter a conclusão
  supabase
    .from('activity_notifications')
    .update({
      status:     'read',
      read_at:    now,
      updated_at: now,
    })
    .eq('activity_id', activityId)
    .in('status', ['pending', 'sent'])
    .then(({ error: notifErr }) => {
      if (notifErr) {
        console.warn('[activities/[id]/complete] erro ao atualizar notificações:', notifErr.message)
      }
    })

  // ── Fase 3 — calendar.activity_completed ─────────────────────────────────
  // Disparar somente em transição real: status anterior != 'completed'.
  // Se já estava 'completed', endpoint ainda retorna sucesso (idempotente),
  // mas o trigger NÃO é disparado novamente.
  //
  // await garante execução antes de res.json() (Vercel encerra Lambda após res).
  // O dispatcher é fail-safe internamente — falha aqui não reverte a conclusão.
  if (previousStatus !== 'completed') {
    const eventMetadata = { previous_status: previousStatus }
    try {
      await dispatchCalendarTrigger('calendar.activity_completed', updated, companyId, eventMetadata)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[activities/[id]/complete] dispatchCalendarTrigger falhou (não crítico):', msg)
    }
  }

  return res.status(200).json({ success: true, data: updated })
}
