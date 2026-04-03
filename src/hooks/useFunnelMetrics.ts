// =====================================================
// useFunnelMetrics — busca todas as métricas analíticas
// Recarrega automaticamente quando companyId ou filtros mudam
// =====================================================

import { useEffect, useState, useRef } from 'react'
import { reportsApi } from '../services/reportsApi'
import type { ReportFilters, ReportMetrics } from '../types/reports'

const EMPTY: ReportMetrics = {
  overview: null,
  stageMetrics: [],
  sellerMetrics: [],
  cycleMetrics: [],
}

export function useFunnelMetrics(companyId: string, filters: ReportFilters) {
  const [metrics, setMetrics] = useState<ReportMetrics>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Serializa filtros para detectar mudanças sem referências instáveis
  const filtersKey = JSON.stringify({
    from: filters.dateFrom.toISOString(),
    to: filters.dateTo.toISOString(),
    funnels: filters.funnelIds,
    stalled: filters.stalledDays,
  })

  const prevKey = useRef<string>('')

  useEffect(() => {
    if (!companyId || companyId === prevKey.current + filtersKey) return
    prevKey.current = companyId + filtersKey

    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      reportsApi.getFunnelOverview(companyId, filters),
      reportsApi.getStageTimeMetrics(companyId, filters),
      reportsApi.getSellerPerformance(companyId, filters),
      reportsApi.getCycleTimeMetrics(companyId, filters),
    ])
      .then(([overview, stageMetrics, sellerMetrics, cycleMetrics]) => {
        if (cancelled) return
        setMetrics({ overview, stageMetrics, sellerMetrics, cycleMetrics })
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Erro ao carregar relatórios')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, filtersKey])

  return { metrics, loading, error }
}
