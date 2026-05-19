// =====================================================
// DASHBOARD API SERVICE
// Wrapper tipado para os endpoints /api/dashboard/*
// Segue o padrão de autenticação do projeto:
//   supabase.auth.getSession() → session.access_token → Authorization: Bearer
//
// Tipos de domínio da dashboard vivem em src/types/dashboard.ts.
// AiAnalysis* permanecem aqui (domínio separado).
// =====================================================

import { supabase } from '../lib/supabase'

// ---------------------------------------------------------------------------
// Re-exports de src/types/dashboard.ts
// Consumidores existentes que importam deste arquivo continuam funcionando.
// ---------------------------------------------------------------------------

export type {
  PeriodFilter,
  PeriodType,
  AgentMode,
  FunnelMode,
  TrendDirection,
  DashboardFilters,
  DashboardMeta,
  EntityType,
  EntityTypeExtended,
  EntityItem,
  EntityListFilters,
  EntityListState,
  ExecutiveData,
  SummaryResponse,
  StageSnapshot,
  FunnelSnapshotData,
  FunnelSnapshotMeta,
  FunnelSnapshotResponse,
  StageFlow,
  StageConversion,
  FunnelFlowData,
  FunnelFlowResponse,
  FunnelItem,
  FunnelsResponse,
  InsightType,
  InsightPriority,
  InsightPoliciesData,
  InsightPoliciesResponse,
  InsightItem,
  InsightsResponse,
  OpportunityItem,
  LeadItem,
  ConversationItem,
  ListMeta,
  ListResponse,
  OpportunityFilters,
  LeadFilters,
  ConversationFilters,
  TrendDay,
  AttendanceDay,
  TrendsData,
  TrendsMeta,
  TrendsResponse,
  DashboardUser,
  DashboardUsersResponse,
  SellerRankingEntry,
  // Fase 4.0
  SnapshotFlowMetrics,
  SnapshotStateMetrics,
  SnapshotStageCacheItem,
  SnapshotAggregationMeta,
  SnapshotAggregateResult,
  SnapshotDelta,
  SnapshotComparisonData,
  SnapshotTrendPoint,
  SnapshotTrendsData,
  SnapshotBackfillJob,
  SnapshotDiffMetric,
  SnapshotDiffResult,
  // Fase 4.1
  SellerSnapshotDelta,
  SnapshotSellerDeltasData,
  ComparisonMode,
  // Fase 4.1.5
  SnapshotHealthData,
  SnapshotFreshnessStatus,
  SnapshotSeverity,
  SnapshotDriftStatus,
  SellerRankingMeta,
  SellerRankingResponse,
  SlaAlertSeverity,
  SlaAlertItem,
  SlaAlertsMeta,
  SlaAlertsResponse,
  LeadOriginItem,
  LeadOriginsMeta,
  LeadOriginsResponse,
  // Fase 3A
  ForecastData,
  ForecastMeta,
  ForecastResponse,
  PriorityAlertSeverity,
  PriorityAlertType,
  PriorityAlertEntityType,
  PriorityAlertItem,
  PriorityAlertsData,
  PriorityAlertsMeta,
  PriorityAlertsResponse,
  FunnelExecutiveStage,
  FunnelExecutiveData,
  FunnelExecutiveMeta,
  FunnelExecutiveResponse,
  // Dispensa de Alertas
  AlertDismissalScope,
  AlertKind,
  DismissAlertPayload,
  DismissalResult,
  DismissAlertResponse,
  // Configurações de Alertas
  SlaSettings,
  StalledSettings,
  SellerRiskSettings,
  AlertSettings,
  AlertSettingsResponse,
} from '../types/dashboard'

// Importação local dos tipos necessários para as assinaturas das funções
import type {
  DashboardFilters,
  SummaryResponse,
  FunnelSnapshotResponse,
  FunnelFlowResponse,
  FunnelsResponse,
  InsightPoliciesData,
  InsightPoliciesResponse,
  InsightsResponse,
  ListResponse,
  OpportunityItem,
  OpportunityFilters,
  LeadItem,
  LeadFilters,
  ConversationItem,
  ConversationFilters,
  TrendsResponse,
  DashboardUsersResponse,
  SellerRankingResponse,
  SlaAlertsResponse,
  LeadOriginsResponse,
  ForecastResponse,
  PriorityAlertsResponse,
  FunnelExecutiveResponse,
  DismissAlertPayload,
  DismissAlertResponse,
  AlertSettings,
  AlertSettingsResponse,
} from '../types/dashboard'

// ---------------------------------------------------------------------------
// Tipos de IA Analítica (mantidos aqui — domínio separado do cockpit)
// ---------------------------------------------------------------------------

export type AiAnalysisType   = 'cooling_opportunities' | 'conversion_drop' | 'funnel_overview'
export type AiAnalysisStatus = 'pending' | 'processing' | 'awaiting_credits' | 'completed' | 'failed' | 'credit_failed'

export interface AiNextBestAction {
  title:       string
  description: string
  action_type: 'open_filtered_opportunities' | 'open_funnel_stage'
  filters:     Record<string, unknown>
  impact:      'high' | 'medium' | 'low'
}

export interface AiAnalysisOutput {
  title:               string
  summary:             string
  findings:            string[]
  recommended_actions: string[]
  next_best_actions:   AiNextBestAction[]
  limitations:         string[]
}

export interface AiAnalysisResult {
  id:                string
  analysis_type:     AiAnalysisType
  funnel_id:         string | null
  period:            string | null
  status:            AiAnalysisStatus
  output:            AiAnalysisOutput | null
  credits_used:      number | null
  estimated_credits: number | null
  model:             string | null
  error_message:     string | null
  completed_at:      string | null
  started_at:        string | null
  created_at:        string
  balance_available?: number
  required_balance?:  number
  missing_credits?:   number
  message?:           string
}

export interface AiAnalysisSummary {
  id:                string
  analysis_type:     AiAnalysisType
  funnel_id:         string | null
  period:            string | null
  status:            AiAnalysisStatus
  estimated_credits: number | null
  credits_used:      number | null
  model:             string | null
  created_at:        string
  completed_at:      string | null
  title:             string | null
}

/** Resposta do POST /api/dashboard/ai-analysis (múltiplas formas) */
export interface AiAnalysisPostResponse {
  ok:               boolean
  status?:          AiAnalysisStatus | string
  analysis_id?:     string | null
  cache_available?: boolean
  processing?:      boolean
  data?:            AiAnalysisResult
  balance_available?: number
  estimated_credits?: number
  required_balance?:  number
  missing_credits?:   number
  error?:             string
  message?:           string
  created_at?:        string
}

export interface AiAnalysesListResponse {
  ok:   boolean
  data: AiAnalysisSummary[]
  meta: { total: number; page: number; limit: number; total_pages: number; has_more: boolean }
}

export interface AiPromptItem {
  id:            string | null
  analysis_type: AiAnalysisType
  custom_prompt: string
  is_active:     boolean
  updated_by:    string | null
  updated_at:    string | null
}

export interface AiPromptsResponse {
  ok:   boolean
  data: AiPromptItem[]
}

// ---------------------------------------------------------------------------
// Mapeamento: PeriodType frontend → period key do backend
// ---------------------------------------------------------------------------

const PERIOD_TYPE_MAP: Record<string, string> = {
  today:         'today',
  yesterday:     'yesterday',
  '7days':       '7d',
  '15days':      '15d',
  '30days':      '30d',
  this_month:    'month',
  last_month:    'last_month',
  '90days':      '90d',
  this_quarter:  'quarter',
  this_year:     'year',
  custom:        'custom',
}

function toPeriodKey(type: string): string {
  return PERIOD_TYPE_MAP[type] ?? '30d'
}

// ---------------------------------------------------------------------------
// Helper interno: token + fetch tipado
// ---------------------------------------------------------------------------

async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

async function apiFetch<T>(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const token = await getToken()
  if (!token) throw new Error('Sessão expirada. Faça login novamente.')

  const url = new URL(path, window.location.origin)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, v)
    }
  })

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? `Erro ${res.status} em ${path}`)
  }

  return res.json() as Promise<T>
}

async function apiDelete<T>(path: string, queryParams: Record<string, string>): Promise<T> {
  const token = await getToken()
  if (!token) throw new Error('Sessão expirada. Faça login novamente.')

  const url = new URL(path, window.location.origin)
  Object.entries(queryParams).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
  })

  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json?.error ?? `Erro ${res.status} em ${path}`)
  }

  return res.json() as Promise<T>
}

async function apiPost<T>(path: string, queryParams: Record<string, string>, body: unknown): Promise<T> {
  const token = await getToken()
  if (!token) throw new Error('Sessão expirada. Faça login novamente.')

  const url = new URL(path, window.location.origin)
  Object.entries(queryParams).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
  })

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json?.error ?? `Erro ${res.status} em ${path}`)
  }

  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// reportSnapshotFallback — fire-and-forget, nunca lança erro
// ---------------------------------------------------------------------------

type FallbackEndpoint = 'comparison' | 'trends' | 'seller-deltas'
type FallbackReason   = 'missing_data' | 'api_error' | 'insufficient_points' | 'freshness_stale'

function reportSnapshotFallback(
  companyId: string,
  endpoint:  FallbackEndpoint,
  reason:    FallbackReason,
  mode?:     string,
): void {
  // Fire-and-forget — nunca bloqueia, nunca lança
  apiPost('/api/internal/snapshot-fallback-log', {}, {
    company_id: companyId,
    endpoint,
    reason,
    mode: mode ?? null,
  }).catch(() => {/* silent — fallback tracking não pode quebrar UX */})
}

// ---------------------------------------------------------------------------
// buildPeriodParams: converte DashboardFilters nos query params do backend
// ---------------------------------------------------------------------------

function buildPeriodParams(filters: DashboardFilters): Record<string, string> {
  const { period } = filters
  const key = toPeriodKey(period.type)
  const params: Record<string, string> = { period: key }

  if (key === 'custom' && period.startDate && period.endDate) {
    params.start_date = period.startDate.toISOString()
    params.end_date   = period.endDate.toISOString()
  }

  if (filters.funnelId) {
    params.funnel_id = filters.funnelId
  }

  if (filters.userId) {
    params.user_id = filters.userId
  }

  return params
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export const dashboardApi = {
  /**
   * Lista de funis ativos da empresa para alimentar o seletor de funil.
   */
  async getFunnels(companyId: string, signal?: AbortSignal): Promise<FunnelsResponse> {
    return apiFetch<FunnelsResponse>('/api/dashboard/funnels', { company_id: companyId }, signal)
  },

  /**
   * Insights automáticos calculados por SQL/regras — sem LLM.
   */
  async getInsights(companyId: string, filters: DashboardFilters, signal?: AbortSignal): Promise<InsightsResponse> {
    return apiFetch<InsightsResponse>('/api/dashboard/insights', {
      company_id: companyId,
      ...buildPeriodParams(filters),
    }, signal)
  },

  /**
   * Retorna policies de insights da empresa (mescladas com defaults).
   */
  async getInsightPolicies(companyId: string, signal?: AbortSignal): Promise<InsightPoliciesResponse> {
    return apiFetch<InsightPoliciesResponse>('/api/dashboard/insight-policies', { company_id: companyId }, signal)
  },

  /**
   * Salva policies customizadas (requer plano com feature habilitada).
   * Campos omitidos mantêm o valor existente no banco.
   */
  async saveInsightPolicies(companyId: string, policies: Partial<InsightPoliciesData>): Promise<InsightPoliciesResponse> {
    return apiPost<InsightPoliciesResponse>('/api/dashboard/insight-policies', { company_id: companyId }, policies)
  },

  /**
   * KPIs executivos + agent_mode + funnel_mode.
   * Requer company_id e período.
   */
  async getSummary(companyId: string, filters: DashboardFilters, signal?: AbortSignal): Promise<SummaryResponse> {
    return apiFetch<SummaryResponse>('/api/dashboard/summary', {
      company_id: companyId,
      ...buildPeriodParams(filters),
    }, signal)
  },

  /**
   * Pipeline atual: onde estão as oportunidades agora (sem período).
   */
  async getFunnelSnapshot(companyId: string, funnelId?: string | null, signal?: AbortSignal): Promise<FunnelSnapshotResponse> {
    const params: Record<string, string> = { company_id: companyId }
    if (funnelId) params.funnel_id = funnelId
    return apiFetch<FunnelSnapshotResponse>('/api/dashboard/funnel-snapshot', params, signal)
  },

  /**
   * Fluxo no período + conversão por etapa.
   * funnel_id obrigatório no backend — não chamar sem ele.
   */
  async getFunnelFlow(companyId: string, funnelId: string, filters: DashboardFilters, signal?: AbortSignal): Promise<FunnelFlowResponse> {
    return apiFetch<FunnelFlowResponse>('/api/dashboard/funnel-flow', {
      company_id: companyId,
      funnel_id:  funnelId,
      ...buildPeriodParams(filters),
    }, signal)
  },

  /**
   * Lista paginada de oportunidades com filtros do dashboard.
   */
  async getOpportunities(
    companyId: string,
    filters: OpportunityFilters,
    signal?: AbortSignal,
  ): Promise<ListResponse<OpportunityItem>> {
    const params: Record<string, string> = {
      company_id: companyId,
      ...buildPeriodParams(filters),
      page:  String(filters.page  ?? 1),
    }
    if (filters.stage_id)                params.stage_id         = filters.stage_id
    if (filters.status)                  params.status           = filters.status
    if (filters.probability_min != null) params.probability_min  = String(filters.probability_min)
    if (filters.limit != null)           params.limit            = String(filters.limit)
    if (filters.source)                  params.source           = filters.source
    return apiFetch<ListResponse<OpportunityItem>>('/api/dashboard/opportunities', params, signal)
  },

  /**
   * Lista paginada de leads novos no período.
   */
  async getLeads(
    companyId: string,
    filters: LeadFilters,
    signal?: AbortSignal,
  ): Promise<ListResponse<LeadItem>> {
    return apiFetch<ListResponse<LeadItem>>('/api/dashboard/leads', {
      company_id: companyId,
      ...buildPeriodParams(filters),
      page: String(filters.page ?? 1),
    }, signal)
  },

  /**
   * Lista paginada de conversas ativas no período.
   */
  async getConversations(
    companyId: string,
    filters: ConversationFilters,
    signal?: AbortSignal,
  ): Promise<ListResponse<ConversationItem>> {
    const params: Record<string, string> = {
      company_id: companyId,
      ...buildPeriodParams(filters),
      page: String(filters.page ?? 1),
    }
    if (filters.ai_state) params.ai_state = filters.ai_state
    return apiFetch<ListResponse<ConversationItem>>('/api/dashboard/conversations', params, signal)
  },

  /**
   * Série temporal de novos leads por dia e atendimentos com tempo médio de resposta.
   * userId em filters é aplicado no backend com validação de RBAC:
   *   seller   → backend ignora o userId e usa sempre o próprio ID do chamador
   *   manager+ → userId filtrado apenas se for membro ativo da empresa
   */
  async getTrends(companyId: string, filters: DashboardFilters, signal?: AbortSignal): Promise<TrendsResponse> {
    const params: Record<string, string> = {
      company_id: companyId,
      ...buildPeriodParams(filters),
    }
    return apiFetch<TrendsResponse>('/api/dashboard/trends', params, signal)
  },

  /**
   * Lista de usuários que o chamador pode usar como filtro no UserSelector.
   * Retorna apenas si mesmo para sellers; sellers + managers para admin+.
   */
  async getDashboardUsers(companyId: string, signal?: AbortSignal): Promise<DashboardUsersResponse> {
    return apiFetch<DashboardUsersResponse>('/api/dashboard/dashboard-users', { company_id: companyId }, signal)
  },

  // ── IA Analítica ──────────────────────────────────────────────────────────

  /**
   * Solicita análise de IA (novo, resume ou cache).
   * Retorna o objeto bruto — não lança em 402 (saldo insuficiente).
   */
  async requestAiAnalysis(
    companyId: string,
    params: {
      analysis_type?: AiAnalysisType
      period?: string
      funnel_id?: string | null
      analysis_id?: string
    },
  ): Promise<{ status: number; data: AiAnalysisPostResponse }> {
    const token = await getToken()
    if (!token) throw new Error('Sessão expirada. Faça login novamente.')

    const res = await fetch('/api/dashboard/ai-analysis', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, ...params }),
    })

    const data = await res.json().catch(() => ({}))
    return { status: res.status, data }
  },

  /**
   * Carrega análise específica por ID (sem chamar LLM).
   */
  async getAiAnalysis(analysisId: string): Promise<{ ok: boolean; data: AiAnalysisResult }> {
    return apiFetch<{ ok: boolean; data: AiAnalysisResult }>(
      `/api/dashboard/ai-analysis/${analysisId}`, {},
    )
  },

  /**
   * Histórico paginado de análises da empresa.
   */
  async getAiAnalyses(
    companyId: string,
    options: { page?: number; status?: string; analysis_type?: string } = {},
  ): Promise<AiAnalysesListResponse> {
    const params: Record<string, string> = { company_id: companyId, page: String(options.page ?? 1) }
    if (options.status)        params.status        = options.status
    if (options.analysis_type) params.analysis_type = options.analysis_type
    return apiFetch<AiAnalysesListResponse>('/api/dashboard/ai-analyses', params)
  },

  // ── Prompts complementares (E2) ───────────────────────────────────────────

  /**
   * Lista os prompts complementares da empresa (3 tipos MVP, com fallback).
   */
  async getAiPrompts(companyId: string): Promise<AiPromptsResponse> {
    return apiFetch<AiPromptsResponse>('/api/dashboard/ai-prompts', { company_id: companyId })
  },

  /**
   * Salva/atualiza o prompt complementar de um tipo de análise.
   * Requer role admin/super_admin/system_admin.
   */
  async saveAiPrompt(
    companyId: string,
    params: { analysis_type: AiAnalysisType; custom_prompt: string; is_active: boolean },
  ): Promise<{ ok: boolean; data: AiPromptItem }> {
    return apiPost<{ ok: boolean; data: AiPromptItem }>(
      '/api/dashboard/ai-prompts', { company_id: companyId }, params,
    )
  },

  // ── Fase 2 — Gestão Comercial ─────────────────────────────────────────────

  /**
   * Ranking Comercial com score composto por vendedor.
   * seller/partner → sempre vê apenas si mesmo (is_individual_view = true).
   * manager/admin  → ranking completo ou filtrado por user_id.
   */
  async getSellerPerformance(
    companyId: string,
    filters:   DashboardFilters,
    signal?:   AbortSignal,
  ): Promise<SellerRankingResponse> {
    return apiFetch<SellerRankingResponse>(
      '/api/dashboard/seller-performance',
      { company_id: companyId, ...buildPeriodParams(filters) },
      signal,
    )
  },

  /**
   * Leads sem resposta após sla_hours horas — paginado.
   * seller/partner → vê apenas os seus próprios leads.
   */
  async getSlaAlerts(
    companyId: string,
    options:   { userId?: string | null; slaHours?: number; page?: number; limit?: number } = {},
    signal?:   AbortSignal,
  ): Promise<SlaAlertsResponse> {
    const params: Record<string, string> = { company_id: companyId }
    if (options.userId)                params.user_id   = options.userId
    if (options.slaHours !== undefined) params.sla_hours = String(options.slaHours)
    if (options.page !== undefined)     params.page      = String(options.page)
    if (options.limit !== undefined)    params.limit     = String(options.limit)
    return apiFetch<SlaAlertsResponse>('/api/dashboard/sla-alerts', params, signal)
  },

  /**
   * Volume, conversão e receita por canal de origem dos leads.
   * Retorna até 20 origens ordenadas por volume.
   */
  async getLeadOrigins(
    companyId: string,
    filters:   DashboardFilters,
    signal?:   AbortSignal,
  ): Promise<LeadOriginsResponse> {
    return apiFetch<LeadOriginsResponse>(
      '/api/dashboard/lead-origins',
      { company_id: companyId, ...buildPeriodParams(filters) },
      signal,
    )
  },

  // ---------------------------------------------------------------------------
  // Fase 3A — Inteligência Executiva Confiável
  // ---------------------------------------------------------------------------

  /**
   * Forecast comercial: pipeline atual + fechamentos no período.
   * pipeline_safe = pipeline_weighted - pipeline_risk (ambos ponderados).
   */
  async getForecast(
    companyId: string,
    filters:   DashboardFilters,
    signal?:   AbortSignal,
  ): Promise<ForecastResponse> {
    const params: Record<string, string> = {
      company_id: companyId,
      ...buildPeriodParams(filters),
    }
    if (filters.funnelId) params.funnel_id = filters.funnelId
    return apiFetch<ForecastResponse>('/api/dashboard/forecast', params, signal)
  },

  /**
   * Alertas prioritários em tempo real (sem período).
   * Tipos: sla_critical, sla_high, stalled_opportunity, seller_risk.
   */
  async getPriorityAlerts(
    companyId: string,
    userId:    string | null | undefined,
    signal?:   AbortSignal,
  ): Promise<PriorityAlertsResponse> {
    const params: Record<string, string> = { company_id: companyId }
    if (userId) params.user_id = userId
    return apiFetch<PriorityAlertsResponse>('/api/dashboard/priority-alerts', params, signal)
  },

  /**
   * Visão executiva do funil: valor, weighted, avg_days, paradas por etapa.
   * Complementa funnel-snapshot (não o substitui).
   */
  async getFunnelExecutive(
    companyId: string,
    funnelId:  string | null | undefined,
    signal?:   AbortSignal,
  ): Promise<FunnelExecutiveResponse> {
    const params: Record<string, string> = { company_id: companyId }
    if (funnelId) params.funnel_id = funnelId
    return apiFetch<FunnelExecutiveResponse>('/api/dashboard/funnel-executive', params, signal)
  },

  // ── FASE 4.0 — Snapshot histórico (shadow mode) ────────────────────────

  /**
   * Compara dois períodos históricos usando snapshots agregados.
   * SHADOW MODE: não chamado pelo dashboard ainda (FASE 4.1).
   */
  async getSnapshotComparison(
    companyId:    string,
    currentFrom:  string,
    currentTo:    string,
    previousFrom: string,
    previousTo:   string,
    funnelId?:    string | null,
    signal?:      AbortSignal,
  ): Promise<SnapshotComparisonData> {
    const params: Record<string, string> = {
      company_id:    companyId,
      current_from:  currentFrom,
      current_to:    currentTo,
      previous_from: previousFrom,
      previous_to:   previousTo,
    }
    if (funnelId) params.funnel_id = funnelId
    return apiFetch<SnapshotComparisonData>('/api/dashboard/snapshot-comparison', params, signal)
  },

  /**
   * Série temporal de snapshots diários para gráficos de tendência.
   * FASE 4.1: Integrado nos componentes históricos.
   */
  async getSnapshotTrends(
    companyId: string,
    fromDate:  string,
    toDate:    string,
    metrics?:  string[],
    funnelId?: string | null,
    signal?:   AbortSignal,
  ): Promise<SnapshotTrendsData> {
    const params: Record<string, string> = {
      company_id: companyId,
      from_date:  fromDate,
      to_date:    toDate,
    }
    if (metrics && metrics.length > 0) params.metrics = metrics.join(',')
    if (funnelId) params.funnel_id = funnelId
    return apiFetch<SnapshotTrendsData>('/api/dashboard/snapshot-trends', params, signal)
  },

  /**
   * Deltas WoW/MoM por vendedor usando dashboard_seller_snapshots.
   * FASE 4.1: Usado no SellerRankingSection para deltas de attendance_rate,
   * avg_response_min e sparkline de won_value.
   */
  async getSnapshotSellerDeltas(
    companyId: string,
    mode:      'wow' | 'mom',
    signal?:   AbortSignal,
  ): Promise<SnapshotSellerDeltasData> {
    return apiFetch<SnapshotSellerDeltasData>(
      '/api/dashboard/snapshot-seller-deltas',
      { company_id: companyId, mode },
      signal,
    )
  },

  /**
   * Health score consolidado da camada histórica para um tenant.
   * FASE 4.1.5: usado por useSnapshotHealth e readiness checklist FASE 4.2.
   */
  async getSnapshotHealth(
    companyId: string,
    date?:     string,
    signal?:   AbortSignal,
  ): Promise<SnapshotHealthData> {
    const params: Record<string, string> = { company_id: companyId }
    if (date) params.date = date
    return apiFetch<SnapshotHealthData>('/api/dashboard/snapshot-health', params, signal)
  },

  /**
   * Fire-and-forget de fallback silencioso.
   * FASE 4.1.5: chamado pelos hooks quando ocorre fallback para null.
   * Nunca lança erro — não bloqueia UX.
   */
  reportSnapshotFallback,

  // ── Dispensa de Alertas ───────────────────────────────────────────────────

  /**
   * Registra a dispensa de um alerta do dashboard.
   *
   * A dispensa SLA é vinculada à mensagem específica (last_inbound_message_id)
   * que gerou o alerta. Se chegar uma nova inbound, o alerta reaparece.
   *
   * company_id não faz parte de DismissAlertPayload; é recebido como argumento
   * separado e incluído no body montado aqui — nunca vem direto do estado de UI.
   *
   * Retorna DismissalResult.id — necessário para o undo (undoDismissal).
   * Lança Error com mensagem do backend em caso de falha (4xx/5xx).
   */
  async dismissAlert(
    companyId: string,
    payload:   DismissAlertPayload,
  ): Promise<DismissAlertResponse> {
    return apiPost<DismissAlertResponse>(
      '/api/dashboard/alert-dismissals',
      {},
      { company_id: companyId, ...payload },
    )
  },

  /**
   * Desfaz (undo) uma dispensa de alerta do dashboard.
   *
   * O alerta volta a aparecer na próxima chamada às RPCs.
   * dismissalId é o UUID retornado por dismissAlert.
   *
   * Lança Error com mensagem do backend em caso de falha (4xx/5xx).
   */
  async undoDismissal(
    companyId:   string,
    dismissalId: string,
  ): Promise<{ ok: boolean }> {
    return apiDelete<{ ok: boolean }>(
      `/api/dashboard/alert-dismissals/${dismissalId}`,
      { company_id: companyId },
    )
  },

  // ── Configurações de Alertas ──────────────────────────────────────────────

  /**
   * Carrega configurações personalizadas de alertas da empresa.
   *
   * Quando a empresa não tem linha em dashboard_alert_settings,
   * o backend retorna os GLOBAL_DEFAULTS com meta.is_default = true.
   * O campo data nunca é null — sempre vem populado com valores operacionais.
   *
   * Requer membership ativo (qualquer role).
   */
  async getAlertSettings(
    companyId: string,
    signal?:   AbortSignal,
  ): Promise<AlertSettingsResponse> {
    return apiFetch<AlertSettingsResponse>(
      '/api/dashboard/alert-settings',
      { company_id: companyId },
      signal,
    )
  },

  /**
   * Salva configurações personalizadas de alertas (upsert por company_id).
   *
   * Aceita qualquer subconjunto das 3 seções — cada seção ausente mantém
   * o valor atual no banco (merge seguro feito pelo backend).
   * Cada seção presente deve conter todos os campos obrigatórios.
   *
   * updated_by é sempre user.id do JWT no backend — nunca enviado pelo frontend.
   * Requer role admin / system_admin / super_admin.
   */
  async saveAlertSettings(
    companyId: string,
    settings:  Partial<AlertSettings>,
  ): Promise<AlertSettingsResponse> {
    return apiPost<AlertSettingsResponse>(
      '/api/dashboard/alert-settings',
      {},
      { company_id: companyId, ...settings },
    )
  },
}
