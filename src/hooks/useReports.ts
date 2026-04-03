// =====================================================
// useReports — estado global de filtros do módulo de relatórios
// Sincroniza com URL (?tab=, ?period=, ?funnels=, ?stalled=)
// =====================================================

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PREDEFINED_PERIODS } from '../types/analytics'
import type { PeriodFilter, PeriodType } from '../types/analytics'
import type { ReportFilters } from '../types/reports'

export type ReportTab = 'overview' | 'by-stage' | 'by-seller' | 'cycle-time'

export interface SalesFunnelOption {
  id: string
  name: string
}

function buildDefaultPeriod(): PeriodFilter {
  const now = new Date()
  return {
    ...PREDEFINED_PERIODS['this_month'],
    startDate: new Date(now.getFullYear(), now.getMonth(), 1),
    endDate: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
  }
}

function periodFromType(type: PeriodType): PeriodFilter {
  const now = new Date()
  switch (type) {
    case 'today': {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const e = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
      return { ...PREDEFINED_PERIODS['today'], startDate: s, endDate: e }
    }
    case 'yesterday': {
      const d = new Date(now); d.setDate(d.getDate() - 1)
      const s = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      const e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)
      return { ...PREDEFINED_PERIODS['yesterday'], startDate: s, endDate: e }
    }
    case '7days': {
      const s = new Date(now); s.setDate(s.getDate() - 7)
      return { ...PREDEFINED_PERIODS['7days'], startDate: s, endDate: now }
    }
    case '15days': {
      const s = new Date(now); s.setDate(s.getDate() - 15)
      return { ...PREDEFINED_PERIODS['15days'], startDate: s, endDate: now }
    }
    case '30days': {
      const s = new Date(now); s.setDate(s.getDate() - 30)
      return { ...PREDEFINED_PERIODS['30days'], startDate: s, endDate: now }
    }
    case 'this_month': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1)
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
      return { ...PREDEFINED_PERIODS['this_month'], startDate: s, endDate: e }
    }
    case 'last_month': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
      return { ...PREDEFINED_PERIODS['last_month'], startDate: s, endDate: e }
    }
    case '90days': {
      const s = new Date(now); s.setDate(s.getDate() - 90)
      return { ...PREDEFINED_PERIODS['90days'], startDate: s, endDate: now }
    }
    case 'this_quarter': {
      const q = Math.floor(now.getMonth() / 3)
      const s = new Date(now.getFullYear(), q * 3, 1)
      const e = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59)
      return { ...PREDEFINED_PERIODS['this_quarter'], startDate: s, endDate: e }
    }
    case 'this_year': {
      const s = new Date(now.getFullYear(), 0, 1)
      const e = new Date(now.getFullYear(), 11, 31, 23, 59, 59)
      return { ...PREDEFINED_PERIODS['this_year'], startDate: s, endDate: e }
    }
    default:
      return buildDefaultPeriod()
  }
}

export function useReports() {
  const { company } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam = (searchParams.get('tab') as ReportTab) || 'overview'
  const periodParam = (searchParams.get('period') as PeriodType) || 'this_month'
  const funnelsParam = searchParams.get('funnels')
  const stalledParam = searchParams.get('stalled')

  const [activeTab, setActiveTab] = useState<ReportTab>(tabParam)
  const [period, setPeriod] = useState<PeriodFilter>(() => periodFromType(periodParam))
  const [selectedFunnelIds, setSelectedFunnelIds] = useState<string[]>(
    funnelsParam ? funnelsParam.split(',').filter(Boolean) : []
  )
  const [stalledDays, setStalledDays] = useState<number>(
    stalledParam ? parseInt(stalledParam, 10) : 15
  )
  const [funnelOptions, setFunnelOptions] = useState<SalesFunnelOption[]>([])
  const [loadingFunnels, setLoadingFunnels] = useState(false)

  // Sincroniza URL ao mudar filtros
  useEffect(() => {
    const params: Record<string, string> = { tab: activeTab }
    if (period.type !== 'this_month') params.period = period.type
    if (selectedFunnelIds.length > 0) params.funnels = selectedFunnelIds.join(',')
    if (stalledDays !== 15) params.stalled = String(stalledDays)
    setSearchParams(params, { replace: true })
  }, [activeTab, period, selectedFunnelIds, stalledDays, setSearchParams])

  // Carrega lista de funis da empresa
  useEffect(() => {
    if (!company?.id) return
    setLoadingFunnels(true)
    supabase
      .from('sales_funnels')
      .select('id, name')
      .eq('company_id', company.id)
      .order('name')
      .then(({ data }) => {
        setFunnelOptions((data ?? []) as SalesFunnelOption[])
        setLoadingFunnels(false)
      })
  }, [company?.id])

  const handlePeriodChange = useCallback((p: PeriodFilter) => {
    setPeriod(p)
  }, [])

  const handleFunnelToggle = useCallback((id: string) => {
    setSelectedFunnelIds((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    )
  }, [])

  const handleClearFunnels = useCallback(() => setSelectedFunnelIds([]), [])

  const filters: ReportFilters = {
    dateFrom: period.startDate ?? new Date(),
    dateTo: period.endDate ?? new Date(),
    funnelIds: selectedFunnelIds.length > 0 ? selectedFunnelIds : null,
    stalledDays,
  }

  return {
    companyId: company?.id ?? '',
    activeTab,
    setActiveTab,
    period,
    handlePeriodChange,
    selectedFunnelIds,
    handleFunnelToggle,
    handleClearFunnels,
    stalledDays,
    setStalledDays,
    funnelOptions,
    loadingFunnels,
    filters,
  }
}
