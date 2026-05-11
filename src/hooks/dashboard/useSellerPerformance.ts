// =====================================================
// useSellerPerformance
// Busca ranking comercial com score composto por vendedor.
// is_individual_view = true quando seller/partner ou manager filtrando.
// =====================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type { SellerRankingEntry, SellerRankingMeta, DashboardFilters } from '../../types/dashboard'

interface UseSellerPerformanceResult {
  data:    SellerRankingEntry[]
  meta:    SellerRankingMeta | null
  loading: boolean
  error:   string | null
  refetch: () => void
}

export function useSellerPerformance(filters: DashboardFilters): UseSellerPerformanceResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const [data,    setData]    = useState<SellerRankingEntry[]>([])
  const [meta,    setMeta]    = useState<SellerRankingMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

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
      const res = await dashboardApi.getSellerPerformance(companyId, filters, abortRef.current.signal)
      setData(res.data ?? [])
      setMeta(res.meta)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar ranking comercial')
    } finally {
      setLoading(false)
    }
  }, [companyId, filters])

  useEffect(() => {
    void fetchData()
    return () => abortRef.current?.abort()
  }, [fetchData])

  return { data, meta, loading, error, refetch: fetchData }
}
