// =====================================================
// TESTS: Stage Transition Questions Service
// Data: 02/09/2026 - Etapa B
// =====================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildTransitionAnswersPayload,
  prepareMoveOpportunityV2Params,
  StageTransitionServiceError,
  StageTransitionFeatureDisabledError,
  type StageTransitionDraftAnswer
} from '../stageTransitionQuestionsService'
import type { StageTransitionQuestion } from '../../types/stage-transition-questions'
import * as featureFlags from '../../hooks/dashboard/useFeatureFlags'

// =====================================================
// MOCKS
// =====================================================

const mockQuestions: StageTransitionQuestion[] = [
  {
    id: 'q-text-required',
    company_id: 'company-1',
    funnel_stage_id: 'stage-1',
    label: 'Observações',
    field_type: 'text',
    required: true,
    options: null,
    sort_order: 0,
    active: true,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    id: 'q-text-optional',
    company_id: 'company-1',
    funnel_stage_id: 'stage-1',
    label: 'Observações Extras',
    field_type: 'text',
    required: false,
    options: null,
    sort_order: 1,
    active: true,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    id: 'q-number',
    company_id: 'company-1',
    funnel_stage_id: 'stage-1',
    label: 'Valor Estimado',
    field_type: 'number',
    required: true,
    options: null,
    sort_order: 2,
    active: true,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    id: 'q-boolean',
    company_id: 'company-1',
    funnel_stage_id: 'stage-1',
    label: 'Cliente Qualificado?',
    field_type: 'boolean',
    required: true,
    options: null,
    sort_order: 3,
    active: true,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    id: 'q-select',
    company_id: 'company-1',
    funnel_stage_id: 'stage-1',
    label: 'Tipo de Conexão',
    field_type: 'select',
    required: true,
    options: ['WhatsApp', 'Telefone', 'E-mail'],
    sort_order: 4,
    active: true,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    id: 'q-multi-select',
    company_id: 'company-1',
    funnel_stage_id: 'stage-1',
    label: 'Produtos de Interesse',
    field_type: 'multi_select',
    required: true,
    options: ['Produto A', 'Produto B', 'Produto C', 'Produto D'],
    sort_order: 5,
    active: true,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    id: 'q-multi-select-optional',
    company_id: 'company-1',
    funnel_stage_id: 'stage-1',
    label: 'Serviços Extras',
    field_type: 'multi_select',
    required: false,
    options: ['Serviço 1', 'Serviço 2'],
    sort_order: 6,
    active: true,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  }
]

// =====================================================
// TESTS
// =====================================================

describe('Stage Transition Questions Service', () => {
  
  beforeEach(() => {
    // Mock feature enabled
    vi.spyOn(featureFlags, 'isStageTransitionQuestionsFeatureEnabled').mockReturnValue(true)
  })
  
  afterEach(() => {
    vi.restoreAllMocks()
  })
  
  // ===================================================
  // FEATURE FLAG
  // ===================================================
  
  describe('Feature Flag', () => {
    it('rejeita operação quando feature desabilitada', () => {
      vi.spyOn(featureFlags, 'isStageTransitionQuestionsFeatureEnabled').mockReturnValue(false)
      
      const draft: StageTransitionDraftAnswer[] = []
      
      expect(() => {
        buildTransitionAnswersPayload(draft, mockQuestions)
      }).toThrow(StageTransitionFeatureDisabledError)
    })
    
    it('permite operação quando feature habilitada', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      const result = buildTransitionAnswersPayload(draft, mockQuestions)
      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThan(0)
    })
  })
  
  // ===================================================
  // TEXT
  // ===================================================
  
  describe('Text Field', () => {
    it('aceita text required válido', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'Observação importante' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      const result = buildTransitionAnswersPayload(draft, mockQuestions)
      const textAnswer = result.find(a => a.question_id === 'q-text-required')
      
      expect(textAnswer).toBeDefined()
      expect(textAnswer?.value).toBe('Observação importante')
    })
    
    it('rejeita text required vazio', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: '' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      expect(() => {
        buildTransitionAnswersPayload(draft, mockQuestions)
      }).toThrow(StageTransitionServiceError)
    })
    
    it('omite text optional vazio', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'valor' },
        { questionId: 'q-text-optional', value: '' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      const result = buildTransitionAnswersPayload(draft, mockQuestions)
      const optionalAnswer = result.find(a => a.question_id === 'q-text-optional')
      
      expect(optionalAnswer).toBeUndefined()
    })
    
    it('aplica trim em text', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: '  valor com espaços  ' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      const result = buildTransitionAnswersPayload(draft, mockQuestions)
      const textAnswer = result.find(a => a.question_id === 'q-text-required')
      
      expect(textAnswer?.value).toBe('valor com espaços')
    })
  })
  
  // ===================================================
  // NUMBER
  // ===================================================
  
  describe('Number Field', () => {
    it('aceita number válido', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '1500.50' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      const result = buildTransitionAnswersPayload(draft, mockQuestions)
      const numberAnswer = result.find(a => a.question_id === 'q-number')
      
      expect(numberAnswer?.value).toBe('1500.50')
    })
    
    it('aceita number negativo', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '-10' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      const result = buildTransitionAnswersPayload(draft, mockQuestions)
      const numberAnswer = result.find(a => a.question_id === 'q-number')
      
      expect(numberAnswer?.value).toBe('-10')
    })
    
    it('rejeita number inválido', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: 'abc' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      expect(() => {
        buildTransitionAnswersPayload(draft, mockQuestions)
      }).toThrow(StageTransitionServiceError)
    })
  })
  
  // ===================================================
  // BOOLEAN
  // ===================================================
  
  describe('Boolean Field', () => {
    it('converte boolean true para "true"', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      const result = buildTransitionAnswersPayload(draft, mockQuestions)
      const boolAnswer = result.find(a => a.question_id === 'q-boolean')
      
      expect(boolAnswer?.value).toBe('true')
    })
    
    it('converte boolean false para "false"', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: false },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      const result = buildTransitionAnswersPayload(draft, mockQuestions)
      const boolAnswer = result.find(a => a.question_id === 'q-boolean')
      
      expect(boolAnswer?.value).toBe('false')
    })
    
    it('aceita string "true"', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: 'true' },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      const result = buildTransitionAnswersPayload(draft, mockQuestions)
      const boolAnswer = result.find(a => a.question_id === 'q-boolean')
      
      expect(boolAnswer?.value).toBe('true')
    })
  })
  
  // ===================================================
  // SELECT
  // ===================================================
  
  describe('Select Field', () => {
    it('aceita select válido', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      const result = buildTransitionAnswersPayload(draft, mockQuestions)
      const selectAnswer = result.find(a => a.question_id === 'q-select')
      
      expect(selectAnswer?.value).toBe('WhatsApp')
    })
    
    it('rejeita select inválido', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'Opção Inexistente' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      expect(() => {
        buildTransitionAnswersPayload(draft, mockQuestions)
      }).toThrow(StageTransitionServiceError)
    })
    
    it('select é case-sensitive', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'whatsapp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      expect(() => {
        buildTransitionAnswersPayload(draft, mockQuestions)
      }).toThrow(StageTransitionServiceError)
    })
  })
  
  // ===================================================
  // MULTI_SELECT
  // ===================================================
  
  describe('Multi Select Field', () => {
    it('canonicaliza ordem conforme options', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto D', 'Produto B', 'Produto A'] }
      ]
      
      const result = buildTransitionAnswersPayload(draft, mockQuestions)
      const multiAnswer = result.find(a => a.question_id === 'q-multi-select')
      
      // Ordem canônica: A, B, D (conforme options)
      expect(multiAnswer?.value).toBe('["Produto A","Produto B","Produto D"]')
    })
    
    it('rejeita duplicata em multi_select', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A', 'Produto A'] }
      ]
      
      expect(() => {
        buildTransitionAnswersPayload(draft, mockQuestions)
      }).toThrow(StageTransitionServiceError)
    })
    
    it('rejeita opção inexistente em multi_select', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto X'] }
      ]
      
      expect(() => {
        buildTransitionAnswersPayload(draft, mockQuestions)
      }).toThrow(StageTransitionServiceError)
    })
    
    it('omite multi_select optional vazio', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] },
        { questionId: 'q-multi-select-optional', value: [] }
      ]
      
      const result = buildTransitionAnswersPayload(draft, mockQuestions)
      const optionalAnswer = result.find(a => a.question_id === 'q-multi-select-optional')
      
      expect(optionalAnswer).toBeUndefined()
    })
    
    it('rejeita multi_select required vazio', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: [] }
      ]
      
      expect(() => {
        buildTransitionAnswersPayload(draft, mockQuestions)
      }).toThrow(StageTransitionServiceError)
    })
  })
  
  // ===================================================
  // REQUIRED
  // ===================================================
  
  describe('Required Validation', () => {
    it('rejeita uma required ausente entre várias perguntas', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        // q-number ausente (required)
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      expect(() => {
        buildTransitionAnswersPayload(draft, mockQuestions)
      }).toThrow(StageTransitionServiceError)
    })
    
    it('permite optional ausente', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
        // q-text-optional e q-multi-select-optional ausentes (ok)
      ]
      
      const result = buildTransitionAnswersPayload(draft, mockQuestions)
      expect(result).toBeDefined()
    })
  })
  
  // ===================================================
  // UNKNOWN QUESTION
  // ===================================================
  
  describe('Unknown Question', () => {
    it('rejeita answer para question_id desconhecido', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-unknown', value: 'teste' },
        { questionId: 'q-text-required', value: 'teste' },
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      expect(() => {
        buildTransitionAnswersPayload(draft, mockQuestions)
      }).toThrow(StageTransitionServiceError)
    })
  })
  
  // ===================================================
  // DUPLICATE ANSWER
  // ===================================================
  
  describe('Duplicate Answer', () => {
    it('rejeita duas respostas para mesmo question_id', () => {
      const draft: StageTransitionDraftAnswer[] = [
        { questionId: 'q-text-required', value: 'teste 1' },
        { questionId: 'q-text-required', value: 'teste 2' }, // duplicata
        { questionId: 'q-number', value: '1000' },
        { questionId: 'q-boolean', value: true },
        { questionId: 'q-select', value: 'WhatsApp' },
        { questionId: 'q-multi-select', value: ['Produto A'] }
      ]
      
      expect(() => {
        buildTransitionAnswersPayload(draft, mockQuestions)
      }).toThrow(StageTransitionServiceError)
    })
  })
  
  // ===================================================
  // MOVE OPPORTUNITY V2 PARAMS
  // ===================================================
  
  describe('prepareMoveOpportunityV2Params', () => {
    it('prepara params corretamente', () => {
      vi.spyOn(featureFlags, 'isStageTransitionQuestionsFeatureEnabled').mockReturnValue(true)
      
      const answers = [
        { question_id: 'q-1', value: 'resposta' }
      ]
      
      const params = prepareMoveOpportunityV2Params(
        'opp-123',
        'funnel-456',
        'stage-from',
        'stage-to',
        5,
        answers
      )
      
      expect(params).toEqual({
        p_opportunity_id: 'opp-123',
        p_funnel_id: 'funnel-456',
        p_from_stage_id: 'stage-from',
        p_to_stage_id: 'stage-to',
        p_position_in_stage: 5,
        p_transition_answers: answers
      })
    })
    
    it('rejeita quando feature desabilitada', () => {
      vi.spyOn(featureFlags, 'isStageTransitionQuestionsFeatureEnabled').mockReturnValue(false)
      
      expect(() => {
        prepareMoveOpportunityV2Params(
          'opp-123',
          'funnel-456',
          'stage-from',
          'stage-to',
          5,
          null
        )
      }).toThrow(StageTransitionFeatureDisabledError)
    })
  })
})
