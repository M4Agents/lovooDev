// =====================================================
// DASHBOARD API SERVICE
// Wrapper tipado para os endpoints /api/dashboard/*
// Segue o padrão de autenticação do projeto:
//   supabase.auth.getSession() → session.access_token → Authorization: Bearer
// =====================================================

import { supabase } from '../lib/supabase'
import type { PeriodFilter } from '../types/analytics'

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
// Tipos de retorno
// ---------------------------------------------------------------------------

export interface DashboardMeta {
  period: string
  start_date: string
  end_date: string
  funnel_id?: string | null
}

export interface ExecutiveData {
  leads_count: number
  conversations_count: number
  hot_opportunities_count: number
  alerts_count: number
  agent_mode: 'single-agent' | 'multi-agent'
  funnel_mode: 'single-funnel' | 'multi-funnel'
}

export interface SummaryResponse {
  data: ExecutiveData
  meta: Omit<DashboardMeta, 'funnel_id'>
}

export interface StageSnapshot {
  stage_id: string
  stage_name: string
  position: number
  count: number
  total_value: number
  avg_days_in_stage: number
}

export interface FunnelSnapshotData {
  funnel_id: string
  stages: StageSnapshot[]
}

export interface FunnelSnapshotMeta {
  funnel_id: string | null
  funnel_mode: 'single-funnel' | 'multi-funnel'
}

export interface FunnelSnapshotResponse {
  data: FunnelSnapshotData
  meta: FunnelSnapshotMeta
}

export interface StageFlow {
  stage_id: string
  stage_name: string
  position: number
  unique_count: number
  total_count: number
  by_trigger_source: { ai: number; human: number; automation: number; system: number }
  avg_days_prev_stage: number
}

export interface StageConversion {
  from_stage_id: string
  from_stage_name: string
  to_stage_id: string
  to_stage_name: string
  advanced: number
  in_source: number
  conversion_rate_pct: number
}

export interface FunnelFlowData {
  flow: { funnel_id: string; stages: StageFlow[] }
  conversions: { funnel_id: string; conversions: StageConversion[] }
}

export interface FunnelFlowResponse {
  data: FunnelFlowData
  meta: DashboardMeta
}

// ---------------------------------------------------------------------------
// Parâmetros compartilhados
// ---------------------------------------------------------------------------

export interface DashboardFilters {
  period: PeriodFilter
  funnelId?: string | null
}

// ---------------------------------------------------------------------------
// Helper interno: token + fetch tipado
// ---------------------------------------------------------------------------

async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

async function apiFetch<T>(path: string, params: Record<string, string>): Promise<T> {
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
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? `Erro ${res.status} em ${path}`)
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
// buildParams: converte DashboardFilters nos query params do backend
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

  return params
}

// ---------------------------------------------------------------------------
// Tipos de funis
// ---------------------------------------------------------------------------

export interface FunnelItem {
  id: string
  name: string
}

export interface FunnelsResponse {
  data: FunnelItem[]
  meta: Record<string, never>
}

// ---------------------------------------------------------------------------
// Tipos de insights
// ---------------------------------------------------------------------------

export type InsightType    = 'cooling_opportunity' | 'hot_opportunity' | 'funnel_bottleneck' | 'conversion_drop' | 'ai_tool_issue'
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
  entityType:       'opportunities' | 'leads' | 'conversations' | 'funnel'
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
// Tipos de itens das listas
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
  lead_id: string
  name: string
  status: string
  origin: string
  created_at: string
}

export interface ConversationItem {
  conversation_id: string
  lead_name: string
  ai_state: string
  last_message_at: string | null
  status: string
  unread_count: number
}

export interface ListMeta {
  page: number
  limit: number
  total: number
  has_more: boolean
  period: string
  start_date: string
  end_date: string
  funnel_id?: string | null
  ai_state?: string | null
}

export interface ListResponse<T> {
  ok: boolean
  data: T[]
  meta: ListMeta
}

export interface OpportunityFilters extends DashboardFilters {
  stage_id?: string | null
  status?: string | null
  probability_min?: number | null
  page?: number
  limit?: number
  source?: string
}

// ---------------------------------------------------------------------------
// Tipos para IA Analítica sob demanda
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
  // campos extras para awaiting_credits / credit_failed
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

// ---------------------------------------------------------------------------
// Tipos para prompts complementares de IA (E2)
// ---------------------------------------------------------------------------

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

export interface LeadFilters extends DashboardFilters {
  page?: number
}

export interface ConversationFilters extends DashboardFilters {
  ai_state?: string | null
  page?: number
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export const dashboardApi = {
  /**
   * Lista de funis ativos da empresa para alimentar o seletor de funil.
   */
  async getFunnels(companyId: string): Promise<FunnelsResponse> {
    return apiFetch<FunnelsResponse>('/api/dashboard/funnels', { company_id: companyId })
  },

  /**
   * Insights automáticos calculados por SQL/regras — sem LLM.
   */
  async getInsights(companyId: string, filters: DashboardFilters): Promise<InsightsResponse> {
    return apiFetch<InsightsResponse>('/api/dashboard/insights', {
      company_id: companyId,
      ...buildPeriodParams(filters),
    })
  },

  /**
   * Retorna policies de insights da empresa (mescladas com defaults).
   */
  async getInsightPolicies(companyId: string): Promise<InsightPoliciesResponse> {
    return apiFetch<InsightPoliciesResponse>('/api/dashboard/insight-policies', { company_id: companyId })
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
  async getSummary(companyId: string, filters: DashboardFilters): Promise<SummaryResponse> {
    return apiFetch<SummaryResponse>('/api/dashboard/summary', {
      company_id: companyId,
      ...buildPeriodParams(filters),
    })
  },

  /**
   * Pipeline atual: onde estão as oportunidades agora (sem período).
   */
  async getFunnelSnapshot(companyId: string, funnelId?: string | null): Promise<FunnelSnapshotResponse> {
    const params: Record<string, string> = { company_id: companyId }
    if (funnelId) params.funnel_id = funnelId
    return apiFetch<FunnelSnapshotResponse>('/api/dashboard/funnel-snapshot', params)
  },

  /**
   * Fluxo no período + conversão por etapa.
   * funnel_id obrigatório no backend — não chamar sem ele.
   */
  async getFunnelFlow(companyId: string, funnelId: string, filters: DashboardFilters): Promise<FunnelFlowResponse> {
    return apiFetch<FunnelFlowResponse>('/api/dashboard/funnel-flow', {
      company_id: companyId,
      funnel_id:  funnelId,
      ...buildPeriodParams(filters),
    })
  },

  /**
   * Lista paginada de oportunidades com filtros do dashboard.
   */
  async getOpportunities(
    companyId: string,
    filters: OpportunityFilters,
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
    return apiFetch<ListResponse<OpportunityItem>>('/api/dashboard/opportunities', params)
  },

  /**
   * Lista paginada de leads novos no período.
   */
  async getLeads(
    companyId: string,
    filters: LeadFilters,
  ): Promise<ListResponse<LeadItem>> {
    return apiFetch<ListResponse<LeadItem>>('/api/dashboard/leads', {
      company_id: companyId,
      ...buildPeriodParams(filters),
      page: String(filters.page ?? 1),
    })
  },

  /**
   * Lista paginada de conversas ativas no período.
   */
  async getConversations(
    companyId: string,
    filters: ConversationFilters,
  ): Promise<ListResponse<ConversationItem>> {
    const params: Record<string, string> = {
      company_id: companyId,
      ...buildPeriodParams(filters),
      page: String(filters.page ?? 1),
    }
    if (filters.ai_state) params.ai_state = filters.ai_state
    return apiFetch<ListResponse<ConversationItem>>('/api/dashboard/conversations', params)
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
      analysis_id?: string  // resume mode
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
}
