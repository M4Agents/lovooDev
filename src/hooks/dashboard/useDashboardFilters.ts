// =====================================================
// useDashboardFilters
// Estado global de filtros do Dashboard de Inteligência Comercial.
// Fonte única de verdade para period e funnelId em todos os hooks.
//
// Persistência: localStorage com chave isolada por empresa
//   (lovoo_dashboard_filters_<companyId>)
//   Garante que trocar de empresa recarrega os filtros da empresa correta.
// Compatível com PeriodFilter.tsx — usa o mesmo tipo PeriodFilter.
// =====================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { PREDEFINED_PERIODS } from '../../types/analytics'
import type { PeriodFilter } from '../../types/analytics'

const STORAGE_KEY_PREFIX = 'lovoo_dashboard_filters'
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

function loadFromStorage(key: string): { period: PeriodFilter; funnelId: string | null } {
  try {
    const raw = localStorage.getItem(key)
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

function saveToStorage(key: string, period: PeriodFilter, funnelId: string | null): void {
  try {
    const payload: PersistedFilters = {
      periodType: period.type,
      funnelId,
    }
    if (period.type === 'custom') {
      if (period.startDate) payload.startDateISO = period.startDate.toISOString()
      if (period.endDate)   payload.endDateISO   = period.endDate.toISOString()
    }
    localStorage.setItem(key, JSON.stringify(payload))
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
  const { company } = useAuth()
  const companyId = company?.id ?? null

  // Chave isolada por empresa — evita conflito de funnelId entre empresas
  const storageKey = companyId
    ? `${STORAGE_KEY_PREFIX}_${companyId}`
    : STORAGE_KEY_PREFIX

  const [period, setPeriodState] = useState<PeriodFilter>(() => loadFromStorage(storageKey).period)
  const [funnelId, setFunnelIdState] = useState<string | null>(() => loadFromStorage(storageKey).funnelId)

  // Rastreia a chave anterior para detectar troca de empresa
  const prevKeyRef = useRef(storageKey)

  // Quando a empresa muda: carrega os filtros da nova empresa.
  // Quando apenas period/funnelId mudam: persiste no storage.
  useEffect(() => {
    const keyChanged = prevKeyRef.current !== storageKey
    prevKeyRef.current = storageKey

    if (keyChanged) {
      const saved = loadFromStorage(storageKey)
      setPeriodState(saved.period)
      setFunnelIdState(saved.funnelId)
    } else {
      saveToStorage(storageKey, period, funnelId)
    }
  }, [storageKey, period, funnelId])

  const setPeriod = useCallback((next: PeriodFilter) => {
    setPeriodState(() => {
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
