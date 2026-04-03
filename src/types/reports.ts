// =====================================================
// TIPOS: Módulo de Relatórios Comerciais
// =====================================================

export interface ReportFilters {
  dateFrom: Date
  dateTo: Date
  funnelIds: string[] | null   // null = todos os funis
  stalledDays: number          // padrão: 15
}

// Retorno de get_funnel_overview — 1 linha
export interface FunnelOverview {
  open_count: number
  won_count: number
  lost_count: number
  conversion_rate: number | null
  won_value: number
  lost_value: number
  avg_cycle_won_seconds: number | null
  avg_cycle_lost_seconds: number | null
  stalled_count: number
}

// Retorno de get_stage_time_metrics — 1 linha por etapa
export interface StageTimeMetric {
  stage_id: string
  stage_name: string
  stage_color: string
  stage_position: number
  funnel_id: string
  funnel_name: string
  current_open_count: number
  historical_movement_count: number
  avg_duration_seconds: number | null
  median_duration_seconds: number | null
  max_duration_seconds: number | null
}

// Retorno de get_seller_performance — 1 linha por vendedor
export interface SellerPerformance {
  owner_user_id: string
  user_name: string
  open_count: number
  won_count: number
  lost_count: number
  won_value: number
  conversion_rate: number | null
  avg_cycle_seconds: number | null
}

// Retorno de get_cycle_time_metrics — 'total' | 'funnel' | 'seller'
export interface CycleTimeMetric {
  breakdown_type: 'total' | 'funnel' | 'seller'
  entity_id: string | null
  entity_name: string
  won_count: number
  lost_count: number
  won_avg_seconds: number | null
  won_median_seconds: number | null
  won_max_seconds: number | null
  won_min_seconds: number | null
  lost_avg_seconds: number | null
  lost_median_seconds: number | null
}

// Dados completos de métricas
export interface ReportMetrics {
  overview: FunnelOverview | null
  stageMetrics: StageTimeMetric[]
  sellerMetrics: SellerPerformance[]
  cycleMetrics: CycleTimeMetric[]
}
