import { describe, expect, it } from 'vitest'
import { displayedCustomerServiceWindow } from '../customerServiceWindow'

describe('displayedCustomerServiceWindow', () => {
  const now = Date.parse('2026-11-23T12:00:00.000Z')

  it('mantém aberta antes do prazo', () => {
    expect(displayedCustomerServiceWindow({
      state: 'open',
      expiresAt: '2026-11-23T12:00:01.000Z',
    }, now)).toEqual({
      state: 'open',
      expiresAt: '2026-11-23T12:00:01.000Z',
    })
  })

  it('fecha quando o prazo chega', () => {
    expect(displayedCustomerServiceWindow({
      state: 'open',
      expiresAt: '2026-11-23T12:00:00.000Z',
    }, now)).toEqual({ state: 'closed', expiresAt: null })
  })

  it('preserva fechada e desconhecida', () => {
    expect(displayedCustomerServiceWindow({ state: 'closed', expiresAt: null }, now).state).toBe('closed')
    expect(displayedCustomerServiceWindow({ state: 'unknown', expiresAt: null }, now).state).toBe('unknown')
    expect(displayedCustomerServiceWindow(undefined, now).state).toBe('unknown')
  })
})
