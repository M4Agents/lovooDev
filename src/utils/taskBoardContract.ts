import { addCalendarDays, companyWallFromInstant, startOfCompanyDayUtc } from './companyTime.js'

/**
 * Limites da busca.
 * - 100 ids e 2 páginas: a segunda página só detecta o 101º lead e não entra na consulta.
 * - 6000 caracteres continua como teto do filtro, antes de montar a URL.
 * - 8192 bytes é o teto da URL inteira já codificada (caminho, select, filtros e ordenação).
 *   O valor acompanha o buffer comum de 8 KB de gateways. O painel não leu um teto
 *   customizado no projeto Supabase.
 * - 4000 ms continua só para achar os leads.
 * - 12000 ms cobre autenticação, fuso, leads, contagens e lista.
 *   A função declara maxDuration 15 em vercel.json; os 3 s restantes servem para
 *   abortar e responder. O padrão da plataforma sem essa chave não foi lido no painel da Vercel.
 * - 80 caracteres: o termo literal não estoura o filtro sozinho.
 */
export const TASK_SEARCH_LIMITS = {
  maxLeadIds: 100,
  pageSize: 100,
  maxPages: 2,
  maxFilterChars: 6000,
  maxUrlBytes: 8192,
  maxSearchMs: 4000,
  handlerBudgetMs: 12000,
  functionMaxDurationSeconds: 15,
  maxTermChars: 80,
  listLimit: 200,
} as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const COMPANY_TASK_ROLES = ['admin', 'system_admin', 'super_admin'] as const

export type TaskScope = 'company' | 'own'
export type DateMode = 'all' | 'today' | 'tomorrow' | 'range' | 'undated'
export type TaskCard = 'open' | 'overdue' | 'due_today' | 'upcoming'
export type WindowMinutes = 15 | 30 | 60

export function resolveTaskScope(role: string): TaskScope {
  return (COMPANY_TASK_ROLES as readonly string[]).includes(role) ? 'company' : 'own'
}

export function effectiveAssigneeFilter(
  scope: TaskScope,
  authUserId: string,
  requestedUserId: string,
): { userId: string | null } | { error: string } {
  if (scope === 'own') return { userId: authUserId }
  const requested = requestedUserId.trim()
  if (!requested) return { userId: null }
  if (!UUID_RE.test(requested)) return { error: 'user_id inválido' }
  return { userId: requested }
}

export function effectiveAssignee(
  assignedTo: string | null | undefined,
  ownerUserId: string | null | undefined,
): string | null {
  if (assignedTo) return assignedTo
  return ownerUserId ?? null
}

export function buildAssigneeOr(userId: string): string {
  if (!UUID_RE.test(userId)) throw new Error('userId inválido')
  return `assigned_to.eq.${userId},and(assigned_to.is.null,owner_user_id.eq.${userId})`
}

export function normalizeSearchTerm(raw: string): string | null | { error: 'too_long' } {
  const term = raw.trim()
  if (!term) return null
  if (term.length > TASK_SEARCH_LIMITS.maxTermChars) return { error: 'too_long' }
  return term
}

export function escapeIlikeLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

export function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function buildTitleOrLeadFilter(
  term: string,
  leadIds: number[],
): { filter: string } | { error: 'filter_too_long' | 'invalid_lead_id' } {
  if (leadIds.some(id => !Number.isInteger(id) || id <= 0)) {
    return { error: 'invalid_lead_id' }
  }
  const pattern = quotePostgrestValue(`%${escapeIlikeLiteral(term)}%`)
  const title = `title.ilike.${pattern}`
  const filter = leadIds.length > 0
    ? `${title},lead_id.in.(${leadIds.join(',')})`
    : title
  if (filter.length > TASK_SEARCH_LIMITS.maxFilterChars) return { error: 'filter_too_long' }
  return { filter }
}

export function decideLeadIds(
  firstPage: number[],
  probe: number[] | null,
): { action: 'use'; ids: number[] } | { action: 'probe' } | { action: 'exceeded' } {
  if (firstPage.length > TASK_SEARCH_LIMITS.maxLeadIds) return { action: 'exceeded' }
  if (firstPage.length < TASK_SEARCH_LIMITS.pageSize) return { action: 'use', ids: firstPage }
  if (probe === null) return { action: 'probe' }
  if (probe.length > 0) return { action: 'exceeded' }
  return { action: 'use', ids: firstPage }
}

export function searchTimedOut(startedAt: number, now: number): boolean {
  return now - startedAt > TASK_SEARCH_LIMITS.maxSearchMs
}

export function handlerTimedOut(startedAt: number, now: number): boolean {
  return now - startedAt > TASK_SEARCH_LIMITS.handlerBudgetMs
}

export function urlByteLength(href: string): number {
  return new TextEncoder().encode(href).length
}

export function urlExceedsLimit(href: string): boolean {
  return urlByteLength(href) > TASK_SEARCH_LIMITS.maxUrlBytes
}

export function parseWindowMinutes(value: string): WindowMinutes | { error: string } {
  if (value === '' || value === '15') return 15
  if (value === '30') return 30
  if (value === '60') return 60
  return { error: 'window_minutes deve ser 15, 30 ou 60' }
}

export function parseDateMode(value: string): DateMode | { error: string } {
  if (value === '' || value === 'all') return 'all'
  if (value === 'today' || value === 'tomorrow' || value === 'range' || value === 'undated') return value
  return { error: 'date inválido' }
}

export function parseCard(value: string): TaskCard | { error: string } {
  if (value === '' || value === 'open') return 'open'
  if (value === 'overdue' || value === 'due_today' || value === 'upcoming') return value
  return { error: 'card inválido' }
}

export type DateBounds =
  | { kind: 'all' }
  | { kind: 'undated' }
  | { kind: 'range'; start: string; end: string }

export function resolveDateBounds(
  mode: DateMode,
  asOf: Date,
  timeZone: string,
  from: string,
  to: string,
): DateBounds | { error: string } {
  if (mode === 'all') return { kind: 'all' }
  if (mode === 'undated') return { kind: 'undated' }

  let startDate: string
  let endDate: string
  if (mode === 'today' || mode === 'tomorrow') {
    const today = companyWallFromInstant(asOf, timeZone).date
    startDate = mode === 'today' ? today : addCalendarDays(today, 1)
    endDate = startDate
  } else {
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) return { error: 'Informe De e Até no formato AAAA-MM-DD' }
    if (from > to) return { error: 'De não pode ser maior que Até' }
    startDate = from
    endDate = to
  }

  const start = startOfCompanyDayUtc(startDate, timeZone)
  const end = startOfCompanyDayUtc(addCalendarDays(endDate, 1), timeZone)
  if (!start || !end) return { error: 'Data inválida neste fuso' }
  return { kind: 'range', start: start.toISOString(), end: end.toISOString() }
}

export type CardBounds =
  | { kind: 'none' }
  | { kind: 'before'; end: string }
  | { kind: 'between'; start: string; end: string }

export function resolveCardBounds(
  card: TaskCard,
  asOf: Date,
  timeZone: string,
  windowMinutes: WindowMinutes,
): CardBounds | { error: string } {
  if (card === 'open') return { kind: 'none' }
  if (card === 'overdue') return { kind: 'before', end: asOf.toISOString() }

  if (card === 'upcoming') {
    const end = new Date(asOf.getTime() + windowMinutes * 60_000)
    return { kind: 'between', start: asOf.toISOString(), end: end.toISOString() }
  }

  const today = companyWallFromInstant(asOf, timeZone).date
  const tomorrowStart = startOfCompanyDayUtc(addCalendarDays(today, 1), timeZone)
  if (!tomorrowStart) return { error: 'Não foi possível calcular o fim de hoje' }
  return { kind: 'between', start: asOf.toISOString(), end: tomorrowStart.toISOString() }
}

export type TaskDeadlineTone = 'overdue' | 'due' | 'on_time' | 'undated'

const DEADLINE_LABEL: Record<TaskDeadlineTone, string> = {
  overdue: 'Atraso',
  due: 'A vencer',
  on_time: 'Dentro do prazo',
  undated: 'Sem data',
}

export function taskDeadlineLabel(tone: TaskDeadlineTone): string {
  return DEADLINE_LABEL[tone]
}

export function taskDeadlineTone(
  scheduledDatetime: string | null,
  asOfIso: string,
  timeZone: string,
  windowMinutes: WindowMinutes,
): TaskDeadlineTone {
  if (!scheduledDatetime) return 'undated'
  const instant = new Date(scheduledDatetime)
  const asOf = new Date(asOfIso)
  if (Number.isNaN(instant.getTime()) || Number.isNaN(asOf.getTime())) return 'undated'
  if (instant < asOf) return 'overdue'
  const windowEnd = asOf.getTime() + windowMinutes * 60_000
  if (instant.getTime() < windowEnd) return 'due'
  const today = companyWallFromInstant(asOf, timeZone).date
  const tomorrowStart = startOfCompanyDayUtc(addCalendarDays(today, 1), timeZone)
  if (tomorrowStart && instant < tomorrowStart) return 'due'
  return 'on_time'
}

export function compareTasks(
  a: { id: string; scheduled_datetime: string | null },
  b: { id: string; scheduled_datetime: string | null },
): number {
  if (a.scheduled_datetime === b.scheduled_datetime) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  if (a.scheduled_datetime === null) return 1
  if (b.scheduled_datetime === null) return -1
  return a.scheduled_datetime < b.scheduled_datetime ? -1 : 1
}

export function listPresentation(total: number): { shown: number; truncated: boolean } {
  const shown = Math.min(Math.max(total, 0), TASK_SEARCH_LIMITS.listLimit)
  return { shown, truncated: total > TASK_SEARCH_LIMITS.listLimit }
}

export const COUNT_CARDS: TaskCard[] = ['open', 'overdue', 'due_today', 'upcoming']

export function shouldPoll(active: boolean, visible: boolean, inFlight: boolean): boolean {
  return active && visible && !inFlight
}

export function isStaleResponse(requestId: number, currentId: number): boolean {
  return requestId !== currentId
}

export function windowStorageKey(userId: string, companyId: string): string {
  return `lovoo.taskBoard.windowMinutes:${userId}:${companyId}`
}

export function readWindowMinutes(raw: string | null): WindowMinutes {
  if (raw === '30' || raw === '60') return Number(raw) as WindowMinutes
  return 15
}
