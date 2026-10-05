/**
 * Conversão entre o horário civil da empresa e UTC.
 * Não usa o fuso do navegador: a diferença de relógio sai do Intl no fuso informado.
 */

export interface CompanyWallClock {
  date: string
  time: string
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^(\d{2}):(\d{2})$/

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function partsOf(instant: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  if (parts.hour === '24') parts.hour = '00'
  return parts
}

export function companyWallFromInstant(instant: Date, timeZone: string): CompanyWallClock {
  const parts = partsOf(instant, timeZone)
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  }
}

export function activityInstant(activity: {
  scheduled_datetime?: string | Date | null
  scheduled_date: string
  scheduled_time: string
}): Date {
  if (activity.scheduled_datetime) {
    const parsed = new Date(activity.scheduled_datetime)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  const time = activity.scheduled_time.length === 5
    ? `${activity.scheduled_time}:00`
    : activity.scheduled_time
  return new Date(`${activity.scheduled_date}T${time}Z`)
}

export function activityCompanyDate(
  activity: {
    scheduled_datetime?: string | Date | null
    scheduled_date: string
    scheduled_time: string
  },
  timeZone: string
): string {
  return companyWallFromInstant(activityInstant(activity), timeZone).date
}

export function activityCompanyTime(
  activity: {
    scheduled_datetime?: string | Date | null
    scheduled_date: string
    scheduled_time: string
  },
  timeZone: string
): string {
  return companyWallFromInstant(activityInstant(activity), timeZone).time
}

function civilUtcMillis(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour, minute, 0)
}

export type CompanyWallToUtcResult =
  | { ok: true; instant: Date; utcDate: string; utcTime: string }
  | { ok: false; reason: 'invalid' | 'nonexistent' }

/**
 * Lê data e hora como horário da empresa.
 * Horário ambíguo usa a primeira ocorrência.
 * Horário inexistente devolve reason 'nonexistent'.
 */
export function companyWallToUtc(date: string, time: string, timeZone: string): CompanyWallToUtcResult {
  const dateMatch = DATE_RE.exec(date)
  const timeMatch = TIME_RE.exec(time.slice(0, 5))
  if (!dateMatch || !timeMatch) return { ok: false, reason: 'invalid' }

  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return { ok: false, reason: 'invalid' }
  }

  const desired = civilUtcMillis(year, month, day, hour, minute)
  let utc = desired

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const wall = companyWallFromInstant(new Date(utc), timeZone)
    const [gotYear, gotMonth, gotDay] = wall.date.split('-').map(Number)
    const [gotHour, gotMinute] = wall.time.split(':').map(Number)
    const got = civilUtcMillis(gotYear, gotMonth, gotDay, gotHour, gotMinute)
    const diff = desired - got
    if (diff === 0) break
    utc += diff
  }

  const resolved = companyWallFromInstant(new Date(utc), timeZone)
  if (resolved.date !== date || resolved.time !== time.slice(0, 5)) {
    return { ok: false, reason: 'nonexistent' }
  }

  let first = utc
  for (let step = 60_000; step <= 3 * 3_600_000; step += 60_000) {
    const earlier = utc - step
    const wall = companyWallFromInstant(new Date(earlier), timeZone)
    if (wall.date === date && wall.time === time.slice(0, 5)) first = earlier
  }

  const instant = new Date(first)
  const iso = instant.toISOString()
  return {
    ok: true,
    instant,
    utcDate: iso.slice(0, 10),
    utcTime: iso.slice(11, 19),
  }
}

export function addCalendarDays(date: string, days: number): string {
  const match = DATE_RE.exec(date)
  if (!match) return date
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
  return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`
}

export function shiftMonth(date: string, delta: number): string {
  const match = DATE_RE.exec(date)
  if (!match) return date
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1))
  return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-01`
}

export function daysInCivilMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function civilWeekday(date: string): number {
  const match = DATE_RE.exec(date)
  if (!match) return 0
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay()
}

export function companyWeekDates(anchorDate: string): string[] {
  const start = addCalendarDays(anchorDate, -civilWeekday(anchorDate))
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(start, index))
}

export function startOfCompanyDayUtc(date: string, timeZone: string): Date | null {
  for (let hour = 0; hour < 24; hour += 1) {
    const converted = companyWallToUtc(date, `${pad2(hour)}:00`, timeZone)
    if (converted.ok) return converted.instant
  }
  return null
}

export function companyMonthBounds(anchorDate: string): { start: string; end: string } {
  const match = DATE_RE.exec(anchorDate)
  if (!match) return { start: anchorDate, end: anchorDate }
  const year = Number(match[1])
  const month = Number(match[2])
  const start = `${match[1]}-${match[2]}-01`
  const end = `${match[1]}-${match[2]}-${pad2(daysInCivilMonth(year, month))}`
  return { start, end }
}
