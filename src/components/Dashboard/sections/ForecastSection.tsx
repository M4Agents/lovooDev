import React from 'react'
import { TrendingUp, AlertTriangle, CheckCircle, XCircle, BarChart3 } from 'lucide-react'
import { ForecastGauge } from '../charts/ForecastGauge'
import type { ForecastData } from '../../../types/dashboard'

interface ForecastSectionProps {
  data:    ForecastData | null
  loading: boolean
  error:   string | null
}

function fmt(value: number) {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000)     return `R$ ${(value / 1_000).toFixed(0)}K`
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  colorClass,
}: {
  icon: React.ElementType
  label: string
  value: string
  sub?: string
  colorClass: string
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${colorClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-none mb-0.5">{label}</p>
        <p className="font-bold text-gray-900 dark:text-white text-sm truncate">{value}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export function ForecastSection({ data, loading, error }: ForecastSectionProps) {
  if (loading) {
    return (
      <div className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm p-5 animate-pulse">
        <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-gray-700 rounded-xl" />
          ))}
        </div>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-6 bg-gray-100 dark:bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-white dark:bg-gray-800 border border-red-100 dark:border-red-900 p-5">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }

  if (!data) return null

  const conversionPct = data.conversion_rate ?? 0
  const stalledRiskPct = data.pipeline_weighted > 0
    ? Math.round((data.pipeline_risk / data.pipeline_weighted) * 100)
    : 0

  return (
    <div className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-indigo-500" />
        <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Forecast Comercial</h3>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard
          icon={TrendingUp}
          label="Pipeline Ponderado"
          value={fmt(data.pipeline_weighted)}
          sub={`${data.open_count} oportunidades`}
          colorClass="bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400"
        />
        <StatCard
          icon={CheckCircle}
          label="Pipeline Seguro"
          value={fmt(data.pipeline_safe)}
          sub={`${100 - stalledRiskPct}% sem risco`}
          colorClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
        />
        <StatCard
          icon={AlertTriangle}
          label="Em Risco"
          value={fmt(data.pipeline_risk)}
          sub={`${data.stalled_count} paradas`}
          colorClass="bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
        />
        <StatCard
          icon={CheckCircle}
          label="Ganho no Período"
          value={fmt(data.won_value)}
          sub={`${conversionPct}% conversão`}
          colorClass="bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400"
        />
      </div>

      {/* Barras de proporção */}
      <div className="space-y-2.5 pt-1">
        <ForecastGauge
          label="Pipeline Seguro"
          value={data.pipeline_safe}
          total={data.pipeline_weighted}
          color="#10b981"
        />
        <ForecastGauge
          label="Em Risco (ponderado)"
          value={data.pipeline_risk}
          total={data.pipeline_weighted}
          color="#f59e0b"
        />
        {data.won_value > 0 || data.lost_value > 0 ? (
          <ForecastGauge
            label="Ganho no período"
            value={data.won_value}
            total={data.won_value + data.lost_value}
            color="#6366f1"
          />
        ) : null}
      </div>

      {/* Linha de fechamentos */}
      {(data.won_count > 0 || data.lost_count > 0) && (
        <div className="flex items-center gap-4 pt-1 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
            <span>{data.won_count} ganhas · {fmt(data.won_value)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <XCircle className="h-3.5 w-3.5 text-red-400" />
            <span>{data.lost_count} perdidas · {fmt(data.lost_value)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
