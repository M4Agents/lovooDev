// =====================================================
// CombinedTrendsChart — gráfico único com duas séries:
//   Barra roxa  → novos leads por dia
//   Barra verde → atendimentos por dia
//
// Subtítulo resumido com totais do período:
//   "{totalLeads} leads · {attended} atendimentos · {unanswered} sem resposta · avg Nmin"
//
// Média de resposta: ponderada real (sum_response_minutes / attended).
// =====================================================

import React, { useMemo } from 'react'
import { ChartCard }    from './ChartCard'
import { BaseBarChart } from './BaseBarChart'
import type { TrendDay, AttendanceDay } from '../../../types/dashboard'

interface CombinedTrendsChartProps {
  leadsData:        TrendDay[]      | null | undefined
  attendanceData:   AttendanceDay[] | null | undefined
  totalUnanswered?: number
  loading:          boolean
  error:            string | null
  onRetry?:         () => void
}

const BARS = [
  { key: 'leads',     name: 'Novos leads',   color: '#6366f1' },
  { key: 'attended',  name: 'Atendimentos',  color: '#10b981' },
]

/** "2026-05-08" → "08/05" */
function fmtDate(iso: string): string {
  const parts = iso.split('-')
  return parts.length >= 3 ? `${parts[2]}/${parts[1]}` : iso
}

export function CombinedTrendsChart({
  leadsData,
  attendanceData,
  totalUnanswered = 0,
  loading,
  error,
  onRetry,
}: CombinedTrendsChartProps) {

  // Merge das duas séries por data ISO (chave comum).
  // Datas presentes em apenas uma série recebem 0 na outra.
  const chartData = useMemo(() => {
    const leads      = leadsData      ?? []
    const attendance = attendanceData ?? []

    // Índice por data ISO para lookup O(1)
    const leadsMap = new Map(leads.map((d) => [d.date, d.count]))
    const attMap   = new Map(attendance.map((d) => [d.date, d.attended]))

    // União de datas presentes em qualquer das duas séries
    const allDates = Array.from(
      new Set([...leads.map((d) => d.date), ...attendance.map((d) => d.date)])
    ).sort()

    return allDates.map((iso) => ({
      date:     fmtDate(iso),
      leads:    leadsMap.get(iso)    ?? 0,
      attended: attMap.get(iso)      ?? 0,
    }))
  }, [leadsData, attendanceData])

  const totalLeads = useMemo(
    () => (leadsData ?? []).reduce((acc, d) => acc + d.count, 0),
    [leadsData],
  )

  const totalAttended = useMemo(
    () => (attendanceData ?? []).reduce((acc, d) => acc + d.attended, 0),
    [attendanceData],
  )

  // Média ponderada real: soma total de minutos / total de atendimentos.
  // sum_response_minutes pode ser null quando nenhuma resposta foi dada no dia.
  // Divisão por zero protegida.
  const avgResponse = useMemo(() => {
    const totalMinutes = (attendanceData ?? []).reduce(
      (acc, d) => acc + (d.sum_response_minutes ?? 0),
      0,
    )
    return totalAttended > 0 ? Math.round(totalMinutes / totalAttended) : null
  }, [attendanceData, totalAttended])

  const subtitle = useMemo(() => {
    if (loading || error) return undefined
    if (totalLeads === 0 && totalAttended === 0) return undefined
    const parts: string[] = []
    if (totalLeads    > 0) parts.push(`${totalLeads} leads`)
    if (totalAttended > 0) parts.push(`${totalAttended} atendimentos`)
    if (totalUnanswered > 0) parts.push(`${totalUnanswered} sem resposta`)
    if (avgResponse != null) parts.push(`avg ${avgResponse}min`)
    return parts.join(' · ')
  }, [loading, error, totalLeads, totalAttended, totalUnanswered, avgResponse])

  return (
    <ChartCard
      title="Leads e Atendimentos por Dia"
      subtitle={subtitle}
      loading={loading}
      error={error}
      empty={!loading && !error && chartData.length === 0}
      emptyText="Nenhum dado encontrado no período selecionado"
      onRetry={onRetry}
      minHeight={220}
    >
      <BaseBarChart
        data={chartData}
        bars={BARS}
        xKey="date"
        height={180}
        showLegend
      />
    </ChartCard>
  )
}
