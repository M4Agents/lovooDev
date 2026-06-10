// =====================================================
// PipelineCurrentSection
// Bloco "Pipeline atual" da aba Operação do Dashboard.
// Exibe a distribuição de oportunidades abertas por etapa
// com base no snapshot mais recente (sem filtro de período).
//
// Exporta também SectionError, SectionEmpty e FunnelStageRow
// para reutilização em FunnelFlowSection.
// =====================================================

import React from 'react'
import type { FunnelSnapshotData } from '../../../types/dashboard'

// ---------------------------------------------------------------------------
// Helpers compartilhados (re-exportados para FunnelFlowSection)
// ---------------------------------------------------------------------------

export function SectionError({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
      {message}
    </div>
  )
}

export function SectionEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-gray-50 border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
      {message}
    </div>
  )
}

export interface FunnelStageRowProps {
  name:   string
  value:  number
  suffix: string
}

export function FunnelStageRow({ name, value, suffix }: FunnelStageRowProps) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-700">{name}</span>
      <span className="text-sm font-semibold text-gray-900">
        {value.toLocaleString('pt-BR')}{' '}
        <span className="font-normal text-gray-500 text-xs">{suffix}</span>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PipelineCurrentSection
// ---------------------------------------------------------------------------

interface SnapshotState {
  data:    FunnelSnapshotData | null
  loading: boolean
  error:   string | null
}

interface PipelineCurrentSectionProps {
  snapshot:           SnapshotState
  showFunnelSections: boolean
}

export const PipelineCurrentSection: React.FC<PipelineCurrentSectionProps> = ({
  snapshot,
  showFunnelSections,
}) => {
  return (
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
  )
}
