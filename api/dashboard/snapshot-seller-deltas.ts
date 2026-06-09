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
import { calcDeltaPct } from '../lib/dashboard/deltaUtils.js'

/** Subtrai N dias de uma data UTC e retorna YYYY-MM-DD */
function subDays(base: Date, n: number): string {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

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
    const days = mode === 'wow' ? 7 : 30

    const today     = new Date()
    const yesterday = subDays(today, 1)
    const currFrom  = subDays(today, days)
    const prevFrom  = subDays(today, days * 2)
    const prevTo    = subDays(today, days + 1)

    // Busca todos os registros dos últimos 2 * days dias
    const { data: rows, error: dbErr } = await withTiming(
      'snapshot.seller_deltas.query',
      async () => await svc
        .from('dashboard_seller_snapshots')
        .select('user_id, display_name, period_start, attendance_rate, avg_response_min, won_value')
        .eq('company_id', companyId)
        .gte('period_start', prevFrom)
        .lte('period_start', yesterday)
        .order('user_id')
        .order('period_start'),
      { companyId },
    )

    if (dbErr) {
      console.error('[snapshot-seller-deltas] DB error:', dbErr.message)
      jsonError(res, 500, 'Erro ao buscar seller snapshots')
      return
    }

    if (!rows || rows.length === 0) {
      return res.status(200).json({ ok: true, mode, sellers: [] })
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
    for (const [userId, { display_name, rows: sellerRows }] of grouped.entries()) {
      // Separar em período atual e anterior
      const currRows = sellerRows.filter((r: any) => r.period_start >= currFrom && r.period_start <= yesterday)
      const prevRows = sellerRows.filter((r: any) => r.period_start >= prevFrom && r.period_start <= prevTo)

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

      // FLOW: série diária de won_value dos últimos 7 dias (sparkline)
      const sparklineRows = sellerRows
        .filter((r: any) => r.period_start >= currFrom && r.period_start <= yesterday)
        .slice(-7)
      const wonValueSeries = sparklineRows.map((r: any) => Number(r.won_value ?? 0))

      sellers.push({
        user_id:              userId,
        display_name,
        attendance_rate_pct:  attendRatePct,
        avg_response_min_pct: avgRespPct,
        won_value_series:     wonValueSeries,
      })
    }

    return res.status(200).json({ ok: true, mode, sellers })
  } catch (err: any) {
    console.error('[snapshot-seller-deltas] Erro:', err?.message)
    jsonError(res, 500, 'Erro interno')
  }
}
