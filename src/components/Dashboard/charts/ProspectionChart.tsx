// =====================================================
// ProspectionChart — gráfico de barras agrupadas de prospecção.
// Exibe por dia: iniciadas + respondidas.
// Usa BaseBarChart (dois grupos de barras).
// =====================================================

import React, { useMemo } from 'react'
import { BaseBarChart }  from './BaseBarChart'
import { ChartCard }     from './ChartCard'
import type { ActivationDay } from '../../../types/dashboard-activation'

interface ProspectionChartProps {
  data:    ActivationDay[]
  loading: boolean
  error:   string | null
  onRetry?: () => void
}

// Formata "2026-05-20" → "20/05"
function formatDate(d: string): string {
  const parts = d.split('-')
  if (parts.length < 3) return d
  return `${parts[2]}/${parts[1]}`
}

const BARS = [
  { key: 'initiated', name: 'Iniciadas',  color: '#6366f1' },
  { key: 'responded', name: 'Respondidas', color: '#a5b4fc' },
]

export function ProspectionChart({ data, loading, error, onRetry }: ProspectionChartProps) {
  const chartData = useMemo(
    () => data.map((d) => ({ date: d.date, initiated: d.initiated, responded: d.responded })),
    [data],
  )

  const isEmpty = !loading && !error && chartData.length === 0

  return (
    <ChartCard
      title="Prospecção por dia"
      subtitle="Conversas iniciadas com outbound e respondidas pelo lead"
      loading={loading}
      error={error}
      empty={isEmpty}
      emptyText="Sem prospecções no período selecionado"
      onRetry={onRetry}
      minHeight={220}
    >
      <BaseBarChart
        data={chartData}
        bars={BARS}
        xKey="date"
        height={220}
        xFormatter={formatDate}
        showLegend
      />
    </ChartCard>
  )
}
