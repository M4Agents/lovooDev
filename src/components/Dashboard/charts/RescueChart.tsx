// =====================================================
// RescueChart — gráfico de barras agrupadas de resgate.
// Exibe por dia: resgates iniciados + respondidos.
// Usa BaseBarChart (dois grupos de barras).
// =====================================================

import React, { useMemo } from 'react'
import { BaseBarChart }  from './BaseBarChart'
import { ChartCard }     from './ChartCard'
import type { ActivationDay } from '../../../types/dashboard-activation'

interface RescueChartProps {
  data:     ActivationDay[]
  loading:  boolean
  error:    string | null
  onRetry?: () => void
}

// Formata "2026-05-20" → "20/05"
function formatDate(d: string): string {
  const parts = d.split('-')
  if (parts.length < 3) return d
  return `${parts[2]}/${parts[1]}`
}

const BARS = [
  { key: 'initiated', name: 'Resgates iniciados',  color: '#10b981' },
  { key: 'responded', name: 'Resgates respondidos', color: '#6ee7b7' },
]

export function RescueChart({ data, loading, error, onRetry }: RescueChartProps) {
  const chartData = useMemo(
    () => data.map((d) => ({ date: d.date, initiated: d.initiated, responded: d.responded })),
    [data],
  )

  const isEmpty = !loading && !error && chartData.length === 0

  return (
    <ChartCard
      title="Resgate por dia"
      subtitle="Leads inativos contatados com outbound e que responderam"
      loading={loading}
      error={error}
      empty={isEmpty}
      emptyText="Sem resgates no período selecionado"
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
