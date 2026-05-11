// =====================================================
// TrendsSection — seção de gráficos de tendência.
// Layout: dois gráficos lado a lado (responsivo).
//   [Novos Leads por Dia] [Atendimentos + Tempo de Resposta]
// =====================================================

import React from 'react'
import { LeadsTrendChart }      from '../charts/LeadsTrendChart'
import { AttendanceTrendChart } from '../charts/AttendanceTrendChart'
import type { TrendsData } from '../../../types/dashboard'

interface TrendsSectionProps {
  data:     TrendsData | null
  loading:  boolean
  error:    string | null
  onRetry?: () => void
}

export function TrendsSection({ data, loading, error, onRetry }: TrendsSectionProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <LeadsTrendChart
        data={data?.leads_by_day}
        loading={loading}
        error={error}
        onRetry={onRetry}
      />
      <AttendanceTrendChart
        data={data?.attendance_by_day}
        loading={loading}
        error={error}
        onRetry={onRetry}
      />
    </div>
  )
}
