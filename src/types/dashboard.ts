// =====================================================
// src/types/dashboard.ts
// Fonte única de tipos do Dashboard de Inteligência Comercial.
//
// Importar tipos da dashboard a partir deste arquivo — nunca de:
//   - src/services/dashboardApi.ts   (re-exporta daqui)
//   - src/hooks/dashboard/useEntityList.ts (re-exporta daqui)
//   - componentes UI (EntityListDrawer, InteractiveMetricCard)
//
// AiAnalysis* propositalmente mantidos em dashboardApi.ts
// (domínio separado, não faz parte do cockpit comercial principal).
// =====================================================

// ---------------------------------------------------------------------------
// Re-exports de analytics.ts (fonte canônica não movida)
// Consumidores da dashboard importam PeriodFilter/PeriodType daqui.
// ---------------------------------------------------------------------------

export type { PeriodFilter, PeriodType } from './analytics'

// ---------------------------------------------------------------------------
// Modos de operação (copiados do backend api/lib/dashboard/metrics.ts)
// Frontend e backend mantêm cópias — sem compartilhamento entre camadas.
// ---------------------------------------------------------------------------

export type AgentMode  = 'single-agent' | 'multi-agent'
export type FunnelMode = 'single-funnel' | 'multi-funnel'

// ---------------------------------------------------------------------------
// Filtros globais da dashboard
// ---------------------------------------------------------------------------

import type { PeriodFilter } from './analytics'

export interface DashboardFilters {
  period:   PeriodFilter
  funnelId?: string | null
  userId?:   string | null
}

// ---------------------------------------------------------------------------
// EntityType canônico — 3 valores com suporte de endpoint real
// EntityTypeExtended — inclui 'alerts' para uso exclusivo do drawer de UI
// ---------------------------------------------------------------------------

export type EntityType         = 'opportunities' | 'leads' | 'conversations'
export type EntityTypeExtended = EntityType | 'alerts'

// ---------------------------------------------------------------------------
// Tipo de tendência semântica (dado, não visual)
// ---------------------------------------------------------------------------

export type TrendDirection = 'up' | 'down' | 'neutral'

// ---------------------------------------------------------------------------
// Meta e resposta genérica da API
// ---------------------------------------------------------------------------

export interface DashboardMeta {
  period:    string
  start_date: string
  end_date:   string
  funnel_id?: string | null
}

export interface ListMeta {
  page:       number
  limit:      number
  total:      number
  has_more:   boolean
  period:     string
  start_date: string
  end_date:   string
  funnel_id?: string | null
  ai_state?:  string | null
}

export interface ListResponse<T> {
  ok:   boolean
  data: T[]
  meta: ListMeta
}

// ---------------------------------------------------------------------------
// KPIs executivos
// ---------------------------------------------------------------------------

export interface ExecutiveData {
  leads_count:             number
  conversations_count:     number
  hot_opportunities_count: number
  alerts_count:            number
  agent_mode:  AgentMode
  funnel_mode: FunnelMode
}

export interface SummaryResponse {
  ok:   boolean
  data: ExecutiveData
  meta: Omit<DashboardMeta, 'funnel_id'>
}

// ---------------------------------------------------------------------------
// Funis
// ---------------------------------------------------------------------------

export interface FunnelItem {
  id:         string
  name:       string
  is_default: boolean
}

export interface FunnelsResponse {
  data: FunnelItem[]
  meta: Record<string, never>
}

// ---------------------------------------------------------------------------
// Snapshot do funil (estado atual — sem período)
// ---------------------------------------------------------------------------

export interface StageSnapshot {
  stage_id:          string
  stage_name:        string
  position:          number
  count:             number
  total_value:       number
  avg_days_in_stage: number
}

export interface FunnelSnapshotData {
  funnel_id: string
  stages:    StageSnapshot[]
}

export interface FunnelSnapshotMeta {
  funnel_id:   string | null
  funnel_mode: FunnelMode
}

export interface FunnelSnapshotResponse {
  ok:   boolean
  data: FunnelSnapshotData
  meta: FunnelSnapshotMeta
}

// ---------------------------------------------------------------------------
// Flow do funil (movimentação no período)
// ---------------------------------------------------------------------------

export interface StageFlow {
  stage_id:           string
  stage_name:         string
  position:           number
  unique_count:       number
  total_count:        number
  by_trigger_source:  { ai: number; human: number; automation: number; system: number }
  avg_days_prev_stage: number
}

export interface StageConversion {
  from_stage_id:       string
  from_stage_name:     string
  to_stage_id:         string
  to_stage_name:       string
  advanced:            number
  in_source:           number
  conversion_rate_pct: number
}

export interface FunnelFlowData {
  flow:        { funnel_id: string; stages: StageFlow[] }
  conversions: { funnel_id: string; conversions: StageConversion[] }
}

export interface FunnelFlowResponse {
  ok:   boolean
  data: FunnelFlowData
  meta: DashboardMeta
}

// ---------------------------------------------------------------------------
// Insights automáticos
// ---------------------------------------------------------------------------

export type InsightType     = 'cooling_opportunity' | 'hot_opportunity' | 'funnel_bottleneck' | 'conversion_drop' | 'ai_tool_issue'
export type InsightPriority = 'critical' | 'high' | 'medium' | 'low'

export interface InsightPoliciesData {
  cooling_threshold_days:    number
  hot_probability_threshold: number
  conversion_drop_threshold: number
  bottleneck_min_days:       number
  ai_error_rate_threshold:   number
}

export interface InsightPoliciesResponse {
  ok:       boolean
  data:     InsightPoliciesData
  defaults: InsightPoliciesData
}

export interface InsightItem {
  id:               string
  type:             InsightType
  priority:         InsightPriority
  title:            string
  description:      string
  entityType:       EntityType | 'funnel'
  filters:          Record<string, unknown>
  actionLabel:      string
  supporting_data?: Record<string, unknown>
}

export interface InsightsResponse {
  ok:   boolean
  data: InsightItem[]
  meta: DashboardMeta & { can_customize: boolean; can_ai_analysis: boolean }
}

// ---------------------------------------------------------------------------
// Itens das listas de entidades
// ---------------------------------------------------------------------------

export interface OpportunityItem {
  opportunity_id:      string
  title:               string
  lead_name:           string
  lead_id:             number
  stage_name:          string
  probability:         number
  status:              string
  updated_at:          string
  last_interaction_at: string | null
}

export interface LeadItem {
  lead_id:    string
  name:       string
  status:     string
  origin:     string
  created_at: string
}

export interface ConversationItem {
  conversation_id: string
  lead_id:         string | null
  lead_name:       string
  ai_state:        string
  last_message_at: string | null
  status:          string
  unread_count:    number
}

export type EntityItem = OpportunityItem | LeadItem | ConversationItem

// ---------------------------------------------------------------------------
// Filtros de listas
// ---------------------------------------------------------------------------

export interface OpportunityFilters extends DashboardFilters {
  stage_id?:        string | null
  status?:          string | null
  probability_min?: number | null
  page?:            number
  limit?:           number
  source?:          string
}

export interface LeadFilters extends DashboardFilters {
  page?: number
}

export interface ConversationFilters extends DashboardFilters {
  ai_state?: string | null
  page?:     number
}

export interface EntityListFilters extends DashboardFilters {
  stage_id?:        string | null
  status?:          string | null
  probability_min?: number | null
  ai_state?:        string | null
  limit?:           number
  source?:          string
}

// ---------------------------------------------------------------------------
// Estado de lista de entidades (retorno do hook useEntityList)
// Inclui funções — é um contrato de hook, não apenas dado.
// ---------------------------------------------------------------------------

export interface EntityListState {
  data:     EntityItem[]
  meta:     ListMeta | null
  loading:  boolean
  error:    string | null
  page:     number
  hasMore:  boolean
  nextPage: () => void
  prevPage: () => void
  refetch:  () => void
}

// ---------------------------------------------------------------------------
// Tendências temporais (Fase 1)
// ---------------------------------------------------------------------------

export interface TrendDay {
  date:  string   // "YYYY-MM-DD"
  count: number
}

export interface AttendanceDay {
  date:                  string   // "YYYY-MM-DD"
  attended:              number
  avg_response_minutes:  number | null
}

export interface TrendsData {
  leads_by_day:      TrendDay[]
  attendance_by_day: AttendanceDay[]
}

export interface TrendsMeta {
  period:  string
  start:   string
  end:     string
  user_id: string | null
}

export interface TrendsResponse {
  ok:   boolean
  data: TrendsData
  meta: TrendsMeta
}

// ---------------------------------------------------------------------------
// Usuários selecionáveis no UserSelector (Fase 1)
// ---------------------------------------------------------------------------

export interface DashboardUser {
  user_id:      string
  display_name: string
  role:         string
}

export interface DashboardUsersResponse {
  ok:   boolean
  data: DashboardUser[]
}

// ---------------------------------------------------------------------------
// Ranking Comercial (Fase 2)
// ---------------------------------------------------------------------------

export interface SellerRankingEntry {
  user_id:          string
  display_name:     string
  rank:             number | null   // null quando individual view (seller vendo a si mesmo)
  score:            number | null   // null quando individual view
  leads_received:   number
  leads_attended:   number
  attendance_rate:  number
  avg_response_min: number | null
  opps_generated:   number
  opps_won:         number
  opps_closed:      number
  conversion_rate:  number
  won_value:        number
  sla_missed_count: number
  sla_missed_rate:  number
}

export interface SellerRankingMeta {
  period:             string
  start:              string
  end:                string
  user_id:            string | null
  total:              number
  is_individual_view: boolean
}

export interface SellerRankingResponse {
  ok:   boolean
  data: SellerRankingEntry[]
  meta: SellerRankingMeta
}

// ---------------------------------------------------------------------------
// SLA Alerts — Leads sem resposta (Fase 2)
// ---------------------------------------------------------------------------

export type SlaAlertSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface SlaAlertItem {
  conversation_id:     string
  lead_id:             string
  lead_name:           string
  responsible_user_id: string | null
  seller_name:         string | null
  last_in_at:          string
  hours_waiting:       number
  severity:            SlaAlertSeverity
}

export interface SlaAlertsMeta {
  total:     number
  page:      number
  limit:     number
  has_more:  boolean
  sla_hours: number
}

export interface SlaAlertsResponse {
  ok:   boolean
  data: SlaAlertItem[]
  meta: SlaAlertsMeta
}

// ---------------------------------------------------------------------------
// Forecast Comercial (Fase 3A)
// ---------------------------------------------------------------------------

export interface ForecastData {
  /** Valor bruto total das oportunidades abertas */
  pipeline_total:         number
  /** Valor ponderado total (value * probability / 100) */
  pipeline_weighted:      number
  /** Valor ponderado em risco = stalled_weighted_value */
  pipeline_risk:          number
  /** Valor ponderado seguro = pipeline_weighted - pipeline_risk */
  pipeline_safe:          number
  open_count:             number
  stalled_count:          number
  /** Valor bruto das oportunidades paradas (informativo) */
  stalled_value:          number
  /** Valor ponderado das oportunidades paradas (usado em pipeline_risk) */
  stalled_weighted_value: number
  won_value:              number
  won_count:              number
  lost_value:             number
  lost_count:             number
  /** Taxa de conversão: won / (won + lost) no período em % */
  conversion_rate:        number
}

export interface ForecastMeta {
  period:     string
  start:      string
  end:        string
  funnel_id:  string | null
  user_id:    string | null
}

export interface ForecastResponse {
  ok:   boolean
  data: ForecastData
  meta: ForecastMeta
}

// ---------------------------------------------------------------------------
// Priority Alerts (Fase 3A)
// ---------------------------------------------------------------------------

export type PriorityAlertSeverity = 'critical' | 'high'
export type PriorityAlertType =
  | 'sla_critical'
  | 'sla_high'
  | 'stalled_opportunity'
  | 'seller_risk'

export type PriorityAlertEntityType = 'conversation' | 'opportunity' | 'seller'

export interface PriorityAlertItem {
  type:         PriorityAlertType
  severity:     PriorityAlertSeverity
  entity_id:    string
  entity_type:  PriorityAlertEntityType
  title:        string
  description:  string
  value:        number
  reference_id: string
}

export interface PriorityAlertsData {
  alerts:   PriorityAlertItem[]
  total:    number
  critical: number
  high:     number
}

export interface PriorityAlertsMeta {
  user_id: string | null
}

export interface PriorityAlertsResponse {
  ok:   boolean
  data: PriorityAlertsData
  meta: PriorityAlertsMeta
}

// ---------------------------------------------------------------------------
// Funil Executivo (Fase 3A) — complementa funnel-snapshot
// ---------------------------------------------------------------------------

export interface FunnelExecutiveStage {
  stage_id:       string
  stage_name:     string
  stage_color:    string | null
  position:       number
  opp_count:      number
  total_value:    number
  weighted_value: number
  stalled_count:  number
  stalled_value:  number
  avg_days:       number
}

export interface FunnelExecutiveData {
  funnel_id: string
  stages:    FunnelExecutiveStage[]
}

export interface FunnelExecutiveMeta {
  funnel_id:   string
  funnel_mode: string
}

export interface FunnelExecutiveResponse {
  ok:   boolean
  data: FunnelExecutiveData
  meta: FunnelExecutiveMeta
}

// ---------------------------------------------------------------------------
// Origem dos Leads (Fase 2)
// ---------------------------------------------------------------------------

export interface LeadOriginItem {
  origin:              string
  lead_count:          number
  opps_generated:      number
  leads_converted:     number
  conversion_rate_pct: number | null
  total_won_value:     number
  avg_won_value:       number
}

export interface LeadOriginsMeta {
  period:        string
  start:         string
  end:           string
  user_id:       string | null
  total_origins: number
}

export interface LeadOriginsResponse {
  ok:   boolean
  data: LeadOriginItem[]
  meta: LeadOriginsMeta
}

// ---------------------------------------------------------------------------
// FASE 4.0 — Snapshot Executivo Histórico
// ---------------------------------------------------------------------------

/** Métricas FLOW (somadas) de um período de snapshot */
export interface SnapshotFlowMetrics {
  leads_created:          number
  conversations_attended: number
  won_count:              number
  won_value:              number
  lost_count:             number
  lost_value:             number
  sla_breached_count:     number
}

/** Métricas STATE (último valor do período) de um snapshot */
export interface SnapshotStateMetrics {
  pipeline_total:        number
  pipeline_weighted:     number
  pipeline_risk:         number
  open_count:            number
  stalled_count:         number
  hot_count:             number
  avg_response_minutes:  number
  conversion_rate:       number
  prob_0_20_value:       number
  prob_21_40_value:      number
  prob_41_60_value:      number
  prob_61_80_value:      number
  prob_81_100_value:     number
  funnel_stages_cache?:  SnapshotStageCacheItem[] | null
  snapshot_date?:        string
}

/** Item do cache de etapas embutido no snapshot */
export interface SnapshotStageCacheItem {
  stage_id:       string
  stage_name:     string
  position:       number
  color:          string | null
  opp_count:      number
  total_value:    number
  weighted_value: number
  stalled_count:  number
  avg_days:       number
}

/** Metadados de uma agregação de período */
export interface SnapshotAggregationMeta {
  from_date:             string
  to_date:               string
  funnel_id:             string | null
  snapshot_days_found:   number
  has_data:              boolean
}

/** Resultado de aggregate_snapshot_period — retornado pelas comparison/trends APIs */
export interface SnapshotAggregateResult {
  flow:  SnapshotFlowMetrics
  state: SnapshotStateMetrics
  meta:  SnapshotAggregationMeta
}

/** Delta entre dois períodos */
export interface SnapshotDelta {
  abs: number
  pct: number
}

/** Resposta de /api/dashboard/snapshot-comparison */
export interface SnapshotComparisonData {
  ok:       boolean
  current:  SnapshotAggregateResult
  previous: SnapshotAggregateResult
  deltas:   Record<string, SnapshotDelta>
  params: {
    company_id:    string
    funnel_id:     string | null
    current_from:  string
    current_to:    string
    previous_from: string
    previous_to:   string
  }
}

/** Um ponto de dado na série temporal */
export interface SnapshotTrendPoint {
  period_start:      string
  snapshot_taken_at: string
  [metric: string]:  number | string
}

/** Resposta de /api/dashboard/snapshot-trends */
export interface SnapshotTrendsData {
  ok:          boolean
  company_id:  string
  funnel_id:   string | null
  from_date:   string
  to_date:     string
  metrics:     string[]
  data_points: number
  series:      SnapshotTrendPoint[]
}

/** Registro de um job de snapshot */
export interface SnapshotBackfillJob {
  id:                   string
  status:               'running' | 'completed' | 'failed' | 'paused'
  from_date:            string
  to_date:              string
  last_processed_date:  string | null
  total_company_days:   number | null
  processed_count:      number
  failed_count:         number
  error_last:           string | null
  started_at:           string
  updated_at:           string
  finished_at:          string | null
}

/** Resposta de /api/dashboard/snapshot-diff */
export interface SnapshotDiffMetric {
  metric:          string
  snapshot_value:  number
  realtime_value:  number
  delta_pct:       number
  ok:              boolean
}

export interface SnapshotDiffResult {
  ok:                boolean
  company_id:        string
  date:              string
  max_drift_pct:     number
  all_ok:            boolean
  drift_count:       number
  metrics:           SnapshotDiffMetric[]
  snapshot_taken_at: string
}

// ── FASE 4.1 — Seller deltas históricos ─────────────────────────────────────

/** Delta por vendedor para WoW/MoM — retornado por /api/dashboard/snapshot-seller-deltas */
export interface SellerSnapshotDelta {
  user_id:               string
  display_name:          string | null
  /** Δ% de attendance_rate (STATE) — null = dados insuficientes */
  attendance_rate_pct:   number | null
  /** Δ% de avg_response_min (STATE) — null = dados insuficientes */
  avg_response_min_pct:  number | null
  /** Série dos últimos N dias de won_value (FLOW) — para sparkline */
  won_value_series:      number[]
}

/** Resposta de /api/dashboard/snapshot-seller-deltas */
export interface SnapshotSellerDeltasData {
  ok:      boolean
  mode:    'wow' | 'mom'
  sellers: SellerSnapshotDelta[]
}

/** Tipo de modo de comparação temporal */
export type ComparisonMode = 'wow' | 'mom'

// ── FASE 4.1.5 — Observabilidade e Health Score ──────────────────────────────

export type SnapshotFreshnessStatus = 'fresh' | 'delayed' | 'stale' | 'missing'
export type SnapshotSeverity        = 'healthy' | 'degraded' | 'warning' | 'critical'
export type SnapshotDriftStatus     = 'ok' | 'warning' | 'critical' | 'no_data'

/** Resposta de GET /api/dashboard/snapshot-health */
export interface SnapshotHealthData {
  ok:             boolean
  company_id:     string
  reference_date: string
  health_score:   number
  severity:       SnapshotSeverity
  components: {
    freshness: {
      score:       number
      status:      SnapshotFreshnessStatus
      latest_date: string | null
      days_since:  number | null
    }
    drift: {
      score:         number
      status:        SnapshotDriftStatus
      max_drift_pct: number | null
    }
    coverage: {
      score:        number
      days_covered: number
      total_days:   number
      coverage_pct: number
    }
    cron: {
      score:        number
      jobs_ok:      number
      jobs_total:   number
      success_rate: number | null
    }
  }
  readiness_4_2: {
    ready:   boolean
    blocker: string | null
  }
}
