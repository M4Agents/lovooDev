// =====================================================
// SlaAlertsPanel — Leads sem resposta (SLA).
// Lista acionável ordenada por urgência crescente.
// Paginação incremental: "Carregar mais".
//
// Ação por linha: Chat (MessageCircle) → ChatModalSimple.
// Sem botão de oportunidade — SLA representa conversa
// sem resposta, não necessariamente oportunidade comercial.
//
// Padrão de referência: IntelligenceCentral + useDashboardEntityActions.
// =====================================================

import React, { useState } from 'react'
import { Clock, AlertTriangle, RefreshCw, ChevronDown, MessageCircle, TrendingDown } from 'lucide-react'
import { useDashboardEntityActions } from '../../../hooks/dashboard/useDashboardEntityActions'
import ChatModalSimple               from '../../SalesFunnel/ChatModalSimple'
import { TrendChart }                from '../historical/TrendChart'
import { SnapshotDataGuard }         from '../historical/SnapshotDataGuard'
import type { SlaAlertItem, SlaAlertsMeta, SlaAlertSeverity, SnapshotTrendsData } from '../../../types/dashboard'

interface Props {
  data:                SlaAlertItem[]
  meta:                SlaAlertsMeta | null
  loading:             boolean
  error:               string | null
  companyId?:          string | null
  onRetry?:            () => void
  onLoadMore?:         () => void
  // FASE 4.1 — trendline histórica (opcional)
  snapshotTrends?:     SnapshotTrendsData | null
  snapshotTrendPoints?: number
}

const SEVERITY_CONFIG: Record<SlaAlertSeverity, { label: string; cls: string; bg: string }> = {
  critical: { label: 'Crítico',  cls: 'text-red-700 bg-red-50 border-red-200',         bg: 'border-l-red-500' },
  high:     { label: 'Alto',     cls: 'text-orange-700 bg-orange-50 border-orange-200', bg: 'border-l-orange-400' },
  medium:   { label: 'Médio',    cls: 'text-amber-700 bg-amber-50 border-amber-200',    bg: 'border-l-amber-400' },
  low:      { label: 'Baixo',    cls: 'text-blue-700 bg-blue-50 border-blue-200',       bg: 'border-l-blue-400' },
}

function fmtHours(h: number): string {
  if (h < 24) return `${h.toFixed(0)}h`
  return `${(h / 24).toFixed(1)}d`
}

export function SlaAlertsPanel({
  data,
  meta,
  loading,
  error,
  companyId,
  onRetry,
  onLoadMore,
  snapshotTrends,
  snapshotTrendPoints = 0,
}: Props) {
  const total   = meta?.total ?? 0
  const hasMore = meta?.has_more ?? false

  const [showTrend, setShowTrend] = useState(false)

  const actions = useDashboardEntityActions({ companyId })

  function handleOpenChat(leadId: string) {
    const id = Number(leadId)
    if (!Number.isFinite(id)) return
    actions.openChat(id)
  }

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
        <div className="flex items-center gap-2">
          {/* Botão da trendline — só aparece se houver dados suficientes */}
          <SnapshotDataGuard dataPoints={snapshotTrendPoints} enabled={!!snapshotTrends}>
            <button
              onClick={() => setShowTrend(v => !v)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-600 transition-colors"
              title="Tendência de SLA (últimos 7 dias)"
            >
              <TrendingDown className="w-3.5 h-3.5" />
              {showTrend ? 'Ocultar' : 'Tendência'}
            </button>
          </SnapshotDataGuard>

          {onRetry && (
            <button onClick={onRetry} className="text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
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

                  {/* Ações */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      title="Abrir chat"
                      onClick={() => handleOpenChat(item.lead_id)}
                      className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                    >
                      <MessageCircle size={14} />
                    </button>
                  </div>
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

      {/* FASE 4.1 — Trendline de SLA (colapsável, rodapé discreto) */}
      <SnapshotDataGuard dataPoints={snapshotTrendPoints} enabled={!!snapshotTrends && showTrend}>
        <div className="px-4 pb-4 border-t border-gray-50">
          <p className="text-[10px] text-gray-400 mt-3 mb-1.5 font-medium uppercase tracking-wide">
            Leads com SLA violado — últimos 7 dias
          </p>
          <TrendChart
            series={snapshotTrends!.series}
            metricKey="sla_breached_count"
            lowerIsBetter={true}
            label="Violações"
            height={72}
          />
        </div>
      </SnapshotDataGuard>

      {/* Modal de chat */}
      {actions.chatLeadId != null && actions.companyId && actions.userId && (
        <ChatModalSimple
          isOpen={actions.chatOpen}
          onClose={actions.closeChat}
          leadId={actions.chatLeadId}
          companyId={actions.companyId}
          userId={actions.userId}
        />
      )}
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
