// =====================================================
// TrendsSection — seção de operação inbound diária (v4).
// Layout: dois gráficos empilhados.
//   [Inbound por Dia]   → WhatsApp + webhook
//   [Novos Leads]       → importação de planilha/CSV
// =====================================================

import React from 'react'
import { CombinedTrendsChart } from '../charts/CombinedTrendsChart'
import { LeadsTrendChart }     from '../charts/LeadsTrendChart'
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
      <LeadsTrendChart
        data={data?.leads_by_day}
        loading={loading}
        error={error}
        onRetry={onRetry}
      />
    </div>
  )
}
