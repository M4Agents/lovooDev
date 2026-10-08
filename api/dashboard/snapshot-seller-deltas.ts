// =====================================================
// GET /api/dashboard/snapshot-seller-deltas
//
// Retorna deltas WoW/MoM por vendedor usando dashboard_seller_snapshots.
//
// Para cada vendedor, calcula:
//   - attendance_rate  (STATE): último valor de cada período
//   - avg_response_min (STATE): último valor de cada período
//   - won_value_series (FLOW): série diária dos últimos N dias (sparkline)
//
// Query params:
//   company_id  (obrigatório)
//   mode        'wow' | 'mom'  (padrão: 'wow')
//
// Autenticação: Bearer JWT do usuário → membership validado.
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
}                           from '../lib/dashboard/auth.js'
import { withTiming }    from '../lib/dashboard/observability.js'
import { readCompanyTimeZone } from '../lib/dashboard/period.js'
import { calcDeltaPct } from '../lib/dashboard/deltaUtils.js'
import { civilDaysInclusive, comparisonCoverage, flowOnGeneratedDay, resolveComparisonPeriods } from '../lib/dashboard/snapshotPeriods.js'
import { fetchGeneratedCompanyDates } from '../lib/dashboard/snapshotSeries.js'

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET')     { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // ── Autenticação ─────────────────────────────────────────────────────────
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const svc       = getSupabaseAdmin()
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id obrigatório'); return }

    const member = await assertMembership(svc, user.id, companyId)
    if (!member) { jsonError(res, 403, 'Acesso negado'); return }

    // ── Períodos ─────────────────────────────────────────────────────────────
    const rawMode = req.query.mode
    const mode: 'wow' | 'mom' = rawMode === 'mom' ? 'mom' : 'wow'
    const companyTimeZone = await readCompanyTimeZone(svc, companyId)
    const periods = resolveComparisonPeriods(mode, companyTimeZone)

    let generatedDates: string[]
    try {
      generatedDates = await fetchGeneratedCompanyDates(
        svc,
        companyId,
        periods.timeZone,
        periods.previousFrom,
        periods.currentTo,
      )
    } catch (error: any) {
      console.error('[snapshot-seller-deltas] cobertura:', error?.message)
      return res.status(200).json({
        ok: true,
        mode,
        sellers: [],
        history_status: 'insufficient',
        calendar_basis: periods.timeZone,
        current_from: periods.currentFrom,
        current_to: periods.currentTo,
        previous_from: periods.previousFrom,
        previous_to: periods.previousTo,
      })
    }

    const coverage = comparisonCoverage(generatedDates, periods, mode)
    if (coverage.status !== 'ready') {
      return res.status(200).json({
        ok: true,
        mode,
        sellers: [],
        history_status: 'insufficient',
        calendar_basis: periods.timeZone,
        current_from: periods.currentFrom,
        current_to: periods.currentTo,
        previous_from: periods.previousFrom,
        previous_to: periods.previousTo,
      })
    }

    const { data: rows, error: dbErr } = await withTiming(
      'snapshot.seller_deltas.query',
      async () => await svc
        .from('dashboard_seller_snapshots')
        .select('user_id, display_name, period_start, calendar_basis, attendance_rate, avg_response_min, won_value')
        .eq('company_id', companyId)
        .eq('calendar_basis', periods.timeZone)
        .gte('period_start', periods.previousFrom)
        .lte('period_start', periods.currentTo)
        .order('user_id')
        .order('period_start'),
      { companyId },
    )

    if (dbErr) {
      console.error('[snapshot-seller-deltas] DB error:', dbErr.message)
      jsonError(res, 500, 'Erro ao buscar seller snapshots')
      return
    }

    const sellerRowsAll = rows ?? []
    if (sellerRowsAll.length === 0) {
      return res.status(200).json({
        ok: true,
        mode,
        sellers: [],
        history_status: 'ready',
        calendar_basis: periods.timeZone,
      })
    }

    // ── Agrupar por user_id ──────────────────────────────────────────────────
    const grouped = new Map<string, { display_name: string | null; rows: any[] }>()
    for (const row of rows) {
      if (!grouped.has(row.user_id)) {
        grouped.set(row.user_id, { display_name: row.display_name, rows: [] })
      }
      grouped.get(row.user_id)!.rows.push(row)
    }

    const sellers = []
    const generated = new Set(civilDaysInclusive(periods.previousFrom, periods.currentTo))
    const sparkDays = civilDaysInclusive(periods.currentFrom, periods.currentTo).slice(-7)
    for (const [userId, { display_name, rows: sellerRows }] of grouped.entries()) {
      // Separar em período atual e anterior
      const currRows = sellerRows.filter((r: any) => r.period_start >= periods.currentFrom && r.period_start <= periods.currentTo)
      const prevRows = sellerRows.filter((r: any) => r.period_start >= periods.previousFrom && r.period_start <= periods.previousTo)

      // STATE: último valor de cada período
      const lastCurrRow = currRows.length > 0 ? currRows[currRows.length - 1] : null
      const lastPrevRow = prevRows.length > 0 ? prevRows[prevRows.length - 1] : null

      const attendRatePct = calcDeltaPct(
        lastCurrRow ? Number(lastCurrRow.attendance_rate)  : null,
        lastPrevRow ? Number(lastPrevRow.attendance_rate)  : null,
      )
      const avgRespPct = calcDeltaPct(
        lastCurrRow ? Number(lastCurrRow.avg_response_min) : null,
        lastPrevRow ? Number(lastPrevRow.avg_response_min) : null,
      )

      const byDay = new Map(sellerRows.map((row: any) => [String(row.period_start).slice(0, 10), row]))
      const wonValueSeries = sparkDays.flatMap(day => {
        const row = byDay.get(day)
        const value = flowOnGeneratedDay(generated.has(day), row ? Number(row.won_value) : null)
        return value === null ? [] : [value]
      })

      sellers.push({
        user_id:              userId,
        display_name,
        attendance_rate_pct:  attendRatePct,
        avg_response_min_pct: avgRespPct,
        won_value_series:     wonValueSeries,
      })
    }

    return res.status(200).json({
      ok: true,
      mode,
      sellers,
      history_status: 'ready',
      calendar_basis: periods.timeZone,
    })
  } catch (err: any) {
    console.error('[snapshot-seller-deltas] Erro:', err?.message)
    jsonError(res, 500, 'Erro interno')
  }
}
