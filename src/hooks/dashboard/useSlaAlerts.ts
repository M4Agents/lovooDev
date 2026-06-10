// =====================================================
// useSlaAlerts
// Busca leads sem resposta humana após sla_hours horas.
// Suporta paginação incremental ("carregar mais").
//
// FASE 4.2 Sprint 4 — modo híbrido opcional.
// Quando hybridMode=true, chama sla-alerts-v2 e retorna
// slaTrendData (SnapshotTrendsData) populado a partir do payload histórico.
// Quando hybridMode=false (padrão), chama v1 sem alteração.
//
// Regra loadMore + hybridMode:
//   append=false (inicial ou refetch): define slaTrendData a partir do v2
//   append=true  (loadMore p2+):       ignora historical — não sobrescreve slaTrendData
// =====================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth }      from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type {
  SlaAlertItem,
  SlaAlertsMeta,
  SnapshotTrendsData,
}                       from '../../types/dashboard'

export interface HybridOptions {
  hybridMode: boolean
}

interface UseSlaAlertsOptions {
  userId?:     string | null
  /** Threshold em horas. Quando ausente, o backend usa dashboard_alert_settings.sla_settings.min_minutes */
  slaHours?:   number
  limit?:      number
  hybridMode?: boolean
}

interface UseSlaAlertsResult {
  data:           SlaAlertItem[]
  meta:           SlaAlertsMeta | null
  loading:        boolean
  error:          string | null
  refetch:        () => void
  loadMore:       () => void
  /** Trendline de sla_breached_count — populado apenas quando hybridMode=true */
  slaTrendData:   SnapshotTrendsData | null
  /** Número de pontos da trend — para SnapshotDataGuard em SlaAlertsPanel */
  slaTrendPoints: number
}

export function useSlaAlerts(options: UseSlaAlertsOptions = {}): UseSlaAlertsResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const { userId = null, slaHours, limit = 20, hybridMode = false } = options

  const [data,          setData]         = useState<SlaAlertItem[]>([])
  const [meta,          setMeta]         = useState<SlaAlertsMeta | null>(null)
  const [page,          setPage]         = useState(1)
  const [loading,       setLoading]      = useState(false)
  const [error,         setError]        = useState<string | null>(null)
  const [slaTrendData,  setSlaTrendData] = useState<SnapshotTrendsData | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const fetchPage = useCallback(async (targetPage: number, append: boolean) => {
    if (!companyId) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    if (!append) setError(null)

    try {
      if (hybridMode) {
        // v2 — realtime + trend histórica num único request
        const res = await dashboardApi.getSlaAlertsV2(
          companyId,
          {
            userId:   userId ?? undefined,
            slaHours,
            page:     targetPage,
            limit,
          },
          abortRef.current.signal,
        )

        if (append) {
          setData(prev => [...prev, ...(res.alerts.data ?? [])])
        } else {
          setData(res.alerts.data ?? [])
          // Trend data: definida apenas no load inicial ou refetch
          // loadMore (append=true) ignora para não sobrescrever slaTrendData
          if (res.historical) {
            setSlaTrendData(res.historical)
          }
        }
        setMeta(res.alerts.meta)

      } else {
        // v1 — comportamento original inalterado
        const res = await dashboardApi.getSlaAlerts(
          companyId,
          { userId: userId ?? undefined, slaHours, page: targetPage, limit },
          abortRef.current.signal,
        )

        if (append) {
          setData(prev => [...prev, ...(res.data ?? [])])
        } else {
          setData(res.data ?? [])
          setSlaTrendData(null)
        }
        setMeta(res.meta)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar alertas de SLA')
    } finally {
      setLoading(false)
    }
  }, [companyId, userId, slaHours, limit, hybridMode])

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

  return {
    data,
    meta,
    loading,
    error,
    refetch,
    loadMore,
    slaTrendData,
    slaTrendPoints: slaTrendData?.data_points ?? 0,
  }
}
