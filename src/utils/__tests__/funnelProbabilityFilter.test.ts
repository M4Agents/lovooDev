import { describe, expect, it } from 'vitest'
import {
  commitProbabilityDraft,
  evaluateProbabilityDraft,
  formatProbabilityRangeLabel,
  getEffectiveProbabilityRange,
  opportunityMatchesProbabilityRange,
  parseProbabilityInput,
  sanitizeStoredProbabilityRange,
} from '../funnelProbabilityFilter'

describe('parseProbabilityInput', () => {
  it('aceita vazio e inteiros 0–100', () => {
    expect(parseProbabilityInput('')).toBeNull()
    expect(parseProbabilityInput('  ')).toBeNull()
    expect(parseProbabilityInput('0')).toBe(0)
    expect(parseProbabilityInput('100')).toBe(100)
    expect(parseProbabilityInput('50')).toBe(50)
  })

  it('rejeita fração, texto e fora da faixa', () => {
    expect(parseProbabilityInput('50.5')).toBe('invalid')
    expect(parseProbabilityInput('50,5')).toBe('invalid')
    expect(parseProbabilityInput('-1')).toBe('invalid')
    expect(parseProbabilityInput('101')).toBe('invalid')
    expect(parseProbabilityInput('abc')).toBe('invalid')
  })
})

describe('evaluateProbabilityDraft', () => {
  it('permite um lado vazio', () => {
    expect(evaluateProbabilityDraft('70', '')).toEqual({ status: 'ok', range: { min: 70, max: null } })
    expect(evaluateProbabilityDraft('', '39')).toEqual({ status: 'ok', range: { min: null, max: 39 } })
  })

  it('não aplica quando min > max', () => {
    expect(evaluateProbabilityDraft('60', '50').status).toBe('min_gt_max')
  })

  it('aplica 0–100 e trata ambos vazios como sem faixa', () => {
    expect(evaluateProbabilityDraft('0', '100')).toEqual({ status: 'ok', range: { min: 0, max: 100 } })
    expect(evaluateProbabilityDraft('', '')).toEqual({ status: 'empty', range: { min: null, max: null } })
  })
})

describe('sanitizeStoredProbabilityRange', () => {
  it('descarta valores inválidos e só zera a faixa se min > max', () => {
    expect(sanitizeStoredProbabilityRange(50.5, 60)).toEqual({ min: null, max: 60 })
    expect(sanitizeStoredProbabilityRange(80, 10)).toEqual({ min: null, max: null })
    expect(sanitizeStoredProbabilityRange('50', 60)).toEqual({ min: null, max: 60 })
    expect(sanitizeStoredProbabilityRange(50, 60)).toEqual({ min: 50, max: 60 })
  })
})

describe('opportunityMatchesProbabilityRange', () => {
  it('sem faixa aceita tudo; com faixa exclui NULL e fora das bordas', () => {
    expect(opportunityMatchesProbabilityRange(null, { min: null, max: null })).toBe(true)
    expect(opportunityMatchesProbabilityRange(null, { min: 50, max: 60 })).toBe(false)
    expect(opportunityMatchesProbabilityRange(50, { min: 50, max: 60 })).toBe(true)
    expect(opportunityMatchesProbabilityRange(60, { min: 50, max: 60 })).toBe(true)
    expect(opportunityMatchesProbabilityRange(49, { min: 50, max: 60 })).toBe(false)
  })
})

describe('getEffectiveProbabilityRange', () => {
  it('com flag desligada nunca aplica a faixa salva', () => {
    expect(getEffectiveProbabilityRange({ min: 50, max: 60 }, false)).toEqual({ min: null, max: null })
    expect(getEffectiveProbabilityRange({ min: 50, max: 60 }, true)).toEqual({ min: 50, max: 60 })
  })
})

describe('formatProbabilityRangeLabel', () => {
  it('formata faixa, só mínimo e só máximo', () => {
    expect(formatProbabilityRangeLabel({ min: 50, max: 60 })).toBe('50–60%')
    expect(formatProbabilityRangeLabel({ min: 70, max: null })).toBe('≥ 70%')
    expect(formatProbabilityRangeLabel({ min: null, max: 39 })).toBe('≤ 39%')
  })
})

describe('commitProbabilityDraft', () => {
  const current = { min: 50, max: 60 }

  it('mantém a faixa aplicada quando o rascunho é inválido', () => {
    expect(commitProbabilityDraft(current, '60', '50')).toEqual({
      applied: current,
      status: 'min_gt_max',
    })
    expect(commitProbabilityDraft(current, 'abc', '10')).toEqual({
      applied: current,
      status: 'invalid_number',
    })
    expect(commitProbabilityDraft(current, '101', '')).toEqual({
      applied: current,
      status: 'invalid_number',
    })
  })

  it('aplica faixa válida e limpa quando ambos os campos estão vazios', () => {
    expect(commitProbabilityDraft(current, '70', '')).toEqual({
      applied: { min: 70, max: null },
      status: 'ok',
    })
    expect(commitProbabilityDraft(current, '', '')).toEqual({
      applied: { min: null, max: null },
      status: 'empty',
    })
  })
})
