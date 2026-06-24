// =====================================================
// GET /api/dashboard/executive-summary-v2
//
// Endpoint híbrido: retorna KPIs realtime + comparação histórica
// em um único payload para tenants elegíveis.
//
// Pré-condição (resolvida no frontend — Sprint 1A):
//   O endpoint assume que o frontend já validou canUseSnapshots = true
//   via useSnapshotHealth. Não recalcula health, maturity ou classification.
//
// Comportamento:
//   - realtime falhar → 500 (dado primário — sem fallback)
//   - comparison falhar → historical: null (fallback silencioso)
//
// Query params:
//   company_id       (obrigatório)
//   period           (default: 30d)
//   start_date       (obrigatório quando period = custom)
//   end_date         (obrigatório quando period = custom)
//   funnel_id        (opcional)
//   comparison_mode  (wow | mom, default: wow)
//
// FASE 4.2 Sprint 2 — primeiro consumidor oficial do Snapshot Engine.
// =====================================================

import { getSupabaseAdmin }         from '../lib/automation/supabaseAdmin.js'
import { resolvePeriod }            from '../lib/dashboard/period.js'
import {
  detectAgentMode,
  detectFunnelMode,
  buildExecutiveMetrics,
}                                   from '../lib/dashboard/metrics.js'
import {
  resolveComparisonPeriods,
}                                   from '../lib/dashboard/snapshotPeriods.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  assertFunnelBelongsToCompany,
  assertUserFunnelAccess,
  jsonError,
}                                   from '../lib/dashboard/auth.js'
import {
  withTiming,
  logDashboardError,
  logHistoricalFallback,
  logEndpointCall,
}                    from '../lib/dashboard/observability.js'
import { calcDelta } from '../lib/dashboard/deltaUtils.js'

const MANAGER_ROLES = new Set(['manager', 'admin', 'system_admin', 'super_admin'])

// ---------------------------------------------------------------------------
// getComparisonData — chama aggregate_snapshot_period × 2 e calcula deltas
// ---------------------------------------------------------------------------

const FLOW_METRICS  = [
  'leads_created', 'won_count', 'won_value', 'lost_count',
  'lost_value', 'sla_breached_count', 'conversations_attended',
]
const STATE_METRICS = [
  'pipeline_total', 'pipeline_weighted', 'pipeline_risk',
  'open_count', 'stalled_count', 'hot_count', 'conversion_rate',
  'avg_response_minutes', 'prob_0_20_value', 'prob_21_40_value',
  'prob_41_60_value', 'prob_61_80_value', 'prob_81_100_value',
]

async function getComparisonData(
  svc:          any,
  companyId:    string,
  funnelId:     string | null,
  currentFrom:  string,
  currentTo:    string,
  previousFrom: string,
  previousTo:   string,
) {
  const [{ data: curr, error: currErr }, { data: prev, error: prevErr }] =
    await Promise.all([
      svc.rpc('aggregate_snapshot_period', {
        p_company_id: companyId,
        p_funnel_id:  funnelId,
        p_start_date: currentFrom,
        p_end_date:   currentTo,
      }),
      svc.rpc('aggregate_snapshot_period', {
        p_company_id: companyId,
        p_funnel_id:  funnelId,
        p_start_date: previousFrom,
        p_end_date:   previousTo,
      }),
    ])

  if (currErr) throw new Error(`aggregate_snapshot_period/current: ${currErr.message}`)
  if (prevErr) throw new Error(`aggregate_snapshot_period/previous: ${prevErr.message}`)
  if (!curr || !prev) throw new Error('Dados de snapshot insuficientes para o período')

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

  return {
    ok:       true,
    current:  curr,
    previous: prev,
    deltas,
    params: {
      company_id:    companyId,
      funnel_id:     funnelId,
      current_from:  currentFrom,
      current_to:    currentTo,
      previous_from: previousFrom,
      previous_to:   previousTo,
    },
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  const _startedAt = Date.now()

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET') { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // ── 1. Autenticação ──────────────────────────────────────────────────────
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const svc = getSupabaseAdmin()

    // ── 2. Membership ────────────────────────────────────────────────────────
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ── 3. RBAC — determina effectiveUserId por role ──────────────────────────
    const callerRole = membership.role
    const rawUserId  = typeof req.query.user_id === 'string' ? req.query.user_id.trim() : null

    let effectiveUserId: string | null = null

    if (!MANAGER_ROLES.has(callerRole)) {
      effectiveUserId = user.id
    } else if (rawUserId) {
      const targetMembership = await assertMembership(svc, rawUserId, companyId)
      if (!targetMembership) {
        jsonError(res, 403, 'Usuário selecionado não é membro ativo desta empresa'); return
      }
      effectiveUserId = rawUserId
    }

    // ── 4. Período realtime ──────────────────────────────────────────────────
    const period     = typeof req.query.period     === 'string' ? req.query.period.trim()     : '30d'
    const start_date = typeof req.query.start_date === 'string' ? req.query.start_date.trim() : undefined
    const end_date   = typeof req.query.end_date   === 'string' ? req.query.end_date.trim()   : undefined
    let funnelId     = typeof req.query.funnel_id  === 'string' ? req.query.funnel_id.trim()  : null

    // ── 4a. Validar funnel_id (se fornecido) + restrições pessoais (Fase 2) ──
    if (funnelId) {
      const valid = await assertFunnelBelongsToCompany(svc, funnelId, companyId)
      if (!valid) { jsonError(res, 403, 'funnel_id não pertence à empresa'); return }
    }

    const funnelAccess = await assertUserFunnelAccess({
      svc, userId: user.id, companyId, role: callerRole, funnelId,
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

    let resolvedRange: { start: string; end: string }
    try {
      resolvedRange = resolvePeriod(period, start_date, end_date)
    } catch (e: any) {
      jsonError(res, 400, e.message ?? 'Período inválido')
      return
    }

    // ── 4. Modo de comparação + períodos históricos ──────────────────────────
    const rawMode = typeof req.query.comparison_mode === 'string'
      ? req.query.comparison_mode.trim()
      : 'wow'
    const comparisonMode: 'wow' | 'mom' = rawMode === 'mom' ? 'mom' : 'wow'

    const { currentFrom, currentTo, previousFrom, previousTo } =
      resolveComparisonPeriods(comparisonMode)

    // ── 5. Realtime + comparação em paralelo ─────────────────────────────────
    const ctx = { companyId, period }

    const [realtimeResult, comparisonResult] = await Promise.allSettled([
      // Realtime: reutiliza os mesmos helpers do /api/dashboard/summary (v1)
      withTiming('executive_v2.realtime', async () => {
        const [agentMode, funnelMode, execMetrics] = await Promise.all([
          detectAgentMode(svc, companyId).catch(() => 'single-agent' as const),
          detectFunnelMode(svc, companyId).catch(() => 'single-funnel' as const),
          buildExecutiveMetrics(svc, companyId, resolvedRange, effectiveUserId),
        ])
        return { ...execMetrics, agent_mode: agentMode, funnel_mode: funnelMode }
      }, ctx),

      // Histórico: aggregate_snapshot_period × 2 + deltas
      withTiming('executive_v2.comparison', () =>
        getComparisonData(
          svc, companyId, funnelId,
          currentFrom, currentTo,
          previousFrom, previousTo,
        ),
        ctx,
      ),
    ])

    // Realtime é obrigatório — falha → 500
    if (realtimeResult.status === 'rejected') {
      logDashboardError('executive_v2.realtime', realtimeResult.reason, { endpoint: '/api/dashboard/executive-summary-v2' })
      logEndpointCall(svc, { companyId, endpoint: 'executive-summary-v2', status: 'error', mode: comparisonMode, durationMs: Date.now() - _startedAt })
      jsonError(res, 500, 'Erro interno ao carregar dados operacionais')
      return
    }

    // Histórico é opcional — falha → null (fallback silencioso)
    const historical =
      comparisonResult.status === 'fulfilled' && comparisonResult.value
        ? { comparison: comparisonResult.value }
        : null

    if (comparisonResult.status === 'rejected') {
      console.warn('[executive-summary-v2] comparison fallback:', (comparisonResult.reason as Error)?.message)
      // Caso A: aggregate_snapshot_period falhou
      logHistoricalFallback(svc, {
        companyId,
        endpoint:       'executive-summary-v2',
        reason:         'aggregate_failed',
        comparisonMode,
      })
    } else if (historical === null) {
      // Caso B: fulfilled mas valor ausente (snapshot sem dados para o período)
      logHistoricalFallback(svc, {
        companyId,
        endpoint:       'executive-summary-v2',
        reason:         'no_snapshot_data',
        comparisonMode,
      })
    }

    // ── 6. Resposta ──────────────────────────────────────────────────────────
    // user-scoped: dados por usuário — nunca cachear no CDN (URL é idêntica entre sellers)
    // company-wide: cache normal de 60s
    if (effectiveUserId !== null) {
      res.setHeader('Cache-Control', 'private, no-store')
    } else {
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    }

    logEndpointCall(svc, {
      companyId,
      endpoint:   'executive-summary-v2',
      status:     historical !== null ? 'ok' : 'fallback',
      mode:       comparisonMode,
      durationMs: Date.now() - _startedAt,
    })

    return res.status(200).json({
      ok:       true,
      realtime: realtimeResult.value,
      historical,
      snapshot_meta: {
        available:       historical !== null,
        comparison_mode: comparisonMode,
        current_period:  { from: currentFrom, to: currentTo },
        previous_period: { from: previousFrom, to: previousTo },
        // Quando user_scoped=true, deltas históricos são suprimidos no frontend
        // pois os snapshots não têm escopo por usuário.
        user_scoped:     effectiveUserId !== null,
      },
      meta: {
        period,
        start_date:  resolvedRange.start,
        end_date:    resolvedRange.end,
        user_id:     effectiveUserId ?? null,
        user_scoped: effectiveUserId !== null,
      },
    })

  } catch (err: unknown) {
    logDashboardError('executive_v2', err, { endpoint: '/api/dashboard/executive-summary-v2' })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
