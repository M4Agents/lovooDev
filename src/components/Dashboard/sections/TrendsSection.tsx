// =====================================================
// TrendsSection — seção de operação inbound diária.
// Layout: gráfico combinado em largura total.
//   [Inbound por Dia]
//
// Novos leads não fazem parte desta seção (v3).
// =====================================================

import React from 'react'
import { CombinedTrendsChart } from '../charts/CombinedTrendsChart'
import type { TrendsData } from '../../../types/dashboard'

interface TrendsSectionProps {
  data:     TrendsData | null
  loading:  boolean
  error:    string | null
  onRetry?: () => void
}

export function TrendsSection({ data, loading, error, onRetry }: TrendsSectionProps) {
  return (
    <div className="w-full">
      <CombinedTrendsChart
        attendanceData={data?.attendance_by_day}
        totalUnanswered={data?.total_unanswered ?? 0}
        loading={loading}
        error={error}
        onRetry={onRetry}
      />
    </div>
  )
}
