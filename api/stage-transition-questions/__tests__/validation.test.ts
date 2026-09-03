// =====================================================
// TESTS: Stage Transition Questions API - Validation Logic
// Data: 02/09/2026 - Etapa D
//
// IMPORTANTE: Estes testes validam APENAS a lógica pura de validação.
// NÃO executam contra o banco (schemas R1 ainda não existem).
// =====================================================

import { describe, it, expect } from 'vitest'

// =====================================================
// FIELD TYPE VALIDATION
// =====================================================

const VALID_FIELD_TYPES = new Set(['text', 'number', 'boolean', 'select', 'multi_select', 'datetime'])

function validateFieldType(fieldType: string): boolean {
  return VALID_FIELD_TYPES.has(fieldType)
}

describe('Field Type Validation', () => {
  it('aceita tipos válidos', () => {
    expect(validateFieldType('text')).toBe(true)
    expect(validateFieldType('number')).toBe(true)
    expect(validateFieldType('boolean')).toBe(true)
    expect(validateFieldType('select')).toBe(true)
    expect(validateFieldType('multi_select')).toBe(true)
    expect(validateFieldType('datetime')).toBe(true)
  })

  it('rejeita tipos inválidos', () => {
    expect(validateFieldType('textarea')).toBe(false)
    expect(validateFieldType('date')).toBe(false)
    expect(validateFieldType('email')).toBe(false)
    expect(validateFieldType('')).toBe(false)
  })
})

// =====================================================
// OPTIONS VALIDATION
// =====================================================

interface OptionsValidationResult {
  valid: boolean
  error?: string
  normalized?: string[]
}

function validateOptions(
  fieldType: string,
  options: any
): OptionsValidationResult {
  // SELECT e MULTI_SELECT requerem options
  if (fieldType === 'select' || fieldType === 'multi_select') {
    if (!Array.isArray(options)) {
      return { valid: false, error: `field_type ${fieldType} requer options como array` }
    }

    const trimmed = options
      .map((opt: any) => typeof opt === 'string' ? opt.trim() : '')
      .filter((opt: string) => opt.length > 0)

    if (trimmed.length === 0) {
      return { valid: false, error: `options não pode ser vazio para ${fieldType}` }
    }

    // Verificar duplicatas (case-sensitive)
    const uniqueSet = new Set(trimmed)
    if (uniqueSet.size !== trimmed.length) {
      return { valid: false, error: 'options contém valores duplicados' }
    }

    return { valid: true, normalized: trimmed }
  }

  // Outros tipos não aceitam options
  if (options !== null && options !== undefined) {
    return { valid: false, error: `field_type ${fieldType} não aceita options` }
  }

  return { valid: true, normalized: null as any }
}

describe('Options Validation', () => {
  describe('SELECT field_type', () => {
    it('aceita array válido', () => {
      const result = validateOptions('select', ['Opção A', 'Opção B', 'Opção C'])
      expect(result.valid).toBe(true)
      expect(result.normalized).toEqual(['Opção A', 'Opção B', 'Opção C'])
    })

    it('trim strings', () => {
      const result = validateOptions('select', ['  A  ', ' B ', 'C'])
      expect(result.valid).toBe(true)
      expect(result.normalized).toEqual(['A', 'B', 'C'])
    })

    it('rejeita array vazio', () => {
      const result = validateOptions('select', [])
      expect(result.valid).toBe(false)
    })

    it('rejeita options não-array', () => {
      const result = validateOptions('select', null)
      expect(result.valid).toBe(false)
    })

    it('rejeita duplicatas', () => {
      const result = validateOptions('select', ['A', 'B', 'A'])
      expect(result.valid).toBe(false)
      expect(result.error).toContain('duplicados')
    })

    it('duplicatas são case-sensitive', () => {
      const result = validateOptions('select', ['WhatsApp', 'whatsapp'])
      expect(result.valid).toBe(true) // Não são duplicatas
    })
  })

  describe('MULTI_SELECT field_type', () => {
    it('aceita array válido', () => {
      const result = validateOptions('multi_select', ['Produto A', 'Produto B'])
      expect(result.valid).toBe(true)
    })

    it('rejeita options inválidas', () => {
      const result = validateOptions('multi_select', 'string')
      expect(result.valid).toBe(false)
    })
  })

  describe('TEXT/NUMBER/BOOLEAN field_type', () => {
    it('aceita null', () => {
      expect(validateOptions('text', null).valid).toBe(true)
      expect(validateOptions('number', null).valid).toBe(true)
      expect(validateOptions('boolean', null).valid).toBe(true)
    })

    it('aceita undefined', () => {
      expect(validateOptions('text', undefined).valid).toBe(true)
    })

    it('rejeita options fornecidas', () => {
      const result = validateOptions('text', ['A', 'B'])
      expect(result.valid).toBe(false)
      expect(result.error).toContain('não aceita options')
    })
  })
})

// =====================================================
// LABEL VALIDATION
// =====================================================

function validateLabel(label: any): { valid: boolean; error?: string; trimmed?: string } {
  if (typeof label !== 'string') {
    return { valid: false, error: 'label deve ser string' }
  }

  const trimmed = label.trim()
  if (trimmed.length === 0) {
    return { valid: false, error: 'label não pode ser vazio' }
  }

  return { valid: true, trimmed }
}

describe('Label Validation', () => {
  it('aceita label válida', () => {
    const result = validateLabel('Cliente Qualificado?')
    expect(result.valid).toBe(true)
    expect(result.trimmed).toBe('Cliente Qualificado?')
  })

  it('trim label', () => {
    const result = validateLabel('  Observações  ')
    expect(result.valid).toBe(true)
    expect(result.trimmed).toBe('Observações')
  })

  it('rejeita label vazia', () => {
    expect(validateLabel('').valid).toBe(false)
    expect(validateLabel('   ').valid).toBe(false)
  })

  it('rejeita não-string', () => {
    expect(validateLabel(123).valid).toBe(false)
    expect(validateLabel(null).valid).toBe(false)
  })
})

// =====================================================
// REQUIRED VALIDATION
// =====================================================

function validateRequired(required: any): boolean {
  return typeof required === 'boolean'
}

describe('Required Validation', () => {
  it('aceita boolean', () => {
    expect(validateRequired(true)).toBe(true)
    expect(validateRequired(false)).toBe(true)
  })

  it('rejeita coerções', () => {
    expect(validateRequired('true')).toBe(false)
    expect(validateRequired(1)).toBe(false)
    expect(validateRequired('1')).toBe(false)
    expect(validateRequired(null)).toBe(false)
  })
})

// =====================================================
// MAX 15 ACTIVE QUESTIONS
// =====================================================

const MAX_ACTIVE_QUESTIONS = 15

function canCreateActiveQuestion(currentActiveCount: number): {
  allowed: boolean
  error?: string
} {
  if (currentActiveCount >= MAX_ACTIVE_QUESTIONS) {
    return {
      allowed: false,
      error: `Limite de ${MAX_ACTIVE_QUESTIONS} perguntas ativas atingido`
    }
  }
  return { allowed: true }
}

describe('Max 15 Active Questions', () => {
  it('permite criar quando < 15', () => {
    expect(canCreateActiveQuestion(0).allowed).toBe(true)
    expect(canCreateActiveQuestion(14).allowed).toBe(true)
  })

  it('bloqueia quando = 15', () => {
    const result = canCreateActiveQuestion(15)
    expect(result.allowed).toBe(false)
    expect(result.error).toContain('15')
  })

  it('bloqueia quando > 15', () => {
    expect(canCreateActiveQuestion(16).allowed).toBe(false)
  })
})

// =====================================================
// RBAC VALIDATION
// =====================================================

const ADMIN_ROLES = new Set(['admin', 'system_admin', 'super_admin'])

function hasAdminRole(role: string): boolean {
  return ADMIN_ROLES.has(role)
}

describe('RBAC', () => {
  it('admin roles têm acesso', () => {
    expect(hasAdminRole('admin')).toBe(true)
    expect(hasAdminRole('system_admin')).toBe(true)
    expect(hasAdminRole('super_admin')).toBe(true)
  })

  it('outros roles não têm acesso', () => {
    expect(hasAdminRole('manager')).toBe(false)
    expect(hasAdminRole('seller')).toBe(false)
    expect(hasAdminRole('partner')).toBe(false)
  })
})

// =====================================================
// REORDER VALIDATION
// =====================================================

interface QuestionOrder {
  id: string
  sort_order: number
}

function validateReorderInput(questionOrder: any): {
  valid: boolean
  error?: string
} {
  if (!Array.isArray(questionOrder)) {
    return { valid: false, error: 'question_order deve ser array' }
  }

  if (questionOrder.length === 0) {
    return { valid: false, error: 'question_order não pode ser vazio' }
  }

  // Validar estrutura
  for (const item of questionOrder) {
    if (typeof item.id !== 'string' || !item.id.trim()) {
      return { valid: false, error: 'Cada item deve ter id (string)' }
    }
    if (typeof item.sort_order !== 'number') {
      return { valid: false, error: 'Cada item deve ter sort_order (number)' }
    }
  }

  // Verificar IDs duplicados
  const ids = questionOrder.map((q: QuestionOrder) => q.id)
  const uniqueIds = new Set(ids)
  if (uniqueIds.size !== ids.length) {
    return { valid: false, error: 'IDs duplicados' }
  }

  return { valid: true }
}

describe('Reorder Validation', () => {
  it('aceita input válido', () => {
    const input = [
      { id: 'q1', sort_order: 0 },
      { id: 'q2', sort_order: 1 },
      { id: 'q3', sort_order: 2 }
    ]
    expect(validateReorderInput(input).valid).toBe(true)
  })

  it('rejeita não-array', () => {
    expect(validateReorderInput('string').valid).toBe(false)
  })

  it('rejeita array vazio', () => {
    expect(validateReorderInput([]).valid).toBe(false)
  })

  it('rejeita item sem id', () => {
    const input = [{ sort_order: 0 }]
    expect(validateReorderInput(input).valid).toBe(false)
  })

  it('rejeita item sem sort_order', () => {
    const input = [{ id: 'q1' }]
    expect(validateReorderInput(input).valid).toBe(false)
  })

  it('rejeita IDs duplicados', () => {
    const input = [
      { id: 'q1', sort_order: 0 },
      { id: 'q1', sort_order: 1 }
    ]
    const result = validateReorderInput(input)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('duplicados')
  })
})

// =====================================================
// FEATURE FLAG VALIDATION
// =====================================================

function isFeatureEnabled(envValue: string | undefined): boolean {
  return envValue === 'true'
}

describe('Server Feature Flag', () => {
  it('true habilita', () => {
    expect(isFeatureEnabled('true')).toBe(true)
  })

  it('false desabilita', () => {
    expect(isFeatureEnabled('false')).toBe(false)
  })

  it('undefined desabilita', () => {
    expect(isFeatureEnabled(undefined)).toBe(false)
  })

  it('outros valores desabilitam', () => {
    expect(isFeatureEnabled('1')).toBe(false)
    expect(isFeatureEnabled('TRUE')).toBe(false)
    expect(isFeatureEnabled('yes')).toBe(false)
    expect(isFeatureEnabled('')).toBe(false)
  })
})

// =====================================================
// CREATE_ACTIVITY_ON_ANSWER VALIDATION (DATETIME.1D)
// =====================================================

interface CreateActivityValidationResult {
  valid: boolean
  error?: string
}

function validateCreateActivityOnAnswer(
  fieldType: string,
  createActivityOnAnswer: any
): CreateActivityValidationResult {
  // Se não informado, default false (válido)
  if (createActivityOnAnswer === undefined || createActivityOnAnswer === null) {
    return { valid: true }
  }

  // Deve ser boolean
  if (typeof createActivityOnAnswer !== 'boolean') {
    return { valid: false, error: 'create_activity_on_answer deve ser boolean' }
  }

  // Se true, só é permitido para datetime
  if (createActivityOnAnswer && fieldType !== 'datetime') {
    return {
      valid: false,
      error: 'create_activity_on_answer=true só é permitido para field_type=datetime'
    }
  }

  return { valid: true }
}

describe('Create Activity On Answer Validation (DATETIME.1D)', () => {
  describe('CREATE', () => {
    it('datetime + flag=false → válido', () => {
      const result = validateCreateActivityOnAnswer('datetime', false)
      expect(result.valid).toBe(true)
    })

    it('datetime + flag=true → válido', () => {
      const result = validateCreateActivityOnAnswer('datetime', true)
      expect(result.valid).toBe(true)
    })

    it('datetime + flag=undefined → válido (default false)', () => {
      const result = validateCreateActivityOnAnswer('datetime', undefined)
      expect(result.valid).toBe(true)
    })

    it('text + flag=true → rejeitado', () => {
      const result = validateCreateActivityOnAnswer('text', true)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('datetime')
    })

    it('number + flag=true → rejeitado', () => {
      const result = validateCreateActivityOnAnswer('number', true)
      expect(result.valid).toBe(false)
    })

    it('boolean + flag=true → rejeitado', () => {
      const result = validateCreateActivityOnAnswer('boolean', true)
      expect(result.valid).toBe(false)
    })

    it('select + flag=true → rejeitado', () => {
      const result = validateCreateActivityOnAnswer('select', true)
      expect(result.valid).toBe(false)
    })

    it('multi_select + flag=true → rejeitado', () => {
      const result = validateCreateActivityOnAnswer('multi_select', true)
      expect(result.valid).toBe(false)
    })

    it('text + flag=false → válido', () => {
      const result = validateCreateActivityOnAnswer('text', false)
      expect(result.valid).toBe(true)
    })

    it('flag não boolean → rejeitado', () => {
      const result = validateCreateActivityOnAnswer('datetime', 'true')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('boolean')
    })
  })
})

// =====================================================
// FINAL STATE VALIDATION (DATETIME.1D - UPDATE)
// =====================================================

interface FinalStateValidationResult {
  valid: boolean
  error?: string
}

function validateFinalState(
  finalFieldType: string,
  finalCreateActivity: boolean
): FinalStateValidationResult {
  // Se create_activity_on_answer será true, field_type FINAL deve ser datetime
  if (finalCreateActivity && finalFieldType !== 'datetime') {
    return {
      valid: false,
      error: 'create_activity_on_answer=true requer field_type=datetime (estado final inválido)'
    }
  }

  return { valid: true }
}

describe('Final State Validation (DATETIME.1D - UPDATE)', () => {
  it('datetime + flag=true → válido', () => {
    const result = validateFinalState('datetime', true)
    expect(result.valid).toBe(true)
  })

  it('datetime + flag=false → válido', () => {
    const result = validateFinalState('datetime', false)
    expect(result.valid).toBe(true)
  })

  it('text + flag=false → válido', () => {
    const result = validateFinalState('text', false)
    expect(result.valid).toBe(true)
  })

  it('text + flag=true → rejeitado', () => {
    const result = validateFinalState('text', true)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('datetime')
  })

  it('number + flag=true → rejeitado', () => {
    const result = validateFinalState('number', true)
    expect(result.valid).toBe(false)
  })

  it('boolean + flag=true → rejeitado', () => {
    const result = validateFinalState('boolean', true)
    expect(result.valid).toBe(false)
  })

  it('select + flag=true → rejeitado', () => {
    const result = validateFinalState('select', true)
    expect(result.valid).toBe(false)
  })

  it('multi_select + flag=true → rejeitado', () => {
    const result = validateFinalState('multi_select', true)
    expect(result.valid).toBe(false)
  })

  // ===================================================
  // UPDATE SCENARIOS (DATETIME.1D.1)
  // ===================================================

  describe('Cenários UPDATE com estado final', () => {
    it('Cenário 1: datetime+flag=true → payload field_type=text → final state rejeitado', () => {
      // Estado existente: datetime + true
      // Payload: field_type='text' (flag não enviado)
      // Estado final: text + true
      const result = validateFinalState('text', true)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('datetime')
    })

    it('Cenário 2: datetime+flag=true → payload field_type=text+flag=false → final state válido', () => {
      // Estado existente: datetime + true
      // Payload: field_type='text', flag=false
      // Estado final: text + false
      const result = validateFinalState('text', false)
      expect(result.valid).toBe(true)
    })

    it('Cenário 3: text+flag=false → payload flag=true → final state rejeitado', () => {
      // Estado existente: text + false
      // Payload: flag=true (field_type não enviado)
      // Estado final: text + true
      const result = validateFinalState('text', true)
      expect(result.valid).toBe(false)
    })

    it('Cenário 4: datetime+flag=false → payload flag=true → final state válido', () => {
      // Estado existente: datetime + false
      // Payload: flag=true (field_type não enviado)
      // Estado final: datetime + true
      const result = validateFinalState('datetime', true)
      expect(result.valid).toBe(true)
    })
  })
})
