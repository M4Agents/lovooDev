// =============================================================================
// src/services/__tests__/metaWhatsAppApiConversations.test.ts
//
// Contrato dos métodos MVP3C.2 e MVP3D:
//   metaWhatsAppApi.getConversations  — GET /api/whatsapp/meta/conversations
//   metaWhatsAppApi.getMessages       — GET /conversations/:id/messages
//   metaWhatsAppApi.sendMessage       — POST /api/whatsapp/meta/messages/send [MVP3D]
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
// Cobertura — sendMessage (MVP3D):
//   SM-01  POST no endpoint correto
//   SM-02  Authorization reutiliza getAuthHeaders (Bearer token correto)
//   SM-03  payload contém company_id correto
//   SM-04  payload contém instance_id correto
//   SM-05  payload contém conversation_id correto
//   SM-06  payload contém message.type = 'text'
//   SM-07  payload contém message.text.body correto
//   SM-08  payload NÃO contém `to`
//   SM-09  payload NÃO contém wa_id
//   SM-10  sucesso retorna { ok: true, message_id }
//   SM-11  erro backend é propagado como err.message
//   SM-12  conversation_not_found distinguível
//   SM-13  instance_not_connected distinguível
//   SM-14  provider_error distinguível
//   SM-15  send_persistence_failed distinguível (não reenviar)
//   SM-16  resposta malformada não tratada como sucesso
//   SM-17  IDs ausentes rejeitados sem request (validação defensiva)
//   SM-18  body vazio/whitespace rejeitado sem request
//
// Segurança: nenhum token, UUID real ou corpo de mensagem nos fixtures.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { metaWhatsAppApi }                      from '../metaWhatsAppApi'
import type { MetaChatConversation, MetaChatMessage, MetaSendMessageResponse } from '../../types/meta-whatsapp'

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

// Extrai e parseia o body JSON da chamada de fetch
function calledParsedBody(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const init = spy.mock.calls[0][1] as RequestInit
  return JSON.parse(init.body as string) as Record<string, unknown>
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_ID    = 'company-0000-0001'
const INSTANCE_ID   = 'instance-0000-0001'
const CONV_ID       = 'conv-0000-0001'
const FAKE_WAMID    = 'wamid.AAAAABBBBCCCCDDDDEEEEFFFF=='
const FAKE_MSG_BODY = 'Mensagem de teste MVP3D'

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

// =============================================================================
// sendMessage — MVP3D
// =============================================================================

describe('metaWhatsAppApi.sendMessage', () => {

  /** Resposta de sucesso padrão do backend */
  const SUCCESS_RESPONSE: MetaSendMessageResponse = { ok: true, message_id: FAKE_WAMID }

  // SM-01 — endpoint correto
  it('SM-01: faz POST para /api/whatsapp/meta/messages/send', async () => {
    const spy = mockFetch(SUCCESS_RESPONSE)
    await metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    expect(spy.mock.calls[0][0]).toBe('/api/whatsapp/meta/messages/send')
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe('POST')
  })

  // SM-02 — Authorization reutiliza getAuthHeaders
  it('SM-02: Authorization header segue helper de auth existente', async () => {
    const spy = mockFetch(SUCCESS_RESPONSE)
    await metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    expect(calledAuthHeader(spy)).toBe('Bearer fake-access-token-conv')
  })

  // SM-03 — payload company_id
  it('SM-03: payload contém company_id correto', async () => {
    const spy = mockFetch(SUCCESS_RESPONSE)
    await metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    expect(calledParsedBody(spy).company_id).toBe(COMPANY_ID)
  })

  // SM-04 — payload instance_id
  it('SM-04: payload contém instance_id correto', async () => {
    const spy = mockFetch(SUCCESS_RESPONSE)
    await metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    expect(calledParsedBody(spy).instance_id).toBe(INSTANCE_ID)
  })

  // SM-05 — payload conversation_id
  it('SM-05: payload contém conversation_id correto', async () => {
    const spy = mockFetch(SUCCESS_RESPONSE)
    await metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    expect(calledParsedBody(spy).conversation_id).toBe(CONV_ID)
  })

  // SM-06 — message.type
  it('SM-06: payload contém message.type = "text"', async () => {
    const spy = mockFetch(SUCCESS_RESPONSE)
    await metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    const body = calledParsedBody(spy)
    const message = body.message as Record<string, unknown>
    expect(message.type).toBe('text')
  })

  // SM-07 — message.text.body
  it('SM-07: payload contém message.text.body correto', async () => {
    const spy = mockFetch(SUCCESS_RESPONSE)
    await metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    const body = calledParsedBody(spy)
    const message = body.message as Record<string, unknown>
    const text    = message.text as Record<string, unknown>
    expect(text.body).toBe(FAKE_MSG_BODY)
  })

  // SM-08 — payload NÃO contém `to`
  it('SM-08: payload NÃO contém campo `to`', async () => {
    const spy = mockFetch(SUCCESS_RESPONSE)
    await metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    expect(calledParsedBody(spy)).not.toHaveProperty('to')
  })

  // SM-09 — payload NÃO contém wa_id
  it('SM-09: payload NÃO contém campo wa_id', async () => {
    const spy = mockFetch(SUCCESS_RESPONSE)
    await metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    const body = calledParsedBody(spy)
    expect(body).not.toHaveProperty('wa_id')
    // Verificar também dentro de message
    const message = body.message as Record<string, unknown>
    expect(JSON.stringify(message)).not.toContain('wa_id')
  })

  // SM-10 — sucesso retorna MetaSendMessageResponse
  it('SM-10: sucesso retorna { ok: true, message_id }', async () => {
    mockFetch(SUCCESS_RESPONSE)
    const result = await metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    expect(result).toEqual({ ok: true, message_id: FAKE_WAMID })
  })

  // SM-11 — erro backend propagado como err.message
  it('SM-11: erro backend propagado como err.message', async () => {
    mockFetch({ error: 'internal_error' }, 500)
    await expect(
      metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    ).rejects.toThrow('internal_error')
  })

  it('SM-11b: fallback genérico quando body sem campo error', async () => {
    mockFetch({}, 500)
    await expect(
      metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    ).rejects.toThrow('Erro ao enviar mensagem Meta WhatsApp')
  })

  // SM-12 — conversation_not_found distinguível
  it('SM-12: conversation_not_found é distinguível por err.message', async () => {
    mockFetch({ error: 'conversation_not_found' }, 404)
    await expect(
      metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    ).rejects.toThrow('conversation_not_found')
  })

  // SM-13 — instance_not_connected distinguível
  it('SM-13: instance_not_connected é distinguível por err.message', async () => {
    mockFetch({ error: 'instance_not_connected' }, 409)
    await expect(
      metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    ).rejects.toThrow('instance_not_connected')
  })

  // SM-14 — provider_error distinguível
  it('SM-14: provider_error é distinguível por err.message', async () => {
    mockFetch({ error: 'provider_error' }, 502)
    await expect(
      metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    ).rejects.toThrow('provider_error')
  })

  // SM-15 — send_persistence_failed distinguível
  it('SM-15: send_persistence_failed é distinguível por err.message', async () => {
    // ⚠ Mensagem pode já ter sido entregue pela Graph API — NÃO reenviar
    mockFetch({ error: 'send_persistence_failed' }, 500)
    await expect(
      metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    ).rejects.toThrow('send_persistence_failed')
  })

  // SM-16 — resposta malformada não tratada como sucesso
  it('SM-16a: ok ausente → rejeitar (fail-closed)', async () => {
    mockFetch({ message_id: FAKE_WAMID })  // ok ausente
    await expect(
      metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    ).rejects.toThrow('Resposta inválida do servidor')
  })

  it('SM-16b: message_id ausente → rejeitar (fail-closed)', async () => {
    mockFetch({ ok: true })  // message_id ausente
    await expect(
      metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    ).rejects.toThrow('Resposta inválida do servidor')
  })

  it('SM-16c: message_id string vazia → rejeitar', async () => {
    mockFetch({ ok: true, message_id: '' })
    await expect(
      metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    ).rejects.toThrow('Resposta inválida do servidor')
  })

  it('SM-16d: ok = false → rejeitar', async () => {
    mockFetch({ ok: false, message_id: FAKE_WAMID })
    await expect(
      metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    ).rejects.toThrow('Resposta inválida do servidor')
  })

  // SM-17 — IDs ausentes rejeitados sem request (validação defensiva)
  it('SM-17a: companyId vazio → rejeitar sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(
      metaWhatsAppApi.sendMessage('', INSTANCE_ID, CONV_ID, FAKE_MSG_BODY)
    ).rejects.toThrow('company_id é obrigatório')
    expect(spy).not.toHaveBeenCalled()
  })

  it('SM-17b: instanceId vazio → rejeitar sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(
      metaWhatsAppApi.sendMessage(COMPANY_ID, '', CONV_ID, FAKE_MSG_BODY)
    ).rejects.toThrow('instance_id é obrigatório')
    expect(spy).not.toHaveBeenCalled()
  })

  it('SM-17c: conversationId vazio → rejeitar sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(
      metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, '', FAKE_MSG_BODY)
    ).rejects.toThrow('conversation_id é obrigatório')
    expect(spy).not.toHaveBeenCalled()
  })

  // SM-18 — body vazio/whitespace rejeitado sem request
  it('SM-18a: body vazio → rejeitar sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(
      metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, '')
    ).rejects.toThrow('Mensagem não pode estar vazia')
    expect(spy).not.toHaveBeenCalled()
  })

  it('SM-18b: body somente espaços → rejeitar sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(
      metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, '   ')
    ).rejects.toThrow('Mensagem não pode estar vazia')
    expect(spy).not.toHaveBeenCalled()
  })

  it('SM-18c: body com conteúdo → NÃO rejeita (mesmo com espaços ao redor)', async () => {
    // "  texto  " tem conteúdo — não deve ser rejeitado pela validação defensiva
    mockFetch(SUCCESS_RESPONSE)
    const result = await metaWhatsAppApi.sendMessage(COMPANY_ID, INSTANCE_ID, CONV_ID, '  texto  ')
    expect(result.ok).toBe(true)
  })
})
