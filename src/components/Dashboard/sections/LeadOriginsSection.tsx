// =====================================================
// LeadOriginsSection — Origem dos Leads.
// Barras horizontais (ajuste obrigatório: não pizza).
// Tab para alternar entre volume, oportunidades e receita.
// =====================================================

import React, { useState } from 'react'
import { BarChart2, RefreshCw, AlertTriangle } from 'lucide-react'
import { LeadOriginChart } from '../charts/LeadOriginChart'
import type { LeadOriginItem, LeadOriginsMeta } from '../../../types/dashboard'

interface Props {
  data:     LeadOriginItem[]
  meta:     LeadOriginsMeta | null
  loading:  boolean
  error:    string | null
  onRetry?: () => void
}

type MetricKey = 'lead_count' | 'opps_generated' | 'total_won_value'

const METRIC_TABS: { key: MetricKey; label: string }[] = [
  { key: 'lead_count',      label: 'Volume'        },
  { key: 'opps_generated',  label: 'Oportunidades' },
  { key: 'total_won_value', label: 'Receita'        },
]

function fmtPct(v: number | null) {
  if (v === null) return '—'
  return `${v.toFixed(1)}%`
}

function fmtBrl(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
}

export function LeadOriginsSection({ data, meta, loading, error, onRetry }: Props) {
  const [metric, setMetric] = useState<MetricKey>('lead_count')

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-gray-800">Origem dos Leads</h3>
          {meta && (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {meta.total_origins} canal{meta.total_origins !== 1 ? 'ais' : ''}
            </span>
          )}
        </div>
        {onRetry && (
          <button onClick={onRetry} className="text-gray-400 hover:text-gray-600">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Tab de métrica */}
      <div className="flex gap-1 px-5 pt-3">
        {METRIC_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setMetric(tab.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              metric === tab.key
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="p-4">
        {loading && <OriginSkeleton />}

        {!loading && error && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400" />
            <p className="text-xs text-gray-500">{error}</p>
            {onRetry && (
              <button onClick={onRetry} className="text-xs text-indigo-600 font-medium mt-1 flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Tentar novamente
              </button>
            )}
          </div>
        )}

        {!loading && !error && data.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-8">
            Nenhum lead com origem registrada no período
          </p>
        )}

        {!loading && !error && data.length > 0 && (
          <>
            {/* Gráfico horizontal */}
            <LeadOriginChart
              data={data}
              dataKey={metric}
              height={Math.max(200, data.length * 32)}
            />

            {/* Tabela resumo abaixo */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs min-w-[480px]">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="pb-2 text-left">Canal</th>
                    <th className="pb-2 text-center">Leads</th>
                    <th className="pb-2 text-center">Oportunidades</th>
                    <th className="pb-2 text-center">Conversão</th>
                    <th className="pb-2 text-right">Receita</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.map(item => (
                    <tr key={item.origin} className="hover:bg-gray-50 transition-colors">
                      <td className="py-2 font-medium text-gray-700 capitalize max-w-[160px] truncate">
                        {item.origin}
                      </td>
                      <td className="py-2 text-center text-gray-600">{item.lead_count}</td>
                      <td className="py-2 text-center text-gray-600">{item.opps_generated}</td>
                      <td className="py-2 text-center">
                        {item.conversion_rate_pct !== null ? (
                          <span className={`font-semibold ${
                            item.conversion_rate_pct >= 50 ? 'text-emerald-600' :
                            item.conversion_rate_pct >= 20 ? 'text-amber-600' : 'text-rose-500'
                          }`}>
                            {fmtPct(item.conversion_rate_pct)}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="py-2 text-right text-gray-700">
                        {item.total_won_value > 0 ? fmtBrl(item.total_won_value) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function OriginSkeleton() {
  return (
    <div className="space-y-3 animate-pulse pt-2">
      {[80, 60, 45, 30, 20].map((w, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-3 w-24 bg-gray-100 rounded" />
          <div className={`h-4 bg-gray-100 rounded`} style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  )
}
