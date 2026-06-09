// =====================================================
// useSellerPerformance
// Busca ranking comercial com score composto por vendedor.
// is_individual_view = true quando seller/partner ou manager filtrando.
//
// FASE 4.2 Sprint 3 — modo híbrido opcional.
// Quando hybridMode=true, chama seller-ranking-v2 e retorna
// sellerDeltasMap populado a partir do payload histórico.
// Quando hybridMode=false (padrão), chama v1 sem alteração.
// =====================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth }         from '../../contexts/AuthContext'
import { dashboardApi }    from '../../services/dashboardApi'
import type {
  SellerRankingEntry,
  SellerRankingMeta,
  SellerSnapshotDelta,
  SellerRankingV2SnapshotMeta,
  DashboardFilters,
}                          from '../../types/dashboard'
import type { ComparisonMode } from '../../lib/snapshotPeriods'

export interface HybridOptions {
  hybridMode:     boolean
  comparisonMode: ComparisonMode
}

interface UseSellerPerformanceResult {
  data:            SellerRankingEntry[]
  meta:            SellerRankingMeta | null
  loading:         boolean
  error:           string | null
  refetch:         () => void
  /** Mapa de user_id → SellerSnapshotDelta — populado apenas quando hybridMode=true */
  sellerDeltasMap: Map<string, SellerSnapshotDelta>
  /** Metadados do snapshot — populado apenas quando hybridMode=true */
  snapshotMeta:    SellerRankingV2SnapshotMeta | null
}

export function useSellerPerformance(
  filters:     DashboardFilters,
  hybridOpts?: HybridOptions,
): UseSellerPerformanceResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const [data,            setData]           = useState<SellerRankingEntry[]>([])
  const [meta,            setMeta]           = useState<SellerRankingMeta | null>(null)
  const [loading,         setLoading]        = useState(false)
  const [error,           setError]          = useState<string | null>(null)
  const [sellerDeltasMap, setSellerDeltasMap] = useState<Map<string, SellerSnapshotDelta>>(new Map())
  const [snapshotMeta,    setSnapshotMeta]   = useState<SellerRankingV2SnapshotMeta | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const hybridMode     = hybridOpts?.hybridMode     ?? false
  const comparisonMode = hybridOpts?.comparisonMode ?? 'wow'

  const fetchData = useCallback(async () => {
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
        // v2 — hybrid endpoint: ranking + deltas num único request
        const res = await dashboardApi.getSellerRankingV2(
          companyId,
          filters,
          comparisonMode,
          abortRef.current.signal,
        )

        setData(res.ranking.data ?? [])
        setMeta(res.ranking.meta)
        setSnapshotMeta(res.snapshot_meta)

        // Constrói Map de deltas a partir do payload histórico
        const map = new Map<string, SellerSnapshotDelta>()
        if (res.historical?.sellers) {
          for (const s of res.historical.sellers) {
            map.set(s.user_id, s)
          }
        }
        setSellerDeltasMap(map)

      } else {
        // v1 — comportamento original inalterado
        const res = await dashboardApi.getSellerPerformance(companyId, filters, abortRef.current.signal)
        setData(res.data ?? [])
        setMeta(res.meta)
        setSellerDeltasMap(new Map())
        setSnapshotMeta(null)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar ranking comercial')
    } finally {
      setLoading(false)
    }
  }, [companyId, filters, hybridMode, comparisonMode])

  useEffect(() => {
    void fetchData()
    return () => abortRef.current?.abort()
  }, [fetchData])

  return { data, meta, loading, error, refetch: fetchData, sellerDeltasMap, snapshotMeta }
}
