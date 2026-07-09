// =====================================================
// HOOK: useContactCyclePanel
// Objetivo: carregar state + histórico + tentativas de ciclos
//           de contato de uma oportunidade.
//
// Leitura pura — não expõe mutações.
// Mutações (closeCycle, cancelAttempt) são responsabilidade
// dos componentes, que chamam contactCycleApi diretamente
// e invocam refresh() após sucesso.
//
// Lazy loading: passar null como opportunityId enquanto a
// aba Ciclos não estiver ativa (isOpen && activeTab === 'cycles').
// =====================================================

import { useEffect, useState, useCallback } from 'react'
import { contactCycleApi } from '../services/contactCycleApi'
import type {
  ContactCycleState,
  ContactCycleHistoryItem,
  ContactAttemptDetail,
} from '../types/contact-cycles'

// Record em vez de Map: serializável, compatível com React DevTools,
// alinhado com o padrão usado no restante do projeto.
export type AttemptsByCycle = Record<string, ContactAttemptDetail[]>

export interface UseContactCyclePanelResult {
  state:           ContactCycleState | null
  cycles:          ContactCycleHistoryItem[]
  attemptsByCycle: AttemptsByCycle
  loading:         boolean
  error:           string | null
  refresh:         () => void
}

export function useContactCyclePanel(
  opportunityId: string | null,
  companyId: string,
): UseContactCyclePanelResult {
  const [state,           setState]           = useState<ContactCycleState | null>(null)
  const [cycles,          setCycles]          = useState<ContactCycleHistoryItem[]>([])
  const [attemptsByCycle, setAttemptsByCycle] = useState<AttemptsByCycle>({})
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState<string | null>(null)
  const [refreshToken,    setRefreshToken]    = useState(0)

  const refresh = useCallback(() => setRefreshToken(n => n + 1), [])

  useEffect(() => {
    if (!opportunityId || !companyId) return

    let cancelled = false
    setLoading(true)
    setError(null)

    const fetchAll = async () => {
      try {
        const [stateRes, historyRes, attemptsRes] = await Promise.all([
          contactCycleApi.getOpportunityState(opportunityId, companyId),
          contactCycleApi.getCycleHistory(opportunityId, companyId),
          contactCycleApi.listAttempts(opportunityId, companyId),
        ])

        if (cancelled) return

        setState(stateRes)
        setCycles(historyRes)

        // Agrupar tentativas por cycle_id usando Record (não Map)
        const grouped: AttemptsByCycle = {}
        for (const attempt of attemptsRes) {
          if (!grouped[attempt.cycle_id]) {
            grouped[attempt.cycle_id] = []
          }
          grouped[attempt.cycle_id].push(attempt)
        }
        setAttemptsByCycle(grouped)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar ciclos de contato')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchAll()
    return () => { cancelled = true }
  }, [opportunityId, companyId, refreshToken])

  return { state, cycles, attemptsByCycle, loading, error, refresh }
}
