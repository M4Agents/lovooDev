import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type { FunnelExecutiveData, FunnelExecutiveMeta, FunnelMode } from '../../types/dashboard'

interface UseFunnelExecutiveResult {
  data:          FunnelExecutiveData | null
  meta:          FunnelExecutiveMeta | null
  loading:       boolean
  error:         string | null
  funnelRequired: boolean
  refetch:       () => void
}

export function useFunnelExecutive(
  funnelId?:   string | null,
  funnelMode?: FunnelMode,
): UseFunnelExecutiveResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const [data, setData]       = useState<FunnelExecutiveData | null>(null)
  const [meta, setMeta]       = useState<FunnelExecutiveMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  // Mesma regra de useFunnelSnapshot: multi-funnel sem funnelId não faz request
  const funnelRequired = funnelMode === 'multi-funnel' && !funnelId

  const load = useCallback(async () => {
    if (!companyId) return
    if (funnelMode === 'multi-funnel' && !funnelId) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      const res = await dashboardApi.getFunnelExecutive(
        companyId,
        funnelId,
        abortRef.current.signal,
      )
      setData(res.data)
      setMeta(res.meta)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar funil executivo')
    } finally {
      setLoading(false)
    }
  }, [companyId, funnelId, funnelMode])

  useEffect(() => {
    if (funnelRequired) {
      setData(null)
      setMeta(null)
      setError(null)
      return
    }

    void load()
    return () => abortRef.current?.abort()
  }, [load, funnelRequired])

  return { data, meta, loading, error, funnelRequired, refetch: load }
}
