// =====================================================
// ActivationSection — seção completa da aba "Ativação Comercial".
// Layout:
//   • ActivationKPIs  (6 métricas em 2 grupos)
//   • ProspectionChart
//   • RescueChart
//
// Recebe os dados do hook useDashboardActivation como props.
// Stack isolada — NÃO depende de dados da aba Operação.
// =====================================================

import React from 'react'
import { ActivationKPIs }   from '../cards/ActivationKPIs'
import { ProspectionChart } from '../charts/ProspectionChart'
import { RescueChart }      from '../charts/RescueChart'
import type { ActivationData } from '../../../types/dashboard-activation'

interface ActivationSectionProps {
  data:     ActivationData | null
  loading:  boolean
  error:    string | null
  onRetry?: () => void
}

export function ActivationSection({ data, loading, error, onRetry }: ActivationSectionProps) {
  const prospectionDays = data?.prospection_by_day ?? []
  const rescueDays      = data?.rescue_by_day      ?? []
  const summary         = data?.summary             ?? null

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <ActivationKPIs summary={summary} loading={loading} />

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ProspectionChart
          data={prospectionDays}
          loading={loading}
          error={error}
          onRetry={onRetry}
        />
        <RescueChart
          data={rescueDays}
          loading={loading}
          error={error}
          onRetry={onRetry}
        />
      </div>
    </div>
  )
}
