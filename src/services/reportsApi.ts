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
    const { data, error } = await supabase.rpc('get_stage_time_metrics', toRpcParams(companyId, filters))
    // #region agent log
    if (error) {
      fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ab518'},body:JSON.stringify({sessionId:'6ab518',location:'reportsApi.ts:getStageTimeMetrics',message:'RPC get_stage_time_metrics FAILED',data:{code:error.code,message:error.message,hint:error.hint,details:error.details,companyId},hypothesisId:'H4-H5-H6',timestamp:Date.now()})}).catch(()=>{})
      throw error
    }
    // #endregion
    return (data as StageTimeMetric[]) ?? []
  },

  async getSellerPerformance(
    companyId: string,
    filters: ReportFilters
  ): Promise<SellerPerformance[]> {
    const { data, error } = await supabase.rpc('get_seller_performance', toRpcParams(companyId, filters))
    if (error) throw error
    return (data as SellerPerformance[]) ?? []
  },

  async getCycleTimeMetrics(
    companyId: string,
    filters: ReportFilters
  ): Promise<CycleTimeMetric[]> {
    const { data, error } = await supabase.rpc('get_cycle_time_metrics', toRpcParams(companyId, filters))
    if (error) throw error
    return (data as CycleTimeMetric[]) ?? []
  },
}
