// =====================================================
// AttendanceTrendChart — gráfico de atendimentos por dia
// com tempo médio de primeira resposta humana.
//
// Gráfico combo:
//   Barra  (eixo esquerdo)  → atendimentos por dia
//   Linha  (eixo direito)   → avg_response_minutes
// =====================================================

import React, { useMemo } from 'react'
import { ChartCard } from './ChartCard'
import { BaseComboChart } from './BaseComboChart'
import type { AttendanceDay } from '../../../types/dashboard'

interface AttendanceTrendChartProps {
  data:     AttendanceDay[] | null | undefined
  loading:  boolean
  error:    string | null
  onRetry?: () => void
}

const BAR  = { key: 'attended',             name: 'Atendimentos', color: '#10b981' }
const LINE = { key: 'avg_response_minutes', name: 'Tempo médio',  color: '#f59e0b', unit: 'min' }

/** Formata "2026-05-08" → "08/05" */
function fmtDate(iso: string): string {
  const parts = iso.split('-')
  if (parts.length < 3) return iso
  return `${parts[2]}/${parts[1]}`
}

export function AttendanceTrendChart({ data, loading, error, onRetry }: AttendanceTrendChartProps) {
  const chartData = useMemo(
    () => (data ?? []).map((d) => ({
      date:                  fmtDate(d.date),
      attended:              d.attended,
      avg_response_minutes:  d.avg_response_minutes,
    })),
    [data],
  )

  const totalAttended = useMemo(
    () => (data ?? []).reduce((acc, d) => acc + d.attended, 0),
    [data],
  )

  const avgResponse = useMemo(() => {
    const valid = (data ?? []).filter((d) => d.avg_response_minutes != null)
    if (valid.length === 0) return null
    const sum = valid.reduce((acc, d) => acc + (d.avg_response_minutes ?? 0), 0)
    return Math.round(sum / valid.length)
  }, [data])

  const subtitle = !loading && !error && totalAttended > 0
    ? `${totalAttended} atendimentos${avgResponse != null ? ` · avg ${avgResponse}min` : ''}`
    : undefined

  return (
    <ChartCard
      title="Atendimentos por Dia"
      subtitle={subtitle}
      loading={loading}
      error={error}
      empty={!loading && !error && chartData.length === 0}
      emptyText="Nenhum atendimento com resposta humana no período"
      onRetry={onRetry}
      minHeight={220}
    >
      <BaseComboChart
        data={chartData}
        bar={BAR}
        line={LINE}
        xKey="date"
        height={180}
        showLegend
      />
    </ChartCard>
  )
}
