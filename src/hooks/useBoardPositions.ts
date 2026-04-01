// =====================================================
// HOOK: useBoardPositions
// Fase 3 — Carregamento por coluna com paginação e otimismo
//
// Responsabilidade (limites explícitos):
//   FAZ  → gerenciar o mapa de posições por etapa
//   FAZ  → paginação por coluna (loadMore)
//   FAZ  → re-fetch quando filter ou stages mudam
//   FAZ  → update otimista de DnD (optimisticMove + rollback)
//   FAZ  → refresh seletivo após mutação (por stageId ou full board)
//
//   NÃO FAZ → lógica de UI (ordenação de colunas, visibilidade)
//   NÃO FAZ → disparar automações (responsabilidade do useMoveOpportunity)
//   NÃO FAZ → gerenciar contadores (responsabilidade do useStageCounts)
//   NÃO FAZ → addLeadToFunnel (chama refresh externo após operação)
//
// LIMITAÇÃO CONHECIDA — OFFSET:
//   Usamos LIMIT/OFFSET clássico. Em cenários de alta concorrência
//   (cards adicionados/removidos entre páginas), o offset pode
//   gerar drift (duplicatas ou gaps). Para Phase 3A isso é aceitável.
//   Mitigação: ao fazer refresh(stageId), volta ao offset 0.
//   Cursor-based pagination fica para Phase 4.
//
// =====================================================

import { useState, useCallback, useEffect, useRef } from 'react'
import { funnelApi } from '../services/funnelApi'
import type {
  FunnelStage,
  LeadPositionFilter,
  OpportunityFunnelPosition,
  StagePositionState,
  BoardPositionsSnapshot
} from '../types/sales-funnel'

export interface UseBoardPositionsReturn {
  stageMap: Map<string, StagePositionState>
  loadMore: (stageId: string) => void
  refresh: (stageId?: string) => void
  optimisticMove: (
    opportunityId: string,
    fromStageId: string,
    toStageId: string,
    newIndex: number
  ) => BoardPositionsSnapshot
  rollback: (snapshot: BoardPositionsSnapshot) => void
}

const EMPTY_STATE: StagePositionState = {
  positions: [],
  loading: false,
  hasMore: false,
  page: 0
}

export function useBoardPositions(
  funnelId: string,
  stages: FunnelStage[],
  companyId: string | undefined,
  filter: LeadPositionFilter,
  pageSize = 20
): UseBoardPositionsReturn {
  const [stageMap, setStageMap] = useState<Map<string, StagePositionState>>(new Map())

  // Ref mantido sincronizado para leituras em callbacks sem stale closure
  const stageMapRef = useRef(stageMap)
  stageMapRef.current = stageMap

  // --------------------------------------------------
  // FETCH: carrega uma página de uma etapa
  // --------------------------------------------------
  const fetchStage = useCallback(
    async (stageId: string, page: number, append: boolean) => {
      if (!companyId || !funnelId) return

      setStageMap(prev => {
        const next = new Map(prev)
        const cur = next.get(stageId) ?? { ...EMPTY_STATE }
        next.set(stageId, { ...cur, loading: true })
        return next
      })

      try {
        const offset = page * pageSize
        const positions = await funnelApi.getStagePositionsPaged(
          funnelId,
          stageId,
          companyId,
          {
            search:      filter.search,
            origin:      filter.origin,
            period_days: filter.period_days
          },
          pageSize,
          offset
        )

        setStageMap(prev => {
          const next = new Map(prev)
          const cur = next.get(stageId) ?? { ...EMPTY_STATE }
          next.set(stageId, {
            positions: append ? [...cur.positions, ...positions] : positions,
            loading:   false,
            hasMore:   positions.length === pageSize,
            page
          })
          return next
        })
      } catch (err) {
        console.error(`Error fetching stage ${stageId}:`, err)
        setStageMap(prev => {
          const next = new Map(prev)
          const cur = next.get(stageId) ?? { ...EMPTY_STATE }
          next.set(stageId, { ...cur, loading: false })
          return next
        })
      }
    },
    // fetchStage muda quando funnelId, companyId, filter ou pageSize mudam.
    // Intencionalmente não inclui `stages` — cada stage é passado como arg.
    [funnelId, companyId, filter, pageSize]
  )

  // --------------------------------------------------
  // EFEITO: re-fetch all ao montar e quando filter/stages mudam
  // --------------------------------------------------
  useEffect(() => {
    if (!companyId || !funnelId || stages.length === 0) return

    // Carregar todas as etapas visíveis em paralelo, sempre da página 0
    const visibleStages = stages.filter(s => !s.is_hidden)
    Promise.all(visibleStages.map(s => fetchStage(s.id, 0, false)))
  }, [stages, fetchStage, companyId, funnelId])
  // fetchStage já captura filter/companyId/funnelId, mas listamos
  // companyId e funnelId explicitamente para satisfazer exhaustive-deps.

  // --------------------------------------------------
  // LOAD MORE: próxima página de uma etapa
  // --------------------------------------------------
  const loadMore = useCallback(
    (stageId: string) => {
      const cur = stageMapRef.current.get(stageId)
      if (!cur || cur.loading || !cur.hasMore) return
      fetchStage(stageId, cur.page + 1, true)
    },
    [fetchStage]
  )

  // --------------------------------------------------
  // REFRESH: recarrega do zero (full board ou etapa única)
  // --------------------------------------------------
  const refresh = useCallback(
    (stageId?: string) => {
      if (stageId) {
        fetchStage(stageId, 0, false)
      } else {
        const visibleStages = stages.filter(s => !s.is_hidden)
        Promise.all(visibleStages.map(s => fetchStage(s.id, 0, false)))
      }
    },
    [stages, fetchStage]
  )

  // --------------------------------------------------
  // OPTIMISTIC MOVE: move um card visualmente antes da API
  // Retorna snapshot para rollback em caso de erro da API.
  // --------------------------------------------------
  const optimisticMove = useCallback(
    (
      opportunityId: string,
      fromStageId: string,
      toStageId: string,
      newIndex: number
    ): BoardPositionsSnapshot => {
      const cur = stageMapRef.current
      const fromState = cur.get(fromStageId)
      const toState   = cur.get(toStageId)

      const fromPositions = fromState?.positions ?? []
      const toPositions   = toState?.positions   ?? []

      // Snapshot imutável para rollback
      const snapshot: BoardPositionsSnapshot = {
        fromStageId,
        toStageId,
        fromPositions: [...fromPositions],
        toPositions:   [...toPositions]
      }

      const card = fromPositions.find(p => p.opportunity_id === opportunityId)
      if (!card) return snapshot

      const movedCard: OpportunityFunnelPosition = { ...card, stage_id: toStageId }
      const newFromPositions = fromPositions.filter(p => p.opportunity_id !== opportunityId)

      if (fromStageId === toStageId) {
        // Reordenação dentro da mesma coluna
        const reordered = fromPositions.filter(p => p.opportunity_id !== opportunityId)
        reordered.splice(newIndex, 0, movedCard)
        setStageMap(prev => {
          const next = new Map(prev)
          next.set(fromStageId, { ...(fromState ?? EMPTY_STATE), positions: reordered })
          return next
        })
      } else {
        // Movimentação entre colunas diferentes
        const newToPositions = [...toPositions]
        newToPositions.splice(newIndex, 0, movedCard)
        setStageMap(prev => {
          const next = new Map(prev)
          next.set(fromStageId, { ...(fromState ?? EMPTY_STATE), positions: newFromPositions })
          next.set(toStageId,   { ...(toState   ?? EMPTY_STATE), positions: newToPositions })
          return next
        })
      }

      return snapshot
    },
    []
  )

  // --------------------------------------------------
  // ROLLBACK: restaura snapshot após erro da API
  // --------------------------------------------------
  const rollback = useCallback((snapshot: BoardPositionsSnapshot) => {
    setStageMap(prev => {
      const next       = new Map(prev)
      const fromState  = next.get(snapshot.fromStageId)
      const toState    = next.get(snapshot.toStageId)

      if (fromState) {
        next.set(snapshot.fromStageId, { ...fromState, positions: snapshot.fromPositions })
      }
      if (toState && snapshot.fromStageId !== snapshot.toStageId) {
        next.set(snapshot.toStageId, { ...toState, positions: snapshot.toPositions })
      }

      return next
    })
  }, [])

  return { stageMap, loadMore, refresh, optimisticMove, rollback }
}
