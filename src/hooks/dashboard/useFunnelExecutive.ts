import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type {
  ComparisonMode,
  FunnelExecutiveData,
  FunnelExecutiveMeta,
  FunnelExecutiveV2StageHistorical,
  FunnelExecutiveV2SnapshotMeta,
  FunnelMode,
} from '../../types/dashboard'

// ---------------------------------------------------------------------------
// HybridOptions — FASE 4.2 Sprint 6
// ---------------------------------------------------------------------------

export interface HybridOptions {
  hybridMode:     boolean
  comparisonMode: ComparisonMode
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

interface UseFunnelExecutiveResult {
  data:          FunnelExecutiveData | null
  meta:          FunnelExecutiveMeta | null
  loading:       boolean
  error:         string | null
  funnelRequired: boolean
  refetch:       () => void
  // Presentes apenas quando hybridMode = true
  stageDeltasMap: Map<string, FunnelExecutiveV2StageHistorical>
  snapshotMeta:  FunnelExecutiveV2SnapshotMeta | null
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFunnelExecutive(
  funnelId?:   string | null,
  funnelMode?: FunnelMode,
  hybridOpts?: HybridOptions,
): UseFunnelExecutiveResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const hybridMode     = hybridOpts?.hybridMode     ?? false
  const comparisonMode = hybridOpts?.comparisonMode ?? 'wow'

  const [data, setData]       = useState<FunnelExecutiveData | null>(null)
  const [meta, setMeta]       = useState<FunnelExecutiveMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const [stageDeltasMap, setStageDeltasMap] =
    useState<Map<string, FunnelExecutiveV2StageHistorical>>(new Map())
  const [snapshotMeta, setSnapshotMeta] =
    useState<FunnelExecutiveV2SnapshotMeta | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  // Mesma regra do v1: multi-funnel sem funnelId não faz request
  const funnelRequired = funnelMode === 'multi-funnel' && !funnelId

  const load = useCallback(async () => {
    if (!companyId) return
    if (funnelMode === 'multi-funnel' && !funnelId) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      if (hybridMode) {
        const res = await dashboardApi.getFunnelExecutiveV2(
          companyId,
          funnelId,
          comparisonMode,
          abortRef.current.signal,
        )

        setData(res.data)
        setMeta(res.meta)
        setSnapshotMeta(res.snapshot_meta)

        // Constrói Map keyed por stage_id para lookup O(1) no componente
        if (res.historical?.stages && res.historical.stages.length > 0) {
          setStageDeltasMap(
            new Map(res.historical.stages.map(s => [s.stage_id, s])),
          )
        } else {
          setStageDeltasMap(new Map())
        }
      } else {
        const res = await dashboardApi.getFunnelExecutive(
          companyId,
          funnelId,
          abortRef.current.signal,
        )
        setData(res.data)
        setMeta(res.meta)
        setStageDeltasMap(new Map())
        setSnapshotMeta(null)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Erro ao carregar funil executivo')
    } finally {
      setLoading(false)
    }
  }, [
    companyId,
    funnelId,
    funnelMode,
    hybridMode,
    comparisonMode,
  ])

  useEffect(() => {
    if (funnelRequired) {
      setData(null)
      setMeta(null)
      setError(null)
      setStageDeltasMap(new Map())
      setSnapshotMeta(null)
      return
    }

    void load()
    return () => abortRef.current?.abort()
  }, [load, funnelRequired])

  return {
    data,
    meta,
    loading,
    error,
    funnelRequired,
    refetch: load,
    stageDeltasMap,
    snapshotMeta,
  }
}
