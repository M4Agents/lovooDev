// =====================================================
// useFunnelFlow
// Fluxo no período + conversão por etapa.
// Depende de: companyId + funnelId + period.
// Se funnelId estiver ausente: não chama o endpoint.
// =====================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type { FunnelFlowData, DashboardMeta, DashboardFilters } from '../../services/dashboardApi'

interface UseFunnelFlowResult {
  data: FunnelFlowData | null
  meta: DashboardMeta | null
  loading: boolean
  error: string | null
  /** true quando funnelId está ausente — resultado esperado, não um erro */
  funnelRequired: boolean
  refetch: () => void
}

export function useFunnelFlow(
  funnelId: string | null | undefined,
  filters: DashboardFilters,
): UseFunnelFlowResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const [data, setData]     = useState<FunnelFlowData | null>(null)
  const [meta, setMeta]     = useState<DashboardMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  // Se não há funnelId, o componente deve mostrar "selecione um funil"
  const funnelRequired = !funnelId

  const fetch = useCallback(async () => {
    if (!companyId || !funnelId) return

    // Período custom sem datas completas: aguardar
    if (filters.period.type === 'custom' && (!filters.period.startDate || !filters.period.endDate)) {
      return
    }

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      const res = await dashboardApi.getFunnelFlow(companyId, funnelId, filters)
      setData(res.data)
      setMeta(res.meta)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar fluxo do funil')
    } finally {
      setLoading(false)
    }
  }, [companyId, funnelId, filters])

  useEffect(() => {
    // Limpa dados anteriores quando funnelId some
    if (!funnelId) {
      setData(null)
      setMeta(null)
      setError(null)
      return
    }

    void fetch()
    return () => abortRef.current?.abort()
  }, [fetch, funnelId])

  return { data, meta, loading, error, funnelRequired, refetch: fetch }
}
