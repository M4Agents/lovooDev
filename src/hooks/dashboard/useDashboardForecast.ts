import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type {
  ComparisonMode,
  DashboardFilters,
  ForecastData,
  ForecastMeta,
  ForecastV2Historical,
  ForecastV2SnapshotMeta,
} from '../../types/dashboard'

// ---------------------------------------------------------------------------
// HybridOptions — FASE 4.2 Sprint 5
// ---------------------------------------------------------------------------

export interface HybridOptions {
  hybridMode:     boolean
  comparisonMode: ComparisonMode
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

interface UseDashboardForecastResult {
  data:                ForecastData | null
  meta:                ForecastMeta | null
  loading:             boolean
  error:               string | null
  refetch:             () => void
  // Presentes apenas quando hybridMode = true
  historicalComparison: ForecastV2Historical | null
  snapshotMeta:         ForecastV2SnapshotMeta | null
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDashboardForecast(
  filters:     DashboardFilters,
  hybridOpts?: HybridOptions,
): UseDashboardForecastResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const hybridMode     = hybridOpts?.hybridMode     ?? false
  const comparisonMode = hybridOpts?.comparisonMode ?? 'wow'

  const [data, setData]       = useState<ForecastData | null>(null)
  const [meta, setMeta]       = useState<ForecastMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const [historicalComparison, setHistoricalComparison] =
    useState<ForecastV2Historical | null>(null)
  const [snapshotMeta, setSnapshotMeta] =
    useState<ForecastV2SnapshotMeta | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    if (!companyId) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      if (hybridMode) {
        const res = await dashboardApi.getForecastV2(
          companyId,
          filters,
          comparisonMode,
          abortRef.current.signal,
        )
        setData(res.realtime as unknown as ForecastData)
        setMeta({
          period:     res.meta.period,
          start_date: res.meta.start,
          end_date:   res.meta.end,
          funnel_id:  res.meta.funnel_id ?? undefined,
          user_id:    res.meta.user_id   ?? undefined,
        } as ForecastMeta)
        setHistoricalComparison(res.historical ?? null)
        setSnapshotMeta(res.snapshot_meta)
      } else {
        const res = await dashboardApi.getForecast(
          companyId,
          filters,
          abortRef.current.signal,
        )
        setData(res.data)
        setMeta(res.meta)
        setHistoricalComparison(null)
        setSnapshotMeta(null)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar forecast')
    } finally {
      setLoading(false)
    }
  }, [
    companyId,
    filters.period,
    filters.funnelId,
    filters.userId,
    hybridMode,
    comparisonMode,
  ])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  return {
    data,
    meta,
    loading,
    error,
    refetch: load,
    historicalComparison,
    snapshotMeta,
  }
}
