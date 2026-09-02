// =====================================================
// TESTS: Stage Transition Questions Helpers
// Data: 02/09/2026
// Objetivo: Testes dos helpers puros (Etapa A - R1)
// =====================================================

import { describe, it, expect } from 'vitest'
import {
  canonicalizeMultiSelectValues,
  serializeMultiSelectValue,
  deserializeMultiSelectValue,
  validateAnswerValue,
} from '../stageTransitionQuestions'

describe('canonicalizeMultiSelectValues', () => {
  it('canonicaliza conforme ordem de options', () => {
    const selected = ['C', 'A']
    const options = ['A', 'B', 'C']
    const result = canonicalizeMultiSelectValues(selected, options)
    
    expect(result).toEqual(['A', 'C'])
  })
  
  it('remove valores não presentes em options', () => {
    const selected = ['A', 'D', 'C']
    const options = ['A', 'B', 'C']
    
    expect(() => {
      canonicalizeMultiSelectValues(selected, options)
    }).toThrow('não existe nas opções')
  })
  
  it('rejeita duplicatas', () => {
    const selected = ['A', 'C', 'A']
    const options = ['A', 'B', 'C']
    
    expect(() => {
      canonicalizeMultiSelectValues(selected, options)
    }).toThrow('duplicados')
  })
  
  it('rejeita valores vazios', () => {
    const selected = ['A', '', 'C']
    const options = ['A', 'B', 'C']
    
    expect(() => {
      canonicalizeMultiSelectValues(selected, options)
    }).toThrow('vazios')
  })
  
  it('rejeita se selected não é array', () => {
    expect(() => {
      canonicalizeMultiSelectValues('A' as any, ['A', 'B'])
    }).toThrow('deve ser um array')
  })
  
  it('rejeita se options é vazio', () => {
    expect(() => {
      canonicalizeMultiSelectValues(['A'], [])
    }).toThrow('não vazio')
  })
  
  it('trima valores antes de validar', () => {
    const selected = [' A ', ' C ']
    const options = ['A', 'B', 'C']
    const result = canonicalizeMultiSelectValues(selected, options)
    
    expect(result).toEqual(['A', 'C'])
  })
  
  it('preserva ordem de options com múltiplas seleções', () => {
    const selected = ['D', 'B', 'A']
    const options = ['A', 'B', 'C', 'D']
    const result = canonicalizeMultiSelectValues(selected, options)
    
    expect(result).toEqual(['A', 'B', 'D'])
  })
  
  it('canonicaliza com string contendo aspas', () => {
    const selected = ['Plan "Premium"']
    const options = ['Plan "Premium"', 'Plan Basic']
    const result = canonicalizeMultiSelectValues(selected, options)
    
    expect(result).toEqual(['Plan "Premium"'])
  })
  
  it('canonicaliza com string contendo vírgula', () => {
    const selected = ['A,B']
    const options = ['A,B', 'C,D']
    const result = canonicalizeMultiSelectValues(selected, options)
    
    expect(result).toEqual(['A,B'])
  })
  
  it('canonicaliza com string contendo Unicode', () => {
    const selected = ['Opção 🎉']
    const options = ['Opção 🎉', 'Opção 🔥']
    const result = canonicalizeMultiSelectValues(selected, options)
    
    expect(result).toEqual(['Opção 🎉'])
  })
})

describe('serializeMultiSelectValue', () => {
  it('serializa array canonicalizado para JSON', () => {
    const selected = ['C', 'A']
    const options = ['A', 'B', 'C']
    const result = serializeMultiSelectValue(selected, options)
    
    expect(result).toBe('["A","C"]')
  })
  
  it('rejeita array vazio', () => {
    const selected: string[] = []
    const options = ['A', 'B', 'C']
    
    expect(() => {
      serializeMultiSelectValue(selected, options)
    }).toThrow('vazio não deve ser persistido')
  })
  
  it('produz JSON válido', () => {
    const selected = ['A', 'B']
    const options = ['A', 'B', 'C']
    const result = serializeMultiSelectValue(selected, options)
    
    // Deve ser JSON válido
    const parsed = JSON.parse(result)
    expect(Array.isArray(parsed)).toBe(true)
  })
  
  it('é determinístico', () => {
    const selected = ['C', 'A']
    const options = ['A', 'B', 'C']
    
    const result1 = serializeMultiSelectValue(selected, options)
    const result2 = serializeMultiSelectValue(selected, options)
    
    expect(result1).toBe(result2)
  })
})

describe('deserializeMultiSelectValue', () => {
  it('deserializa JSON válido', () => {
    const value = '["A","C"]'
    const result = deserializeMultiSelectValue(value)
    
    expect(result).toEqual(['A', 'C'])
  })
  
  it('rejeita JSON inválido', () => {
    const value = '["A","C"'
    
    expect(() => {
      deserializeMultiSelectValue(value)
    }).toThrow('JSON inválido')
  })
  
  it('rejeita se não é array', () => {
    const value = '{"a": "b"}'
    
    expect(() => {
      deserializeMultiSelectValue(value)
    }).toThrow('não é array')
  })
  
  it('rejeita se elementos não são strings', () => {
    const value = '[1, 2, 3]'
    
    expect(() => {
      deserializeMultiSelectValue(value)
    }).toThrow('devem ser strings')
  })
  
  it('rejeita value vazio', () => {
    expect(() => {
      deserializeMultiSelectValue('')
    }).toThrow('não vazia')
  })
  
  it('rejeita value não-string', () => {
    expect(() => {
      deserializeMultiSelectValue(123 as any)
    }).toThrow('não vazia')
  })
  
  it('deserializa com caracteres especiais', () => {
    const value = '["Plan \\"Premium\\"","A&B","Opção 🎉"]'
    const result = deserializeMultiSelectValue(value)
    
    expect(result).toEqual(['Plan "Premium"', 'A&B', 'Opção 🎉'])
  })
  
  it('rejeita objeto JSON em vez de array', () => {
    const value = '{"a": "b"}'
    
    expect(() => {
      deserializeMultiSelectValue(value)
    }).toThrow('não é array')
  })
  
  it('rejeita array com números', () => {
    const value = '[1, 2, 3]'
    
    expect(() => {
      deserializeMultiSelectValue(value)
    }).toThrow('devem ser strings')
  })
  
  it('rejeita array com boolean', () => {
    const value = '["A", true]'
    
    expect(() => {
      deserializeMultiSelectValue(value)
    }).toThrow('devem ser strings')
  })
  
  it('rejeita array com null', () => {
    const value = '["A", null]'
    
    expect(() => {
      deserializeMultiSelectValue(value)
    }).toThrow('devem ser strings')
  })
  
  it('rejeita array com objeto', () => {
    const value = '["A", {}]'
    
    expect(() => {
      deserializeMultiSelectValue(value)
    }).toThrow('devem ser strings')
  })
  
  it('rejeita array com array aninhado', () => {
    const value = '["A", []]'
    
    expect(() => {
      deserializeMultiSelectValue(value)
    }).toThrow('devem ser strings')
  })
})

describe('validateAnswerValue', () => {
  describe('text', () => {
    it('aceita texto válido', () => {
      const result = validateAnswerValue('text', 'resposta', null, false)
      expect(result).toBeNull()
    })
    
    it('rejeita required vazio', () => {
      const result = validateAnswerValue('text', '  ', null, true)
      expect(result).toBe('Campo obrigatório')
    })
    
    it('aceita opcional vazio', () => {
      const result = validateAnswerValue('text', null, null, false)
      expect(result).toBeNull()
    })
  })
  
  describe('number', () => {
    it('aceita número válido', () => {
      const result = validateAnswerValue('number', '1500.50', null, false)
      expect(result).toBeNull()
    })
    
    it('aceita número negativo', () => {
      const result = validateAnswerValue('number', '-10', null, false)
      expect(result).toBeNull()
    })
    
    it('rejeita texto não-numérico', () => {
      const result = validateAnswerValue('number', 'abc', null, false)
      expect(result).toBe('Número inválido')
    })
  })
  
  describe('boolean', () => {
    it('aceita "true"', () => {
      const result = validateAnswerValue('boolean', 'true', null, false)
      expect(result).toBeNull()
    })
    
    it('aceita "false"', () => {
      const result = validateAnswerValue('boolean', 'false', null, false)
      expect(result).toBeNull()
    })
    
    it('rejeita "sim"', () => {
      const result = validateAnswerValue('boolean', 'sim', null, false)
      expect(result).toBe('Valor inválido')
    })
    
    it('rejeita "1"', () => {
      const result = validateAnswerValue('boolean', '1', null, false)
      expect(result).toBe('Valor inválido')
    })
  })
  
  describe('select', () => {
    it('aceita opção válida', () => {
      const options = ['A', 'B', 'C']
      const result = validateAnswerValue('select', 'A', options, false)
      expect(result).toBeNull()
    })
    
    it('rejeita opção inválida', () => {
      const options = ['A', 'B', 'C']
      const result = validateAnswerValue('select', 'D', options, false)
      expect(result).toBe('Opção inválida')
    })
  })
  
  describe('multi_select', () => {
    it('aceita seleções válidas', () => {
      const options = ['A', 'B', 'C']
      const result = validateAnswerValue('multi_select', ['A', 'C'], options, false)
      expect(result).toBeNull()
    })
    
    it('rejeita required vazio', () => {
      const options = ['A', 'B', 'C']
      const result = validateAnswerValue('multi_select', [], options, true)
      expect(result).toBe('Selecione pelo menos uma opção')
    })
    
    it('aceita opcional vazio', () => {
      const options = ['A', 'B', 'C']
      const result = validateAnswerValue('multi_select', null, options, false)
      expect(result).toBeNull()
    })
    
    it('rejeita opção inválida', () => {
      const options = ['A', 'B', 'C']
      const result = validateAnswerValue('multi_select', ['A', 'D'], options, false)
      expect(result).toContain('Opção inválida')
    })
    
    it('rejeita duplicatas', () => {
      const options = ['A', 'B', 'C']
      const result = validateAnswerValue('multi_select', ['A', 'A'], options, false)
      expect(result).toBe('Duplicatas não são permitidas')
    })
    
    it('rejeita valor vazio no array', () => {
      const options = ['A', 'B', 'C']
      const result = validateAnswerValue('multi_select', ['A', ''], options, false)
      expect(result).toContain('não vazias')
    })
    
    it('rejeita se não é array', () => {
      const options = ['A', 'B', 'C']
      const result = validateAnswerValue('multi_select', 'A' as any, options, false)
      expect(result).toBe('Tipo inválido')
    })
  })
})
