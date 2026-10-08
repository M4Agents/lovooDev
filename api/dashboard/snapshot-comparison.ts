// =====================================================
// GET /api/dashboard/snapshot-comparison
//
// Compara dois períodos históricos usando aggregate_snapshot_company_period.
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
import { readCompanyTimeZone } from '../lib/dashboard/period.js'
import {
  getComparisonPeriods,
} from '../lib/dashboard/snapshotPeriods.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  assertFunnelBelongsToCompany,
  assertUserFunnelAccess,
  jsonError,
}                           from '../lib/dashboard/auth.js'
import { withTiming }  from '../lib/dashboard/observability.js'
import { calcDelta }  from '../lib/dashboard/deltaUtils.js'

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
    const comparisonMode = req.query.comparison_mode === 'mom'
      ? 'mom'
      : req.query.comparison_mode === 'wow'
        ? 'wow'
        : null
    const companyTimeZone = await readCompanyTimeZone(svc, companyId)
    const companyPeriods = comparisonMode
      ? getComparisonPeriods(comparisonMode, companyTimeZone)
      : null
    const current_from = companyPeriods?.currentFrom
      ?? (typeof req.query.current_from === 'string' ? req.query.current_from : '')
    const current_to = companyPeriods?.currentTo
      ?? (typeof req.query.current_to === 'string' ? req.query.current_to : '')
    const previous_from = companyPeriods?.previousFrom
      ?? (typeof req.query.previous_from === 'string' ? req.query.previous_from : '')
    const previous_to = companyPeriods?.previousTo
      ?? (typeof req.query.previous_to === 'string' ? req.query.previous_to : '')
    let funnelId = typeof req.query.funnel_id === 'string' ? req.query.funnel_id.trim() : null

    if (funnelId) {
      const valid = await assertFunnelBelongsToCompany(svc, funnelId, companyId)
      if (!valid) { jsonError(res, 403, 'funnel_id não pertence à empresa'); return }
    }

    const funnelAccess = await assertUserFunnelAccess({
      svc, userId: user.id, companyId, role: member.role, funnelId,
    })
    if (!funnelAccess.ok) { jsonError(res, funnelAccess.status, funnelAccess.error); return }

    if (funnelAccess.allowedFunnelIds !== null && !funnelId) {
      const allowed = funnelAccess.allowedFunnelIds
      if (allowed.length === 1) {
        funnelId = allowed[0]
      } else {
        jsonError(res, 400, 'Selecione um funil permitido para visualizar o Dashboard.')
        return
      }
    }

    if (!current_from || !current_to || !previous_from || !previous_to) {
      jsonError(res, 400, 'current_from, current_to, previous_from, previous_to são obrigatórios')
      return
    }

    // ── Chamar aggregate_snapshot_company_period para ambos os períodos ────────────
    const [{ data: curr }, { data: prev }] = await withTiming(
      'snapshot.comparison.aggregate',
      () => Promise.all([
        svc.rpc('aggregate_snapshot_company_period', {
          p_company_id: companyId,
          p_funnel_id:  funnelId,
          p_start_date: current_from,
          p_end_date:   current_to,
        }),
        svc.rpc('aggregate_snapshot_company_period', {
          p_company_id: companyId,
          p_funnel_id:  funnelId,
          p_start_date: previous_from,
          p_end_date:   previous_to,
        }),
      ]),
      { companyId },
    )

    if (!curr || !prev || (curr as any).meta?.compatible !== true || (prev as any).meta?.compatible !== true) {
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
