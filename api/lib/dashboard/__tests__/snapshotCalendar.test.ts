import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sqlInclusiveEnd, resolvePeriod } from '../period'
import { companyCivilDate as cronCivilDate } from '../companyCivilDate.js'
import { companyRunFinalStatus, decideCompanyRunClaim } from '../companySnapshotRun.js'
import {
  UTC_SNAPSHOT_BASIS,
  addCivilDays,
  companyCivilDate,
  comparisonCoverage,
  compatibleSnapshotWindow,
  flowOnGeneratedDay,
  comparisonWindowTitle,
  getComparisonPeriods,
  getLastNDays,
  historyGapMessage,
  normalizeSnapshotTimeZone,
  snapshotKeysCollide,
} from '../../../../src/lib/snapshotPeriods'
import { resolveComparisonPeriods } from '../snapshotPeriods'

const LATE_BRT = new Date('2026-10-09T01:30:00.000Z')
const SP = 'America/Sao_Paulo'
const NY = 'America/New_York'

function days(from: string, to: string, basis: string, won = 1) {
  const rows = []
  let cursor = from
  while (cursor <= to) {
    rows.push({ period_start: cursor, calendar_basis: basis, won_value: won })
    cursor = addCivilDays(cursor, 1)
  }
  return rows
}

describe('comparações históricas no calendário da empresa', () => {
  it('entre 21h e meia-noite em Brasília, semana e mês terminam no dia civil anterior', () => {
    const wow = getComparisonPeriods('wow', SP, LATE_BRT)
    const mom = getComparisonPeriods('mom', SP, LATE_BRT)

    expect(wow.timeZone).toBe(SP)
    expect(wow.currentTo).toBe('2026-10-07')
    expect(wow.currentFrom).toBe('2026-10-01')
    expect(wow.previousTo).toBe('2026-09-30')
    expect(wow.previousFrom).toBe('2026-09-24')
    expect(wow.days).toBe(7)

    expect(mom.currentTo).toBe('2026-10-07')
    expect(mom.currentFrom).toBe('2026-09-08')
    expect(mom.previousTo).toBe('2026-09-07')
    expect(mom.previousFrom).toBe('2026-08-09')
    expect(mom.days).toBe(30)

    const utcYesterday = '2026-10-08'
    expect(wow.currentTo).not.toBe(utcYesterday)
    expect(mom.currentTo).not.toBe(utcYesterday)
  })

  it('depois da meia-noite civil, a semana fecha no dia que acabou de terminar', () => {
    const now = new Date('2026-10-09T04:00:00.000Z')
    const wow = getComparisonPeriods('wow', SP, now)
    expect(wow.currentTo).toBe('2026-10-08')
    expect(wow.currentFrom).toBe('2026-10-02')
    expect(comparisonWindowTitle('wow', SP, now)).toBe(
      '02/10 a 08/10 contra 25/09 a 01/10. Não inclui hoje.',
    )
    expect(comparisonWindowTitle('mom', SP, now)).toBe(
      '09/09 a 08/10 contra 10/08 a 08/09. Não inclui hoje.',
    )
    expect(getLastNDays(7, SP, new Date('2026-10-09T04:00:00.000Z'))).toMatchObject({
      fromDate: '2026-10-02',
      toDate: '2026-10-08',
    })
  })

  it('usa outro fuso válido e o fallback quando o fuso é inválido', () => {
    const tokyo = getComparisonPeriods('wow', 'Asia/Tokyo', LATE_BRT)
    expect(tokyo.timeZone).toBe('Asia/Tokyo')
    expect(tokyo.currentTo).toBe('2026-10-08')
    expect(normalizeSnapshotTimeZone('Mars/Olympus')).toBe(SP)
    expect(getComparisonPeriods('wow', 'Mars/Olympus', LATE_BRT)).toEqual(
      getComparisonPeriods('wow', SP, LATE_BRT),
    )
    expect(companyCivilDate(LATE_BRT, 'Asia/Tokyo')).toBe(cronCivilDate(LATE_BRT, 'Asia/Tokyo'))
  })

  it('na virada do horário de verão, Nova York e Brasília escolhem dias diferentes', () => {
    const instant = new Date('2026-11-02T03:30:00.000Z')
    expect(companyCivilDate(instant, NY)).toBe('2026-11-01')
    expect(companyCivilDate(instant, SP)).toBe('2026-11-02')
    expect(getComparisonPeriods('wow', NY, instant).currentTo).toBe('2026-10-31')
    expect(getComparisonPeriods('mom', SP, instant).currentTo).toBe('2026-11-01')
  })

  it('mantém o mesmo cálculo no frontend e no backend', () => {
    expect(resolveComparisonPeriods('mom', NY, LATE_BRT)).toEqual(
      getComparisonPeriods('mom', NY, LATE_BRT),
    )
  })
})

describe('transição entre snapshot UTC e snapshot da empresa', () => {
  const wow = getComparisonPeriods('wow', SP, new Date('2026-10-09T04:00:00.000Z'))

  it('não soma dias UTC com dias da empresa quando a janela está incompleta', () => {
    const utcRows = days(wow.previousFrom, wow.currentTo, UTC_SNAPSHOT_BASIS, 10)
    const companyRows = days(wow.currentFrom, '2026-10-05', SP, 3)
    const covered = compatibleSnapshotWindow(
      [...utcRows, ...companyRows],
      SP,
      wow.previousFrom,
      wow.currentTo,
    )

    expect(covered.compatible).toBe(false)
    expect(covered.rows).toEqual([])
    expect(utcRows.reduce((sum, row) => sum + row.won_value, 0)).toBeGreaterThan(0)
  })

  it('aceita a janela somente quando todos os dias existem na base pedida', () => {
    const companyRows = days(wow.previousFrom, wow.currentTo, SP, 4)
    const utcRows = days(wow.previousFrom, wow.currentTo, UTC_SNAPSHOT_BASIS, 9)
    const covered = compatibleSnapshotWindow(
      [...utcRows, ...companyRows],
      SP,
      wow.previousFrom,
      wow.currentTo,
    )

    expect(covered.compatible).toBe(true)
    expect(covered.rows.every(row => row.calendar_basis === SP)).toBe(true)
    expect(covered.rows.reduce((sum, row) => sum + row.won_value, 0)).toBe(companyRows.length * 4)
  })

  it('não reutiliza o histórico quando a empresa muda de fuso', () => {
    const previous = days(wow.previousFrom, wow.currentTo, SP, 2)
    const covered = compatibleSnapshotWindow(previous, NY, wow.previousFrom, wow.currentTo)
    expect(covered.compatible).toBe(false)
    expect(covered.rows).toEqual([])
  })

  it('não colide o upsert de bases diferentes e colide a mesma base', () => {
    const utc = {
      companyId: 'company',
      funnelId: null,
      periodStart: '2026-10-08',
      calendarBasis: UTC_SNAPSHOT_BASIS,
    }
    const company = { ...utc, calendarBasis: SP }
    const repeat = { ...company }

    expect(snapshotKeysCollide(utc, company)).toBe(false)
    expect(snapshotKeysCollide(company, repeat)).toBe(true)
    expect(snapshotKeysCollide(
      { ...company, userId: 'seller-a' },
      { ...company, userId: 'seller-b' },
    )).toBe(false)
  })
})

describe('precisão do limite até o parâmetro SQL', () => {
  it('envia o último microssegundo como texto, sem passar por Date', () => {
    const range = resolvePeriod('yesterday', undefined, undefined, { timeZone: SP, now: LATE_BRT })
    const parameter = sqlInclusiveEnd(range)

    expect(range.end).toBe('2026-10-08T03:00:00.000Z')
    expect(parameter).toBe('2026-10-08T02:59:59.999999Z')
    expect(new Date(parameter).toISOString()).toBe('2026-10-08T02:59:59.999Z')
    expect(new Date(parameter).toISOString()).not.toBe(parameter)
  })
})

describe('migration da base temporal', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20261008195506_dashboard_company_calendar_remainder.sql'),
    'utf8',
  )
  const functions = [...sql.matchAll(/CREATE OR REPLACE FUNCTION (?:public\.)?(\w+)/g)].map(match => match[1])

  it('separa as funções novas e mantém a agregação publicada só na base utc', () => {
    expect(functions.sort()).toEqual([
      'aggregate_snapshot_company_period',
      'aggregate_snapshot_period',
      'generate_dashboard_company_daily_snapshot',
      'get_dashboard_forecast_company',
      'get_snapshot_health_score',
    ])
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION (?:public\.)?get_dashboard_trends/)
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION (?:public\.)?get_dashboard_activation/)
    const revoked = sql.split('\n').filter(line => line.startsWith('REVOKE'))
    const granted = sql.split('\n').filter(line => line.startsWith('GRANT'))
    expect(revoked.some(line => line.includes('get_snapshot_health_score(uuid, date) FROM anon'))).toBe(true)
    expect(revoked.some(line => line.includes('get_snapshot_health_score(uuid, date) FROM authenticated'))).toBe(true)
    expect(granted.some(line => line.includes('get_snapshot_health_score(uuid, date) TO service_role'))).toBe(true)
    expect(revoked.some(line => line.includes('get_dashboard_forecast(') && !line.includes('_company'))).toBe(false)
    expect(revoked.some(line => line.includes('generate_dashboard_daily_snapshot(') && !line.includes('_company'))).toBe(false)
    expect(revoked.some(line => line.includes('aggregate_snapshot_period(') && !line.includes('_company'))).toBe(false)
    expect(sql).toContain('value * probability / 100.0')
    expect(sql).toContain('s.calendar_basis = v_timezone')
    expect(sql).toContain('UNIQUE NULLS NOT DISTINCT (company_id, funnel_id, period_start, calendar_basis)')
    expect(sql).toContain("'compatible',          v_compatible")
  })

  it('repete as propriedades vivas e não herda search_path no health score', () => {
    const health = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION get_snapshot_health_score'))
    const forecast = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION get_dashboard_forecast_company'),
      sql.indexOf('CREATE OR REPLACE FUNCTION generate_dashboard_company_daily_snapshot'),
    )
    const generate = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION generate_dashboard_company_daily_snapshot'),
      sql.indexOf('CREATE OR REPLACE FUNCTION public.aggregate_snapshot_company_period'),
    )
    const legacy = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.aggregate_snapshot_period('),
      sql.indexOf('CREATE OR REPLACE FUNCTION get_snapshot_health_score'),
    )

    for (const body of [forecast, generate]) {
      expect(body).toContain('VOLATILE')
      expect(body).toContain('PARALLEL UNSAFE')
      expect(body).toContain('SECURITY INVOKER')
      expect(body).toContain("SET search_path TO 'public'")
    }
    expect(generate).toContain('pg_advisory_xact_lock')
    expect(legacy).toContain('SECURITY DEFINER')
    expect(health).toContain('SECURITY INVOKER')
    expect(health).toContain('STABLE')
    expect(health).toContain("SET search_path TO 'public'")
    expect(health).toContain('public.dashboard_snapshots')
    expect(health).toContain('pg_catalog.pg_timezone_names')
    expect(health).toContain("calendar_basis = 'utc'")
    expect(health).toContain('calendar_basis = v_timezone')
    expect(health).toContain('comparison_coverage')
    expect(legacy).toContain("s.calendar_basis = 'utc'")
    expect(legacy).not.toContain('v_timezone')
    expect(generate).toContain('dia civil ainda não encerrado')
    expect(sql).toContain('idx_dash_snap_basis_null_funnel_date')
    expect(sql).toContain('idx_dash_seller_snap_basis_user_date')
    expect(sql).toContain('idx_dash_stage_snap_basis_date')
    expect(sql).not.toContain('ADD COLUMN')
    expect(sql).toContain('preflight divergente')
    expect(sql).toContain('assertion falhou')
    expect(sql).toContain("SET LOCAL lock_timeout = '5s'")
    expect(sql).toContain("SET LOCAL statement_timeout = '2min'")
  })
})

describe('rastreabilidade do apply parcial', () => {
  const migrations = resolve(process.cwd(), 'supabase/migrations')

  it('reproduz os statements gravados e não recoloca o pacote inteiro como pendente', () => {
    const first = readFileSync(resolve(migrations, '20261008193702_dashboard_company_calendar_dates.sql'))
    const second = readFileSync(resolve(migrations, '20261008193823_dashboard_company_calendar_basis.sql'))
    const remainder = readFileSync(resolve(migrations, '20261008195506_dashboard_company_calendar_remainder.sql'), 'utf8')

    expect(createHash('md5').update(first).digest('hex')).toBe('30162da59af93a0fb404e9022d27eea9')
    expect(first.length).toBe(99)
    expect(createHash('md5').update(second).digest('hex')).toBe('59fa772d6086bae9ed0c6f5e754bda48')
    expect(second.length).toBe(391)
    expect(second.toString('utf8')).toContain('ADD COLUMN IF NOT EXISTS calendar_basis')
    expect(remainder).not.toContain('ADD COLUMN')
    expect(remainder).not.toContain('placeholder to be replaced')
  })
})

describe('cobertura da comparação e do ranking', () => {
  const periods = getComparisonPeriods('wow', SP, LATE_BRT)

  it('não trata dia ausente como zero e zera o fluxo só no dia gerado', () => {
    expect(flowOnGeneratedDay(true, null)).toBe(0)
    expect(flowOnGeneratedDay(true, 12)).toBe(12)
    expect(flowOnGeneratedDay(false, null)).toBeNull()
    expect(flowOnGeneratedDay(false, 12)).toBeNull()
  })

  it('exige os dois intervalos e não completa a janela com a base UTC', () => {
    const present = days(periods.currentFrom, periods.currentTo, SP).map(row => row.period_start)
    const covered = comparisonCoverage(present, periods, 'wow')

    expect(covered.status).toBe('insufficient')
    expect(covered.previous.complete).toBe(false)
    expect(covered.current.complete).toBe(true)

    const mixed = [
      ...days(periods.previousFrom, periods.previousTo, 'utc'),
      ...days(periods.currentFrom, periods.currentTo, SP),
    ]
    expect(compatibleSnapshotWindow(mixed, SP, periods.previousFrom, periods.currentTo).compatible).toBe(false)

    const companyDates = [
      ...days(periods.previousFrom, periods.previousTo, SP).map(row => row.period_start),
      ...present,
    ]
    expect(comparisonCoverage(companyDates, periods, 'wow').status).toBe('ready')
  })

  it('informa as datas comparadas quando o histórico da empresa não fecha', () => {
    const message = historyGapMessage('wow', SP, LATE_BRT)

    expect(message.startsWith('Histórico ainda insuficiente.')).toBe(true)
    expect(message).toContain('2026-10-01 a 2026-10-07')
    expect(message).toContain('2026-09-24 a 2026-09-30')
    expect(message).not.toMatch(/14 dias|60 dias/)
  })
})

describe('posse da geração no calendário da empresa', () => {
  const now = Date.parse('2026-10-08T04:00:00.000Z')

  it('só conclui a execução quando toda a geração termina sem falha', () => {
    expect(companyRunFinalStatus(false, 0)).toBe('completed')
    expect(companyRunFinalStatus(true, 0)).toBe('partial')
    expect(companyRunFinalStatus(false, 1)).toBe('partial')
  })

  it('retoma falha, parcial e execução interrompida, e não entrega a mesma execução a duas invocações', () => {
    expect(decideCompanyRunClaim(null, now)).toBe('insert')
    expect(decideCompanyRunClaim({ status: 'completed', started_at: '2026-10-08T04:00:00.000Z' }, now)).toBe('skip_completed')
    expect(decideCompanyRunClaim({ status: 'partial', started_at: '2026-10-08T04:00:00.000Z' }, now)).toBe('retry')
    expect(decideCompanyRunClaim({ status: 'failed', started_at: '2026-10-08T04:00:00.000Z' }, now)).toBe('retry')
    expect(decideCompanyRunClaim({ status: 'running', started_at: '2026-10-08T03:55:00.000Z' }, now)).toBe('concurrent')
    expect(decideCompanyRunClaim({ status: 'running', started_at: '2026-10-08T03:40:00.000Z' }, now)).toBe('retry_stale')
  })
})

describe('transição entre SQL e código publicado', () => {
  const rollback = resolve(process.cwd(), 'supabase/rollback/dashboard-calendar-20261008')

  it('não usa a agregação antiga como recuperação e impede gravação sem a coluna', () => {
    const unsafe = readFileSync(resolve(rollback, '03_aggregate_snapshot_period.sql'), 'utf8')
    const safe = readFileSync(resolve(rollback, '05_aggregate_snapshot_period_mesma_base.sql'), 'utf8')
    const generator = readFileSync(resolve(rollback, '04_generate_dashboard_daily_snapshot_base_utc.sql'), 'utf8')
    const cron = readFileSync(resolve(process.cwd(), 'api/cron/generate-dashboard-snapshots.js'), 'utf8')

    expect(unsafe).toContain('NÃO APLICAR')
    expect(safe).toContain('s.calendar_basis = v_timezone')
    expect(generator).toContain("calendar_basis = 'utc'")
    expect(generator).toContain(", 'utc',")
    expect(cron).toContain('calendar_basis_ausente')
    expect(cron).toContain("process.env.DASHBOARD_SNAPSHOT_PRODUCER === 'lovoo-crm'")
    expect(cron).toContain('dashboard_company_snapshot_runs')
    expect(cron).toContain("companyWrites ? calendarBasis : 'utc'")
  })
})
