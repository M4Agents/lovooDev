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

export interface DailySeriesParams {
  companyId: string
  funnelId:  string | null
  metrics:   string[]
  fromDate:  string
  toDate:    string
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
  const { companyId, funnelId, metrics, fromDate, toDate } = params

  const selectCols = ['period_start', 'snapshot_taken_at', ...metrics].join(', ')

  let query = svc
    .from('dashboard_snapshots')
    .select(selectCols)
    .eq('company_id', companyId)
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
  return (data ?? []) as any[]
}
