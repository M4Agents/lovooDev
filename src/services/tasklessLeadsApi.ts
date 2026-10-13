import { supabase } from '../lib/supabase'
import type { TaskScope } from '../utils/taskBoardContract'
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
  can_edit: boolean
  funnels: TasklessFunnel[]
  stage_ids: string[]
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
  total: number
  truncated: boolean
  items: TasklessLeadPosition[]
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
    can_edit: json.can_edit === true,
    funnels: Array.isArray(json.funnels) ? json.funnels as TasklessFunnel[] : [],
    stage_ids: Array.isArray(json.stage_ids) ? json.stage_ids.filter((id): id is string => typeof id === 'string') : [],
  }
}

export async function saveTasklessConfig(companyId: string, stageIds: string[]): Promise<string[]> {
  const token = await authToken()
  const response = await fetch('/api/activities/taskless-config', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ company_id: companyId, stage_ids: stageIds }),
  })
  const json = await readJson(response)
  if (!response.ok || json.success === false) {
    throw new TaskBoardRequestError(typeof json.error === 'string' ? json.error : 'Erro ao salvar as etapas')
  }
  return Array.isArray(json.stage_ids) ? json.stage_ids.filter((id): id is string => typeof id === 'string') : stageIds
}

export async function fetchTasklessLeads(companyId: string, signal?: AbortSignal): Promise<TasklessLeadList> {
  const token = await authToken()
  const response = await fetch(`/api/activities/taskless-leads?company_id=${encodeURIComponent(companyId)}`, {
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
    total: typeof json.total === 'number' ? json.total : 0,
    truncated: json.truncated === true,
    items: Array.isArray(json.items) ? json.items as TasklessLeadPosition[] : [],
  }
}
