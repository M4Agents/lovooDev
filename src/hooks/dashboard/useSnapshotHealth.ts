// =====================================================
// useSnapshotHealth — Estado de saúde da camada histórica do tenant.
//
// Consome GET /api/dashboard/snapshot-health e deriva:
//   - classification: healthy | insufficient_history | degraded | critical
//   - maturityStatus: mature | new
//   - freshnessOk: snapshot do dia anterior está presente (days_since <= 1)
//   - canUseSnapshots: tenant pode exibir widgets históricos (FASE 4.2)
//
// Regra oficial para canUseSnapshots:
//   classification === 'healthy' && maturityStatus === 'mature' && ready === true
//
// Em caso de erro: canUseSnapshots = false (fail-safe).
// Nunca bloqueia o dashboard — dados realtime não dependem deste hook.
//
// Cache: 5 minutos via staleTime — dados de saúde não mudam com frequência.
// =====================================================

import { useState, useEffect, useRef } from 'react'
import { dashboardApi }                from '../../services/dashboardApi'
import type {
  SnapshotClassification,
  SnapshotSeverity,
  SnapshotMaturityStatus,
}                                      from '../../types/dashboard'

export interface UseSnapshotHealthReturn {
  healthScore:     number | null
  severity:        SnapshotSeverity | null
  classification:  SnapshotClassification | null
  maturityStatus:  SnapshotMaturityStatus | null
  daysOfHistory:   number | null
  thresholdDays:   number | null
  ready:           boolean
  freshnessOk:     boolean
  canUseSnapshots: boolean
  loading:         boolean
  error:           string | null
}

const INITIAL_STATE: UseSnapshotHealthReturn = {
  healthScore:     null,
  severity:        null,
  classification:  null,
  maturityStatus:  null,
  daysOfHistory:   null,
  thresholdDays:   null,
  ready:           false,
  freshnessOk:     false,
  canUseSnapshots: false,
  loading:         false,
  error:           null,
}

/** Cache simples em memória: key = companyId, value = { data, fetchedAt } */
const healthCache = new Map<string, { data: UseSnapshotHealthReturn; fetchedAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000

function deriveFromRaw(raw: Awaited<ReturnType<typeof dashboardApi.getSnapshotHealth>>): UseSnapshotHealthReturn {
  const classification = raw.classification ?? null
  const maturityStatus = raw.maturity?.status ?? null
  const ready          = raw.readiness_4_2?.ready ?? false
  const daysSince      = raw.components?.freshness?.days_since ?? null

  const freshnessOk     = daysSince !== null && daysSince <= 1
  const canUseSnapshots = classification === 'healthy' && maturityStatus === 'mature' && ready === true

  return {
    healthScore:     raw.health_score ?? null,
    severity:        raw.severity ?? null,
    classification,
    maturityStatus,
    daysOfHistory:   raw.maturity?.days_of_history ?? null,
    thresholdDays:   raw.maturity?.threshold_days ?? null,
    ready,
    freshnessOk,
    canUseSnapshots,
    loading:         false,
    error:           null,
  }
}

export function useSnapshotHealth(companyId: string | null | undefined): UseSnapshotHealthReturn {
  const [state, setState] = useState<UseSnapshotHealthReturn>(INITIAL_STATE)
  const abortRef          = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!companyId) {
      setState(INITIAL_STATE)
      return
    }

    // Verificar cache
    const cached = healthCache.get(companyId)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setState(cached.data)
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setState(prev => ({ ...prev, loading: true, error: null }))

    dashboardApi
      .getSnapshotHealth(companyId, undefined, ctrl.signal)
      .then(raw => {
        if (ctrl.signal.aborted) return
        const derived = deriveFromRaw(raw)
        healthCache.set(companyId, { data: derived, fetchedAt: Date.now() })
        setState(derived)
      })
      .catch(err => {
        if (ctrl.signal.aborted) return
        // Fail-safe: erro nunca bloqueia dashboard, canUseSnapshots = false
        setState({
          ...INITIAL_STATE,
          loading:         false,
          error:           err?.message ?? 'Erro ao verificar saúde do snapshot',
          canUseSnapshots: false,
        })
      })

    return () => { ctrl.abort() }
  }, [companyId])

  return state
}
