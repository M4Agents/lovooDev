import { supabase } from '../lib/supabase'
import type { TaskCard, TaskScope, WindowMinutes } from '../utils/taskBoardContract'

export interface TaskBoardLead {
  id: number
  name: string
  phone?: string
  email?: string
}

export interface TaskBoardActivity {
  id: string
  company_id: string
  lead_id: number | null
  title: string
  description: string | null
  activity_type: string
  priority: string
  status: string
  scheduled_date: string
  scheduled_time: string
  scheduled_datetime: string | null
  assigned_to: string | null
  owner_user_id: string
  duration_minutes: number
  reminder_minutes: number
  visibility: string
  created_by: string
  notification_sent: boolean
  created_at: string
  updated_at: string
  lead: TaskBoardLead | null
}

export interface TaskBoardResponse {
  success: true
  as_of: string
  timezone: string
  scope: TaskScope
  counts: { open: number; overdue: number; due_today: number; upcoming: number }
  list_total: number
  truncated: boolean
  activities: TaskBoardActivity[]
}

export class TaskBoardRequestError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

export interface TaskBoardQuery {
  companyId: string
  date: string
  from: string
  to: string
  q: string
  activityType: string
  priority: string
  userId: string
  card: TaskCard
  windowMinutes: WindowMinutes
  signal: AbortSignal
}

export async function fetchTaskBoard(query: TaskBoardQuery): Promise<TaskBoardResponse> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new TaskBoardRequestError('Sessão expirada')

  const params = new URLSearchParams({
    company_id: query.companyId,
    date: query.date,
    card: query.card,
    window_minutes: String(query.windowMinutes),
  })
  if (query.date === 'range') {
    params.set('from', query.from)
    params.set('to', query.to)
  }
  if (query.q.trim()) params.set('q', query.q.trim())
  if (query.activityType) params.set('activity_type', query.activityType)
  if (query.priority) params.set('priority', query.priority)
  if (query.userId) params.set('user_id', query.userId)

  const response = await fetch(`/api/activities/board?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: query.signal,
  })
  const json = await response.json() as { success?: boolean; error?: string; code?: string }
  if (!response.ok || json.success === false) {
    throw new TaskBoardRequestError(json.error ?? 'Erro ao carregar tarefas', json.code)
  }
  return json as TaskBoardResponse
}
