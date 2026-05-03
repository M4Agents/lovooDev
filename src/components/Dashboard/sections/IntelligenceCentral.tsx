// =====================================================
// IntelligenceCentral
// Seção de inteligência automática do Dashboard.
// Exibe até 5 insights calculados por SQL/regras — sem LLM.
//
// Ação "Ver oportunidades" expande lista inline abaixo do card.
// Cache local: lista permanece montada (hidden) após primeiro load —
// reabrir o mesmo insight renderiza instantaneamente sem novo fetch.
// Ações por linha: Chat (ChatModalSimple) e Ver oportunidade
// (OpportunityDetailModal) — sem navegação de rota.
// =====================================================

import React, { useState, useEffect, useCallback } from 'react'
import { Flame, TrendingDown, AlertTriangle, Bot, Clock, ChevronDown, ChevronUp, Settings, Info, Loader2, Brain } from 'lucide-react'
import { InsightExpandableList }  from '../interactive/InsightExpandableList'
import { InsightRulesModal }      from '../settings/InsightRulesModal'
import { AiAnalysisModal }        from '../settings/AiAnalysisModal'
import { OpportunityDetailModal } from '../../SalesFunnel/OpportunityDetailModal'
import ChatModalSimple            from '../../SalesFunnel/ChatModalSimple'
import { funnelApi }              from '../../../services/funnelApi'
import { useAuth }                from '../../../contexts/AuthContext'
import { useDashboardAiAnalysis } from '../../../hooks/dashboard/useDashboardAiAnalysis'
import type { Opportunity }       from '../../../types/sales-funnel'
import type { InsightItem, InsightPriority, InsightType, DashboardFilters, OpportunityItem } from '../../../services/dashboardApi'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface IntelligenceCentralProps {
  data:              InsightItem[]
  loading:           boolean
  error:             string | null
  canCustomize:      boolean
  canAiAnalysis:     boolean
  dashboardFilters:  DashboardFilters
  periodLabel:       string
  companyId:         string | null
  resumeAnalysisId?: string | null
  onRefetchInsights: () => void
}

// ---------------------------------------------------------------------------
// Configuração visual
// ---------------------------------------------------------------------------

const TYPE_CONFIG: Record<InsightType, { icon: React.ReactNode; label: string }> = {
  hot_opportunity:    { icon: <Flame        size={16} />, label: 'Oportunidade' },
  cooling_opportunity:{ icon: <Clock        size={16} />, label: 'Atenção'      },
  funnel_bottleneck:  { icon: <AlertTriangle size={16} />, label: 'Gargalo'    },
  conversion_drop:    { icon: <TrendingDown  size={16} />, label: 'Conversão'  },
  ai_tool_issue:      { icon: <Bot          size={16} />, label: 'IA'          },
}

const PRIORITY_COLORS: Record<InsightPriority, string> = {
  critical: 'bg-white border-gray-200 text-gray-800',
  high:     'bg-white border-gray-200 text-gray-800',
  medium:   'bg-white border-gray-200 text-gray-800',
  low:      'bg-white border-gray-200 text-gray-800',
}

const PRIORITY_LEFT_BORDER: Record<InsightPriority, string> = {
  critical: 'border-l-red-400',
  high:     'border-l-orange-400',
  medium:   'border-l-yellow-400',
  low:      'border-l-blue-400',
}

const PRIORITY_BADGE: Record<InsightPriority, string> = {
  critical: 'bg-red-100 text-red-700',
  high:     'bg-orange-100 text-orange-700',
  medium:   'bg-yellow-100 text-yellow-700',
  low:      'bg-blue-100 text-blue-700',
}

const PRIORITY_LABEL: Record<InsightPriority, string> = {
  critical: 'Crítico',
  high:     'Alto',
  medium:   'Médio',
  low:      'Baixo',
}

// ---------------------------------------------------------------------------
// formatInsightReason
// ---------------------------------------------------------------------------

function formatInsightReason(insight: InsightItem): string | null {
  const sd = insight.supporting_data
  if (!sd) return null

  switch (insight.type) {
    case 'cooling_opportunity': {
      const threshold = sd.threshold_days as number | undefined
      if (!threshold) return null
      const days = sd.days_since_last_interaction as number | undefined
      const base = `Regra: oportunidades sem interação há mais de ${threshold} dia${threshold !== 1 ? 's' : ''}.`
      if (days != null && days > 0) {
        return `${base} Caso mais crítico: ${days} dia${days !== 1 ? 's' : ''} sem interação.`
      }
      return base
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// InsightCard — card + lista expansível
// ---------------------------------------------------------------------------

interface InsightCardProps {
  insight:          InsightItem
  dashboardFilters: DashboardFilters
  isExpanded:       boolean
  onToggle:         () => void
  onOpenChat:       (leadId: number) => void
  onOpenOpportunity:(item: OpportunityItem) => void
}

function InsightCard({
  insight,
  dashboardFilters,
  isExpanded,
  onToggle,
  onOpenChat,
  onOpenOpportunity,
}: InsightCardProps) {
  const cfg        = TYPE_CONFIG[insight.type]
  const cardClass  = PRIORITY_COLORS[insight.priority]
  const leftBorder = PRIORITY_LEFT_BORDER[insight.priority]
  const badgeClass = PRIORITY_BADGE[insight.priority]
  const reason     = formatInsightReason(insight)

  // Cache: lista permanece montada após o primeiro expand.
  // Usando useRef em vez de useEffect para evitar ciclo de render extra —
  // wasExpanded é atualizado sincronamente durante o render.
  const wasExpandedRef = React.useRef(false)
  if (isExpanded) wasExpandedRef.current = true
  const wasExpanded = wasExpandedRef.current

  const [listLoading, setListLoading] = useState(false)

  const handleLoadingChange = useCallback((loading: boolean) => {
    // #region agent log
    console.log('[DBG-254195][handleLoadingChange]', {loading})
    // #endregion
    setListLoading(loading)
  }, [])

  // Ao clicar para expandir pela primeira vez: ativa spinner imediatamente,
  // no mesmo ciclo do clique — sem esperar callback assíncrono de efeitos.
  function handleToggleWithLoading() {
    if (!isExpanded && !wasExpandedRef.current) {
      setListLoading(true)
    }
    onToggle()
  }

  return (
    <div className={`rounded-lg border-l-4 border ${leftBorder} ${cardClass}`}>
      {/* Linha principal */}
      <div className="flex items-start gap-3 p-3">
        <div className="mt-0.5 flex-shrink-0 opacity-70">{cfg.icon}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${badgeClass}`}>
              {PRIORITY_LABEL[insight.priority]}
            </span>
            <span className="text-xs opacity-60">{cfg.label}</span>
          </div>
          <p className="text-sm font-semibold leading-snug truncate">{insight.title}</p>
          <p className="text-xs opacity-70 mt-0.5 leading-snug">{insight.description}</p>
        </div>

        {/* Botão de expansão — mostra spinner enquanto os dados carregam */}
        {/* #region agent log */}
        {/* Log H-E: valores no render do botão */}
        {(() => { if(isExpanded) console.log('[DBG-254195][button-render]', {isExpanded, listLoading, wasExpanded, showSpinner: isExpanded && listLoading}); return null })()}
        {/* #endregion */}
        <button
          type="button"
          onClick={handleToggleWithLoading}
          disabled={isExpanded && listLoading}
          className="flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded-md border border-current/20 hover:bg-current/10 transition-colors flex-shrink-0 whitespace-nowrap disabled:opacity-70"
        >
          {isExpanded && listLoading
            ? <><Loader2 size={12} className="animate-spin" /> Carregando...</>
            : <>{insight.actionLabel}{isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</>
          }
        </button>
      </div>

      {/* Bloco "Por que apareceu?" */}
      {reason && (
        <div className="mx-3 mb-3 flex items-start gap-1.5 rounded-md bg-gray-50 border border-gray-100 px-2 py-1.5">
          <Info size={11} className="text-gray-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500 leading-relaxed">{reason}</p>
        </div>
      )}

      {/* Lista inline: montada uma vez, oculta quando fechada (cache via CSS hidden) */}
      {wasExpanded && (
        <div className={isExpanded ? undefined : 'hidden'} aria-hidden={!isExpanded}>
          <div className="px-3 pb-3">
            <InsightExpandableList
              insight={insight}
              dashboardFilters={dashboardFilters}
              onOpenChat={onOpenChat}
              onOpenOpportunity={onOpenOpportunity}
              onLoadingChange={handleLoadingChange}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// IntelligenceCentral
// ---------------------------------------------------------------------------

export const IntelligenceCentral: React.FC<IntelligenceCentralProps> = ({
  data,
  loading,
  error,
  canCustomize,
  canAiAnalysis,
  dashboardFilters,
  periodLabel,
  companyId,
  resumeAnalysisId,
  onRefetchInsights,
}) => {
  const { user } = useAuth()

  // Expansão inline
  const [expandedInsightId, setExpandedInsightId] = useState<string | null>(null)

  // Modal de chat
  const [chatLeadId, setChatLeadId] = useState<number | null>(null)
  const [chatOpen,   setChatOpen]   = useState(false)

  // Modal de oportunidade
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null)
  const [oppModalOpen,        setOppModalOpen]        = useState(false)
  const [loadingOpp,          setLoadingOpp]          = useState(false)

  // Modal de configuração
  const [rulesModalOpen, setRulesModalOpen] = useState(false)

  // IA Analítica
  const ai = useDashboardAiAnalysis(companyId)

  // Abrir modal de IA ao retornar do checkout com resume_analysis
  useEffect(() => {
    if (resumeAnalysisId) {
      void ai.open(resumeAnalysisId)
    }
  }, [resumeAnalysisId]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleToggle(insightId: string) {
    setExpandedInsightId((prev) => (prev === insightId ? null : insightId))
  }

  function handleOpenChat(leadId: number) {
    setChatLeadId(leadId)
    setChatOpen(true)
  }

  async function handleOpenOpportunity(item: OpportunityItem) {
    setLoadingOpp(true)
    try {
      const opp = await funnelApi.getOpportunityById(item.opportunity_id)
      if (opp) {
        setSelectedOpportunity(opp)
        setOppModalOpen(true)
      }
    } catch {
      // falha silenciosa — oportunidade não encontrada
    } finally {
      setLoadingOpp(false)
    }
  }

  function handleSaved() {
    setRulesModalOpen(false)
    onRefetchInsights()
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Inteligência Comercial</h2>
          <p className="text-xs text-gray-500 mt-0.5">Baseada em comportamento real</p>
          <p className="text-xs text-gray-400 mt-0.5">Insights automáticos · {periodLabel}</p>
        </div>

        {canCustomize && (
          <button
            type="button"
            onClick={() => setRulesModalOpen(true)}
            className="flex items-center gap-1.5 text-xs text-indigo-600 border border-indigo-200 rounded-md px-2.5 py-1.5 hover:bg-indigo-50 transition-colors"
          >
            <Settings size={12} />
            Configurar regras
          </button>
        )}

        {canAiAnalysis && (
          <button
            type="button"
            onClick={() => ai.open()}
            className="flex items-center gap-1.5 text-xs text-purple-700 border border-purple-200 rounded-md px-2.5 py-1.5 hover:bg-purple-50 transition-colors"
          >
            <Brain size={12} />
            Análise com IA
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-lg" />
          ))}
        </div>
      )}

      {/* Erro */}
      {!loading && error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Vazio */}
      {!loading && !error && data.length === 0 && (
        <div className="rounded-lg bg-gray-50 border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          Nenhum insight crítico no período selecionado
        </div>
      )}

      {/* Lista de insights */}
      {!loading && !error && data.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {data.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              dashboardFilters={dashboardFilters}
              isExpanded={expandedInsightId === insight.id}
              onToggle={() => handleToggle(insight.id)}
              onOpenChat={handleOpenChat}
              onOpenOpportunity={handleOpenOpportunity}
            />
          ))}
        </div>
      )}

      {/* Indicador de carregamento de oportunidade */}
      {loadingOpp && (
        <div className="fixed bottom-4 right-4 z-40 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-2 text-sm text-gray-600 flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          Carregando oportunidade...
        </div>
      )}

      {/* Modal de configuração de regras */}
      <InsightRulesModal
        isOpen={rulesModalOpen}
        onClose={() => setRulesModalOpen(false)}
        onSaved={handleSaved}
        companyId={companyId}
      />

      {/* Modal de chat */}
      {chatLeadId != null && companyId && user?.id && (
        <ChatModalSimple
          isOpen={chatOpen}
          onClose={() => { setChatOpen(false); setChatLeadId(null) }}
          leadId={chatLeadId}
          companyId={companyId}
          userId={user.id}
        />
      )}

      {/* Modal de oportunidade */}
      {selectedOpportunity && companyId && (
        <OpportunityDetailModal
          isOpen={oppModalOpen}
          onClose={() => { setOppModalOpen(false); setSelectedOpportunity(null) }}
          opportunity={selectedOpportunity}
          companyId={companyId}
        />
      )}

      {/* Modal de IA Analítica */}
      <AiAnalysisModal
        isOpen={ai.step !== 'closed'}
        step={ai.step}
        analysisType={ai.analysisType}
        analysisId={ai.analysisId}
        result={ai.result}
        creditInfo={ai.creditInfo}
        error={ai.error}
        loading={ai.loading}
        history={ai.history}
        historyLoading={ai.historyLoading}
        funnelId={dashboardFilters.funnelId}
        onClose={ai.close}
        onSelectType={ai.selectType}
        onBack={ai.backToSelecting}
        onExecute={() => ai.execute(dashboardFilters.funnelId)}
        onContinue={ai.continueAfterCredits}
        onViewAnalysis={ai.viewAnalysis}
        onOpenHistory={ai.openHistory}
        onInitiateCheckout={ai.initiateCheckout}
        onReset={ai.reset}
      />
    </div>
  )
}
