// =====================================================
// NewDashboard — Inteligência Comercial
// Skeleton funcional da Fase 1.
// Substitui ModernDashboard apenas quando a rota for apontada para este componente.
// Rota atual (src/App.tsx): /dashboard → ModernDashboard (NÃO alterado neste passo)
// =====================================================

import React, { useMemo, useEffect, useState } from 'react'
import { PeriodFilter } from '../components/PeriodFilter'
import { FunnelSelector }             from '../components/Dashboard/filters/FunnelSelector'
import { UserSelector }               from '../components/Dashboard/filters/UserSelector'
import { ExecutiveSummary }           from '../components/Dashboard/sections/ExecutiveSummary'
import { IntelligenceCentral }        from '../components/Dashboard/sections/IntelligenceCentral'
import { ActionCenter }               from '../components/Dashboard/sections/ActionCenter'
import { TrendsSection }              from '../components/Dashboard/sections/TrendsSection'
import { SellerRankingSection }       from '../components/Dashboard/sections/SellerRankingSection'
import { SlaAlertsPanel }             from '../components/Dashboard/sections/SlaAlertsPanel'
import { LeadOriginsSection }         from '../components/Dashboard/sections/LeadOriginsSection'
import { useDashboardFilters }        from '../hooks/dashboard/useDashboardFilters'
import { useDashboardSummary }        from '../hooks/dashboard/useDashboardSummary'
import { useDashboardInsights }       from '../hooks/dashboard/useDashboardInsights'
import { useFunnelSnapshot }          from '../hooks/dashboard/useFunnelSnapshot'
import { useFunnelFlow }              from '../hooks/dashboard/useFunnelFlow'
import { useDashboardTrends }         from '../hooks/dashboard/useDashboardTrends'
import { useDashboardUsers }          from '../hooks/dashboard/useDashboardUsers'
import { useSellerPerformance }       from '../hooks/dashboard/useSellerPerformance'
import { useSlaAlerts }               from '../hooks/dashboard/useSlaAlerts'
import { useLeadOrigins }             from '../hooks/dashboard/useLeadOrigins'
import { useDashboardForecast }       from '../hooks/dashboard/useDashboardForecast'
import { usePriorityAlerts }          from '../hooks/dashboard/usePriorityAlerts'
import { useFunnelExecutive }         from '../hooks/dashboard/useFunnelExecutive'
import { ForecastSection }            from '../components/Dashboard/sections/ForecastSection'
import { PriorityAlertsSection }      from '../components/Dashboard/sections/PriorityAlertsSection'
import { FunnelExecutiveSection }     from '../components/Dashboard/sections/FunnelExecutiveSection'
import { useAuth }                    from '../contexts/AuthContext'
import { useFeatureFlags }            from '../hooks/dashboard/useFeatureFlags'
import { useSnapshotComparison }      from '../hooks/dashboard/useSnapshotComparison'
import { useSnapshotTrends }          from '../hooks/dashboard/useSnapshotTrends'
import { useSnapshotSellerDeltas }    from '../hooks/dashboard/useSnapshotSellerDeltas'
import type { DashboardFilters }      from '../services/dashboardApi'
import type { ComparisonMode }        from '../lib/snapshotPeriods'

// ---------------------------------------------------------------------------
// Sub-componentes auxiliares do layout de funil
// ---------------------------------------------------------------------------

interface FunnelStageRowProps {
  name: string
  value: number
  suffix: string
}

interface ConversionRowProps {
  fromName: string
  toName: string
  rate: number
  advanced: number
  inSource: number
}

function FunnelStageRow({ name, value, suffix }: FunnelStageRowProps) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-700">{name}</span>
      <span className="text-sm font-semibold text-gray-900">
        {value.toLocaleString('pt-BR')} <span className="font-normal text-gray-500 text-xs">{suffix}</span>
      </span>
    </div>
  )
}

function ConversionRow({ fromName, toName, rate, advanced, inSource }: ConversionRowProps) {
  const color = rate >= 60 ? 'text-green-600' : rate >= 30 ? 'text-yellow-600' : 'text-red-500'
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-600">
        {fromName} → {toName}
      </span>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-400 text-xs">{advanced}/{inSource}</span>
        <span className={`font-bold ${color}`}>{rate.toFixed(1)}%</span>
      </div>
    </div>
  )
}

function SectionError({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
      {message}
    </div>
  )
}

function SectionEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-gray-50 border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
      {message}
    </div>
  )
}

// ---------------------------------------------------------------------------
// NewDashboard
// ---------------------------------------------------------------------------

export const NewDashboard: React.FC = () => {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  // Filtros globais — fonte única de verdade
  const { period, funnelId, userId, setPeriod, setFunnelId, setUserId } = useDashboardFilters()

  // FASE 4.1 — Toggle WoW/MoM (padrão: WoW conforme D1)
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('wow')

  // Feature flags — sem flags ativas o dashboard se comporta exatamente como antes
  const flags = useFeatureFlags()

  // Constrói o objeto DashboardFilters para os hooks de dados
  const filters: DashboardFilters = useMemo(
    () => ({ period, funnelId, userId }),
    [period, funnelId, userId],
  )

  // Usuários selecionáveis para o UserSelector
  const { users: dashboardUsers, loading: usersLoading } = useDashboardUsers()

  // Tendências (Fase 1)
  const trends = useDashboardTrends(filters)

  // Fase 2 — Gestão Comercial
  const sellerRanking = useSellerPerformance(filters)
  const slaAlerts     = useSlaAlerts({ userId: userId ?? undefined })
  const leadOrigins   = useLeadOrigins(filters)

  // Dados base — summary precisa vir antes de funnelMode (que depende dele)
  const summary    = useDashboardSummary(filters)
  const insights   = useDashboardInsights(filters)
  const funnelMode = summary.data?.funnel_mode ?? 'single-funnel'

  // Fase 3A — Inteligência Executiva (funnelExecutive depende de funnelMode)
  const forecast        = useDashboardForecast(filters)
  const priorityAlerts  = usePriorityAlerts(userId)
  const funnelExecutive = useFunnelExecutive(funnelId, funnelMode)

  // Lê ?resume_analysis da URL (pós-checkout de créditos para retomada de análise de IA)
  const [resumeAnalysisId, setResumeAnalysisId] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('resume_analysis')
    if (id) {
      setResumeAnalysisId(id)
      // Remove o param da URL sem recarregar a página
      params.delete('resume_analysis')
      params.delete('credits')
      const clean = window.location.pathname + (params.toString() ? `?${params.toString()}` : '')
      window.history.replaceState({}, '', clean)
    }
  }, [])

  // Passa funnelMode para useFunnelSnapshot evitar request sem funnelId em multi-funnel
  const snapshot = useFunnelSnapshot(funnelId, funnelMode)
  const flow     = useFunnelFlow(funnelId, filters)

  // Label do período ativo para exibir no header
  const periodLabel = period.label ?? 'Período selecionado'

  // FASE 4.1 — Dados históricos (snapshot) — todos gateados por feature flags
  const snapshotComparison = useSnapshotComparison({
    companyId,
    funnelId,
    mode:    comparisonMode,
    enabled: flags.snapshotDelta,
  })
  const snapshotTrends = useSnapshotTrends({
    companyId,
    funnelId,
    metrics: ['leads_created', 'conversations_attended', 'sla_breached_count', 'hot_count'],
    days:    7,
    enabled: flags.snapshotTrends || flags.snapshotDelta,
  })
  const sellerDeltas = useSnapshotSellerDeltas({
    companyId,
    mode:    comparisonMode,
    enabled: flags.snapshotDelta,
  })

  // Seções de funil só são exibidas se:
  //   - single-funnel (sempre), OU
  //   - multi-funnel com funnel selecionado
  const showFunnelSections = funnelMode === 'single-funnel' || !!funnelId

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Inteligência Comercial</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            No período: <span className="font-medium text-gray-700">{periodLabel}</span>
          </p>
        </div>

        {/* Filtros: Período + Funil + Vendedor + Toggle histórico */}
        <div className="flex items-center gap-3 flex-wrap">
          <PeriodFilter
            selectedPeriod={period}
            onPeriodChange={setPeriod}
          />

          {/* Seletor de funil — só renderiza quando há múltiplos funis */}
          {funnelMode === 'multi-funnel' && (
            <FunnelSelector
              funnelId={funnelId}
              onSelect={setFunnelId}
            />
          )}

          {/* Seletor de vendedor (Fase 1) — visível apenas para manager+ */}
          <UserSelector
            users={dashboardUsers}
            userId={userId}
            onSelect={setUserId}
            loading={usersLoading}
          />

          {/* Toggle WoW/MoM — só aparece se alguma flag histórica estiver ligada */}
          {(flags.snapshotDelta || flags.snapshotTrends || flags.snapshotComparison) && (
            <div className="flex items-center rounded-lg border border-gray-200 bg-white text-xs overflow-hidden">
              <button
                onClick={() => setComparisonMode('wow')}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  comparisonMode === 'wow'
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                title="Comparar com semana anterior"
              >
                WoW
              </button>
              <button
                onClick={() => setComparisonMode('mom')}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  comparisonMode === 'mom'
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                title="Comparar com mês anterior"
              >
                MoM
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── KPIs executivos ────────────────────────────────────────────── */}
      <section>
        <ExecutiveSummary
          data={summary.data}
          loading={summary.loading}
          error={summary.error}
          dashboardFilters={filters}
          periodLabel={periodLabel}
          snapshotComparison={flags.snapshotDelta ? snapshotComparison.data : null}
          snapshotTrends={flags.snapshotDelta ? snapshotTrends.data : null}
          snapshotTrendPoints={snapshotTrends.dataPoints}
          comparisonMode={comparisonMode}
        />
      </section>

      {/* ── Alertas Prioritários (Fase 3A) — onde agir agora ───────────── */}
      <section>
        <PriorityAlertsSection
          data={priorityAlerts.data}
          loading={priorityAlerts.loading}
          error={priorityAlerts.error}
          companyId={companyId}
        />
      </section>

      {/* ── Gráficos de Tendência (Fase 1) ─────────────────────────────── */}
      <section>
        <TrendsSection
          data={trends.data}
          loading={trends.loading}
          error={trends.error}
          onRetry={trends.refetch}
        />
      </section>

      {/* ── Ranking Comercial (Fase 2) ──────────────────────────────────── */}
      <section>
        <SellerRankingSection
          data={sellerRanking.data}
          meta={sellerRanking.meta}
          loading={sellerRanking.loading}
          error={sellerRanking.error}
          onRetry={sellerRanking.refetch}
          sellerDeltas={flags.snapshotDelta ? sellerDeltas.byUserId : undefined}
          comparisonMode={comparisonMode}
        />
      </section>

      {/* ── Forecast Comercial (Fase 3A) ────────────────────────────────── */}
      <section>
        <ForecastSection
          data={forecast.data}
          loading={forecast.loading}
          error={forecast.error}
        />
      </section>

      {/* ── Inteligência Comercial ──────────────────────────────────────── */}
      <section>
        <IntelligenceCentral
          data={insights.data}
          loading={insights.loading}
          error={insights.error}
          canCustomize={insights.canCustomize}
          canAiAnalysis={insights.canAiAnalysis}
          dashboardFilters={filters}
          periodLabel={periodLabel}
          companyId={companyId}
          resumeAnalysisId={resumeAnalysisId}
          onRefetchInsights={insights.refetch}
        />
      </section>

      {/* ── Action Center ──────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <ActionCenter
          dashboardFilters={filters}
          periodLabel={periodLabel}
        />
      </section>

      {/* ── SLA + Origens (Fase 2) ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SlaAlertsPanel
          data={slaAlerts.data}
          meta={slaAlerts.meta}
          loading={slaAlerts.loading}
          error={slaAlerts.error}
          companyId={companyId}
          onRetry={slaAlerts.refetch}
          onLoadMore={slaAlerts.loadMore}
          snapshotTrends={flags.snapshotTrends ? snapshotTrends.data : null}
          snapshotTrendPoints={snapshotTrends.dataPoints}
        />
        <LeadOriginsSection
          data={leadOrigins.data}
          meta={leadOrigins.meta}
          loading={leadOrigins.loading}
          error={leadOrigins.error}
          onRetry={leadOrigins.refetch}
        />
      </div>

      {/* ── Funil ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Pipeline atual (Snapshot) */}
        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Pipeline atual</h2>
          <p className="text-xs text-gray-400 mb-3">Onde estão suas oportunidades agora</p>

          {!showFunnelSections && (
            <SectionEmpty message="Selecione um funil para visualizar o Pipeline e o Fluxo no período" />
          )}

          {showFunnelSections && snapshot.error && <SectionError message={snapshot.error} />}

          {showFunnelSections && snapshot.loading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 bg-gray-100 animate-pulse rounded" />
              ))}
            </div>
          )}

          {showFunnelSections && !snapshot.loading && !snapshot.error && (
            <>
              {snapshot.data?.stages.length === 0 ? (
                <SectionEmpty message="Nenhuma oportunidade aberta no funil" />
              ) : (
                snapshot.data?.stages.map((stage) => (
                  <FunnelStageRow
                    key={stage.stage_id}
                    name={stage.stage_name}
                    value={stage.count}
                    suffix="estão na etapa"
                  />
                ))
              )}
            </>
          )}
        </section>

        {/* Fluxo no período (Flow) */}
        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Fluxo no período</h2>
          <p className="text-xs text-gray-400 mb-3">Por onde as oportunidades passaram em {periodLabel}</p>

          {!showFunnelSections && (
            <SectionEmpty message="Selecione um funil para ver o fluxo e a conversão por etapa" />
          )}

          {showFunnelSections && flow.funnelRequired && (
            <SectionEmpty message="Selecione um funil para ver o fluxo e a conversão por etapa" />
          )}

          {showFunnelSections && !flow.funnelRequired && flow.error && <SectionError message={flow.error} />}

          {showFunnelSections && !flow.funnelRequired && flow.loading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 bg-gray-100 animate-pulse rounded" />
              ))}
            </div>
          )}

          {showFunnelSections && !flow.funnelRequired && !flow.loading && !flow.error && (
            <>
              {/* Passagens por etapa */}
              {flow.data?.flow.stages.length === 0 ? (
                <SectionEmpty message="Sem movimentações no período selecionado" />
              ) : (
                <div className="mb-4">
                  {flow.data?.flow.stages.map((stage) => (
                    <FunnelStageRow
                      key={stage.stage_id}
                      name={stage.stage_name}
                      value={stage.unique_count}
                      suffix="passaram pela etapa"
                    />
                  ))}
                </div>
              )}

              {/* Conversão entre etapas */}
              {(flow.data?.conversions.conversions.length ?? 0) > 0 && (
                <>
                  <div className="border-t border-gray-100 pt-3 mt-1">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      Conversão
                    </h3>
                    {flow.data?.conversions.conversions.map((c) => (
                      <ConversionRow
                        key={`${c.from_stage_id}-${c.to_stage_id}`}
                        fromName={c.from_stage_name}
                        toName={c.to_stage_name}
                        rate={c.conversion_rate_pct}
                        advanced={c.advanced}
                        inSource={c.in_source}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>

      {/* ── Funil Executivo (Fase 3A) — complementa o snapshot acima ────── */}
      <section>
        <FunnelExecutiveSection
          stages={funnelExecutive.data?.stages ?? null}
          loading={funnelExecutive.loading}
          error={funnelExecutive.error}
          funnelRequired={funnelExecutive.funnelRequired}
        />
      </section>

      {/* ── Modo do sistema (debug — remover antes de produção) ─────────── */}
      {import.meta.env.DEV && summary.data && (
        <div className="text-xs text-gray-400 flex gap-4">
          <span>Agentes: <strong>{summary.data.agent_mode}</strong></span>
          <span>Funis: <strong>{summary.data.funnel_mode}</strong></span>
        </div>
      )}

    </div>
  )
}

export default NewDashboard
