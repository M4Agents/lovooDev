// =====================================================
// Stage Transition Questions Panel - Unit Tests
// Data: 02/09/2026 - Etapa F
//
// Tests for validation and pure logic
// =====================================================

import { describe, it, expect } from 'vitest'

// =====================================================
// VALIDATION HELPERS (extracted for testing)
// =====================================================

type FieldTypeOption = 'text' | 'number' | 'boolean' | 'select' | 'multi_select'

interface ValidationContext {
  label: string
  fieldType: FieldTypeOption
  options: string[]
  sortOrder: string
  isEditing: boolean
  activeQuestionCount: number
  maxActiveQuestions: number
}

export function validateQuestionForm(ctx: ValidationContext): string | null {
  const trimmedLabel = ctx.label.trim()
  if (!trimmedLabel) return 'Label é obrigatório'

  if (ctx.fieldType === 'select' || ctx.fieldType === 'multi_select') {
    if (ctx.options.length === 0) {
      return `Tipo ${ctx.fieldType} requer pelo menos uma opção`
    }
  }

  const sortOrder = parseInt(ctx.sortOrder, 10)
  if (isNaN(sortOrder)) return 'Sort order deve ser um número'

  // Check max active if creating new active question
  if (!ctx.isEditing) {
    if (ctx.activeQuestionCount >= ctx.maxActiveQuestions) {
      return `Limite de ${ctx.maxActiveQuestions} perguntas ativas atingido. Desative uma pergunta existente primeiro.`
    }
  }

  return null
}

// =====================================================
// OPTIONS MANAGEMENT HELPERS
// =====================================================

export function addOptionToList(
  currentOptions: string[],
  newOption: string
): { success: boolean; options?: string[]; error?: string } {
  const trimmed = newOption.trim()
  
  if (!trimmed) {
    return { success: false, error: 'Opção vazia' }
  }

  if (currentOptions.includes(trimmed)) {
    return { success: false, error: 'Esta opção já existe.' }
  }

  return { success: true, options: [...currentOptions, trimmed] }
}

export function removeOptionFromList(
  currentOptions: string[],
  optionToRemove: string
): string[] {
  return currentOptions.filter(o => o !== optionToRemove)
}

export function moveOptionUp(
  currentOptions: string[],
  index: number
): string[] {
  if (index === 0) return currentOptions
  
  const newOptions = [...currentOptions]
  ;[newOptions[index - 1], newOptions[index]] = [newOptions[index], newOptions[index - 1]]
  
  return newOptions
}

export function moveOptionDown(
  currentOptions: string[],
  index: number
): string[] {
  if (index === currentOptions.length - 1) return currentOptions
  
  const newOptions = [...currentOptions]
  ;[newOptions[index], newOptions[index + 1]] = [newOptions[index + 1], newOptions[index]]
  
  return newOptions
}

// =====================================================
// REORDER HELPERS
// =====================================================

export function reorderQuestions<T extends { id: string }>(
  questions: T[],
  currentIndex: number,
  direction: 'up' | 'down'
): T[] {
  if (direction === 'up' && currentIndex === 0) return questions
  if (direction === 'down' && currentIndex === questions.length - 1) return questions

  const newQuestions = [...questions]
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1

  ;[newQuestions[currentIndex], newQuestions[targetIndex]] = 
    [newQuestions[targetIndex], newQuestions[currentIndex]]

  return newQuestions
}

// =====================================================
// TESTS
// =====================================================

describe('Stage Transition Questions Panel - Validation', () => {
  const MAX_ACTIVE = 15

  describe('validateQuestionForm', () => {
    it('should require label', () => {
      const result = validateQuestionForm({
        label: '',
        fieldType: 'text',
        options: [],
        sortOrder: '0',
        isEditing: false,
        activeQuestionCount: 0,
        maxActiveQuestions: MAX_ACTIVE
      })

      expect(result).toBe('Label é obrigatório')
    })

    it('should trim label before validating', () => {
      const result = validateQuestionForm({
        label: '   ',
        fieldType: 'text',
        options: [],
        sortOrder: '0',
        isEditing: false,
        activeQuestionCount: 0,
        maxActiveQuestions: MAX_ACTIVE
      })

      expect(result).toBe('Label é obrigatório')
    })

    it('should require options for select', () => {
      const result = validateQuestionForm({
        label: 'Test',
        fieldType: 'select',
        options: [],
        sortOrder: '0',
        isEditing: false,
        activeQuestionCount: 0,
        maxActiveQuestions: MAX_ACTIVE
      })

      expect(result).toBe('Tipo select requer pelo menos uma opção')
    })

    it('should require options for multi_select', () => {
      const result = validateQuestionForm({
        label: 'Test',
        fieldType: 'multi_select',
        options: [],
        sortOrder: '0',
        isEditing: false,
        activeQuestionCount: 0,
        maxActiveQuestions: MAX_ACTIVE
      })

      expect(result).toBe('Tipo multi_select requer pelo menos uma opção')
    })

    it('should not require options for text', () => {
      const result = validateQuestionForm({
        label: 'Test',
        fieldType: 'text',
        options: [],
        sortOrder: '0',
        isEditing: false,
        activeQuestionCount: 0,
        maxActiveQuestions: MAX_ACTIVE
      })

      expect(result).toBeNull()
    })

    it('should validate sort_order as number', () => {
      const result = validateQuestionForm({
        label: 'Test',
        fieldType: 'text',
        options: [],
        sortOrder: 'not-a-number',
        isEditing: false,
        activeQuestionCount: 0,
        maxActiveQuestions: MAX_ACTIVE
      })

      expect(result).toBe('Sort order deve ser um número')
    })

    it('should enforce max active questions when creating', () => {
      const result = validateQuestionForm({
        label: 'Test',
        fieldType: 'text',
        options: [],
        sortOrder: '0',
        isEditing: false,
        activeQuestionCount: MAX_ACTIVE,
        maxActiveQuestions: MAX_ACTIVE
      })

      expect(result).toContain('Limite de 15 perguntas ativas atingido')
    })

    it('should allow editing even if max is reached', () => {
      const result = validateQuestionForm({
        label: 'Test',
        fieldType: 'text',
        options: [],
        sortOrder: '0',
        isEditing: true,
        activeQuestionCount: MAX_ACTIVE,
        maxActiveQuestions: MAX_ACTIVE
      })

      expect(result).toBeNull()
    })

    it('should pass valid form', () => {
      const result = validateQuestionForm({
        label: 'Valid Question',
        fieldType: 'select',
        options: ['Option 1', 'Option 2'],
        sortOrder: '5',
        isEditing: false,
        activeQuestionCount: 5,
        maxActiveQuestions: MAX_ACTIVE
      })

      expect(result).toBeNull()
    })
  })

  describe('Options Management', () => {
    it('should add valid option', () => {
      const result = addOptionToList(['A', 'B'], 'C')
      
      expect(result.success).toBe(true)
      expect(result.options).toEqual(['A', 'B', 'C'])
    })

    it('should trim option before adding', () => {
      const result = addOptionToList(['A'], '  B  ')
      
      expect(result.success).toBe(true)
      expect(result.options).toEqual(['A', 'B'])
    })

    it('should reject empty option', () => {
      const result = addOptionToList(['A'], '')
      
      expect(result.success).toBe(false)
      expect(result.error).toBe('Opção vazia')
    })

    it('should reject duplicate option', () => {
      const result = addOptionToList(['A', 'B'], 'A')
      
      expect(result.success).toBe(false)
      expect(result.error).toBe('Esta opção já existe.')
    })

    it('should remove option', () => {
      const result = removeOptionFromList(['A', 'B', 'C'], 'B')
      
      expect(result).toEqual(['A', 'C'])
    })

    it('should move option up', () => {
      const result = moveOptionUp(['A', 'B', 'C'], 1)
      
      expect(result).toEqual(['B', 'A', 'C'])
    })

    it('should not move first option up', () => {
      const result = moveOptionUp(['A', 'B', 'C'], 0)
      
      expect(result).toEqual(['A', 'B', 'C'])
    })

    it('should move option down', () => {
      const result = moveOptionDown(['A', 'B', 'C'], 1)
      
      expect(result).toEqual(['A', 'C', 'B'])
    })

    it('should not move last option down', () => {
      const result = moveOptionDown(['A', 'B', 'C'], 2)
      
      expect(result).toEqual(['A', 'B', 'C'])
    })
  })

  describe('Reorder Questions', () => {
    const mockQuestions = [
      { id: '1', name: 'Q1' },
      { id: '2', name: 'Q2' },
      { id: '3', name: 'Q3' }
    ]

    it('should move question up', () => {
      const result = reorderQuestions(mockQuestions, 1, 'up')
      
      expect(result.map(q => q.id)).toEqual(['2', '1', '3'])
    })

    it('should not move first question up', () => {
      const result = reorderQuestions(mockQuestions, 0, 'up')
      
      expect(result).toEqual(mockQuestions)
    })

    it('should move question down', () => {
      const result = reorderQuestions(mockQuestions, 1, 'down')
      
      expect(result.map(q => q.id)).toEqual(['1', '3', '2'])
    })

    it('should not move last question down', () => {
      const result = reorderQuestions(mockQuestions, 2, 'down')
      
      expect(result).toEqual(mockQuestions)
    })
  })
})
