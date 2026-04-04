import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  TrendingUp, TrendingDown, DollarSign, Target,
  Clock, AlertTriangle, BarChart2, Users, Timer,
} from 'lucide-react'
import { PeriodFilter } from '../components/PeriodFilter'
import { ReportFunnelSelector } from '../components/reports/ReportFunnelSelector'
import { KpiCard } from '../components/reports/KpiCard'
import { FunnelBarChart } from '../components/reports/FunnelBarChart'
import { StageTimeTable } from '../components/reports/StageTimeTable'
import { SellerTable } from '../components/reports/SellerTable'
import { KpiSkeleton, TableSkeleton, BarChartSkeleton } from '../components/reports/MetricSkeleton'
import { ReportEmptyState } from '../components/reports/ReportEmptyState'
import { useReports, ReportTab } from '../hooks/useReports'
import { useFunnelMetrics } from '../hooks/useFunnelMetrics'
import type { CycleTimeMetric } from '../types/reports'
import { useAuth } from '../contexts/AuthContext'
import { formatMoney } from '../lib/formatMoney'

function useFmtCycleSeconds() {
  const { t } = useTranslation('reports')
  return useCallback((seconds: number | null) => {
    if (seconds == null || seconds <= 0) return t('duration.empty')
    const d = Math.round(Number(seconds) / 86400)
    if (d < 1) return t('duration.hours', { count: Math.round(Number(seconds) / 3600) })
    if (d < 30) return t('duration.days', { count: d })
    return t('duration.monthsApprox', { count: Math.round(d / 30) })
  }, [t])
}

function OverviewTab({
  data, stageData, stalledDays, setStalledDays, loading, fmtCurrency, fmtCycle,
}: {
  data: ReturnType<typeof useFunnelMetrics>['metrics']['overview']
  stageData: ReturnType<typeof useFunnelMetrics>['metrics']['stageMetrics']
  stalledDays: number
  setStalledDays: (v: number) => void
  loading: boolean
  fmtCurrency: (v: number) => string
  fmtCycle: (seconds: number | null) => string
}) {
  const { t } = useTranslation('reports')

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)}
        </div>
        <BarChartSkeleton />
      </div>
    )
  }

  const o = data
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard
          label={t('kpi.openOpportunities')}
          value={o ? Number(o.open_count) : t('duration.empty')}
          icon={Target}
          iconColor="text-blue-500"
        />
        <KpiCard
          label={t('kpi.wonInPeriod')}
          value={o ? Number(o.won_count) : t('duration.empty')}
          icon={TrendingUp}
          highlight
        />
        <KpiCard
          label={t('kpi.lostInPeriod')}
          value={o ? Number(o.lost_count) : t('duration.empty')}
          icon={TrendingDown}
          iconColor="text-red-400"
        />
        <KpiCard
          label={t('kpi.conversionRate')}
          value={
            o?.conversion_rate != null
              ? t('kpi.conversionPercent', { value: Number(o.conversion_rate).toFixed(1) })
              : t('duration.empty')
          }
          icon={BarChart2}
          iconColor="text-indigo-500"
          subLabel={t('kpi.conversionClosedOnly')}
        />
        <KpiCard
          label={t('kpi.wonValue')}
          value={o ? fmtCurrency(Number(o.won_value)) : t('duration.empty')}
          icon={DollarSign}
          highlight={!!o && Number(o.won_value) > 0}
        />
        <KpiCard
          label={t('kpi.stalled', { days: stalledDays })}
          value={o ? Number(o.stalled_count) : t('duration.empty')}
          icon={AlertTriangle}
          alert={!!o && Number(o.stalled_count) > 0}
          subLabel={
            <span className="flex items-center gap-1">
              {t('kpi.limitPrefix')}
              <input
                type="number"
                min={1}
                max={365}
                value={stalledDays}
                onChange={(e) => setStalledDays(Math.max(1, parseInt(e.target.value, 10) || 15))}
                onClick={(e) => e.stopPropagation()}
                className="w-12 text-center bg-transparent border-b border-current focus:outline-none"
              />
              {t('kpi.daysUnit')}
            </span>
          }
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          {t('charts.openByStageTitle')}
        </h3>
        {stageData.length > 0 ? (
          <FunnelBarChart data={stageData} />
        ) : (
          <ReportEmptyState description={t('charts.noOpenInSelectedFunnel')} />
        )}
      </div>

      {o && (o.avg_cycle_won_seconds != null || o.avg_cycle_lost_seconds != null) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <KpiCard
            label={t('kpi.avgCycleWon')}
            value={fmtCycle(o.avg_cycle_won_seconds)}
            icon={Clock}
            iconColor="text-emerald-500"
            subLabel={t('kpi.sinceOpenToWon')}
          />
          <KpiCard
            label={t('kpi.avgCycleLost')}
            value={fmtCycle(o.avg_cycle_lost_seconds)}
            icon={Clock}
            iconColor="text-red-400"
            subLabel={t('kpi.sinceOpenToLost')}
          />
        </div>
      )}
    </div>
  )
}

function CycleTimeTab({
  data,
  loading,
  fmtCycle,
}: {
  data: CycleTimeMetric[]
  loading: boolean
  fmtCycle: (seconds: number | null) => string
}) {
  const { t } = useTranslation('reports')

  if (loading) return <TableSkeleton rows={6} />

  const totalRow = data.find((d) => d.dimension === 'total')
  const funnelRows = data.filter((d) => d.dimension === 'funnel')
  const sellerRows = data.filter((d) => d.dimension === 'seller')

  if (!totalRow && funnelRows.length === 0 && sellerRows.length === 0) {
    return <ReportEmptyState description={t('cycleTable.noClosedInPeriod')} />
  }

  const CycleTable = ({ rows, label }: { rows: CycleTimeMetric[]; label: string }) => {
    if (rows.length === 0) return null
    return (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <h4 className="text-sm font-semibold text-gray-700">{label}</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('cycleTable.columnName')}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">{t('cycleTable.columnWon')}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">{t('cycleTable.columnLost')}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">{t('cycleTable.columnAvgCycleWon')}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 hidden md:table-cell">{t('cycleTable.columnMedianWon')}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 hidden md:table-cell">{t('cycleTable.columnMaxWon')}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 hidden md:table-cell">{t('cycleTable.columnAvgCycleLost')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.group_id ?? 'total'} className="border-b border-gray-50 hover:bg-gray-50 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-800">{r.group_name}</td>
                  <td className="px-4 py-3 text-right text-emerald-600 font-semibold">{Number(r.won_count)}</td>
                  <td className="px-4 py-3 text-right text-red-500">{Number(r.lost_count)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{fmtCycle(r.won_avg_seconds)}</td>
                  <td className="px-4 py-3 text-right text-gray-500 hidden md:table-cell">{fmtCycle(r.won_median_seconds)}</td>
                  <td className="px-4 py-3 text-right text-gray-500 hidden md:table-cell">{fmtCycle(r.won_max_seconds)}</td>
                  <td className="px-4 py-3 text-right text-gray-500 hidden md:table-cell">{fmtCycle(r.lost_avg_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {totalRow && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label={t('kpi.cycleWonShort')} value={fmtCycle(totalRow.won_avg_seconds)} icon={Timer} iconColor="text-emerald-500" />
          <KpiCard label={t('kpi.medianWonShort')} value={fmtCycle(totalRow.won_median_seconds)} icon={Timer} iconColor="text-blue-500" />
          <KpiCard label={t('kpi.maxWonShort')} value={fmtCycle(totalRow.won_max_seconds)} icon={Timer} iconColor="text-gray-500" />
          <KpiCard label={t('kpi.cycleLostShort')} value={fmtCycle(totalRow.lost_avg_seconds)} icon={Timer} iconColor="text-red-400" />
        </div>
      )}
      <CycleTable rows={funnelRows} label={t('cycleTable.byFunnel')} />
      <CycleTable rows={sellerRows} label={t('cycleTable.bySeller')} />
    </div>
  )
}

export default function Reports() {
  const { t } = useTranslation('reports')
  const { company } = useAuth()
  const displayCurrency = company?.default_currency ?? 'BRL'
  const fmtCurrency = (v: number) => formatMoney(v, displayCurrency)
  const fmtCycle = useFmtCycleSeconds()

  const tabs = useMemo(
    () =>
      [
        { key: 'overview' as const, label: t('tabs.overview') },
        { key: 'by-stage' as const, label: t('tabs.byStage') },
        { key: 'by-seller' as const, label: t('tabs.bySeller') },
        { key: 'cycle-time' as const, label: t('tabs.cycleTime') },
      ],
    [t]
  )

  const {
    activeTab, setActiveTab,
    period, handlePeriodChange,
    selectedFunnelIds, handleFunnelToggle, handleClearFunnels,
    stalledDays, setStalledDays,
    funnelOptions, loadingFunnels,
    filters, companyId,
  } = useReports()

  const { metrics, loading, error } = useFunnelMetrics(companyId, filters)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-indigo-600" />
            <h1 className="text-lg font-semibold text-gray-900">{t('header.title')}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodFilter
              selectedPeriod={period}
              onPeriodChange={handlePeriodChange}
            />
            <ReportFunnelSelector
              options={funnelOptions}
              selected={selectedFunnelIds}
              onToggle={handleFunnelToggle}
              onClear={handleClearFunnels}
              loading={loadingFunnels}
            />
          </div>
        </div>

        <div className="flex gap-1 mt-4 border-b border-transparent -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 py-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            {t('messages.loadError', { error })}
          </div>
        )}

        {activeTab === 'overview' && (
          <OverviewTab
            data={metrics.overview}
            stageData={metrics.stageMetrics}
            stalledDays={stalledDays}
            setStalledDays={setStalledDays}
            loading={loading}
            fmtCurrency={fmtCurrency}
            fmtCycle={fmtCycle}
          />
        )}

        {activeTab === 'by-stage' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-700">
                {t('sections.byStage')}
              </h2>
            </div>
            {loading ? <TableSkeleton rows={6} /> : (
              <StageTimeTable data={metrics.stageMetrics} />
            )}
          </div>
        )}

        {activeTab === 'by-seller' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-700">
                {t('sections.bySeller')}
              </h2>
            </div>
            {loading ? <TableSkeleton rows={6} /> : (
              <SellerTable data={metrics.sellerMetrics} displayCurrency={displayCurrency} />
            )}
          </div>
        )}

        {activeTab === 'cycle-time' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Timer className="w-4 h-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-700">
                {t('sections.cycleTime')}
              </h2>
            </div>
            <CycleTimeTab data={metrics.cycleMetrics} loading={loading} fmtCycle={fmtCycle} />
          </div>
        )}
      </div>
    </div>
  )
}
