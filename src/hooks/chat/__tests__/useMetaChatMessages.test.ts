// @vitest-environment jsdom
// =============================================================================
// src/hooks/chat/__tests__/useMetaChatMessages.test.ts
//
// Contrato do hook useMetaChatMessages — MVP3C.4 + MVP3E B1 + MVP3E B1.1
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
//   RT-MSG-03  INSERT da conversa ativa → dispara GET canônico (loadSilent)
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
// Silent Realtime MVP3E B1.1 (RT-MSG-SILENT-01..RT-MSG-SILENT-15):
//   RT-MSG-SILENT-01  RT INSERT chama GET canônico via loadSilent
//   RT-MSG-SILENT-02  RT não limpa messages antes do GET
//   RT-MSG-SILENT-03  RT não ativa loading visual
//   RT-MSG-SILENT-04  mensagens antigas permanecem durante GET pendente
//   RT-MSG-SILENT-05  GET resolve e substitui lista atomicamente
//   RT-MSG-SILENT-06  falha silent preserva messages existentes
//   RT-MSG-SILENT-07  falha silent não cria error visual
//   RT-MSG-SILENT-08  dois silents concorrentes: mais recente vence
//   RT-MSG-SILENT-09  silent conversa A + troca B: A ignorado
//   RT-MSG-SILENT-10  unmount durante silent: sem setState útil
//   RT-MSG-SILENT-11  silent não deixa loading normal preso (normalFetchCountRef)
//   RT-MSG-SILENT-12  initial load mantém loading normal
//   RT-MSG-SILENT-13  troca de conversa mantém reset + loading normal
//   RT-MSG-SILENT-14  payload RT não é source of truth
//   RT-MSG-SILENT-15  outbound refresh normal + RT silent coexistem corretamente
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

// =============================================================================
// SILENT REALTIME — MVP3E B1.1
// =============================================================================

// RT-MSG-SILENT-01 — RT INSERT chama GET canônico via loadSilent
it('RT-MSG-SILENT-01: evento RT dispara GET canônico via loadSilent', async () => {
  mockGetMessages
    .mockResolvedValueOnce([MSG_A1])   // initial load
    .mockResolvedValueOnce([MSG_A1])   // silent GET após RT

  renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  expect(mockGetMessages).toHaveBeenCalledTimes(1)

  await act(async () => {
    mockRt.last()?.simulateInsert({})
    await Promise.resolve()
  })

  expect(mockGetMessages).toHaveBeenCalledTimes(2)
  expect(mockGetMessages).toHaveBeenNthCalledWith(2, COMPANY_A, CONV_A)
})

// RT-MSG-SILENT-02 — RT não limpa messages antes do GET
it('RT-MSG-SILENT-02: evento RT não limpa messages antes do GET resolver', async () => {
  let resolveSilent!: (v: MetaChatMessage[]) => void
  const pendingSilent = new Promise<MetaChatMessage[]>(res => { resolveSilent = res })

  mockGetMessages
    .mockResolvedValueOnce([MSG_A1])      // initial load
    .mockReturnValueOnce(pendingSilent)   // silent GET pendente

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  expect(result.current.messages).toHaveLength(1)

  // Disparar RT event — silent GET fica pendente
  await act(async () => {
    mockRt.last()?.simulateInsert({})
  })

  // Messages NÃO foram limpas — lista antiga permanece visível
  expect(result.current.messages).toHaveLength(1)
  expect(result.current.messages[0].id).toBe(MSG_A1.id)

  await act(async () => {
    resolveSilent([])
    await Promise.resolve()
  })
})

// RT-MSG-SILENT-03 — RT não ativa loading visual
it('RT-MSG-SILENT-03: evento RT não ativa loading durante GET silent', async () => {
  let resolveSilent!: (v: MetaChatMessage[]) => void
  const pendingSilent = new Promise<MetaChatMessage[]>(res => { resolveSilent = res })

  mockGetMessages
    .mockResolvedValueOnce([MSG_A1])      // initial load
    .mockReturnValueOnce(pendingSilent)   // silent GET pendente

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  expect(result.current.loading).toBe(false)

  await act(async () => {
    mockRt.last()?.simulateInsert({})
  })

  // loading CONTINUA false durante silent GET — sem spinner
  expect(result.current.loading).toBe(false)

  await act(async () => {
    resolveSilent([MSG_A1])
    await Promise.resolve()
  })

  // loading permanece false após silent GET resolver
  expect(result.current.loading).toBe(false)
})

// RT-MSG-SILENT-04 — mensagens antigas permanecem durante GET pendente
it('RT-MSG-SILENT-04: messages antigas permanecem visíveis enquanto silent GET está pendente', async () => {
  let resolveSilent!: (v: MetaChatMessage[]) => void
  const pendingSilent = new Promise<MetaChatMessage[]>(res => { resolveSilent = res })

  mockGetMessages
    .mockResolvedValueOnce([MSG_A1])      // initial load
    .mockReturnValueOnce(pendingSilent)   // silent pendente

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  expect(result.current.messages[0].id).toBe(MSG_A1.id)

  await act(async () => {
    mockRt.last()?.simulateInsert({})
  })

  // Durante GET pendente: lista antiga visível, sem loading, sem clear
  expect(result.current.messages).toHaveLength(1)
  expect(result.current.messages[0].id).toBe(MSG_A1.id)
  expect(result.current.loading).toBe(false)

  await act(async () => {
    resolveSilent([])
    await Promise.resolve()
  })
})

// RT-MSG-SILENT-05 — GET resolve e substitui lista atomicamente
it('RT-MSG-SILENT-05: quando silent GET resolve, nova lista substitui a antiga', async () => {
  const MSG_NEW: MetaChatMessage = makeMsg('msg-new-0001', 'inbound')

  mockGetMessages
    .mockResolvedValueOnce([MSG_A1])           // initial load
    .mockResolvedValueOnce([MSG_A1, MSG_NEW])  // silent GET com nova mensagem

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  expect(result.current.messages).toHaveLength(1)

  await act(async () => {
    mockRt.last()?.simulateInsert({})
    await Promise.resolve()
  })

  // Nova lista substituiu a antiga atomicamente — sem flash
  expect(result.current.messages).toHaveLength(2)
  expect(result.current.messages[1].id).toBe('msg-new-0001')
  expect(result.current.loading).toBe(false)
})

// RT-MSG-SILENT-06 — falha silent preserva messages existentes
it('RT-MSG-SILENT-06: falha do silent GET preserva messages existentes', async () => {
  mockGetMessages
    .mockResolvedValueOnce([MSG_A1])                   // initial load
    .mockRejectedValueOnce(new Error('network_error')) // silent GET falha

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  expect(result.current.messages).toHaveLength(1)

  await act(async () => {
    mockRt.last()?.simulateInsert({})
    await Promise.resolve()
  })

  // Messages preservadas — sem limpeza no catch silent
  expect(result.current.messages).toHaveLength(1)
  expect(result.current.messages[0].id).toBe(MSG_A1.id)
})

// RT-MSG-SILENT-07 — falha silent não cria error visual
it('RT-MSG-SILENT-07: falha do silent GET não define error no estado', async () => {
  mockGetMessages
    .mockResolvedValueOnce([MSG_A1])                   // initial load
    .mockRejectedValueOnce(new Error('network_error')) // silent falha

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  expect(result.current.error).toBeNull()

  await act(async () => {
    mockRt.last()?.simulateInsert({})
    await Promise.resolve()
  })

  // error permanece null — falha transitória não degrada UX
  expect(result.current.error).toBeNull()
  expect(result.current.loading).toBe(false)
})

// RT-MSG-SILENT-08 — dois silents concorrentes: mais recente vence
it('RT-MSG-SILENT-08: dois silents concorrentes → somente o mais recente atualiza messages', async () => {
  const MSG_FIRST:  MetaChatMessage = makeMsg('msg-first',  'inbound')
  const MSG_SECOND: MetaChatMessage = makeMsg('msg-second', 'inbound')

  let resolveFirst!:  (v: MetaChatMessage[]) => void
  let resolveSecond!: (v: MetaChatMessage[]) => void
  const pendingFirst  = new Promise<MetaChatMessage[]>(res => { resolveFirst  = res })
  const pendingSecond = new Promise<MetaChatMessage[]>(res => { resolveSecond = res })

  mockGetMessages
    .mockResolvedValueOnce([MSG_A1])    // initial load
    .mockReturnValueOnce(pendingFirst)  // silent #1
    .mockReturnValueOnce(pendingSecond) // silent #2

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  // Disparar dois eventos RT
  await act(async () => { mockRt.last()?.simulateInsert({}) })
  await act(async () => { mockRt.last()?.simulateInsert({}) })

  // Resolver primeiro (stale) — deve ser descartado
  await act(async () => {
    resolveFirst([MSG_FIRST])
    await Promise.resolve()
  })

  // fetchCountRef: primeiro era stale → descartado
  expect(result.current.messages[0].id).toBe(MSG_A1.id) // ainda o inicial

  // Resolver segundo (mais recente) — deve vencer
  await act(async () => {
    resolveSecond([MSG_SECOND])
    await Promise.resolve()
  })

  expect(result.current.messages[0].id).toBe('msg-second')
})

// RT-MSG-SILENT-09 — silent conversa A + troca B: A ignorado
it('RT-MSG-SILENT-09: silent A em curso + troca para conversa B → resposta A descartada', async () => {
  const MSG_B: MetaChatMessage = makeMsg('msg-conv-B', 'inbound')

  let resolveSilentA!: (v: MetaChatMessage[]) => void
  const pendingSilentA = new Promise<MetaChatMessage[]>(res => { resolveSilentA = res })

  mockGetMessages
    .mockResolvedValueOnce([MSG_A1])     // initial conv A
    .mockReturnValueOnce(pendingSilentA) // silent A pendente
    .mockResolvedValueOnce([MSG_B])      // initial conv B

  const { result, rerender } = renderHook(
    ({ convId }) => useMetaChatMessages(COMPANY_A, convId),
    { initialProps: { convId: CONV_A } }
  )
  await act(async () => { await Promise.resolve() })

  // Disparar silent A
  await act(async () => { mockRt.last()?.simulateInsert({}) })

  // Trocar conversa antes de silent A resolver
  rerender({ convId: CONV_B })
  await act(async () => { await Promise.resolve() })

  expect(result.current.messages[0].id).toBe('msg-conv-B')

  // Resolver silent A (stale) — fetchCountRef não bate → descartado
  await act(async () => {
    resolveSilentA([makeMsg('stale-A', 'inbound')])
    await Promise.resolve()
  })

  // Estado continua sendo de B
  expect(result.current.messages[0].id).toBe('msg-conv-B')
})

// RT-MSG-SILENT-10 — unmount durante silent: sem setState útil
it('RT-MSG-SILENT-10: unmount durante silent GET → nenhum setState executado', async () => {
  let resolveSilent!: (v: MetaChatMessage[]) => void
  const pendingSilent = new Promise<MetaChatMessage[]>(res => { resolveSilent = res })

  mockGetMessages
    .mockResolvedValueOnce([MSG_A1])      // initial
    .mockReturnValueOnce(pendingSilent)   // silent pendente

  const { unmount } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  await act(async () => { mockRt.last()?.simulateInsert({}) })

  // Desmontar antes do silent resolver
  unmount()

  // Resolver silent após unmount — mountedRef.current = false → sem setState
  await act(async () => {
    resolveSilent([makeMsg('msg-after-unmount', 'inbound')])
    await Promise.resolve()
  })

  // Apenas 2 chamadas: initial + silent (o GET foi iniciado antes do unmount)
  expect(mockGetMessages).toHaveBeenCalledTimes(2)
})

// RT-MSG-SILENT-11 — silent não deixa loading normal preso (normalFetchCountRef crítico)
it('RT-MSG-SILENT-11: silent não pode deixar loading normal preso em true', async () => {
  // Cenário:
  //   1. load normal (N, M) inicia → loading=true
  //   2. RT INSERT → loadSilent (N+1) — silent "ganha" fetchCountRef
  //   3. silent resolve → setMessages ✓; silent não toca normalFetchCountRef
  //   4. load normal resolve → stale no fetchCountRef (N!=N+1); MAS
  //      normalFetchCountRef: M==M → setLoading(false) é executado
  //
  // Sem normalFetchCountRef: step 4 seria bloqueado e loading ficaria preso.

  let resolveNormal!: (v: MetaChatMessage[]) => void
  let resolveSilent!: (v: MetaChatMessage[]) => void
  const pendingNormal = new Promise<MetaChatMessage[]>(res => { resolveNormal = res })
  const pendingSilent = new Promise<MetaChatMessage[]>(res => { resolveSilent = res })

  mockGetMessages
    .mockReturnValueOnce(pendingNormal)  // load normal — fica pendente
    .mockReturnValueOnce(pendingSilent)  // silent — fica pendente

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))

  // Após mount: load normal disparado, loading=true
  expect(result.current.loading).toBe(true)

  // RT INSERT → silent inicia enquanto normal está pendente
  await act(async () => { mockRt.last()?.simulateInsert({}) })

  // loading AINDA true (normal pendente)
  expect(result.current.loading).toBe(true)

  // Silent resolve primeiro — NÃO deve desligar loading
  const MSG_FROM_SILENT: MetaChatMessage = makeMsg('msg-from-silent', 'inbound')
  await act(async () => {
    resolveSilent([MSG_FROM_SILENT])
    await Promise.resolve()
  })

  // loading CONTINUA true — silent não tocou normalFetchCountRef
  expect(result.current.loading).toBe(true)
  // Data do silent aplicada (era o fetch mais recente no fetchCountRef)
  expect(result.current.messages[0].id).toBe('msg-from-silent')

  // Load normal resolve (stale no fetchCountRef, mas normalFetchCountRef bate)
  await act(async () => {
    resolveNormal([MSG_A1])
    await Promise.resolve()
  })

  // loading FINALMENTE false — normalFetchCountRef permitiu setLoading(false)
  expect(result.current.loading).toBe(false)
  // Data do normal descartada (stale) — data do silent permanece
  expect(result.current.messages[0].id).toBe('msg-from-silent')
})

// RT-MSG-SILENT-12 — initial load mantém loading normal
it('RT-MSG-SILENT-12: initial load continua exibindo loading normalmente', async () => {
  let resolveInit!: (v: MetaChatMessage[]) => void
  const pendingInit = new Promise<MetaChatMessage[]>(res => { resolveInit = res })
  mockGetMessages.mockReturnValueOnce(pendingInit)

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))

  // loading=true imediatamente após mount
  expect(result.current.loading).toBe(true)
  expect(result.current.messages).toEqual([])

  await act(async () => {
    resolveInit([MSG_A1])
    await Promise.resolve()
  })

  expect(result.current.loading).toBe(false)
  expect(result.current.messages).toHaveLength(1)
})

// RT-MSG-SILENT-13 — troca de conversa mantém reset + loading normal
it('RT-MSG-SILENT-13: troca de conversa continua com setMessages([]) + loading=true (load normal)', async () => {
  mockGetMessages.mockResolvedValueOnce([MSG_A1]) // initial conv A

  let resolveB!: (v: MetaChatMessage[]) => void
  const pendingB = new Promise<MetaChatMessage[]>(res => { resolveB = res })
  mockGetMessages.mockReturnValueOnce(pendingB) // fetch conv B pendente

  const { result, rerender } = renderHook(
    ({ convId }) => useMetaChatMessages(COMPANY_A, convId),
    { initialProps: { convId: CONV_A } }
  )
  await act(async () => { await Promise.resolve() })

  expect(result.current.messages).toHaveLength(1)

  // Trocar conversa → load normal (não-silent)
  rerender({ convId: CONV_B })

  // Imediatamente: messages limpas + loading=true (comportamento normal preservado)
  expect(result.current.messages).toEqual([])
  expect(result.current.loading).toBe(true)

  await act(async () => {
    resolveB([MSG_A1])
    await Promise.resolve()
  })

  expect(result.current.loading).toBe(false)
  expect(result.current.messages).toHaveLength(1)
})

// RT-MSG-SILENT-14 — payload RT não é source of truth
it('RT-MSG-SILENT-14: payload RT não é source of truth; GET canônico determina o estado', async () => {
  const payloadFalso = {
    id:        'payload-falso',
    body:      'este texto NÃO deve aparecer',
    direction: 'outbound',
  }

  const MSG_FROM_GET: MetaChatMessage = makeMsg('msg-get-real', 'inbound')

  mockGetMessages
    .mockResolvedValueOnce([MSG_A1])       // initial
    .mockResolvedValueOnce([MSG_FROM_GET]) // silent GET

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  await act(async () => {
    mockRt.last()?.simulateInsert(payloadFalso)
    await Promise.resolve()
  })

  // Estado vem do GET — payload descartado
  expect(result.current.messages[0].id).toBe('msg-get-real')
  expect(result.current.messages.map(m => m.id)).not.toContain('payload-falso')
})

// RT-MSG-SILENT-15 — outbound refresh normal + RT silent coexistem corretamente
it('RT-MSG-SILENT-15: outbound refresh (load normal) + RT INSERT (silent) sem race incorreta', async () => {
  // Cenário real: após send success, MetaChatArea chama refresh() = load normal.
  // O RT INSERT do próprio outbound também chega → loadSilent.
  // normalFetchCountRef garante que loading seja desligado corretamente.
  //
  // Sequência:
  //   1. load normal (N, M) — loading=true
  //   2. RT INSERT chega → loadSilent (N+1)
  //   3. silent resolve primeiro → setMessages ✓; loading não muda
  //   4. load normal resolve (stale data, mas normalFetchCount M==M) → setLoading(false)

  const MSG_OUTBOUND: MetaChatMessage = makeMsg('msg-outbound-0001', 'outbound')

  let resolveNormal!: (v: MetaChatMessage[]) => void
  let resolveSilent!: (v: MetaChatMessage[]) => void
  const pendingNormal = new Promise<MetaChatMessage[]>(res => { resolveNormal = res })
  const pendingSilent = new Promise<MetaChatMessage[]>(res => { resolveSilent = res })

  mockGetMessages
    .mockResolvedValueOnce([MSG_A1])    // initial load (antes do envio)
    .mockReturnValueOnce(pendingNormal) // refresh() após send — load normal
    .mockReturnValueOnce(pendingSilent) // RT INSERT outbound — loadSilent

  const { result } = renderHook(() => useMetaChatMessages(COMPANY_A, CONV_A))
  await act(async () => { await Promise.resolve() })

  // Simular send success → refresh() = load normal (loading=true)
  act(() => { result.current.refresh() })

  expect(result.current.loading).toBe(true)

  // RT INSERT chega enquanto normal está pendente → loadSilent
  await act(async () => { mockRt.last()?.simulateInsert({}) })

  expect(result.current.loading).toBe(true) // normal ainda pendente

  // Silent resolve primeiro com a mensagem outbound
  await act(async () => {
    resolveSilent([MSG_A1, MSG_OUTBOUND])
    await Promise.resolve()
  })

  // Messages atualizadas pelo silent; loading AINDA true (normal não terminou)
  expect(result.current.messages).toHaveLength(2)
  expect(result.current.loading).toBe(true)

  // Load normal resolve (stale no fetchCountRef, mas normalFetchCountRef M==M)
  await act(async () => {
    resolveNormal([MSG_A1])  // dados stale — descartados
    await Promise.resolve()
  })

  // loading=false corretamente; data do silent (com outbound) permanece
  expect(result.current.loading).toBe(false)
  expect(result.current.messages).toHaveLength(2)
  expect(result.current.messages[1].id).toBe('msg-outbound-0001')
})
