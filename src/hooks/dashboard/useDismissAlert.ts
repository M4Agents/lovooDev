// =====================================================
// useDismissAlert
//
// Hook de ação para dispensar e desfazer alertas do dashboard.
//
// Responsabilidades deste hook:
//   • Chamar dashboardApi.dismissAlert (POST)
//   • Chamar dashboardApi.undoDismissal (DELETE)
//   • Expor loading, error e clearError
//   • Retornar DismissalResult | null (dismiss) e boolean (undo)
//     como sinais para a UI decidir sobre estado otimista
//
// Fora do escopo deste hook:
//   • Gerenciar listas de alertas (responsabilidade da UI / Fase 3B)
//   • Exibir toast, snackbar ou feedback visual
//   • Estado otimista da lista (adição/remoção de itens)
//   • Cache global ou invalidação de queries
// =====================================================

import { useCallback, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type { DismissAlertPayload, DismissalResult } from '../../types/dashboard'

export interface UseDismissAlertResult {
  /**
   * Dispensa um alerta.
   * Retorna DismissalResult (com o id necessário para o undo) em caso de sucesso.
   * Retorna null em caso de erro — sinal para a UI restaurar o estado otimista.
   */
  dismiss:    (payload: DismissAlertPayload) => Promise<DismissalResult | null>

  /**
   * Desfaz uma dispensa pelo id retornado por dismiss().
   * Retorna true em caso de sucesso.
   * Retorna false em caso de erro — a UI decide como tratar.
   */
  undo:       (dismissalId: string) => Promise<boolean>

  /** Estado de carregamento compartilhado entre dismiss e undo. */
  loading:    boolean

  /** Mensagem de erro da última operação falha. null se nenhum erro. */
  error:      string | null

  /** Limpa o estado de erro — chamar após exibir feedback ao usuário. */
  clearError: () => void
}

export function useDismissAlert(): UseDismissAlertResult {
  const { company } = useAuth()
  const companyId = company?.id ?? null

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const clearError = useCallback(() => setError(null), [])

  const dismiss = useCallback(
    async (payload: DismissAlertPayload): Promise<DismissalResult | null> => {
      if (!companyId) {
        setError('Empresa não identificada')
        return null
      }

      setLoading(true)
      setError(null)

      try {
        const res = await dashboardApi.dismissAlert(companyId, payload)
        return res.data
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Erro ao dispensar alerta')
        return null
      } finally {
        setLoading(false)
      }
    },
    [companyId],
  )

  const undo = useCallback(
    async (dismissalId: string): Promise<boolean> => {
      if (!companyId) {
        setError('Empresa não identificada')
        return false
      }

      setLoading(true)
      setError(null)

      try {
        await dashboardApi.undoDismissal(companyId, dismissalId)
        return true
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Erro ao desfazer dispensa')
        return false
      } finally {
        setLoading(false)
      }
    },
    [companyId],
  )

  return { dismiss, undo, loading, error, clearError }
}
