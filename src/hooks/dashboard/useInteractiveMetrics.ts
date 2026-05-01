// =====================================================
// useInteractiveMetrics
// Controla qual drawer está aberto, qual entityType e quais filtros.
// Sem busca de dados — apenas gerenciamento de estado de UI.
// =====================================================

import { useCallback, useState } from 'react'
import type { EntityType } from '../../components/Dashboard/interactive/EntityListDrawer'
import type { EntityListFilters } from './useEntityList'

export interface DrawerState {
  open: boolean
  entityType: EntityType | null
  title: string
  description: string
  filters: EntityListFilters
}

const EMPTY_FILTERS: EntityListFilters = {
  period: { type: '7days', label: 'Últimos 7 dias' },
}

const CLOSED: DrawerState = {
  open: false,
  entityType: null,
  title: '',
  description: '',
  filters: EMPTY_FILTERS,
}

export interface UseInteractiveMetricsResult {
  drawer: DrawerState
  openDrawer: (
    entityType: EntityType,
    title: string,
    description: string,
    filters: EntityListFilters,
  ) => void
  closeDrawer: () => void
}

export function useInteractiveMetrics(): UseInteractiveMetricsResult {
  const [drawer, setDrawer] = useState<DrawerState>(CLOSED)

  const openDrawer = useCallback(
    (
      entityType: EntityType,
      title: string,
      description: string,
      filters: EntityListFilters,
    ) => {
      setDrawer({ open: true, entityType, title, description, filters })
    },
    [],
  )

  const closeDrawer = useCallback(() => {
    setDrawer(CLOSED)
  }, [])

  return { drawer, openDrawer, closeDrawer }
}
