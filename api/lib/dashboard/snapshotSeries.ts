// =====================================================
// snapshotSeries — helper centralizado de séries históricas diárias
//
// Encapsula a query em dashboard_snapshots para séries dia-a-dia.
// Evita que endpoints façam queries diretas e divergentes na tabela.
//
// Retorna array de rows ordenados por period_start ASC.
// Lança erro em caso de falha no banco (o caller é responsável pelo catch).
//
// Uso:
//   const rows = await fetchDailySeries(svc, {
//     companyId,
//     funnelId: null,
//     metrics:  ['sla_breached_count'],
//     fromDate: '2026-06-02',
//     toDate:   '2026-06-08',
//   })
// =====================================================

import { compatibleSnapshotWindow } from './snapshotPeriods.js'

/**
 * Dias em que a empresa tem snapshot geral na base pedida.
 * É a evidência de geração. A ausência de linha de vendedor não entra aqui.
 */
export async function fetchGeneratedCompanyDates(
  svc: any,
  companyId: string,
  calendarBasis: string,
  fromDate: string,
  toDate: string,
): Promise<string[]> {
  const { data, error } = await svc
    .from('dashboard_snapshots')
    .select('period_start')
    .eq('company_id', companyId)
    .eq('calendar_basis', calendarBasis)
    .is('funnel_id', null)
    .gte('period_start', fromDate)
    .lte('period_start', toDate)

  if (error) throw new Error(`dashboard_snapshots: ${error.message}`)
  return (data ?? []).map((row: { period_start: string }) => String(row.period_start).slice(0, 10))
}

export interface DailySeriesParams {
  companyId: string
  funnelId:  string | null
  metrics:   string[]
  fromDate:  string
  toDate:    string
  calendarBasis: string
}

/**
 * Busca série temporal diária de `dashboard_snapshots`.
 * Sempre inclui `period_start` e `snapshot_taken_at` na seleção.
 *
 * Lança erro se a query falhar — use dentro de try/catch ou withTiming.
 */
export async function fetchDailySeries(
  svc:    any,
  params: DailySeriesParams,
): Promise<any[]> {
  const { companyId, funnelId, metrics, fromDate, toDate, calendarBasis } = params

  const selectCols = ['period_start', 'snapshot_taken_at', 'calendar_basis', ...metrics].join(', ')

  let query = svc
    .from('dashboard_snapshots')
    .select(selectCols)
    .eq('company_id', companyId)
    .eq('calendar_basis', calendarBasis)
    .gte('period_start', fromDate)
    .lte('period_start', toDate)
    .order('period_start', { ascending: true })

  if (funnelId) {
    query = query.eq('funnel_id', funnelId)
  } else {
    query = query.is('funnel_id', null)
  }

  const { data, error } = await query
  if (error) throw new Error(`dashboard_snapshots: ${error.message}`)
  const rows = (data ?? []) as any[]
  const covered = compatibleSnapshotWindow(rows, calendarBasis, fromDate, toDate)
  return covered.compatible ? covered.rows : []
}
