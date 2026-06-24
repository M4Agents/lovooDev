// =====================================================
// GET /api/dashboard/funnel-executive-v2
//
// Endpoint híbrido: visão executiva do funil (realtime) +
// comparação histórica por etapa (WoW/MoM) em payload único.
// FASE 4.2 Sprint 6 — Funnel Executive Híbrido.
//
// Pré-condição (resolvida no frontend — Sprint 1A):
//   O endpoint assume que o frontend já validou canUseSnapshots = true
//   via useSnapshotHealth. Não recalcula health, maturity ou classification.
//
// Sequência (campo sequential obrigatório antes do paralelo):
//   1. Auth + Membership
//   2. detectFunnelMode (síncrono — necessário para validação de funnel_id)
//   3. Resolução de effective_funnel_id (síncrono — requerido por aggregate_snapshot_period)
//   4. resolveComparisonPeriods
//   5. Promise.allSettled([realtime, historical×2])
//
// Matching histórico: sempre por stage_id — nunca por position.
//
// Comportamento:
//   realtime falhou       → 500 (dado primário — sem fallback)
//   histórico falhou      → historical: null (fallback silencioso)
//   funnel_stages_cache ausente → historical: null
//
// Query params:
//   company_id       (obrigatório)
//   funnel_id        (obrigatório em multi-funnel; resolvido automaticamente em single-funnel)
//   comparison_mode  (wow | mom, default: wow)
//
// RBAC: sem filtro por usuário — sempre company/funnel-wide (idêntico ao v1).
// =====================================================

import { getSupabaseAdmin }         from '../lib/automation/supabaseAdmin.js'
import { detectFunnelMode }         from '../lib/dashboard/metrics.js'
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
}                       from '../lib/dashboard/observability.js'
import { calcDeltaPct } from '../lib/dashboard/deltaUtils.js'

// ---------------------------------------------------------------------------
// Tipos locais
// ---------------------------------------------------------------------------

interface StageCacheItem {
  stage_id:       string
  stage_name:     string
  position:       number
  color:          string | null
  opp_count:      number
  total_value:    number
  weighted_value: number
  stalled_count:  number
  avg_days:       number
}

interface StageHistoricalDelta {
  stage_id:           string
  weighted_value_pct: number | null
  stalled_count_pct:  number | null
}

// ---------------------------------------------------------------------------
// buildStageDeltas — matching por stage_id (nunca por position)
// ---------------------------------------------------------------------------

function buildStageDeltas(
  currentCache:  StageCacheItem[],
  previousCache: StageCacheItem[],
): StageHistoricalDelta[] {
  const prevMap = new Map<string, StageCacheItem>(
    previousCache.map(s => [s.stage_id, s]),
  )

  return currentCache.map(curr => {
    const prev = prevMap.get(curr.stage_id) ?? null
    return {
      stage_id:           curr.stage_id,
      weighted_value_pct: prev !== null
        ? calcDeltaPct(curr.weighted_value, prev.weighted_value)
        : null,
      stalled_count_pct:  prev !== null
        ? calcDeltaPct(curr.stalled_count, prev.stalled_count)
        : null,
    }
  })
}

// ---------------------------------------------------------------------------
// parseStageCacheItem — extrai e normaliza itens do funnel_stages_cache
// ---------------------------------------------------------------------------

function parseStageCacheItem(raw: Record<string, unknown>): StageCacheItem {
  return {
    stage_id:       String(raw.stage_id       ?? ''),
    stage_name:     String(raw.stage_name     ?? ''),
    position:       Number(raw.position       ?? 0),
    color:          raw.color != null ? String(raw.color) : null,
    opp_count:      Number(raw.opp_count      ?? 0),
    total_value:    Number(raw.total_value    ?? 0),
    weighted_value: Number(raw.weighted_value ?? 0),
    stalled_count:  Number(raw.stalled_count  ?? 0),
    avg_days:       Number(raw.avg_days       ?? 0),
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

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

    // 3. Detecção de modo de funil (síncrono — necessário para validação)
    const funnelId   = typeof req.query.funnel_id === 'string' ? req.query.funnel_id.trim() : ''
    const funnelMode = await detectFunnelMode(svc, companyId)

    if (funnelMode === 'multi-funnel' && !funnelId) {
      jsonError(res, 400, 'funnel_id é obrigatório quando a empresa possui múltiplos funis')
      return
    }

    // 4. Resolução de effective_funnel_id (síncrono — requerido por aggregate_snapshot_period)
    let effectiveFunnelId = funnelId

    if (!effectiveFunnelId) {
      // Single-funnel sem funnel_id explícito: resolve o funil padrão
      const { data: defaultFunnel } = await svc
        .from('sales_funnels')
        .select('id')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!defaultFunnel) {
        // Empresa sem nenhum funil ativo → resposta vazia (sem erro)
        return res.status(200).json({
          ok:   true,
          data: { funnel_id: null, stages: [] },
          meta: { funnel_id: null, funnel_mode: funnelMode },
          historical:    null,
          snapshot_meta: { available: false, comparison_mode: 'wow', funnel_id: null },
        })
      }

      effectiveFunnelId = defaultFunnel.id
    } else {
      const valid = await assertFunnelBelongsToCompany(svc, effectiveFunnelId, companyId)
      if (!valid) { jsonError(res, 403, 'funnel_id não pertence à empresa'); return }
    }

    // 5. Verificar restrições pessoais de funis (Fase 2)
    const funnelAccess = await assertUserFunnelAccess({
      svc, userId: user.id, companyId, role: membership.role, funnelId: effectiveFunnelId,
    })
    if (!funnelAccess.ok) { jsonError(res, funnelAccess.status, funnelAccess.error); return }

    // 6. Modo de comparação + períodos históricos
    const rawMode = typeof req.query.comparison_mode === 'string'
      ? req.query.comparison_mode.trim()
      : 'wow'
    const comparisonMode: 'wow' | 'mom' = rawMode === 'mom' ? 'mom' : 'wow'
    const { currentFrom, currentTo, previousFrom, previousTo } =
      resolveComparisonPeriods(comparisonMode)

    const ctx = { companyId, funnelId: effectiveFunnelId, comparisonMode }

    // 6. Realtime + histórico × 2 em paralelo
    const [realtimeResult, currentResult, previousResult] = await Promise.allSettled([

      withTiming(
        'funnel_executive_v2.realtime',
        async () => {
          const { data, error } = await svc.rpc('get_dashboard_funnel_executive', {
            p_company_id: companyId,
            p_funnel_id:  effectiveFunnelId,
          })
          if (error) throw new Error(`get_dashboard_funnel_executive: ${error.message}`)
          return data as { funnel_id: string; stages: unknown[] } | null
        },
        ctx,
      ),

      withTiming(
        'funnel_executive_v2.historical.current',
        async () => {
          const { data, error } = await svc.rpc('aggregate_snapshot_period', {
            p_company_id: companyId,
            p_funnel_id:  effectiveFunnelId,
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
        'funnel_executive_v2.historical.previous',
        async () => {
          const { data, error } = await svc.rpc('aggregate_snapshot_period', {
            p_company_id: companyId,
            p_funnel_id:  effectiveFunnelId,
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

    // 7. Realtime é obrigatório — falha → 500
    if (realtimeResult.status === 'rejected') {
      logDashboardError('funnel_executive_v2.realtime', realtimeResult.reason, {
        endpoint:  '/api/dashboard/funnel-executive-v2',
        companyId,
        funnelId:  effectiveFunnelId,
      })
      logEndpointCall(svc, { companyId, endpoint: 'funnel-executive-v2', status: 'error', mode: comparisonMode, durationMs: Date.now() - _startedAt })
      jsonError(res, 500, 'Erro interno ao carregar funil executivo')
      return
    }

    const realtimeData = realtimeResult.value

    // 8. Histórico é opcional — qualquer falha → null (degradação silenciosa)
    let historicalPayload: {
      stages:          StageHistoricalDelta[]
      comparison_mode: 'wow' | 'mom'
      current_from:    string
      current_to:      string
      previous_from:   string
      previous_to:     string
    } | null = null

    if (currentResult.status === 'fulfilled' && previousResult.status === 'fulfilled') {
      const currData    = currentResult.value
      const prevData    = previousResult.value

      // funnel_stages_cache vem dentro de state (JSONB array)
      const currCache: Record<string, unknown>[] =
        Array.isArray(currData?.state?.funnel_stages_cache)
          ? currData.state.funnel_stages_cache
          : []
      const prevCache: Record<string, unknown>[] =
        Array.isArray(prevData?.state?.funnel_stages_cache)
          ? prevData.state.funnel_stages_cache
          : []

      if (currCache.length > 0 && prevCache.length > 0) {
        const currStages = currCache.map(parseStageCacheItem)
        const prevStages = prevCache.map(parseStageCacheItem)
        const deltas     = buildStageDeltas(currStages, prevStages)

        historicalPayload = {
          stages:          deltas,
          comparison_mode: comparisonMode,
          current_from:    currentFrom,
          current_to:      currentTo,
          previous_from:   previousFrom,
          previous_to:     previousTo,
        }
      } else {
        console.warn(
          '[funnel-executive-v2] funnel_stages_cache vazio — historical degraded silently',
          { companyId, funnelId: effectiveFunnelId, currLen: currCache.length, prevLen: prevCache.length },
        )
        // Caso B: aggregate retornou dados mas funnel_stages_cache está ausente
        logHistoricalFallback(svc, {
          companyId,
          endpoint:       'funnel-executive-v2',
          reason:         'cache_empty',
          comparisonMode,
        })
      }
    } else {
      const failedLeg =
        currentResult.status  === 'rejected' ? 'current'  :
        previousResult.status === 'rejected' ? 'previous' : 'unknown'
      const failReason =
        currentResult.status  === 'rejected' ? currentResult.reason  :
        previousResult.status === 'rejected' ? previousResult.reason : null
      console.warn(`[funnel-executive-v2] historical ${failedLeg} failed (degraded silently):`, failReason?.message)
      // Caso A: aggregate_snapshot_period falhou em current ou previous
      logHistoricalFallback(svc, {
        companyId,
        endpoint:       'funnel-executive-v2',
        reason:         'aggregate_failed',
        comparisonMode,
      })
    }

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300')

    logEndpointCall(svc, {
      companyId,
      endpoint:   'funnel-executive-v2',
      status:     historicalPayload !== null ? 'ok' : 'fallback',
      mode:       comparisonMode,
      durationMs: Date.now() - _startedAt,
    })

    return res.status(200).json({
      ok:   true,
      data: realtimeData ?? { funnel_id: effectiveFunnelId, stages: [] },
      meta: {
        funnel_id:   effectiveFunnelId,
        funnel_mode: funnelMode,
      },
      historical: historicalPayload,
      snapshot_meta: {
        available:       historicalPayload !== null,
        comparison_mode: comparisonMode,
        funnel_id:       effectiveFunnelId,
      },
    })

  } catch (err: unknown) {
    logDashboardError('funnel_executive_v2', err, {
      endpoint:  '/api/dashboard/funnel-executive-v2',
      companyId: typeof req.query.company_id === 'string' ? req.query.company_id : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
