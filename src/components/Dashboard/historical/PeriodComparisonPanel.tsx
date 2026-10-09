import { ComparisonModeToggle } from './ComparisonModeToggle'
import {
  comparisonWindowTitle,
  formatCivilDay,
  historyGapMessage,
  type ComparisonMode,
} from '../../../lib/snapshotPeriods'
import type { SnapshotComparisonCoverage, SnapshotComparisonData, SnapshotDelta } from '../../../types/dashboard'

interface Props {
  mode: ComparisonMode
  timeZone?: string | null
  coverage: SnapshotComparisonCoverage | null
  historyReady: boolean
  healthLoading: boolean
  comparisonLoading: boolean
  comparison: SnapshotComparisonData | null
  onModeChange: (mode: ComparisonMode) => void
}

interface MetricRow {
  key: string
  label: string
  higherIsBetter: boolean
  current: number
  previous: number
  delta: SnapshotDelta | undefined
  currentMoney?: number
  previousMoney?: number
  moneyDelta?: SnapshotDelta
}

const COUNT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const SIGNED_MONEY = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  signDisplay: 'exceptZero',
})
const SIGNED_PCT = new Intl.NumberFormat('pt-BR', {
  signDisplay: 'exceptZero',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

function rangeLabel(from: string, to: string): string {
  return `${formatCivilDay(from)} a ${formatCivilDay(to)}`
}

function signedCount(value: number): string {
  const rounded = Math.round(value)
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${COUNT.format(rounded)}`
}

function deltaClass(value: number, higherIsBetter: boolean): string {
  if (value === 0) return 'text-gray-500'
  const good = higherIsBetter ? value > 0 : value < 0
  return good ? 'text-emerald-600' : 'text-rose-600'
}

function rowsOf(comparison: SnapshotComparisonData): MetricRow[] {
  const current = comparison.current?.flow
  const previous = comparison.previous?.flow
  if (!current || !previous) return []
  const deltas = comparison.deltas ?? {}
  const count = (value: number | null | undefined) => Number(value ?? 0)
  return [
    {
      key: 'leads_created',
      label: 'Leads criados',
      higherIsBetter: true,
      current: count(current.leads_created),
      previous: count(previous.leads_created),
      delta: deltas.leads_created,
    },
    {
      key: 'conversations_attended',
      label: 'Conversas atendidas',
      higherIsBetter: true,
      current: count(current.conversations_attended),
      previous: count(previous.conversations_attended),
      delta: deltas.conversations_attended,
    },
    {
      key: 'won_count',
      label: 'Ganhos',
      higherIsBetter: true,
      current: count(current.won_count),
      previous: count(previous.won_count),
      delta: deltas.won_count,
      currentMoney: count(current.won_value),
      previousMoney: count(previous.won_value),
      moneyDelta: deltas.won_value,
    },
    {
      key: 'lost_count',
      label: 'Perdidos',
      higherIsBetter: false,
      current: count(current.lost_count),
      previous: count(previous.lost_count),
      delta: deltas.lost_count,
      currentMoney: count(current.lost_value),
      previousMoney: count(previous.lost_value),
      moneyDelta: deltas.lost_value,
    },
  ]
}

function Difference({
  delta,
  higherIsBetter,
  money = false,
}: {
  delta: SnapshotDelta | undefined
  higherIsBetter: boolean
  money?: boolean
}) {
  if (!delta) return <span className="text-gray-400">—</span>
  const absLabel = money ? SIGNED_MONEY.format(delta.abs) : signedCount(delta.abs)
  return (
    <span className={deltaClass(delta.abs, higherIsBetter)}>
      {absLabel} ({SIGNED_PCT.format(delta.pct)}%)
    </span>
  )
}

export function PeriodComparisonPanel({
  mode,
  timeZone,
  coverage,
  historyReady,
  healthLoading,
  comparisonLoading,
  comparison,
  onModeChange,
}: Props) {
  const title = mode === 'wow' ? 'Comparação semanal' : 'Comparação mensal'
  const windowTitle = comparisonWindowTitle(mode, timeZone)
  const currentLabel = comparison
    ? rangeLabel(comparison.params.current_from, comparison.params.current_to)
    : null
  const previousLabel = comparison
    ? rangeLabel(comparison.params.previous_from, comparison.params.previous_to)
    : null
  const metrics = comparison ? rowsOf(comparison) : []
  const showTable = historyReady && metrics.length > 0
  const showGap = !healthLoading && !comparisonLoading && !historyReady
  const showUnavailable = !healthLoading && !comparisonLoading && historyReady && metrics.length === 0

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{windowTitle}</p>
          <p className="text-xs text-gray-500">O filtro de período do dashboard não altera esta tabela.</p>
        </div>
        <ComparisonModeToggle
          mode={mode}
          timeZone={timeZone}
          onChange={onModeChange}
        />
      </div>

      {healthLoading || (historyReady && comparisonLoading && !comparison) ? (
        <p className="mt-3 text-xs text-gray-400">Carregando comparação…</p>
      ) : null}

      {showGap ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {historyGapMessage(mode, timeZone, new Date(), coverage
            ? {
                current: {
                  from: coverage.current_from,
                  to: coverage.current_to,
                  requiredDays: coverage.required_days,
                  presentDays: coverage.present_days,
                  missingDates: [],
                  complete: coverage.complete,
                },
                previous: {
                  from: coverage.previous_from,
                  to: coverage.previous_to,
                  requiredDays: 0,
                  presentDays: 0,
                  missingDates: [],
                  complete: coverage.complete,
                },
              }
            : null)}
        </p>
      ) : null}

      {showUnavailable ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Não foi possível carregar a comparação desta janela.
        </p>
      ) : null}

      {showTable && currentLabel && previousLabel ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="pb-2 pr-3 font-medium">Métrica</th>
                <th className="pb-2 pr-3 font-medium text-right">{currentLabel}</th>
                <th className="pb-2 pr-3 font-medium text-right">{previousLabel}</th>
                <th className="pb-2 font-medium text-right">Diferença</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {metrics.map(row => (
                <tr key={row.key}>
                  <th className="py-2.5 pr-3 text-left font-medium text-gray-700">{row.label}</th>
                  <td className="py-2.5 pr-3 text-right text-gray-800">
                    {COUNT.format(row.current)}
                    {row.currentMoney != null ? (
                      <span className="block text-[11px] text-gray-500">{MONEY.format(row.currentMoney)}</span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-gray-800">
                    {COUNT.format(row.previous)}
                    {row.previousMoney != null ? (
                      <span className="block text-[11px] text-gray-500">{MONEY.format(row.previousMoney)}</span>
                    ) : null}
                  </td>
                  <td className="py-2.5 text-right text-xs font-medium">
                    <Difference delta={row.delta} higherIsBetter={row.higherIsBetter} />
                    {row.moneyDelta ? (
                      <span className="block mt-0.5">
                        <Difference delta={row.moneyDelta} higherIsBetter={row.higherIsBetter} money />
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
