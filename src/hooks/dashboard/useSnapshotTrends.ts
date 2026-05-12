// =====================================================
// useSnapshotTrends — Série temporal histórica de snapshots.
//
// Chama /api/dashboard/snapshot-trends para buscar dados
// diários do período solicitado (máx. 30 dias).
//
// Regras:
//   - Mínimo 5 pontos para renderizar sparklines (D4)
//   - Fallback silencioso se dados insuficientes (D3)
//   - Limita a 30 dias conforme performance spec.
// =====================================================

import { useState, useEffect, useRef } from 'react'
import { dashboardApi }                from '../../services/dashboardApi'
import { getLastNDays }                from '../../lib/snapshotPeriods'
import type { SnapshotTrendsData }     from '../../types/dashboard'

type FallbackReason = 'missing_data' | 'api_error' | 'insufficient_points'

interface Options {
  companyId:  string | null | undefined
  funnelId?:  string | null
  metrics:    string[]
  /** Número de dias (máx. 30) */
  days?:      number
  enabled?:   boolean
}

interface Result {
  data:        SnapshotTrendsData | null
  loading:     boolean
  error:       string | null
  /** Número de pontos retornados (para SnapshotDataGuard) */
  dataPoints:  number
}

export function useSnapshotTrends({
  companyId,
  funnelId,
  metrics,
  days    = 7,
  enabled = true,
}: Options): Result {
  const [data,    setData]    = useState<SnapshotTrendsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  // Garante máximo de 30 dias
  const safeDays = Math.min(days, 30)

  const metricsKey = metrics.join(',')

  useEffect(() => {
    if (!enabled || !companyId || metrics.length === 0) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const { fromDate, toDate } = getLastNDays(safeDays)

    setLoading(true)
    setError(null)

    dashboardApi
      .getSnapshotTrends(companyId, fromDate, toDate, metrics, funnelId, ctrl.signal)
      .then(result => {
        if (ctrl.signal.aborted) return
        // Rastrear quando retorna dados insuficientes (< 5 pontos — D4)
        if (result.data_points > 0 && result.data_points < 5 && companyId) {
          dashboardApi.reportSnapshotFallback(companyId, 'trends', 'insufficient_points')
        }
        setData(result)
      })
      .catch(err => {
        if (ctrl.signal.aborted) return
        const reason: FallbackReason = err?.message?.includes('insuficientes') ? 'missing_data' : 'api_error'
        console.info('[useSnapshotTrends] fallback silencioso:', err?.message)
        if (companyId) dashboardApi.reportSnapshotFallback(companyId, 'trends', reason)
        setData(null)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })

    return () => { ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, funnelId, metricsKey, safeDays, enabled])

  return {
    data,
    loading,
    error,
    dataPoints: data?.data_points ?? 0,
  }
}
