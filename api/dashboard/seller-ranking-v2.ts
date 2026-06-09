// =====================================================
// GET /api/dashboard/seller-ranking-v2
//
// Endpoint híbrido: ranking realtime + deltas históricos num único payload.
// FASE 4.2 Sprint 3 — Seller Ranking Híbrido.
//
// Ativado via VITE_FEATURE_HYBRID_SELLER_RANKING=true no frontend.
// O endpoint não verifica elegibilidade de tenant — essa lógica
// pertence ao frontend (canUseSnapshots via useSnapshotHealth).
//
// Query params:
//   company_id       (obrigatório)
//   period           (default: '30d')
//   start_date       (obrigatório quando period = 'custom')
//   end_date         (obrigatório quando period = 'custom')
//   user_id          (opcional)
//   comparison_mode  'wow' | 'mom'  (padrão: 'wow')
//
// RBAC (idêntico ao seller-performance.ts):
//   seller/partner   → SEMPRE força effectiveUserId = auth.uid() + is_individual_view = true
//   manager/admin+   → se user_id enviado, valida membership antes de filtrar
//                       + is_individual_view = true
//                    → se user_id omitido, retorna ranking completo
//                       + is_individual_view = false
//
// Promise.allSettled:
//   realtime falhou  → 500 (ranking é obrigatório)
//   histórico falhou → historical: null (degradação silenciosa)
// =====================================================

import { getSupabaseAdmin }         from '../lib/automation/supabaseAdmin.js'
import { resolvePeriod }            from '../lib/dashboard/period.js'
import { resolveComparisonPeriods } from '../lib/dashboard/snapshotPeriods.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'
import {
  withTiming,
  logDashboardError,
  logHistoricalFallback,
  logEndpointCall,
}                       from '../lib/dashboard/observability.js'
import { calcDeltaPct } from '../lib/dashboard/deltaUtils.js'

const MANAGER_ROLES = new Set(['manager', 'admin', 'system_admin', 'super_admin'])

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  const _startedAt = Date.now()

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET')     { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // 1. Autenticação
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }
    const svc = getSupabaseAdmin()

    // 2. Membership
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // 3. RBAC — idêntico ao seller-performance.ts
    const callerRole = membership.role
    const rawUserId  = typeof req.query.user_id === 'string' ? req.query.user_id.trim() : null

    let effectiveUserId:  string | null = null
    let isIndividualView: boolean       = false

    if (!MANAGER_ROLES.has(callerRole)) {
      // seller/partner: SEMPRE vê apenas si mesmo, sem rank relativo
      effectiveUserId  = user.id
      isIndividualView = true
    } else if (rawUserId) {
      // manager/admin+ filtrando um vendedor específico: valida membership
      const targetMembership = await assertMembership(svc, rawUserId, companyId)
      if (!targetMembership) {
        jsonError(res, 403, 'Usuário selecionado não é membro ativo desta empresa'); return
      }
      effectiveUserId  = rawUserId
      isIndividualView = true
    }
    // manager/admin+ sem user_id → ranking completo da equipe

    // 4. Período realtime
    const period     = typeof req.query.period     === 'string' ? req.query.period.trim()     : '30d'
    const start_date = typeof req.query.start_date === 'string' ? req.query.start_date.trim() : undefined
    const end_date   = typeof req.query.end_date   === 'string' ? req.query.end_date.trim()   : undefined

    let resolvedRange: { start: string; end: string }
    try { resolvedRange = resolvePeriod(period, start_date, end_date) }
    catch (e: any) { jsonError(res, 400, e.message ?? 'Período inválido'); return }

    // 5. Períodos de comparação histórica (lib compartilhada)
    const rawMode = req.query.comparison_mode
    const comparisonMode: 'wow' | 'mom' = rawMode === 'mom' ? 'mom' : 'wow'
    const periods = resolveComparisonPeriods(comparisonMode)

    const ctx = { companyId, period, comparisonMode }

    // 6. Realtime + histórico em paralelo
    const [rankingResult, deltasResult] = await Promise.allSettled([

      withTiming(
        'seller-ranking-v2.realtime',
        async () => {
          const { data, error } = await svc.rpc('get_dashboard_seller_ranking', {
            p_company_id:      companyId,
            p_start_date:      resolvedRange.start,
            p_end_date:        resolvedRange.end,
            p_user_id:         effectiveUserId ?? null,
            p_include_ranking: !isIndividualView,
          })
          if (error) throw new Error(`get_dashboard_seller_ranking: ${error.message}`)
          return (data ?? []) as any[]
        },
        ctx,
      ),

      withTiming(
        'seller-ranking-v2.historical',
        async () => {
          // Query filtrada por effectiveUserId em individual view (otimização)
          let query = svc
            .from('dashboard_seller_snapshots')
            .select('user_id, period_start, attendance_rate, avg_response_min, won_value')
            .eq('company_id', companyId)
            .gte('period_start', periods.previousFrom)
            .lte('period_start', periods.currentTo)
            .order('user_id')
            .order('period_start')

          if (isIndividualView && effectiveUserId) {
            query = (query as any).eq('user_id', effectiveUserId)
          }

          const { data: rows, error: dbErr } = await query
          if (dbErr) throw new Error(`dashboard_seller_snapshots: ${dbErr.message}`)
          return (rows ?? []) as any[]
        },
        ctx,
      ),

    ])

    // 7. Realtime é obrigatório — falha → 500
    if (rankingResult.status === 'rejected') {
      logDashboardError('seller-ranking-v2', rankingResult.reason, {
        endpoint:  '/api/dashboard/seller-ranking-v2',
        companyId,
        period,
      })
      logEndpointCall(svc, { companyId, endpoint: 'seller-ranking-v2', status: 'error', mode: comparisonMode, durationMs: Date.now() - _startedAt })
      jsonError(res, 500, 'Erro ao carregar ranking de vendedores')
      return
    }

    const rankingData = rankingResult.value

    // 8. Histórico — falha → null (degradação silenciosa)
    let historicalPayload: {
      sellers: any[]
      mode:    'wow' | 'mom'
    } | null = null

    if (deltasResult.status === 'fulfilled' && deltasResult.value.length > 0) {
      const rows = deltasResult.value

      // Agrupar por user_id
      const grouped = new Map<string, { rows: any[] }>()
      for (const row of rows) {
        if (!grouped.has(row.user_id)) {
          grouped.set(row.user_id, { rows: [] })
        }
        grouped.get(row.user_id)!.rows.push(row)
      }

      const sellers: any[] = []
      for (const [userId, { rows: sellerRows }] of grouped.entries()) {
        const currRows = sellerRows.filter((r: any) =>
          r.period_start >= periods.currentFrom && r.period_start <= periods.currentTo,
        )
        const prevRows = sellerRows.filter((r: any) =>
          r.period_start >= periods.previousFrom && r.period_start <= periods.previousTo,
        )

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

        // FLOW: série dos últimos N dias de won_value (sparkline)
        const sparklineRows = sellerRows
          .filter((r: any) => r.period_start >= periods.currentFrom && r.period_start <= periods.currentTo)
          .slice(-7)
        const wonValueSeries = sparklineRows.map((r: any) => Number(r.won_value ?? 0))

        sellers.push({
          user_id:              userId,
          attendance_rate_pct:  attendRatePct,
          avg_response_min_pct: avgRespPct,
          won_value_series:     wonValueSeries,
        })
      }

      historicalPayload = { sellers, mode: comparisonMode }

    } else if (deltasResult.status === 'rejected') {
      console.warn('[seller-ranking-v2] historical failed (degraded silently):', deltasResult.reason?.message)
      // Caso A: query em dashboard_seller_snapshots falhou
      logHistoricalFallback(svc, {
        companyId,
        endpoint:       'seller-ranking-v2',
        reason:         'aggregate_failed',
        comparisonMode,
      })
    } else if (deltasResult.status === 'fulfilled' && deltasResult.value.length === 0) {
      // Caso B: fulfilled mas sem snapshots de vendedores para o período
      logHistoricalFallback(svc, {
        companyId,
        endpoint:       'seller-ranking-v2',
        reason:         'no_snapshot_data',
        comparisonMode,
      })
    }

    logEndpointCall(svc, {
      companyId,
      endpoint:   'seller-ranking-v2',
      status:     historicalPayload !== null ? 'ok' : 'fallback',
      mode:       comparisonMode,
      durationMs: Date.now() - _startedAt,
    })

    return res.status(200).json({
      ok: true,
      ranking: {
        data: rankingData,
        meta: {
          period,
          start:              resolvedRange.start,
          end:                resolvedRange.end,
          user_id:            effectiveUserId,
          total:              rankingData.length,
          is_individual_view: isIndividualView,
        },
      },
      historical: historicalPayload,
      snapshot_meta: {
        available:       historicalPayload !== null,
        comparison_mode: comparisonMode,
      },
    })

  } catch (err: unknown) {
    logDashboardError('seller-ranking-v2', err, {
      endpoint:  '/api/dashboard/seller-ranking-v2',
      companyId: typeof req.query.company_id === 'string' ? req.query.company_id : undefined,
      period:    typeof req.query.period     === 'string' ? req.query.period     : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
