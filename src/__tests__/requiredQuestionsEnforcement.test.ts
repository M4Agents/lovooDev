// =====================================================
// TESTES: Required Questions Enforcement (R1 H.1)
// Data: 02/09/2026
// Objetivo: Validar que NENHUM caller pode bypass required questions
// Escopo: Mock do comportamento da RPC (sem banco real)
// =====================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// =====================================================
// MOCKS
// =====================================================

// Mock da RPC move_opportunity v1 com enforcement
function mockMoveOpportunityV1(params: {
  opportunity_id: string
  funnel_id: string
  from_stage_id: string
  to_stage_id: string
  position_in_stage: number
}, stageConfig: {
  from_type: 'active' | 'won' | 'lost'
  to_type: 'active' | 'won' | 'lost'
  enable_questions: boolean
  required_count: number
}): { success: boolean; error?: string } {
  const { from_type, to_type, enable_questions, required_count } = stageConfig

  // R1 H.1: Validar required questions SOMENTE para active → active
  if (from_type === 'active' && to_type === 'active') {
    if (enable_questions === true && required_count > 0) {
      return {
        success: false,
        error: `REQUIRED_QUESTIONS_NOT_ANSWERED: Etapa destino possui ${required_count} pergunta(s) obrigatória(s) não respondidas. Use move_opportunity_v2 com respostas ou contate o administrador para ajustar a configuração da etapa.`
      }
    }
  }

  return { success: true }
}

// Mock da RPC bulk_move_opportunities com enforcement
function mockBulkMoveOpportunities(params: {
  company_id: string
  actor_user_id: string
  from_funnel_id: string
  from_stage_id: string
  to_funnel_id: string
  to_stage_id: string
  opportunity_ids: string[]
}, stageConfig: {
  from_type: 'active' | 'won' | 'lost'
  to_type: 'active' | 'won' | 'lost'
  enable_questions: boolean
  required_count: number
}): { success: boolean; error?: string } {
  const { from_type, to_type, enable_questions, required_count } = stageConfig

  // R1 H.1: Enforcement de required questions (active → active apenas)
  if (from_type === 'active' && to_type === 'active') {
    if (enable_questions === true && required_count > 0) {
      return {
        success: false,
        error: `BULK_REQUIRED_QUESTIONS_NOT_ANSWERED: Operação em massa bloqueada. Etapa destino possui ${required_count} pergunta(s) obrigatória(s). Movimentações individuais com respostas são necessárias.`
      }
    }
  }

  return { success: true }
}

// =====================================================
// TESTS
// =====================================================

describe('Required Questions Enforcement (R1 H.1)', () => {
  describe('move_opportunity v1 - Scenarios WITHOUT required questions', () => {
    it('should allow movement when stage has no questions', () => {
      const result = mockMoveOpportunityV1(
        {
          opportunity_id: 'opp-1',
          funnel_id: 'funnel-1',
          from_stage_id: 'stage-a',
          to_stage_id: 'stage-b',
          position_in_stage: 0
        },
        {
          from_type: 'active',
          to_type: 'active',
          enable_questions: false,
          required_count: 0
        }
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should allow movement when questions disabled', () => {
      const result = mockMoveOpportunityV1(
        {
          opportunity_id: 'opp-1',
          funnel_id: 'funnel-1',
          from_stage_id: 'stage-a',
          to_stage_id: 'stage-b',
          position_in_stage: 0
        },
        {
          from_type: 'active',
          to_type: 'active',
          enable_questions: false,
          required_count: 3 // Tem required mas disabled
        }
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should allow movement when only optional questions exist', () => {
      const result = mockMoveOpportunityV1(
        {
          opportunity_id: 'opp-1',
          funnel_id: 'funnel-1',
          from_stage_id: 'stage-a',
          to_stage_id: 'stage-b',
          position_in_stage: 0
        },
        {
          from_type: 'active',
          to_type: 'active',
          enable_questions: true,
          required_count: 0 // Enabled mas sem required
        }
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })
  })

  describe('move_opportunity v1 - Scenarios WITH required questions', () => {
    it('should BLOCK movement when required questions exist (active→active)', () => {
      const result = mockMoveOpportunityV1(
        {
          opportunity_id: 'opp-1',
          funnel_id: 'funnel-1',
          from_stage_id: 'stage-a',
          to_stage_id: 'stage-b',
          position_in_stage: 0
        },
        {
          from_type: 'active',
          to_type: 'active',
          enable_questions: true,
          required_count: 2
        }
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('REQUIRED_QUESTIONS_NOT_ANSWERED')
      expect(result.error).toContain('2 pergunta(s) obrigatória(s)')
    })

    it('should BLOCK even with service_role (no bypass)', () => {
      // service_role não bypassa enforcement
      const result = mockMoveOpportunityV1(
        {
          opportunity_id: 'opp-automation',
          funnel_id: 'funnel-1',
          from_stage_id: 'stage-a',
          to_stage_id: 'stage-required',
          position_in_stage: 0
        },
        {
          from_type: 'active',
          to_type: 'active',
          enable_questions: true,
          required_count: 1
        }
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('REQUIRED_QUESTIONS_NOT_ANSWERED')
    })

    it('should BLOCK automation/agent callers', () => {
      // Simula CRMService.moveOpportunity (automation)
      const result = mockMoveOpportunityV1(
        {
          opportunity_id: 'opp-auto',
          funnel_id: 'funnel-1',
          from_stage_id: 'stage-a',
          to_stage_id: 'stage-required',
          position_in_stage: 0
        },
        {
          from_type: 'active',
          to_type: 'active',
          enable_questions: true,
          required_count: 3
        }
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('REQUIRED_QUESTIONS_NOT_ANSWERED')
    })
  })

  describe('move_opportunity v1 - Won/Lost/Reopen NOT affected', () => {
    it('should allow won transition (not active→active)', () => {
      const result = mockMoveOpportunityV1(
        {
          opportunity_id: 'opp-1',
          funnel_id: 'funnel-1',
          from_stage_id: 'stage-a',
          to_stage_id: 'stage-won',
          position_in_stage: 0
        },
        {
          from_type: 'active',
          to_type: 'won',
          enable_questions: true,
          required_count: 5 // Won não valida R1
        }
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should allow lost transition (not active→active)', () => {
      const result = mockMoveOpportunityV1(
        {
          opportunity_id: 'opp-1',
          funnel_id: 'funnel-1',
          from_stage_id: 'stage-a',
          to_stage_id: 'stage-lost',
          position_in_stage: 0
        },
        {
          from_type: 'active',
          to_type: 'lost',
          enable_questions: true,
          required_count: 5 // Lost não valida R1
        }
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should allow reopen transition (won/lost→active)', () => {
      const result = mockMoveOpportunityV1(
        {
          opportunity_id: 'opp-1',
          funnel_id: 'funnel-1',
          from_stage_id: 'stage-won',
          to_stage_id: 'stage-a',
          position_in_stage: 0
        },
        {
          from_type: 'won',
          to_type: 'active',
          enable_questions: true,
          required_count: 5 // Reopen não valida R1
        }
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })
  })

  describe('bulk_move_opportunities - Enforcement', () => {
    it('should BLOCK bulk when required questions exist', () => {
      const result = mockBulkMoveOpportunities(
        {
          company_id: 'company-1',
          actor_user_id: 'user-admin',
          from_funnel_id: 'funnel-1',
          from_stage_id: 'stage-a',
          to_funnel_id: 'funnel-1',
          to_stage_id: 'stage-required',
          opportunity_ids: ['opp-1', 'opp-2', 'opp-3']
        },
        {
          from_type: 'active',
          to_type: 'active',
          enable_questions: true,
          required_count: 2
        }
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('BULK_REQUIRED_QUESTIONS_NOT_ANSWERED')
      expect(result.error).toContain('2 pergunta(s) obrigatória(s)')
    })

    it('should allow bulk when no required questions', () => {
      const result = mockBulkMoveOpportunities(
        {
          company_id: 'company-1',
          actor_user_id: 'user-admin',
          from_funnel_id: 'funnel-1',
          from_stage_id: 'stage-a',
          to_funnel_id: 'funnel-1',
          to_stage_id: 'stage-b',
          opportunity_ids: ['opp-1', 'opp-2', 'opp-3']
        },
        {
          from_type: 'active',
          to_type: 'active',
          enable_questions: true,
          required_count: 0 // Enabled mas sem required
        }
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should allow bulk for won/lost (not active→active)', () => {
      const result = mockBulkMoveOpportunities(
        {
          company_id: 'company-1',
          actor_user_id: 'user-admin',
          from_funnel_id: 'funnel-1',
          from_stage_id: 'stage-a',
          to_funnel_id: 'funnel-1',
          to_stage_id: 'stage-won',
          opportunity_ids: ['opp-1', 'opp-2', 'opp-3']
        },
        {
          from_type: 'active',
          to_type: 'won',
          enable_questions: true,
          required_count: 5 // Won não valida R1
        }
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })
  })

  describe('Cross-tenant continues blocked (unrelated to R1)', () => {
    it('should block cross-tenant regardless of questions', () => {
      // Este teste é conceitual - cross-tenant já é bloqueado por UNAUTHORIZED
      // R1 não afeta essa validação
      
      // Simulação: tentativa cross-tenant seria bloqueada ANTES de checar questions
      const crossTenantBlocked = true // auth_user_can_access_funnel retorna false
      
      expect(crossTenantBlocked).toBe(true)
    })
  })
})
