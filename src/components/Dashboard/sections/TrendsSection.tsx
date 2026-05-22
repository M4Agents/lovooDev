// =====================================================
// TrendsSection — seção de operação inbound diária (v4).
// Layout: gráfico único "Entrada de Leads por Dia".
// =====================================================

import React from 'react'
import { CombinedTrendsChart } from '../charts/CombinedTrendsChart'
import type { TrendsData }     from '../../../types/dashboard'

interface TrendsSectionProps {
  data:     TrendsData | null
  loading:  boolean
  error:    string | null
  onRetry?: () => void
}

export function TrendsSection({ data, loading, error, onRetry }: TrendsSectionProps) {
  return (
    <div className="w-full flex flex-col gap-4">
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
