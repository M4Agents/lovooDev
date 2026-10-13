import {
  addCalendarDays,
  companyMonthBounds,
  companyWallFromInstant,
  companyWallToUtc,
  daysInCivilMonth,
  startOfCompanyDayUtc,
} from './companyTime'

export const TASKLESS_PERIOD_TYPES = [
  'today',
  'yesterday',
  '7days',
  '15days',
  '30days',
  'this_month',
  'last_month',
  '90days',
  'this_quarter',
  'this_year',
  'custom',
] as const

export type TasklessPeriodType = (typeof TASKLESS_PERIOD_TYPES)[number]

export const DEFAULT_TASKLESS_PERIOD: TasklessPeriodType = '30days'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const ROLLING_DAYS: Partial<Record<TasklessPeriodType, number>> = {
  '7days': 7,
  '15days': 15,
  '30days': 30,
  '90days': 90,
}

export interface TasklessPeriodWindow {
  from: Date
  to: Date
}

export function isTasklessPeriodType(value: string): value is TasklessPeriodType {
  return (TASKLESS_PERIOD_TYPES as readonly string[]).includes(value)
}

export function isCivilDate(value: string): boolean {
  const match = DATE_RE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) return false
  return day >= 1 && day <= daysInCivilMonth(year, month)
}

function dayStart(date: string, timeZone: string): Date | null {
  return startOfCompanyDayUtc(date, timeZone)
}

function rollingStart(wallDate: string, wallTime: string, days: number, timeZone: string): Date | null {
  const date = addCalendarDays(wallDate, -days)
  const exact = companyWallToUtc(date, wallTime, timeZone)
  if (exact.ok) return exact.instant
  return dayStart(date, timeZone)
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Janela [from, to) no fuso da empresa.
 * Presets rolantes (7, 15, 30, 90) usam o mesmo relógio de N dias atrás até agora.
 * Os demais presets e o período personalizado usam dias civis inteiros.
 */
export function resolveTasklessPeriodWindow(input: {
  periodType: string
  customStart?: string | null
  customEnd?: string | null
  timeZone: string
  now: Date
}): TasklessPeriodWindow | null {
  const { periodType, timeZone, now } = input
  if (!isTasklessPeriodType(periodType)) return null

  const wall = companyWallFromInstant(now, timeZone)

  if (periodType === 'custom') {
    const start = input.customStart ?? ''
    const end = input.customEnd ?? ''
    if (!isCivilDate(start) || !isCivilDate(end) || start > end) return null
    const from = dayStart(start, timeZone)
    const to = dayStart(addCalendarDays(end, 1), timeZone)
    if (!from || !to || from >= to) return null
    return { from, to }
  }

  if (periodType === 'today') {
    const from = dayStart(wall.date, timeZone)
    const to = dayStart(addCalendarDays(wall.date, 1), timeZone)
    if (!from || !to) return null
    return { from, to }
  }

  if (periodType === 'yesterday') {
    const day = addCalendarDays(wall.date, -1)
    const from = dayStart(day, timeZone)
    const to = dayStart(wall.date, timeZone)
    if (!from || !to) return null
    return { from, to }
  }

  const rolling = ROLLING_DAYS[periodType]
  if (rolling) {
    const from = rollingStart(wall.date, wall.time, rolling, timeZone)
    if (!from || from > now) return null
    return { from, to: now }
  }

  if (periodType === 'this_month' || periodType === 'last_month') {
    const anchor = periodType === 'this_month'
      ? wall.date
      : addCalendarDays(companyMonthBounds(wall.date).start, -1)
    const bounds = companyMonthBounds(anchor)
    const from = dayStart(bounds.start, timeZone)
    const to = dayStart(addCalendarDays(bounds.end, 1), timeZone)
    if (!from || !to) return null
    return { from, to }
  }

  if (periodType === 'this_quarter') {
    const year = Number(wall.date.slice(0, 4))
    const month = Number(wall.date.slice(5, 7))
    const startMonth = Math.floor((month - 1) / 3) * 3 + 1
    const endMonth = startMonth + 2
    const start = `${year}-${pad2(startMonth)}-01`
    const end = `${year}-${pad2(endMonth)}-${pad2(daysInCivilMonth(year, endMonth))}`
    const from = dayStart(start, timeZone)
    const to = dayStart(addCalendarDays(end, 1), timeZone)
    if (!from || !to) return null
    return { from, to }
  }

  const year = Number(wall.date.slice(0, 4))
  const from = dayStart(`${year}-01-01`, timeZone)
  const to = dayStart(`${year + 1}-01-01`, timeZone)
  if (!from || !to) return null
  return { from, to }
}
