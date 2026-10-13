import { supabase } from '../lib/supabase'
import type { TaskScope } from '../utils/taskBoardContract'
import { isTasklessPeriodType, type TasklessPeriodType } from '../utils/tasklessPeriod'
import { TaskBoardRequestError } from './taskBoardApi'

export interface TasklessStage {
  id: string
  name: string
  position: number
  stage_type: string
}

export interface TasklessFunnel {
  id: string
  name: string
  is_active: boolean
  stages: TasklessStage[]
}

export interface TasklessConfig {
  funnels: TasklessFunnel[]
  stage_ids: string[]
  period_type: TasklessPeriodType
  custom_start: string | null
  custom_end: string | null
  saved: boolean
}

export interface TasklessLeadPosition {
  position_id: string
  lead_id: number
  lead_name: string
  funnel_id: string
  funnel_name: string
  stage_id: string
  stage_name: string
  entered_stage_at: string | null
  responsible_user_id: string | null
  last_completed_at: string | null
}

export interface TasklessLeadList {
  scope: TaskScope
  timezone: string
  configured: boolean
  period_type: TasklessPeriodType
  custom_start: string | null
  custom_end: string | null
  total: number
  offset: number
  truncated: boolean
  items: TasklessLeadPosition[]
}

function isPeriod(value: unknown): value is TasklessPeriodType {
  return typeof value === 'string' && isTasklessPeriodType(value)
}

async function authToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new TaskBoardRequestError('Sessão expirada')
  return token
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>
  } catch {
    throw new TaskBoardRequestError('Não foi possível carregar os leads sem tarefas')
  }
}

export async function fetchTasklessConfig(companyId: string, signal?: AbortSignal): Promise<TasklessConfig> {
  const token = await authToken()
  const response = await fetch(`/api/activities/taskless-config?company_id=${encodeURIComponent(companyId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  const json = await readJson(response)
  if (!response.ok || json.success === false) {
    throw new TaskBoardRequestError(typeof json.error === 'string' ? json.error : 'Erro ao carregar as etapas')
  }
  return {
    funnels: Array.isArray(json.funnels) ? json.funnels as TasklessFunnel[] : [],
    stage_ids: Array.isArray(json.stage_ids) ? json.stage_ids.filter((id): id is string => typeof id === 'string') : [],
    period_type: isPeriod(json.period_type) ? json.period_type : '30days',
    custom_start: typeof json.custom_start === 'string' ? json.custom_start : null,
    custom_end: typeof json.custom_end === 'string' ? json.custom_end : null,
    saved: json.saved === true,
  }
}

export async function saveTasklessConfig(
  companyId: string,
  stageIds: string[],
  period: { periodType: TasklessPeriodType; customStart: string | null; customEnd: string | null },
): Promise<void> {
  const token = await authToken()
  const response = await fetch('/api/activities/taskless-config', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      company_id: companyId,
      stage_ids: stageIds,
      period_type: period.periodType,
      custom_start: period.customStart,
      custom_end: period.customEnd,
    }),
  })
  const json = await readJson(response)
  if (!response.ok || json.success === false) {
    throw new TaskBoardRequestError(typeof json.error === 'string' ? json.error : 'Erro ao salvar a configuração')
  }
}

export async function fetchTasklessLeads(
  companyId: string,
  offset = 0,
  filters: { query?: string; userId?: string } = {},
  signal?: AbortSignal,
): Promise<TasklessLeadList> {
  const token = await authToken()
  const params = new URLSearchParams({
    company_id: companyId,
    offset: String(offset),
  })
  if (filters.query) params.set('q', filters.query)
  if (filters.userId) params.set('user_id', filters.userId)
  const response = await fetch(`/api/activities/taskless-leads?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  const json = await readJson(response)
  if (!response.ok || json.success === false) {
    throw new TaskBoardRequestError(typeof json.error === 'string' ? json.error : 'Erro ao carregar leads sem tarefas')
  }
  return {
    scope: json.scope === 'company' ? 'company' : 'own',
    timezone: typeof json.timezone === 'string' ? json.timezone : 'America/Sao_Paulo',
    configured: json.configured === true,
    period_type: isPeriod(json.period_type) ? json.period_type : '30days',
    custom_start: typeof json.custom_start === 'string' ? json.custom_start : null,
    custom_end: typeof json.custom_end === 'string' ? json.custom_end : null,
    total: typeof json.total === 'number' ? json.total : 0,
    offset: typeof json.offset === 'number' ? json.offset : offset,
    truncated: json.truncated === true,
    items: Array.isArray(json.items) ? json.items as TasklessLeadPosition[] : [],
  }
}
