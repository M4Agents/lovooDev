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
// Tipos de itens das listas
// ---------------------------------------------------------------------------

export interface OpportunityItem {
  opportunity_id: string
  title: string
  lead_name: string
  stage_name: string
  probability: number
  status: string
  updated_at: string
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
    if (filters.stage_id)         params.stage_id         = filters.stage_id
    if (filters.status)           params.status           = filters.status
    if (filters.probability_min != null) params.probability_min = String(filters.probability_min)
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
}
