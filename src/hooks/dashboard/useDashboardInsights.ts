// =====================================================
// useDashboardInsights
// Busca insights automáticos calculados por SQL/regras.
// Não chama o endpoint se period=custom com datas incompletas.
// =====================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type { InsightItem, DashboardFilters } from '../../services/dashboardApi'

interface UseDashboardInsightsResult {
  data:    InsightItem[]
  loading: boolean
  error:   string | null
  refetch: () => void
}

export function useDashboardInsights(filters: DashboardFilters): UseDashboardInsightsResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const [data,    setData]    = useState<InsightItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    if (!companyId) return

    // Período custom sem datas completas: aguardar
    if (filters.period.type === 'custom' && (!filters.period.startDate || !filters.period.endDate)) {
      return
    }

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      const res = await dashboardApi.getInsights(companyId, filters)
      setData(res.data)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar insights')
    } finally {
      setLoading(false)
    }
  }, [companyId, filters])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  return { data, loading, error, refetch: load }
}
