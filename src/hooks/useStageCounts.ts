// =====================================================
// HOOK: useStageCounts
// Fase 3 — Contadores por etapa
//
// Responsabilidade: buscar e manter os contadores (count +
// total_value) de todas as etapas de um funil, respeitando
// os filtros server-side da Fase 2.
//
// O `filter` deve ser o mesmo objeto memoizado usado pelo
// FunnelBoard para garantir consistência visual entre
// contadores e cards exibidos.
//
// Uso:
//   const { counts, loading, refresh } = useStageCounts(funnelId, companyId, filter)
//   counts[stageId]?.count      // total de cards
//   counts[stageId]?.total_value // soma dos valores
// =====================================================

import { useState, useEffect, useCallback } from 'react'
import { funnelApi } from '../services/funnelApi'
import type { LeadPositionFilter, StageCount } from '../types/sales-funnel'

export interface UseStageCounts {
  counts: Record<string, StageCount>
  loading: boolean
  refresh: () => void
}

export function useStageCounts(
  funnelId: string,
  companyId: string | undefined,
  filter: LeadPositionFilter
): UseStageCounts {
  const [counts, setCounts] = useState<Record<string, StageCount>>({})
  const [loading, setLoading] = useState(false)

  const fetchCounts = useCallback(async () => {
    if (!funnelId || !companyId) return

    setLoading(true)
    try {
      const data = await funnelApi.getStageCounts(funnelId, companyId, {
        search:      filter.search,
        origin:      filter.origin,
        period_days: filter.period_days
      })

      const map: Record<string, StageCount> = {}
      data.forEach(sc => {
        map[sc.stage_id] = sc
      })
      // #region agent log
      fetch('http://127.0.0.1:7869/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'27238b'},body:JSON.stringify({sessionId:'27238b',location:'useStageCounts.ts:fetchCounts',message:'counts map built',data:{stageKeys:Object.keys(map),sample:Object.entries(map).slice(0,3).map(([k,v])=>({stageId:k,count:v.count,total_value:v.total_value}))},timestamp:Date.now(),hypothesisId:'B-C'})}).catch(()=>{});
      // #endregion
      setCounts(map)
    } catch (err) {
      console.error('Error fetching stage counts:', err)
    } finally {
      setLoading(false)
    }
  }, [funnelId, companyId, filter])

  useEffect(() => {
    fetchCounts()
  }, [fetchCounts])

  return { counts, loading, refresh: fetchCounts }
}
