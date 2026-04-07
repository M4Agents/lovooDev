// =====================================================
// Chamadas autenticadas às rotas /api/agents/logs/*
//
// Acesso exclusivo: empresa pai (admin/super_admin).
// Nunca usar service_role no frontend — auth via Bearer token.
//
// estimated_cost_usd retornado é ESTIMATIVA OPERACIONAL.
// Não representa faturamento real nem valor cobrado pela OpenAI.
// =====================================================

import { supabase } from '../lib/supabase'

// ── Tipos compartilhados ──────────────────────────────────────────────────────

/**
 * Filtros compartilhados entre listLogs e getSummary.
 *
 * IMPORTANTE: os parâmetros aqui devem ser idênticos ao que os endpoints
 * list.ts e summary.ts aceitam — isso garante que os cards da UI sempre
 * reflitam exatamente o mesmo conjunto de dados exibido na tabela.
 */
export interface LogsFilters {
  from?: string               // ISO date string (ex: '2026-01-01T00:00:00Z')
  to?: string                 // ISO date string
  status?: string             // um dos 7 statuses válidos
  use_id?: string             // uso funcional (ex: 'chat:reply_suggestion:whatsapp')
  consumer_company_id?: string // UUID da empresa consumidora
  // MVP: input manual de UUID.
  // Futuro: substituir por selector amigável de empresas com nome/logo.
}

export interface ListLogsParams extends LogsFilters {
  page?: number      // default 0
  pageSize?: number  // default 50, max 100
}

export type SummaryParams = LogsFilters

// ── Tipos de resposta ─────────────────────────────────────────────────────────

export interface AgentExecutionLog {
  id:                  string
  use_id:              string
  agent_id:            string | null
  consumer_company_id: string | null
  user_id:             string | null
  channel:             string | null
  model:               string | null
  knowledge_mode:      'none' | 'inline' | 'rag' | 'hybrid' | null
  status:              string
  is_fallback:         boolean
  duration_ms:         number | null
  input_tokens:        number | null
  output_tokens:       number | null
  total_tokens:        number | null
  estimated_cost_usd:  number | null
  pricing_version:     string | null
  error_code:          string | null
  created_at:          string
}

export interface LogsListResponse {
  data:     AgentExecutionLog[]
  total:    number
  page:     number
  pageSize: number
}

export interface LogsSummaryResponse {
  total_executions:    number
  total_tokens:        number
  estimated_cost_usd:  number
  /** Fração 0–1. Multiplique por 100 para exibir em %. */
  error_rate:          number
  /** Fração 0–1. Multiplique por 100 para exibir em %. */
  fallback_rate:       number
  by_status:           Record<string, number>
}

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<HeadersInit> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    throw new Error('Não autenticado')
  }
  return {
    Authorization: `Bearer ${session.access_token}`,
  }
}

// ── Helpers internos ──────────────────────────────────────────────────────────

function filtersToParams(filters: LogsFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.from)                params.set('from',                filters.from)
  if (filters.to)                  params.set('to',                  filters.to)
  if (filters.status)              params.set('status',              filters.status)
  if (filters.use_id)              params.set('use_id',              filters.use_id)
  if (filters.consumer_company_id) params.set('consumer_company_id', filters.consumer_company_id)
  return params
}

async function fetchApi<T>(url: string): Promise<T> {
  const headers = await getAuthHeaders()
  const res  = await fetch(url, { headers })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    throw new Error((data.error as string) || `Erro ${res.status}`)
  }
  if (!data.ok) {
    throw new Error((data.error as string) || 'Resposta inválida do servidor')
  }
  return data as T
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Lista execuções paginadas com filtros.
 *
 * Os filtros em `params` devem ser os mesmos passados para `getSummary`
 * para garantir consistência entre tabela e cards.
 */
export async function listLogs(params: ListLogsParams): Promise<LogsListResponse> {
  const qs = filtersToParams(params)
  if (params.page     !== undefined) qs.set('page',     String(params.page))
  if (params.pageSize !== undefined) qs.set('pageSize',  String(params.pageSize))

  const data = await fetchApi<LogsListResponse & { ok: boolean }>(
    `/api/agents/logs/list?${qs.toString()}`
  )
  return {
    data:     data.data     ?? [],
    total:    data.total    ?? 0,
    page:     data.page     ?? 0,
    pageSize: data.pageSize ?? 50,
  }
}

/**
 * Retorna métricas agregadas para o período/filtros informados.
 *
 * DEVE receber os mesmos filtros de `listLogs` (sem page/pageSize)
 * para garantir que os cards reflitam exatamente os dados da tabela.
 */
export async function getSummary(params: SummaryParams): Promise<LogsSummaryResponse> {
  const qs = filtersToParams(params)

  const data = await fetchApi<LogsSummaryResponse & { ok: boolean }>(
    `/api/agents/logs/summary?${qs.toString()}`
  )
  return {
    total_executions:   data.total_executions   ?? 0,
    total_tokens:       data.total_tokens       ?? 0,
    estimated_cost_usd: data.estimated_cost_usd ?? 0,
    error_rate:         data.error_rate         ?? 0,
    fallback_rate:      data.fallback_rate       ?? 0,
    by_status:          data.by_status          ?? {},
  }
}
