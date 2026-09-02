// =====================================================
// TESTS: useFeatureFlags - Feature Flag Parsing
// Data: 02/09/2026
// Objetivo: Validar parsing estrito da feature flag
// =====================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Helper para testar parsing de flags
function parseFlag(value: string | undefined): boolean {
  return value === 'true'
}

describe('Feature Flag Parsing', () => {
  describe('parseFlag', () => {
    it('undefined → false', () => {
      const result = parseFlag(undefined)
      expect(result).toBe(false)
    })
    
    it('"" (empty string) → false', () => {
      const result = parseFlag('')
      expect(result).toBe(false)
    })
    
    it('"false" → false', () => {
      const result = parseFlag('false')
      expect(result).toBe(false)
    })
    
    it('"true" → true', () => {
      const result = parseFlag('true')
      expect(result).toBe(true)
    })
    
    it('"1" → false (strict parsing)', () => {
      const result = parseFlag('1')
      expect(result).toBe(false)
    })
    
    it('"TRUE" → false (case-sensitive)', () => {
      const result = parseFlag('TRUE')
      expect(result).toBe(false)
    })
    
    it('"yes" → false', () => {
      const result = parseFlag('yes')
      expect(result).toBe(false)
    })
    
    it('random value → false', () => {
      const result = parseFlag('random-value-123')
      expect(result).toBe(false)
    })
    
    it('"0" → false', () => {
      const result = parseFlag('0')
      expect(result).toBe(false)
    })
    
    it('"True" → false (case-sensitive)', () => {
      const result = parseFlag('True')
      expect(result).toBe(false)
    })
  })
})
