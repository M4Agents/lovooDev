// =====================================================
// COMPONENTE: OpportunityDetailModal
// Objetivo: Visualização dos detalhes de uma oportunidade
//           com três abas: Detalhes, Jornada e Status.
//
// Generalizado para qualquer status (open, won, lost).
// Aba "Jornada" usa OpportunityStageTimeline + useOpportunityStageHistory.
// Aba "Status" mantém a linha do tempo de transições de status.
// =====================================================

import { useState, useEffect, useRef } from 'react'
import {
  X, Briefcase, DollarSign, Calendar, TrendingUp,
  FileText, Tag, CheckCircle2, XCircle, RotateCcw,
  Clock, AlertCircle, Route
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency } from '../../types/sales-funnel'
import { useOpportunityStageHistory } from '../../hooks/useOpportunityStageHistory'
import { OpportunityStageTimeline } from './OpportunityStageTimeline'
import type { Opportunity, OpportunityStatusHistory } from '../../types/sales-funnel'

type TabType = 'details' | 'journey' | 'status'

interface OpportunityDetailModalProps {
  isOpen: boolean
  onClose: () => void
  opportunity: Opportunity
  companyId: string
  /** Aba aberta por padrão. Padrão: 'details'. */
  initialTab?: TabType
}

// =====================================================
// Helpers de formatação
// =====================================================

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

// =====================================================
// Configuração visual por status
// =====================================================

const statusConfig: Record<string, {
  label: string; color: string; bg: string
  headerBg: string; headerBorder: string
  iconBg: string; iconColor: string
  icon: React.ReactNode
}> = {
  open: {
    label: 'Em Aberto',
    color: 'text-blue-700',
    bg: 'bg-blue-100',
    headerBg: 'bg-blue-50',
    headerBorder: 'border-blue-100',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    icon: <AlertCircle className="w-3.5 h-3.5" />
  },
  won: {
    label: 'Ganha',
    color: 'text-emerald-700',
    bg: 'bg-emerald-100',
    headerBg: 'bg-emerald-50',
    headerBorder: 'border-emerald-100',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />
  },
  lost: {
    label: 'Perdida',
    color: 'text-red-700',
    bg: 'bg-red-100',
    headerBg: 'bg-red-50',
    headerBorder: 'border-red-100',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
    icon: <XCircle className="w-3.5 h-3.5" />
  }
}

// =====================================================
// TimelineEntry (status history)
// =====================================================

const TimelineEntry: React.FC<{ entry: OpportunityStatusHistory; isLast: boolean }> = ({ entry, isLast }) => {
  const toConfig   = statusConfig[entry.to_status]   ?? statusConfig.open
  const fromConfig = entry.from_status ? (statusConfig[entry.from_status] ?? null) : null

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${toConfig.bg} ${toConfig.color}`}>
          {entry.to_status === 'won'  && <CheckCircle2 className="w-4 h-4" />}
          {entry.to_status === 'lost' && <XCircle className="w-4 h-4" />}
          {entry.to_status === 'open' && <RotateCcw className="w-4 h-4" />}
        </div>
        {!isLast && <div className="w-px flex-1 bg-gray-200 my-1" />}
      </div>

      <div className="pb-4 flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-gray-800">
              {fromConfig ? (
                <span>
                  <span className={fromConfig.color}>{fromConfig.label}</span>
                  {' → '}
                  <span className={toConfig.color}>{toConfig.label}</span>
                </span>
              ) : (
                <span className={toConfig.color}>Status: {toConfig.label}</span>
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

// =====================================================
// Modal principal
// =====================================================

export const OpportunityDetailModal: React.FC<OpportunityDetailModalProps> = ({
  isOpen,
  onClose,
  opportunity,
  companyId,
  initialTab = 'details'
}) => {
  const [activeTab, setActiveTab]       = useState<TabType>(initialTab)
  const [statusHistory, setStatusHistory] = useState<OpportunityStatusHistory[]>([])
  const [loadingStatus, setLoadingStatus] = useState(false)

  const lastEventRef = useRef<HTMLDivElement>(null)

  // Hook de histórico de etapas (só carrega quando o modal está aberto)
  const {
    history: stageHistory,
    usersMap,
    currentEnteredAt,
    loading: loadingStage,
    error: stageError
  } = useOpportunityStageHistory(
    isOpen ? opportunity.id : null,
    companyId
  )

  // Sincronizar aba quando initialTab muda (ex: aberto pelo board sempre em 'journey')
  useEffect(() => {
    if (isOpen) setActiveTab(initialTab)
  }, [isOpen, initialTab])

  // Carregar histórico de status ao abrir
  useEffect(() => {
    if (!isOpen) return
    setLoadingStatus(true)
    supabase
      .from('opportunity_status_history')
      .select('*')
      .eq('opportunity_id', opportunity.id)
      .eq('company_id', companyId)
      .order('changed_at', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setStatusHistory(data)
      })
      .finally(() => setLoadingStatus(false))
  }, [isOpen, opportunity.id, companyId])

  // Auto-scroll para o último evento ao abrir aba Jornada
  useEffect(() => {
    if (activeTab !== 'journey' || loadingStage) return
    const timer = setTimeout(() => {
      lastEventRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, 150)
    return () => clearTimeout(timer)
  }, [activeTab, loadingStage])

  if (!isOpen) return null

  const statusCfg = statusConfig[opportunity.status] ?? statusConfig.open

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'details', label: 'Detalhes',  icon: <FileText className="w-3.5 h-3.5" /> },
    { key: 'journey', label: 'Jornada',   icon: <Route className="w-3.5 h-3.5" /> },
    { key: 'status',  label: 'Status',    icon: <Clock className="w-3.5 h-3.5" /> }
  ]

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
        <div className={`flex items-center gap-3 p-5 border-b ${statusCfg.headerBg} border-${statusCfg.headerBorder} rounded-t-xl`}>
          <div className={`p-2 rounded-lg ${statusCfg.iconBg}`}>
            <Briefcase className={`w-5 h-5 ${statusCfg.iconColor}`} />
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

        {/* Abas */}
        <div className="flex border-b border-gray-200 px-1">
          {tabs.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* Body — scrollável */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ABA: Detalhes */}
          {activeTab === 'details' && (
            <div className="space-y-5">
              {/* Dados do negócio */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Dados do Negócio</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                      <DollarSign className="w-3.5 h-3.5" />
                      Valor
                    </div>
                    <p className={`text-sm font-semibold ${opportunity.status === 'won' ? 'text-emerald-700' : 'text-gray-800'}`}>
                      {opportunity.value > 0 ? formatCurrency(opportunity.value) : '—'}
                    </p>
                  </div>

                  {opportunity.closed_at && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                        <Calendar className="w-3.5 h-3.5" />
                        Fechada em
                      </div>
                      <p className="text-sm font-medium text-gray-800">
                        {formatDateShort(opportunity.closed_at)}
                      </p>
                    </div>
                  )}

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
            </div>
          )}

          {/* ABA: Jornada */}
          {activeTab === 'journey' && (
            <OpportunityStageTimeline
              history={stageHistory}
              usersMap={usersMap}
              currentEnteredAt={currentEnteredAt}
              loading={loadingStage}
              error={stageError}
              lastEventRef={lastEventRef}
            />
          )}

          {/* ABA: Status */}
          {activeTab === 'status' && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                Histórico de Status
              </p>
              {loadingStatus ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                  <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                  Carregando...
                </div>
              ) : statusHistory.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">Nenhum registro de transição de status.</p>
              ) : (
                <div>
                  {statusHistory.map((entry, idx) => (
                    <TimelineEntry
                      key={entry.id}
                      entry={entry}
                      isLast={idx === statusHistory.length - 1}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 pt-0 border-t border-gray-100">
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
