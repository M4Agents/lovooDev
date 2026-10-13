import { validateCaller } from '../lib/activities/activityAuth.js'
import { effectiveAssigneeFilter, normalizeSearchTerm, resolveTaskScope } from '../../src/utils/taskBoardContract.js'
import { TASKLESS_MAX_OFFSET, TASKLESS_PAGE_SIZE } from '../../src/utils/tasklessLeadAccess.js'
import { DEFAULT_TASKLESS_PERIOD, isCivilDate, isTasklessPeriodType, resolveTasklessPeriodWindow } from '../../src/utils/tasklessPeriod.js'

function queryText(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function queryOffset(value: unknown): number | null {
  const text = queryText(value)
  if (!text) return 0
  if (!/^\d+$/.test(text)) return null
  const offset = Number(text)
  if (offset > TASKLESS_MAX_OFFSET) return null
  return offset
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
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use GET.' })
  }

  const offset = queryOffset(req.query?.offset)
  if (offset == null) {
    return res.status(400).json({ success: false, error: 'Página inválida' })
  }

  const authResult = await validateCaller(req, queryText(req.query?.company_id))
  if (!authResult.ok) {
    return res.status(authResult.status).json({ success: false, error: authResult.error })
  }

  const { supabase, companyId, userId, role } = authResult.ctx
  const scope = resolveTaskScope(role)
  const term = normalizeSearchTerm(queryText(req.query?.q))
  if (term && typeof term === 'object') {
    return res.status(422).json({ success: false, error: 'A busca ficou longa demais. Refine a busca.' })
  }
  const assignee = effectiveAssigneeFilter(scope, userId, queryText(req.query?.user_id))
  if ('error' in assignee) {
    return res.status(400).json({ success: false, error: assignee.error })
  }
  const responsibleUserId = assignee.userId
  const leadQuery = typeof term === 'string' ? term : null

  const [{ data: company, error: companyError }, { data: preference, error: preferenceError }] = await Promise.all([
    supabase.from('companies').select('timezone').eq('id', companyId).maybeSingle(),
    supabase
      .from('user_taskless_preferences')
      .select('period_type, custom_start, custom_end')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .maybeSingle(),
  ])
  if (companyError || preferenceError) {
    return res.status(500).json({ success: false, error: 'Erro ao ler a configuração da coluna' })
  }

  const timezone = typeof company?.timezone === 'string' && isTimezone(company.timezone)
    ? company.timezone
    : 'America/Sao_Paulo'

  const storedType = typeof preference?.period_type === 'string' ? preference.period_type : ''
  const periodType = isTasklessPeriodType(storedType) ? storedType : DEFAULT_TASKLESS_PERIOD
  const customStart = periodType === 'custom' && typeof preference?.custom_start === 'string' && isCivilDate(preference.custom_start.slice(0, 10))
    ? preference.custom_start.slice(0, 10)
    : null
  const customEnd = periodType === 'custom' && typeof preference?.custom_end === 'string' && isCivilDate(preference.custom_end.slice(0, 10))
    ? preference.custom_end.slice(0, 10)
    : null

  const window = resolveTasklessPeriodWindow({
    periodType,
    customStart,
    customEnd,
    timeZone: timezone,
    now: new Date(),
  })
  if (!window) {
    return res.status(422).json({ success: false, error: 'Período salvo é inválido. Abra Configurações e salve de novo.' })
  }

  const { data, error } = await supabase.rpc('list_taskless_lead_positions', {
    p_company_id: companyId,
    p_user_id: userId,
    p_responsible_user_id: responsibleUserId,
    p_from: window.from.toISOString(),
    p_to: window.to.toISOString(),
    p_limit: TASKLESS_PAGE_SIZE,
    p_offset: offset,
    p_query: leadQuery,
  })
  if (error) {
    console.error('[taskless-leads] list:', error.message)
    return res.status(500).json({ success: false, error: 'Erro ao carregar leads sem tarefas' })
  }

  const payload = (data ?? {}) as { configured?: boolean; total?: number; items?: unknown[] }
  const total = typeof payload.total === 'number' ? payload.total : 0
  const items = Array.isArray(payload.items) ? payload.items : []

  return res.status(200).json({
    success: true,
    scope,
    timezone,
    configured: payload.configured === true,
    period_type: periodType,
    custom_start: customStart,
    custom_end: customEnd,
    total,
    offset,
    truncated: offset + items.length < total,
    items,
  })
}
