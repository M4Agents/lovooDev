// =====================================================
// Carga explícita por etapa da visão em lista.
// Não usa useBoardPositions / loadMore. Token de geração
// descarta respostas atrasadas ao trocar filtros/funil/empresa.
// Paginação avança só após sucesso; retry reenvia a mesma página.
// =====================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { funnelApi } from '../../services/funnelApi'
import type {
  FunnelStage,
  LeadPositionFilter,
  OpportunityFunnelPosition,
} from '../../types/sales-funnel'

export const LIST_PAGE_SIZE = 20

export interface ListStageState {
  positions: OpportunityFunnelPosition[]
  /** Última página 0-based carregada com sucesso. -1 = nenhuma. */
  page: number
  hasMore: boolean
  loading: boolean
}

const EMPTY_STAGE: ListStageState = {
  positions: [],
  page: -1,
  hasMore: false,
  loading: false,
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

function applyPageResult(
  cur: ListStageState,
  requestedPage: number,
  incoming: OpportunityFunnelPosition[],
  append: boolean,
): ListStageState {
  if (!Array.isArray(incoming)) {
    return { ...cur, loading: false }
  }

  if (incoming.length === 0) {
    return {
      positions: append ? cur.positions : [],
      page: append ? cur.page : 0,
      hasMore: false,
      loading: false,
    }
  }

  return {
    positions: append ? mergeUnique(cur.positions, incoming) : incoming,
    page: requestedPage,
    hasMore: incoming.length === LIST_PAGE_SIZE,
    loading: false,
  }
}

export interface UseFunnelListPositionsReturn {
  stageMap: Map<string, ListStageState>
  initialLoading: boolean
  loadMoreInFlight: boolean
  loadMore: () => Promise<void>
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
  const [loadMoreInFlight, setLoadMoreInFlight] = useState(false)

  const stageMapRef = useRef(stageMap)
  stageMapRef.current = stageMap

  const generationRef = useRef(0)
  const queueTokenRef = useRef(0)
  const loadMoreInFlightRef = useRef(false)
  const stagesRef = useRef(stages)
  stagesRef.current = stages
  const filterRef = useRef(filter)
  filterRef.current = filter

  const visibleStageIds = useCallback(
    () => stagesRef.current.filter(s => !s.is_hidden).map(s => s.id),
    [],
  )

  const fetchPage = useCallback(
    async (stageId: string, page: number): Promise<OpportunityFunnelPosition[]> => {
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
        LIST_PAGE_SIZE,
        page * LIST_PAGE_SIZE,
      )
    },
    [companyId, funnelId],
  )

  const cancelQueue = useCallback(() => {
    queueTokenRef.current += 1
    loadMoreInFlightRef.current = false
    setLoadMoreInFlight(false)
  }, [])

  const loadInitial = useCallback(async () => {
    if (!companyId || !funnelId) return

    const generation = ++generationRef.current
    cancelQueue()

    const ids = visibleStageIds()
    setInitialLoading(true)
    setStageMap(prev => {
      const next = new Map(prev)
      for (const id of ids) {
        const cur = next.get(id) ?? { ...EMPTY_STAGE }
        next.set(id, { ...cur, loading: true })
      }
      return next
    })

    await Promise.all(ids.map(async (stageId) => {
      try {
        const incoming = await fetchPage(stageId, 0)
        if (generationRef.current !== generation) return
        if (!Array.isArray(incoming)) {
          throw new Error('Resposta inesperada ao carregar etapa')
        }
        setStageMap(prev => {
          const next = new Map(prev)
          const cur = next.get(stageId) ?? { ...EMPTY_STAGE }
          next.set(stageId, applyPageResult(cur, 0, incoming, false))
          return next
        })
      } catch (err) {
        console.error(`[FunnelList] erro ao carregar etapa ${stageId}:`, err)
        if (generationRef.current !== generation) return
        setStageMap(prev => {
          const next = new Map(prev)
          const cur = next.get(stageId) ?? { ...EMPTY_STAGE }
          next.set(stageId, { ...cur, loading: false })
          return next
        })
      }
    }))

    if (generationRef.current === generation) {
      setInitialLoading(false)
    }
  }, [companyId, funnelId, fetchPage, cancelQueue, visibleStageIds])

  useEffect(() => {
    if (!companyId || !funnelId || stages.length === 0) {
      setStageMap(new Map())
      setInitialLoading(false)
      return
    }
    void loadInitial()
    return () => {
      generationRef.current += 1
      queueTokenRef.current += 1
    }
  }, [companyId, funnelId, stages, filter, loadInitial])

  const refreshStages = useCallback((stageIds?: string[]) => {
    if (!companyId || !funnelId) return

    const generation = generationRef.current
    cancelQueue()

    const ids = stageIds?.length
      ? stageIds.filter(id => visibleStageIds().includes(id))
      : visibleStageIds()

    if (ids.length === 0) return

    setStageMap(prev => {
      const next = new Map(prev)
      for (const id of ids) {
        const cur = next.get(id) ?? { ...EMPTY_STAGE }
        next.set(id, { ...cur, loading: true })
      }
      return next
    })

    void Promise.all(ids.map(async (stageId) => {
      try {
        const incoming = await fetchPage(stageId, 0)
        if (generationRef.current !== generation) return
        if (!Array.isArray(incoming)) {
          throw new Error('Resposta inesperada ao atualizar etapa')
        }
        setStageMap(prev => {
          const next = new Map(prev)
          const cur = next.get(stageId) ?? { ...EMPTY_STAGE }
          next.set(stageId, applyPageResult(cur, 0, incoming, false))
          return next
        })
      } catch (err) {
        console.error(`[FunnelList] erro ao atualizar etapa ${stageId}:`, err)
        if (generationRef.current !== generation) return
        setStageMap(prev => {
          const next = new Map(prev)
          const cur = next.get(stageId) ?? { ...EMPTY_STAGE }
          next.set(stageId, { ...cur, loading: false })
          return next
        })
      }
    }))
  }, [companyId, funnelId, fetchPage, cancelQueue, visibleStageIds])

  const loadMore = useCallback(async () => {
    if (loadMoreInFlightRef.current) return

    const queueToken = queueTokenRef.current
    const generation = generationRef.current
    const pending = visibleStageIds().filter((id) => {
      const cur = stageMapRef.current.get(id)
      return !!cur && cur.hasMore && !cur.loading
    })

    if (pending.length === 0) return

    loadMoreInFlightRef.current = true
    setLoadMoreInFlight(true)

    try {
      for (const stageId of pending) {
        if (queueTokenRef.current !== queueToken) return
        if (generationRef.current !== generation) return

        const cur = stageMapRef.current.get(stageId)
        if (!cur || !cur.hasMore || cur.loading) continue

        const requestedPage = cur.page + 1
        if (requestedPage < 0) continue

        setStageMap(prev => {
          const next = new Map(prev)
          const latest = next.get(stageId) ?? cur
          next.set(stageId, { ...latest, loading: true })
          return next
        })

        try {
          const incoming = await fetchPage(stageId, requestedPage)
          if (queueTokenRef.current !== queueToken) return
          if (generationRef.current !== generation) return

          if (!Array.isArray(incoming)) {
            throw new Error('Resposta inesperada ao carregar mais')
          }

          setStageMap(prev => {
            const next = new Map(prev)
            const latest = next.get(stageId) ?? { ...EMPTY_STAGE }
            next.set(stageId, applyPageResult(latest, requestedPage, incoming, true))
            return next
          })
        } catch (err) {
          console.error(`[FunnelList] erro ao carregar mais da etapa ${stageId}:`, err)
          if (queueTokenRef.current !== queueToken) return
          if (generationRef.current !== generation) return
          setStageMap(prev => {
            const next = new Map(prev)
            const latest = next.get(stageId) ?? { ...EMPTY_STAGE }
            next.set(stageId, { ...latest, loading: false })
            return next
          })
          throw err
        }
      }
    } finally {
      if (queueTokenRef.current === queueToken) {
        loadMoreInFlightRef.current = false
        setLoadMoreInFlight(false)
      }
    }
  }, [fetchPage, visibleStageIds])

  return {
    stageMap,
    initialLoading,
    loadMoreInFlight,
    loadMore,
    refreshStages,
  }
}
