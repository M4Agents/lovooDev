// =====================================================
// HOOK: useOpportunityStageHistory
// Objetivo: carregar histórico completo de etapas de uma oportunidade
//           e resolver nomes de usuários via company_users.
//
// Fonte do tempo na etapa atual:
//   - stage_left_at do último registro histórico = momento em que
//     o usuário entrou na etapa atual (definido atomicamente pela RPC
//     ao mesmo tempo que entered_stage_at em opportunity_funnel_positions)
//   - currentEnteredAt: vem de opportunity_funnel_positions.entered_stage_at
//     como confirmação/fallback para oportunidades pré-migração
// =====================================================

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getCompanyUsers } from '../services/userApi'
import type { OpportunityStageHistory } from '../types/sales-funnel'

export interface UseOpportunityStageHistoryResult {
  history: OpportunityStageHistory[]
  usersMap: Map<string, string>   // userId → displayName ou email
  currentEnteredAt: string | null // quando entrou na etapa atual (para calcular tempo em aberto)
  loading: boolean
  error: string | null
}

export function useOpportunityStageHistory(
  opportunityId: string | null,
  companyId: string
): UseOpportunityStageHistoryResult {
  const [history, setHistory]               = useState<OpportunityStageHistory[]>([])
  const [usersMap, setUsersMap]             = useState<Map<string, string>>(new Map())
  const [currentEnteredAt, setCurrentEnteredAt] = useState<string | null>(null)
  const [loading, setLoading]               = useState(false)
  const [error, setError]                   = useState<string | null>(null)

  useEffect(() => {
    if (!opportunityId || !companyId) return

    let cancelled = false
    setLoading(true)
    setError(null)

    const fetchAll = async () => {
      // #region agent log
      console.error('[DBG:useOppStageHistory] params', { opportunityId, companyId })
      fetch('http://127.0.0.1:7869/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'75feb2'},body:JSON.stringify({sessionId:'75feb2',location:'useOpportunityStageHistory.ts:44',message:'hook params',data:{opportunityId,companyId},timestamp:Date.now(),hypothesisId:'H_C'})}).catch(()=>{})
      // #endregion
      try {
        const [historyRes, usersRes, posRes] = await Promise.all([
          // Histórico de etapas com joins para nomes das etapas
          supabase
            .from('opportunity_stage_history')
            .select(`
              *,
              from_stage:funnel_stages!from_stage_id(id, name, color, position),
              to_stage:funnel_stages!to_stage_id(id, name, color, position)
            `)
            .eq('opportunity_id', opportunityId)
            .eq('company_id', companyId)
            .order('stage_entered_at', { ascending: true }),

          // Usuários da empresa para resolver moved_by → nome real
          getCompanyUsers(companyId).catch(() => []),

          // Posição atual para ter o entered_stage_at autoritativo
          supabase
            .from('opportunity_funnel_positions')
            .select('entered_stage_at')
            .eq('opportunity_id', opportunityId)
            .maybeSingle()
        ])

        if (cancelled) return

        // #region agent log
        console.error('[DBG:useOppStageHistory] historyRes', { data: historyRes.data, error: historyRes.error, count: historyRes.count, dataLength: historyRes.data?.length ?? 'null' })
        fetch('http://127.0.0.1:7869/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'75feb2'},body:JSON.stringify({sessionId:'75feb2',location:'useOpportunityStageHistory.ts:72',message:'historyRes result',data:{dataLength:historyRes.data?.length??'null',hasError:!!historyRes.error,errorMsg:historyRes.error?.message??null},timestamp:Date.now(),hypothesisId:'H_B_H_D'})}).catch(()=>{})
        // #endregion

        if (historyRes.error) throw historyRes.error

        setHistory((historyRes.data ?? []) as OpportunityStageHistory[])

        // Construir mapa userId → nome de exibição
        const map = new Map<string, string>()
        for (const user of usersRes) {
          const name = user.display_name || user.email || 'Usuário'
          map.set(user.user_id, name)
        }
        setUsersMap(map)

        // Tempo de entrada na etapa atual
        if (!posRes.error && posRes.data?.entered_stage_at) {
          setCurrentEnteredAt(posRes.data.entered_stage_at as string)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar histórico')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchAll()
    return () => { cancelled = true }
  }, [opportunityId, companyId])

  return { history, usersMap, currentEnteredAt, loading, error }
}
