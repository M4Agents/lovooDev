// =====================================================
// NewDashboard — Inteligência Comercial
// Skeleton funcional da Fase 1.
// Substitui ModernDashboard apenas quando a rota for apontada para este componente.
// Rota atual (src/App.tsx): /dashboard → ModernDashboard (NÃO alterado neste passo)
// =====================================================

import React, { useMemo, useEffect, useState } from 'react'
import { PeriodFilter } from '../components/PeriodFilter'
import { FunnelSelector }         from '../components/Dashboard/filters/FunnelSelector'
import { ExecutiveSummary }       from '../components/Dashboard/sections/ExecutiveSummary'
import { IntelligenceCentral }    from '../components/Dashboard/sections/IntelligenceCentral'
import { ActionCenter }           from '../components/Dashboard/sections/ActionCenter'
import { useDashboardFilters }    from '../hooks/dashboard/useDashboardFilters'
import { useDashboardSummary }    from '../hooks/dashboard/useDashboardSummary'
import { useDashboardInsights }   from '../hooks/dashboard/useDashboardInsights'
import { useFunnelSnapshot }      from '../hooks/dashboard/useFunnelSnapshot'
import { useFunnelFlow }          from '../hooks/dashboard/useFunnelFlow'
import { useAuth }                from '../contexts/AuthContext'
import type { DashboardFilters }  from '../services/dashboardApi'

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
  const { period, funnelId, setPeriod, setFunnelId } = useDashboardFilters()

  // Constrói o objeto DashboardFilters para os hooks de dados
  const filters: DashboardFilters = useMemo(
    () => ({ period, funnelId }),
    [period, funnelId],
  )

  // Dados
  const summary    = useDashboardSummary(filters)
  const insights   = useDashboardInsights(filters)
  const funnelMode = summary.data?.funnel_mode ?? 'single-funnel'

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

        {/* Período — primeiro elemento de filtro (conforme plano) */}
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
