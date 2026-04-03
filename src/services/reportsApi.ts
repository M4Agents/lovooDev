// =====================================================
// REPORTS API SERVICE
// Wrapper tipado das 4 RPCs analíticas do módulo de relatórios
// =====================================================

import { supabase } from '../lib/supabase'
import type {
  FunnelOverview,
  StageTimeMetric,
  SellerPerformance,
  CycleTimeMetric,
  ReportFilters,
} from '../types/reports'

function toRpcParams(companyId: string, filters: ReportFilters) {
  return {
    p_company_id: companyId,
    p_funnel_ids:
      filters.funnelIds && filters.funnelIds.length > 0 ? filters.funnelIds : null,
    p_date_from: filters.dateFrom.toISOString(),
    p_date_to: filters.dateTo.toISOString(),
  }
}

export const reportsApi = {
  async getFunnelOverview(
    companyId: string,
    filters: ReportFilters
  ): Promise<FunnelOverview | null> {
    const { data, error } = await supabase.rpc('get_funnel_overview', {
      ...toRpcParams(companyId, filters),
      p_stalled_days: filters.stalledDays,
    })
    if (error) throw error
    return (data as FunnelOverview[])?.[0] ?? null
  },

  async getStageTimeMetrics(
    companyId: string,
    filters: ReportFilters
  ): Promise<StageTimeMetric[]> {
    const { data, error } = await supabase.rpc('get_stage_time_metrics', {
      ...toRpcParams(companyId, filters),
    })
    if (error) throw error
    return (data as StageTimeMetric[]) ?? []
  },

  async getSellerPerformance(
    companyId: string,
    filters: ReportFilters
  ): Promise<SellerPerformance[]> {
    const { data, error } = await supabase.rpc('get_seller_performance', {
      ...toRpcParams(companyId, filters),
    })
    if (error) throw error
    return (data as SellerPerformance[]) ?? []
  },

  async getCycleTimeMetrics(
    companyId: string,
    filters: ReportFilters
  ): Promise<CycleTimeMetric[]> {
    const { data, error } = await supabase.rpc('get_cycle_time_metrics', {
      ...toRpcParams(companyId, filters),
    })
    if (error) throw error
    return (data as CycleTimeMetric[]) ?? []
  },
}
