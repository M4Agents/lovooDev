// @vitest-environment jsdom
// =============================================================================
// src/hooks/chat/__tests__/useMetaChatMessages.test.ts
//
// Contrato do hook useMetaChatMessages — MVP3C.4 + MVP3E B1
//
// Cobertura existente (M-01..M-14):
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
// Realtime MVP3E B1 (RT-MSG-01..RT-MSG-12):
//   RT-MSG-01  IDs válidos → cria subscription em meta_messages
//   RT-MSG-02  subscription usa event INSERT / schema public / table / filter corretos
//   RT-MSG-03  INSERT da conversa ativa → dispara refresh canônico (load)
//   RT-MSG-04  conversationId null → nenhum channel criado
//   RT-MSG-05  companyId ausente → nenhum channel criado
//   RT-MSG-06  A→B → channel A limpo, channel B criado
//   RT-MSG-07  callback tardio do channel A após troca para B → NÃO dispara load de B
//   RT-MSG-08  unmount → channel.unsubscribe() chamado
//   RT-MSG-09  evento após unmount → nenhum setState útil
//   RT-MSG-10  dois eventos rápidos → estado final vem do fetch mais recente (sem duplicata local)
//   RT-MSG-11  payload Realtime NÃO é anexado diretamente ao array de messages
//   RT-MSG-12  nenhum service_role/token/wa_id/meta_message_id usado no handler
//
// Segurança: nenhum token ou UUID real nos fixtures.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act }                       from '@testing-library/react'
import { useMetaChatMessages }                   from '../useMetaChatMessages'
import type { MetaChatMessage }                  from '../../../types/meta-whatsapp'

// ── Supabase Realtime mock ─────────────────────────────────────────────────────
//
// mockRt é declarado via vi.hoisted() para garantir que esteja disponível
// dentro da factory de vi.mock (que é hoisted antes das imports).
//
// Cada chamada a supabase.channel() cria e registra uma entrada em mockRt.channels,
// expondo channelName, config do .on(), unsubscribeFn e simulateInsert().

interface RtChannelEntry {
  channelName:   string
  event:         string
  schema:        string
  table:         string
  filter:        string
  unsubscribeFn: ReturnType<typeof vi.fn>
  simulateInsert: (payload?: object) => void
}

const mockRt = vi.hoisted(() => {
  const channels: RtChannelEntry[] = []
  return {
    channels,
    clear()  { channels.splice(0) },
    last()   { return channels[channels.length - 1] ?? null },
    get(i: number) { return channels[i] ?? null },
  }
})

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    channel: vi.fn().mockImplementation((channelName: string) => {
      let registeredCb: ((payload: unknown) => void) | undefined
      let capturedEvent  = ''
      let capturedSchema = ''
      let capturedTable  = ''
      let capturedFilter = ''

      const unsubscribeFn = vi.fn()

      const channelObj = {
        on: vi.fn().mockImplementation((_listenerType: string, config: Record<string, string>, cb: (p: unknown) => void) => {
          // config contém: { event: 'INSERT', schema: 'public', table: '...', filter: '...' }
          // O primeiro arg (_listenerType) é 'postgres_changes' — não é o event de negócio.
          capturedEvent  = config?.event  ?? ''
          capturedSchema = config?.schema ?? ''
          capturedTable  = config?.table  ?? ''
          capturedFilter = config?.filter ?? ''
          registeredCb   = cb
          return channelObj
        }),
        subscribe:   vi.fn().mockImplementation(() => channelObj),
        unsubscribe: unsubscribeFn,
      }

      mockRt.channels.push({
        channelName,
        get event()  { return capturedEvent  },
        get schema() { return capturedSchema },
        get table()  { return capturedTable  },
        get filter() { return capturedFilter },
        unsubscribeFn,
        simulateInsert: (payload = {}) => registeredCb?.(payload),
      })

      return channelObj
    }),
  },
}))

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
  mockRt.clear()
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

// =============================================================================
// REALTIME — MVP3E B1
// =============================================================================

// RT-MSG-01 — IDs válidos → cria subscription em meta_messages
it('RT-MSG-01: companyId + conversationId válidos → cria channel Realtime', async () => {
  mockGetMessages.mockResolvedValueOnce([])

  renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  // Deve ter criado exatamente um channel
  expect(mockRt.channels).toHaveLength(1)
  expect(mockRt.last()?.channelName).toBe(`meta_messages_${COMPANY_A}_${CONV_A}`)
})

// RT-MSG-02 — configuração correta do .on()
it('RT-MSG-02: subscription usa INSERT / public / meta_messages / filter correto', async () => {
  mockGetMessages.mockResolvedValueOnce([])

  renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  const ch = mockRt.last()
  expect(ch).not.toBeNull()
  expect(ch!.event).toBe('INSERT')
  expect(ch!.schema).toBe('public')
  expect(ch!.table).toBe('meta_messages')
  expect(ch!.filter).toBe(`conversation_id=eq.${CONV_A}`)
})

// RT-MSG-03 — INSERT na conversa ativa → dispara load()
it('RT-MSG-03: evento INSERT da conversa ativa → dispara fetch canônico (load)', async () => {
  mockGetMessages
    .mockResolvedValueOnce([MSG_A1])    // fetch inicial
    .mockResolvedValueOnce([MSG_A1, MSG_A2])  // fetch após Realtime

  renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  expect(mockGetMessages).toHaveBeenCalledTimes(1)

  // Simular INSERT via Realtime
  await act(async () => {
    mockRt.last()?.simulateInsert({ id: 'msg-rt-001', conversation_id: CONV_A })
    await Promise.resolve()
  })

  // load() deve ter sido disparado pelo sinal de invalidação
  expect(mockGetMessages).toHaveBeenCalledTimes(2)
  expect(mockGetMessages).toHaveBeenNthCalledWith(2, COMPANY_A, CONV_A)
})

// RT-MSG-04 — conversationId null → nenhum channel criado
it('RT-MSG-04: conversationId null → nenhum channel Realtime criado', () => {
  mockGetMessages.mockResolvedValueOnce([])

  renderHook(() => useMetaChatMessages(COMPANY_A, null))

  expect(mockRt.channels).toHaveLength(0)
})

// RT-MSG-05 — companyId ausente → nenhum channel criado
it('RT-MSG-05: companyId undefined → nenhum channel Realtime criado', () => {
  mockGetMessages.mockResolvedValueOnce([])

  renderHook(() => useMetaChatMessages(undefined, CONV_A))

  expect(mockRt.channels).toHaveLength(0)
})

// RT-MSG-06 — troca A→B → channel A limpo, channel B criado
it('RT-MSG-06: troca A→B → channel A unsubscribe + channel B criado', async () => {
  mockGetMessages.mockResolvedValue([])

  const { rerender } = renderHook(
    ({ convId }) => useMetaChatMessages(COMPANY_A, convId),
    { initialProps: { convId: CONV_A as string | null } }
  )
  await act(async () => { await Promise.resolve() })

  // Channel A criado
  expect(mockRt.channels).toHaveLength(1)
  const channelA = mockRt.get(0)!
  expect(channelA.channelName).toBe(`meta_messages_${COMPANY_A}_${CONV_A}`)

  // Trocar para conversa B
  rerender({ convId: CONV_B })
  await act(async () => { await Promise.resolve() })

  // Channel A deve ter sido unsubscribed
  expect(channelA.unsubscribeFn).toHaveBeenCalledTimes(1)

  // Channel B deve ter sido criado
  expect(mockRt.channels).toHaveLength(2)
  const channelB = mockRt.get(1)!
  expect(channelB.channelName).toBe(`meta_messages_${COMPANY_A}_${CONV_B}`)
})

// RT-MSG-07 — evento tardio do channel A após troca para B → NÃO dispara load de B
it('RT-MSG-07: callback tardio do channel A após troca B → NÃO dispara load', async () => {
  mockGetMessages.mockResolvedValue([])

  const { rerender } = renderHook(
    ({ convId }) => useMetaChatMessages(COMPANY_A, convId),
    { initialProps: { convId: CONV_A as string | null } }
  )
  await act(async () => { await Promise.resolve() })

  // Capturar channel A antes da troca
  const channelA = mockRt.get(0)!

  // Trocar para B
  rerender({ convId: CONV_B })
  await act(async () => { await Promise.resolve() })

  // Contar chamadas até aqui (initial A + initial B = 2)
  const callsBeforeLateEvent = mockGetMessages.mock.calls.length

  // Disparar evento tardio do channel A (simula evento chegando depois do switch)
  await act(async () => {
    channelA.simulateInsert({ id: 'msg-stale-001', conversation_id: CONV_A })
    await Promise.resolve()
  })

  // Nenhum fetch adicional deve ter sido disparado
  expect(mockGetMessages.mock.calls.length).toBe(callsBeforeLateEvent)
})

// RT-MSG-08 — unmount → channel.unsubscribe() chamado
it('RT-MSG-08: unmount → channel.unsubscribe() chamado', async () => {
  mockGetMessages.mockResolvedValueOnce([])

  const { unmount } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  const ch = mockRt.last()!
  expect(ch.unsubscribeFn).not.toHaveBeenCalled()

  unmount()

  expect(ch.unsubscribeFn).toHaveBeenCalledTimes(1)
})

// RT-MSG-09 — evento após unmount → nenhum setState / load útil
it('RT-MSG-09: evento Realtime após unmount → nenhum setState / load disparado', async () => {
  mockGetMessages.mockResolvedValueOnce([])

  const { unmount } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  const ch = mockRt.last()!
  const callsBefore = mockGetMessages.mock.calls.length

  unmount()

  // Disparar evento após unmount
  await act(async () => {
    ch.simulateInsert({ id: 'msg-post-unmount' })
    await Promise.resolve()
  })

  // mountedRef impede setState; fetchCountRef já foi invalidado.
  // Nenhum fetch adicional deve ter sido realizado.
  expect(mockGetMessages.mock.calls.length).toBe(callsBefore)
})

// RT-MSG-10 — dois eventos rápidos → estado final vem do fetch mais recente (sem duplicata)
it('RT-MSG-10: dois eventos Realtime rápidos → estado final é do fetch mais recente', async () => {
  let resolveFirst!:  (v: MetaChatMessage[]) => void
  const pendingFirst = new Promise<MetaChatMessage[]>(res => { resolveFirst = res })
  const MSG_SECOND: MetaChatMessage = { ...MSG_A1, id: 'msg-second-001' }

  mockGetMessages
    .mockResolvedValueOnce([])        // fetch inicial
    .mockReturnValueOnce(pendingFirst)  // fetch do 1º evento RT — fica pendente
    .mockResolvedValueOnce([MSG_SECOND]) // fetch do 2º evento RT — resolve rápido

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  const ch = mockRt.last()!

  // 1º evento
  act(() => { ch.simulateInsert({}) })

  // 2º evento antes do 1º completar
  await act(async () => {
    ch.simulateInsert({})
    await Promise.resolve()
  })

  // Resolver 1º agora (stale)
  await act(async () => {
    resolveFirst([MSG_A1])
    await Promise.resolve()
  })

  // Estado final deve ser do fetch mais recente (2º evento)
  expect(result.current.messages).toHaveLength(1)
  expect(result.current.messages[0].id).toBe('msg-second-001')
})

// RT-MSG-11 — payload Realtime NÃO é usado para popular messages diretamente
it('RT-MSG-11: payload Realtime não é inserido diretamente no array de messages', async () => {
  // Fetch inicial retorna vazio e NÃO retorna mais nada após o evento RT
  mockGetMessages
    .mockResolvedValueOnce([MSG_A1])  // fetch inicial
    .mockResolvedValueOnce([MSG_A1])  // fetch após RT (sem novas mensagens ainda)

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  const payloadFake: object = {
    id: 'msg-injected-payload',
    conversation_id: CONV_A,
    body: 'mensagem via payload — NÃO deve aparecer',
  }

  await act(async () => {
    mockRt.last()?.simulateInsert(payloadFake)
    await Promise.resolve()
  })

  // messages devem conter somente o que o GET retornou — não o payload
  expect(result.current.messages.every(m => m.id !== 'msg-injected-payload')).toBe(true)
  // O GET deve ter sido chamado novamente (invalidação)
  expect(mockGetMessages).toHaveBeenCalledTimes(2)
})

// RT-MSG-12 — nenhum dado sensível (service_role, token, wa_id, meta_message_id) no handler
it('RT-MSG-12: subscription não usa service_role / token / wa_id / meta_message_id para autorização', async () => {
  mockGetMessages.mockResolvedValueOnce([])

  renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  const ch = mockRt.last()!

  // Verificar que o nome do channel contém apenas companyId e conversationId
  // (sem tokens, sem meta_message_id, sem wa_id)
  expect(ch.channelName).toBe(`meta_messages_${COMPANY_A}_${CONV_A}`)
  expect(ch.channelName).not.toMatch(/service_role|token|wa_id|meta_message_id/)

  // Verificar que o filtro usa apenas conversation_id (sem campos sensíveis)
  expect(ch.filter).toBe(`conversation_id=eq.${CONV_A}`)
  expect(ch.filter).not.toMatch(/service_role|token|wa_id/)

  // Verificar que o handler dispara somente load() — nenhuma lógica de autorização
  // baseada em payload. Simular evento com campos "sensíveis" no payload:
  // load() deve ser chamado normalmente (payload é ignorado).
  mockGetMessages.mockResolvedValueOnce([])
  await act(async () => {
    ch.simulateInsert({ wa_id: 'fake-wa', meta_message_id: 'fake-meta', token: 'fake-token' })
    await Promise.resolve()
  })

  // Apenas o fetch GET foi chamado — nenhum dado do payload foi usado
  expect(mockGetMessages).toHaveBeenCalledTimes(2)
  expect(mockGetMessages).toHaveBeenNthCalledWith(2, COMPANY_A, CONV_A)
})
