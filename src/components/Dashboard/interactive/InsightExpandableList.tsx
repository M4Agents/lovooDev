// =====================================================
// InsightExpandableList
// Lista inline expansível dentro de um insight card.
// Renderiza apenas quando expanded=true (lazy).
// Suporte a opportunities (padrão) e conversations.
//
// Carregamento progressivo: busca 30 itens de uma vez,
// exibe 10 por vez com botão "Carregar mais" — sem drawer.
// =====================================================

import React, { useState, useMemo, useEffect } from 'react'
import { MessageCircle, Eye, AlertCircle, ChevronDown } from 'lucide-react'
import { useEntityList, type EntityListFilters } from '../../../hooks/dashboard/useEntityList'
import type { InsightItem, OpportunityItem, ConversationItem, DashboardFilters } from '../../../services/dashboardApi'

const PAGE_SIZE = 10

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface InsightExpandableListProps {
  insight:          InsightItem
  dashboardFilters: DashboardFilters
  onOpenChat:       (leadId: number) => void
  onOpenOpportunity:(item: OpportunityItem) => void
  onLoadingChange?: (loading: boolean) => void
}

// ---------------------------------------------------------------------------
// Helpers de formatação
// ---------------------------------------------------------------------------

function formatRelativeDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (diff === 0) return 'hoje'
  if (diff === 1) return 'ontem'
  return `há ${diff} dias`
}

function buildFilters(insight: InsightItem, dashboardFilters: DashboardFilters): EntityListFilters {
  const base: EntityListFilters = {
    period:   dashboardFilters.period,
    funnelId: (insight.filters.funnelId as string | null | undefined) ?? dashboardFilters.funnelId ?? null,
    limit:    30,
    source:   'insight_inline',
  }
  if (insight.filters.stage_id)        base.stage_id        = insight.filters.stage_id as string
  if (insight.filters.status)          base.status          = insight.filters.status as string
  if (insight.filters.probability_min) base.probability_min = insight.filters.probability_min as number
  return base
}

function resolveEntityType(insight: InsightItem): 'opportunities' | 'conversations' {
  if (insight.entityType === 'conversations') return 'conversations'
  return 'opportunities'
}

// ---------------------------------------------------------------------------
// Skeleton de loading
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-10 bg-current/5 animate-pulse rounded-md" />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Linha de oportunidade
// ---------------------------------------------------------------------------

function OpportunityRow({
  item,
  onOpenChat,
  onOpenOpportunity,
}: {
  item: OpportunityItem
  onOpenChat: (leadId: number) => void
  onOpenOpportunity: (item: OpportunityItem) => void
}) {
  const interactionDate = item.last_interaction_at ?? item.updated_at
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-current/5 transition-colors group">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{item.lead_name || item.title}</p>
        <p className="text-xs opacity-50 truncate">{item.stage_name || '—'}</p>
      </div>
      <div className="w-14 text-right flex-shrink-0">
        <span className={`text-xs font-semibold ${item.probability >= 70 ? 'text-green-600' : item.probability >= 40 ? 'text-yellow-600' : 'text-red-500'}`}>
          {item.probability}%
        </span>
      </div>
      <div className="w-20 text-right flex-shrink-0">
        <span className="text-xs opacity-50">{formatRelativeDate(interactionDate)}</span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          title="Chat"
          onClick={() => onOpenChat(item.lead_id)}
          className="p-1 rounded hover:bg-current/10 transition-colors"
        >
          <MessageCircle size={13} />
        </button>
        <button
          type="button"
          title="Ver oportunidade"
          onClick={() => onOpenOpportunity(item)}
          className="p-1 rounded hover:bg-current/10 transition-colors"
        >
          <Eye size={13} />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Linha de conversa
// ---------------------------------------------------------------------------

function ConversationRow({
  item,
  onOpenChat,
}: {
  item: ConversationItem
  onOpenChat: (leadId: number) => void
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-current/5 transition-colors group">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{item.lead_name}</p>
        <p className="text-xs opacity-50 truncate">{item.status}</p>
      </div>
      <div className="w-20 text-right flex-shrink-0">
        <span className="text-xs opacity-50">{formatRelativeDate(item.last_message_at)}</span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          title="Chat"
          onClick={() => onOpenChat(0)}
          className="p-1 rounded hover:bg-current/10 transition-colors"
        >
          <MessageCircle size={13} />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// InsightExpandableList
// ---------------------------------------------------------------------------

export const InsightExpandableList: React.FC<InsightExpandableListProps> = ({
  insight,
  dashboardFilters,
  onOpenChat,
  onOpenOpportunity,
  onLoadingChange,
}) => {
  const entityType = resolveEntityType(insight)
  const filters    = useMemo(() => buildFilters(insight, dashboardFilters), [insight, dashboardFilters])

  const { data, meta, loading, error } = useEntityList(entityType, filters, true)

  // #region agent log
  useEffect(() => {
    console.log('[DBG-254195][mount] InsightExpandableList montado', {loading_initial: loading, entityType, onLoadingChange_defined: !!onLoadingChange})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // #endregion

  // Notifica o card pai quando loading muda (spinner no botão de expansão)
  useEffect(() => {
    // #region agent log
    console.log('[DBG-254195][loading-effect]', {loading, onLoadingChange_defined: !!onLoadingChange})
    // #endregion
    onLoadingChange?.(loading)
  }, [loading, onLoadingChange])

  // Controle de quantos itens estão visíveis.
  // Resetar ao mudar os dados (novo filtro/período).
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE)
  useEffect(() => {
    setDisplayCount(PAGE_SIZE)
  }, [data])

  const total        = meta?.total ?? 0
  const visibleItems = data.slice(0, displayCount)
  // Itens carregados localmente além do displayCount atual
  const moreInMemory = data.length - displayCount
  // Itens ainda não buscados (além dos 30 do batch inicial)
  const remaining    = total - displayCount

  function handleLoadMore() {
    setDisplayCount(prev => prev + PAGE_SIZE)
  }

  return (
    <div className="mt-2 rounded-md bg-white/50 border border-current/10 overflow-hidden">
      {/* Cabeçalho */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-current/10 bg-current/5">
        <span className="flex-1 text-xs font-medium opacity-60">Nome</span>
        {entityType === 'opportunities' && (
          <>
            <span className="w-14 text-right text-xs font-medium opacity-60">Prob.</span>
            <span className="w-20 text-right text-xs font-medium opacity-60">Última int.</span>
          </>
        )}
        {entityType === 'conversations' && (
          <span className="w-20 text-right text-xs font-medium opacity-60">Último msg</span>
        )}
        <span className="w-12 flex-shrink-0" />
      </div>

      {/* Loading */}
      {loading && <LoadingSkeleton />}

      {/* Erro */}
      {!loading && error && (
        <div className="flex items-center gap-2 px-3 py-3 text-xs opacity-70">
          <AlertCircle size={13} />
          {error}
        </div>
      )}

      {/* Vazio */}
      {!loading && !error && visibleItems.length === 0 && (
        <div className="px-3 py-4 text-center text-xs opacity-50">
          Nenhum item encontrado para este insight.
        </div>
      )}

      {/* Linhas visíveis */}
      {!loading && !error && visibleItems.length > 0 && (
        <div>
          {entityType === 'opportunities'
            ? (visibleItems as OpportunityItem[]).map((item) => (
                <OpportunityRow
                  key={item.opportunity_id}
                  item={item}
                  onOpenChat={onOpenChat}
                  onOpenOpportunity={onOpenOpportunity}
                />
              ))
            : (visibleItems as ConversationItem[]).map((item) => (
                <ConversationRow
                  key={item.conversation_id}
                  item={item}
                  onOpenChat={onOpenChat}
                />
              ))
          }

          {/* Rodapé: contador + botão Carregar mais */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-current/10 bg-current/5">
            <p className="text-xs opacity-50">
              {displayCount >= total
                ? `${total} ${total === 1 ? 'item' : 'itens'}`
                : `Mostrando ${displayCount} de ${total}`}
            </p>
            {moreInMemory > 0 && (
              <button
                type="button"
                onClick={handleLoadMore}
                className="flex items-center gap-1 text-xs font-medium underline underline-offset-2 opacity-70 hover:opacity-100 transition-opacity"
              >
                <ChevronDown size={11} />
                Carregar mais ({Math.min(PAGE_SIZE, moreInMemory)} de {remaining} restantes)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
