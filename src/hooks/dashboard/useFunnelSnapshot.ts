// =====================================================
// useFunnelSnapshot
// Pipeline atual: onde estão as oportunidades AGORA.
// NÃO depende de período — representa estado presente.
// Só refetch quando companyId ou funnelId mudar.
// =====================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type { FunnelSnapshotData, FunnelSnapshotMeta } from '../../services/dashboardApi'

interface UseFunnelSnapshotResult {
  data: FunnelSnapshotData | null
  meta: FunnelSnapshotMeta | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useFunnelSnapshot(funnelId?: string | null): UseFunnelSnapshotResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const [data, setData]     = useState<FunnelSnapshotData | null>(null)
  const [meta, setMeta]     = useState<FunnelSnapshotMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const fetch = useCallback(async () => {
    if (!companyId) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      const res = await dashboardApi.getFunnelSnapshot(companyId, funnelId)
      setData(res.data)
      setMeta(res.meta)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar pipeline atual')
    } finally {
      setLoading(false)
    }
  }, [companyId, funnelId])

  // Sem dependência de período — só companyId e funnelId
  useEffect(() => {
    void fetch()
    return () => abortRef.current?.abort()
  }, [fetch])

  return { data, meta, loading, error, refetch: fetch }
}
