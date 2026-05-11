import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type { DashboardFilters, ForecastData, ForecastMeta } from '../../types/dashboard'

interface UseDashboardForecastResult {
  data:    ForecastData | null
  meta:    ForecastMeta | null
  loading: boolean
  error:   string | null
  refetch: () => void
}

export function useDashboardForecast(
  filters: DashboardFilters,
): UseDashboardForecastResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const [data, setData]       = useState<ForecastData | null>(null)
  const [meta, setMeta]       = useState<ForecastMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    if (!companyId) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      const res = await dashboardApi.getForecast(companyId, filters, abortRef.current.signal)
      setData(res.data)
      setMeta(res.meta)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar forecast')
    } finally {
      setLoading(false)
    }
  }, [companyId, filters.period, filters.funnelId, filters.userId])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  return { data, meta, loading, error, refetch: load }
}
