// =====================================================
// GET /api/dashboard/sla-alerts-v2
//
// Endpoint híbrido: alertas SLA realtime + trend histórica num único payload.
// FASE 4.2 Sprint 4 — SLA Alerts Híbrido.
//
// Ativado via VITE_FEATURE_HYBRID_SLA_ALERTS=true no frontend.
// O endpoint não verifica elegibilidade de tenant — essa lógica
// pertence ao frontend (canUseSnapshots via useSnapshotHealth).
//
// Query params:
//   company_id  (obrigatório)
//   user_id     (opcional)
//   sla_hours   (default: 6)
//   page        (default: 1)
//   limit       (default: 20, máx: 50)
//
// RBAC (idêntico ao sla-alerts.ts):
//   seller/partner → SEMPRE usa o próprio user.id
//   manager+       → filtra por user_id se enviado (validado), ou retorna todos
//
// Historical:
//   Query direta em dashboard_snapshots — apenas sla_breached_count.
//   Janela: últimos 7 dias fechados (D-7 até D-1).
//   Shape compatível com SnapshotTrendsData (SlaAlertsPanel usa sem alteração).
//
// Promise.allSettled:
//   realtime falhou  → 500 (alertas são obrigatórios)
//   histórico falhou → historical: null (degradação silenciosa)
// =====================================================

import { getSupabaseAdmin }    from '../lib/automation/supabaseAdmin.js'
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
}                          from '../lib/dashboard/observability.js'
import { fetchDailySeries } from '../lib/dashboard/snapshotSeries.js'

const MANAGER_ROLES  = new Set(['manager', 'admin', 'system_admin', 'super_admin'])
const MAX_PAGE_LIMIT = 50
const MAX_AGE_HOURS  = 168  // 7 dias de janela de busca (igual ao v1)
const TREND_DAYS     = 7    // janela da trendline de SLA

/** Subtrai N dias de uma data UTC e retorna YYYY-MM-DD */
function subDays(base: Date, n: number): string {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

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

    // 3. RBAC — idêntico ao sla-alerts.ts
    const callerRole = membership.role
    const rawUserId  = typeof req.query.user_id === 'string' ? req.query.user_id.trim() : null

    let effectiveUserId: string | null = null

    if (!MANAGER_ROLES.has(callerRole)) {
      // seller/partner: SEMPRE usa o próprio user.id
      effectiveUserId = user.id
    } else if (rawUserId) {
      // manager/admin+ com user_id específico: valida membership do alvo
      const targetMembership = await assertMembership(svc, rawUserId, companyId)
      if (!targetMembership) {
        jsonError(res, 403, 'Usuário selecionado não é membro ativo desta empresa'); return
      }
      effectiveUserId = rawUserId
    }
    // manager/admin+ sem user_id → retorna todos (effectiveUserId = null)

    // 4. Paginação e parâmetros (idêntico ao v1)
    const slaHours = Math.max(0, Number(req.query.sla_hours) || 6)
    const page     = Math.max(1, Number(req.query.page)  || 1)
    const limit    = Math.min(MAX_PAGE_LIMIT, Math.max(1, Number(req.query.limit) || 20))
    const offset   = (page - 1) * limit

    // 5. Janela histórica: D-7 até D-1
    const today    = new Date()
    const toDate   = subDays(today, 1)
    const fromDate = subDays(today, TREND_DAYS)

    const ctx = { companyId, slaHours, page, limit }

    // 6. Realtime + histórico em paralelo
    const [alertsResult, trendResult] = await Promise.allSettled([

      withTiming(
        'sla-alerts-v2.realtime',
        async () => {
          const { data, error } = await svc.rpc('get_dashboard_sla_alerts', {
            p_company_id:    companyId,
            p_user_id:       effectiveUserId ?? null,
            p_sla_hours:     slaHours,
            p_max_age_hours: MAX_AGE_HOURS,
            p_limit:         limit,
            p_offset:        offset,
          })
          if (error) throw new Error(`get_dashboard_sla_alerts: ${error.message}`)
          return data as { items: any[]; total: number } | null
        },
        ctx,
      ),

      withTiming(
        'sla-alerts-v2.historical',
        () => fetchDailySeries(svc, {
          companyId,
          funnelId: null,
          metrics:  ['sla_breached_count'],
          fromDate,
          toDate,
        }),
        ctx,
      ),

    ])

    // 7. Realtime é obrigatório — falha → 500
    if (alertsResult.status === 'rejected') {
      logDashboardError('sla-alerts-v2', alertsResult.reason, {
        endpoint:  '/api/dashboard/sla-alerts-v2',
        companyId,
      })
      logEndpointCall(svc, { companyId, endpoint: 'sla-alerts-v2', status: 'error', mode: null, durationMs: Date.now() - _startedAt })
      jsonError(res, 500, 'Erro ao carregar alertas de SLA')
      return
    }

    const rpcResult = alertsResult.value
    const items     = rpcResult?.items ?? []
    const total     = rpcResult?.total ?? 0

    // 8. Histórico — falha → null (degradação silenciosa)
    //    Shape compatível com SnapshotTrendsData para SlaAlertsPanel funcionar sem alteração.
    let historicalPayload: {
      ok:          true
      company_id:  string
      funnel_id:   null
      from_date:   string
      to_date:     string
      metrics:     ['sla_breached_count']
      data_points: number
      series:      any[]
    } | null = null

    if (trendResult.status === 'fulfilled') {
      const series = trendResult.value
      historicalPayload = {
        ok:          true,
        company_id:  companyId,
        funnel_id:   null,
        from_date:   fromDate,
        to_date:     toDate,
        metrics:     ['sla_breached_count'],
        data_points: series.length,
        series,
      }
      if (series.length === 0) {
        // Caso B: fulfilled mas sem snapshots para a janela de 7 dias
        logHistoricalFallback(svc, {
          companyId,
          endpoint:       'sla-alerts-v2',
          reason:         'no_snapshot_data',
          comparisonMode: null,
        })
      }
    } else {
      console.warn('[sla-alerts-v2] historical failed (degraded silently):', trendResult.reason?.message)
      // Caso A: fetchDailySeries lançou erro
      logHistoricalFallback(svc, {
        companyId,
        endpoint:       'sla-alerts-v2',
        reason:         'aggregate_failed',
        comparisonMode: null,
      })
    }

    logEndpointCall(svc, {
      companyId,
      endpoint:   'sla-alerts-v2',
      status:     historicalPayload !== null ? 'ok' : 'fallback',
      mode:       null,
      durationMs: Date.now() - _startedAt,
    })

    return res.status(200).json({
      ok: true,
      alerts: {
        data: items,
        meta: {
          total,
          page,
          limit,
          has_more:  offset + items.length < total,
          sla_hours: slaHours,
        },
      },
      historical: historicalPayload,
      snapshot_meta: {
        available: historicalPayload !== null,
      },
    })

  } catch (err: unknown) {
    logDashboardError('sla-alerts-v2', err, {
      endpoint:  '/api/dashboard/sla-alerts-v2',
      companyId: typeof req.query.company_id === 'string' ? req.query.company_id : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
