// =====================================================
// ExecutiveSummary
// Seção de KPIs principais do Dashboard.
// Todos os cards são clicáveis e abrem EntityListDrawer.
// Filtros globais são herdados do dashboard e passados ao drawer.
// =====================================================

import React from 'react'
import { Users, MessageSquare, Flame, Bell } from 'lucide-react'
import { InteractiveMetricCard } from '../interactive/InteractiveMetricCard'
import { EntityListDrawer }      from '../interactive/EntityListDrawer'
import { useInteractiveMetrics } from '../../../hooks/dashboard/useInteractiveMetrics'
import type { EntityListFilters } from '../../../hooks/dashboard/useEntityList'
import type { ExecutiveData }    from '../../../services/dashboardApi'
import type { DashboardFilters } from '../../../services/dashboardApi'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface ExecutiveSummaryProps {
  data: ExecutiveData | null
  loading: boolean
  error: string | null
  /** Filtros globais herdados: period, funnelId */
  dashboardFilters: DashboardFilters
  /** Período formatado para exibir no subtítulo dos cards */
  periodLabel: string
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export const ExecutiveSummary: React.FC<ExecutiveSummaryProps> = ({
  data,
  loading,
  error,
  dashboardFilters,
  periodLabel,
}) => {
  const { drawer, openDrawer, closeDrawer } = useInteractiveMetrics()

  // Converte filtros do dashboard para EntityListFilters com o objeto period intacto
  const buildDrawerFilters = (): EntityListFilters => ({
    period:   dashboardFilters.period,
    funnelId: dashboardFilters.funnelId ?? null,
  })

  return (
    <>
      {/* ── Erro ─────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 mb-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* ── Cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

        {/* Leads novos */}
        <InteractiveMetricCard
          title="Leads novos"
          value={data?.leads_count ?? 0}
          subtitle={`No período: ${periodLabel}`}
          icon={<Users size={18} />}
          accent="blue"
          emptyLabel="Nenhum lead neste período"
          loading={loading}
          onClick={() =>
            openDrawer(
              'leads',
              'Leads novos',
              `No período: ${periodLabel}`,
              buildDrawerFilters(),
            )
          }
        />

        {/* Conversas ativas */}
        <InteractiveMetricCard
          title="Conversas ativas"
          value={data?.conversations_count ?? 0}
          subtitle={`Atualizadas no período`}
          icon={<MessageSquare size={18} />}
          accent="green"
          emptyLabel="Nenhuma conversa ativa"
          loading={loading}
          onClick={() =>
            openDrawer(
              'conversations',
              'Conversas ativas',
              `No período: ${periodLabel}`,
              buildDrawerFilters(),
            )
          }
        />

        {/* Oportunidades quentes */}
        <InteractiveMetricCard
          title="Oportunidades quentes"
          value={data?.hot_opportunities_count ?? 0}
          subtitle="Prob. ≥ 70% · abertas"
          icon={<Flame size={18} />}
          accent="orange"
          emptyLabel="Nenhuma oportunidade quente"
          loading={loading}
          onClick={() =>
            openDrawer(
              'opportunities',
              'Oportunidades quentes',
              'Probabilidade ≥ 70%, abertas no período',
              { ...buildDrawerFilters(), probability_min: 70, status: 'open' },
            )
          }
        />

        {/* Alertas críticos */}
        <InteractiveMetricCard
          title="Alertas críticos"
          value={data?.alerts_count ?? 0}
          subtitle="Não reconhecidos"
          icon={<Bell size={18} />}
          accent="red"
          emptyLabel="Sem alertas no momento"
          loading={loading}
          onClick={() =>
            openDrawer(
              'alerts',
              'Alertas críticos',
              'Insights críticos não reconhecidos',
              buildDrawerFilters(),
            )
          }
        />
      </div>

      {/* ── Drawer ───────────────────────────────────────────────── */}
      {drawer.open && drawer.entityType && (
        <EntityListDrawer
          open={drawer.open}
          onClose={closeDrawer}
          title={drawer.title}
          description={drawer.description}
          entityType={drawer.entityType}
          filters={drawer.filters}
          primaryAction={{
            label: 'Abrir chat',
            onClick: (_item) => {
              // Ação real implementada no Passo 5
            },
          }}
        />
      )}
    </>
  )
}
