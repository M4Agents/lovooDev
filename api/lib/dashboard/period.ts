import {
  addCalendarDays,
  companyWallFromInstant,
  shiftMonth,
  startOfCompanyDayUtc,
} from '../../../src/utils/companyTime.js'

export type PeriodKey =
  | 'today'
  | 'yesterday'
  | '7d'
  | '15d'
  | '30d'
  | 'month'
  | 'last_month'
  | '90d'
  | 'quarter'
  | 'year'
  | 'custom'

export interface ResolvedRange {
  period: PeriodKey
  start: string
  end: string
  endInclusive: boolean
  timeZone: string
}

export interface ResolvePeriodOptions {
  timeZone?: string | null
  now?: Date
}

export const DASHBOARD_TIME_ZONE_FALLBACK = 'America/Sao_Paulo'

const VALID_PERIODS = new Set<PeriodKey>([
  'today', 'yesterday', '7d', '15d', '30d',
  'month', 'last_month', '90d', 'quarter', 'year', 'custom',
])

const CALENDAR_PERIODS = new Set<PeriodKey>([
  'today', 'yesterday', 'month', 'last_month', 'quarter', 'year',
])

const ROLLING_DAYS: Partial<Record<PeriodKey, number>> = {
  '7d': 7,
  '15d': 15,
  '30d': 30,
  '90d': 90,
}

const MAX_RANGE_DAYS = 365

export class InvalidPeriodError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidPeriodError'
  }
}

export class CompanyTimeZoneReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompanyTimeZoneReadError'
  }
}

export function invalidPeriodMessage(error: unknown): string | null {
  return error instanceof InvalidPeriodError ? error.message : null
}

export function normalizeDashboardTimeZone(value: unknown): string {
  if (typeof value !== 'string') return DASHBOARD_TIME_ZONE_FALLBACK
  const trimmed = value.trim()
  if (!trimmed) return DASHBOARD_TIME_ZONE_FALLBACK
  try {
    Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(0)
    return trimmed
  } catch {
    return DASHBOARD_TIME_ZONE_FALLBACK
  }
}

type TimeZoneClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{
          data: { timezone?: string | null } | null
          error: { message: string } | null
        }>
      }
    }
  }
}

export async function readCompanyTimeZone(
  supabase: TimeZoneClient,
  companyId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('companies')
    .select('timezone')
    .eq('id', companyId)
    .maybeSingle()
  if (error) throw new CompanyTimeZoneReadError(error.message)
  return normalizeDashboardTimeZone(data?.timezone)
}

export async function resolveCompanyPeriod(
  supabase: TimeZoneClient,
  companyId: string,
  period: string,
  startDate?: string,
  endDate?: string,
  now?: Date,
): Promise<ResolvedRange> {
  const timeZone = await readCompanyTimeZone(supabase, companyId)
  return resolvePeriod(period, startDate, endDate, { timeZone, now })
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function civilStart(date: string, timeZone: string): Date {
  const instant = startOfCompanyDayUtc(date, timeZone)
  if (!instant) {
    throw new Error(`Não foi possível calcular o início de ${date} em ${timeZone}`)
  }
  return instant
}

function diffDays(start: Date, end: Date): number {
  return Math.ceil((end.getTime() - start.getTime()) / 86_400_000)
}

/**
 * Limites de calendário no fuso da empresa, convertidos para instantes UTC.
 * Períodos abertos terminam no instante da consulta, inclusive.
 * Períodos fechados usam início inclusivo e fim exclusivo.
 * Personalizado e janelas móveis preservam o instante recebido ou now menos N dias.
 */
export function resolvePeriod(
  period: string,
  startDate?: string,
  endDate?: string,
  options?: ResolvePeriodOptions,
): ResolvedRange {
  if (!VALID_PERIODS.has(period as PeriodKey)) {
    throw new InvalidPeriodError(
      `Período inválido: "${period}". Valores aceitos: ${[...VALID_PERIODS].join(', ')}`,
    )
  }

  const key = period as PeriodKey
  const timeZone = normalizeDashboardTimeZone(options?.timeZone)
  const now = options?.now ?? new Date()
  const wall = companyWallFromInstant(now, timeZone)
  const todayStart = civilStart(wall.date, timeZone)
  let start: Date
  let end: Date
  let endInclusive = true

  switch (key) {
    case 'today':
      start = todayStart
      end = now
      break
    case 'yesterday':
      start = civilStart(addCalendarDays(wall.date, -1), timeZone)
      end = todayStart
      endInclusive = false
      break
    case '7d':
    case '15d':
    case '30d':
    case '90d':
      start = new Date(now.getTime() - (ROLLING_DAYS[key] ?? 0) * 86_400_000)
      end = now
      break
    case 'month':
      start = civilStart(`${wall.date.slice(0, 8)}01`, timeZone)
      end = now
      break
    case 'last_month': {
      const thisMonth = `${wall.date.slice(0, 8)}01`
      start = civilStart(shiftMonth(thisMonth, -1), timeZone)
      end = civilStart(thisMonth, timeZone)
      endInclusive = false
      break
    }
    case 'quarter': {
      const month = Number(wall.date.slice(5, 7))
      const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1
      start = civilStart(`${wall.date.slice(0, 5)}${pad2(quarterMonth)}-01`, timeZone)
      end = now
      break
    }
    case 'year':
      start = civilStart(`${wall.date.slice(0, 4)}-01-01`, timeZone)
      end = now
      break
    case 'custom': {
      const custom = resolveCustomRange(startDate, endDate, timeZone)
      start = custom.start
      end = custom.end
      endInclusive = custom.endInclusive
      break
    }
  }

  if (start > end) {
    throw new InvalidPeriodError(
      `start (${start.toISOString()}) deve ser anterior a end (${end.toISOString()})`,
    )
  }

  const days = diffDays(start, end)
  if (days > MAX_RANGE_DAYS) {
    throw new InvalidPeriodError(
      `Intervalo de ${days} dias excede o máximo permitido de ${MAX_RANGE_DAYS} dias`,
    )
  }

  return {
    period: key,
    start: start.toISOString(),
    end: end.toISOString(),
    endInclusive,
    timeZone,
  }
}

/**
 * As RPCs do dashboard comparam com `<= p_end_date` e não serão alteradas.
 * Período fechado recebe o último microssegundo incluído, equivalente a `[início, fim)`.
 */
export function sqlInclusiveEnd(range: ResolvedRange): string {
  if (range.endInclusive) return range.end
  return exclusiveInstantToSqlInclusive(range.end)
}

const UTC_INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function exclusiveInstantToSqlInclusive(exclusiveIso: string): string {
  const match = UTC_INSTANT.exec(exclusiveIso)
  if (!match) {
    throw new Error(`Instante UTC inválido para limite inclusivo: "${exclusiveIso}"`)
  }
  const micros = Number((match[3] ?? '').padEnd(6, '0').slice(0, 6))
  if (micros > 0) {
    return `${match[1]}T${match[2]}.${String(micros - 1).padStart(6, '0')}Z`
  }
  const previous = previousUtcSecond(match[1], match[2])
  return `${previous.date}T${previous.time}.999999Z`
}

function previousUtcSecond(date: string, time: string): { date: string; time: string } {
  let [year, month, day] = date.split('-').map(Number)
  let [hour, minute, second] = time.split(':').map(Number)
  second -= 1
  if (second < 0) { second = 59; minute -= 1 }
  if (minute < 0) { minute = 59; hour -= 1 }
  if (hour < 0) {
    hour = 23
    day -= 1
  }
  if (day < 1) {
    month -= 1
    if (month < 1) { month = 12; year -= 1 }
    day = daysInMonth(year, month)
  }
  return {
    date: `${year}-${pad2(month)}-${pad2(day)}`,
    time: `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`,
  }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29
  return [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month]
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function resolveCustomRange(
  startDate: string | undefined,
  endDate: string | undefined,
  timeZone: string,
): { start: Date; end: Date; endInclusive: boolean } {
  if (!startDate || !endDate) {
    throw new InvalidPeriodError('period = "custom" exige start_date e end_date')
  }
  const startIsCivil = CIVIL_DATE.test(startDate)
  const endIsCivil = CIVIL_DATE.test(endDate)
  if (startIsCivil !== endIsCivil) {
    throw new InvalidPeriodError('start_date e end_date do período personalizado devem usar o mesmo formato')
  }
  if (startIsCivil && endIsCivil) {
    if (startDate > endDate) {
      throw new InvalidPeriodError(`start (${startDate}) deve ser anterior a end (${endDate})`)
    }
    return {
      start: civilStart(startDate, timeZone),
      end: civilStart(addCalendarDays(endDate, 1), timeZone),
      endInclusive: false,
    }
  }
  const start = new Date(startDate)
  const end = new Date(endDate)
  if (Number.isNaN(start.getTime())) {
    throw new InvalidPeriodError(`start_date inválida: "${startDate}"`)
  }
  if (Number.isNaN(end.getTime())) {
    throw new InvalidPeriodError(`end_date inválida: "${endDate}"`)
  }
  return { start, end, endInclusive: true }
}

export function upperBoundOp(range: { endInclusive?: boolean }): 'lte' | 'lt' {
  return range.endInclusive === false ? 'lt' : 'lte'
}

export function forecastDateBounds(range: ResolvedRange): { startDate: string; endDate: string } {
  const absoluteInstant = !CALENDAR_PERIODS.has(range.period) && range.endInclusive
  if (absoluteInstant) {
    return {
      startDate: range.start.slice(0, 10),
      endDate: range.end.slice(0, 10),
    }
  }
  const startDate = companyWallFromInstant(new Date(range.start), range.timeZone).date
  if (range.endInclusive) {
    return {
      startDate,
      endDate: companyWallFromInstant(new Date(range.end), range.timeZone).date,
    }
  }
  const exclusiveDay = companyWallFromInstant(new Date(range.end), range.timeZone).date
  return { startDate, endDate: addCalendarDays(exclusiveDay, -1) }
}
