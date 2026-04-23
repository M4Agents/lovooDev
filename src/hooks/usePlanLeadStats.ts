// =============================================================================
// usePlanLeadStats.ts
//
// Hook para buscar estatísticas de leads do plano da empresa via
// GET /api/plans/limits → lead_stats.
//
// RETORNO:
//   leadStats: { current, over_plan, max, proximity_pct, alert_level }
//   loading: boolean
//
// alert_level semântica (calculado no backend):
//   'unlimited' → max_leads = NULL (sem limite)
//   'ok'        → < 80% do limite
//   'warning'   → ≥ 80% e < 90%
//   'danger'    → ≥ 90% e < 100%
//   'critical'  → ≥ 100% ou existem leads com is_over_plan = true
// =============================================================================

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export interface LeadStats {
  current:       number | null
  over_plan:     number
  max:           number | null
  proximity_pct: number | null
  alert_level:   'unlimited' | 'ok' | 'warning' | 'danger' | 'critical'
}

/**
 * Busca lead_stats do endpoint GET /api/plans/limits para a empresa ativa.
 *
 * @param companyId - UUID da empresa. Se null/undefined, não faz fetch.
 */
export function usePlanLeadStats(companyId: string | null | undefined) {
  const [leadStats, setLeadStats] = useState<LeadStats | null>(null)
  const [loading,   setLoading]   = useState(false)

  useEffect(() => {
    if (!companyId) return

    let cancelled = false

    async function fetchStats() {
      setLoading(true)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token || cancelled) return

        const res = await fetch(`/api/plans/limits?company_id=${encodeURIComponent(companyId)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })

        if (!res.ok || cancelled) return

        const json = await res.json()

        if (!cancelled && json?.lead_stats) {
          setLeadStats(json.lead_stats as LeadStats)
        }
      } catch (err) {
        console.error('[usePlanLeadStats] erro ao buscar lead_stats:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchStats()

    return () => {
      cancelled = true
    }
  }, [companyId])

  return { leadStats, loading }
}
