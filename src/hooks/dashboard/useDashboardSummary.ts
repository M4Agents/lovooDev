// =====================================================
// useDashboardSummary
// Busca KPIs executivos + agent_mode + funnel_mode.
// Depende de: companyId (AuthContext) + period (useDashboardFilters).
// =====================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type { ExecutiveData, DashboardFilters } from '../../services/dashboardApi'

interface UseDashboardSummaryResult {
  data: ExecutiveData | null
  meta: { period: string; start_date: string; end_date: string } | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useDashboardSummary(filters: DashboardFilters): UseDashboardSummaryResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const [data, setData]     = useState<ExecutiveData | null>(null)
  const [meta, setMeta]     = useState<{ period: string; start_date: string; end_date: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  // Evita race conditions: ignora respostas de requests antigos
  const abortRef = useRef<AbortController | null>(null)

  const fetch = useCallback(async () => {
    if (!companyId) return

    // Período custom sem datas completas: não chamar
    if (filters.period.type === 'custom' && (!filters.period.startDate || !filters.period.endDate)) {
      return
    }

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      const res = await dashboardApi.getSummary(companyId, filters)
      setData(res.data)
      setMeta(res.meta)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar resumo')
    } finally {
      setLoading(false)
    }
  }, [companyId, filters])

  useEffect(() => {
    void fetch()
    return () => abortRef.current?.abort()
  }, [fetch])

  return { data, meta, loading, error, refetch: fetch }
}
