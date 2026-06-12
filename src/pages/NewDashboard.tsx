// =====================================================
// NewDashboard — Inteligência Comercial
// Skeleton funcional da Fase 1.
// Substitui ModernDashboard apenas quando a rota for apontada para este componente.
// Rota atual (src/App.tsx): /dashboard → ModernDashboard (NÃO alterado neste passo)
// =====================================================

import React, { useMemo, useEffect, useState, useRef, useCallback } from 'react'
import { Settings2 } from 'lucide-react'
import { PeriodFilter } from '../components/PeriodFilter'
import { FunnelSelector }             from '../components/Dashboard/filters/FunnelSelector'
import { UserSelector }               from '../components/Dashboard/filters/UserSelector'
import { AlertSettingsModal }         from '../components/Dashboard/settings/AlertSettingsModal'
import { ExecutiveSummary }           from '../components/Dashboard/sections/ExecutiveSummary'
import { IntelligenceCentral }        from '../components/Dashboard/sections/IntelligenceCentral'
import { TrendsSection }              from '../components/Dashboard/sections/TrendsSection'
import { SellerRankingSection }       from '../components/Dashboard/sections/SellerRankingSection'
import { SlaAlertsPanel }             from '../components/Dashboard/sections/SlaAlertsPanel'
import { LeadOriginsSection }         from '../components/Dashboard/sections/LeadOriginsSection'
import { ActivationSection }          from '../components/Dashboard/sections/ActivationSection'
import { DashboardTabs }              from '../components/Dashboard/navigation/DashboardTabs'
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
import { useDashboardActivation }     from '../hooks/dashboard/useDashboardActivation'
import { ForecastSection }            from '../components/Dashboard/sections/ForecastSection'
import { PriorityAlertsSection }      from '../components/Dashboard/sections/PriorityAlertsSection'
import { FunnelExecutiveSection }     from '../components/Dashboard/sections/FunnelExecutiveSection'
import { PipelineCurrentSection }     from '../components/Dashboard/sections/PipelineCurrentSection'
import { FunnelFlowSection }          from '../components/Dashboard/sections/FunnelFlowSection'
import { useAuth }                    from '../contexts/AuthContext'
import { useAccessControl }           from '../hooks/useAccessControl'
import { useFeatureFlags }            from '../hooks/dashboard/useFeatureFlags'
import { useSnapshotHealth }          from '../hooks/dashboard/useSnapshotHealth'
import { useSnapshotComparison }      from '../hooks/dashboard/useSnapshotComparison'
import { useSnapshotTrends }          from '../hooks/dashboard/useSnapshotTrends'
import { useSnapshotSellerDeltas }    from '../hooks/dashboard/useSnapshotSellerDeltas'
import type { DashboardFilters }      from '../services/dashboardApi'
import type { SnapshotComparisonData, SellerSnapshotDelta, SnapshotTrendsData } from '../types/dashboard'
import type { ComparisonMode }        from '../lib/snapshotPeriods'
import type { DashboardTab }          from '../components/Dashboard/navigation/DashboardTabs'

// ---------------------------------------------------------------------------
// NewDashboard
// ---------------------------------------------------------------------------

export const NewDashboard: React.FC = () => {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const {
    canViewTeamDashboard,
    canViewPipelineDashboard,
    canViewFunnelExecutive,
    canViewFunnelFlow,
    canViewLeadOrigins,
    canViewDashboardSettings,
  } = useAccessControl()

  // Modal de configuração dos alertas
  const [alertSettingsOpen, setAlertSettingsOpen] = useState(false)

  // Aba ativa do dashboard
  const [activeTab, setActiveTab] = useState<DashboardTab>('operation')

  // Filtros globais — fonte única de verdade
  const { period, funnelId, userId, setPeriod, setFunnelId, setUserId } = useDashboardFilters()

  // FASE 4.1 — Toggle WoW/MoM (padrão: WoW conforme D1)
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('wow')

  // Feature flags — sem flags ativas o dashboard se comporta exatamente como antes
  const flags = useFeatureFlags()

  // FASE 4.2 Sprint 1A — Saúde do tenant histórico
  // canUseSnapshots = false para insufficient_history, degraded, critical e em caso de erro
  const snapshotHealth   = useSnapshotHealth(companyId)
  const canUseSnapshots  = snapshotHealth.canUseSnapshots
  const freshnessOk      = snapshotHealth.freshnessOk

  // Constrói o objeto DashboardFilters para os hooks de dados
  const filters: DashboardFilters = useMemo(
    () => ({ period, funnelId, userId }),
    [period, funnelId, userId],
  )

  // Usuários selecionáveis para o UserSelector
  const { users: dashboardUsers, loading: usersLoading } = useDashboardUsers()

  // Tendências (Fase 1)
  const trends = useDashboardTrends(filters)

  // FASE 4.2 Sprint 3 — v2 ativo apenas quando flag ligada E tenant elegível
  const sellerHybridActive = flags.hybridSellerRanking && canUseSnapshots

  // FASE 4.2 Sprint 4 — v2 ativo apenas quando flag ligada E tenant elegível
  const slaHybridActive = flags.hybridSlaAlerts && canUseSnapshots

  // FASE 4.2 Sprint 5 — v2 ativo apenas quando flag ligada E tenant elegível
  const forecastHybridActive = flags.hybridForecast && canUseSnapshots

  // FASE 4.2 Sprint 6 — v2 ativo apenas quando flag ligada E tenant elegível
  const funnelExecHybridActive = flags.hybridFunnelExecutive && canUseSnapshots

  // Fase 2 — Gestão Comercial
  // hybridMode=true → chama seller-ranking-v2 (ranking + deltas num único request)
  // hybridMode=false → comportamento v1 original inalterado
  const sellerRanking = useSellerPerformance(filters, {
    hybridMode:     sellerHybridActive,
    comparisonMode,
  })
  // hybridMode=true → chama sla-alerts-v2 (alertas + trend sla_breached_count num único request)
  // hybridMode=false → comportamento v1 original inalterado
  const slaAlerts = useSlaAlerts({
    userId:     userId ?? undefined,
    hybridMode: slaHybridActive,
  })
  const leadOrigins   = useLeadOrigins(filters, canViewLeadOrigins)

  // FASE 4.2 Sprint 2 — v2 ativo apenas quando flag ligada E tenant elegível
  const hybridModeActive = flags.hybridExecutiveSummary && canUseSnapshots

  // Dados base — summary precisa vir antes de funnelMode (que depende dele)
  // hybridMode=true → chama executive-summary-v2 (realtime + comparação num único request)
  // hybridMode=false → comportamento v1 original inalterado
  const summary    = useDashboardSummary(filters, { hybridMode: hybridModeActive, comparisonMode })
  const insights   = useDashboardInsights(filters)
  const funnelMode = summary.data?.funnel_mode ?? 'single-funnel'

  // Fase 3A — Inteligência Executiva (funnelExecutive depende de funnelMode)
  // hybridMode=true → chama forecast-v2 (realtime + comparação histórica num único request)
  // hybridMode=false → comportamento v1 original inalterado
  const forecast        = useDashboardForecast(filters, {
    hybridMode:     forecastHybridActive,
    comparisonMode,
    enabled:        canViewTeamDashboard,
  })
  const priorityAlerts  = usePriorityAlerts(userId)
  // hybridMode=true → chama funnel-executive-v2 (realtime + deltas por etapa num único request)
  // hybridMode=false → comportamento v1 original inalterado
  const funnelExecutive = useFunnelExecutive(funnelId, funnelMode, {
    hybridMode:     funnelExecHybridActive,
    comparisonMode,
    enabled:        canViewFunnelExecutive,
  })

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
  const snapshot = useFunnelSnapshot(funnelId, funnelMode, canViewPipelineDashboard)
  const flow     = useFunnelFlow(funnelId, filters, canViewFunnelFlow)

  // Âncora de scroll: KPI "Alertas Críticos" → PriorityAlertsSection
  const priorityAlertsSectionRef = useRef<HTMLElement>(null)
  const handleAlertsClick = useCallback(() => {
    priorityAlertsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // Label do período ativo para exibir no header
  const periodLabel = period.label ?? 'Período selecionado'

  // Ativação Comercial — hook isolado, roda sempre para evitar delay na troca de aba
  const activation = useDashboardActivation(filters)

  // FASE 4.1 / 4.2 Sprint 1A+2 — Dados históricos gateados por flags + saúde do tenant
  // Quando hybridModeActive=true: v2 já entrega comparison → useSnapshotComparison desativado
  // Quando hybridModeActive=false: useSnapshotComparison opera normalmente (Sprint 1A)
  const snapshotComparison = useSnapshotComparison({
    companyId,
    funnelId,
    mode:            comparisonMode,
    enabled:         flags.snapshotDelta && !hybridModeActive,
    canUseSnapshots,
  })
  const snapshotTrends = useSnapshotTrends({
    companyId,
    funnelId,
    metrics:         ['leads_created', 'conversations_attended', 'sla_breached_count', 'hot_count'],
    days:            7,
    enabled:         flags.snapshotTrends || flags.snapshotDelta,
    canUseSnapshots,
  })
  // Quando sellerHybridActive=true: v2 já entrega deltas → useSnapshotSellerDeltas desativado
  // Quando sellerHybridActive=false: useSnapshotSellerDeltas opera normalmente (Sprint 1A)
  const sellerDeltas = useSnapshotSellerDeltas({
    companyId,
    mode:            comparisonMode,
    enabled:         flags.snapshotDelta && !sellerHybridActive,
    canUseSnapshots,
  })

  // Fonte unificada de comparação histórica para o ExecutiveSummary:
  //   - hybridModeActive=true  → vem do v2 (summary.historicalComparison)
  //   - hybridModeActive=false → vem do useSnapshotComparison separado (Sprint 1A)
  const comparisonData: SnapshotComparisonData | null =
    hybridModeActive
      ? summary.historicalComparison
      : (flags.snapshotDelta && canUseSnapshots && freshnessOk ? snapshotComparison.data : null)

  // Fonte unificada de deltas para o SellerRankingSection:
  //   - sellerHybridActive=true  → vem do v2 (sellerRanking.sellerDeltasMap)
  //   - sellerHybridActive=false → vem do useSnapshotSellerDeltas separado (Sprint 1A)
  const sellerDeltaMap: Map<string, SellerSnapshotDelta> =
    sellerHybridActive
      ? sellerRanking.sellerDeltasMap
      : (flags.snapshotDelta && canUseSnapshots && freshnessOk ? sellerDeltas.byUserId : new Map())

  // Fonte unificada de trend SLA para o SlaAlertsPanel:
  //   - slaHybridActive=true  → vem do v2 (slaAlerts.slaTrendData)
  //   - slaHybridActive=false → vem do useSnapshotTrends compartilhado (Sprint 1A)
  const slaTrendSource: SnapshotTrendsData | null =
    slaHybridActive
      ? slaAlerts.slaTrendData
      : (flags.snapshotTrends && canUseSnapshots && freshnessOk ? snapshotTrends.data : null)

  const slaTrendPoints: number =
    slaHybridActive
      ? slaAlerts.slaTrendPoints
      : (canUseSnapshots && freshnessOk ? snapshotTrends.dataPoints : 0)

  // Seções de funil só são exibidas se:
  //   - single-funnel (sempre), OU
  //   - multi-funnel com funnel selecionado
  const showFunnelSections = funnelMode === 'single-funnel' || !!funnelId


  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-bold text-gray-900">Painel Comercial</h1>
          <p className="text-sm text-gray-500">
            No período: <span className="font-medium text-gray-700">{periodLabel}</span>
          </p>
          <DashboardTabs activeTab={activeTab} onChange={setActiveTab} />
        </div>

        {/* Filtros: Período + Funil + Vendedor + Toggle histórico */}
        <div className="flex items-center gap-3 flex-wrap">
          <PeriodFilter
            selectedPeriod={period}
            onPeriodChange={setPeriod}
          />

          {/* Seletor de funil — renderiza sempre para auto-selecionar em single-funnel.
               O componente retorna null quando funnels.length <= 1 (invisível),
               mas seu useEffect popula funnelId automaticamente, permitindo que
               useFunnelFlow carregue mesmo sem interação do usuário. */}
          <FunnelSelector
            funnelId={funnelId}
            onSelect={setFunnelId}
          />

          {/* Seletor de vendedor (Fase 1) — apenas para manager+ */}
          {canViewTeamDashboard && (
            <UserSelector
              users={dashboardUsers}
              userId={userId}
              onSelect={setUserId}
              loading={usersLoading}
            />
          )}

          {/* Toggle WoW/MoM — apenas para manager+ e quando feature flags ativas */}
          {canViewTeamDashboard && (
            flags.snapshotDelta          ||
            flags.snapshotTrends         ||
            flags.hybridExecutiveSummary ||
            flags.hybridSellerRanking    ||
            flags.hybridForecast         ||
            flags.hybridFunnelExecutive
          ) && canUseSnapshots && (
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

          {/* Engrenagem — configurar alertas (apenas admin+) */}
          {canViewDashboardSettings && (
            <button
              onClick={() => setAlertSettingsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:text-indigo-600 hover:border-indigo-300 transition-colors"
              title="Configurar regras dos alertas"
            >
              <Settings2 size={14} />
              Alertas
            </button>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          ABA: Operação
          Conteúdo idêntico ao original — NÃO alterar a semântica interna.
         ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'operation' && (<>

      {/* ── 1. KPIs executivos ─────────────────────────────────────────── */}
      <section>
        <ExecutiveSummary
          data={summary.data}
          loading={summary.loading}
          error={summary.error}
          dashboardFilters={filters}
          periodLabel={periodLabel}
          snapshotComparison={comparisonData}
          snapshotTrends={flags.snapshotDelta && canUseSnapshots && freshnessOk ? snapshotTrends.data : null}
          snapshotTrendPoints={canUseSnapshots && freshnessOk ? snapshotTrends.dataPoints : 0}
          comparisonMode={comparisonMode}
          userScoped={summary.userScoped}
          onAlertsClick={handleAlertsClick}
        />
      </section>

      {/* ── 2. Inteligência Comercial ───────────────────────────────────── */}
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

      {/* ── 3–5. Ações Urgentes ─────────────────────────────────────────── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Ações Urgentes</h2>
          <p className="text-xs text-gray-500 mt-0.5">Leads que exigem resposta imediata ou estão em risco de abandono.</p>
        </div>

        <section ref={priorityAlertsSectionRef}>
          <PriorityAlertsSection
            data={priorityAlerts.data}
            loading={priorityAlerts.loading}
            error={priorityAlerts.error}
            companyId={companyId}
          />
        </section>

        {/* LeadOriginsSection: apenas manager+. Quando oculto, SlaAlertsPanel ocupa largura total */}
        <div className={`grid grid-cols-1 gap-4 ${canViewLeadOrigins ? 'lg:grid-cols-2' : ''}`}>
          <SlaAlertsPanel
            data={slaAlerts.data}
            meta={slaAlerts.meta}
            loading={slaAlerts.loading}
            error={slaAlerts.error}
            companyId={companyId}
            onRetry={slaAlerts.refetch}
            onLoadMore={slaAlerts.loadMore}
            snapshotTrends={slaTrendSource}
            snapshotTrendPoints={slaTrendPoints}
          />
          {canViewLeadOrigins && (
            <LeadOriginsSection
              data={leadOrigins.data}
              meta={leadOrigins.meta}
              loading={leadOrigins.loading}
              error={leadOrigins.error}
              onRetry={leadOrigins.refetch}
            />
          )}
        </div>
      </div>

      {/* ── 6. Performance Comercial ────────────────────────────────────── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Performance Comercial</h2>
          <p className="text-xs text-gray-500 mt-0.5">Volumes, tendências e desempenho comercial do período.</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TrendsSection
            data={trends.data}
            loading={trends.loading}
            error={trends.error}
            onRetry={trends.refetch}
          />
          <SellerRankingSection
            data={sellerRanking.data}
            meta={sellerRanking.meta}
            loading={sellerRanking.loading}
            error={sellerRanking.error}
            onRetry={sellerRanking.refetch}
            sellerDeltas={sellerDeltaMap.size > 0 ? sellerDeltaMap : undefined}
            comparisonMode={comparisonMode}
          />
        </div>
      </div>

      {/* ── 7–10. Pipeline Comercial — apenas manager+ ──────────────────── */}
      {canViewTeamDashboard && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Pipeline Comercial</h2>
          <p className="text-xs text-gray-500 mt-0.5">Situação atual do funil, movimentos do período e projeção de receita.</p>

          <ForecastSection
            data={forecast.data}
            loading={forecast.loading}
            error={forecast.error}
            historicalComparison={
              forecastHybridActive ? forecast.historicalComparison : null
            }
            comparisonMode={comparisonMode}
          />

          {(canViewPipelineDashboard || canViewFunnelFlow) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {canViewPipelineDashboard && (
                <PipelineCurrentSection
                  snapshot={snapshot}
                  showFunnelSections={showFunnelSections}
                />
              )}
              {canViewFunnelFlow && (
                <FunnelFlowSection
                  flow={flow}
                  showFunnelSections={showFunnelSections}
                  periodLabel={periodLabel}
                />
              )}
            </div>
          )}

          {canViewFunnelExecutive && (
            <FunnelExecutiveSection
              stages={funnelExecutive.data?.stages ?? null}
              loading={funnelExecutive.loading}
              error={funnelExecutive.error}
              funnelRequired={funnelExecutive.funnelRequired}
              stageDeltasMap={
                funnelExecHybridActive && funnelExecutive.stageDeltasMap.size > 0
                  ? funnelExecutive.stageDeltasMap
                  : undefined
              }
              comparisonMode={comparisonMode}
            />
          )}
        </div>
      )}

      {/* ── Modo do sistema (debug — remover antes de produção) ─────────── */}
      {import.meta.env.DEV && summary.data && (
        <div className="text-xs text-gray-400 flex gap-4">
          <span>Agentes: <strong>{summary.data.agent_mode}</strong></span>
          <span>Funis: <strong>{summary.data.funnel_mode}</strong></span>
        </div>
      )}

      </>)}
      {/* ══ fim aba Operação ══════════════════════════════════════════════ */}

      {/* ══════════════════════════════════════════════════════════════════
          ABA: Ativação Comercial
          Stack isolada — não compartilha dados com a aba Operação.
         ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'activation' && (
        <ActivationSection
          data={activation.data}
          loading={activation.loading}
          error={activation.error}
          onRetry={activation.refetch}
        />
      )}
      {/* ══ fim aba Ativação Comercial ════════════════════════════════════ */}

      {/* ── Modal de configuração dos alertas ──────────────────────────── */}
      <AlertSettingsModal
        isOpen={alertSettingsOpen}
        onClose={() => setAlertSettingsOpen(false)}
        onSaved={() => {
          priorityAlerts.refetch()
          slaAlerts.refetch()
        }}
        companyId={companyId}
      />

    </div>
  )
}

export default NewDashboard
