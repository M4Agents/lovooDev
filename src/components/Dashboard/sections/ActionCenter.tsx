// =====================================================
// ActionCenter
// Seção de ações rápidas do Dashboard.
// Exibe cards de oportunidades quentes e leads recentes,
// cada um abrindo o EntityListDrawer com filtros corretos.
//
// NÃO executa ações destrutivas — apenas navega.
// NÃO faz fetch próprio — usa o drawer para carregar dados.
// =====================================================

import React from 'react'
import { Flame, Users, ArrowRight, TrendingUp } from 'lucide-react'
import { EntityListDrawer }      from '../interactive/EntityListDrawer'
import { useInteractiveMetrics } from '../../../hooks/dashboard/useInteractiveMetrics'
import { trackEvent }            from '../../../lib/analytics/trackEvent'
import type { DashboardFilters } from '../../../services/dashboardApi'
import type { EntityListFilters } from '../../../hooks/dashboard/useEntityList'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface ActionCenterProps {
  /** Filtros globais do dashboard — herdados por todos os drawers */
  dashboardFilters: DashboardFilters
  /** Período formatado para exibição (ex: "Últimos 7 dias") */
  periodLabel: string
}

// ---------------------------------------------------------------------------
// ActionItem — card individual de ação
// ---------------------------------------------------------------------------

interface ActionItemProps {
  icon: React.ReactNode
  iconBg: string
  title: string
  description: string
  buttonLabel: string
  onAction: () => void
}

function ActionItem({
  icon,
  iconBg,
  title,
  description,
  buttonLabel,
  onAction,
}: ActionItemProps) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm transition-all">
      {/* Ícone */}
      <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
        {icon}
      </div>

      {/* Texto */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5 truncate">{description}</p>
      </div>

      {/* Botão de ação */}
      <button
        onClick={onAction}
        className={[
          'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5',
          'text-xs font-medium rounded-lg transition-colors',
          'bg-gray-50 text-gray-700 border border-gray-200',
          'hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200',
        ].join(' ')}
      >
        {buttonLabel}
        <ArrowRight size={12} />
      </button>
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
  const { drawer, openDrawer, closeDrawer } = useInteractiveMetrics()

  // Converter DashboardFilters para EntityListFilters (periodo intacto)
  const baseFilters: EntityListFilters = {
    period:   dashboardFilters.period,
    funnelId: dashboardFilters.funnelId ?? null,
  }

  const actions = [
    {
      id: 'hot-opportunities',
      icon: <Flame size={18} className="text-orange-600" />,
      iconBg: 'bg-orange-50',
      title: 'Oportunidades quentes',
      description: `Prob. ≥ 70%, abertas · No período: ${periodLabel}`,
      buttonLabel: 'Ver todas',
      onAction: () => {
        trackEvent('dashboard_open_drawer', {
          source: 'action_center',
          entityType: 'opportunities',
        })
        openDrawer(
          'opportunities',
          'Oportunidades quentes',
          `Probabilidade ≥ 70%, abertas · ${periodLabel}`,
          { ...baseFilters, probability_min: 70, status: 'open' },
        )
      },
    },
    {
      id: 'recent-leads',
      icon: <Users size={18} className="text-blue-600" />,
      iconBg: 'bg-blue-50',
      title: 'Leads recentes',
      description: `Novos leads · No período: ${periodLabel}`,
      buttonLabel: 'Abrir lista',
      onAction: () => {
        trackEvent('dashboard_open_drawer', {
          source: 'action_center',
          entityType: 'leads',
        })
        openDrawer(
          'leads',
          'Leads recentes',
          `Leads novos no período: ${periodLabel}`,
          baseFilters,
        )
      },
    },
    {
      id: 'active-conversations',
      icon: <TrendingUp size={18} className="text-green-600" />,
      iconBg: 'bg-green-50',
      title: 'Conversas ativas',
      description: `Atualizadas no período: ${periodLabel}`,
      buttonLabel: 'Ver conversas',
      onAction: () => {
        trackEvent('dashboard_open_drawer', {
          source: 'action_center',
          entityType: 'conversations',
        })
        openDrawer(
          'conversations',
          'Conversas ativas',
          `Conversas no período: ${periodLabel}`,
          baseFilters,
        )
      },
    },
  ]

  return (
    <>
      {/* ── Título da seção ────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Action Center
        </h3>
        <span className="text-xs text-gray-400">— ações rápidas</span>
      </div>

      {/* ── Cards de ação ──────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        {actions.map((action) => (
          <ActionItem key={action.id} {...action} />
        ))}
      </div>

      {/* ── Drawer compartilhado ───────────────────────────────── */}
      {drawer.open && drawer.entityType && (
        <EntityListDrawer
          open={drawer.open}
          onClose={closeDrawer}
          title={drawer.title}
          description={drawer.description}
          entityType={drawer.entityType}
          filters={drawer.filters}
        />
      )}
    </>
  )
}
