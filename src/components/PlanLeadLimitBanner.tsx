// =============================================================================
// PlanLeadLimitBanner.tsx
//
// Banner de alerta de proximidade/excesso de limite de leads do plano.
//
// EXIBIÇÃO:
//   alert_level = 'ok' | 'unlimited' → sem renderização
//   alert_level = 'warning'  → banner amarelo (≥ 80% do limite)
//   alert_level = 'danger'   → banner laranja (≥ 90% do limite)
//   alert_level = 'critical' → banner vermelho (≥ 100% ou leads restritos)
//
// USO:
//   <PlanLeadLimitBanner leadStats={leadStats} />
//
// Onde leadStats vem de usePlanLeadStats(companyId).
// =============================================================================

import React from 'react'
import { AlertTriangle, AlertCircle, Info } from 'lucide-react'
import type { LeadStats } from '../hooks/usePlanLeadStats'

interface PlanLeadLimitBannerProps {
  leadStats: LeadStats | null
}

export const PlanLeadLimitBanner: React.FC<PlanLeadLimitBannerProps> = ({ leadStats }) => {
  if (!leadStats) return null
  if (leadStats.alert_level === 'unlimited' || leadStats.alert_level === 'ok') return null

  if (leadStats.alert_level === 'critical') {
    return (
      <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 mb-4">
        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Limite de leads atingido. </span>
          {leadStats.over_plan > 0 && (
            <span>
              Você possui{' '}
              <strong>
                {leadStats.over_plan} lead{leadStats.over_plan > 1 ? 's' : ''} fora do plano
              </strong>{' '}
              — dados sensíveis estão ocultos para esses leads.{' '}
            </span>
          )}
          Considere fazer upgrade do plano para liberar o acesso completo.
        </div>
      </div>
    )
  }

  if (leadStats.alert_level === 'danger') {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-800 mb-4">
        <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0" />
        <span>
          Você está usando{' '}
          <strong>{leadStats.proximity_pct}%</strong> do limite de leads do seu plano
          {leadStats.max !== null ? ` (${leadStats.current}/${leadStats.max})` : ''}.
          {' '}Considere fazer upgrade em breve para não perder visibilidade nos leads.
        </span>
      </div>
    )
  }

  // warning (≥ 80%)
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 mb-4">
      <Info className="w-5 h-5 text-amber-500 flex-shrink-0" />
      <span>
        Você está próximo do limite de leads do seu plano
        {leadStats.max !== null
          ? ` — ${leadStats.current} de ${leadStats.max} leads utilizados (${leadStats.proximity_pct}%).`
          : '.'}
      </span>
    </div>
  )
}
