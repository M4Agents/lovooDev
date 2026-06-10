// =====================================================
// FunnelFlowSection
// Bloco "Fluxo no período" da aba Operação do Dashboard.
// Exibe passagens por etapa e taxa de conversão entre etapas
// para o funil selecionado no período ativo.
// =====================================================

import React from 'react'
import type { FunnelFlowData } from '../../../types/dashboard'
import { SectionError, SectionEmpty, FunnelStageRow } from './PipelineCurrentSection'

// ---------------------------------------------------------------------------
// ConversionRow
// ---------------------------------------------------------------------------

interface ConversionRowProps {
  fromName: string
  toName:   string
  rate:     number
  advanced: number
  inSource: number
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

// ---------------------------------------------------------------------------
// FunnelFlowSection
// ---------------------------------------------------------------------------

interface FlowState {
  data:           FunnelFlowData | null
  loading:        boolean
  error:          string | null
  funnelRequired: boolean
}

interface FunnelFlowSectionProps {
  flow:               FlowState
  showFunnelSections: boolean
  periodLabel:        string
}

export const FunnelFlowSection: React.FC<FunnelFlowSectionProps> = ({
  flow,
  showFunnelSections,
  periodLabel,
}) => {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">Fluxo no período</h2>
      <p className="text-xs text-gray-400 mb-3">
        Por onde as oportunidades passaram em {periodLabel}
      </p>

      {!showFunnelSections && (
        <SectionEmpty message="Selecione um funil para ver o fluxo e a conversão por etapa" />
      )}

      {showFunnelSections && flow.funnelRequired && (
        <SectionEmpty message="Selecione um funil para ver o fluxo e a conversão por etapa" />
      )}

      {showFunnelSections && !flow.funnelRequired && flow.error && (
        <SectionError message={flow.error} />
      )}

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
          )}
        </>
      )}
    </section>
  )
}
