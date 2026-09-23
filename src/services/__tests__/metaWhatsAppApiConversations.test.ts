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
import type {
  MetaChatConversation,
  MetaChatMessage,
  MetaSendMessageResponse,
  MetaWhatsAppTemplate,
  GetMetaTemplatesResponse,
  MetaSendTemplateResponse,
} from '../../types/meta-whatsapp'

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

// =============================================================================
// listTemplates — MVP4A
//
// Cobertura:
//   LT-01  URL correta
//   LT-02  company_id incluído
//   LT-03  instance_id incluído
//   LT-04  after ausente quando não fornecido
//   LT-05  after URL-encoded quando presente
//   LT-06  auth header Bearer correto
//   LT-07  resposta válida POSITIONAL returned
//   LT-08  resposta válida NAMED returned
//   LT-09  next_cursor null preserved
//   LT-10  next_cursor string preserved
//   LT-11  supported=true preserved
//   LT-12  supported=false preserved
//   LT-13  resposta 2xx malformada (templates não array) → throw fail-closed
//   LT-14  template malformado (id ausente) → throw fail-closed
//   LT-15  parameter malformado (component inválido) → throw fail-closed
//   LT-16  next_cursor inválido → throw fail-closed
//   LT-17  HTTP 401 → erro propagado
//   LT-18  companyId vazio → throw sem fetch
//   LT-19  instanceId vazio → throw sem fetch
//   LT-20  nenhum campo proibido enviado (waba_id, phone_number_id, token, limit, status)
// =============================================================================

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_TEMPLATE_POSITIONAL: MetaWhatsAppTemplate = {
  id:                  'tpl-pos-0001',
  name:                'hello_world',
  language:            'pt_BR',
  status:              'APPROVED',
  category:            'UTILITY',
  parameter_format:    'POSITIONAL',
  header_media_format: null,
  components:          [{ type: 'BODY', text: 'Olá, {1}!' }],
  parameters:          [{ component: 'BODY', key: '1', position: 1, example: 'João' }],
  supported:           true,
  unsupported_reason:  null,
}

const FAKE_TEMPLATE_NAMED: MetaWhatsAppTemplate = {
  id:                  'tpl-named-0002',
  name:                'order_confirmation',
  language:            'pt_BR',
  status:              'APPROVED',
  category:            'UTILITY',
  parameter_format:    'NAMED',
  header_media_format: null,
  components:          [{ type: 'BODY', text: 'Pedido {{order_id}} confirmado.' }],
  parameters:          [{ component: 'BODY', key: 'order_id', position: null, example: '12345' }],
  supported:           true,
  unsupported_reason:  null,
}

const FAKE_TEMPLATE_UNSUPPORTED: MetaWhatsAppTemplate = {
  id:                  'tpl-unsup-0003',
  name:                'promo_image',
  language:            'pt_BR',
  status:              'APPROVED',
  category:            'MARKETING',
  parameter_format:    'NAMED',
  header_media_format: null,
  components:          [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Promoção!' }],
  parameters:          [],
  supported:           false,
  unsupported_reason:  'header_media_not_supported',
}

const LIST_RESPONSE_POSITIONAL: GetMetaTemplatesResponse = {
  templates:   [FAKE_TEMPLATE_POSITIONAL],
  next_cursor: null,
}

const LIST_RESPONSE_PAGED: GetMetaTemplatesResponse = {
  templates:   [FAKE_TEMPLATE_NAMED],
  next_cursor: 'cursor-abc-xyz',
}

describe('metaWhatsAppApi.listTemplates', () => {

  // LT-01 — URL correta
  it('LT-01: URL correta — /api/whatsapp/meta/templates', async () => {
    const spy = mockFetch(LIST_RESPONSE_POSITIONAL)
    await metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID)
    const url = calledUrl(spy)
    expect(url.pathname).toBe('/api/whatsapp/meta/templates')
  })

  // LT-02 — company_id incluído
  it('LT-02: company_id correto na query string', async () => {
    const spy = mockFetch(LIST_RESPONSE_POSITIONAL)
    await metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID)
    const url = calledUrl(spy)
    expect(url.searchParams.get('company_id')).toBe(COMPANY_ID)
  })

  // LT-03 — instance_id incluído
  it('LT-03: instance_id correto na query string', async () => {
    const spy = mockFetch(LIST_RESPONSE_POSITIONAL)
    await metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID)
    const url = calledUrl(spy)
    expect(url.searchParams.get('instance_id')).toBe(INSTANCE_ID)
  })

  // LT-04 — after ausente quando não fornecido
  it('LT-04: after ausente quando options não fornecido', async () => {
    const spy = mockFetch(LIST_RESPONSE_POSITIONAL)
    await metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID)
    const url = calledUrl(spy)
    expect(url.searchParams.has('after')).toBe(false)
  })

  // LT-05 — after URL-encoded quando presente
  it('LT-05: after correto e URL-encoded na query string', async () => {
    const spy = mockFetch(LIST_RESPONSE_PAGED)
    await metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID, { after: 'cursor-abc-xyz==' })
    const url = calledUrl(spy)
    expect(url.searchParams.get('after')).toBe('cursor-abc-xyz==')
  })

  // LT-06 — auth header
  it('LT-06: Authorization header Bearer correto', async () => {
    const spy = mockFetch(LIST_RESPONSE_POSITIONAL)
    await metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID)
    const auth = calledAuthHeader(spy)
    expect(auth).toBe('Bearer fake-access-token-conv')
  })

  // LT-07 — resposta POSITIONAL
  it('LT-07: resposta válida POSITIONAL — retorna template com parameter_format=POSITIONAL', async () => {
    mockFetch(LIST_RESPONSE_POSITIONAL)
    const result = await metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID)
    expect(result.templates).toHaveLength(1)
    expect(result.templates[0].parameter_format).toBe('POSITIONAL')
    expect(result.templates[0].name).toBe('hello_world')
  })

  // LT-08 — resposta NAMED
  it('LT-08: resposta válida NAMED — retorna template com parameter_format=NAMED', async () => {
    mockFetch(LIST_RESPONSE_PAGED)
    const result = await metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID)
    expect(result.templates[0].parameter_format).toBe('NAMED')
  })

  // LT-09 — next_cursor null
  it('LT-09: next_cursor null preservado', async () => {
    mockFetch(LIST_RESPONSE_POSITIONAL)
    const result = await metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID)
    expect(result.next_cursor).toBeNull()
  })

  // LT-10 — next_cursor string
  it('LT-10: next_cursor string preservada', async () => {
    mockFetch(LIST_RESPONSE_PAGED)
    const result = await metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID)
    expect(result.next_cursor).toBe('cursor-abc-xyz')
  })

  // LT-11 — supported true
  it('LT-11: supported=true preservado', async () => {
    mockFetch(LIST_RESPONSE_POSITIONAL)
    const result = await metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID)
    expect(result.templates[0].supported).toBe(true)
    expect(result.templates[0].unsupported_reason).toBeNull()
  })

  // LT-12 — supported false
  it('LT-12: supported=false preservado com unsupported_reason', async () => {
    mockFetch({ templates: [FAKE_TEMPLATE_UNSUPPORTED], next_cursor: null })
    const result = await metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID)
    expect(result.templates[0].supported).toBe(false)
    expect(result.templates[0].unsupported_reason).toBe('header_media_not_supported')
  })

  // LT-13 — resposta 2xx malformada (templates não array) → throw
  it('LT-13: resposta 2xx com templates não-array → throw fail-closed', async () => {
    mockFetch({ templates: 'invalid', next_cursor: null })
    await expect(metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  // LT-14 — template malformado (id ausente)
  it('LT-14: template com id ausente → throw fail-closed', async () => {
    const bad = { ...FAKE_TEMPLATE_POSITIONAL, id: '' }
    mockFetch({ templates: [bad], next_cursor: null })
    await expect(metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  // LT-15 — parameter malformado (component inválido)
  it('LT-15: parameter com component inválido → throw fail-closed', async () => {
    const badParam = { component: 'FOOTER', key: 'name', position: null, example: null }
    const badTemplate = { ...FAKE_TEMPLATE_POSITIONAL, parameters: [badParam] }
    mockFetch({ templates: [badTemplate], next_cursor: null })
    await expect(metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  // LT-16 — next_cursor inválido
  it('LT-16: next_cursor inválido (number) → throw fail-closed', async () => {
    mockFetch({ templates: [], next_cursor: 42 })
    await expect(metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  // LT-17 — HTTP 401
  it('LT-17: HTTP 401 → erro propagado sem throw genérico', async () => {
    mockFetch({ error: 'unauthorized' }, 401)
    await expect(metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID))
      .rejects.toThrow('unauthorized')
  })

  // LT-18 — companyId vazio
  it('LT-18: companyId vazio → throw sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(metaWhatsAppApi.listTemplates('', INSTANCE_ID))
      .rejects.toThrow('company_id é obrigatório')
    expect(spy).not.toHaveBeenCalled()
  })

  // LT-19 — instanceId vazio
  it('LT-19: instanceId vazio → throw sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(metaWhatsAppApi.listTemplates(COMPANY_ID, ''))
      .rejects.toThrow('instance_id é obrigatório')
    expect(spy).not.toHaveBeenCalled()
  })

  // LT-20 — nenhum campo proibido
  it('LT-20: nenhum campo proibido na URL (waba_id, phone_number_id, token, limit, status, name)', async () => {
    const spy = mockFetch(LIST_RESPONSE_POSITIONAL)
    await metaWhatsAppApi.listTemplates(COMPANY_ID, INSTANCE_ID)
    const url = calledUrl(spy)
    expect(url.searchParams.has('waba_id')).toBe(false)
    expect(url.searchParams.has('phone_number_id')).toBe(false)
    expect(url.searchParams.has('token')).toBe(false)
    expect(url.searchParams.has('limit')).toBe(false)
    expect(url.searchParams.has('status')).toBe(false)
    expect(url.searchParams.has('name')).toBe(false)
  })
})

// =============================================================================
// sendTemplate — MVP4A
//
// Cobertura:
//   ST-01  endpoint correto
//   ST-02  método POST
//   ST-03  auth header Bearer correto
//   ST-04  payload exato com body params
//   ST-05  payload com header + body params
//   ST-06  templateName preservado no payload
//   ST-07  templateLanguage preservado no payload
//   ST-08  campos proibidos ausentes do payload
//   ST-09  companyId vazio → throw sem fetch
//   ST-10  instanceId vazio → throw sem fetch
//   ST-11  conversationId vazio → throw sem fetch
//   ST-12  templateName vazio/whitespace → throw sem fetch
//   ST-13  templateLanguage vazio/whitespace → throw sem fetch
//   ST-14  parameterValues null → throw sem fetch
//   ST-15  parameterValues array → throw sem fetch
//   ST-16  parameterValues.body null → throw sem fetch
//   ST-17  parameterValues.body array → throw sem fetch
//   ST-18  parameterValues.header array → throw sem fetch
//   ST-19  resposta válida retornada
//   ST-20  ok != true em resposta 2xx → throw fail-closed
//   ST-21  message_id ausente em resposta 2xx → throw fail-closed
//   ST-22  message_id vazia em resposta 2xx → throw fail-closed
//   ST-23  HTTP 400 com error code → propagado (template_not_found)
//   ST-24  HTTP 422 com error code → propagado (template_params_mismatch)
//   ST-25  HTTP 503 com error code → propagado (provider_unavailable)
// =============================================================================

const TMPL_NAME     = 'hello_world'
const TMPL_LANG     = 'pt_BR'
const TMPL_PARAMS_BODY_ONLY = { body: { '1': 'João' } }
const TMPL_PARAMS_HEADER_BODY = { header: { '1': 'Banner' }, body: { '1': 'João' } }
const SEND_TMPL_SUCCESS: MetaSendTemplateResponse = { ok: true, message_id: 'wamid.TMPL001' }

describe('metaWhatsAppApi.sendTemplate', () => {

  // ST-01 — endpoint correto
  it('ST-01: endpoint correto — /api/whatsapp/meta/messages/send-template', async () => {
    const spy = mockFetch(SEND_TMPL_SUCCESS)
    await metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, TMPL_PARAMS_BODY_ONLY)
    const url = calledUrl(spy)
    expect(url.pathname).toBe('/api/whatsapp/meta/messages/send-template')
  })

  // ST-02 — método POST
  it('ST-02: método HTTP é POST', async () => {
    const spy = mockFetch(SEND_TMPL_SUCCESS)
    await metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, TMPL_PARAMS_BODY_ONLY)
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
  })

  // ST-03 — auth header
  it('ST-03: Authorization header Bearer correto', async () => {
    const spy = mockFetch(SEND_TMPL_SUCCESS)
    await metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, TMPL_PARAMS_BODY_ONLY)
    expect(calledAuthHeader(spy)).toBe('Bearer fake-access-token-conv')
  })

  // ST-04 — payload exato com body params
  it('ST-04: payload contém campos exatos com body params', async () => {
    const spy = mockFetch(SEND_TMPL_SUCCESS)
    await metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, TMPL_PARAMS_BODY_ONLY)
    const body = calledParsedBody(spy)
    expect(body.company_id).toBe(COMPANY_ID)
    expect(body.instance_id).toBe(INSTANCE_ID)
    expect(body.conversation_id).toBe(CONV_ID)
    expect(body.template_name).toBe(TMPL_NAME)
    expect(body.template_language).toBe(TMPL_LANG)
    expect(body.parameter_values).toEqual(TMPL_PARAMS_BODY_ONLY)
  })

  // ST-05 — payload com header + body
  it('ST-05: payload parameter_values com header + body', async () => {
    const spy = mockFetch(SEND_TMPL_SUCCESS)
    await metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, TMPL_PARAMS_HEADER_BODY)
    const body = calledParsedBody(spy)
    expect(body.parameter_values).toEqual(TMPL_PARAMS_HEADER_BODY)
  })

  // ST-06 — templateName preservado
  it('ST-06: templateName preservado no payload', async () => {
    const spy = mockFetch(SEND_TMPL_SUCCESS)
    await metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, 'my_template', TMPL_LANG, TMPL_PARAMS_BODY_ONLY)
    const body = calledParsedBody(spy)
    expect(body.template_name).toBe('my_template')
  })

  // ST-07 — templateLanguage preservado
  it('ST-07: templateLanguage preservado no payload', async () => {
    const spy = mockFetch(SEND_TMPL_SUCCESS)
    await metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, 'en_US', TMPL_PARAMS_BODY_ONLY)
    const body = calledParsedBody(spy)
    expect(body.template_language).toBe('en_US')
  })

  // ST-08 — campos proibidos ausentes
  it('ST-08: campos proibidos ausentes do payload', async () => {
    const spy = mockFetch(SEND_TMPL_SUCCESS)
    await metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, TMPL_PARAMS_BODY_ONLY)
    const body = calledParsedBody(spy)
    expect(body).not.toHaveProperty('to')
    expect(body).not.toHaveProperty('wa_id')
    expect(body).not.toHaveProperty('waba_id')
    expect(body).not.toHaveProperty('phone_number_id')
    expect(body).not.toHaveProperty('token')
    expect(body).not.toHaveProperty('access_token')
    expect(body).not.toHaveProperty('components')
    expect(body).not.toHaveProperty('status')
    expect(body).not.toHaveProperty('category')
    expect(body).not.toHaveProperty('parameter_format')
  })

  // ST-09 — companyId vazio
  it('ST-09: companyId vazio → throw sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(metaWhatsAppApi.sendTemplate('', INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, TMPL_PARAMS_BODY_ONLY))
      .rejects.toThrow('company_id é obrigatório')
    expect(spy).not.toHaveBeenCalled()
  })

  // ST-10 — instanceId vazio
  it('ST-10: instanceId vazio → throw sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(metaWhatsAppApi.sendTemplate(COMPANY_ID, '', CONV_ID, TMPL_NAME, TMPL_LANG, TMPL_PARAMS_BODY_ONLY))
      .rejects.toThrow('instance_id é obrigatório')
    expect(spy).not.toHaveBeenCalled()
  })

  // ST-11 — conversationId vazio
  it('ST-11: conversationId vazio → throw sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, '', TMPL_NAME, TMPL_LANG, TMPL_PARAMS_BODY_ONLY))
      .rejects.toThrow('conversation_id é obrigatório')
    expect(spy).not.toHaveBeenCalled()
  })

  // ST-12 — templateName whitespace
  it('ST-12: templateName somente espaços → throw sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, '   ', TMPL_LANG, TMPL_PARAMS_BODY_ONLY))
      .rejects.toThrow('template_name é obrigatório')
    expect(spy).not.toHaveBeenCalled()
  })

  // ST-13 — templateLanguage whitespace
  it('ST-13: templateLanguage somente espaços → throw sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, '  ', TMPL_PARAMS_BODY_ONLY))
      .rejects.toThrow('template_language é obrigatório')
    expect(spy).not.toHaveBeenCalled()
  })

  // ST-14 — parameterValues null
  it('ST-14: parameterValues null → throw sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, null as never))
      .rejects.toThrow('parameter_values inválido')
    expect(spy).not.toHaveBeenCalled()
  })

  // ST-15 — parameterValues array
  it('ST-15: parameterValues array → throw sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, [] as never))
      .rejects.toThrow('parameter_values inválido')
    expect(spy).not.toHaveBeenCalled()
  })

  // ST-16 — body null
  it('ST-16: parameterValues.body null → throw sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, { body: null as never }))
      .rejects.toThrow('parameter_values.body inválido')
    expect(spy).not.toHaveBeenCalled()
  })

  // ST-17 — body array
  it('ST-17: parameterValues.body array → throw sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, { body: [] as never }))
      .rejects.toThrow('parameter_values.body inválido')
    expect(spy).not.toHaveBeenCalled()
  })

  // ST-18 — header array
  it('ST-18: parameterValues.header array → throw sem fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(metaWhatsAppApi.sendTemplate(
      COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG,
      { header: [] as never, body: { '1': 'value' } }
    )).rejects.toThrow('parameter_values.header inválido')
    expect(spy).not.toHaveBeenCalled()
  })

  // ST-19 — resposta válida
  it('ST-19: resposta válida retornada como MetaSendTemplateResponse', async () => {
    mockFetch(SEND_TMPL_SUCCESS)
    const result = await metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, TMPL_PARAMS_BODY_ONLY)
    expect(result.ok).toBe(true)
    expect(result.message_id).toBe('wamid.TMPL001')
  })

  // ST-20 — ok != true em resposta 2xx
  it('ST-20: resposta 2xx com ok=false → throw fail-closed', async () => {
    mockFetch({ ok: false, message_id: 'wamid.TMPL001' })
    await expect(metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, TMPL_PARAMS_BODY_ONLY))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  // ST-21 — message_id ausente
  it('ST-21: resposta 2xx sem message_id → throw fail-closed', async () => {
    mockFetch({ ok: true })
    await expect(metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, TMPL_PARAMS_BODY_ONLY))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  // ST-22 — message_id vazia
  it('ST-22: resposta 2xx com message_id vazio → throw fail-closed', async () => {
    mockFetch({ ok: true, message_id: '' })
    await expect(metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, TMPL_PARAMS_BODY_ONLY))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  // ST-23 — template_not_found propagado
  it('ST-23: HTTP 400 com error=template_not_found → propagado', async () => {
    mockFetch({ error: 'template_not_found' }, 400)
    await expect(metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, TMPL_PARAMS_BODY_ONLY))
      .rejects.toThrow('template_not_found')
  })

  // ST-24 — template_params_mismatch propagado
  it('ST-24: HTTP 422 com error=template_params_mismatch → propagado', async () => {
    mockFetch({ error: 'template_params_mismatch' }, 422)
    await expect(metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, TMPL_PARAMS_BODY_ONLY))
      .rejects.toThrow('template_params_mismatch')
  })

  // ST-25 — provider_unavailable propagado
  it('ST-25: HTTP 503 com error=provider_unavailable → propagado', async () => {
    mockFetch({ error: 'provider_unavailable' }, 503)
    await expect(metaWhatsAppApi.sendTemplate(COMPANY_ID, INSTANCE_ID, CONV_ID, TMPL_NAME, TMPL_LANG, TMPL_PARAMS_BODY_ONLY))
      .rejects.toThrow('provider_unavailable')
  })
})
