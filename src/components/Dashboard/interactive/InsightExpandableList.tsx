// =====================================================
// InsightExpandableList
// Lista inline expansível dentro de um insight card.
// Renderiza apenas quando expanded=true (lazy).
// Suporte a opportunities (padrão) e conversations.
//
// Sem navegação de rota — ações abrem modais inline.
// =====================================================

import React, { useMemo } from 'react'
import { MessageCircle, Eye, AlertCircle } from 'lucide-react'
import { useEntityList, type EntityListFilters } from '../../../hooks/dashboard/useEntityList'
import type { InsightItem, OpportunityItem, ConversationItem, DashboardFilters } from '../../../services/dashboardApi'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface InsightExpandableListProps {
  insight:          InsightItem
  dashboardFilters: DashboardFilters
  onOpenChat:       (leadId: number) => void
  onOpenOpportunity:(item: OpportunityItem) => void
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
      {/* Nome + etapa */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{item.lead_name || item.title}</p>
        <p className="text-xs opacity-50 truncate">{item.stage_name || '—'}</p>
      </div>

      {/* Probabilidade */}
      <div className="w-14 text-right flex-shrink-0">
        <span className={`text-xs font-semibold ${item.probability >= 70 ? 'text-green-600' : item.probability >= 40 ? 'text-yellow-600' : 'text-red-500'}`}>
          {item.probability}%
        </span>
      </div>

      {/* Última interação */}
      <div className="w-20 text-right flex-shrink-0">
        <span className="text-xs opacity-50">{formatRelativeDate(interactionDate)}</span>
      </div>

      {/* Ações */}
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
}) => {
  const entityType = resolveEntityType(insight)
  const filters    = useMemo(() => buildFilters(insight, dashboardFilters), [insight, dashboardFilters])

  const { data, loading, error } = useEntityList(entityType, filters, true)

  // Backend retorna no máximo 10 itens para source=insight_inline.
  // O slice é segurança extra para o caso de outros callers sem limit.
  const items = data.slice(0, 10)

  return (
    <div className="mt-2 rounded-md bg-white/50 border border-current/10 overflow-hidden">
      {/* Cabeçalho da tabela */}
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
      {!loading && !error && items.length === 0 && (
        <div className="px-3 py-4 text-center text-xs opacity-50">
          Nenhum item encontrado para este insight.
        </div>
      )}

      {/* Linhas */}
      {!loading && !error && items.length > 0 && (
        <div>
          {entityType === 'opportunities'
            ? (items as OpportunityItem[]).map((item) => (
                <OpportunityRow
                  key={item.opportunity_id}
                  item={item}
                  onOpenChat={onOpenChat}
                  onOpenOpportunity={onOpenOpportunity}
                />
              ))
            : (items as ConversationItem[]).map((item) => (
                <ConversationRow
                  key={item.conversation_id}
                  item={item}
                  onOpenChat={onOpenChat}
                />
              ))
          }
          {data.length > 10 && (
            <p className="text-center text-xs opacity-40 py-2 border-t border-current/10">
              Mostrando 10 de {data.length} itens
            </p>
          )}
        </div>
      )}
    </div>
  )
}
