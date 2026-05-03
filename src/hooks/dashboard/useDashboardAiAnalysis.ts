// =====================================================
// useDashboardAiAnalysis
//
// State machine para o fluxo de IA Analítica sob demanda.
//
// Etapas:
//   closed → selecting → preview → processing → result
//                                              ↘ insufficient_credits → checkout_pending
//                                                                      → ready_to_continue → processing
//                              ↘ error
//   closed → history
//
// Regra de preservação de estado:
//   Fechar o modal não reseta o estado — permite reabrir no mesmo passo.
//   Apenas "Nova análise" reseta para 'selecting'.
// =====================================================

import { useState, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardApi } from '../../services/dashboardApi'
import type {
  AiAnalysisType,
  AiAnalysisResult,
  AiAnalysisSummary,
  AiAnalysisPostResponse,
} from '../../services/dashboardApi'

export type AiAnalysisStep =
  | 'closed'
  | 'selecting'
  | 'preview'
  | 'processing'
  | 'result'
  | 'insufficient_credits'
  | 'checkout_pending'
  | 'ready_to_continue'
  | 'error'
  | 'history'

export interface AiCreditInfo {
  balance:    number
  estimated:  number
  required:   number
  missing:    number
  analysisId: string | null
}

interface AiAnalysisState {
  step:            AiAnalysisStep
  analysisType:    AiAnalysisType | null
  analysisId:      string | null
  result:          AiAnalysisResult | null
  creditInfo:      AiCreditInfo | null
  error:           string | null
  loading:         boolean
  history:         AiAnalysisSummary[]
  historyLoading:  boolean
}

const INITIAL_STATE: AiAnalysisState = {
  step:           'closed',
  analysisType:   null,
  analysisId:     null,
  result:         null,
  creditInfo:     null,
  error:          null,
  loading:        false,
  history:        [],
  historyLoading: false,
}

export function useDashboardAiAnalysis(companyId: string | null) {
  const { company } = useAuth()
  const effectiveCompanyId = companyId ?? company?.id ?? null

  const [state, setState] = useState<AiAnalysisState>(INITIAL_STATE)

  const patch = useCallback((updates: Partial<AiAnalysisState>) => {
    setState(prev => ({ ...prev, ...updates }))
  }, [])

  // ── Abrir modal ─────────────────────────────────────────────────────────────

  /** Abre em 'selecting'. Se resumeAnalysisId fornecido, vai direto para 'ready_to_continue'. */
  const open = useCallback(async (resumeAnalysisId?: string | null) => {
    if (resumeAnalysisId) {
      patch({ step: 'ready_to_continue', analysisId: resumeAnalysisId, loading: false })
    } else {
      patch({ step: 'selecting', analysisType: null, result: null, error: null, creditInfo: null })
    }
  }, [patch])

  const close = useCallback(() => {
    // Preserva estado: usuário pode reabrir no mesmo passo
    patch({ step: 'closed' })
  }, [patch])

  /** Reseta para início — usado pelo botão "Nova análise" */
  const reset = useCallback(() => {
    patch({ step: 'selecting', analysisType: null, result: null, error: null, creditInfo: null, analysisId: null })
  }, [patch])

  // ── Seleção de tipo → preview ────────────────────────────────────────────

  const selectType = useCallback((type: AiAnalysisType) => {
    patch({ analysisType: type, step: 'preview', error: null })
  }, [patch])

  const backToSelecting = useCallback(() => {
    patch({ step: 'selecting', error: null })
  }, [patch])

  // ── Executar análise ─────────────────────────────────────────────────────

  const execute = useCallback(async (funnelId?: string | null) => {
    if (!effectiveCompanyId || !state.analysisType) return

    patch({ step: 'processing', loading: true, error: null })

    try {
      const { status, data } = await dashboardApi.requestAiAnalysis(effectiveCompanyId, {
        analysis_type: state.analysisType,
        period:        '30d',
        funnel_id:     funnelId ?? null,
      })

      handleApiResponse(status, data)
    } catch (err: unknown) {
      patch({ step: 'error', loading: false, error: err instanceof Error ? err.message : 'Erro inesperado' })
    }
  }, [effectiveCompanyId, state.analysisType, patch]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Retomar análise (após compra de créditos ou credit_failed) ───────────

  const continueAfterCredits = useCallback(async () => {
    if (!effectiveCompanyId || !state.analysisId) return

    patch({ step: 'processing', loading: true, error: null })

    try {
      const { status, data } = await dashboardApi.requestAiAnalysis(effectiveCompanyId, {
        analysis_id: state.analysisId,
      })

      handleApiResponse(status, data)
    } catch (err: unknown) {
      patch({ step: 'error', loading: false, error: err instanceof Error ? err.message : 'Erro inesperado' })
    }
  }, [effectiveCompanyId, state.analysisId, patch]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Visualizar análise do cache / histórico ──────────────────────────────

  const viewAnalysis = useCallback(async (analysisId: string) => {
    patch({ loading: true, error: null })
    try {
      const res = await dashboardApi.getAiAnalysis(analysisId)
      patch({ step: 'result', result: res.data, analysisId, loading: false })
    } catch (err: unknown) {
      patch({ step: 'error', loading: false, error: err instanceof Error ? err.message : 'Erro ao carregar análise' })
    }
  }, [patch])

  // ── Processar resposta da API ────────────────────────────────────────────

  function handleApiResponse(status: number, data: AiAnalysisPostResponse) {
    if (status === 429) {
      patch({ step: 'error', loading: false, error: 'Aguarde alguns segundos antes de solicitar nova análise.' })
      return
    }

    if (status === 402 || data.status === 'awaiting_credits') {
      patch({
        step:       'insufficient_credits',
        loading:    false,
        analysisId: data.analysis_id ?? null,
        creditInfo: {
          balance:    data.balance_available ?? 0,
          estimated:  data.estimated_credits ?? 0,
          required:   data.required_balance  ?? 0,
          missing:    data.missing_credits   ?? 0,
          analysisId: data.analysis_id       ?? null,
        },
      })
      return
    }

    if (data.status === 'credit_failed') {
      patch({
        step:       'insufficient_credits',
        loading:    false,
        analysisId: data.analysis_id ?? null,
        creditInfo: {
          balance:    0,
          estimated:  0,
          required:   0,
          missing:    0,
          analysisId: data.analysis_id ?? null,
        },
        error: data.message ?? 'Débito falhou após análise. Compre créditos para liberar o resultado.',
      })
      return
    }

    if (data.cache_available && data.analysis_id) {
      viewAnalysis(data.analysis_id)
      return
    }

    if (data.processing && data.analysis_id) {
      // Análise em andamento — carregar resultado pelo ID
      viewAnalysis(data.analysis_id)
      return
    }

    if (data.ok && data.data) {
      patch({ step: 'result', result: data.data, analysisId: data.analysis_id ?? null, loading: false })
      return
    }

    if (status >= 500 || !data.ok) {
      patch({ step: 'error', loading: false, error: data.error ?? 'Erro interno do servidor.' })
    }
  }

  // ── Histórico ─────────────────────────────────────────────────────────────

  const openHistory = useCallback(async () => {
    if (!effectiveCompanyId) return
    patch({ step: 'history', historyLoading: true })
    try {
      const res = await dashboardApi.getAiAnalyses(effectiveCompanyId)
      patch({ history: res.data, historyLoading: false })
    } catch {
      patch({ historyLoading: false })
    }
  }, [effectiveCompanyId, patch])

  // ── Checkout ──────────────────────────────────────────────────────────────

  const initiateCheckout = useCallback(async (packageId: string, analysisId: string | null) => {
    try {
      const { data: { session } } = await import('../../lib/supabase').then(m => m.supabase.auth.getSession())
      const token = session?.access_token
      if (!token) return

      const res = await fetch('/api/credit-orders/checkout', {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ package_id: packageId, ...(analysisId ? { analysis_id: analysisId } : {}) }),
      })
      const json = await res.json()
      if (json.checkout_url) {
        patch({ step: 'checkout_pending' })
        window.open(json.checkout_url, '_blank', 'noopener')
      }
    } catch {
      patch({ error: 'Erro ao iniciar checkout. Tente novamente.' })
    }
  }, [patch])

  return {
    ...state,
    open,
    close,
    reset,
    selectType,
    backToSelecting,
    execute,
    continueAfterCredits,
    viewAnalysis,
    openHistory,
    initiateCheckout,
  }
}
