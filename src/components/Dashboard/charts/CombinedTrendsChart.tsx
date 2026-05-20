// =====================================================
// CombinedTrendsChart — gráfico de operação inbound diária.
//
// Semântica correta (v3):
//   Barra azul  → inbound recebidos por dia  (inbound_total)
//   Barra verde → inbound respondidos por dia (attended)
//
// Ambos os números pertencem ao mesmo fluxo operacional:
//   chegou → foi respondido (ou não).
//
// Novos leads NÃO fazem parte deste gráfico — pertencem
// a uma dimensão de geração, não de operação inbound.
//
// Subtítulo:
//   "X recebidos · Y respondidos · Z sem resposta · avg Nmin"
//
// Fallback seguro:
//   inbound_total ausente → attended + (unanswered ?? 0)
//   unanswered ausente    → total_unanswered escalar do período
// =====================================================

import React, { useMemo } from 'react'
import { ChartCard }    from './ChartCard'
import { BaseBarChart } from './BaseBarChart'
import type { AttendanceDay } from '../../../types/dashboard'

interface CombinedTrendsChartProps {
  attendanceData:    AttendanceDay[] | null | undefined
  totalUnanswered?:  number
  loading:           boolean
  error:             string | null
  onRetry?:          () => void
}

const BARS = [
  { key: 'inbound_total', name: 'Recebidos',   color: '#6366f1' },
  { key: 'attended',      name: 'Respondidos', color: '#10b981' },
]

/** "2026-05-08" → "08/05" */
function fmtDate(iso: string): string {
  const parts = iso.split('-')
  return parts.length >= 3 ? `${parts[2]}/${parts[1]}` : iso
}

export function CombinedTrendsChart({
  attendanceData,
  totalUnanswered = 0,
  loading,
  error,
  onRetry,
}: CombinedTrendsChartProps) {

  const chartData = useMemo(() => {
    const attendance = attendanceData ?? []
    return attendance.map((d) => ({
      date:          fmtDate(d.date),
      // Fallback: se inbound_total não vier da API (v2 legacy), recalcula
      inbound_total: d.inbound_total ?? (d.attended + (d.unanswered ?? 0)),
      attended:      d.attended,
    }))
  }, [attendanceData])

  const totalAttended = useMemo(
    () => (attendanceData ?? []).reduce((acc, d) => acc + d.attended, 0),
    [attendanceData],
  )

  // Total inbound recebido: soma diária de inbound_total.
  // Fallback: usa attended + unanswered por dia, ou totalUnanswered escalar.
  const totalInbound = useMemo(() => {
    const days = attendanceData ?? []
    if (days.length === 0) return totalAttended + totalUnanswered
    return days.reduce((acc, d) => {
      const daily = d.inbound_total ?? (d.attended + (d.unanswered ?? 0))
      return acc + daily
    }, 0)
  }, [attendanceData, totalAttended, totalUnanswered])

  // Unanswered total: diferença entre recebidos e respondidos.
  // Consistente com totalUnanswered escalar da API.
  const totalUnresp = useMemo(
    () => Math.max(0, totalInbound - totalAttended),
    [totalInbound, totalAttended],
  )

  // Média ponderada real: soma total de minutos / total de respondidos.
  const avgResponse = useMemo(() => {
    const totalMinutes = (attendanceData ?? []).reduce(
      (acc, d) => acc + (d.sum_response_minutes ?? 0),
      0,
    )
    return totalAttended > 0 ? Math.round(totalMinutes / totalAttended) : null
  }, [attendanceData, totalAttended])

  const subtitle = useMemo(() => {
    if (loading || error) return undefined
    if (totalInbound === 0 && totalAttended === 0) return undefined
    const parts: string[] = []
    if (totalInbound  > 0) parts.push(`${totalInbound} recebidos`)
    if (totalAttended > 0) parts.push(`${totalAttended} respondidos`)
    if (totalUnresp   > 0) parts.push(`${totalUnresp} sem resposta`)
    if (avgResponse  != null) parts.push(`avg ${avgResponse}min`)
    return parts.join(' · ')
  }, [loading, error, totalInbound, totalAttended, totalUnresp, avgResponse])

  return (
    <ChartCard
      title="Inbound por Dia"
      subtitle={subtitle}
      loading={loading}
      error={error}
      empty={!loading && !error && chartData.length === 0}
      emptyText="Nenhum inbound encontrado no período selecionado"
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
