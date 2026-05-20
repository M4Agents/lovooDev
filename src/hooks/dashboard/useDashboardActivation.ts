// =====================================================
// useDashboardActivation
// Busca métricas de prospecção e resgate por dia.
// Depende de: companyId + period + userId (DashboardFilters).
// Stack isolada — NÃO depende de useDashboardTrends.
// =====================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth }                     from '../../contexts/AuthContext'
import { dashboardActivationApi }      from '../../services/dashboardActivationApi'
import type { DashboardFilters }       from '../../types/dashboard'
import type { ActivationData, ActivationMeta } from '../../types/dashboard-activation'

interface UseDashboardActivationResult {
  data:    ActivationData | null
  meta:    ActivationMeta | null
  loading: boolean
  error:   string | null
  refetch: () => void
}

export function useDashboardActivation(
  filters: DashboardFilters,
): UseDashboardActivationResult {
  const { company } = useAuth()
  const companyId   = company?.id ?? null

  const [data,    setData]    = useState<ActivationData | null>(null)
  const [meta,    setMeta]    = useState<ActivationMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    if (!companyId) return

    // Período custom incompleto: aguarda datas
    if (
      filters.period.type === 'custom' &&
      (!filters.period.startDate || !filters.period.endDate)
    ) {
      return
    }

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      const res = await dashboardActivationApi.getActivation(
        companyId,
        filters,
        abortRef.current.signal,
      )
      setData(res.data)
      setMeta(res.meta)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar métricas de ativação')
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
