// =====================================================
// useEntityList
// Hook genérico para buscar listas de entidades do dashboard.
// Recebe entityType + filtros, chama o endpoint correto,
// controla paginação, loading e erro.
// NÃO depende de estado global — recebe filtros via props.
// =====================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type {
  EntityType,
  EntityItem,
  EntityListFilters,
  EntityListState,
  ListMeta,
} from '../../types/dashboard'

// Re-exports para compatibilidade com consumidores que importam daqui
export type { EntityType, EntityItem, EntityListFilters, EntityListState } from '../../types/dashboard'

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useEntityList(
  entityType: EntityType | null,
  filters: EntityListFilters,
  enabled = true,
): EntityListState {
  const { company } = useAuth()
  const companyId   = company?.id ?? null

  const [data,    setData]    = useState<EntityItem[]>([])
  const [meta,    setMeta]    = useState<ListMeta | null>(null)
  // Inicializa como true quando enabled=true para mostrar skeleton imediatamente
  // ao montar o componente, sem esperar o useEffect do primeiro ciclo de render.
  const [loading, setLoading] = useState(() => enabled && !!entityType)
  const [error,   setError]   = useState<string | null>(null)
  const [page,    setPage]    = useState(1)

  const abortRef = useRef<AbortController | null>(null)

  const fetch = useCallback(async (targetPage: number) => {
    if (!enabled || !entityType || !companyId) return

    // Período customizado incompleto → não buscar
    if (
      filters.period?.type === 'custom' &&
      (!filters.period.startDate || !filters.period.endDate)
    ) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      const filtersWithPage = { ...filters, page: targetPage }
      const signal = abortRef.current.signal

      let result: { ok: boolean; data: EntityItem[]; meta: ListMeta }

      if (entityType === 'opportunities') {
        result = await dashboardApi.getOpportunities(companyId, filtersWithPage, signal) as typeof result
      } else if (entityType === 'leads') {
        result = await dashboardApi.getLeads(companyId, filtersWithPage, signal) as typeof result
      } else {
        result = await dashboardApi.getConversations(companyId, filtersWithPage, signal) as typeof result
      }

      setData(result.data)
      setMeta(result.meta)
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'AbortError') return
      const msg = err instanceof Error ? err.message : 'Erro ao carregar lista'
      setError(msg)
      setData([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }, [
    enabled, entityType, companyId,
    filters.period?.type,
    (filters.period as { startDate?: Date | null })?.startDate?.toISOString(),
    (filters.period as { endDate?: Date | null })?.endDate?.toISOString(),
    filters.funnelId,
    filters.stage_id,
    filters.status,
    filters.probability_min,
    filters.ai_state,
    filters.limit,
    filters.source,
  ])

  // Re-fetch quando filtros ou page mudam
  useEffect(() => {
    fetch(page)
    return () => { abortRef.current?.abort() }
  }, [fetch, page])

  // Reset de página quando filtros (não page) mudam
  useEffect(() => {
    setPage(1)
  }, [
    entityType,
    companyId,
    filters.period?.type,
    (filters.period as { startDate?: Date | null })?.startDate?.toISOString(),
    (filters.period as { endDate?: Date | null })?.endDate?.toISOString(),
    filters.funnelId,
    filters.stage_id,
    filters.status,
    filters.probability_min,
    filters.ai_state,
    filters.limit,
    filters.source,
  ])

  const nextPage = useCallback(() => {
    if (meta?.has_more) setPage(p => p + 1)
  }, [meta?.has_more])

  const prevPage = useCallback(() => {
    setPage(p => Math.max(1, p - 1))
  }, [])

  const refetch = useCallback(() => fetch(page), [fetch, page])

  return {
    data,
    meta,
    loading,
    error,
    page,
    hasMore: meta?.has_more ?? false,
    nextPage,
    prevPage,
    refetch,
  }
}
