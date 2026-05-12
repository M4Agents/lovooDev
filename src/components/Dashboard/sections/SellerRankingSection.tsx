// =====================================================
// SellerRankingSection — Ranking Comercial.
//
// is_individual_view = true: exibe "Suas Métricas" sem rank/score.
// is_individual_view = false: exibe ranking completo da equipe.
// =====================================================

import React, { useState } from 'react'
import { Trophy, TrendingUp, AlertTriangle, RefreshCw } from 'lucide-react'
import { SellerPerformanceChart }  from '../charts/SellerPerformanceChart'
import { DeltaBadge }              from '../historical/DeltaBadge'
import { TrendSparkline }          from '../historical/TrendSparkline'
import { SnapshotDataGuard }       from '../historical/SnapshotDataGuard'
import type {
  SellerRankingEntry,
  SellerRankingMeta,
  SellerSnapshotDelta,
}                                  from '../../../types/dashboard'
import type { ComparisonMode }     from '../../../lib/snapshotPeriods'
import { getComparisonLabel }      from '../../../lib/snapshotPeriods'

interface Props {
  data:           SellerRankingEntry[]
  meta:           SellerRankingMeta | null
  loading:        boolean
  error:          string | null
  onRetry?:       () => void
  // FASE 4.1 — deltas históricos (opcional)
  sellerDeltas?:  Map<string, SellerSnapshotDelta>
  comparisonMode?: ComparisonMode
}

function scoreBadge(score: number) {
  if (score >= 70) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (score >= 45) return 'bg-amber-50 text-amber-700 border-amber-200'
  return 'bg-rose-50 text-rose-700 border-rose-200'
}

function fmtPct(v: number)    { return `${(v * 100).toFixed(0)}%` }
function fmtMin(v: number | null) {
  if (v === null) return '—'
  if (v < 60) return `${v.toFixed(0)}min`
  return `${(v / 60).toFixed(1)}h`
}
function fmtBrl(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
}

export function SellerRankingSection({
  data,
  meta,
  loading,
  error,
  onRetry,
  sellerDeltas,
  comparisonMode = 'wow',
}: Props) {
  const [showChart, setShowChart] = useState(false)

  const isIndividual  = meta?.is_individual_view ?? false
  const title         = isIndividual ? 'Suas Métricas' : 'Ranking Comercial'
  const ranked        = isIndividual ? data : [...data].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
  const hasDeltaData  = !!sellerDeltas && sellerDeltas.size > 0
  const periodLabel2  = getComparisonLabel(comparisonMode)

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
          {!isIndividual && meta && (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {meta.total} vendedor{meta.total !== 1 ? 'es' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isIndividual && data.length > 1 && (
            <button
              onClick={() => setShowChart(v => !v)}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              {showChart ? 'Ver tabela' : 'Ver gráfico'}
            </button>
          )}
          {onRetry && (
            <button onClick={onRetry} className="text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        {loading && <RankingSkeleton />}

        {!loading && error && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400" />
            <p className="text-xs text-gray-500">{error}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium mt-1 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Tentar novamente
              </button>
            )}
          </div>
        )}

        {!loading && !error && ranked.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-8">
            Nenhum vendedor com leads no período selecionado
          </p>
        )}

        {!loading && !error && ranked.length > 0 && (
          <>
            {/* Gráfico de score (team view only) */}
            {showChart && !isIndividual && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <SellerPerformanceChart data={ranked} />
              </div>
            )}

            {/* Tabela */}
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs min-w-[600px]">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    {!isIndividual && <th className="pb-2 pl-2 text-left w-8">#</th>}
                    <th className="pb-2 text-left">Vendedor</th>
                    {!isIndividual && <th className="pb-2 text-center w-16">Score</th>}
                    <th className="pb-2 text-center">Leads</th>
                    <th className="pb-2 text-center">Atend.</th>
                    <th className="pb-2 text-center">T. Resp.</th>
                    <th className="pb-2 text-center">Conversão</th>
                    <th className="pb-2 text-center">SLA ❌</th>
                    <th className="pb-2 text-right pr-2">Receita</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {ranked.map(seller => {
                    const delta = sellerDeltas?.get(seller.user_id)
                    return (
                      <React.Fragment key={seller.user_id}>
                        <tr className="hover:bg-gray-50 transition-colors">
                          {!isIndividual && (
                            <td className="py-2.5 pl-2 font-semibold text-gray-400">
                              {seller.rank ?? '—'}
                            </td>
                          )}
                          <td className="py-2.5 font-medium text-gray-700 max-w-[140px] truncate">
                            {seller.display_name}
                          </td>
                          {!isIndividual && (
                            <td className="py-2.5 text-center">
                              {seller.score !== null ? (
                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold border ${scoreBadge(seller.score)}`}>
                                  {seller.score.toFixed(0)}
                                </span>
                              ) : '—'}
                            </td>
                          )}
                          <td className="py-2.5 text-center text-gray-600">{seller.leads_received}</td>
                          <td className="py-2.5 text-center text-gray-600">
                            <div className="flex flex-col items-center gap-0.5">
                              <span>{fmtPct(seller.attendance_rate)}</span>
                              {hasDeltaData && delta && (
                                <DeltaBadge
                                  pct={delta.attendance_rate_pct}
                                  higherIsBetter={true}
                                  periodLabel={periodLabel2}
                                />
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 text-center text-gray-600">
                            <div className="flex flex-col items-center gap-0.5">
                              <span>{fmtMin(seller.avg_response_min)}</span>
                              {hasDeltaData && delta && (
                                <DeltaBadge
                                  pct={delta.avg_response_min_pct}
                                  higherIsBetter={false}
                                  periodLabel={periodLabel2}
                                />
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 text-center text-gray-600">
                            {fmtPct(seller.conversion_rate)}
                          </td>
                          <td className="py-2.5 text-center">
                            {seller.sla_missed_count > 0 ? (
                              <span className="text-rose-500 font-semibold">{seller.sla_missed_count}</span>
                            ) : (
                              <span className="text-emerald-500">0</span>
                            )}
                          </td>
                          <td className="py-2.5 text-right pr-2 text-gray-700 font-medium">
                            <div className="flex flex-col items-end gap-0.5">
                              <span>{fmtBrl(seller.won_value)}</span>
                              {/* Sparkline de won_value — só se houver >= 5 pontos */}
                              {hasDeltaData && delta && (
                                <SnapshotDataGuard dataPoints={delta.won_value_series.length}>
                                  <TrendSparkline
                                    values={delta.won_value_series}
                                    higherIsBetter={true}
                                    width={56}
                                    height={16}
                                  />
                                </SnapshotDataGuard>
                              )}
                            </div>
                          </td>
                        </tr>
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Legenda da fórmula */}
            {!isIndividual && (
              <p className="mt-3 text-[10px] text-gray-300 text-right">
                Score = Conversão 35% · Velocidade 25% · Atendimento 20% · Geração 10% · SLA 10%
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function RankingSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-4 w-4 bg-gray-100 rounded" />
          <div className="h-4 flex-1 bg-gray-100 rounded" />
          <div className="h-4 w-12 bg-gray-100 rounded" />
          <div className="h-4 w-12 bg-gray-100 rounded" />
          <div className="h-4 w-16 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  )
}
