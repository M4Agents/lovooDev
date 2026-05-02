// =====================================================
// ActionCenter
// Seção de ações rápidas do Dashboard.
// Cards em grid 2 colunas com listas inline expansíveis —
// mesmo padrão de cache (wasExpandedRef) dos InsightCards.
// NÃO usa drawer lateral.
// =====================================================

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { Users, TrendingUp, ChevronDown, ChevronUp, Loader2, AlertCircle } from 'lucide-react'
import { useEntityList, type EntityType, type EntityListFilters } from '../../../hooks/dashboard/useEntityList'
import { trackEvent }            from '../../../lib/analytics/trackEvent'
import type { DashboardFilters, LeadItem, ConversationItem } from '../../../services/dashboardApi'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface ActionCenterProps {
  dashboardFilters: DashboardFilters
  periodLabel:      string
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

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ListSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-9 bg-gray-100 animate-pulse rounded" />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Linhas de lead e conversa
// ---------------------------------------------------------------------------

function LeadRow({ item }: { item: LeadItem }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-800 truncate leading-tight">{item.name}</p>
        <p className="text-xs text-gray-400 truncate leading-tight">{item.origin || '—'}</p>
      </div>
      <span className="text-xs text-gray-400 flex-shrink-0 w-14 text-right">
        {formatRelativeDate(item.created_at)}
      </span>
      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 flex-shrink-0">
        {item.status}
      </span>
    </div>
  )
}

function ConversationRow({ item }: { item: ConversationItem }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-800 truncate leading-tight">{item.lead_name}</p>
        <p className="text-xs text-gray-400 truncate leading-tight">{item.status}</p>
      </div>
      <span className="text-xs text-gray-400 flex-shrink-0 w-14 text-right">
        {formatRelativeDate(item.last_message_at)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActionExpandableList — lista inline para o ActionCenter
// ---------------------------------------------------------------------------

interface ActionExpandableListProps {
  entityType:      EntityType
  filters:         EntityListFilters
  onLoadingChange: (loading: boolean) => void
}

function ActionExpandableList({ entityType, filters, onLoadingChange }: ActionExpandableListProps) {
  const { data, meta, loading, error } = useEntityList(entityType, filters, true)

  useEffect(() => {
    onLoadingChange(loading)
  }, [loading, onLoadingChange])

  const total = meta?.total ?? data.length

  return (
    <div className="mt-2 rounded-md border border-gray-100 bg-gray-50 overflow-hidden">

      {loading && <ListSkeleton />}

      {!loading && error && (
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-gray-500">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {!loading && !error && data.length === 0 && (
        <div className="px-3 py-4 text-center text-xs text-gray-400">
          Nenhum item encontrado no período.
        </div>
      )}

      {!loading && !error && data.length > 0 && (
        <>
          <div className="px-1 pt-1">
            {entityType === 'leads'
              ? (data as LeadItem[]).map((item) => (
                  <LeadRow key={item.lead_id} item={item} />
                ))
              : (data as ConversationItem[]).map((item) => (
                  <ConversationRow key={item.conversation_id} item={item} />
                ))
            }
          </div>
          <div className="px-3 py-1.5 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              {total === 1 ? '1 item' : `${data.length}${total > data.length ? ` de ${total}` : ''} itens`}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActionCard — card individual com expansão inline
// ---------------------------------------------------------------------------

interface ActionCardConfig {
  id:          string
  icon:        React.ReactNode
  iconBg:      string
  title:       string
  description: string
  buttonLabel: string
  entityType:  EntityType
}

interface ActionCardProps extends ActionCardConfig {
  baseFilters: EntityListFilters
}

function ActionCard({
  id,
  icon,
  iconBg,
  title,
  description,
  buttonLabel,
  entityType,
  baseFilters,
}: ActionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const wasExpandedRef = useRef(false)
  if (isExpanded) wasExpandedRef.current = true
  const wasExpanded = wasExpandedRef.current

  const [listLoading, setListLoading] = useState(false)

  const handleLoadingChange = useCallback((loading: boolean) => {
    setListLoading(loading)
  }, [])

  function handleToggle() {
    if (!isExpanded && !wasExpandedRef.current) {
      setListLoading(true)
    }
    trackEvent('dashboard_open_action', { source: 'action_center', entityType, card: id })
    setIsExpanded(prev => !prev)
  }

  const filters = useMemo<EntityListFilters>(() => ({
    ...baseFilters,
    limit:  10,
    source: 'action_inline',
  }), [baseFilters])

  return (
    <div className="rounded-xl border border-gray-100 bg-white hover:border-gray-200 transition-all">
      {/* Cabeçalho do card */}
      <div className="flex items-center gap-3 p-3">
        <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="text-xs text-gray-500 truncate">{description}</p>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          disabled={isExpanded && listLoading}
          className={[
            'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5',
            'text-xs font-medium rounded-lg transition-colors',
            'bg-gray-50 text-gray-700 border border-gray-200',
            'hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200',
            'disabled:opacity-70',
          ].join(' ')}
        >
          {isExpanded && listLoading
            ? <><Loader2 size={12} className="animate-spin" /> Carregando...</>
            : <>{buttonLabel}{isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</>
          }
        </button>
      </div>

      {/* Lista inline: permanece montada após o primeiro expand (cache via CSS hidden) */}
      {wasExpanded && (
        <div className={isExpanded ? undefined : 'hidden'} aria-hidden={!isExpanded}>
          <div className="px-3 pb-3">
            <ActionExpandableList
              entityType={entityType}
              filters={filters}
              onLoadingChange={handleLoadingChange}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActionCenter
// ---------------------------------------------------------------------------

export const ActionCenter: React.FC<ActionCenterProps> = ({
  dashboardFilters,
  periodLabel,
}) => {
  const baseFilters: EntityListFilters = {
    period:   dashboardFilters.period,
    funnelId: dashboardFilters.funnelId ?? null,
  }

  const cards: ActionCardConfig[] = [
    {
      id:          'recent-leads',
      icon:        <Users size={18} className="text-blue-600" />,
      iconBg:      'bg-blue-50',
      title:       'Leads recentes',
      description: `Novos leads · No período: ${periodLabel}`,
      buttonLabel: 'Ver leads',
      entityType:  'leads',
    },
    {
      id:          'active-conversations',
      icon:        <TrendingUp size={18} className="text-green-600" />,
      iconBg:      'bg-green-50',
      title:       'Conversas ativas',
      description: `Atualizadas no período: ${periodLabel}`,
      buttonLabel: 'Ver conversas',
      entityType:  'conversations',
    },
  ]

  return (
    <>
      {/* Título da seção */}
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Action Center
        </h3>
        <span className="text-xs text-gray-400">— ações rápidas</span>
      </div>

      {/* Cards em grid 2 colunas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {cards.map((card) => (
          <ActionCard key={card.id} {...card} baseFilters={baseFilters} />
        ))}
      </div>
    </>
  )
}
