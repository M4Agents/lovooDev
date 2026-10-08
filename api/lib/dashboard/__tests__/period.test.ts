import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { completedCivilDates } from '../companyCivilDate.js'
import { civilDateFromLocalDate, dateFromStoredCustom } from '../../../../src/lib/dashboard/customPeriod'
import {
  CompanyTimeZoneReadError,
  forecastDateBounds,
  normalizeDashboardTimeZone,
  readCompanyTimeZone,
  resolveCompanyPeriod,
  resolvePeriod,
  sqlInclusiveEnd,
  upperBoundOp,
} from '../period'

const AS_OF = new Date('2026-10-08T17:24:09.003Z')
const SP = 'America/Sao_Paulo'
const EXTRA_YESTERDAY = [
  '2026-10-08T00:58:14.043Z',
  '2026-10-08T01:30:24.582Z',
  '2026-10-08T01:36:56.554Z',
  '2026-10-08T01:50:33.056049Z',
  '2026-10-08T02:01:26.609121Z',
]

function at(period: string, now: Date, timeZone = SP, start?: string, end?: string) {
  return resolvePeriod(period, start, end, { timeZone, now })
}

function utcKey(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(iso)
  if (!match) throw new Error(iso)
  return `${match[1]}.${(match[2] ?? '').padEnd(6, '0').slice(0, 6)}`
}

function includedBySql(range: ReturnType<typeof resolvePeriod>, instant: string): boolean {
  const end = sqlInclusiveEnd(range)
  return utcKey(instant) >= utcKey(range.start) && utcKey(instant) <= utcKey(end)
}

describe('períodos de calendário no fuso da empresa', () => {
  it('abre Hoje na meia-noite de Brasília e fecha no instante da consulta', () => {
    const today = at('today', AS_OF)
    expect(today.timeZone).toBe(SP)
    expect(today.start).toBe('2026-10-08T03:00:00.000Z')
    expect(today.end).toBe(AS_OF.toISOString())
    expect(today.endInclusive).toBe(true)
    expect(sqlInclusiveEnd(today)).toBe(AS_OF.toISOString())
    expect(upperBoundOp(today)).toBe('lte')
  })

  it('antes da meia-noite em Brasília, Hoje ainda é o dia civil anterior', () => {
    const before = at('today', new Date('2026-10-08T02:59:59.000Z'))
    expect(before.start).toBe('2026-10-07T03:00:00.000Z')
    expect(includedBySql(before, '2026-10-08T00:58:14.043Z')).toBe(true)

    const after = at('today', new Date('2026-10-08T03:00:00.000Z'))
    expect(after.start).toBe('2026-10-08T03:00:00.000Z')
    expect(after.end).toBe('2026-10-08T03:00:00.000Z')
    expect(includedBySql(after, '2026-10-08T03:00:00.000Z')).toBe(true)
    expect(includedBySql(after, '2026-10-08T00:58:14.043Z')).toBe(false)
  })

  it('deixa os cinco leads da véspera fora de Hoje e dentro de Ontem', () => {
    const today = at('today', AS_OF)
    const yesterday = at('yesterday', AS_OF)
    expect(yesterday.start).toBe('2026-10-07T03:00:00.000Z')
    expect(yesterday.end).toBe(today.start)
    expect(yesterday.endInclusive).toBe(false)
    expect(sqlInclusiveEnd(yesterday)).toBe('2026-10-08T02:59:59.999999Z')
    expect(upperBoundOp(yesterday)).toBe('lt')

    for (const instant of EXTRA_YESTERDAY) {
      expect(includedBySql(today, instant)).toBe(false)
      expect(includedBySql(yesterday, instant)).toBe(true)
    }

    expect(includedBySql(yesterday, today.start)).toBe(false)
    expect(includedBySql(today, today.start)).toBe(true)
  })

  it('não sobrepõe mês, trimestre e ano nas viradas civis', () => {
    const monthTurn = new Date('2026-10-01T04:00:00.000Z')
    const month = at('month', monthTurn)
    const lastMonth = at('last_month', monthTurn)
    expect(month.start).toBe('2026-10-01T03:00:00.000Z')
    expect(lastMonth.end).toBe(month.start)
    expect(includedBySql(month, '2026-10-01T01:00:00.000Z')).toBe(false)
    expect(includedBySql(lastMonth, '2026-10-01T01:00:00.000Z')).toBe(true)
    expect(includedBySql(lastMonth, month.start)).toBe(false)
    expect(includedBySql(month, month.start)).toBe(true)

    const stillSeptember = at('month', new Date('2026-10-01T02:30:00.000Z'))
    expect(stillSeptember.start).toBe('2026-09-01T03:00:00.000Z')

    const quarter = at('quarter', monthTurn)
    expect(quarter.start).toBe('2026-10-01T03:00:00.000Z')
    expect(includedBySql(quarter, '2026-10-01T02:00:00.000Z')).toBe(false)
    const stillQ3 = at('quarter', new Date('2026-10-01T02:30:00.000Z'))
    expect(stillQ3.start).toBe('2026-07-01T03:00:00.000Z')

    const year = at('year', new Date('2026-01-01T04:00:00.000Z'))
    expect(year.start).toBe('2026-01-01T03:00:00.000Z')
    expect(includedBySql(year, '2026-01-01T02:00:00.000Z')).toBe(false)
    const stillPreviousYear = at('year', new Date('2026-01-01T02:30:00.000Z'))
    expect(stillPreviousYear.start).toBe('2025-01-01T03:00:00.000Z')
  })

  it('usa o fuso da empresa e cai para America/Sao_Paulo quando o valor é inválido', () => {
    const ny = at('today', AS_OF, 'America/New_York')
    expect(ny.start).toBe('2026-10-08T04:00:00.000Z')
    expect(ny.timeZone).toBe('America/New_York')
    expect(ny.start).not.toBe(at('today', AS_OF).start)

    for (const value of [null, '', '   ', 'Mars/Olympus', 3]) {
      expect(normalizeDashboardTimeZone(value)).toBe(SP)
      expect(at('today', AS_OF, normalizeDashboardTimeZone(value)).start).toBe('2026-10-08T03:00:00.000Z')
    }
    expect(normalizeDashboardTimeZone(' America/New_York ')).toBe('America/New_York')
  })

  it('preserva janelas móveis e o período personalizado', () => {
    const tokyo = at('7d', AS_OF, 'Asia/Tokyo')
    const saoPaulo = at('7d', AS_OF)
    const expectedStart = new Date(AS_OF.getTime() - 7 * 86_400_000).toISOString()
    expect(saoPaulo.start).toBe(expectedStart)
    expect(tokyo.start).toBe(expectedStart)
    expect(saoPaulo.end).toBe(AS_OF.toISOString())
    expect(tokyo.endInclusive).toBe(true)

    for (const key of ['15d', '30d', '90d'] as const) {
      const days = key === '15d' ? 15 : key === '30d' ? 30 : 90
      const range = at(key, AS_OF, 'Asia/Tokyo')
      expect(range.start).toBe(new Date(AS_OF.getTime() - days * 86_400_000).toISOString())
      expect(range.end).toBe(AS_OF.toISOString())
    }

    const custom = at('custom', AS_OF, 'Asia/Tokyo', '2026-10-08T15:00:00.000Z', '2026-10-08T18:00:00.000Z')
    const customSp = at('custom', AS_OF, SP, '2026-10-08T15:00:00.000Z', '2026-10-08T18:00:00.000Z')
    expect(custom.start).toBe('2026-10-08T15:00:00.000Z')
    expect(custom.end).toBe('2026-10-08T18:00:00.000Z')
    expect(customSp).toMatchObject({ start: custom.start, end: custom.end, endInclusive: true })

    const offset = at('custom', AS_OF, SP, '2026-10-08T12:00:00-03:00', '2026-10-08T15:00:00-03:00')
    expect(offset.start).toBe('2026-10-08T15:00:00.000Z')
    expect(offset.end).toBe('2026-10-08T18:00:00.000Z')

    const dateOnly = at('custom', AS_OF, SP, '2026-10-08', '2026-10-09')
    expect(dateOnly.start).toBe('2026-10-08T03:00:00.000Z')
    expect(dateOnly.end).toBe('2026-10-10T03:00:00.000Z')
    expect(dateOnly.endInclusive).toBe(false)
    expect(forecastDateBounds(dateOnly)).toEqual({ startDate: '2026-10-08', endDate: '2026-10-09' })
  })

  it('entrega o mesmo intervalo para os predicados do dashboard', () => {
    const today = at('today', AS_OF)
    const dates = forecastDateBounds(today)
    expect(dates).toEqual({ startDate: '2026-10-08', endDate: '2026-10-08' })

    const late = at('today', new Date('2026-10-09T01:30:00.000Z'))
    expect(forecastDateBounds(late)).toEqual({ startDate: '2026-10-08', endDate: '2026-10-08' })
    expect(late.start).toBe('2026-10-08T03:00:00.000Z')

    const yesterday = at('yesterday', AS_OF)
    expect(forecastDateBounds(yesterday)).toEqual({ startDate: '2026-10-07', endDate: '2026-10-07' })

    const shared = {
      start: today.start,
      end: sqlInclusiveEnd(today),
      op: upperBoundOp(today),
    }
    expect(shared).toEqual({
      start: '2026-10-08T03:00:00.000Z',
      end: AS_OF.toISOString(),
      op: 'lte',
    })
    expect(sqlInclusiveEnd(yesterday) < yesterday.end).toBe(true)
  })
})

describe('fuso lido da empresa autorizada', () => {
  function client(result: { data: { timezone?: string | null } | null; error: { message: string } | null }) {
    return {
      from: (table: string) => {
        expect(table).toBe('companies')
        return {
          select: (columns: string) => {
            expect(columns).toBe('timezone')
            return {
              eq: (column: string, value: string) => {
                expect(column).toBe('id')
                expect(value).toBe('company-1')
                return { maybeSingle: async () => result }
              },
            }
          },
        }
      },
    }
  }

  it('usa o timezone salvo e o fallback quando ele está vazio', async () => {
    const saved = await resolveCompanyPeriod(
      client({ data: { timezone: 'America/New_York' }, error: null }),
      'company-1',
      'today',
      undefined,
      undefined,
      AS_OF,
    )
    expect(saved.start).toBe('2026-10-08T04:00:00.000Z')

    const empty = await readCompanyTimeZone(
      client({ data: { timezone: null }, error: null }),
      'company-1',
    )
    expect(empty).toBe(SP)
  })

  it('falha quando a leitura do fuso falha', async () => {
    await expect(readCompanyTimeZone(
      client({ data: null, error: { message: 'timeout' } }),
      'company-1',
    )).rejects.toBeInstanceOf(CompanyTimeZoneReadError)
  })
})

describe('limites com precisão de microssegundo', () => {
  it('preserva o último microssegundo sem passar por Date', () => {
    const yesterday = at('yesterday', AS_OF)
    const inclusive = sqlInclusiveEnd(yesterday)
    expect(inclusive).toBe('2026-10-08T02:59:59.999999Z')
    expect(new Date(inclusive).toISOString()).toBe('2026-10-08T02:59:59.999Z')
    expect(inclusive.endsWith('.999999Z')).toBe(true)

    expect(includedBySql(yesterday, '2026-10-08T02:59:59.999999Z')).toBe(true)
    expect(includedBySql(yesterday, '2026-10-08T03:00:00.000000Z')).toBe(false)
    expect(includedBySql(at('today', AS_OF), '2026-10-08T03:00:00.000000Z')).toBe(true)

    expect(sqlInclusiveEnd({
      period: 'yesterday',
      start: '2026-10-07T03:00:00.000Z',
      end: '2026-10-08T03:00:00.000001Z',
      endInclusive: false,
      timeZone: SP,
    })).toBe('2026-10-08T03:00:00.000000Z')

    expect(sqlInclusiveEnd({
      period: 'yesterday',
      start: '2024-02-29T00:00:00.000Z',
      end: '2024-03-01T00:00:00.000Z',
      endInclusive: false,
      timeZone: SP,
    })).toBe('2024-02-29T23:59:59.999999Z')

    expect(sqlInclusiveEnd({
      period: 'yesterday',
      start: '2026-02-28T00:00:00.000Z',
      end: '2026-03-01T00:00:00.000Z',
      endInclusive: false,
      timeZone: SP,
    })).toBe('2026-02-28T23:59:59.999999Z')
  })
})

describe('fusos além de Brasília', () => {
  it('abre o dia em Tóquio e nas viradas de horário de verão de Nova York', () => {
    const tokyo = at('today', AS_OF, 'Asia/Tokyo')
    expect(tokyo.timeZone).toBe('Asia/Tokyo')
    expect(tokyo.start).toBe('2026-10-08T15:00:00.000Z')

    const spring = at('today', new Date('2026-03-08T15:00:00.000Z'), 'America/New_York')
    expect(spring.start).toBe('2026-03-08T05:00:00.000Z')

    const fallDay = at('yesterday', new Date('2026-11-02T15:00:00.000Z'), 'America/New_York')
    expect(fallDay.start).toBe('2026-11-01T04:00:00.000Z')
    expect(fallDay.end).toBe('2026-11-02T05:00:00.000Z')
    expect(sqlInclusiveEnd(fallDay)).toBe('2026-11-02T04:59:59.999999Z')
    expect(includedBySql(fallDay, '2026-11-02T04:59:59.999999Z')).toBe(true)
    expect(includedBySql(fallDay, '2026-11-02T05:00:00.000000Z')).toBe(false)
  })
})

describe('forecast entre 21h e meia-noite em Brasília', () => {
  it('mantém o fechamento das 22:30 no dia civil 8 de outubro', () => {
    const atNight = new Date('2026-10-09T01:30:00.000Z')
    const today = at('today', atNight)
    expect(today.start).toBe('2026-10-08T03:00:00.000Z')
    expect(forecastDateBounds(today)).toEqual({ startDate: '2026-10-08', endDate: '2026-10-08' })

    const custom = at('custom', atNight, SP, '2026-10-08', '2026-10-08')
    expect(includedBySql(custom, '2026-10-09T01:30:00.000Z')).toBe(true)
    expect(includedBySql(custom, '2026-10-09T03:00:00.000000Z')).toBe(false)
    expect(forecastDateBounds(custom)).toEqual({ startDate: '2026-10-08', endDate: '2026-10-08' })
  })
})

describe('datas civis do seletor e snapshots futuros', () => {
  it('envia o dia escolhido e o backend converte uma vez', () => {
    const start = new Date(2026, 9, 8, 0, 0, 0)
    const end = new Date(2026, 9, 8, 23, 59, 59)
    expect(civilDateFromLocalDate(start)).toBe('2026-10-08')
    expect(civilDateFromLocalDate(end)).toBe('2026-10-08')
    expect(civilDateFromLocalDate(dateFromStoredCustom('2026-10-08'))).toBe('2026-10-08')

    const range = at('custom', AS_OF, 'Asia/Tokyo', '2026-10-08', '2026-10-08')
    expect(range.start).toBe('2026-10-07T15:00:00.000Z')
    expect(range.end).toBe('2026-10-08T15:00:00.000Z')
    expect(range.endInclusive).toBe(false)
  })

  it('escolhe os dias já encerrados no fuso da empresa', () => {
    const late = new Date('2026-10-09T01:30:00.000Z')
    expect(completedCivilDates('America/Sao_Paulo', 3, late)).toEqual([
      '2026-10-07',
      '2026-10-06',
      '2026-10-05',
    ])

    const cronHour = new Date('2026-10-09T04:00:00.000Z')
    expect(completedCivilDates('America/Sao_Paulo', 1, cronHour)).toEqual(['2026-10-08'])
    expect(completedCivilDates('Pacific/Honolulu', 1, cronHour)).toEqual(['2026-10-07'])
    expect(completedCivilDates('Mars/Olympus', 1, cronHour)).toEqual(['2026-10-08'])
  })
})

describe('migration do calendário da empresa', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20261008195506_dashboard_company_calendar_remainder.sql'),
    'utf8',
  )

  it('classifica closed_at no fuso da empresa e preserva as fórmulas', () => {
    expect(sql).toContain('(o.closed_at AT TIME ZONE v_timezone)::date BETWEEN p_start_date AND p_end_date')
    expect(sql).not.toContain('o.closed_at::DATE')
    expect(sql).toContain('value * probability / 100.0')
    expect(sql).toContain("(p_date::timestamp AT TIME ZONE v_timezone)")
    expect(sql).toContain("((p_date + 1)::timestamp AT TIME ZONE v_timezone)")
    expect(sql).toContain("ELSE 'America/Sao_Paulo'")
  })
})
