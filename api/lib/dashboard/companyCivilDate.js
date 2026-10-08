export const DASHBOARD_TIME_ZONE_FALLBACK = 'America/Sao_Paulo'

export function normalizeDashboardTimeZone(value) {
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

export function companyCivilDate(instant, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = {}
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function addCivilDays(date, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date
  const utc = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + days,
  ))
  const year = utc.getUTCFullYear()
  const month = String(utc.getUTCMonth() + 1).padStart(2, '0')
  const day = String(utc.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Dias civis já encerrados no fuso da empresa, do mais recente ao mais antigo. */
export function completedCivilDates(timeZone, daysBack, now = new Date()) {
  const zone = normalizeDashboardTimeZone(timeZone)
  const today = companyCivilDate(now, zone)
  const dates = []
  for (let offset = 1; offset <= daysBack; offset += 1) {
    dates.push(addCivilDays(today, -offset))
  }
  return dates
}
