// =====================================================
// EntityListDrawer
// Drawer lateral genérico para listas acionáveis do Dashboard.
// Carrega dados reais via useEntityList com paginação.
//
// Props:
//   open          — controla visibilidade
//   onClose       — callback de fechamento
//   title         — título do drawer
//   description   — subtítulo opcional
//   entityType    — tipo de entidade (opportunities | leads | conversations | alerts)
//   filters       — filtros tipados herdados do dashboard
//   primaryAction — ação principal por item (preparado, sem execução)
// =====================================================

import React, { useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useEntityList,
  type EntityListFilters,
  type EntityItem,
} from '../../../hooks/dashboard/useEntityList'
import type {
  OpportunityItem,
  LeadItem,
  ConversationItem,
} from '../../../services/dashboardApi'
import { trackEvent } from '../../../lib/analytics/trackEvent'

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type EntityType = 'opportunities' | 'leads' | 'conversations' | 'alerts'

export interface DrawerPrimaryAction {
  label: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onClick: (item: any) => void
}

export interface EntityListDrawerProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  entityType: EntityType
  /** Filtros completos herdados do dashboard (period objeto, funnelId, extras) */
  filters: EntityListFilters
  primaryAction?: DrawerPrimaryAction
}

// ---------------------------------------------------------------------------
// Labels por entityType
// ---------------------------------------------------------------------------

const entityLabels: Record<EntityType, { singular: string; plural: string; icon: string }> = {
  opportunities: { singular: 'oportunidade',  plural: 'oportunidades',  icon: '💡' },
  leads:         { singular: 'lead',           plural: 'leads',           icon: '👤' },
  conversations: { singular: 'conversa',       plural: 'conversas',       icon: '💬' },
  alerts:        { singular: 'alerta',         plural: 'alertas',         icon: '🔔' },
}

// ---------------------------------------------------------------------------
// Helpers de formatação
// ---------------------------------------------------------------------------

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—'
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(isoString))
  } catch {
    return '—'
  }
}

function formatDateShort(isoString: string | null | undefined): string {
  if (!isoString) return '—'
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(new Date(isoString))
  } catch {
    return '—'
  }
}

function aiStateLabel(state: string): string {
  const labels: Record<string, string> = {
    active:    'Ativo',
    paused:    'Pausado',
    handoff:   'Transferido',
    disabled:  'Desativado',
    unknown:   'Desconhecido',
  }
  return labels[state] ?? state
}

function probabilityBadge(probability: number): string {
  if (probability >= 70) return 'bg-green-100 text-green-700'
  if (probability >= 40) return 'bg-yellow-100 text-yellow-700'
  return 'bg-red-100 text-red-700'
}

// ---------------------------------------------------------------------------
// Skeleton de item
// ---------------------------------------------------------------------------

function ItemSkeleton() {
  return (
    <tr className="animate-pulse">
      <td className="py-3 pr-3">
        <div className="h-3.5 bg-gray-100 rounded w-3/4" />
      </td>
      <td className="py-3 pr-3">
        <div className="h-3.5 bg-gray-100 rounded w-1/2" />
      </td>
      <td className="py-3">
        <div className="h-3.5 bg-gray-100 rounded w-2/3" />
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Tabelas de dados por entityType
// ---------------------------------------------------------------------------

function OpportunitiesTable({
  items,
  onRowAction,
}: {
  items: OpportunityItem[]
  onRowAction: (item: OpportunityItem) => void
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
          <th className="text-left py-2 pr-3 font-medium">Lead</th>
          <th className="text-left py-2 pr-3 font-medium">Etapa</th>
          <th className="text-left py-2 pr-3 font-medium">Prob.</th>
          <th className="text-left py-2 font-medium">Atualizado</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {items.map((item) => (
          <tr
            key={item.opportunity_id}
            className="group hover:bg-gray-50/60 transition-colors cursor-pointer"
            onClick={() => onRowAction(item)}
          >
            <td className="py-3 pr-3">
              <span className="font-medium text-gray-900 truncate block max-w-[130px]">
                {item.lead_name}
              </span>
              {item.title && (
                <span className="text-xs text-gray-400 truncate block max-w-[130px]">
                  {item.title}
                </span>
              )}
            </td>
            <td className="py-3 pr-3">
              <span className="text-gray-600 truncate block max-w-[110px] text-xs">
                {item.stage_name}
              </span>
            </td>
            <td className="py-3 pr-3">
              <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${probabilityBadge(item.probability)}`}>
                {item.probability}%
              </span>
            </td>
            <td className="py-3">
              <span className="text-xs text-gray-400">
                {formatDate(item.updated_at)}
              </span>
              <button
                className="ml-2 text-xs text-blue-600 hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); onRowAction(item) }}
                aria-label="Ver no funil"
              >
                Ver no funil →
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function LeadsTable({
  items,
  onRowAction,
}: {
  items: LeadItem[]
  onRowAction: (item: LeadItem) => void
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
          <th className="text-left py-2 pr-3 font-medium">Nome</th>
          <th className="text-left py-2 pr-3 font-medium">Status</th>
          <th className="text-left py-2 font-medium">Criado em</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {items.map((item) => (
          <tr
            key={item.lead_id}
            className="group hover:bg-gray-50/60 transition-colors cursor-pointer"
            onClick={() => onRowAction(item)}
          >
            <td className="py-3 pr-3">
              <span className="font-medium text-gray-900 truncate block max-w-[170px]">
                {item.name}
              </span>
              {item.origin && (
                <span className="text-xs text-gray-400">{item.origin}</span>
              )}
            </td>
            <td className="py-3 pr-3">
              <span className="text-xs text-gray-600">{item.status ?? '—'}</span>
            </td>
            <td className="py-3">
              <span className="text-xs text-gray-400">{formatDateShort(item.created_at)}</span>
              <button
                className="ml-2 text-xs text-blue-600 hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); onRowAction(item) }}
                aria-label="Ver lead"
              >
                Ver lead →
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ConversationsTable({
  items,
  onRowAction,
}: {
  items: ConversationItem[]
  onRowAction: (item: ConversationItem) => void
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
          <th className="text-left py-2 pr-3 font-medium">Lead</th>
          <th className="text-left py-2 pr-3 font-medium">Estado IA</th>
          <th className="text-left py-2 font-medium">Última mensagem</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {items.map((item) => (
          <tr
            key={item.conversation_id}
            className="group hover:bg-gray-50/60 transition-colors cursor-pointer"
            onClick={() => onRowAction(item)}
          >
            <td className="py-3 pr-3">
              <span className="font-medium text-gray-900 truncate block max-w-[150px]">
                {item.lead_name}
              </span>
              {item.unread_count > 0 && (
                <span className="text-xs text-blue-600 font-semibold">
                  {item.unread_count} não lida{item.unread_count > 1 ? 's' : ''}
                </span>
              )}
            </td>
            <td className="py-3 pr-3">
              <span className="text-xs text-gray-600">{aiStateLabel(item.ai_state)}</span>
            </td>
            <td className="py-3">
              <span className="text-xs text-gray-400">
                {item.last_message_at ? formatDate(item.last_message_at) : '—'}
              </span>
              <button
                className="ml-2 text-xs text-blue-600 hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); onRowAction(item) }}
                aria-label="Abrir chat"
              >
                Abrir chat →
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Renderizador de conteúdo por entityType
// ---------------------------------------------------------------------------

function EntityTable({
  entityType,
  items,
  onRowAction,
}: {
  entityType: EntityType
  items: EntityItem[]
  onRowAction: (item: EntityItem) => void
}) {
  if (entityType === 'opportunities') {
    return (
      <OpportunitiesTable
        items={items as OpportunityItem[]}
        onRowAction={onRowAction as (item: OpportunityItem) => void}
      />
    )
  }
  if (entityType === 'leads') {
    return (
      <LeadsTable
        items={items as LeadItem[]}
        onRowAction={onRowAction as (item: LeadItem) => void}
      />
    )
  }
  if (entityType === 'conversations') {
    return (
      <ConversationsTable
        items={items as ConversationItem[]}
        onRowAction={onRowAction as (item: ConversationItem) => void}
      />
    )
  }
  return null
}

// ---------------------------------------------------------------------------
// EntityListDrawer
// ---------------------------------------------------------------------------

export const EntityListDrawer: React.FC<EntityListDrawerProps> = ({
  open,
  onClose,
  title,
  description,
  entityType,
  filters,
  primaryAction,
}) => {
  const drawerRef = useRef<HTMLDivElement>(null)
  const navigate  = useNavigate()
  const entity    = entityLabels[entityType]

  // Não buscar dados para 'alerts' (endpoint futuro)
  const listEnabled  = open && entityType !== 'alerts'
  const listType     = entityType === 'alerts' ? null : entityType

  const { data, meta, loading, error, page, hasMore, nextPage, prevPage } =
    useEntityList(listType, filters, listEnabled)

  // Navegação padrão por linha (fecha drawer → navega com deep-link)
  const handleRowAction = useCallback((item: EntityItem) => {
    if (primaryAction) {
      primaryAction.onClick(item)
      return
    }
    onClose()
    if (entityType === 'conversations') {
      const conv = item as ConversationItem
      trackEvent('dashboard_open_chat', {
        source: 'drawer',
        entityType: 'conversations',
        entity_id: conv.conversation_id,
      })
      navigate(`/chat?conversation_id=${conv.conversation_id}`)
    } else if (entityType === 'opportunities') {
      const opp = item as OpportunityItem
      trackEvent('dashboard_open_opportunity', {
        source: 'drawer',
        entityType: 'opportunities',
        entity_id: opp.opportunity_id,
      })
      navigate(`/sales-funnel?opportunity_id=${opp.opportunity_id}`)
    } else if (entityType === 'leads') {
      const lead = item as LeadItem
      trackEvent('dashboard_open_lead', {
        source: 'drawer',
        entityType: 'leads',
        entity_id: lead.lead_id,
      })
      navigate(`/leads?lead_id=${lead.lead_id}`)
    }
  }, [entityType, navigate, onClose, primaryAction])

  // Fecha com Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // Bloqueia scroll do body
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Foca ao abrir (acessibilidade) + tracking de abertura do drawer
  useEffect(() => {
    if (open) {
      setTimeout(() => drawerRef.current?.focus(), 50)
      trackEvent('dashboard_open_drawer', {
        source: 'drawer',
        entityType,
      })
    }
  }, [open, entityType])

  if (!open) return null

  // ── Conteúdo do body ────────────────────────────────────────────────────

  const renderBody = () => {
    // Alerts: endpoint futuro
    if (entityType === 'alerts') {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center px-6">
          <span className="text-4xl mb-3">🔔</span>
          <p className="text-sm font-medium text-gray-600">Alertas em breve</p>
          <p className="text-xs text-gray-400 mt-1">Endpoint de alertas será implementado na próxima fase.</p>
        </div>
      )
    }

    if (loading && data.length === 0) {
      return (
        <div className="px-4 py-3">
          <table className="w-full">
            <tbody>{[...Array(5)].map((_, i) => <ItemSkeleton key={i} />)}</tbody>
          </table>
        </div>
      )
    }

    if (error) {
      return (
        <div className="mx-4 my-4 rounded-xl bg-red-50 border border-red-200 p-4">
          <p className="text-sm font-medium text-red-800 mb-1">Erro ao carregar lista</p>
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )
    }

    if (!loading && data.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center px-6">
          <span className="text-4xl mb-3">{entity.icon}</span>
          <p className="text-sm font-medium text-gray-600">
            Nenhum(a) {entity.singular} encontrado(a)
          </p>
          <p className="text-xs text-gray-400 mt-1">Tente ajustar o período ou os filtros.</p>
        </div>
      )
    }

    return (
      <div className="px-4 pb-2 overflow-x-auto">
        <EntityTable entityType={entityType} items={data} onRowAction={handleRowAction} />
        {loading && (
          <div className="text-center py-2">
            <span className="text-xs text-gray-400 animate-pulse">Carregando...</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Painel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={[
          'fixed inset-y-0 right-0 z-50 flex flex-col',
          'w-full sm:w-[480px] max-w-full',
          'bg-white shadow-2xl border-l border-gray-200 outline-none',
          'transform transition-transform duration-300 ease-in-out',
        ].join(' ')}
      >
        {/* ── Header ───────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span aria-hidden="true">{entity.icon}</span>
              <h2 className="text-base font-semibold text-gray-900 truncate">{title}</h2>
            </div>
            {description && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">{description}</p>
            )}
            {meta && (
              <p className="text-xs text-gray-400 mt-0.5">
                {meta.total} {meta.total === 1 ? entity.singular : entity.plural} encontrado{meta.total === 1 ? '' : 's'}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {/* ── Corpo ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {renderBody()}
        </div>

        {/* ── Rodapé: paginação ─────────────────────────── */}
        {meta && entityType !== 'alerts' && (
          <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-between flex-shrink-0 bg-white">
            <p className="text-xs text-gray-400">
              Pág. {page} · {Math.min(page * meta.limit, meta.total)} de {meta.total}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={prevPage}
                disabled={page <= 1 || loading}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Anterior
              </button>
              <button
                onClick={nextPage}
                disabled={!hasMore || loading}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
