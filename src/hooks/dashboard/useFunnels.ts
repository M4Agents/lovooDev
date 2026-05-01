// =====================================================
// useFunnels
// Busca a lista de funis ativos da empresa.
// Só faz request quando companyId estiver disponível.
// =====================================================

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type { FunnelItem } from '../../services/dashboardApi'

interface UseFunnelsResult {
  funnels: FunnelItem[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useFunnels(): UseFunnelsResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const [funnels, setFunnels] = useState<FunnelItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!companyId) return

    setLoading(true)
    setError(null)

    try {
      const res = await dashboardApi.getFunnels(companyId)
      setFunnels(res.data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar funis')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void load()
  }, [load])

  return { funnels, loading, error, refetch: load }
}
