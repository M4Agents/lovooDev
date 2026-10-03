import { describe, expect, it } from 'vitest'
import {
  getProbabilityBadgeClass,
  getProbabilityTextClass,
  getProbabilityTone,
} from '../probabilityColor'

describe('getProbabilityTone', () => {
  it('marca ≥70 como alto e <40 como baixo', () => {
    expect(getProbabilityTone(80)).toBe('high')
    expect(getProbabilityTone(70)).toBe('high')
    expect(getProbabilityTone(40)).toBe('medium')
    expect(getProbabilityTone(39)).toBe('low')
    expect(getProbabilityTone(18)).toBe('low')
  })
})

describe('probability color classes', () => {
  it('usa as mesmas cores do Dashboard', () => {
    expect(getProbabilityTextClass(80)).toBe('text-green-600')
    expect(getProbabilityTextClass(18)).toBe('text-red-500')
    expect(getProbabilityBadgeClass(80)).toBe('bg-green-100 text-green-700')
    expect(getProbabilityBadgeClass(18)).toBe('bg-red-100 text-red-700')
  })
})
