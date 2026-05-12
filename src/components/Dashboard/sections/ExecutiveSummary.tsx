// =====================================================
// ExecutiveSummary
// Seção de KPIs principais do Dashboard.
// Todos os cards são clicáveis e abrem EntityListDrawer.
// Filtros globais são herdados do dashboard e passados ao drawer.
//
// FASE 4.1: Suporte a DeltaBadge + TrendSparkline históricos.
// Realtime continua sendo o valor principal.
// Snapshot entra como contexto secundário.
// =====================================================

import React from 'react'
import { Users, MessageSquare, Flame, Bell } from 'lucide-react'
import { InteractiveMetricCard }  from '../interactive/InteractiveMetricCard'
import { EntityListDrawer }       from '../interactive/EntityListDrawer'
import { DeltaBadge }             from '../historical/DeltaBadge'
import { TrendSparkline }         from '../historical/TrendSparkline'
import { SnapshotDataGuard }      from '../historical/SnapshotDataGuard'
import { useInteractiveMetrics }  from '../../../hooks/dashboard/useInteractiveMetrics'
import { getComparisonLabel }     from '../../../lib/snapshotPeriods'
import type { EntityListFilters } from '../../../hooks/dashboard/useEntityList'
import type { ExecutiveData }     from '../../../services/dashboardApi'
import type { DashboardFilters }  from '../../../services/dashboardApi'
import type {
  SnapshotComparisonData,
  SnapshotTrendsData,
}                                 from '../../../types/dashboard'
import type { ComparisonMode }    from '../../../lib/snapshotPeriods'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface ExecutiveSummaryProps {
  data:             ExecutiveData | null
  loading:          boolean
  error:            string | null
  dashboardFilters: DashboardFilters
  periodLabel:      string
  // FASE 4.1 — props opcionais de contexto histórico
  snapshotComparison?:  SnapshotComparisonData | null
  snapshotTrends?:      SnapshotTrendsData | null
  snapshotTrendPoints?: number
  comparisonMode?:      ComparisonMode
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDelta(
  comparison: SnapshotComparisonData | null | undefined,
  metric: string,
): number | null {
  if (!comparison?.deltas) return null
  return comparison.deltas[metric]?.pct ?? null
}

function getSparkline(
  trends: SnapshotTrendsData | null | undefined,
  metric: string,
): number[] {
  if (!trends?.series) return []
  return trends.series.map(p => Number(p[metric] ?? 0))
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
  snapshotComparison,
  snapshotTrends,
  snapshotTrendPoints = 0,
  comparisonMode = 'wow',
}) => {
  const { drawer, openDrawer, closeDrawer } = useInteractiveMetrics()

  const buildDrawerFilters = (): EntityListFilters => ({
    period:   dashboardFilters.period,
    funnelId: dashboardFilters.funnelId ?? null,
  })

  const hasSnapshot = !!snapshotComparison
  const periodLabel2 = getComparisonLabel(comparisonMode)

  // Deltas por métrica
  const leadsDelta     = getDelta(snapshotComparison, 'leads_created')
  const convDelta      = getDelta(snapshotComparison, 'conversations_attended')
  const hotDelta       = getDelta(snapshotComparison, 'hot_count')
  const slaDelta       = getDelta(snapshotComparison, 'sla_breached_count')

  // Sparklines
  const leadsSparkline = getSparkline(snapshotTrends, 'leads_created')
  const convSparkline  = getSparkline(snapshotTrends, 'conversations_attended')
  const hotSparkline   = getSparkline(snapshotTrends, 'hot_count')
  const slaSparkline   = getSparkline(snapshotTrends, 'sla_breached_count')

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
        >
          {/* Contexto histórico — secundário, não substitui realtime */}
          <SnapshotDataGuard dataPoints={snapshotTrendPoints} enabled={hasSnapshot}>
            <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-gray-50">
              <DeltaBadge
                pct={leadsDelta}
                higherIsBetter={true}
                periodLabel={periodLabel2}
              />
              <TrendSparkline values={leadsSparkline} higherIsBetter={true} width={64} height={22} />
            </div>
          </SnapshotDataGuard>
        </InteractiveMetricCard>

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
        >
          <SnapshotDataGuard dataPoints={snapshotTrendPoints} enabled={hasSnapshot}>
            <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-gray-50">
              <DeltaBadge
                pct={convDelta}
                higherIsBetter={true}
                periodLabel={periodLabel2}
              />
              <TrendSparkline values={convSparkline} higherIsBetter={true} width={64} height={22} />
            </div>
          </SnapshotDataGuard>
        </InteractiveMetricCard>

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
        >
          <SnapshotDataGuard dataPoints={snapshotTrendPoints} enabled={hasSnapshot}>
            <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-gray-50">
              <DeltaBadge
                pct={hotDelta}
                higherIsBetter={true}
                periodLabel={periodLabel2}
              />
              <TrendSparkline values={hotSparkline} higherIsBetter={true} width={64} height={22} />
            </div>
          </SnapshotDataGuard>
        </InteractiveMetricCard>

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
        >
          {/* SLA: lower is better → queda = verde */}
          <SnapshotDataGuard dataPoints={snapshotTrendPoints} enabled={hasSnapshot}>
            <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-gray-50">
              <DeltaBadge
                pct={slaDelta}
                higherIsBetter={false}
                periodLabel={periodLabel2}
              />
              <TrendSparkline values={slaSparkline} higherIsBetter={false} width={64} height={22} />
            </div>
          </SnapshotDataGuard>
        </InteractiveMetricCard>

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
