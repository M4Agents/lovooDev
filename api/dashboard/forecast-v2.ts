// =====================================================
// GET /api/dashboard/forecast-v2
//
// Endpoint híbrido: forecast realtime + comparação histórica num único payload.
// FASE 4.2 Sprint 5 — Forecast Híbrido.
//
// Pré-condição (resolvida no frontend — Sprint 1A):
//   O endpoint assume que o frontend já validou canUseSnapshots = true
//   via useSnapshotHealth. Não recalcula health, maturity ou classification.
//
// Historical usa aggregate_snapshot_period × 2 (current + previous).
// Métricas: pipeline_weighted (STATE), pipeline_risk (STATE),
//           won_value (FLOW), stalled_count (STATE).
//
// Comportamento:
//   realtime falhou  → 500 (dado primário — sem fallback)
//   histórico falhou → historical: null (fallback silencioso)
//
// Query params:
//   company_id       (obrigatório)
//   period           (default: 30d)
//   start_date       (opcional)
//   end_date         (opcional)
//   funnel_id        (opcional)
//   user_id          (opcional)
//   comparison_mode  (wow | mom, default: wow)
//
// RBAC (idêntico ao forecast.ts v1):
//   seller/partner → SEMPRE usa o próprio user.id
//   manager+       → filtra por user_id se enviado (validado), ou retorna todos
//
// Nota: snapshots são company-wide ou por funnel — não por usuário.
// Quando user_id ativo, o histórico retorna dados de toda a empresa/funil como contexto.
//
// stalled_days: lido de dashboard_alert_settings.stalled_settings.idle_minutes (fallback 14d).
// =====================================================

import { getSupabaseAdmin }         from '../lib/automation/supabaseAdmin.js'
import { resolvePeriod }            from '../lib/dashboard/period.js'
import { resolveComparisonPeriods } from '../lib/dashboard/snapshotPeriods.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  assertFunnelBelongsToCompany,
  assertUserFunnelAccess,
  jsonError,
} from '../lib/dashboard/auth.js'
import {
  withTiming,
  logDashboardError,
  logHistoricalFallback,
  logEndpointCall,
}                           from '../lib/dashboard/observability.js'
import { calcDeltaPct }     from '../lib/dashboard/deltaUtils.js'
import { STALLED_DEFAULTS } from '../lib/dashboard/alertSettingsDefaults.js'

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

    // 3. RBAC — idêntico ao forecast.ts v1
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

    // 4. Período realtime
    const period     = typeof req.query.period     === 'string' ? req.query.period.trim()     : '30d'
    const start_date = typeof req.query.start_date === 'string' ? req.query.start_date.trim() : undefined
    const end_date   = typeof req.query.end_date   === 'string' ? req.query.end_date.trim()   : undefined

    let resolvedRange: { start: string; end: string }
    try {
      resolvedRange = resolvePeriod(period, start_date, end_date)
    } catch (e: any) {
      jsonError(res, 400, e.message ?? 'Período inválido')
      return
    }

    // 5. Validação de funnel_id (opcional) + restrições pessoais de funis (Fase 2)
    const rawFunnelId = typeof req.query.funnel_id === 'string' ? req.query.funnel_id.trim() : null
    let funnelId = rawFunnelId

    if (funnelId) {
      const valid = await assertFunnelBelongsToCompany(svc, funnelId, companyId)
      if (!valid) { jsonError(res, 403, 'funnel_id não pertence à empresa'); return }
    }

    const funnelAccess = await assertUserFunnelAccess({
      svc, userId: user.id, companyId, role: callerRole, funnelId,
    })
    if (!funnelAccess.ok) { jsonError(res, funnelAccess.status, funnelAccess.error); return }

    // Usuário restrito sem funnel_id: auto-selecionar se houver apenas 1 funil permitido
    if (funnelAccess.allowedFunnelIds !== null && !funnelId) {
      const allowed = funnelAccess.allowedFunnelIds
      if (allowed.length === 1) {
        funnelId = allowed[0]
      } else {
        jsonError(res, 400, 'Selecione um funil permitido para visualizar o Dashboard.')
        return
      }
    }

    // 5.5. Resolver stalled_days a partir das configurações da empresa
    //      Fonte: dashboard_alert_settings.stalled_settings.idle_minutes; fallback 14d
    const { data: stalledSettingsRow } = await svc
      .from('dashboard_alert_settings')
      .select('stalled_settings')
      .eq('company_id', companyId)
      .maybeSingle()

    const stalledSettingsDb = (stalledSettingsRow?.stalled_settings as { idle_minutes?: number } | null) ?? {}
    const stalledDays = Math.round((stalledSettingsDb.idle_minutes ?? STALLED_DEFAULTS.idle_minutes) / 1440)

    // 6. Modo de comparação + períodos históricos (lib compartilhada)
    const rawMode = typeof req.query.comparison_mode === 'string'
      ? req.query.comparison_mode.trim()
      : 'wow'
    const comparisonMode: 'wow' | 'mom' = rawMode === 'mom' ? 'mom' : 'wow'
    const { currentFrom, currentTo, previousFrom, previousTo } =
      resolveComparisonPeriods(comparisonMode)

    const ctx = { companyId, period, comparisonMode }

    // 7. Realtime + histórico em paralelo
    const [realtimeResult, currentResult, previousResult] = await Promise.allSettled([

      withTiming(
        'forecast-v2.realtime',
        async () => {
          const { data, error } = await svc.rpc('get_dashboard_forecast', {
            p_company_id:   companyId,
            p_start_date:   resolvedRange.start.split('T')[0],
            p_end_date:     resolvedRange.end.split('T')[0],
            p_funnel_id:    funnelId ?? null,
            p_user_id:      effectiveUserId ?? null,
            p_stalled_days: stalledDays,
          })
          if (error) throw new Error(`get_dashboard_forecast: ${error.message}`)
          return data ?? {
            pipeline_total: 0, pipeline_weighted: 0, pipeline_risk: 0,
            pipeline_safe: 0, open_count: 0, stalled_count: 0,
            stalled_value: 0, stalled_weighted_value: 0,
            won_value: 0, won_count: 0, lost_value: 0, lost_count: 0,
            conversion_rate: 0,
          }
        },
        ctx,
      ),

      withTiming(
        'forecast-v2.historical.current',
        async () => {
          const { data, error } = await svc.rpc('aggregate_snapshot_period', {
            p_company_id: companyId,
            p_funnel_id:  funnelId ?? null,
            p_start_date: currentFrom,
            p_end_date:   currentTo,
          })
          if (error) throw new Error(`aggregate_snapshot_period/current: ${error.message}`)
          if (!data) throw new Error('Dados de snapshot insuficientes — período atual')
          return data as any
        },
        ctx,
      ),

      withTiming(
        'forecast-v2.historical.previous',
        async () => {
          const { data, error } = await svc.rpc('aggregate_snapshot_period', {
            p_company_id: companyId,
            p_funnel_id:  funnelId ?? null,
            p_start_date: previousFrom,
            p_end_date:   previousTo,
          })
          if (error) throw new Error(`aggregate_snapshot_period/previous: ${error.message}`)
          if (!data) throw new Error('Dados de snapshot insuficientes — período anterior')
          return data as any
        },
        ctx,
      ),

    ])

    // 8. Realtime é obrigatório — falha → 500
    if (realtimeResult.status === 'rejected') {
      logDashboardError('forecast-v2', realtimeResult.reason, {
        endpoint:  '/api/dashboard/forecast-v2',
        companyId,
        period,
      })
      logEndpointCall(svc, { companyId, endpoint: 'forecast-v2', status: 'error', mode: comparisonMode, durationMs: Date.now() - _startedAt })
      jsonError(res, 500, 'Erro interno ao carregar forecast')
      return
    }

    const realtimeData = realtimeResult.value

    // 9. Histórico — qualquer falha → null (degradação silenciosa)
    let historicalPayload: {
      current:  { pipeline_weighted: number; pipeline_risk: number; won_value: number; stalled_count: number }
      previous: { pipeline_weighted: number; pipeline_risk: number; won_value: number; stalled_count: number }
      deltas: {
        pipeline_weighted_pct: number | null
        pipeline_risk_pct:     number | null
        won_value_pct:         number | null
        stalled_count_pct:     number | null
      }
      comparison_mode: 'wow' | 'mom'
      current_from:    string
      current_to:      string
      previous_from:   string
      previous_to:     string
    } | null = null

    if (currentResult.status === 'fulfilled' && previousResult.status === 'fulfilled') {
      const curr = currentResult.value
      const prev = previousResult.value

      const currPipelineWeighted = Number(curr.state?.pipeline_weighted ?? 0)
      const currPipelineRisk     = Number(curr.state?.pipeline_risk     ?? 0)
      const currWonValue         = Number(curr.flow?.won_value          ?? 0)
      const currStalledCount     = Number(curr.state?.stalled_count     ?? 0)

      const prevPipelineWeighted = Number(prev.state?.pipeline_weighted ?? 0)
      const prevPipelineRisk     = Number(prev.state?.pipeline_risk     ?? 0)
      const prevWonValue         = Number(prev.flow?.won_value          ?? 0)
      const prevStalledCount     = Number(prev.state?.stalled_count     ?? 0)

      historicalPayload = {
        current: {
          pipeline_weighted: currPipelineWeighted,
          pipeline_risk:     currPipelineRisk,
          won_value:         currWonValue,
          stalled_count:     currStalledCount,
        },
        previous: {
          pipeline_weighted: prevPipelineWeighted,
          pipeline_risk:     prevPipelineRisk,
          won_value:         prevWonValue,
          stalled_count:     prevStalledCount,
        },
        deltas: {
          pipeline_weighted_pct: calcDeltaPct(currPipelineWeighted, prevPipelineWeighted),
          pipeline_risk_pct:     calcDeltaPct(currPipelineRisk,     prevPipelineRisk),
          won_value_pct:         calcDeltaPct(currWonValue,         prevWonValue),
          stalled_count_pct:     calcDeltaPct(currStalledCount,     prevStalledCount),
        },
        comparison_mode: comparisonMode,
        current_from:    currentFrom,
        current_to:      currentTo,
        previous_from:   previousFrom,
        previous_to:     previousTo,
      }
    } else {
      const failedLeg =
        currentResult.status  === 'rejected' ? 'current'  :
        previousResult.status === 'rejected' ? 'previous' : 'unknown'
      const failReason =
        currentResult.status  === 'rejected' ? currentResult.reason  :
        previousResult.status === 'rejected' ? previousResult.reason : null
      console.warn(`[forecast-v2] historical ${failedLeg} failed (degraded silently):`, failReason?.message)
      // Caso A: aggregate_snapshot_period falhou em current ou previous
      logHistoricalFallback(svc, {
        companyId,
        endpoint:       'forecast-v2',
        reason:         'aggregate_failed',
        comparisonMode,
      })
    }

    res.setHeader(
      'Cache-Control',
      funnelAccess.allowedFunnelIds !== null ? 'no-store' : 's-maxage=120, stale-while-revalidate=300',
    )

    logEndpointCall(svc, {
      companyId,
      endpoint:   'forecast-v2',
      status:     historicalPayload !== null ? 'ok' : 'fallback',
      mode:       comparisonMode,
      durationMs: Date.now() - _startedAt,
    })

    return res.status(200).json({
      ok:       true,
      realtime: realtimeData,
      historical: historicalPayload,
      snapshot_meta: {
        available:       historicalPayload !== null,
        comparison_mode: comparisonMode,
        funnel_scoped:   funnelId !== null,
      },
      meta: {
        period,
        start:            resolvedRange.start,
        end:              resolvedRange.end,
        funnel_id:        funnelId,
        user_id:          effectiveUserId,
        stalled_days_used: stalledDays,
      },
    })

  } catch (err: unknown) {
    logDashboardError('forecast-v2', err, {
      endpoint:  '/api/dashboard/forecast-v2',
      companyId: typeof req.query.company_id === 'string' ? req.query.company_id : undefined,
      period:    typeof req.query.period     === 'string' ? req.query.period     : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
