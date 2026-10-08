// Períodos de comparação histórica do dashboard.
// O dia civil sai do fuso da empresa. O instante de referência é UTC.
// O backend reexporta este módulo para não divergir do frontend.

import { companyWallFromInstant } from '../utils/companyTime'

export const DASHBOARD_TIME_ZONE_FALLBACK = 'America/Sao_Paulo'

/** Base dos snapshots gerados com meia-noite UTC. Não é um nome IANA. */
export const UTC_SNAPSHOT_BASIS = 'utc'

export type ComparisonMode = 'wow' | 'mom'

export interface ComparisonPeriods {
  currentFrom: string
  currentTo: string
  previousFrom: string
  previousTo: string
  days: number
  timeZone: string
}

export function normalizeSnapshotTimeZone(value?: string | null): string {
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

export function companyCivilDate(instant: Date, timeZone?: string | null): string {
  return companyWallFromInstant(instant, normalizeSnapshotTimeZone(timeZone)).date
}

export function addCivilDays(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error(`Data civil inválida: "${date}"`)
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

export function civilDaysInclusive(from: string, to: string): string[] {
  if (from > to) return []
  const days: string[] = []
  let cursor = from
  while (cursor <= to) {
    days.push(cursor)
    cursor = addCivilDays(cursor, 1)
  }
  return days
}

function closedRanges(days: number, timeZone: string | null | undefined, now: Date): ComparisonPeriods {
  const zone = normalizeSnapshotTimeZone(timeZone)
  const yesterday = addCivilDays(companyCivilDate(now, zone), -1)
  return {
    currentTo: yesterday,
    currentFrom: addCivilDays(yesterday, -(days - 1)),
    previousTo: addCivilDays(yesterday, -days),
    previousFrom: addCivilDays(yesterday, -(days * 2 - 1)),
    days,
    timeZone: zone,
  }
}

/**
 * WoW: 7 dias civis fechados contra os 7 anteriores.
 * MoM: 30 dias civis fechados contra os 30 anteriores.
 * O fim é o último dia já encerrado no fuso da empresa.
 */
export function getComparisonPeriods(
  mode: ComparisonMode,
  timeZone?: string | null,
  now: Date = new Date(),
): ComparisonPeriods {
  return closedRanges(mode === 'wow' ? 7 : 30, timeZone, now)
}

/** Últimos N dias civis já encerrados, do mais antigo ao mais recente. */
export function getLastNDays(
  n: number,
  timeZone?: string | null,
  now: Date = new Date(),
): { fromDate: string; toDate: string; timeZone: string } {
  const range = closedRanges(Math.max(1, n), timeZone, now)
  return {
    fromDate: range.currentFrom,
    toDate: range.currentTo,
    timeZone: range.timeZone,
  }
}

export function getComparisonLabel(
  mode: ComparisonMode,
  timeZone?: string | null,
  now: Date = new Date(),
): string {
  const { previousFrom, previousTo } = getComparisonPeriods(mode, timeZone, now)
  const fmt = (value: string) => {
    const [, month, day] = value.split('-')
    return `${day}/${month}`
  }
  return `vs ${fmt(previousFrom)} – ${fmt(previousTo)}`
}

export interface SnapshotKey {
  companyId: string
  funnelId?: string | null
  userId?: string | null
  stageId?: string | null
  periodStart: string
  calendarBasis: string
}

/** A mesma chave só colide quando a base temporal também é a mesma. */
export function snapshotKeysCollide(left: SnapshotKey, right: SnapshotKey): boolean {
  return left.companyId === right.companyId
    && (left.funnelId ?? null) === (right.funnelId ?? null)
    && (left.userId ?? null) === (right.userId ?? null)
    && (left.stageId ?? null) === (right.stageId ?? null)
    && left.periodStart === right.periodStart
    && left.calendarBasis === right.calendarBasis
}

export interface DatedSnapshot {
  period_start: string
  calendar_basis: string
}

/**
 * Devolve as linhas da base pedida somente quando todos os dias civis
 * do intervalo existem nessa base. Lacuna não é preenchida com outra base.
 */
export function compatibleSnapshotWindow<T extends DatedSnapshot>(
  rows: T[],
  basis: string,
  from: string,
  to: string,
): { rows: T[]; compatible: boolean } {
  const sameBasis = rows.filter(row => row.calendar_basis === basis)
  const present = new Set(sameBasis.map(row => row.period_start.slice(0, 10)))
  const compatible = civilDaysInclusive(from, to).every(day => present.has(day))
  if (!compatible) return { rows: [], compatible: false }
  return {
    rows: sameBasis.filter(row => {
      const day = row.period_start.slice(0, 10)
      return day >= from && day <= to
    }),
    compatible: true,
  }
}

export interface DateCoverage {
  from: string
  to: string
  requiredDays: number
  presentDays: number
  missingDates: string[]
  complete: boolean
}

/** Cobertura de um intervalo civil. A quantidade sai das datas, não de um prazo fixo. */
export function coverageOfDates(present: Iterable<string>, from: string, to: string): DateCoverage {
  const have = new Set([...present].map(day => day.slice(0, 10)))
  const required = civilDaysInclusive(from, to)
  const missingDates = required.filter(day => !have.has(day))
  return {
    from,
    to,
    requiredDays: required.length,
    presentDays: required.length - missingDates.length,
    missingDates,
    complete: missingDates.length === 0 && required.length > 0,
  }
}

export interface ComparisonCoverage {
  status: 'ready' | 'insufficient'
  calendarBasis: string
  mode: ComparisonMode
  current: DateCoverage
  previous: DateCoverage
}

export function comparisonCoverage(
  present: Iterable<string>,
  periods: ComparisonPeriods,
  mode: ComparisonMode,
): ComparisonCoverage {
  const current = coverageOfDates(present, periods.currentFrom, periods.currentTo)
  const previous = coverageOfDates(present, periods.previousFrom, periods.previousTo)
  return {
    status: current.complete && previous.complete ? 'ready' : 'insufficient',
    calendarBasis: periods.timeZone,
    mode,
    current,
    previous,
  }
}

/** Texto do aviso. As datas são as janelas comparadas, não um prazo fixo. */
export function historyGapMessage(
  mode: ComparisonMode,
  timeZone?: string | null,
  now: Date = new Date(),
  coverage?: Pick<ComparisonCoverage, 'current' | 'previous'> | null,
): string {
  const periods = getComparisonPeriods(mode, timeZone, now)
  const currentFrom = coverage?.current.from ?? periods.currentFrom
  const currentTo = coverage?.current.to ?? periods.currentTo
  const previousFrom = coverage?.previous.from ?? periods.previousFrom
  const previousTo = coverage?.previous.to ?? periods.previousTo
  const dates = `A comparação usa ${currentFrom} a ${currentTo} contra ${previousFrom} a ${previousTo}.`
  if (!coverage) return `Histórico ainda insuficiente. ${dates}`
  const present = coverage.current.presentDays + coverage.previous.presentDays
  const required = coverage.current.requiredDays + coverage.previous.requiredDays
  return `Histórico ainda insuficiente. ${dates} Cobertura na base da empresa: ${present} de ${required} dias.`
}

/**
 * Dia gerado e vendedor sem linha: o fluxo daquele dia é zero.
 * Dia não gerado: o valor é desconhecido e não vira zero.
 */
export function flowOnGeneratedDay(
  dayGenerated: boolean,
  value: number | null | undefined,
): number | null {
  if (!dayGenerated) return null
  return value ?? 0
}

export class SnapshotCalendarGap extends Error {
  constructor() {
    super('Histórico sem cobertura completa no calendário da empresa')
    this.name = 'SnapshotCalendarGap'
  }
}

export function requireCompatibleSnapshot<T extends { meta?: { compatible?: boolean } }>(payload: T | null): T {
  if (payload?.meta?.compatible !== true) throw new SnapshotCalendarGap()
  return payload
}
