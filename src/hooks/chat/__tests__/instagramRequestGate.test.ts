import { describe, expect, it } from 'vitest'
import {
  instagramMessageEventApplies,
  instagramPageMayAutoLoad,
  instagramSubscriptionEventApplies,
  nextInstagramQueryContext,
  sameInstagramMessageContext,
  sameInstagramQueryContext,
  type InstagramMessageContext,
  type InstagramQueryContext,
} from '../instagramRequestGate'

const COMPANY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const COMPANY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OFFICIAL = 'official:11111111-1111-4111-8111-111111111111'
const BYO = 'byo:22222222-2222-4222-8222-222222222222'

function query(overrides: Partial<InstagramQueryContext> = {}): InstagramQueryContext {
  return {
    generation: 1,
    companyId: COMPANY_A,
    owner: 'all',
    filterType: 'all',
    search: '',
    ...overrides,
  }
}

function message(overrides: Partial<InstagramMessageContext> = {}): InstagramMessageContext {
  return {
    generation: 1,
    companyId: COMPANY_A,
    conversationId: 'conv-a',
    ...overrides,
  }
}

describe('sameInstagramQueryContext', () => {
  it('aceita a resposta da geração e do contexto atuais', () => {
    const current = query({ owner: OFFICIAL })
    expect(sameInstagramQueryContext(current, current)).toBe(true)
  })

  it('descarta a empresa A quando a empresa B já é a atual', () => {
    expect(sameInstagramQueryContext(
      query({ companyId: COMPANY_A }),
      query({ companyId: COMPANY_B, generation: 2 }),
    )).toBe(false)
  })

  it('descarta a conta oficial quando a seleção já é BYO', () => {
    expect(sameInstagramQueryContext(
      query({ owner: OFFICIAL }),
      query({ owner: BYO, generation: 2 }),
    )).toBe(false)
  })

  it('descarta Todas quando a seleção já é BYO', () => {
    expect(sameInstagramQueryContext(
      query({ owner: 'all' }),
      query({ owner: BYO, generation: 2 }),
    )).toBe(false)
  })

  it('descarta o filtro anterior e a geração do refresh', () => {
    expect(sameInstagramQueryContext(
      query({ filterType: 'all' }),
      query({ filterType: 'unread', generation: 2 }),
    )).toBe(false)
    expect(sameInstagramQueryContext(
      query({ generation: 4 }),
      query({ generation: 5 }),
    )).toBe(false)
  })
})

describe('nextInstagramQueryContext', () => {
  it('incrementa a geração quando empresa, conta ou filtro mudam', () => {
    const current = query()
    expect(nextInstagramQueryContext(current, { ...current, companyId: COMPANY_B }).generation).toBe(2)
    expect(nextInstagramQueryContext(current, { ...current, owner: BYO }).owner).toBe(BYO)
    expect(nextInstagramQueryContext(current, { ...current, filterType: 'unread' }).filterType).toBe('unread')
    expect(nextInstagramQueryContext(current, current)).toBe(current)
  })
})

describe('sameInstagramMessageContext', () => {
  it('descarta mensagens, enriquecimento, envio e reação da empresa anterior', () => {
    const captured = message()
    const current = message({ generation: 2, companyId: COMPANY_B, conversationId: '' })
    expect(sameInstagramMessageContext(captured, current)).toBe(false)
    expect(sameInstagramMessageContext(captured, captured)).toBe(true)
  })
})

describe('instagramSubscriptionEventApplies', () => {
  const officialEvent = {
    company_id: COMPANY_A,
    connection_id: '11111111-1111-4111-8111-111111111111',
    byo_account_id: null,
    status: 'active',
    participant_name: 'Ana',
  }
  const byoEvent = {
    company_id: COMPANY_A,
    connection_id: null,
    byo_account_id: '22222222-2222-4222-8222-222222222222',
    status: 'active',
    participant_name: 'BYO',
  }

  it('rejeita assinatura antiga mesmo quando o payload combina com o contexto novo', () => {
    const subscribed = query({ generation: 1, owner: OFFICIAL })
    const current = query({ generation: 2, owner: BYO })
    expect(instagramSubscriptionEventApplies(subscribed, current, byoEvent)).toBe(false)
    expect(instagramSubscriptionEventApplies(
      query({ generation: 1, owner: BYO }),
      query({ generation: 2, owner: 'all' }),
      byoEvent,
    )).toBe(false)
    expect(instagramSubscriptionEventApplies(
      query({ generation: 1, companyId: COMPANY_A }),
      query({ generation: 2, companyId: COMPANY_B }),
      { ...officialEvent, company_id: COMPANY_B },
    )).toBe(false)
  })

  it('rejeita evento de outra empresa e aceita oficial ou BYO da assinatura atual', () => {
    const official = query({ owner: OFFICIAL })
    const byo = query({ owner: BYO })
    expect(instagramSubscriptionEventApplies(official, official, { ...officialEvent, company_id: COMPANY_B })).toBe(false)
    expect(instagramSubscriptionEventApplies(official, official, officialEvent)).toBe(true)
    expect(instagramSubscriptionEventApplies(byo, byo, byoEvent)).toBe(true)
  })
})

describe('instagramMessageEventApplies', () => {
  function thread(overrides: Partial<InstagramMessageContext> = {}): InstagramMessageContext {
    return {
      generation: 1,
      companyId: COMPANY_A,
      conversationId: 'conv-a',
      ...overrides,
    }
  }

  it('rejeita geração antiga mesmo quando o payload combina com a conversa nova', () => {
    expect(instagramMessageEventApplies(
      thread({ generation: 1, conversationId: 'conv-a' }),
      thread({ generation: 2, companyId: COMPANY_B, conversationId: 'conv-b' }),
      { company_id: COMPANY_B, conversation_id: 'conv-b' },
    )).toBe(false)
  })

  it('aceita a empresa e a conversa da assinatura atual', () => {
    const current = thread()
    expect(instagramMessageEventApplies(current, current, {
      company_id: COMPANY_A,
      conversation_id: 'conv-a',
    })).toBe(true)
  })
})

describe('instagramPageMayAutoLoad', () => {
  it('não dispara sozinho depois do erro e volta a permitir depois da recuperação', () => {
    expect(instagramPageMayAutoLoad({
      pageError: true,
      hasMore: true,
      loading: false,
      intersecting: true,
    })).toBe(false)
    expect(instagramPageMayAutoLoad({
      pageError: false,
      hasMore: true,
      loading: false,
      intersecting: true,
    })).toBe(true)
    expect(instagramPageMayAutoLoad({
      pageError: false,
      hasMore: true,
      loading: true,
      intersecting: true,
    })).toBe(false)
  })
})
