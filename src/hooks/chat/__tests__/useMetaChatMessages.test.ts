// @vitest-environment jsdom
// =============================================================================
// src/hooks/chat/__tests__/useMetaChatMessages.test.ts
//
// Contrato do hook useMetaChatMessages — MVP3C.4
//
// Cobertura:
//   M-01  companyId + conversationId válidos → chama getMessages corretamente
//   M-02  resultado bem-sucedido → messages preenchidas, loading=false, error=null
//   M-03  loading=true durante fetch, false ao concluir
//   M-04  conversationId null → zero request + estado vazio
//   M-05  conversationId undefined → zero request + estado vazio
//   M-06  companyId undefined → zero request + estado vazio
//   M-07  erro da API (Error) → error preenchido, messages=[], loading=false
//   M-08  troca de conversa A→B → B vence mesmo se A resolver depois
//   M-09  troca A→null enquanto A pendente → estado limpa; A ignorado ao resolver
//   M-10  troca de company A→B → limpa mensagens; busca nova; antiga ignorada
//   M-11  refresh() → novo getMessages com os mesmos IDs
//   M-12  refresh anterior resolve depois de refresh novo → novo vence
//   M-13  unmount durante request → resposta posterior não produz warning/state update
//   M-14  rejeição não-Error → fallback de erro estável
//
// Sem Realtime, Supabase direto, EventBus ou envio.
// Segurança: nenhum token ou UUID real nos fixtures.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act }                       from '@testing-library/react'
import { useMetaChatMessages }                   from '../useMetaChatMessages'
import type { MetaChatMessage }                  from '../../../types/meta-whatsapp'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../services/metaWhatsAppApi', () => ({
  metaWhatsAppApi: {
    getMessages: vi.fn(),
  },
}))

import { metaWhatsAppApi } from '../../../services/metaWhatsAppApi'

const mockGetMessages = metaWhatsAppApi.getMessages as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_A = 'company-aaaa-0001'
const COMPANY_B = 'company-bbbb-0002'
const CONV_A    = 'conv-aaaa-0001'
const CONV_B    = 'conv-bbbb-0002'

function makeMsg(id: string, direction: 'inbound' | 'outbound' = 'inbound'): MetaChatMessage {
  return {
    id,
    conversation_id:    CONV_A,
    instance_id:        'inst-0001',
    direction,
    message_type:       'text',
    body:               `corpo da mensagem ${id}`,
    provider_timestamp: '2026-09-21T12:00:00.000Z',
    created_at:         '2026-09-21T12:00:00.000Z',
  }
}

const MSG_A1 = makeMsg('msg-a-001', 'inbound')
const MSG_A2 = makeMsg('msg-a-002', 'outbound')

// ── Testes ────────────────────────────────────────────────────────────────────

// M-01 — chama getMessages com os IDs corretos
it('M-01: companyId + conversationId válidos → chama getMessages corretamente', async () => {
  mockGetMessages.mockResolvedValueOnce([])

  renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))

  await act(async () => { await Promise.resolve() })

  expect(mockGetMessages).toHaveBeenCalledTimes(1)
  expect(mockGetMessages).toHaveBeenCalledWith(COMPANY_A, CONV_A)
})

// M-02 — resultado bem-sucedido
it('M-02: success → messages preenchidas, loading=false, error=null', async () => {
  mockGetMessages.mockResolvedValueOnce([MSG_A1, MSG_A2])

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))

  await act(async () => { await Promise.resolve() })

  expect(result.current.messages).toHaveLength(2)
  expect(result.current.messages[0].id).toBe('msg-a-001')
  expect(result.current.messages[1].id).toBe('msg-a-002')
  expect(result.current.loading).toBe(false)
  expect(result.current.error).toBeNull()
})

// M-03 — loading durante fetch
it('M-03: loading=true enquanto fetch está em andamento, false ao concluir', async () => {
  let resolveFetch!: (v: MetaChatMessage[]) => void
  const pending = new Promise<MetaChatMessage[]>(res => { resolveFetch = res })
  mockGetMessages.mockReturnValueOnce(pending)

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))

  // Imediatamente após o mount, loading deve ser true
  expect(result.current.loading).toBe(true)

  await act(async () => {
    resolveFetch([MSG_A1])
    await Promise.resolve()
  })

  expect(result.current.loading).toBe(false)
})

// M-04 — conversationId null → zero request
it('M-04: conversationId null → zero request + estado vazio', () => {
  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, null))

  expect(mockGetMessages).not.toHaveBeenCalled()
  expect(result.current.messages).toEqual([])
  expect(result.current.loading).toBe(false)
  expect(result.current.error).toBeNull()
})

// M-05 — conversationId undefined → zero request
it('M-05: conversationId undefined → zero request + estado vazio', () => {
  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, undefined))

  expect(mockGetMessages).not.toHaveBeenCalled()
  expect(result.current.messages).toEqual([])
  expect(result.current.loading).toBe(false)
  expect(result.current.error).toBeNull()
})

// M-06 — companyId undefined → zero request
it('M-06: companyId undefined → zero request + estado vazio', () => {
  const { result } = renderHook(() => useMetaChatMessages(undefined, CONV_A))

  expect(mockGetMessages).not.toHaveBeenCalled()
  expect(result.current.messages).toEqual([])
  expect(result.current.loading).toBe(false)
  expect(result.current.error).toBeNull()
})

// M-07 — erro da API (Error)
it('M-07: fetch rejeita com Error → error preenchido, messages=[], loading=false', async () => {
  mockGetMessages.mockRejectedValueOnce(new Error('Erro de autenticação'))

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))

  await act(async () => { await Promise.resolve() })

  expect(result.current.error).toBe('Erro de autenticação')
  expect(result.current.messages).toEqual([])
  expect(result.current.loading).toBe(false)
})

// M-08 — anti-stale A→B: B vence mesmo se A resolver depois
it('M-08: troca A→B → resposta de A não sobrescreve resultado de B', async () => {
  let resolveA!: (v: MetaChatMessage[]) => void
  const pendingA = new Promise<MetaChatMessage[]>(res => { resolveA = res })

  const MSG_B: MetaChatMessage = {
    ...MSG_A1,
    id:              'msg-b-001',
    conversation_id: CONV_B,
  }

  mockGetMessages
    .mockReturnValueOnce(pendingA)                // fetch A — pendente
    .mockResolvedValueOnce([MSG_B])               // fetch B — resolve rápido

  const { result, rerender } = renderHook(
    ({ convId }) => useMetaChatMessages(COMPANY_A, convId),
    { initialProps: { convId: CONV_A as string | null } }
  )

  // Trocar para B antes de A completar
  rerender({ convId: CONV_B })

  // Aguardar B completar
  await act(async () => { await Promise.resolve() })

  // Agora completar A com dados stale
  await act(async () => {
    resolveA([MSG_A1, MSG_A2])
    await Promise.resolve()
  })

  // Resultado deve ser de B — A descartado
  expect(result.current.messages).toHaveLength(1)
  expect(result.current.messages[0].id).toBe('msg-b-001')
})

// M-09 — troca A→null enquanto A pendente → estado limpa; A ignorado ao resolver
it('M-09: troca A→null enquanto A pendente → estado limpa; A ignorado ao resolver', async () => {
  let resolveA!: (v: MetaChatMessage[]) => void
  const pendingA = new Promise<MetaChatMessage[]>(res => { resolveA = res })
  mockGetMessages.mockReturnValueOnce(pendingA)

  const { result, rerender } = renderHook(
    ({ convId }) => useMetaChatMessages(COMPANY_A, convId),
    { initialProps: { convId: CONV_A as string | null } }
  )

  // Fetch A está em andamento. Zerar conversationId.
  rerender({ convId: null })

  // Estado deve ser limpo imediatamente
  expect(result.current.messages).toEqual([])
  expect(result.current.loading).toBe(false)
  expect(result.current.error).toBeNull()
  expect(mockGetMessages).toHaveBeenCalledTimes(1) // só fetch A

  // Agora A resolve — deve ser ignorado
  await act(async () => {
    resolveA([MSG_A1])
    await Promise.resolve()
  })

  // Estado deve continuar vazio — A foi descartado
  expect(result.current.messages).toEqual([])
  expect(result.current.loading).toBe(false)
})

// M-10 — troca de company A→B
it('M-10: troca de company A→B → limpa mensagens; busca nova; resposta antiga ignorada', async () => {
  let resolveA!: (v: MetaChatMessage[]) => void
  const pendingA = new Promise<MetaChatMessage[]>(res => { resolveA = res })

  const MSG_B: MetaChatMessage = { ...MSG_A1, id: 'msg-b-company-001' }

  mockGetMessages
    .mockReturnValueOnce(pendingA)          // company A — pendente
    .mockResolvedValueOnce([MSG_B])         // company B — resolve rápido

  const { result, rerender } = renderHook(
    ({ companyId }) => useMetaChatMessages(companyId, CONV_A),
    { initialProps: { companyId: COMPANY_A } }
  )

  // Trocar empresa antes de A completar
  rerender({ companyId: COMPANY_B })

  // B deve completar
  await act(async () => { await Promise.resolve() })

  // Confirmar que getMessages foi chamado com ambas as empresas
  expect(mockGetMessages).toHaveBeenNthCalledWith(1, COMPANY_A, CONV_A)
  expect(mockGetMessages).toHaveBeenNthCalledWith(2, COMPANY_B, CONV_A)

  // Agora A resolve com dados stale
  await act(async () => {
    resolveA([MSG_A1, MSG_A2])
    await Promise.resolve()
  })

  // Resultado deve ser de B
  expect(result.current.messages).toHaveLength(1)
  expect(result.current.messages[0].id).toBe('msg-b-company-001')
})

// M-11 — refresh() dispara novo fetch
it('M-11: refresh() dispara novo getMessages com os mesmos IDs', async () => {
  mockGetMessages
    .mockResolvedValueOnce([])           // primeiro fetch
    .mockResolvedValueOnce([MSG_A1])     // após refresh

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))

  await act(async () => { await Promise.resolve() })
  expect(result.current.messages).toEqual([])

  await act(async () => {
    result.current.refresh()
    await Promise.resolve()
  })

  expect(mockGetMessages).toHaveBeenCalledTimes(2)
  expect(mockGetMessages).toHaveBeenNthCalledWith(2, COMPANY_A, CONV_A)
  expect(result.current.messages).toHaveLength(1)
})

// M-12 — refresh anterior resolve depois de refresh novo → novo vence
it('M-12: refresh anterior resolve depois de refresh novo → refresh novo vence', async () => {
  let resolveRefresh1!: (v: MetaChatMessage[]) => void
  const pendingRefresh1 = new Promise<MetaChatMessage[]>(res => { resolveRefresh1 = res })

  const MSG_REFRESH2: MetaChatMessage = { ...MSG_A1, id: 'msg-refresh2-001' }

  mockGetMessages
    .mockResolvedValueOnce([])             // fetch inicial
    .mockReturnValueOnce(pendingRefresh1)  // refresh 1 — pendente
    .mockResolvedValueOnce([MSG_REFRESH2]) // refresh 2 — resolve rápido

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))

  await act(async () => { await Promise.resolve() })

  // Disparar refresh 1 (fica pendente)
  act(() => { result.current.refresh() })

  // Disparar refresh 2 antes de refresh 1 completar
  await act(async () => {
    result.current.refresh()
    await Promise.resolve()
  })

  // Agora resolver refresh 1 com dados stale
  await act(async () => {
    resolveRefresh1([MSG_A1, MSG_A2])
    await Promise.resolve()
  })

  // Resultado deve ser de refresh 2 — refresh 1 descartado
  expect(result.current.messages).toHaveLength(1)
  expect(result.current.messages[0].id).toBe('msg-refresh2-001')
})

// M-13 — unmount durante request → zero warning/state update
it('M-13: unmount antes do fetch completar → resposta posterior não produz erro/warning', async () => {
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  let resolveAfterUnmount!: (v: MetaChatMessage[]) => void
  const pendingLong = new Promise<MetaChatMessage[]>(res => { resolveAfterUnmount = res })
  mockGetMessages.mockReturnValueOnce(pendingLong)

  const { unmount } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))

  // Desmontar antes do fetch completar
  unmount()

  // Completar o fetch após unmount
  await act(async () => {
    resolveAfterUnmount([MSG_A1])
    await Promise.resolve()
  })

  // Nenhum warning de setState pós-unmount
  expect(consoleSpy).not.toHaveBeenCalledWith(
    expect.stringContaining('unmounted')
  )

  consoleSpy.mockRestore()
})

// M-14 — rejeição não-Error → fallback estável
it('M-14: fetch rejeita com não-Error → fallback de erro estável', async () => {
  // Rejeitar com string (não é um Error)
  mockGetMessages.mockRejectedValueOnce('falha inesperada como string')

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))

  await act(async () => { await Promise.resolve() })

  // Deve usar o fallback, não tentar acessar .message de uma string
  expect(result.current.error).toBe('Erro ao carregar mensagens')
  expect(result.current.messages).toEqual([])
  expect(result.current.loading).toBe(false)
})
