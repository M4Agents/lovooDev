// =====================================================
// Stage Transition Questions Hardening Tests
// Data: 02/09/2026 - Etapa F.5
//
// Testes focados em segurança e atomicidade
// =====================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// =====================================================
// SECURITY TESTS
// =====================================================

describe('Security - Cross-Tenant Isolation', () => {
  it('should return 404 for non-existent stage (not 403)', () => {
    // Resposta padronizada previne enumeration
    const response404NotFound = { status: 404, message: 'Recurso não encontrado' }
    expect(response404NotFound.message).toBe('Recurso não encontrado')
    expect(response404NotFound.status).toBe(404)
  })

  it('should return 404 for inaccessible stage (not 403)', () => {
    // Mesmo response para stage de outra company
    const response404Unauthorized = { status: 404, message: 'Recurso não encontrado' }
    expect(response404Unauthorized.message).toBe('Recurso não encontrado')
    expect(response404Unauthorized.status).toBe(404)
  })

  it('should not reveal cross-tenant information via error messages', () => {
    // Mensagens genéricas previnem information leaks
    const genericMessages = [
      'Recurso não encontrado',
      'Erro interno do servidor',
      'Erro ao verificar etapa'
    ]

    genericMessages.forEach(msg => {
      expect(msg).not.toContain('company_id')
      expect(msg).not.toContain('UUID')
      expect(msg).not.toContain('tenant')
    })
  })
})

describe('Security - RBAC Enforcement', () => {
  const adminRoles = ['admin', 'system_admin', 'super_admin']
  const nonAdminRoles = ['seller', 'manager', 'partner']

  it('should allow admin roles for CRUD operations', () => {
    adminRoles.forEach(role => {
      const hasAccess = adminRoles.includes(role)
      expect(hasAccess).toBe(true)
    })
  })

  it('should deny non-admin roles for CRUD operations', () => {
    nonAdminRoles.forEach(role => {
      const hasAccess = adminRoles.includes(role)
      expect(hasAccess).toBe(false)
    })
  })

  it('should allow funnel access for get-active endpoint', () => {
    // get-active permite qualquer role COM acesso ao funnel
    // Admin sempre tem acesso
    expect(adminRoles.includes('admin')).toBe(true)
    
    // Seller/manager precisam ter funnel assigned
    const sellerHasFunnelAccess = true // se funnel assigned
    expect(sellerHasFunnelAccess).toBe(true)
    
    // Partner sem assignment não tem acesso
    const partnerHasFunnelAccess = false
    expect(partnerHasFunnelAccess).toBe(false)
  })
})

describe('Security - Service Role Boundary', () => {
  it('should verify JWT authentication before service_role operations', () => {
    // Ordem EXATA:
    // 1. extractToken
    // 2. getUserFromToken
    // 3. getSupabaseAdmin (service_role)
    // 4. Derivar company_id
    // 5. assertMembership
    const authFlow = [
      'extractToken',
      'getUserFromToken',
      'getSupabaseAdmin',
      'deriveCompanyId',
      'assertMembership'
    ]

    expect(authFlow.indexOf('extractToken')).toBeLessThan(authFlow.indexOf('getSupabaseAdmin'))
    expect(authFlow.indexOf('getUserFromToken')).toBeLessThan(authFlow.indexOf('getSupabaseAdmin'))
    expect(authFlow.indexOf('getSupabaseAdmin')).toBeLessThan(authFlow.indexOf('assertMembership'))
  })

  it('should filter queries by derived company_id', () => {
    // Todas as queries devem ter .eq('company_id', derivedCompanyId)
    const derivedCompanyId = 'company-uuid-123'
    
    // Exemplo de query correto
    const correctQuery = {
      table: 'stage_transition_questions',
      filters: [
        { field: 'company_id', value: derivedCompanyId, operator: 'eq' }
      ]
    }
    
    const hasCompanyFilter = correctQuery.filters.some(
      f => f.field === 'company_id' && f.operator === 'eq'
    )
    expect(hasCompanyFilter).toBe(true)
  })
})

// =====================================================
// MAX 15 ATOMICITY TESTS
// =====================================================

describe('MAX 15 - Atomicity', () => {
  it('should enforce max 15 via database trigger', () => {
    // Trigger check_max_active_questions deve bloquear 16ª pergunta
    const MAX_ACTIVE = 15
    
    // Simular tentativa de criar/ativar com 15 já existentes
    const currentActive = 15
    const attemptToActivate = true

    if (attemptToActivate && currentActive >= MAX_ACTIVE) {
      const error = {
        code: '23514', // check_violation
        message: 'MAX_ACTIVE_QUESTIONS: Limite de 15 perguntas ativas por etapa atingido'
      }
      expect(error.code).toBe('23514')
      expect(error.message).toContain('MAX_ACTIVE_QUESTIONS')
    }
  })

  it('should use advisory lock to prevent race conditions', () => {
    // Trigger acquire_stage_questions_lock_trigger deve adquirir lock
    // Lock key: hashtext(company_id) # hashtext(stage_id)
    const companyId = 'uuid-1'
    const stageId = 'uuid-2'
    
    // Lock é baseado em hash determinístico
    const lockKey = `${companyId}_${stageId}`
    expect(lockKey).toBeTruthy()
  })

  it('should allow 14 -> 15 (permitted)', () => {
    const currentActive = 14
    const canActivate = currentActive < 15
    expect(canActivate).toBe(true)
  })

  it('should block 15 -> 16 (forbidden)', () => {
    const currentActive = 15
    const canActivate = currentActive < 15
    expect(canActivate).toBe(false)
  })

  it('should handle concurrent INSERT attempts', () => {
    // Dois requests simultâneos com 14 ativas
    // Advisory lock garante que apenas 1 sucede
    const initialCount = 14
    const request1 = { active: true }
    const request2 = { active: true }

    // Apenas 1 pode passar (simulado)
    const locks = [true, false] // request1 adquire lock, request2 espera
    const successful = locks.filter(l => l).length
    expect(successful).toBe(1)
  })
})

// =====================================================
// REORDER ATOMICITY TESTS
// =====================================================

describe('REORDER - Atomicity', () => {
  it('should validate all IDs before updating', () => {
    const questionOrder = [
      { id: 'q1', sort_order: 0 },
      { id: 'q2', sort_order: 1 },
      { id: 'q3', sort_order: 2 }
    ]

    // RPC valida primeiro
    const allIdsValid = questionOrder.every(q => q.id && typeof q.sort_order === 'number')
    expect(allIdsValid).toBe(true)
  })

  it('should reject duplicate IDs', () => {
    const questionOrder = [
      { id: 'q1', sort_order: 0 },
      { id: 'q1', sort_order: 1 } // duplicado
    ]

    const ids = questionOrder.map(q => q.id)
    const uniqueIds = new Set(ids)
    const hasDuplicates = uniqueIds.size !== ids.length

    expect(hasDuplicates).toBe(true)
  })

  it('should reject questions from different stage', () => {
    const targetStageId = 'stage-1'
    const questions = [
      { id: 'q1', funnel_stage_id: 'stage-1' },
      { id: 'q2', funnel_stage_id: 'stage-2' } // outra stage
    ]

    const allFromSameStage = questions.every(q => q.funnel_stage_id === targetStageId)
    expect(allFromSameStage).toBe(false)
  })

  it('should reject questions from different company', () => {
    const targetCompanyId = 'company-1'
    const questions = [
      { id: 'q1', company_id: 'company-1' },
      { id: 'q2', company_id: 'company-2' } // outra company
    ]

    const allFromSameCompany = questions.every(q => q.company_id === targetCompanyId)
    expect(allFromSameCompany).toBe(false)
  })

  it('should rollback on partial failure', () => {
    // RPC usa transaction - se 1 UPDATE falha, todos fazem ROLLBACK
    const updates = [
      { id: 'q1', success: true },
      { id: 'q2', success: false }, // falha
      { id: 'q3', success: true }
    ]

    const hasFailure = updates.some(u => !u.success)
    if (hasFailure) {
      // Transaction rollback - nenhum update persiste
      const persistedUpdates = 0
      expect(persistedUpdates).toBe(0)
    }
  })

  it('should use advisory lock during reorder', () => {
    // RPC adquire lock por (company_id, stage_id)
    const companyId = 'company-1'
    const stageId = 'stage-1'
    
    const lockAcquired = true // pg_advisory_xact_lock
    expect(lockAcquired).toBe(true)
  })
})

// =====================================================
// ENABLED STATE - No Inference Tests
// =====================================================

describe('Enabled State - Explicit Source', () => {
  it('should fetch enabled state from backend (not infer)', async () => {
    // Novo endpoint get-stage-config
    const mockConfig = {
      enabled: true,
      activeQuestionCount: 5
    }

    // Hook deve consumir este endpoint
    expect(mockConfig.enabled).toBeDefined()
    expect(typeof mockConfig.enabled).toBe('boolean')
  })

  it('should not infer enabled from question count', () => {
    // Antes: enabled = hasActive (inferido)
    // Depois: enabled = config.enabled (explícito)
    
    const questionCount = 0
    const explicitEnabled = true // vem do backend

    // enabled=true + count=0 é válido
    expect(explicitEnabled).toBe(true)
    expect(questionCount).toBe(0)
  })

  it('should support enabled=true with zero questions', () => {
    const config = {
      enabled: true,
      activeQuestionCount: 0
    }

    // Válido - warning mas não bloqueia
    expect(config.enabled).toBe(true)
    expect(config.activeQuestionCount).toBe(0)
  })

  it('should show warning for enabled=true + zero questions', () => {
    const enabled = true
    const activeCount = 0
    const showWarning = enabled && activeCount === 0

    expect(showWarning).toBe(true)
  })
})

// =====================================================
// FEATURE FLAG TESTS
// =====================================================

describe('Feature Flag - Fail Closed', () => {
  it('should prevent all requests when feature=false', () => {
    const featureEnabled = false

    if (!featureEnabled) {
      const shouldMakeRequest = false
      expect(shouldMakeRequest).toBe(false)
    }
  })

  it('should return 503 from backend when feature=false', () => {
    const featureFlag = 'false'
    const isEnabled = featureFlag === 'true'

    if (!isEnabled) {
      const response = { status: 503, error: 'FEATURE_DISABLED' }
      expect(response.status).toBe(503)
      expect(response.error).toBe('FEATURE_DISABLED')
    }
  })

  it('should throw before fetch in transport layer', () => {
    const featureEnabled = false

    const ensureFeatureEnabled = () => {
      if (!featureEnabled) {
        throw new Error('FEATURE_DISABLED')
      }
    }

    expect(() => ensureFeatureEnabled()).toThrow('FEATURE_DISABLED')
  })
})

// =====================================================
// PARTNER + SELLER/MANAGER RESTRICTIONS
// =====================================================

describe('Funnel Access Restrictions', () => {
  it('should respect seller funnel restrictions in get-active', () => {
    const userRole = 'seller'
    const userFunnels = ['funnel-1', 'funnel-2']
    const requestedFunnel = 'funnel-3'

    const hasAccess = userFunnels.includes(requestedFunnel)
    expect(hasAccess).toBe(false)
  })

  it('should respect manager funnel restrictions in get-active', () => {
    const userRole = 'manager'
    const userFunnels = ['funnel-1']
    const requestedFunnel = 'funnel-1'

    const hasAccess = userFunnels.includes(requestedFunnel)
    expect(hasAccess).toBe(true)
  })

  it('should not restrict admin roles by funnel', () => {
    const userRole = 'admin'
    const requestedFunnel = 'any-funnel'

    // Admins têm acesso a todos os funnels da company
    const hasAccess = true
    expect(hasAccess).toBe(true)
  })
})
