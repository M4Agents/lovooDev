// =====================================================
// useSlaAlerts
// Busca leads sem resposta humana após sla_hours horas.
// Suporta paginação incremental ("carregar mais").
// =====================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type { SlaAlertItem, SlaAlertsMeta } from '../../types/dashboard'

interface UseSlaAlertsOptions {
  userId?:   string | null
  slaHours?: number
  limit?:    number
}

interface UseSlaAlertsResult {
  data:     SlaAlertItem[]
  meta:     SlaAlertsMeta | null
  loading:  boolean
  error:    string | null
  refetch:  () => void
  loadMore: () => void
}

export function useSlaAlerts(options: UseSlaAlertsOptions = {}): UseSlaAlertsResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const { userId = null, slaHours = 6, limit = 20 } = options

  const [data,    setData]    = useState<SlaAlertItem[]>([])
  const [meta,    setMeta]    = useState<SlaAlertsMeta | null>(null)
  const [page,    setPage]    = useState(1)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const fetchPage = useCallback(async (targetPage: number, append: boolean) => {
    if (!companyId) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    if (!append) setError(null)

    try {
      const res = await dashboardApi.getSlaAlerts(
        companyId,
        { userId: userId ?? undefined, slaHours, page: targetPage, limit },
        abortRef.current.signal,
      )

      if (append) {
        setData(prev => [...prev, ...(res.data ?? [])])
      } else {
        setData(res.data ?? [])
      }
      setMeta(res.meta)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar alertas de SLA')
    } finally {
      setLoading(false)
    }
  }, [companyId, userId, slaHours, limit])

  // Reset e re-fetch quando parâmetros mudam
  useEffect(() => {
    setPage(1)
    setData([])
    void fetchPage(1, false)
    return () => abortRef.current?.abort()
  }, [fetchPage])

  const refetch = useCallback(() => {
    setPage(1)
    setData([])
    void fetchPage(1, false)
  }, [fetchPage])

  const loadMore = useCallback(() => {
    if (loading || !meta?.has_more) return
    const next = page + 1
    setPage(next)
    void fetchPage(next, true)
  }, [loading, meta, page, fetchPage])

  return { data, meta, loading, error, refetch, loadMore }
}
