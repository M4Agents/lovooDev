// =====================================================
// useDashboardSummary
// Busca KPIs executivos + agent_mode + funnel_mode.
//
// Modo v1 (padrão):
//   Chama GET /api/dashboard/summary — realtime puro.
//
// Modo v2 (hybridMode=true + FASE 4.2 Sprint 2):
//   Chama GET /api/dashboard/executive-summary-v2.
//   Retorna os mesmos KPIs realtime + historicalComparison.
//   Requer canUseSnapshots=true (validado pelo caller via useSnapshotHealth).
//
// Rollback: desligar VITE_FEATURE_HYBRID_EXECUTIVE_SUMMARY → hybridMode=false → v1.
// =====================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth }           from '../../contexts/AuthContext'
import { dashboardApi }      from '../../services/dashboardApi'
import type { ExecutiveData, DashboardFilters } from '../../services/dashboardApi'
import type { SnapshotComparisonData, ExecutiveSummaryV2SnapshotMeta } from '../../types/dashboard'
import type { ComparisonMode } from '../../lib/snapshotPeriods'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface HybridOptions {
  /** Quando true, usa executive-summary-v2 em vez de summary v1 */
  hybridMode:     boolean
  /** Modo de comparação WoW/MoM para o payload histórico */
  comparisonMode: ComparisonMode
}

interface UseDashboardSummaryResult {
  data:    ExecutiveData | null
  meta:    { period: string; start_date: string; end_date: string } | null
  loading: boolean
  error:   string | null
  refetch: () => void
  /** true quando os KPIs foram filtrados por userId (seller/partner ou manager com filtro) */
  userScoped: boolean
  /** Populado apenas quando hybridMode=true — comparação histórica do v2 */
  historicalComparison: SnapshotComparisonData | null
  /** Populado apenas quando hybridMode=true — metadados do snapshot */
  snapshotMeta:         ExecutiveSummaryV2SnapshotMeta | null
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDashboardSummary(
  filters:     DashboardFilters,
  hybridOpts?: HybridOptions,
): UseDashboardSummaryResult {
  const { company }   = useAuth()
  const companyId     = company?.id ?? null

  const [data,    setData]    = useState<ExecutiveData | null>(null)
  const [meta,    setMeta]    = useState<{ period: string; start_date: string; end_date: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [userScoped,           setUserScoped]           = useState(false)
  const [historicalComparison, setHistoricalComparison] = useState<SnapshotComparisonData | null>(null)
  const [snapshotMeta,         setSnapshotMeta]         = useState<ExecutiveSummaryV2SnapshotMeta | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  // Desestruturar para não colocar objeto como dep de useCallback
  const hybridMode     = hybridOpts?.hybridMode     ?? false
  const comparisonMode = hybridOpts?.comparisonMode ?? 'wow'

  const fetch = useCallback(async () => {
    if (!companyId) return

    if (filters.period.type === 'custom' && (!filters.period.startDate || !filters.period.endDate)) {
      return
    }


    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      if (hybridMode) {
        // ── Modo v2: realtime + comparação histórica ───────────────────────
        const res = await dashboardApi.getExecutiveSummaryV2(
          companyId,
          filters,
          comparisonMode,
          abortRef.current.signal,
        )

        // Normalizar realtime para o mesmo shape de ExecutiveData
        setData({
          leads_count:             res.realtime.leads_count,
          conversations_count:     res.realtime.conversations_count,
          hot_opportunities_count: res.realtime.hot_opportunities_count,
          alerts_count:            res.realtime.alerts_count,
          agent_mode:              res.realtime.agent_mode,
          funnel_mode:             res.realtime.funnel_mode,
        })
        setMeta({
          period:     res.meta.period,
          start_date: res.meta.start_date,
          end_date:   res.meta.end_date,
        })
        setUserScoped(res.snapshot_meta?.user_scoped ?? res.meta?.user_scoped ?? false)
        // Dados históricos — null quando comparison falhou no backend
        setHistoricalComparison(res.historical?.comparison ?? null)
        setSnapshotMeta(res.snapshot_meta)

      } else {
        // ── Modo v1: realtime puro (comportamento original) ────────────────
        const res = await dashboardApi.getSummary(companyId, filters, abortRef.current.signal)
        setData(res.data)
        setMeta(res.meta)
        setUserScoped(res.meta?.user_scoped ?? false)
        setHistoricalComparison(null)
        setSnapshotMeta(null)
      }

    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar resumo')
    } finally {
      setLoading(false)
    }
  }, [companyId, filters, hybridMode, comparisonMode])

  useEffect(() => {
    void fetch()
    return () => abortRef.current?.abort()
  }, [fetch])

  return { data, meta, loading, error, refetch: fetch, userScoped, historicalComparison, snapshotMeta }
}
