// =====================================================
// ActivationKPIs — cards de KPI da aba Ativação Comercial.
// Exibe 6 métricas agrupadas em dois blocos:
//   • Prospecção (3 cards)
//   • Resgate    (3 cards)
// =====================================================

import React from 'react'
import { TrendingUp, RotateCcw } from 'lucide-react'
import type { ActivationSummary } from '../../../types/dashboard-activation'

interface ActivationKPIsProps {
  summary: ActivationSummary | null
  loading: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeRate(responded: number, initiated: number): string {
  if (initiated === 0) return '—'
  return `${((responded / initiated) * 100).toFixed(1)}%`
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR')
}

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

interface KpiCardProps {
  label:   string
  value:   string
  loading: boolean
  accent?: string
}

function KpiCard({ label, value, loading, accent = 'bg-indigo-50 text-indigo-700' }: KpiCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-1">
      <span className="text-xs text-gray-500 leading-tight">{label}</span>
      {loading ? (
        <div className="h-6 w-16 bg-gray-100 animate-pulse rounded mt-1" />
      ) : (
        <span className={`text-xl font-bold ${accent}`}>{value}</span>
      )}
    </div>
  )
}

interface KpiGroupProps {
  title:    string
  icon:     React.ReactNode
  children: React.ReactNode
}

function KpiGroup({ title, icon, children }: KpiGroupProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-gray-400">{icon}</span>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActivationKPIs
// ---------------------------------------------------------------------------

export function ActivationKPIs({ summary, loading }: ActivationKPIsProps) {
  // Considera "aguardando" tanto durante o carregamento quanto antes
  // do primeiro dado chegar (summary=null com loading=false = estado inicial).
  const awaiting = loading || summary === null

  const prospInitiated = summary?.total_prospection_initiated ?? 0
  const prospResponded = summary?.total_prospection_responded ?? 0
  const rescInitiated  = summary?.total_rescue_initiated      ?? 0
  const rescResponded  = summary?.total_rescue_responded      ?? 0

  return (
    <div className="space-y-4">
      <KpiGroup title="Prospecção" icon={<TrendingUp size={14} />}>
        <KpiCard
          label="Prospecções iniciadas"
          value={awaiting ? '—' : fmt(prospInitiated)}
          loading={awaiting}
          accent="text-indigo-700"
        />
        <KpiCard
          label="Prospecções respondidas"
          value={awaiting ? '—' : fmt(prospResponded)}
          loading={awaiting}
          accent="text-indigo-700"
        />
        <KpiCard
          label="Taxa de resposta"
          value={awaiting ? '—' : safeRate(prospResponded, prospInitiated)}
          loading={awaiting}
          accent="text-indigo-700"
        />
      </KpiGroup>

      <KpiGroup title="Resgate / Reativação" icon={<RotateCcw size={14} />}>
        <KpiCard
          label="Resgates iniciados"
          value={awaiting ? '—' : fmt(rescInitiated)}
          loading={awaiting}
          accent="text-emerald-700"
        />
        <KpiCard
          label="Resgates respondidos"
          value={awaiting ? '—' : fmt(rescResponded)}
          loading={awaiting}
          accent="text-emerald-700"
        />
        <KpiCard
          label="Taxa de reativação"
          value={awaiting ? '—' : safeRate(rescResponded, rescInitiated)}
          loading={awaiting}
          accent="text-emerald-700"
        />
      </KpiGroup>
    </div>
  )
}

