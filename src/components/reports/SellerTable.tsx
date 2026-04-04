import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronUp, ChevronDown } from 'lucide-react'
import type { SellerPerformance } from '../../types/reports'
import { ReportEmptyState } from './ReportEmptyState'
import { formatMoney } from '../../lib/formatMoney'

type SortKey = 'user_name' | 'won_count' | 'lost_count' | 'won_value' | 'conversion_rate' | 'avg_cycle_seconds'

interface SellerTableProps {
  data: SellerPerformance[]
  displayCurrency?: string
}

export const SellerTable: React.FC<SellerTableProps> = ({ data, displayCurrency = 'BRL' }) => {
  const { t } = useTranslation('reports')
  const fmtCurrency = (v: number) => formatMoney(v, displayCurrency)

  const fmtCycle = useCallback(
    (seconds: number | null) => {
      if (seconds == null || seconds <= 0) return t('duration.empty')
      const d = Math.round(Number(seconds) / 86400)
      if (d < 1) return t('duration.hours', { count: Math.round(Number(seconds) / 3600) })
      if (d < 30) return t('duration.days', { count: d })
      return t('duration.monthsApprox', { count: Math.round(d / 30) })
    },
    [t]
  )

  const [sortKey, setSortKey] = useState<SortKey>('won_value')
  const [sortAsc, setSortAsc] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'won' | 'lost'>('all')

  if (data.length === 0) return <ReportEmptyState />

  const filtered = data.filter((d) => {
    const matchSearch = d.user_name.toLowerCase().includes(search.toLowerCase())
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'won' && Number(d.won_count) > 0) ||
      (statusFilter === 'lost' && Number(d.lost_count) > 0)
    return matchSearch && matchStatus
  })

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
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder={t('sellerTable.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">{t('sellerTable.filterAll')}</option>
          <option value="won">{t('sellerTable.filterWithWon')}</option>
          <option value="lost">{t('sellerTable.filterWithLost')}</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left">
                <button type="button" className="flex items-center gap-1 font-medium text-gray-600" onClick={() => handleSort('user_name')}>
                  {t('sellerTable.columnSeller')} <SortIcon k="user_name" />
                </button>
              </th>
              <th className="px-4 py-3 text-right">
                <span className="font-medium text-gray-600">{t('sellerTable.columnOpen')}</span>
              </th>
              <th className="px-4 py-3 text-right">
                <button type="button" className="flex items-center gap-1 font-medium text-gray-600 ml-auto" onClick={() => handleSort('won_count')}>
                  {t('sellerTable.columnWon')} <SortIcon k="won_count" />
                </button>
              </th>
              <th className="px-4 py-3 text-right">
                <button type="button" className="flex items-center gap-1 font-medium text-gray-600 ml-auto" onClick={() => handleSort('lost_count')}>
                  {t('sellerTable.columnLost')} <SortIcon k="lost_count" />
                </button>
              </th>
              <th className="px-4 py-3 text-right">
                <button type="button" className="flex items-center gap-1 font-medium text-gray-600 ml-auto" onClick={() => handleSort('won_value')}>
                  {t('sellerTable.columnWonValue')} <SortIcon k="won_value" />
                </button>
              </th>
              <th className="px-4 py-3 text-right">
                <button type="button" className="flex items-center gap-1 font-medium text-gray-600 ml-auto" onClick={() => handleSort('conversion_rate')}>
                  {t('sellerTable.columnConversion')} <SortIcon k="conversion_rate" />
                </button>
              </th>
              <th className="px-4 py-3 text-right hidden md:table-cell">
                <button type="button" className="flex items-center gap-1 font-medium text-gray-600 ml-auto" onClick={() => handleSort('avg_cycle_seconds')}>
                  {t('sellerTable.columnAvgCycle')} <SortIcon k="avg_cycle_seconds" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.user_id} className="border-b border-gray-100 hover:bg-gray-50 last:border-0">
                <td className="px-4 py-3 font-medium text-gray-800">{row.user_name}</td>
                <td className="px-4 py-3 text-right text-gray-600">{Number(row.open_count)}</td>
                <td className="px-4 py-3 text-right">
                  <span className="font-semibold text-emerald-600">{Number(row.won_count)}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-red-500">{Number(row.lost_count)}</span>
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-800">
                  {fmtCurrency(Number(row.won_value))}
                </td>
                <td className="px-4 py-3 text-right">
                  {row.conversion_rate != null ? (
                    <span className={`font-medium ${Number(row.conversion_rate) >= 50 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {t('kpi.conversionPercent', { value: Number(row.conversion_rate).toFixed(1) })}
                    </span>
                  ) : (
                    <span className="text-gray-300">{t('duration.empty')}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-gray-500 hidden md:table-cell">
                  {fmtCycle(row.avg_cycle_seconds)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
