import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronUp, ChevronDown } from 'lucide-react'
import type { StageTimeMetric } from '../../types/reports'
import { ReportEmptyState } from './ReportEmptyState'

type SortKey = 'stage_name' | 'current_open_count' | 'avg_duration_seconds' | 'max_duration_seconds'

interface StageTimeTableProps {
  data: StageTimeMetric[]
}

export const StageTimeTable: React.FC<StageTimeTableProps> = ({ data }) => {
  const { t } = useTranslation('reports')

  const fmtDuration = useCallback(
    (seconds: number | null) => {
      if (seconds == null || seconds <= 0) return t('duration.empty')
      const s = Number(seconds)
      if (s < 3600) return t('duration.minutes', { count: Math.round(s / 60) })
      if (s < 86400) return t('duration.hoursDecimal', { value: (s / 3600).toFixed(1) })
      const d = Math.round(s / 86400)
      if (d < 30) return t('duration.days', { count: d })
      return t('duration.monthsApprox', { count: Math.round(d / 30) })
    },
    [t]
  )

  const [sortKey, setSortKey] = useState<SortKey>('avg_duration_seconds')
  const [sortAsc, setSortAsc] = useState(false)
  const [search, setSearch] = useState('')

  if (data.length === 0) return <ReportEmptyState />

  const validAvgs = data.filter((d) => d.avg_duration_seconds != null).map((d) => Number(d.avg_duration_seconds))
  const globalAvg = validAvgs.length > 0 ? validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length : 0

  const filtered = data.filter(
    (d) =>
      d.stage_name.toLowerCase().includes(search.toLowerCase()) ||
      d.funnel_name.toLowerCase().includes(search.toLowerCase())
  )

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? 0
    const bv = b[sortKey] ?? 0
    return sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
  })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((p) => !p)
    else { setSortKey(key); setSortAsc(false) }
  }

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k
      ? sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
      : <ChevronDown className="w-3 h-3 opacity-30" />

  return (
    <div className="space-y-4">
      <input
        type="text"
        placeholder={t('stageTable.searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-xs px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left">
                <button type="button" className="flex items-center gap-1 font-medium text-gray-600 hover:text-gray-900" onClick={() => handleSort('stage_name')}>
                  {t('stageTable.columnStage')} <SortIcon k="stage_name" />
                </button>
              </th>
              <th className="px-4 py-3 text-right">
                <button type="button" className="flex items-center gap-1 font-medium text-gray-600 hover:text-gray-900 ml-auto" onClick={() => handleSort('current_open_count')}>
                  {t('stageTable.columnOpen')} <SortIcon k="current_open_count" />
                </button>
              </th>
              <th className="px-4 py-3 text-right">
                <button type="button" className="flex items-center gap-1 font-medium text-gray-600 hover:text-gray-900 ml-auto" onClick={() => handleSort('avg_duration_seconds')}>
                  {t('stageTable.columnAvgTime')} <SortIcon k="avg_duration_seconds" />
                </button>
              </th>
              <th className="px-4 py-3 text-right hidden md:table-cell">
                <span className="font-medium text-gray-600">{t('stageTable.columnMedian')}</span>
              </th>
              <th className="px-4 py-3 text-right hidden md:table-cell">
                <button type="button" className="flex items-center gap-1 font-medium text-gray-600 hover:text-gray-900 ml-auto" onClick={() => handleSort('max_duration_seconds')}>
                  {t('stageTable.columnMax')} <SortIcon k="max_duration_seconds" />
                </button>
              </th>
              <th className="px-4 py-3 text-center">{t('stageTable.columnStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const isBottleneck =
                row.avg_duration_seconds != null &&
                Number(row.avg_duration_seconds) > globalAvg * 1.5 &&
                globalAvg > 0
              const color = row.stage_color || '#6366f1'
              return (
                <tr key={row.stage_id} className="border-b border-gray-100 hover:bg-gray-50 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <div>
                        <p className="font-medium text-gray-800">{row.stage_name}</p>
                        <p className="text-xs text-gray-400">{row.funnel_name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800">
                    {Number(row.current_open_count)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {fmtDuration(row.avg_duration_seconds)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 hidden md:table-cell">
                    {fmtDuration(row.median_duration_seconds)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 hidden md:table-cell">
                    {fmtDuration(row.max_duration_seconds)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isBottleneck ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        {t('stageTable.bottleneck')}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs">{t('duration.empty')}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
