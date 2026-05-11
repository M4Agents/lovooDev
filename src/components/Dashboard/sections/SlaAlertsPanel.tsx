// =====================================================
// SlaAlertsPanel — Leads sem resposta (SLA).
// Lista acionável ordenada por urgência crescente.
// Paginação incremental: "Carregar mais".
// =====================================================

import React from 'react'
import { Clock, AlertTriangle, RefreshCw, ChevronDown } from 'lucide-react'
import type { SlaAlertItem, SlaAlertsMeta, SlaAlertSeverity } from '../../../types/dashboard'

interface Props {
  data:       SlaAlertItem[]
  meta:       SlaAlertsMeta | null
  loading:    boolean
  error:      string | null
  onRetry?:   () => void
  onLoadMore?: () => void
}

const SEVERITY_CONFIG: Record<SlaAlertSeverity, { label: string; cls: string; bg: string }> = {
  critical: { label: 'Crítico',  cls: 'text-red-700 bg-red-50 border-red-200',    bg: 'border-l-red-500' },
  high:     { label: 'Alto',     cls: 'text-orange-700 bg-orange-50 border-orange-200', bg: 'border-l-orange-400' },
  medium:   { label: 'Médio',    cls: 'text-amber-700 bg-amber-50 border-amber-200',    bg: 'border-l-amber-400' },
  low:      { label: 'Baixo',    cls: 'text-blue-700 bg-blue-50 border-blue-200',  bg: 'border-l-blue-400' },
}

function fmtHours(h: number): string {
  if (h < 24) return `${h.toFixed(0)}h`
  return `${(h / 24).toFixed(1)}d`
}

export function SlaAlertsPanel({ data, meta, loading, error, onRetry, onLoadMore }: Props) {
  const total   = meta?.total ?? 0
  const hasMore = meta?.has_more ?? false

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-rose-500" />
          <h3 className="text-sm font-semibold text-gray-800">Leads sem Resposta (SLA)</h3>
          {total > 0 && (
            <span className="text-xs bg-rose-50 text-rose-600 border border-rose-200 px-2 py-0.5 rounded-full font-semibold">
              {total}
            </span>
          )}
        </div>
        {onRetry && (
          <button onClick={onRetry} className="text-gray-400 hover:text-gray-600">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="p-4">
        {loading && data.length === 0 && <SlaSkeleton />}

        {!loading && error && data.length === 0 && (
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
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
              <span className="text-emerald-600 text-lg">✓</span>
            </div>
            <p className="text-xs text-gray-500">
              Nenhum lead aguardando resposta · SLA dentro do limite
            </p>
          </div>
        )}

        {data.length > 0 && (
          <div className="space-y-2">
            {data.map(item => {
              const cfg = SEVERITY_CONFIG[item.severity]
              return (
                <div
                  key={item.conversation_id}
                  className={`flex items-center gap-3 p-3 rounded-lg border border-l-4 ${cfg.bg} border-gray-100`}
                >
                  {/* Criticidade */}
                  <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold border ${cfg.cls}`}>
                    {cfg.label}
                  </span>

                  {/* Lead info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-700 truncate">{item.lead_name}</p>
                    {item.seller_name && (
                      <p className="text-[10px] text-gray-400 truncate">{item.seller_name}</p>
                    )}
                  </div>

                  {/* Tempo */}
                  <span className="shrink-0 text-xs font-bold text-gray-500 whitespace-nowrap">
                    {fmtHours(item.hours_waiting)} sem resposta
                  </span>
                </div>
              )
            })}

            {/* Carregar mais */}
            {(hasMore || loading) && (
              <button
                onClick={onLoadMore}
                disabled={loading}
                className="w-full mt-2 flex items-center justify-center gap-1 py-2 text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50"
              >
                {loading ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
                {loading ? 'Carregando…' : `Carregar mais (${total - data.length} restantes)`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SlaSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-14 bg-gray-100 rounded-lg" />
      ))}
    </div>
  )
}
