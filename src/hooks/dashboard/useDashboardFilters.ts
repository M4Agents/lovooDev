// =====================================================
// useDashboardFilters
// Estado global de filtros do Dashboard de Inteligência Comercial.
// Fonte única de verdade para period e funnelId em todos os hooks.
//
// Persistência: localStorage (chave lovoo_dashboard_filters)
// Compatível com PeriodFilter.tsx — usa o mesmo tipo PeriodFilter.
// =====================================================

import { useCallback, useEffect, useState } from 'react'
import { PREDEFINED_PERIODS } from '../../types/analytics'
import type { PeriodFilter } from '../../types/analytics'

const STORAGE_KEY = 'lovoo_dashboard_filters'
const DEFAULT_PERIOD_TYPE = '7days' as const

// ---------------------------------------------------------------------------
// Tipo do estado persistido (serializado sem Date objects)
// ---------------------------------------------------------------------------

interface PersistedFilters {
  periodType: string
  startDateISO?: string
  endDateISO?: string
  funnelId: string | null
}

// ---------------------------------------------------------------------------
// Helpers de serialização / deserialização
// ---------------------------------------------------------------------------

function buildPeriodFilter(type: string, startISO?: string, endISO?: string): PeriodFilter {
  const preset = PREDEFINED_PERIODS[type as keyof typeof PREDEFINED_PERIODS]
  const base: PeriodFilter = preset
    ? { ...preset }
    : { type: DEFAULT_PERIOD_TYPE, label: 'Últimos 7 dias' }

  if (type === 'custom' && startISO && endISO) {
    base.startDate = new Date(startISO)
    base.endDate   = new Date(endISO)
  }

  return base
}

function loadFromStorage(): { period: PeriodFilter; funnelId: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) throw new Error('empty')
    const parsed: PersistedFilters = JSON.parse(raw)
    return {
      period:   buildPeriodFilter(parsed.periodType, parsed.startDateISO, parsed.endDateISO),
      funnelId: parsed.funnelId ?? null,
    }
  } catch {
    return {
      period:   buildPeriodFilter(DEFAULT_PERIOD_TYPE),
      funnelId: null,
    }
  }
}

function saveToStorage(period: PeriodFilter, funnelId: string | null): void {
  try {
    const payload: PersistedFilters = {
      periodType: period.type,
      funnelId,
    }
    if (period.type === 'custom') {
      if (period.startDate) payload.startDateISO = period.startDate.toISOString()
      if (period.endDate)   payload.endDateISO   = period.endDate.toISOString()
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // localStorage pode estar indisponível (modo privado, storage cheio)
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface DashboardFiltersState {
  period: PeriodFilter
  funnelId: string | null
  setPeriod: (period: PeriodFilter) => void
  setFunnelId: (id: string | null) => void
  clearFunnel: () => void
  /** Indica se o período customizado está completo (start + end) */
  isCustomPeriodReady: boolean
}

export function useDashboardFilters(): DashboardFiltersState {
  const [period, setPeriodState] = useState<PeriodFilter>(() => loadFromStorage().period)
  const [funnelId, setFunnelIdState] = useState<string | null>(() => loadFromStorage().funnelId)

  // Persiste sempre que algum filtro muda
  useEffect(() => {
    saveToStorage(period, funnelId)
  }, [period, funnelId])

  const setPeriod = useCallback((next: PeriodFilter) => {
    setPeriodState(() => {
      // Limpa datas customizadas quando muda para período predefinido
      if (next.type !== 'custom') {
        return { ...next, startDate: undefined, endDate: undefined }
      }
      return next
    })
  }, [])

  const setFunnelId = useCallback((id: string | null) => {
    setFunnelIdState(id)
  }, [])

  const clearFunnel = useCallback(() => {
    setFunnelIdState(null)
  }, [])

  const isCustomPeriodReady =
    period.type === 'custom' &&
    period.startDate instanceof Date &&
    period.endDate instanceof Date &&
    !isNaN(period.startDate.getTime()) &&
    !isNaN(period.endDate.getTime())

  return {
    period,
    funnelId,
    setPeriod,
    setFunnelId,
    clearFunnel,
    isCustomPeriodReady,
  }
}
