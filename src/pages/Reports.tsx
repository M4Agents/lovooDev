import React from 'react'
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtCycle(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '—'
  const d = Math.round(Number(seconds) / 86400)
  if (d < 1) return `${Math.round(Number(seconds) / 3600)}h`
  if (d < 30) return `${d}d`
  return `${Math.round(d / 30)}m`
}

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'overview', label: 'Visão Geral' },
  { key: 'by-stage', label: 'Por Etapa' },
  { key: 'by-seller', label: 'Por Vendedor' },
  { key: 'cycle-time', label: 'Tempo de Ciclo' },
]

// ─── Aba Visão Geral ────────────────────────────────────────────────────────

function OverviewTab({
  data, stageData, stalledDays, setStalledDays, loading, fmtCurrency,
}: {
  data: ReturnType<typeof useFunnelMetrics>['metrics']['overview']
  stageData: ReturnType<typeof useFunnelMetrics>['metrics']['stageMetrics']
  stalledDays: number
  setStalledDays: (v: number) => void
  loading: boolean
  /** Agregados podem misturar moedas; formatação usa moeda padrão da empresa. */
  fmtCurrency: (v: number) => string
}) {
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
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard
          label="Oportunidades abertas"
          value={o ? Number(o.open_count) : '—'}
          icon={Target}
          iconColor="text-blue-500"
        />
        <KpiCard
          label="Ganhas no período"
          value={o ? Number(o.won_count) : '—'}
          icon={TrendingUp}
          highlight
        />
        <KpiCard
          label="Perdidas no período"
          value={o ? Number(o.lost_count) : '—'}
          icon={TrendingDown}
          iconColor="text-red-400"
        />
        <KpiCard
          label="Taxa de conversão"
          value={o?.conversion_rate != null ? `${Number(o.conversion_rate).toFixed(1)}%` : '—'}
          icon={BarChart2}
          iconColor="text-indigo-500"
          subLabel="Apenas fechadas no período"
        />
        <KpiCard
          label="Valor ganho"
          value={o ? fmtCurrency(Number(o.won_value)) : '—'}
          icon={DollarSign}
          highlight={!!o && Number(o.won_value) > 0}
        />
        <KpiCard
          label={`Paradas há +${stalledDays}d`}
          value={o ? Number(o.stalled_count) : '—'}
          icon={AlertTriangle}
          alert={!!o && Number(o.stalled_count) > 0}
          subLabel={
            <span className="flex items-center gap-1">
              Limite:
              <input
                type="number"
                min={1}
                max={365}
                value={stalledDays}
                onChange={(e) => setStalledDays(Math.max(1, parseInt(e.target.value) || 15))}
                onClick={(e) => e.stopPropagation()}
                className="w-12 text-center bg-transparent border-b border-current focus:outline-none"
              />
              dias
            </span>
          }
        />
      </div>

      {/* Gráfico de oportunidades por etapa */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          Oportunidades abertas por etapa
        </h3>
        {stageData.length > 0 ? (
          <FunnelBarChart data={stageData} />
        ) : (
          <ReportEmptyState description="Nenhuma oportunidade aberta no funil selecionado." />
        )}
      </div>

      {/* Tempo médio de ciclo resumido */}
      {o && (o.avg_cycle_won_seconds != null || o.avg_cycle_lost_seconds != null) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <KpiCard
            label="Ciclo médio — Ganhas"
            value={fmtCycle(o.avg_cycle_won_seconds)}
            icon={Clock}
            iconColor="text-emerald-500"
            subLabel="Desde abertura até ganho"
          />
          <KpiCard
            label="Ciclo médio — Perdidas"
            value={fmtCycle(o.avg_cycle_lost_seconds)}
            icon={Clock}
            iconColor="text-red-400"
            subLabel="Desde abertura até perda"
          />
        </div>
      )}
    </div>
  )
}

// ─── Aba Tempo de Ciclo ─────────────────────────────────────────────────────

function CycleTimeTab({ data, loading }: { data: CycleTimeMetric[]; loading: boolean }) {
  if (loading) return <TableSkeleton rows={6} />

  const totalRow = data.find((d) => d.dimension === 'total')
  const funnelRows = data.filter((d) => d.dimension === 'funnel')
  const sellerRows = data.filter((d) => d.dimension === 'seller')

  if (!totalRow && funnelRows.length === 0 && sellerRows.length === 0) {
    return <ReportEmptyState description="Nenhuma oportunidade fechada no período selecionado." />
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
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Nome</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Ganhas</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Perdidas</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Ciclo médio (G)</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 hidden md:table-cell">Mediana (G)</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 hidden md:table-cell">Máx (G)</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 hidden md:table-cell">Ciclo médio (P)</th>
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
      {/* Resumo global */}
      {totalRow && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Ciclo médio — Ganhas" value={fmtCycle(totalRow.won_avg_seconds)} icon={Timer} iconColor="text-emerald-500" />
          <KpiCard label="Mediana — Ganhas" value={fmtCycle(totalRow.won_median_seconds)} icon={Timer} iconColor="text-blue-500" />
          <KpiCard label="Máximo — Ganhas" value={fmtCycle(totalRow.won_max_seconds)} icon={Timer} iconColor="text-gray-500" />
          <KpiCard label="Ciclo médio — Perdidas" value={fmtCycle(totalRow.lost_avg_seconds)} icon={Timer} iconColor="text-red-400" />
        </div>
      )}
      <CycleTable rows={funnelRows} label="Por Funil" />
      <CycleTable rows={sellerRows} label="Por Vendedor" />
    </div>
  )
}

// ─── Página Principal ───────────────────────────────────────────────────────

export default function Reports() {
  const { company } = useAuth()
  const displayCurrency = company?.default_currency ?? 'BRL'
  const fmtCurrency = (v: number) => formatMoney(v, displayCurrency)

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
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-indigo-600" />
            <h1 className="text-lg font-semibold text-gray-900">Relatórios</h1>
          </div>
          {/* Filtros globais */}
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

        {/* Abas */}
        <div className="flex gap-1 mt-4 border-b border-transparent -mb-px">
          {TABS.map((tab) => (
            <button
              key={tab.key}
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

      {/* Conteúdo */}
      <div className="px-6 py-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            Erro ao carregar relatórios: {error}
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
          />
        )}

        {activeTab === 'by-stage' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-700">
                Tempo por etapa — oportunidades abertas e movimentações históricas no período
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
                Performance por vendedor — ganhos e perdidos no período selecionado
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
                Ciclo de vendas — tempo entre abertura e fechamento (ganhas e perdidas no período)
              </h2>
            </div>
            <CycleTimeTab data={metrics.cycleMetrics} loading={loading} />
          </div>
        )}
      </div>
    </div>
  )
}
