import { validateCaller } from '../lib/activities/activityAuth.js'
import { QueryTimeoutError, SearchTooBroadError, resolveTitleOrLeadFilter } from '../lib/activities/taskBoardSearch.js'
import {
  buildAssigneeOr,
  effectiveAssigneeFilter,
  handlerTimedOut,
  normalizeSearchTerm,
  parseCard,
  parseDateMode,
  parseWindowMinutes,
  resolveCardBounds,
  resolveDateBounds,
  resolveTaskScope,
  urlExceedsLimit,
  TASK_SEARCH_LIMITS,
  type CardBounds,
  type DateBounds,
  type TaskCard,
} from '../../src/utils/taskBoardContract.js'

const OPEN_STATUSES = ['pending', 'in_progress']
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent'])
const ACTIVITY_SELECT = `
  id, title, description, activity_type, priority, status,
  scheduled_date, scheduled_time, scheduled_datetime,
  assigned_to, owner_user_id, lead_id, company_id,
  duration_minutes, reminder_minutes, visibility, created_by,
  notification_sent, created_at, updated_at,
  lead:leads(id, name, phone, email)
`

function queryText(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyBounds(query: any, dateBounds: DateBounds, cardBounds: CardBounds) {
  let next = query
  if (dateBounds.kind === 'undated') next = next.is('scheduled_datetime', null)
  if (dateBounds.kind === 'range') {
    next = next.gte('scheduled_datetime', dateBounds.start).lt('scheduled_datetime', dateBounds.end)
  }
  if (cardBounds.kind === 'before') next = next.lt('scheduled_datetime', cardBounds.end)
  if (cardBounds.kind === 'between') {
    next = next.gte('scheduled_datetime', cardBounds.start).lt('scheduled_datetime', cardBounds.end)
  }
  return next
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCommon(query: any, companyId: string, assigneeOr: string | null, searchOr: string | null, activityType: string, priority: string, dateBounds: DateBounds) {
  let next = query.eq('company_id', companyId).in('status', OPEN_STATUSES)
  if (assigneeOr) next = next.or(assigneeOr)
  if (searchOr) next = next.or(searchOr)
  if (activityType) next = next.eq('activity_type', activityType)
  if (priority) next = next.eq('priority', priority)
  return applyBounds(next, dateBounds, { kind: 'none' })
}

function refuseOversized(query: { url: URL }) {
  if (urlExceedsLimit(query.url.toString())) throw new SearchTooBroadError()
}

function timeoutBody() {
  return {
    success: false,
    code: 'query_timeout',
    error: 'A consulta excedeu o tempo. Refine os filtros ou tente de novo.',
  }
}

function normalizeLead(lead: unknown): { id: number; name: string; phone?: string; email?: string } | null {
  const row = Array.isArray(lead) ? lead[0] : lead
  if (!row || typeof row !== 'object') return null
  const record = row as { id?: number; name?: string; phone?: string | null; email?: string | null }
  if (typeof record.id !== 'number' || typeof record.name !== 'string') return null
  return {
    id: record.id,
    name: record.name,
    phone: record.phone ?? undefined,
    email: record.email ?? undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use GET.' })
  }

  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TASK_SEARCH_LIMITS.handlerBudgetMs)
  const signal = controller.signal

  const companyId = queryText(req.query?.company_id)

  try {
  const authResult = await validateCaller(req, companyId)
  if (signal.aborted || handlerTimedOut(startedAt, Date.now())) {
    return res.status(503).json(timeoutBody())
  }
  if (!authResult.ok) {
    return res.status(authResult.status).json({ success: false, error: authResult.error })
  }

  const dateMode = parseDateMode(queryText(req.query?.date))
  const card = parseCard(queryText(req.query?.card))
  const windowMinutes = parseWindowMinutes(queryText(req.query?.window_minutes))
  if (typeof dateMode === 'object') return res.status(400).json({ success: false, error: dateMode.error })
  if (typeof card === 'object') return res.status(400).json({ success: false, error: card.error })
  if (typeof windowMinutes === 'object') return res.status(400).json({ success: false, error: windowMinutes.error })

  const priority = queryText(req.query?.priority)
  if (priority && !PRIORITIES.has(priority)) {
    return res.status(400).json({ success: false, error: 'priority inválida' })
  }
  const activityType = queryText(req.query?.activity_type).trim()
  if (activityType.length > 100) {
    return res.status(400).json({ success: false, error: 'activity_type inválido' })
  }

  const scope = resolveTaskScope(authResult.ctx.role)
  const assignee = effectiveAssigneeFilter(scope, authResult.ctx.userId, queryText(req.query?.user_id))
  if ('error' in assignee) return res.status(400).json({ success: false, error: assignee.error })

  const term = normalizeSearchTerm(queryText(req.query?.q))
  if (term && typeof term === 'object') {
    return res.status(422).json({
      success: false,
      code: 'search_too_broad',
      error: 'A busca ficou longa demais. Refine a busca.',
    })
  }

  const { supabase } = authResult.ctx
  const companyQuery = supabase
    .from('companies')
    .select('timezone')
    .eq('id', authResult.ctx.companyId)
    .abortSignal(signal)
  refuseOversized(companyQuery)
  const { data: company, error: companyError } = await companyQuery.maybeSingle()
  if (companyError) {
    return res.status(500).json({ success: false, error: 'Erro ao ler o fuso da empresa' })
  }
  const timezone = typeof company?.timezone === 'string' && isTimezone(company.timezone)
    ? company.timezone
    : 'America/Sao_Paulo'

  const asOf = new Date()
  const dateBounds = resolveDateBounds(dateMode, asOf, timezone, queryText(req.query?.from), queryText(req.query?.to))
  if ('error' in dateBounds) return res.status(400).json({ success: false, error: dateBounds.error })

  let searchOr: string | null = null
  if (typeof term === 'string') {
    try {
      searchOr = await resolveTitleOrLeadFilter(
        supabase,
        authResult.ctx.companyId,
        term,
        Date.now(),
        startedAt,
        signal,
      )
    } catch (error) {
      if (error instanceof QueryTimeoutError || signal.aborted) {
        return res.status(503).json(timeoutBody())
      }
      if (error instanceof SearchTooBroadError) {
        return res.status(422).json({ success: false, code: error.code, error: error.message })
      }
      console.error('[activities/board] busca:', error instanceof Error ? error.message : error)
      return res.status(500).json({ success: false, error: 'Erro ao buscar tarefas' })
    }
  }

  const assigneeOr = assignee.userId ? buildAssigneeOr(assignee.userId) : null
  const companyScopeId = authResult.ctx.companyId

  const countFor = async (countCard: TaskCard) => {
    const bounds = resolveCardBounds(countCard, asOf, timezone, windowMinutes)
    if ('error' in bounds) throw new Error(bounds.error)
    const query = applyBounds(applyCommon(
      supabase.from('lead_activities').select('id', { count: 'exact', head: true }),
      companyScopeId,
      assigneeOr,
      searchOr,
      activityType,
      priority,
      dateBounds,
    ), { kind: 'all' }, bounds).abortSignal(signal)
    if (signal.aborted || handlerTimedOut(startedAt, Date.now())) throw new QueryTimeoutError()
    refuseOversized(query)
    const { count, error } = await query
    if (signal.aborted) throw new QueryTimeoutError()
    if (error) throw new Error(error.message)
    return count ?? 0
  }

  try {
    const [open, overdue, dueToday, upcoming] = await Promise.all([
      countFor('open'),
      countFor('overdue'),
      countFor('due_today'),
      countFor('upcoming'),
    ])

    const listBounds = resolveCardBounds(card, asOf, timezone, windowMinutes)
    if ('error' in listBounds) return res.status(400).json({ success: false, error: listBounds.error })

    let listQuery = applyCommon(
      supabase.from('lead_activities').select(ACTIVITY_SELECT, { count: 'exact' }),
      companyScopeId,
      assigneeOr,
      searchOr,
      activityType,
      priority,
      dateBounds,
    )
    listQuery = applyBounds(listQuery, { kind: 'all' }, listBounds)
      .order('scheduled_datetime', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(0, TASK_SEARCH_LIMITS.listLimit - 1)
      .abortSignal(signal)
    if (signal.aborted || handlerTimedOut(startedAt, Date.now())) throw new QueryTimeoutError()
    refuseOversized(listQuery)
    const { data, count, error } = await listQuery

    if (signal.aborted) throw new QueryTimeoutError()
    if (error) {
      console.error('[activities/board] lista:', error.message)
      return res.status(500).json({ success: false, error: 'Erro ao listar tarefas' })
    }

    const listTotal = count ?? 0
    const activities = (data ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      lead: normalizeLead(row.lead),
    }))

    return res.status(200).json({
      success: true,
      as_of: asOf.toISOString(),
      timezone,
      scope,
      counts: { open, overdue, due_today: dueToday, upcoming },
      list_total: listTotal,
      truncated: listTotal > TASK_SEARCH_LIMITS.listLimit,
      activities,
    })
  } catch (error) {
    if (error instanceof QueryTimeoutError || signal.aborted || handlerTimedOut(startedAt, Date.now())) {
      return res.status(503).json(timeoutBody())
    }
    if (error instanceof SearchTooBroadError) {
      return res.status(422).json({ success: false, code: error.code, error: error.message })
    }
    console.error('[activities/board]', error instanceof Error ? error.message : error)
    return res.status(500).json({ success: false, error: 'Erro ao listar tarefas' })
  }
  } catch (error) {
    if (error instanceof QueryTimeoutError || signal.aborted || handlerTimedOut(startedAt, Date.now())) {
      return res.status(503).json(timeoutBody())
    }
    if (error instanceof SearchTooBroadError) {
      return res.status(422).json({ success: false, code: error.code, error: error.message })
    }
    console.error('[activities/board]', error instanceof Error ? error.message : error)
    return res.status(500).json({ success: false, error: 'Erro ao listar tarefas' })
  } finally {
    clearTimeout(timer)
  }
}
