// =====================================================
// TESTES: FunnelBoard Stage Transition Questions (Etapa G)
// Data: 02/09/2026
// Objetivo: Validar lógica de decisão para perguntas de transição
// Escopo: Testes unitários com mocks (sem renderizar componente React)
// =====================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// =====================================================
// MOCKS
// =====================================================

// Mock dos módulos externos
vi.mock('../../../hooks/dashboard/useFeatureFlags', () => ({
  isStageTransitionQuestionsFeatureEnabled: vi.fn()
}))

vi.mock('../../../services/stageTransitionQuestionsTransport', () => ({
  fetchStageConfig: vi.fn(),
  fetchActiveQuestions: vi.fn()
}))

vi.mock('../../../services/stageTransitionQuestionsService', () => ({
  StageTransitionFeatureDisabledError: class StageTransitionFeatureDisabledError extends Error {
    constructor() {
      super('Feature disabled')
      this.name = 'StageTransitionFeatureDisabledError'
    }
  }
}))

import { isStageTransitionQuestionsFeatureEnabled } from '../../../hooks/dashboard/useFeatureFlags'
import { fetchStageConfig, fetchActiveQuestions } from '../../../services/stageTransitionQuestionsTransport'
import { StageTransitionFeatureDisabledError } from '../../../services/stageTransitionQuestionsService'

// =====================================================
// HELPERS TESTADOS
// =====================================================

/**
 * Simula a lógica de decisão do handleDragEnd para transições active→active.
 * Retorna: 'legacy' | 'modal' | 'error'
 */
async function decideTransitionFlow(
  fromType: string,
  toType: string,
  toStageId: string
): Promise<{ flow: 'legacy' | 'modal' | 'error'; error?: string; questions?: any[] }> {
  const featureEnabled = (isStageTransitionQuestionsFeatureEnabled as any)()

  if (!featureEnabled) {
    return { flow: 'legacy' }
  }

  if (fromType !== 'active' || toType !== 'active') {
    return { flow: 'legacy' }
  }

  try {
    const config = await (fetchStageConfig as any)(toStageId)

    if (!config.enabled || config.activeQuestionCount === 0) {
      return { flow: 'legacy' }
    }

    const questions = await (fetchActiveQuestions as any)(toStageId)

    if (questions.length === 0) {
      // Mudança concorrente: config diz > 0 mas get-active retorna vazio
      return { flow: 'legacy' }
    }

    return { flow: 'modal', questions }
  } catch (error) {
    if (error instanceof StageTransitionFeatureDisabledError) {
      return { flow: 'legacy' }
    }
    return { flow: 'error', error: (error as Error).message }
  }
}

// =====================================================
// TESTS
// =====================================================

describe('FunnelBoard - Stage Transition Questions Integration (Etapa G)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Feature Flag Behavior', () => {
    it('should use legacy flow when feature flag is false', async () => {
      vi.mocked(isStageTransitionQuestionsFeatureEnabled).mockReturnValue(false)

      const result = await decideTransitionFlow('active', 'active', 'stage-1')

      expect(result.flow).toBe('legacy')
      expect(fetchStageConfig).not.toHaveBeenCalled()
      expect(fetchActiveQuestions).not.toHaveBeenCalled()
    })

    it('should check config when feature flag is true and active→active', async () => {
      vi.mocked(isStageTransitionQuestionsFeatureEnabled).mockReturnValue(true)
      vi.mocked(fetchStageConfig).mockResolvedValue({
        enabled: true,
        activeQuestionCount: 3
      })
      vi.mocked(fetchActiveQuestions).mockResolvedValue([
        { id: 'q1', label: 'Question 1', field_type: 'text', required: true },
        { id: 'q2', label: 'Question 2', field_type: 'select', required: false },
        { id: 'q3', label: 'Question 3', field_type: 'boolean', required: true }
      ])

      const result = await decideTransitionFlow('active', 'active', 'stage-1')

      expect(result.flow).toBe('modal')
      expect(result.questions).toHaveLength(3)
      expect(fetchStageConfig).toHaveBeenCalledWith('stage-1')
      expect(fetchActiveQuestions).toHaveBeenCalledWith('stage-1')
    })
  })

  describe('Stage Type Filtering', () => {
    it('should use legacy flow for won transition (not active→active)', async () => {
      vi.mocked(isStageTransitionQuestionsFeatureEnabled).mockReturnValue(true)

      const result = await decideTransitionFlow('active', 'won', 'stage-won')

      expect(result.flow).toBe('legacy')
      expect(fetchStageConfig).not.toHaveBeenCalled()
    })

    it('should use legacy flow for lost transition (not active→active)', async () => {
      vi.mocked(isStageTransitionQuestionsFeatureEnabled).mockReturnValue(true)

      const result = await decideTransitionFlow('active', 'lost', 'stage-lost')

      expect(result.flow).toBe('legacy')
      expect(fetchStageConfig).not.toHaveBeenCalled()
    })

    it('should use legacy flow for reopen transition (not active→active)', async () => {
      vi.mocked(isStageTransitionQuestionsFeatureEnabled).mockReturnValue(true)

      const result = await decideTransitionFlow('won', 'active', 'stage-1')

      expect(result.flow).toBe('legacy')
      expect(fetchStageConfig).not.toHaveBeenCalled()
    })
  })

  describe('Config-Based Decision', () => {
    beforeEach(() => {
      vi.mocked(isStageTransitionQuestionsFeatureEnabled).mockReturnValue(true)
    })

    it('should use legacy flow when enabled=false', async () => {
      vi.mocked(fetchStageConfig).mockResolvedValue({
        enabled: false,
        activeQuestionCount: 0
      })

      const result = await decideTransitionFlow('active', 'active', 'stage-1')

      expect(result.flow).toBe('legacy')
      expect(fetchActiveQuestions).not.toHaveBeenCalled()
    })

    it('should use legacy flow when enabled=true but activeQuestionCount=0', async () => {
      vi.mocked(fetchStageConfig).mockResolvedValue({
        enabled: true,
        activeQuestionCount: 0
      })

      const result = await decideTransitionFlow('active', 'active', 'stage-1')

      expect(result.flow).toBe('legacy')
      expect(fetchActiveQuestions).not.toHaveBeenCalled()
    })

    it('should load questions when enabled=true and activeQuestionCount>0', async () => {
      vi.mocked(fetchStageConfig).mockResolvedValue({
        enabled: true,
        activeQuestionCount: 2
      })
      vi.mocked(fetchActiveQuestions).mockResolvedValue([
        { id: 'q1', label: 'Q1', field_type: 'text', required: true },
        { id: 'q2', label: 'Q2', field_type: 'select', required: false }
      ])

      const result = await decideTransitionFlow('active', 'active', 'stage-1')

      expect(result.flow).toBe('modal')
      expect(result.questions).toHaveLength(2)
      expect(fetchActiveQuestions).toHaveBeenCalledWith('stage-1')
    })
  })

  describe('Concurrent Configuration Change', () => {
    beforeEach(() => {
      vi.mocked(isStageTransitionQuestionsFeatureEnabled).mockReturnValue(true)
    })

    it('should use legacy flow when config says count>0 but get-active returns empty', async () => {
      vi.mocked(fetchStageConfig).mockResolvedValue({
        enabled: true,
        activeQuestionCount: 5
      })
      vi.mocked(fetchActiveQuestions).mockResolvedValue([])

      const result = await decideTransitionFlow('active', 'active', 'stage-1')

      expect(result.flow).toBe('legacy')
      expect(fetchActiveQuestions).toHaveBeenCalledWith('stage-1')
    })
  })

  describe('Error Handling', () => {
    beforeEach(() => {
      vi.mocked(isStageTransitionQuestionsFeatureEnabled).mockReturnValue(true)
    })

    it('should use legacy flow when fetchStageConfig throws FEATURE_DISABLED', async () => {
      vi.mocked(fetchStageConfig).mockRejectedValue(new StageTransitionFeatureDisabledError())

      const result = await decideTransitionFlow('active', 'active', 'stage-1')

      expect(result.flow).toBe('legacy')
    })

    it('should return error flow when fetchStageConfig throws other error', async () => {
      vi.mocked(fetchStageConfig).mockRejectedValue(new Error('Network error'))

      const result = await decideTransitionFlow('active', 'active', 'stage-1')

      expect(result.flow).toBe('error')
      expect(result.error).toBe('Network error')
    })

    it('should return error flow when fetchActiveQuestions fails', async () => {
      vi.mocked(fetchStageConfig).mockResolvedValue({
        enabled: true,
        activeQuestionCount: 3
      })
      vi.mocked(fetchActiveQuestions).mockRejectedValue(new Error('Server error'))

      const result = await decideTransitionFlow('active', 'active', 'stage-1')

      expect(result.flow).toBe('error')
      expect(result.error).toBe('Server error')
    })
  })

  describe('No R1 Requests When Feature Disabled', () => {
    it('should make zero R1 requests when feature flag is false', async () => {
      vi.mocked(isStageTransitionQuestionsFeatureEnabled).mockReturnValue(false)

      await decideTransitionFlow('active', 'active', 'stage-1')

      expect(fetchStageConfig).not.toHaveBeenCalled()
      expect(fetchActiveQuestions).not.toHaveBeenCalled()
    })
  })
})
