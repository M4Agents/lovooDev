// =====================================================
// useDashboardTrends
// Busca séries temporais de leads e atendimentos por dia.
// Depende de: companyId + period + userId (DashboardFilters).
// =====================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type { TrendsData, TrendsMeta, DashboardFilters } from '../../types/dashboard'

interface UseDashboardTrendsResult {
  data:    TrendsData | null
  meta:    TrendsMeta | null
  loading: boolean
  error:   string | null
  refetch: () => void
}

export function useDashboardTrends(filters: DashboardFilters): UseDashboardTrendsResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const [data,    setData]    = useState<TrendsData | null>(null)
  const [meta,    setMeta]    = useState<TrendsMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    if (!companyId) return

    // Período custom incompleto: aguarda
    if (filters.period.type === 'custom' && (!filters.period.startDate || !filters.period.endDate)) {
      return
    }

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      const res = await dashboardApi.getTrends(companyId, filters, abortRef.current.signal)
      setData(res.data)
      setMeta(res.meta)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar tendências')
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
