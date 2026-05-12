// =====================================================
// useSnapshotComparison — Comparação WoW/MoM de snapshots.
//
// Chama /api/dashboard/snapshot-comparison com os períodos
// calculados para WoW (7d vs 7d) ou MoM (30d vs 30d).
//
// Regras de leitura:
//   - Realtime continua como source of truth operacional.
//   - Este hook é EXCLUSIVAMENTE para contexto histórico secundário.
//   - Não substitui endpoints realtime.
//
// Fallback (D3): se não houver dados → data = null, sem erro visível.
// =====================================================

import { useState, useEffect, useRef } from 'react'
import { dashboardApi }                from '../../services/dashboardApi'
import { getComparisonPeriods }        from '../../lib/snapshotPeriods'
import type { SnapshotComparisonData } from '../../types/dashboard'
import type { ComparisonMode }         from '../../lib/snapshotPeriods'

type FallbackReason = 'missing_data' | 'api_error'

interface Options {
  companyId:  string | null | undefined
  funnelId?:  string | null
  mode:       ComparisonMode
  /** Se false, o hook não faz nenhum request (flag desligada) */
  enabled?:   boolean
}

interface Result {
  data:    SnapshotComparisonData | null
  loading: boolean
  error:   string | null
}

export function useSnapshotComparison({ companyId, funnelId, mode, enabled = true }: Options): Result {
  const [data,    setData]    = useState<SnapshotComparisonData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!enabled || !companyId) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const { currentFrom, currentTo, previousFrom, previousTo } = getComparisonPeriods(mode)

    setLoading(true)
    setError(null)

    dashboardApi
      .getSnapshotComparison(
        companyId,
        currentFrom,
        currentTo,
        previousFrom,
        previousTo,
        funnelId,
        ctrl.signal,
      )
      .then(result => {
        if (ctrl.signal.aborted) return
        setData(result)
      })
      .catch(err => {
        if (ctrl.signal.aborted) return
        // Fallback silencioso (D3): registra no console e rastreia fire-and-forget
        const reason: FallbackReason = err?.message?.includes('insuficientes') ? 'missing_data' : 'api_error'
        console.info('[useSnapshotComparison] fallback silencioso:', err?.message)
        dashboardApi.reportSnapshotFallback(companyId, 'comparison', reason, mode)
        setData(null)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })

    return () => { ctrl.abort() }
  }, [companyId, funnelId, mode, enabled])

  return { data, loading, error }
}
