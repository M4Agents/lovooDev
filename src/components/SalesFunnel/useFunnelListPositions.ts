// =====================================================
// Carga explícita por etapa da visão em lista.
// Paginação por nextOffset (intervalo efetivamente retornado).
// loadMore e refresh da mesma etapa não correm em paralelo:
// realtime durante loadMore fica pendente e roda depois.
// =====================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { funnelApi } from '../../services/funnelApi'
import type {
  FunnelStage,
  LeadPositionFilter,
  OpportunityFunnelPosition,
} from '../../types/sales-funnel'

export const LIST_PAGE_SIZE = 20

export type ListStageError = 'initial' | 'loadMore' | null

export interface ListStageState {
  positions: OpportunityFunnelPosition[]
  /** Próximo offset da API, recalculado pelo que realmente veio. */
  nextOffset: number
  hasMore: boolean
  loading: boolean
  error: ListStageError
}

const EMPTY_STAGE: ListStageState = {
  positions: [],
  nextOffset: 0,
  hasMore: false,
  loading: false,
  error: null,
}

function mergeUnique(
  existing: OpportunityFunnelPosition[],
  incoming: OpportunityFunnelPosition[],
): OpportunityFunnelPosition[] {
  const ids = new Set(existing.map(p => p.id))
  const oppIds = new Set(existing.map(p => p.opportunity_id))
  const next = [...existing]
  for (const pos of incoming) {
    if (!pos?.id || ids.has(pos.id) || oppIds.has(pos.opportunity_id)) continue
    ids.add(pos.id)
    oppIds.add(pos.opportunity_id)
    next.push(pos)
  }
  return next
}

/**
 * RPC get_stage_positions_paged usa LIMIT p_limit sem teto (20260909235000).
 * getStagePositionsPaged só repassa limit/offset — sem truncar no cliente.
 */
function refreshLimit(state: ListStageState): number {
  return Math.max(state.positions.length, state.nextOffset, LIST_PAGE_SIZE)
}

function applyReturnedWindow(
  incoming: OpportunityFunnelPosition[],
  requestedLimit: number,
): Pick<ListStageState, 'positions' | 'nextOffset' | 'hasMore'> {
  return {
    positions: incoming,
    nextOffset: incoming.length,
    hasMore: incoming.length > 0 && incoming.length === requestedLimit,
  }
}

export interface UseFunnelListPositionsReturn {
  stageMap: Map<string, ListStageState>
  initialLoading: boolean
  loadMoreStage: (stageId: string) => Promise<void>
  retryStage: (stageId: string) => Promise<void>
  refreshStages: (stageIds?: string[]) => void
}

export function useFunnelListPositions(
  funnelId: string,
  stages: FunnelStage[],
  companyId: string | undefined,
  filter: LeadPositionFilter,
): UseFunnelListPositionsReturn {
  const [stageMap, setStageMap] = useState<Map<string, ListStageState>>(new Map())
  const [initialLoading, setInitialLoading] = useState(true)

  const stageMapRef = useRef(stageMap)
  stageMapRef.current = stageMap

  const generationRef = useRef(0)
  const inFlightRef = useRef<Set<string>>(new Set())
  const pendingRefreshRef = useRef<Set<string>>(new Set())
  const stagesRef = useRef(stages)
  stagesRef.current = stages
  const filterRef = useRef(filter)
  filterRef.current = filter

  const visibleStageIds = useCallback(
    () => stagesRef.current.filter(s => !s.is_hidden).map(s => s.id),
    [],
  )

  const fetchSlice = useCallback(
    async (stageId: string, limit: number, offset: number): Promise<OpportunityFunnelPosition[]> => {
      if (!companyId || !funnelId) return []
      const f = filterRef.current
      return funnelApi.getStagePositionsPaged(
        funnelId,
        stageId,
        companyId,
        {
          search: f.search,
          origin: f.origin,
          period_start: f.period_start,
          period_end: f.period_end,
          date_field: f.date_field,
          tags: f.tags,
          tags_mode: f.tags_mode,
          sort_by: f.sort_by,
          owner_user_id: f.owner_user_id,
          contact_attempts_state: f.contact_attempts_state,
        },
        limit,
        offset,
      )
    },
    [companyId, funnelId],
  )

  const patchStage = useCallback((stageId: string, updater: (cur: ListStageState) => ListStageState) => {
    setStageMap(prev => {
      const next = new Map(prev)
      next.set(stageId, updater(next.get(stageId) ?? { ...EMPTY_STAGE }))
      return next
    })
  }, [])

  const beginStage = useCallback((stageId: string): boolean => {
    if (inFlightRef.current.has(stageId)) return false
    inFlightRef.current.add(stageId)
    return true
  }, [])

  const resetFlight = useCallback(() => {
    inFlightRef.current.clear()
    pendingRefreshRef.current.clear()
  }, [])

  const runRefreshStage = useCallback(async (stageId: string, generation: number) => {
    const limit = refreshLimit(stageMapRef.current.get(stageId) ?? { ...EMPTY_STAGE })
    patchStage(stageId, prev => ({ ...prev, loading: true, error: null }))

    try {
      const incoming = await fetchSlice(stageId, limit, 0)
      if (generationRef.current !== generation) return
      if (!Array.isArray(incoming)) throw new Error('Resposta inesperada ao atualizar etapa')

      patchStage(stageId, () => ({
        ...applyReturnedWindow(incoming, limit),
        loading: false,
        error: null,
      }))
    } catch (err) {
      console.error(`[FunnelList] erro ao atualizar etapa ${stageId}:`, err)
      if (generationRef.current !== generation) return
      patchStage(stageId, prev => ({
        ...prev,
        loading: false,
        error: prev.positions.length === 0 ? 'initial' : prev.error,
      }))
    }
  }, [fetchSlice, patchStage])

  const releaseStage = useCallback((stageId: string, generation: number) => {
    inFlightRef.current.delete(stageId)
    if (generationRef.current !== generation) return
    if (!pendingRefreshRef.current.has(stageId)) return
    pendingRefreshRef.current.delete(stageId)
    if (!beginStage(stageId)) {
      pendingRefreshRef.current.add(stageId)
      return
    }
    void runRefreshStage(stageId, generation).finally(() => {
      releaseStage(stageId, generation)
    })
  }, [beginStage, runRefreshStage])

  const loadInitial = useCallback(async () => {
    if (!companyId || !funnelId) return

    const generation = ++generationRef.current
    resetFlight()

    const ids = visibleStageIds()
    setInitialLoading(true)
    setStageMap(() => {
      const next = new Map<string, ListStageState>()
      for (const id of ids) {
        next.set(id, { ...EMPTY_STAGE, loading: true })
      }
      return next
    })

    await Promise.all(ids.map(async (stageId) => {
      if (!beginStage(stageId)) return
      try {
        const incoming = await fetchSlice(stageId, LIST_PAGE_SIZE, 0)
        if (generationRef.current !== generation) return
        if (!Array.isArray(incoming)) throw new Error('Resposta inesperada ao carregar etapa')
        patchStage(stageId, () => ({
          ...applyReturnedWindow(incoming, LIST_PAGE_SIZE),
          loading: false,
          error: null,
        }))
      } catch (err) {
        console.error(`[FunnelList] erro ao carregar etapa ${stageId}:`, err)
        if (generationRef.current !== generation) return
        patchStage(stageId, () => ({
          ...EMPTY_STAGE,
          loading: false,
          error: 'initial',
        }))
      } finally {
        releaseStage(stageId, generation)
      }
    }))

    if (generationRef.current === generation) {
      setInitialLoading(false)
    }
  }, [companyId, funnelId, fetchSlice, beginStage, resetFlight, releaseStage, visibleStageIds, patchStage])

  useEffect(() => {
    if (!companyId || !funnelId || stages.length === 0) {
      setStageMap(new Map())
      setInitialLoading(false)
      return
    }
    void loadInitial()
    return () => {
      generationRef.current += 1
      resetFlight()
    }
  }, [companyId, funnelId, stages, filter, loadInitial, resetFlight])

  const refreshStages = useCallback((stageIds?: string[]) => {
    if (!companyId || !funnelId) return
    const generation = generationRef.current
    const ids = stageIds?.length
      ? stageIds.filter(id => visibleStageIds().includes(id))
      : visibleStageIds()

    for (const stageId of ids) {
      if (inFlightRef.current.has(stageId) || !beginStage(stageId)) {
        pendingRefreshRef.current.add(stageId)
        continue
      }
      void runRefreshStage(stageId, generation).finally(() => {
        releaseStage(stageId, generation)
      })
    }
  }, [companyId, funnelId, visibleStageIds, beginStage, runRefreshStage, releaseStage])

  const loadMoreStage = useCallback(async (stageId: string) => {
    const generation = generationRef.current
    const cur = stageMapRef.current.get(stageId)
    if (!cur || !cur.hasMore || cur.loading) return
    if (!beginStage(stageId)) return

    const offset = cur.nextOffset
    patchStage(stageId, prev => ({ ...prev, loading: true, error: null }))

    try {
      const incoming = await fetchSlice(stageId, LIST_PAGE_SIZE, offset)
      if (generationRef.current !== generation) return
      if (!Array.isArray(incoming)) throw new Error('Resposta inesperada ao carregar mais')

      patchStage(stageId, prev => {
        if (incoming.length === 0) {
          return { ...prev, hasMore: false, loading: false, error: null }
        }
        return {
          positions: mergeUnique(prev.positions, incoming),
          nextOffset: prev.nextOffset + incoming.length,
          hasMore: incoming.length === LIST_PAGE_SIZE,
          loading: false,
          error: null,
        }
      })
    } catch (err) {
      console.error(`[FunnelList] erro ao carregar mais da etapa ${stageId}:`, err)
      if (generationRef.current !== generation) return
      patchStage(stageId, prev => ({ ...prev, loading: false, error: 'loadMore' }))
      throw err
    } finally {
      releaseStage(stageId, generation)
    }
  }, [beginStage, releaseStage, fetchSlice, patchStage])

  const retryStage = useCallback(async (stageId: string) => {
    const generation = generationRef.current
    if (!beginStage(stageId)) return
    patchStage(stageId, prev => ({ ...prev, loading: true, error: null }))

    try {
      const incoming = await fetchSlice(stageId, LIST_PAGE_SIZE, 0)
      if (generationRef.current !== generation) return
      if (!Array.isArray(incoming)) throw new Error('Resposta inesperada ao recarregar etapa')
      patchStage(stageId, () => ({
        ...applyReturnedWindow(incoming, LIST_PAGE_SIZE),
        loading: false,
        error: null,
      }))
    } catch (err) {
      console.error(`[FunnelList] erro ao recarregar etapa ${stageId}:`, err)
      if (generationRef.current !== generation) return
      patchStage(stageId, prev => ({ ...prev, loading: false, error: 'initial' }))
      throw err
    } finally {
      releaseStage(stageId, generation)
    }
  }, [beginStage, releaseStage, fetchSlice, patchStage])

  return {
    stageMap,
    initialLoading,
    loadMoreStage,
    retryStage,
    refreshStages,
  }
}
