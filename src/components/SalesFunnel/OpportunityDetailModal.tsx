// =====================================================
// COMPONENTE: OpportunityDetailModal
// Objetivo: Visualização read-only dos detalhes de uma
//           oportunidade fechada (won/lost), incluindo
//           linha do tempo de transições de status.
// =====================================================

import { useState, useEffect } from 'react'
import {
  X, Briefcase, DollarSign, Calendar, TrendingUp,
  FileText, Tag, CheckCircle2, XCircle, RotateCcw,
  Clock, AlertCircle
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency } from '../../types/sales-funnel'
import type { Opportunity, OpportunityStatusHistory } from '../../types/sales-funnel'

interface OpportunityDetailModalProps {
  isOpen: boolean
  onClose: () => void
  opportunity: Opportunity
  companyId: string
}

const formatDateTime = (iso?: string): string => {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(iso))
}

const formatDateShort = (iso?: string): string => {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(new Date(iso))
}

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  open: {
    label: 'Em Aberto',
    color: 'text-blue-700',
    bg: 'bg-blue-100',
    icon: <AlertCircle className="w-3.5 h-3.5" />
  },
  won: {
    label: 'Ganha',
    color: 'text-emerald-700',
    bg: 'bg-emerald-100',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />
  },
  lost: {
    label: 'Perdida',
    color: 'text-red-700',
    bg: 'bg-red-100',
    icon: <XCircle className="w-3.5 h-3.5" />
  }
}

const TimelineEntry: React.FC<{ entry: OpportunityStatusHistory; isLast: boolean }> = ({ entry, isLast }) => {
  const toConfig = statusConfig[entry.to_status] ?? statusConfig.open
  const fromConfig = entry.from_status ? statusConfig[entry.from_status] : null

  return (
    <div className="flex gap-3">
      {/* Linha vertical */}
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${toConfig.bg} ${toConfig.color}`}>
          {entry.to_status === 'won' && <CheckCircle2 className="w-4 h-4" />}
          {entry.to_status === 'lost' && <XCircle className="w-4 h-4" />}
          {entry.to_status === 'open' && <RotateCcw className="w-4 h-4" />}
        </div>
        {!isLast && <div className="w-px flex-1 bg-gray-200 my-1" />}
      </div>

      {/* Conteúdo */}
      <div className={`pb-4 flex-1 min-w-0 ${isLast ? '' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-gray-800">
              {fromConfig ? (
                <span>
                  <span className={`${fromConfig.color}`}>{fromConfig.label}</span>
                  {' → '}
                  <span className={`${toConfig.color}`}>{toConfig.label}</span>
                </span>
              ) : (
                <span className={toConfig.color}>Status definido: {toConfig.label}</span>
              )}
            </p>
            {entry.loss_reason && (
              <p className="text-xs text-gray-500 mt-0.5">Motivo: {entry.loss_reason}</p>
            )}
            {entry.value_snapshot != null && entry.value_snapshot > 0 && (
              <p className="text-xs text-gray-500 mt-0.5">
                Valor: <span className="font-medium text-gray-700">{formatCurrency(entry.value_snapshot)}</span>
              </p>
            )}
          </div>
          <span className="text-xs text-gray-400 flex-shrink-0 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDateTime(entry.changed_at)}
          </span>
        </div>
      </div>
    </div>
  )
}

export const OpportunityDetailModal: React.FC<OpportunityDetailModalProps> = ({
  isOpen,
  onClose,
  opportunity,
  companyId
}) => {
  const [history, setHistory] = useState<OpportunityStatusHistory[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    const fetchHistory = async () => {
      setLoadingHistory(true)
      try {
        const { data, error } = await supabase
          .from('opportunity_status_history')
          .select('*')
          .eq('opportunity_id', opportunity.id)
          .eq('company_id', companyId)
          .order('changed_at', { ascending: true })

        if (!error && data) setHistory(data)
      } finally {
        setLoadingHistory(false)
      }
    }

    fetchHistory()
  }, [isOpen, opportunity.id, companyId])

  if (!isOpen) return null

  const statusCfg = statusConfig[opportunity.status] ?? statusConfig.open
  const isWon = opportunity.status === 'won'
  const headerBg = isWon ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'
  const iconBg   = isWon ? 'bg-emerald-100' : 'bg-red-100'
  const iconColor = isWon ? 'text-emerald-600' : 'text-red-600'

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center gap-3 p-5 border-b ${headerBg} rounded-t-xl`}>
          <div className={`p-2 rounded-lg ${iconBg}`}>
            <Briefcase className={`w-5 h-5 ${iconColor}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-gray-900 truncate">{opportunity.title}</h2>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 ${statusCfg.bg} ${statusCfg.color}`}>
                {statusCfg.icon}
                {statusCfg.label}
              </span>
            </div>
            {opportunity.description && (
              <p className="text-sm text-gray-500 truncate mt-0.5">{opportunity.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — scrollável */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Dados do negócio */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Dados do Negócio</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                  <DollarSign className="w-3.5 h-3.5" />
                  Valor Final
                </div>
                <p className={`text-sm font-semibold ${isWon ? 'text-emerald-700' : 'text-gray-800'}`}>
                  {opportunity.value > 0 ? formatCurrency(opportunity.value) : '—'}
                </p>
              </div>

              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                  <Calendar className="w-3.5 h-3.5" />
                  Fechada em
                </div>
                <p className="text-sm font-medium text-gray-800">
                  {formatDateShort(opportunity.closed_at)}
                </p>
              </div>

              {opportunity.loss_reason && (
                <div className="col-span-2 bg-red-50 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-xs text-red-500 mb-1">
                    <XCircle className="w-3.5 h-3.5" />
                    Motivo da Perda
                  </div>
                  <p className="text-sm text-gray-800">{opportunity.loss_reason}</p>
                </div>
              )}
            </div>
          </div>

          {/* Informações gerais */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Informações</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Probabilidade
                </div>
                <p className="text-sm font-medium text-gray-800">{opportunity.probability}%</p>
              </div>

              {opportunity.expected_close_date && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                    <Calendar className="w-3.5 h-3.5" />
                    Previsão
                  </div>
                  <p className="text-sm font-medium text-gray-800">
                    {formatDateShort(opportunity.expected_close_date)}
                  </p>
                </div>
              )}

              {opportunity.source && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                    <Tag className="w-3.5 h-3.5" />
                    Origem
                  </div>
                  <p className="text-sm font-medium text-gray-800">{opportunity.source}</p>
                </div>
              )}

              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                  <FileText className="w-3.5 h-3.5" />
                  Criada em
                </div>
                <p className="text-sm font-medium text-gray-800">
                  {formatDateShort(opportunity.created_at)}
                </p>
              </div>
            </div>
          </div>

          {/* Linha do tempo */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Linha do Tempo</p>

            {loadingHistory ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                Carregando histórico...
              </div>
            ) : history.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">Nenhum registro de transição encontrado.</p>
            ) : (
              <div>
                {history.map((entry, idx) => (
                  <TimelineEntry
                    key={entry.id}
                    entry={entry}
                    isLast={idx === history.length - 1}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 pt-0 border-t border-gray-100 mt-0">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
