// =====================================================
// useFunnelSnapshot
// Pipeline atual: onde estão as oportunidades AGORA.
// NÃO depende de período — representa estado presente.
// Só refetch quando companyId, funnelId ou funnelMode mudar.
//
// Regra crítica: em multi-funnel, NÃO fazer request sem funnelId.
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
  /** true quando funnelId é obrigatório mas ausente — não é erro, é estado esperado */
  funnelRequired: boolean
  refetch: () => void
}

export function useFunnelSnapshot(
  funnelId?: string | null,
  funnelMode?: 'single-funnel' | 'multi-funnel',
): UseFunnelSnapshotResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const [data, setData]       = useState<FunnelSnapshotData | null>(null)
  const [meta, setMeta]       = useState<FunnelSnapshotMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  // Em multi-funnel sem funnelId: não faz request
  const funnelRequired = funnelMode === 'multi-funnel' && !funnelId

  const load = useCallback(async () => {
    if (!companyId) return
    if (funnelMode === 'multi-funnel' && !funnelId) return

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
  }, [companyId, funnelId, funnelMode])

  useEffect(() => {
    // Limpa dados quando entra em estado de "funil obrigatório"
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
