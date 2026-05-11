import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type { PriorityAlertsData, PriorityAlertsMeta } from '../../types/dashboard'

interface UsePriorityAlertsResult {
  data:    PriorityAlertsData | null
  meta:    PriorityAlertsMeta | null
  loading: boolean
  error:   string | null
  refetch: () => void
}

export function usePriorityAlerts(
  userId?: string | null,
): UsePriorityAlertsResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const [data, setData]       = useState<PriorityAlertsData | null>(null)
  const [meta, setMeta]       = useState<PriorityAlertsMeta | null>(null)
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
      const res = await dashboardApi.getPriorityAlerts(
        companyId,
        userId,
        abortRef.current.signal,
      )
      setData(res.data)
      setMeta(res.meta)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar alertas prioritários')
    } finally {
      setLoading(false)
    }
  }, [companyId, userId])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  return { data, meta, loading, error, refetch: load }
}
