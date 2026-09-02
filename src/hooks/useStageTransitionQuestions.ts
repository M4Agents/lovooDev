// =====================================================
// useStageTransitionQuestions Hook
// Data: 02/09/2026 - Etapa F
// =====================================================

import { useState, useEffect, useCallback } from 'react'
import { isStageTransitionQuestionsFeatureEnabled } from './dashboard/useFeatureFlags'
import {
  fetchAllQuestions,
  fetchActiveQuestions,
  setStageEnabled,
  fetchStageConfig
} from '../services/stageTransitionQuestionsTransport'
import { StageTransitionServiceError } from '../services/stageTransitionQuestionsService'
import type { StageTransitionQuestion } from '../types/stage-transition-questions'

interface UseStageTransitionQuestionsResult {
  questions: StageTransitionQuestion[]
  activeQuestions: StageTransitionQuestion[]
  enabled: boolean | null // null = unknown/not loaded
  activeCount: number  // explicit count from backend
  loading: boolean
  error: string | null
  featureEnabled: boolean
  setEnabled: (enabled: boolean) => Promise<void>
  refresh: () => Promise<void>
}

export function useStageTransitionQuestions(
  stageId: string | undefined,
  includeInactive: boolean = false
): UseStageTransitionQuestionsResult {
  const featureEnabled = isStageTransitionQuestionsFeatureEnabled()

  const [questions, setQuestions] = useState<StageTransitionQuestion[]>([])
  const [enabled, setEnabledState] = useState<boolean | null>(null)
  const [activeCount, setActiveCount] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!featureEnabled || !stageId) {
      setLoading(false)
      setQuestions([])
      setEnabledState(null)
      setActiveCount(0)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Fetch explicit config (enabled + count)
      const config = await fetchStageConfig(stageId)
      setEnabledState(config.enabled)
      setActiveCount(config.activeQuestionCount)

      // Fetch questions if needed
      if (includeInactive) {
        const data = await fetchAllQuestions(stageId, true)
        setQuestions(data)
      } else {
        // For non-includeInactive, just use activeCount from config
        // Don't fetch questions to reduce requests
        setQuestions([])
      }
    } catch (err) {
      if (err instanceof StageTransitionServiceError) {
        setError(err.message)
      } else {
        setError('Erro ao carregar configuração')
      }
      setQuestions([])
      setEnabledState(null)
      setActiveCount(0)
    } finally {
      setLoading(false)
    }
  }, [stageId, includeInactive, featureEnabled])

  useEffect(() => {
    refresh()
  }, [refresh])

  const setEnabled = async (newEnabled: boolean) => {
    if (!featureEnabled || !stageId) {
      throw new Error('Feature not enabled')
    }

    setLoading(true)
    setError(null)

    try {
      await setStageEnabled(stageId, newEnabled)
      setEnabledState(newEnabled)
      await refresh()
    } catch (err) {
      if (err instanceof StageTransitionServiceError) {
        setError(err.message)
        throw err
      } else {
        const error = new Error('Erro ao atualizar configuração')
        setError(error.message)
        throw error
      }
    } finally {
      setLoading(false)
    }
  }

  const activeQuestions = questions.filter(q => q.active)

  return {
    questions,
    activeQuestions,
    enabled,
    activeCount,  // explicit count from backend
    loading,
    error,
    featureEnabled,
    setEnabled,
    refresh
  }
}
