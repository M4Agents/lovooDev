import { describe, expect, it } from 'vitest'
import { formatTagGroupPreview } from '../tagGroupPreview'

const names: Record<string, string> = {
  a: 'Meta ADS',
  b: 'Instagram',
  c: 'LP',
  d: 'Google',
}

function label(id: string): string {
  return names[id] ?? id
}

describe('prévia dos blocos', () => {
  it('mostra OU dentro do bloco e E entre os blocos', () => {
    expect(formatTagGroupPreview(
      [{ tag_ids: ['a', 'b'] }, { tag_ids: ['c', 'd'] }],
      label,
      'OU',
      'E',
      '…',
    )).toBe('(Meta ADS OU Instagram) E (LP OU Google)')
  })

  it('envolve bloco de uma tag em parênteses', () => {
    expect(formatTagGroupPreview(
      [{ tag_ids: ['a'] }, { tag_ids: ['c'] }],
      label,
      'OU',
      'E',
      '…',
    )).toBe('(Meta ADS) E (LP)')
  })

  it('marca bloco vazio sem inventar tag', () => {
    expect(formatTagGroupPreview(
      [{ tag_ids: [] }],
      label,
      'OU',
      'E',
      '…',
    )).toBe('(…)')
  })
})
