// =====================================================
// InsightExpandableList
// Lista inline compacta dentro de um insight card.
// Layout 2-linhas por item: Nome + Etapa / Prob + Última int. + Ações.
// Ações sempre visíveis e próximas do conteúdo.
//
// Carregamento único de até 10 itens (source=insight_inline).
// Cache via CSS hidden — sem refetch ao reabrir o mesmo card.
// =====================================================

import React, { useState, useMemo, useEffect } from 'react'
import { MessageCircle, Eye, AlertCircle } from 'lucide-react'
import { useEntityList, type EntityListFilters } from '../../../hooks/dashboard/useEntityList'
import type { InsightItem, OpportunityItem, ConversationItem, DashboardFilters } from '../../../services/dashboardApi'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface InsightExpandableListProps {
  insight:           InsightItem
  dashboardFilters:  DashboardFilters
  onOpenChat:        (leadId: number) => void
  onOpenOpportunity: (item: OpportunityItem) => void
  onLoadingChange?:  (loading: boolean) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (diff === 0) return 'hoje'
  if (diff === 1) return 'ontem'
  return `há ${diff}d`
}

function buildFilters(insight: InsightItem, dashboardFilters: DashboardFilters): EntityListFilters {
  const base: EntityListFilters = {
    period:   dashboardFilters.period,
    funnelId: (insight.filters.funnelId as string | null | undefined) ?? dashboardFilters.funnelId ?? null,
    limit:    10,
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
// Skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-9 bg-current/5 animate-pulse rounded" />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Linha de oportunidade — layout compacto 2-linhas
// ---------------------------------------------------------------------------

function OpportunityRow({
  item,
  onOpenChat,
  onOpenOpportunity,
}: {
  item:              OpportunityItem
  onOpenChat:        (leadId: number) => void
  onOpenOpportunity: (item: OpportunityItem) => void
}) {
  const interactionDate = item.last_interaction_at ?? item.updated_at
  const probColor = item.probability >= 70
    ? 'text-green-600'
    : item.probability >= 40
      ? 'text-yellow-600'
      : 'text-red-500'

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-current/5 transition-colors">
      {/* Nome + Etapa */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate leading-tight">
          {item.lead_name || item.title}
        </p>
        <p className="text-xs opacity-50 truncate leading-tight">
          {item.stage_name || '—'}
        </p>
      </div>

      {/* Prob. */}
      <span className={`text-xs font-semibold flex-shrink-0 w-8 text-right ${probColor}`}>
        {item.probability}%
      </span>

      {/* Última interação */}
      <span className="text-xs opacity-50 flex-shrink-0 w-14 text-right">
        {formatRelativeDate(interactionDate)}
      </span>

      {/* Ações — sempre visíveis */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          type="button"
          title="Chat"
          onClick={() => onOpenChat(item.lead_id)}
          className="p-1 rounded hover:bg-current/15 transition-colors"
        >
          <MessageCircle size={12} />
        </button>
        <button
          type="button"
          title="Ver oportunidade"
          onClick={() => onOpenOpportunity(item)}
          className="p-1 rounded hover:bg-current/15 transition-colors"
        >
          <Eye size={12} />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Linha de conversa — layout compacto
// ---------------------------------------------------------------------------

function ConversationRow({
  item,
  onOpenChat,
}: {
  item:        ConversationItem
  onOpenChat:  (leadId: number) => void
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-current/5 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate leading-tight">{item.lead_name}</p>
        <p className="text-xs opacity-50 truncate leading-tight">{item.status}</p>
      </div>
      <span className="text-xs opacity-50 flex-shrink-0 w-14 text-right">
        {formatRelativeDate(item.last_message_at)}
      </span>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          type="button"
          title="Chat"
          onClick={() => onOpenChat(0)}
          className="p-1 rounded hover:bg-current/15 transition-colors"
        >
          <MessageCircle size={12} />
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

  const total = meta?.total ?? data.length

  return (
    <div className="mt-2 rounded-md bg-white/50 border border-current/10 overflow-hidden">

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
      {!loading && !error && data.length === 0 && (
        <div className="px-3 py-4 text-center text-xs opacity-50">
          Nenhum item encontrado para este insight.
        </div>
      )}

      {/* Lista */}
      {!loading && !error && data.length > 0 && (
        <>
          <div className="px-1 pt-1">
            {entityType === 'opportunities'
              ? (data as OpportunityItem[]).map((item) => (
                  <OpportunityRow
                    key={item.opportunity_id}
                    item={item}
                    onOpenChat={onOpenChat}
                    onOpenOpportunity={onOpenOpportunity}
                  />
                ))
              : (data as ConversationItem[]).map((item) => (
                  <ConversationRow
                    key={item.conversation_id}
                    item={item}
                    onOpenChat={onOpenChat}
                  />
                ))
            }
          </div>

          {/* Rodapé */}
          <div className="px-3 py-1.5 border-t border-current/10 bg-current/5">
            <p className="text-xs opacity-40">
              {total === 1 ? '1 item' : `${data.length}${total > data.length ? ` de ${total}` : ''} itens`}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
