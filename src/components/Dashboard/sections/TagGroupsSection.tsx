import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RefreshCw, Tags } from 'lucide-react'
import { TagGroupCompareChart } from '../charts/TagGroupCompareChart'
import { TagGroupsConfigModal } from './TagGroupsConfigModal'
import { useTagGroupMetrics } from '../../../hooks/dashboard/useTagGroupMetrics'
import type { DashboardFilters } from '../../../services/dashboardApi'
import type { TagGroupMetricRow } from '../../../types/dashboard'

interface Props {
  filters: DashboardFilters
  canConfigure: boolean
}

type MetricKey = 'leads' | 'opportunities' | 'conversion' | 'revenue'

function fmtPct(value: number | null): string {
  if (value === null) return '—'
  return `${value.toFixed(1)}%`
}

function fmtBrl(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value)
}

function chartValue(row: TagGroupMetricRow, metric: MetricKey): number | null {
  if (metric === 'leads') return row.lead_count
  if (metric === 'opportunities') return row.opps_generated
  if (metric === 'conversion') return row.conversion_rate_pct
  return row.total_won_value
}

export function TagGroupsSection({ filters, canConfigure }: Props) {
  const { t } = useTranslation('dashboard')
  const [metric, setMetric] = useState<MetricKey>('leads')
  const [showConfig, setShowConfig] = useState(false)
  const metrics = useTagGroupMetrics(filters, true)
  const tabs: { key: MetricKey; label: string }[] = [
    { key: 'leads', label: t('commercialTagGroups.leads') },
    { key: 'opportunities', label: t('commercialTagGroups.opportunities') },
    { key: 'conversion', label: t('commercialTagGroups.conversion') },
    { key: 'revenue', label: t('commercialTagGroups.revenue') },
  ]
  const comparable = metrics.rows
    .filter(row => row.status === 'ok')
    .sort((a, b) => a.position - b.position)
  const chartData = comparable.map(row => ({
    name: row.name,
    value: chartValue(row, metric),
  }))
  const formatChart = (value: number) => (
    metric === 'conversion' ? fmtPct(value) : metric === 'revenue' ? fmtBrl(value) : String(Math.round(value))
  )

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden h-full">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Tags className="w-4 h-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-gray-800">{t('commercialTagGroups.title')}</h3>
        </div>
        <div className="flex items-center gap-2">
          {canConfigure && (
            <button
              type="button"
              onClick={() => setShowConfig(true)}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              {t('commercialTagGroups.configure')}
            </button>
          )}
          <button type="button" onClick={metrics.refetch} className="text-gray-400 hover:text-gray-600">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="px-5 pt-3 space-y-1 text-xs text-gray-500">
        <p>{t('commercialTagGroups.cohort')}</p>
        <p>{t('commercialTagGroups.overlap')}</p>
        <p>{t('commercialTagGroups.saleDate')}</p>
        <p>{t('commercialTagGroups.responsible')}</p>
      </div>

      <div className="flex flex-wrap gap-1 px-5 pt-3">
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setMetric(tab.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              metric === tab.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {metrics.loading && <div className="h-32 bg-gray-50 rounded-lg animate-pulse" />}

        {!metrics.loading && metrics.error && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400" />
            <p className="text-xs text-gray-500">{metrics.error || t('commercialTagGroups.error')}</p>
            <button type="button" onClick={metrics.refetch} className="text-xs text-indigo-600 font-medium">
              {t('commercialTagGroups.retry')}
            </button>
          </div>
        )}

        {!metrics.loading && !metrics.error && metrics.groupsConfigured === 0 && (
          <p className="text-xs text-gray-400 text-center py-8">{t('commercialTagGroups.empty')}</p>
        )}

        {!metrics.loading && !metrics.error && metrics.groupsConfigured > 0 && (
          <>
            <TagGroupCompareChart
              data={chartData}
              valueLabel={tabs.find(tab => tab.key === metric)?.label ?? ''}
              formatValue={formatChart}
              height={Math.max(160, chartData.length * 36)}
            />
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs min-w-[420px]">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="pb-2 text-left">{t('commercialTagGroups.group')}</th>
                    <th className="pb-2 text-center">{t('commercialTagGroups.leads')}</th>
                    <th className="pb-2 text-center">{t('commercialTagGroups.opportunities')}</th>
                    <th className="pb-2 text-center">{t('commercialTagGroups.conversion')}</th>
                    <th className="pb-2 text-right">{t('commercialTagGroups.revenue')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {[...metrics.rows].sort((a, b) => a.position - b.position).map(row => (
                    <tr key={row.group_id}>
                      <td className="py-2 pr-2 font-medium text-gray-700">
                        <div>{row.name}</div>
                        {row.status === 'invalid' && (
                          <p className="text-[11px] font-normal text-amber-700">{t('commercialTagGroups.invalid')}</p>
                        )}
                        {row.status === 'ok' && row.lead_count === 0 && (
                          <p className="text-[11px] font-normal text-gray-400">{t('commercialTagGroups.noResults')}</p>
                        )}
                      </td>
                      {row.status === 'invalid' ? (
                        <td colSpan={4} className="py-2 text-right text-amber-700">{t('commercialTagGroups.unavailable')}</td>
                      ) : (
                        <>
                          <td className="py-2 text-center text-gray-600">{row.lead_count}</td>
                          <td className="py-2 text-center text-gray-600">{row.opps_generated}</td>
                          <td className="py-2 text-center text-gray-700">{fmtPct(row.conversion_rate_pct)}</td>
                          <td className="py-2 text-right text-gray-700">
                            {row.total_won_value != null && row.total_won_value > 0 ? fmtBrl(row.total_won_value) : '—'}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showConfig && (
        <TagGroupsConfigModal
          onClose={() => setShowConfig(false)}
          onSaved={() => metrics.refetch()}
        />
      )}
    </div>
  )
}
