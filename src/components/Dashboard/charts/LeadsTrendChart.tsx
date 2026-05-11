// =====================================================
// LeadsTrendChart — gráfico de novos leads por dia.
// Exibe BarChart com os dados de leads_by_day.
// =====================================================

import React, { useMemo } from 'react'
import { ChartCard } from './ChartCard'
import { BaseBarChart } from './BaseBarChart'
import type { TrendDay } from '../../../types/dashboard'

interface LeadsTrendChartProps {
  data:     TrendDay[] | null | undefined
  loading:  boolean
  error:    string | null
  onRetry?: () => void
}

const BARS = [
  { key: 'count', name: 'Novos leads', color: '#6366f1' },
]

/** Formata "2026-05-08" → "08/05" */
function fmtDate(iso: string): string {
  const parts = iso.split('-')
  if (parts.length < 3) return iso
  return `${parts[2]}/${parts[1]}`
}

export function LeadsTrendChart({ data, loading, error, onRetry }: LeadsTrendChartProps) {
  const chartData = useMemo(
    () => (data ?? []).map((d) => ({ date: fmtDate(d.date), count: d.count })),
    [data],
  )

  const totalLeads = useMemo(
    () => (data ?? []).reduce((acc, d) => acc + d.count, 0),
    [data],
  )

  return (
    <ChartCard
      title="Novos Leads por Dia"
      subtitle={!loading && !error && totalLeads > 0 ? `${totalLeads} no período` : undefined}
      loading={loading}
      error={error}
      empty={!loading && !error && chartData.length === 0}
      emptyText="Nenhum lead novo no período selecionado"
      onRetry={onRetry}
      minHeight={220}
    >
      <BaseBarChart
        data={chartData}
        bars={BARS}
        xKey="date"
        height={180}
        highlightMax
      />
    </ChartCard>
  )
}
