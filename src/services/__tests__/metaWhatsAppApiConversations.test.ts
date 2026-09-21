// =============================================================================
// src/services/__tests__/metaWhatsAppApiConversations.test.ts
//
// Contrato dos novos métodos MVP3C.2:
//   metaWhatsAppApi.getConversations  — GET /api/whatsapp/meta/conversations
//   metaWhatsAppApi.getMessages       — GET /conversations/:id/messages
//
// Cobertura — getConversations:
//   GC-01  happy path com conversations retornadas
//   GC-02  lista vazia — array vazio sem erro
//   GC-03  company_id incluído na URL
//   GC-04  instance_id incluído se fornecido
//   GC-05  instance_id ausente quando undefined
//   GC-06  filter incluído se fornecido
//   GC-07  filter ausente quando undefined
//   GC-08  limit incluído se fornecido
//   GC-09  limit ausente quando undefined
//   GC-10  Bearer correto via helper de auth
//   GC-11  HTTP 401 → rejeitar com erro do backend
//   GC-12  HTTP 403 → rejeitar com erro do backend
//   GC-13  HTTP 500 → fallback de mensagem genérica
//   GC-14  campo conversations ausente na resposta → array vazio
//
// Cobertura — getMessages:
//   GM-01  happy path com messages retornadas
//   GM-02  lista vazia — array vazio sem erro
//   GM-03  conversationId encodado no path
//   GM-04  company_id incluído na query string
//   GM-05  limit incluído se fornecido
//   GM-06  limit ausente quando undefined
//   GM-07  Bearer correto via helper de auth
//   GM-08  HTTP 401 → rejeitar com erro do backend
//   GM-09  HTTP 404 → rejeitar com erro do backend
//   GM-10  campo messages ausente na resposta → array vazio
//
// Segurança: nenhum token, UUID real ou corpo de mensagem nos fixtures.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { metaWhatsAppApi }                      from '../metaWhatsAppApi'
import type { MetaChatConversation, MetaChatMessage } from '../../types/meta-whatsapp'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'fake-access-token-conv' } },
      }),
    },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok:     status >= 200 && status < 300,
    status,
    json:   () => Promise.resolve(body),
  } as Response)
}

// Extrai URL da chamada de fetch
function calledUrl(spy: ReturnType<typeof vi.spyOn>): URL {
  const raw = (spy.mock.calls[0][0] as string)
  // fetch recebe URL relativa — adicionamos base fictícia para parse
  return new URL(raw, 'http://localhost')
}

// Extrai Authorization header da chamada de fetch
function calledAuthHeader(spy: ReturnType<typeof vi.spyOn>): string {
  const init = spy.mock.calls[0][1] as RequestInit
  return (init.headers as Record<string, string>)['Authorization']
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_ID    = 'company-0000-0001'
const INSTANCE_ID   = 'instance-0000-0001'
const CONV_ID       = 'conv-0000-0001'

const FAKE_CONVERSATION: MetaChatConversation = {
  id:                   CONV_ID,
  instance_id:          INSTANCE_ID,
  wa_id:                '5500000000001',
  contact_name:         'Contato Teste',
  status:               'active',
  unread_count:         2,
  last_message_at:      '2026-09-21T12:00:00.000Z',
  last_message_preview: 'Olá',
  created_at:           '2026-09-20T10:00:00.000Z',
  updated_at:           '2026-09-21T12:00:00.000Z',
}

const FAKE_MESSAGE: MetaChatMessage = {
  id:                 'msg-0000-0001',
  conversation_id:    CONV_ID,
  instance_id:        INSTANCE_ID,
  direction:          'inbound',
  message_type:       'text',
  body:               '[omitido nos testes]',
  provider_timestamp: '2026-09-21T12:00:00.000Z',
  created_at:         '2026-09-21T12:00:00.001Z',
}

// =============================================================================
// getConversations
// =============================================================================

describe('metaWhatsAppApi.getConversations', () => {

  // GC-01 — happy path
  it('GC-01: retorna array de conversas', async () => {
    mockFetch({ conversations: [FAKE_CONVERSATION] })
    const result = await metaWhatsAppApi.getConversations(COMPANY_ID)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(CONV_ID)
    expect(result[0].status).toBe('active')
  })

  // GC-02 — lista vazia
  it('GC-02: conversations vazia → array vazio sem erro', async () => {
    mockFetch({ conversations: [] })
    const result = await metaWhatsAppApi.getConversations(COMPANY_ID)
    expect(result).toEqual([])
  })

  // GC-03 — company_id na URL
  it('GC-03: company_id incluído na query string', async () => {
    const spy = mockFetch({ conversations: [] })
    await metaWhatsAppApi.getConversations(COMPANY_ID)
    const url = calledUrl(spy)
    expect(url.searchParams.get('company_id')).toBe(COMPANY_ID)
  })

  // GC-04 — instance_id incluído
  it('GC-04: instance_id incluído na URL quando fornecido', async () => {
    const spy = mockFetch({ conversations: [] })
    await metaWhatsAppApi.getConversations(COMPANY_ID, { instanceId: INSTANCE_ID })
    const url = calledUrl(spy)
    expect(url.searchParams.get('instance_id')).toBe(INSTANCE_ID)
  })

  // GC-05 — instance_id ausente
  it('GC-05: instance_id NÃO aparece na URL quando undefined', async () => {
    const spy = mockFetch({ conversations: [] })
    await metaWhatsAppApi.getConversations(COMPANY_ID)
    const url = calledUrl(spy)
    expect(url.searchParams.has('instance_id')).toBe(false)
  })

  // GC-06 — filter incluído
  it('GC-06: filter incluído na URL quando fornecido', async () => {
    const spy = mockFetch({ conversations: [] })
    await metaWhatsAppApi.getConversations(COMPANY_ID, { filter: 'unread' })
    const url = calledUrl(spy)
    expect(url.searchParams.get('filter')).toBe('unread')
  })

  // GC-07 — filter ausente
  it('GC-07: filter NÃO aparece na URL quando undefined', async () => {
    const spy = mockFetch({ conversations: [] })
    await metaWhatsAppApi.getConversations(COMPANY_ID)
    const url = calledUrl(spy)
    expect(url.searchParams.has('filter')).toBe(false)
  })

  // GC-08 — limit incluído
  it('GC-08: limit incluído na URL quando fornecido', async () => {
    const spy = mockFetch({ conversations: [] })
    await metaWhatsAppApi.getConversations(COMPANY_ID, { limit: 20 })
    const url = calledUrl(spy)
    expect(url.searchParams.get('limit')).toBe('20')
  })

  // GC-09 — limit ausente
  it('GC-09: limit NÃO aparece na URL quando undefined', async () => {
    const spy = mockFetch({ conversations: [] })
    await metaWhatsAppApi.getConversations(COMPANY_ID)
    const url = calledUrl(spy)
    expect(url.searchParams.has('limit')).toBe(false)
  })

  // GC-10 — Bearer via helper
  it('GC-10: Authorization header segue helper de auth existente', async () => {
    const spy = mockFetch({ conversations: [] })
    await metaWhatsAppApi.getConversations(COMPANY_ID)
    expect(calledAuthHeader(spy)).toBe('Bearer fake-access-token-conv')
  })

  // GC-11 — HTTP 401
  it('GC-11: HTTP 401 → rejeitar com erro do backend', async () => {
    mockFetch({ error: 'unauthorized' }, 401)
    await expect(metaWhatsAppApi.getConversations(COMPANY_ID))
      .rejects.toThrow('unauthorized')
  })

  // GC-12 — HTTP 403
  it('GC-12: HTTP 403 → rejeitar com erro do backend', async () => {
    mockFetch({ error: 'feature_disabled' }, 403)
    await expect(metaWhatsAppApi.getConversations(COMPANY_ID))
      .rejects.toThrow('feature_disabled')
  })

  // GC-13 — HTTP 500 sem body de erro
  it('GC-13: HTTP 500 sem campo error → fallback genérico', async () => {
    mockFetch({}, 500)
    await expect(metaWhatsAppApi.getConversations(COMPANY_ID))
      .rejects.toThrow('Erro ao carregar conversas Meta WhatsApp')
  })

  // GC-14 — campo conversations ausente
  it('GC-14: campo conversations ausente na resposta → array vazio', async () => {
    mockFetch({})
    const result = await metaWhatsAppApi.getConversations(COMPANY_ID)
    expect(result).toEqual([])
  })
})

// =============================================================================
// getMessages
// =============================================================================

describe('metaWhatsAppApi.getMessages', () => {

  // GM-01 — happy path
  it('GM-01: retorna array de mensagens', async () => {
    mockFetch({ messages: [FAKE_MESSAGE] })
    const result = await metaWhatsAppApi.getMessages(COMPANY_ID, CONV_ID)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('msg-0000-0001')
    expect(result[0].direction).toBe('inbound')
    expect(result[0].message_type).toBe('text')
  })

  // GM-02 — lista vazia
  it('GM-02: messages vazia → array vazio sem erro', async () => {
    mockFetch({ messages: [] })
    const result = await metaWhatsAppApi.getMessages(COMPANY_ID, CONV_ID)
    expect(result).toEqual([])
  })

  // GM-03 — conversationId no path
  it('GM-03: conversationId aparece encodado no path; caracteres especiais não passam literais', async () => {
    // ID com caracteres que precisam de encoding
    const convIdEspecial = 'conv with spaces & chars'
    const spy = mockFetch({ messages: [] })
    await metaWhatsAppApi.getMessages(COMPANY_ID, convIdEspecial)
    const rawUrl = spy.mock.calls[0][0] as string
    // ID encodado deve aparecer na URL
    expect(rawUrl).toContain(encodeURIComponent(convIdEspecial))
    // ID literal (sem encoding) NÃO deve aparecer na URL
    expect(rawUrl).not.toContain(convIdEspecial)
  })

  // GM-04 — company_id na query string
  it('GM-04: company_id incluído na query string', async () => {
    const spy = mockFetch({ messages: [] })
    await metaWhatsAppApi.getMessages(COMPANY_ID, CONV_ID)
    const url = calledUrl(spy)
    expect(url.searchParams.get('company_id')).toBe(COMPANY_ID)
  })

  // GM-05 — limit incluído
  it('GM-05: limit incluído na URL quando fornecido', async () => {
    const spy = mockFetch({ messages: [] })
    await metaWhatsAppApi.getMessages(COMPANY_ID, CONV_ID, { limit: 50 })
    const url = calledUrl(spy)
    expect(url.searchParams.get('limit')).toBe('50')
  })

  // GM-06 — limit ausente
  it('GM-06: limit NÃO aparece na URL quando undefined', async () => {
    const spy = mockFetch({ messages: [] })
    await metaWhatsAppApi.getMessages(COMPANY_ID, CONV_ID)
    const url = calledUrl(spy)
    expect(url.searchParams.has('limit')).toBe(false)
  })

  // GM-07 — Bearer via helper
  it('GM-07: Authorization header segue helper de auth existente', async () => {
    const spy = mockFetch({ messages: [] })
    await metaWhatsAppApi.getMessages(COMPANY_ID, CONV_ID)
    expect(calledAuthHeader(spy)).toBe('Bearer fake-access-token-conv')
  })

  // GM-08 — HTTP 401
  it('GM-08: HTTP 401 → rejeitar com erro do backend', async () => {
    mockFetch({ error: 'unauthorized' }, 401)
    await expect(metaWhatsAppApi.getMessages(COMPANY_ID, CONV_ID))
      .rejects.toThrow('unauthorized')
  })

  // GM-09 — HTTP 404
  it('GM-09: HTTP 404 → rejeitar com erro do backend', async () => {
    mockFetch({ error: 'not_found' }, 404)
    await expect(metaWhatsAppApi.getMessages(COMPANY_ID, CONV_ID))
      .rejects.toThrow('not_found')
  })

  // GM-10 — campo messages ausente
  it('GM-10: campo messages ausente na resposta → array vazio', async () => {
    mockFetch({})
    const result = await metaWhatsAppApi.getMessages(COMPANY_ID, CONV_ID)
    expect(result).toEqual([])
  })
})
