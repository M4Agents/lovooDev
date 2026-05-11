import React from 'react'
import { GitBranch, Clock, AlertTriangle, TrendingUp } from 'lucide-react'
import type { FunnelExecutiveStage } from '../../../types/dashboard'

interface FunnelExecutiveSectionProps {
  stages:         FunnelExecutiveStage[] | null
  loading:        boolean
  error:          string | null
  funnelRequired?: boolean
}

function fmt(value: number) {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000)     return `R$ ${(value / 1_000).toFixed(0)}K`
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function StageRow({ stage }: { stage: FunnelExecutiveStage }) {
  const hasStall    = stage.stalled_count > 0
  const stalledPct  = stage.opp_count > 0
    ? Math.round((stage.stalled_count / stage.opp_count) * 100)
    : 0
  const color       = stage.stage_color ?? '#6366f1'

  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-xs">
      {/* Indicador de cor */}
      <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />

      {/* Nome da etapa */}
      <span className="font-medium text-gray-800 dark:text-gray-100 truncate">{stage.stage_name}</span>

      {/* Oportunidades */}
      <span className="text-right text-gray-500 dark:text-gray-400 tabular-nums w-8">
        {stage.opp_count}
      </span>

      {/* Valor ponderado */}
      <span className="text-right font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums w-20">
        {stage.weighted_value > 0 ? fmt(stage.weighted_value) : '—'}
      </span>

      {/* Avg days */}
      <div className="flex items-center gap-1 text-gray-400 dark:text-gray-500 w-16 justify-end">
        <Clock className="h-3 w-3 shrink-0" />
        <span className="tabular-nums">{stage.avg_days > 0 ? `${stage.avg_days}d` : '—'}</span>
      </div>

      {/* Paradas */}
      <div className={`flex items-center gap-1 w-12 justify-end ${hasStall ? 'text-amber-500' : 'text-gray-300 dark:text-gray-600'}`}>
        {hasStall && <AlertTriangle className="h-3 w-3 shrink-0" />}
        <span className="tabular-nums">{hasStall ? `${stage.stalled_count} (${stalledPct}%)` : '—'}</span>
      </div>
    </div>
  )
}

export function FunnelExecutiveSection({
  stages,
  loading,
  error,
  funnelRequired,
}: FunnelExecutiveSectionProps) {
  if (funnelRequired) {
    return (
      <div className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-2">
          <GitBranch className="h-4 w-4 text-indigo-400" />
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Funil Executivo</h3>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">Selecione um funil para ver a visão executiva.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm p-5 animate-pulse">
        <div className="h-5 w-44 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-100 dark:bg-gray-700 rounded-xl" />
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

  const list = stages ?? []

  const totalWeighted = list.reduce((acc, s) => acc + s.weighted_value, 0)
  const totalStalled  = list.reduce((acc, s) => acc + s.stalled_count, 0)
  const totalOpps     = list.reduce((acc, s) => acc + s.opp_count, 0)

  return (
    <div className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm p-5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-indigo-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Funil Executivo</h3>
        </div>
        {list.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5 text-indigo-400" />
              {fmt(totalWeighted)} ponderado
            </span>
            {totalStalled > 0 && (
              <span className="flex items-center gap-1 text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5" />
                {totalStalled} paradas
              </span>
            )}
          </div>
        )}
      </div>

      {/* Cabeçalho da tabela */}
      {list.length > 0 && (
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 px-3 text-xs text-gray-400 dark:text-gray-500">
          <span className="w-3" />
          <span>Etapa</span>
          <span className="text-right w-8">Opp</span>
          <span className="text-right w-20">Ponderado</span>
          <span className="text-right w-16">Tempo médio</span>
          <span className="text-right w-12">Paradas</span>
        </div>
      )}

      {/* Linhas */}
      {list.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-gray-400 dark:text-gray-500">Nenhuma oportunidade aberta no funil</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {list.map((stage) => (
            <StageRow key={stage.stage_id} stage={stage} />
          ))}
        </div>
      )}

      {/* Totais */}
      {list.length > 0 && (
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 px-3 pt-2 border-t border-gray-100 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200">
          <span className="w-3" />
          <span>Total</span>
          <span className="text-right w-8 tabular-nums">{totalOpps}</span>
          <span className="text-right w-20 text-indigo-600 dark:text-indigo-400 tabular-nums">{fmt(totalWeighted)}</span>
          <span className="w-16" />
          <span className={`text-right w-12 tabular-nums ${totalStalled > 0 ? 'text-amber-500' : 'text-gray-300 dark:text-gray-600'}`}>
            {totalStalled > 0 ? totalStalled : '—'}
          </span>
        </div>
      )}
    </div>
  )
}
