import { describe, expect, it } from 'vitest'
import {
  isConversationVisibleForUser,
  normalizeRealtimeAssignedTo,
} from '../chatVisibility'

const seller = { flag: true, role: 'seller', userId: 'seller-1' }
const admin = { flag: true, role: 'admin', userId: 'admin-1' }

describe('isConversationVisibleForUser', () => {
  it('mantém a conversa do vendedor quando o realtime manda o UUID do responsável', () => {
    expect(isConversationVisibleForUser({ assigned_to: 'seller-1' }, seller)).toBe(true)
  })

  it('mantém a conversa quando o responsável já está no formato da lista', () => {
    expect(
      isConversationVisibleForUser(
        { assigned_to: { id: 'seller-1', email: 'seller@example.com' } },
        seller
      )
    ).toBe(true)
  })

  it('esconde do vendedor a conversa de outro responsável', () => {
    expect(isConversationVisibleForUser({ assigned_to: 'other-seller' }, seller)).toBe(false)
  })

  it('mostra para o admin a mesma conversa, com ou sem responsável', () => {
    expect(isConversationVisibleForUser({ assigned_to: 'seller-1' }, admin)).toBe(true)
    expect(isConversationVisibleForUser({ assigned_to: null }, admin)).toBe(true)
  })
})

describe('normalizeRealtimeAssignedTo', () => {
  it('preserva o e-mail já carregado quando o responsável não muda', () => {
    const previous = { id: 'seller-1', email: 'seller@example.com' }
    expect(normalizeRealtimeAssignedTo('seller-1', previous)).toEqual(previous)
  })

  it('troca o responsável quando o UUID muda', () => {
    const previous = { id: 'seller-1', email: 'seller@example.com' }
    expect(normalizeRealtimeAssignedTo('seller-2', previous)).toEqual({
      id: 'seller-2',
      email: '',
    })
  })
})
