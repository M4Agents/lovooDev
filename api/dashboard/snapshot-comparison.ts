// =====================================================
// GET /api/dashboard/snapshot-comparison
//
// Compara dois períodos históricos usando aggregate_snapshot_period.
// Retorna: current, previous, delta absoluto e delta percentual.
//
// SHADOW MODE: endpoint ativo mas NÃO chamado pelo frontend ainda.
// Será integrado na FASE 4.1 (WoW/MoM comparação visual).
//
// Query params:
//   company_id        (obrigatório)
//   current_from      (YYYY-MM-DD, obrigatório)
//   current_to        (YYYY-MM-DD, obrigatório)
//   previous_from     (YYYY-MM-DD, obrigatório)
//   previous_to       (YYYY-MM-DD, obrigatório)
//   funnel_id         (opcional — NULL = company-wide)
//
// AUTENTICAÇÃO:
//   Bearer JWT do usuário → membership validado via assertMembership.
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
}                           from '../lib/dashboard/auth.js'
import { withTiming }       from '../lib/dashboard/observability.js'

function calcDelta(current: number, previous: number) {
  const abs = current - previous
  const pct =
    previous === 0
      ? current === 0 ? 0 : 100
      : Math.round((abs / Math.abs(previous)) * 1000) / 10
  return { abs: Math.round(abs * 100) / 100, pct }
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET')     { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // ── Autenticação ───────────────────────────────────────────────────────
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const svc       = getSupabaseAdmin()
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id obrigatório'); return }

    const member = await assertMembership(svc, user.id, companyId)
    if (!member) { jsonError(res, 403, 'Acesso negado'); return }

    // ── Parâmetros ─────────────────────────────────────────────────────────
    const { current_from, current_to, previous_from, previous_to } = req.query
    const funnelId = typeof req.query.funnel_id === 'string' ? req.query.funnel_id.trim() : null

    if (!current_from || !current_to || !previous_from || !previous_to) {
      jsonError(res, 400, 'current_from, current_to, previous_from, previous_to são obrigatórios')
      return
    }

    // ── Chamar aggregate_snapshot_period para ambos os períodos ────────────
    const [{ data: curr }, { data: prev }] = await withTiming(
      'snapshot.comparison.aggregate',
      () => Promise.all([
        svc.rpc('aggregate_snapshot_period', {
          p_company_id: companyId,
          p_funnel_id:  funnelId,
          p_start_date: current_from,
          p_end_date:   current_to,
        }),
        svc.rpc('aggregate_snapshot_period', {
          p_company_id: companyId,
          p_funnel_id:  funnelId,
          p_start_date: previous_from,
          p_end_date:   previous_to,
        }),
      ]),
      { companyId },
    )

    if (!curr || !prev) {
      jsonError(res, 404, 'Dados de snapshot insuficientes para o período solicitado')
      return
    }

    // ── Calcular deltas ────────────────────────────────────────────────────
    const FLOW_METRICS  = ['leads_created', 'won_count', 'won_value', 'lost_count', 'lost_value', 'sla_breached_count', 'conversations_attended']
    const STATE_METRICS = ['pipeline_total', 'pipeline_weighted', 'pipeline_risk', 'open_count', 'stalled_count', 'hot_count', 'conversion_rate', 'avg_response_minutes', 'prob_0_20_value', 'prob_21_40_value', 'prob_41_60_value', 'prob_61_80_value', 'prob_81_100_value']

    const deltas: Record<string, { abs: number; pct: number }> = {}

    for (const m of FLOW_METRICS) {
      const c = Number((curr as any).flow?.[m]  ?? 0)
      const p = Number((prev as any).flow?.[m]  ?? 0)
      deltas[m] = calcDelta(c, p)
    }
    for (const m of STATE_METRICS) {
      const c = Number((curr as any).state?.[m] ?? 0)
      const p = Number((prev as any).state?.[m] ?? 0)
      deltas[m] = calcDelta(c, p)
    }

    return res.status(200).json({
      ok:       true,
      current:  curr,
      previous: prev,
      deltas,
      params: {
        company_id:    companyId,
        funnel_id:     funnelId,
        current_from,
        current_to,
        previous_from,
        previous_to,
      },
    })
  } catch (err: any) {
    if (!res.headersSent) {
      console.error('[snapshot-comparison] Erro:', err?.message)
      jsonError(res, 500, 'Erro interno')
    }
  }
}
