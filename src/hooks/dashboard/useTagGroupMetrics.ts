import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { createRequestGate } from '../../lib/dashboard/tagGroupRequest'
import { dashboardApi, type DashboardFilters } from '../../services/dashboardApi'
import type { TagGroupMetricRow } from '../../types/dashboard'

interface UseTagGroupMetricsResult {
  rows: TagGroupMetricRow[]
  groupsConfigured: number
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useTagGroupMetrics(filters: DashboardFilters, enabled: boolean): UseTagGroupMetricsResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null
  const gateRef = useRef(createRequestGate())
  const companyRef = useRef<string | null>(null)

  const [rows, setRows] = useState<TagGroupMetricRow[]>([])
  const [groupsConfigured, setGroupsConfigured] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    const requestId = gateRef.current.next()

    if (!enabled || !companyId) {
      if (gateRef.current.isCurrent(requestId)) {
        setRows([])
        setGroupsConfigured(0)
        setError(null)
        setLoading(false)
      }
      return
    }

    if (filters.period.type === 'custom' && (!filters.period.startDate || !filters.period.endDate)) {
      return
    }

    if (companyRef.current !== companyId) {
      companyRef.current = companyId
      setRows([])
      setGroupsConfigured(0)
    }

    setLoading(true)
    setError(null)

    try {
      const res = await dashboardApi.getTagGroupMetrics(companyId, filters, signal)
      if (!gateRef.current.isCurrent(requestId)) return
      setRows(res.data ?? [])
      setGroupsConfigured(res.meta?.groups_configured ?? res.data?.length ?? 0)
    } catch (err: unknown) {
      if (!gateRef.current.isCurrent(requestId)) return
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Erro ao carregar os grupos de tags')
    } finally {
      if (gateRef.current.isCurrent(requestId)) setLoading(false)
    }
  }, [enabled, companyId, filters])

  useEffect(() => {
    const controller = new AbortController()
    void fetchData(controller.signal)
    return () => controller.abort()
  }, [fetchData])

  return {
    rows,
    groupsConfigured,
    loading,
    error,
    refetch: () => { void fetchData() },
  }
}
