// =====================================================
// useSnapshotSellerDeltas — Deltas WoW/MoM por vendedor.
//
// Chama /api/dashboard/snapshot-seller-deltas.
// Retorna deltas de attendance_rate, avg_response_min
// e sparkline de won_value por seller.
//
// Fallback silencioso (D3) se dados insuficientes.
// =====================================================

import { useState, useEffect, useRef } from 'react'
import { dashboardApi }                from '../../services/dashboardApi'
import type {
  SnapshotSellerDeltasData,
  SellerSnapshotDelta,
}                                      from '../../types/dashboard'
import type { ComparisonMode }         from '../../lib/snapshotPeriods'

type FallbackReason = 'missing_data' | 'api_error'

interface Options {
  companyId:        string | null | undefined
  mode:             ComparisonMode
  enabled?:         boolean
  /**
   * FASE 4.2 Sprint 1A — Tenant pode usar snapshots históricos.
   * Se false, suprime todos os requests (insufficient_history, degraded, critical).
   * Se undefined, não aplica gate de tenant (comportamento anterior).
   */
  canUseSnapshots?: boolean
}

interface Result {
  data:        SnapshotSellerDeltasData | null
  loading:     boolean
  /** Mapa de user_id → SellerSnapshotDelta para lookup O(1) */
  byUserId:    Map<string, SellerSnapshotDelta>
}

export function useSnapshotSellerDeltas({ companyId, mode, enabled = true, canUseSnapshots }: Options): Result {
  const [data,    setData]    = useState<SnapshotSellerDeltasData | null>(null)
  const [loading, setLoading] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const effectiveEnabled = enabled && canUseSnapshots !== false
    if (!effectiveEnabled || !companyId) {
      setData(null)
      setLoading(false)
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setLoading(true)

    dashboardApi
      .getSnapshotSellerDeltas(companyId, mode, ctrl.signal)
      .then(result => {
        if (ctrl.signal.aborted) return
        setData(result)
      })
      .catch(err => {
        if (ctrl.signal.aborted) return
        const reason: FallbackReason = err?.message?.includes('insuficientes') ? 'missing_data' : 'api_error'
        console.info('[useSnapshotSellerDeltas] fallback silencioso:', err?.message)
        if (companyId) dashboardApi.reportSnapshotFallback(companyId, 'seller-deltas', reason, mode)
        setData(null)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })

    return () => { ctrl.abort() }
  }, [companyId, mode, enabled, canUseSnapshots])

  const byUserId = new Map<string, SellerSnapshotDelta>()
  if (data?.sellers) {
    for (const s of data.sellers) {
      byUserId.set(s.user_id, s)
    }
  }

  return { data, loading, byUserId }
}
