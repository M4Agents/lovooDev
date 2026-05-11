// =====================================================
// PriorityAlertsSection — Alertas prioritários do Dashboard.
// Lista acionável com botões condicionais por tipo de alerta.
//
// Regras de ação:
//   sla_critical / sla_high      → Chat (MessageCircle) → ChatModalSimple
//   stalled_opportunity          → Oportunidade (Eye)   → OpportunityDetailModal
//   seller_risk                  → sem ação
//
// Helpers explícitos (ALERT_CHAT_TYPES, ALERT_OPP_TYPES) controlam
// quais botões aparecem — sem inline type-checking no JSX.
//
// Padrão de referência: IntelligenceCentral + useDashboardEntityActions.
// =====================================================

import React from 'react'
import {
  AlertTriangle, MessageCircle, TrendingDown, User, Zap,
  Clock, ChevronRight, Eye, Loader2,
} from 'lucide-react'
import { useDashboardEntityActions }                from '../../../hooks/dashboard/useDashboardEntityActions'
import ChatModalSimple                              from '../../SalesFunnel/ChatModalSimple'
import { OpportunityDetailModal }                  from '../../SalesFunnel/OpportunityDetailModal'
import type { PriorityAlertItem, PriorityAlertType } from '../../../types/dashboard'

// ---------------------------------------------------------------------------
// Sets de controle de ação — sem inline if (type === ...) no JSX
// ---------------------------------------------------------------------------

const ALERT_CHAT_TYPES = new Set<PriorityAlertType>([
  'sla_critical',
  'sla_high',
])

const ALERT_OPP_TYPES = new Set<PriorityAlertType>([
  'stalled_opportunity',
])

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PriorityAlertsSectionProps {
  data:       { alerts: PriorityAlertItem[]; total: number; critical: number; high: number } | null
  loading:    boolean
  error:      string | null
  companyId?: string | null
}

// ---------------------------------------------------------------------------
// Helpers visuais
// ---------------------------------------------------------------------------

function alertIcon(type: PriorityAlertType) {
  switch (type) {
    case 'sla_critical':        return MessageCircle
    case 'sla_high':            return Clock
    case 'stalled_opportunity': return TrendingDown
    case 'seller_risk':         return User
    default:                    return Zap
  }
}

function alertColors(severity: 'critical' | 'high') {
  if (severity === 'critical') {
    return {
      badge:  'bg-red-100 text-red-700',
      icon:   'bg-red-50 text-red-500',
      border: 'border-red-100',
    }
  }
  return {
    badge:  'bg-amber-100 text-amber-700',
    icon:   'bg-amber-50 text-amber-500',
    border: 'border-amber-100',
  }
}

// ---------------------------------------------------------------------------
// AlertRow — linha individual com ações condicionais
// ---------------------------------------------------------------------------

interface AlertRowProps {
  item:            PriorityAlertItem
  openingOppId:    string | null
  onOpenChat:      (referenceId: string) => void
  onOpenOpportunity: (entityId: string) => void
}

function AlertRow({ item, openingOppId, onOpenChat, onOpenOpportunity }: AlertRowProps) {
  const Icon   = alertIcon(item.type)
  const colors = alertColors(item.severity)

  const canOpenChat        = ALERT_CHAT_TYPES.has(item.type)
  const canOpenOpportunity = ALERT_OPP_TYPES.has(item.type)
  const isLoadingThis      = openingOppId === item.entity_id

  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border ${colors.border} bg-white`}>
      {/* Ícone do tipo */}
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${colors.icon}`}>
        <Icon className="h-4 w-4" />
      </div>

      {/* Conteúdo */}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-gray-800 truncate">{item.title}</p>
        <p className="text-xs text-gray-500">{item.description}</p>
      </div>

      {/* Badge de severidade */}
      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium ${colors.badge}`}>
        {item.severity === 'critical' ? 'Crítico' : 'Alto'}
      </span>

      {/* Ações condicionais */}
      {(canOpenChat || canOpenOpportunity) && (
        <div className="flex items-center gap-0.5 shrink-0">
          {canOpenChat && (
            <button
              type="button"
              title="Abrir chat"
              onClick={() => onOpenChat(item.reference_id)}
              className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
            >
              <MessageCircle size={14} />
            </button>
          )}

          {canOpenOpportunity && (
            <button
              type="button"
              title="Ver oportunidade"
              disabled={isLoadingThis}
              onClick={() => onOpenOpportunity(item.entity_id)}
              className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoadingThis
                ? <Loader2 size={14} className="animate-spin" />
                : <Eye size={14} />
              }
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PriorityAlertsSection
// ---------------------------------------------------------------------------

export function PriorityAlertsSection({ data, loading, error, companyId }: PriorityAlertsSectionProps) {
  const actions = useDashboardEntityActions({ companyId })

  function handleOpenChat(referenceId: string) {
    const id = Number(referenceId)
    if (!Number.isFinite(id)) return
    actions.openChat(id)
  }

  // Loading skeleton
  if (loading) {
    return (
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5 animate-pulse">
        <div className="h-5 w-48 bg-gray-200 rounded mb-4" />
        <div className="space-y-2.5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 bg-gray-100 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-white border border-red-100 p-5">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }

  const alerts    = data?.alerts ?? []
  const hasAlerts = alerts.length > 0

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" />
          <h3 className="font-semibold text-gray-900 text-sm">Alertas Prioritários</h3>
        </div>
        {data && (data.critical > 0 || data.high > 0) && (
          <div className="flex items-center gap-1.5">
            {data.critical > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                {data.critical} crítico{data.critical > 1 ? 's' : ''}
              </span>
            )}
            {data.high > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                {data.high} alto{data.high > 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Lista */}
      {!hasAlerts ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 mb-3">
            <AlertTriangle className="h-6 w-6 text-emerald-400" />
          </div>
          <p className="text-sm font-medium text-gray-600">Nenhum alerta no momento</p>
          <p className="text-xs text-gray-400 mt-1">Todos os leads estão sendo atendidos</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((item, idx) => (
            <AlertRow
              key={`${item.type}-${item.entity_id}-${idx}`}
              item={item}
              openingOppId={actions.openingOppId}
              onOpenChat={handleOpenChat}
              onOpenOpportunity={actions.openOpportunity}
            />
          ))}
          {(data?.total ?? 0) > alerts.length && (
            <button className="flex w-full items-center justify-center gap-1.5 py-2 text-xs text-indigo-600 hover:text-indigo-700 transition-colors">
              <span>Ver mais {(data?.total ?? 0) - alerts.length} alertas</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Indicador de carregamento de oportunidade */}
      {actions.openingOppId && (
        <div className="fixed bottom-4 right-4 z-40 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-2 text-sm text-gray-600 flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          Carregando oportunidade...
        </div>
      )}

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

      {/* Modal de oportunidade */}
      {actions.selectedOpportunity && actions.companyId && (
        <OpportunityDetailModal
          isOpen={actions.oppModalOpen}
          onClose={actions.closeOpportunity}
          opportunity={actions.selectedOpportunity}
          companyId={actions.companyId}
        />
      )}
    </div>
  )
}
