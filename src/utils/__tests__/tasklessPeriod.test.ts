import { describe, expect, it } from 'vitest'
import { resolveTasklessPeriodWindow } from '../tasklessPeriod'

const zone = 'America/Sao_Paulo'
const now = new Date('2026-10-13T18:00:00.000Z')

describe('resolveTasklessPeriodWindow', () => {
  it('últimos 30 dias recua o relógio da empresa e termina agora', () => {
    const window = resolveTasklessPeriodWindow({
      periodType: '30days',
      timeZone: zone,
      now,
    })
    expect(window?.from.toISOString()).toBe('2026-09-13T18:00:00.000Z')
    expect(window?.to.toISOString()).toBe('2026-10-13T18:00:00.000Z')
  })

  it('hoje e ontem usam o dia civil da empresa', () => {
    const today = resolveTasklessPeriodWindow({ periodType: 'today', timeZone: zone, now })
    expect(today?.from.toISOString()).toBe('2026-10-13T03:00:00.000Z')
    expect(today?.to.toISOString()).toBe('2026-10-14T03:00:00.000Z')

    const yesterday = resolveTasklessPeriodWindow({ periodType: 'yesterday', timeZone: zone, now })
    expect(yesterday?.from.toISOString()).toBe('2026-10-12T03:00:00.000Z')
    expect(yesterday?.to.toISOString()).toBe('2026-10-13T03:00:00.000Z')
  })

  it('mês, trimestre e ano seguem o calendário civil', () => {
    const month = resolveTasklessPeriodWindow({ periodType: 'this_month', timeZone: zone, now })
    expect(month?.from.toISOString()).toBe('2026-10-01T03:00:00.000Z')
    expect(month?.to.toISOString()).toBe('2026-11-01T03:00:00.000Z')

    const last = resolveTasklessPeriodWindow({ periodType: 'last_month', timeZone: zone, now })
    expect(last?.from.toISOString()).toBe('2026-09-01T03:00:00.000Z')
    expect(last?.to.toISOString()).toBe('2026-10-01T03:00:00.000Z')

    const quarter = resolveTasklessPeriodWindow({ periodType: 'this_quarter', timeZone: zone, now })
    expect(quarter?.from.toISOString()).toBe('2026-10-01T03:00:00.000Z')
    expect(quarter?.to.toISOString()).toBe('2027-01-01T03:00:00.000Z')

    const year = resolveTasklessPeriodWindow({ periodType: 'this_year', timeZone: zone, now })
    expect(year?.from.toISOString()).toBe('2026-01-01T03:00:00.000Z')
    expect(year?.to.toISOString()).toBe('2027-01-01T03:00:00.000Z')
  })

  it('período personalizado inclui o dia final e recusa intervalo invertido', () => {
    const custom = resolveTasklessPeriodWindow({
      periodType: 'custom',
      customStart: '2026-10-01',
      customEnd: '2026-10-13',
      timeZone: zone,
      now,
    })
    expect(custom?.from.toISOString()).toBe('2026-10-01T03:00:00.000Z')
    expect(custom?.to.toISOString()).toBe('2026-10-14T03:00:00.000Z')

    expect(resolveTasklessPeriodWindow({
      periodType: 'custom',
      customStart: '2026-10-13',
      customEnd: '2026-10-01',
      timeZone: zone,
      now,
    })).toBeNull()
    expect(resolveTasklessPeriodWindow({
      periodType: 'all',
      timeZone: zone,
      now,
    })).toBeNull()
  })
})
