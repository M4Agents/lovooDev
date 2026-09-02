// =====================================================
// TESTS: Stage Transition Questions Transport
// Data: 02/09/2026 - Etapa E
//
// Testes do HTTP adapter com mocks
// NÃO faz chamadas reais ao backend
// =====================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { supabase } from '../../lib/supabase'
import * as featureFlags from '../../hooks/dashboard/useFeatureFlags'
import {
  fetchAllQuestions,
  fetchActiveQuestions,
  createQuestion,
  updateQuestion,
  setQuestionActive,
  reorderQuestions,
  setStageEnabled,
} from '../stageTransitionQuestionsTransport'
import { StageTransitionServiceError } from '../stageTransitionQuestionsService'
import type { StageTransitionQuestion } from '../../types/stage-transition-questions'

// =====================================================
// MOCKS
// =====================================================

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch as any

// Mock Supabase auth
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn()
    }
  }
}))

// Mock feature flags
vi.mock('../../hooks/dashboard/useFeatureFlags', () => ({
  isStageTransitionQuestionsFeatureEnabled: vi.fn()
}))

// =====================================================
// HELPERS
// =====================================================

const mockQuestion: StageTransitionQuestion = {
  id: 'q-1',
  company_id: 'company-1',
  funnel_stage_id: 'stage-1',
  label: 'Cliente Qualificado?',
  field_type: 'boolean',
  required: true,
  options: null,
  sort_order: 0,
  active: true,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z'
}

function mockAuthSuccess(token = 'test-token') {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: {
      session: {
        access_token: token,
        user: {} as any
      } as any
    },
    error: null
  })
}

function mockAuthFailure() {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: null },
    error: null
  })
}

function mockFeatureEnabled(enabled: boolean) {
  vi.mocked(featureFlags.isStageTransitionQuestionsFeatureEnabled).mockReturnValue(enabled)
}

function mockFetchSuccess<T>(data: T, status = 200) {
  mockFetch.mockResolvedValue({
    status,
    text: async () => JSON.stringify({ ok: true, data }),
    ok: status >= 200 && status < 300
  })
}

function mockFetchError(status: number, error: string) {
  mockFetch.mockResolvedValue({
    status,
    text: async () => JSON.stringify({ ok: false, error }),
    ok: false
  })
}

// =====================================================
// TESTS
// =====================================================

describe('Stage Transition Questions Transport', () => {
  
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
    mockFeatureEnabled(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===================================================
  // FEATURE GUARD
  // ===================================================

  describe('Feature Guard', () => {
    it('bloqueia quando feature=false', async () => {
      mockFeatureEnabled(false)

      await expect(fetchActiveQuestions('stage-1')).rejects.toThrow(StageTransitionServiceError)
      await expect(fetchActiveQuestions('stage-1')).rejects.toThrow('não está habilitada')

      // Fetch não deve ser chamado
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('permite quando feature=true', async () => {
      mockFeatureEnabled(true)
      mockFetchSuccess({ questions: [] })

      await fetchActiveQuestions('stage-1')

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  // ===================================================
  // AUTH
  // ===================================================

  describe('Autenticação', () => {
    it('lança erro quando sessão expirada', async () => {
      mockAuthFailure()

      await expect(fetchActiveQuestions('stage-1')).rejects.toThrow(StageTransitionServiceError)
      await expect(fetchActiveQuestions('stage-1')).rejects.toThrow('Sessão expirada')
    })

    it('usa Bearer token no header', async () => {
      mockAuthSuccess('my-token')
      mockFetchSuccess({ questions: [] })

      await fetchActiveQuestions('stage-1')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-token'
          })
        })
      )
    })
  })

  // ===================================================
  // FETCH ACTIVE QUESTIONS
  // ===================================================

  describe('fetchActiveQuestions', () => {
    it('chama endpoint correto', async () => {
      mockFetchSuccess({ questions: [mockQuestion] })

      await fetchActiveQuestions('stage-abc')

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/stage-transition-questions/get-active?funnel_stage_id=stage-abc',
        expect.any(Object)
      )
    })

    it('retorna perguntas ativas', async () => {
      mockFetchSuccess({ questions: [mockQuestion] })

      const result = await fetchActiveQuestions('stage-1')

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('q-1')
    })
  })

  // ===================================================
  // FETCH ALL QUESTIONS
  // ===================================================

  describe('fetchAllQuestions', () => {
    it('chama list sem include_inactive por padrão', async () => {
      mockFetchSuccess({ questions: [] })

      await fetchAllQuestions('stage-1')

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/stage-transition-questions/list?funnel_stage_id=stage-1',
        expect.any(Object)
      )
    })

    it('adiciona include_inactive=true quando solicitado', async () => {
      mockFetchSuccess({ questions: [] })

      await fetchAllQuestions('stage-1', true)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/stage-transition-questions/list?funnel_stage_id=stage-1&include_inactive=true',
        expect.any(Object)
      )
    })
  })

  // ===================================================
  // CREATE QUESTION
  // ===================================================

  describe('createQuestion', () => {
    it('envia payload correto', async () => {
      mockFetchSuccess({ question: mockQuestion })

      const input = {
        funnel_stage_id: 'stage-1',
        label: 'Nova Pergunta',
        field_type: 'text' as const,
        required: true,
        options: null,
        sort_order: 5
      }

      await createQuestion(input)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/stage-transition-questions/create',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(input)
        })
      )
    })

    it('retorna pergunta criada', async () => {
      mockFetchSuccess({ question: mockQuestion })

      const result = await createQuestion({
        funnel_stage_id: 'stage-1',
        label: 'Test',
        field_type: 'text',
        required: true,
        options: null
      })

      expect(result.id).toBe('q-1')
    })
  })

  // ===================================================
  // UPDATE QUESTION
  // ===================================================

  describe('updateQuestion', () => {
    it('envia apenas campos editáveis', async () => {
      mockFetchSuccess({ question: mockQuestion })

      const input = {
        question_id: 'q-1',
        label: 'Label Atualizada',
        required: false
      }

      await updateQuestion(input)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/stage-transition-questions/update',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(input)
        })
      )
    })
  })

  // ===================================================
  // SET ACTIVE
  // ===================================================

  describe('setQuestionActive', () => {
    it('ativa pergunta', async () => {
      mockFetchSuccess({ question: { ...mockQuestion, active: true } })

      await setQuestionActive('q-1', true)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/stage-transition-questions/set-active',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            question_id: 'q-1',
            active: true
          })
        })
      )
    })

    it('desativa pergunta', async () => {
      mockFetchSuccess({ question: { ...mockQuestion, active: false } })

      await setQuestionActive('q-1', false)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/stage-transition-questions/set-active',
        expect.objectContaining({
          body: JSON.stringify({
            question_id: 'q-1',
            active: false
          })
        })
      )
    })
  })

  // ===================================================
  // REORDER
  // ===================================================

  describe('reorderQuestions', () => {
    it('envia ordem correta', async () => {
      mockFetchSuccess({ updated_count: 3 })

      const order = [
        { id: 'q-3', sort_order: 0 },
        { id: 'q-1', sort_order: 1 },
        { id: 'q-2', sort_order: 2 }
      ]

      await reorderQuestions('stage-1', order)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/stage-transition-questions/reorder',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            funnel_stage_id: 'stage-1',
            question_order: order
          })
        })
      )
    })

    it('retorna updated_count', async () => {
      mockFetchSuccess({ updated_count: 5 })

      const result = await reorderQuestions('stage-1', [])

      expect(result).toBe(5)
    })
  })

  // ===================================================
  // SET STAGE ENABLED
  // ===================================================

  describe('setStageEnabled', () => {
    it('habilita stage', async () => {
      mockFetchSuccess({
        stage: { id: 'stage-1', enable_transition_questions: true }
      })

      await setStageEnabled('stage-1', true)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/stage-transition-questions/set-stage-enabled',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            funnel_stage_id: 'stage-1',
            enabled: true
          })
        })
      )
    })

    it('retorna stage atualizada', async () => {
      mockFetchSuccess({
        stage: { id: 'stage-1', enable_transition_questions: false }
      })

      const result = await setStageEnabled('stage-1', false)

      expect(result.enable_transition_questions).toBe(false)
    })
  })

  // ===================================================
  // ERROR HANDLING
  // ===================================================

  describe('Error Handling', () => {
    it('401 → AUTH_ERROR', async () => {
      mockFetchError(401, 'Não autenticado')

      await expect(fetchActiveQuestions('stage-1')).rejects.toThrow(StageTransitionServiceError)

      try {
        await fetchActiveQuestions('stage-1')
      } catch (error) {
        expect((error as StageTransitionServiceError).code).toBe('AUTH_ERROR')
      }
    })

    it('403 → PERMISSION_DENIED', async () => {
      mockFetchError(403, 'Acesso negado')

      try {
        await fetchActiveQuestions('stage-1')
      } catch (error) {
        expect((error as StageTransitionServiceError).code).toBe('PERMISSION_DENIED')
      }
    })

    it('404 → QUESTION_NOT_FOUND', async () => {
      mockFetchError(404, 'Pergunta não encontrada')

      try {
        await fetchActiveQuestions('stage-1')
      } catch (error) {
        expect((error as StageTransitionServiceError).code).toBe('QUESTION_NOT_FOUND')
      }
    })

    it('409 com "limite" → MAX_ACTIVE_QUESTIONS', async () => {
      mockFetchError(409, 'Limite de 15 perguntas ativas atingido')

      try {
        await createQuestion({
          funnel_stage_id: 'stage-1',
          label: 'Test',
          field_type: 'text',
          required: true,
          options: null
        })
      } catch (error) {
        expect((error as StageTransitionServiceError).code).toBe('MAX_ACTIVE_QUESTIONS')
      }
    })

    it('409 com "field_type" → QUESTION_STRUCTURE_IMMUTABLE', async () => {
      mockFetchError(409, 'field_type não pode ser alterado')

      try {
        await updateQuestion({ question_id: 'q-1', label: 'Test' })
      } catch (error) {
        expect((error as StageTransitionServiceError).code).toBe('QUESTION_STRUCTURE_IMMUTABLE')
      }
    })

    it('503 → FEATURE_DISABLED', async () => {
      mockFetchError(503, 'Funcionalidade não disponível')

      try {
        await fetchActiveQuestions('stage-1')
      } catch (error) {
        expect((error as StageTransitionServiceError).code).toBe('FEATURE_DISABLED')
      }
    })

    it('500 → SERVER_ERROR', async () => {
      mockFetchError(500, 'Erro interno')

      try {
        await fetchActiveQuestions('stage-1')
      } catch (error) {
        expect((error as StageTransitionServiceError).code).toBe('SERVER_ERROR')
      }
    })

    it('resposta JSON inválida → INVALID_RESPONSE', async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        text: async () => 'not json'
      })

      await expect(fetchActiveQuestions('stage-1')).rejects.toThrow('resposta inválida')
    })

    it('network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      await expect(fetchActiveQuestions('stage-1')).rejects.toThrow('Network error')
    })
  })
})
