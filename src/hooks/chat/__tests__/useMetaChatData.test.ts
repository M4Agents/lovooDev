// @vitest-environment jsdom
// =============================================================================
// src/hooks/chat/__tests__/useMetaChatData.test.ts
//
// Contrato do hook useMetaChatData — MVP3C.2 + MVP3E B2
//
// Cobertura existente (H-01..H-14):
//   H-01  sem companyId → zero request, estado limpo
//   H-02  sem selectedInstanceId → zero request, estado limpo
//   H-03  com ambos → dispara fetch com instanceId correto
//   H-04  loading ativo durante fetch
//   H-05  success com lista vazia
//   H-06  success com conversations
//   H-07  error → string de erro exposta
//   H-08  troca de instance limpa selectedConversationId
//   H-09  troca de instance limpa conversations antes do fetch
//   H-10  anti-stale A→B: resposta A não sobrescreve B
//   H-11  unmount não atualiza state após desmontagem
//   H-12  refresh() dispara novo fetch
//   H-13  setSelectedConversation atualiza somente estado local
//   H-14  companyId ausente após estar presente → limpa estado
//
// Realtime MVP3E B2 (RT-CONV-01..RT-CONV-13):
//   RT-CONV-01  IDs válidos → cria subscription em meta_conversations
//   RT-CONV-02  subscription usa UPDATE / public / meta_conversations
//   RT-CONV-03  filtro = company_id=eq.<companyId>
//   RT-CONV-04  UPDATE → dispara GET/load canônico
//   RT-CONV-05  companyId ausente → nenhum channel criado
//   RT-CONV-06  selectedInstanceId ausente → nenhum channel criado
//   RT-CONV-07  company A→B → channel A unsubscribed + channel B criado
//   RT-CONV-08  instance A→B → channel A unsubscribed + channel B criado
//   RT-CONV-09  callback tardio de company/instance anterior → NÃO dispara load
//   RT-CONV-10  unmount → channel.unsubscribe() chamado
//   RT-CONV-11  evento após unmount → nenhum load disparado
//   RT-CONV-12  payload não é aplicado diretamente a conversations
//   RT-CONV-13  UPDATE de outra instância mesma company → GET canônico; sem payload
//
// Segurança: nenhum token ou UUID real nos fixtures.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act }                       from '@testing-library/react'
import { useMetaChatData }                       from '../useMetaChatData'
import type { MetaChatConversation }             from '../../../types/meta-whatsapp'

// ── Supabase Realtime mock ─────────────────────────────────────────────────────
//
// vi.hoisted() garante disponibilidade dentro da factory vi.mock.
// Padrão idêntico ao adotado em useMetaChatMessages.test.ts (B1).

interface RtConvEntry {
  channelName:    string
  event:          string
  schema:         string
  table:          string
  filter:         string
  unsubscribeFn:  ReturnType<typeof vi.fn>
  simulateUpdate: (payload?: object) => void
}

const mockRtConv = vi.hoisted(() => {
  const channels: RtConvEntry[] = []
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

      mockRtConv.channels.push({
        channelName,
        get event()  { return capturedEvent  },
        get schema() { return capturedSchema },
        get table()  { return capturedTable  },
        get filter() { return capturedFilter },
        unsubscribeFn,
        simulateUpdate: (payload = {}) => registeredCb?.(payload),
      })

      return channelObj
    }),
  },
}))

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../services/metaWhatsAppApi', () => ({
  metaWhatsAppApi: {
    getConversations: vi.fn(),
  },
}))

import { metaWhatsAppApi } from '../../../services/metaWhatsAppApi'

const mockGetConversations = metaWhatsAppApi.getConversations as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockRtConv.clear()
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_A    = 'company-aaaa-0001'
const COMPANY_B    = 'company-bbbb-0002'
const INSTANCE_A   = 'instance-aaaa-0001'
const INSTANCE_B   = 'instance-bbbb-0002'
const CONV_ID      = 'conv-0000-0001'

const FAKE_CONV: MetaChatConversation = {
  id:                   CONV_ID,
  instance_id:          INSTANCE_A,
  wa_id:                '5500000000001',
  contact_name:         'Contato A',
  status:               'active',
  unread_count:         1,
  last_message_at:      '2026-09-21T12:00:00.000Z',
  last_message_preview: '[omitido]',
  created_at:           '2026-09-20T10:00:00.000Z',
  updated_at:           '2026-09-21T12:00:00.000Z',
}

// ── Testes ────────────────────────────────────────────────────────────────────

// H-01 — sem companyId
it('H-01: sem companyId → zero request, estado limpo imediato', () => {
  const { result } = renderHook(() =>
    useMetaChatData(undefined, INSTANCE_A)
  )
  expect(mockGetConversations).not.toHaveBeenCalled()
  expect(result.current.conversations).toEqual([])
  expect(result.current.loading).toBe(false)
  expect(result.current.error).toBeNull()
  expect(result.current.selectedConversationId).toBeNull()
})

// H-02 — sem selectedInstanceId
it('H-02: sem selectedInstanceId → zero request, estado limpo imediato', () => {
  const { result } = renderHook(() =>
    useMetaChatData(COMPANY_A, undefined)
  )
  expect(mockGetConversations).not.toHaveBeenCalled()
  expect(result.current.conversations).toEqual([])
  expect(result.current.loading).toBe(false)
  expect(result.current.error).toBeNull()
})

// H-03 — fetch com instanceId correto
it('H-03: com company + instance → chama getConversations com instanceId', async () => {
  mockGetConversations.mockResolvedValueOnce([FAKE_CONV])

  const { result } = renderHook(() =>
    useMetaChatData(COMPANY_A, INSTANCE_A)
  )

  await act(async () => {
    await Promise.resolve()
  })

  expect(mockGetConversations).toHaveBeenCalledTimes(1)
  expect(mockGetConversations).toHaveBeenCalledWith(COMPANY_A, { instanceId: INSTANCE_A })
})

// H-04 — loading durante fetch
it('H-04: loading=true enquanto fetch está em andamento', async () => {
  let resolveFetch!: (v: MetaChatConversation[]) => void
  const pending = new Promise<MetaChatConversation[]>(res => { resolveFetch = res })
  mockGetConversations.mockReturnValueOnce(pending)

  const { result } = renderHook(() =>
    useMetaChatData(COMPANY_A, INSTANCE_A)
  )

  // Imediatamente após o mount, loading deve ser true
  expect(result.current.loading).toBe(true)

  // Resolver o fetch e aguardar
  await act(async () => {
    resolveFetch([])
    await Promise.resolve()
  })

  expect(result.current.loading).toBe(false)
})

// H-05 — success com lista vazia
it('H-05: success com lista vazia → conversations=[], loading=false, error=null', async () => {
  mockGetConversations.mockResolvedValueOnce([])

  const { result } = renderHook(() =>
    useMetaChatData(COMPANY_A, INSTANCE_A)
  )

  await act(async () => { await Promise.resolve() })

  expect(result.current.conversations).toEqual([])
  expect(result.current.loading).toBe(false)
  expect(result.current.error).toBeNull()
})

// H-06 — success com conversations
it('H-06: success → conversations populadas, loading=false, error=null', async () => {
  mockGetConversations.mockResolvedValueOnce([FAKE_CONV])

  const { result } = renderHook(() =>
    useMetaChatData(COMPANY_A, INSTANCE_A)
  )

  await act(async () => { await Promise.resolve() })

  expect(result.current.conversations).toHaveLength(1)
  expect(result.current.conversations[0].id).toBe(CONV_ID)
  expect(result.current.loading).toBe(false)
  expect(result.current.error).toBeNull()
})

// H-07 — error
it('H-07: fetch rejeita → error exposta, conversations=[], loading=false', async () => {
  mockGetConversations.mockRejectedValueOnce(new Error('feature_disabled'))

  const { result } = renderHook(() =>
    useMetaChatData(COMPANY_A, INSTANCE_A)
  )

  await act(async () => { await Promise.resolve() })

  expect(result.current.error).toBe('feature_disabled')
  expect(result.current.conversations).toEqual([])
  expect(result.current.loading).toBe(false)
})

// H-08 — troca de instance limpa selectedConversationId
it('H-08: troca de instance limpa selectedConversationId', async () => {
  mockGetConversations.mockResolvedValue([FAKE_CONV])

  const { result, rerender } = renderHook(
    ({ instanceId }) => useMetaChatData(COMPANY_A, instanceId),
    { initialProps: { instanceId: INSTANCE_A } }
  )

  await act(async () => { await Promise.resolve() })

  // Selecionar uma conversa
  act(() => {
    result.current.setSelectedConversation(CONV_ID)
  })
  expect(result.current.selectedConversationId).toBe(CONV_ID)

  // Trocar instância
  await act(async () => {
    rerender({ instanceId: INSTANCE_B })
    await Promise.resolve()
  })

  expect(result.current.selectedConversationId).toBeNull()
})

// H-09 — troca de instance limpa conversations antes do fetch
it('H-09: troca de instance → conversations limpa antes de novo fetch completar', async () => {
  mockGetConversations.mockResolvedValueOnce([FAKE_CONV])  // instância A

  let resolveB!: (v: MetaChatConversation[]) => void
  const pendingB = new Promise<MetaChatConversation[]>(res => { resolveB = res })
  mockGetConversations.mockReturnValueOnce(pendingB)  // instância B — pendente

  const { result, rerender } = renderHook(
    ({ instanceId }) => useMetaChatData(COMPANY_A, instanceId),
    { initialProps: { instanceId: INSTANCE_A } }
  )

  await act(async () => { await Promise.resolve() })
  expect(result.current.conversations).toHaveLength(1)  // A carregou

  // Trocar para B — fetch B ainda pendente
  rerender({ instanceId: INSTANCE_B })

  // Enquanto B carrega, conversations deve ser [] (limpas imediatamente)
  expect(result.current.conversations).toEqual([])

  await act(async () => {
    resolveB([])
    await Promise.resolve()
  })
})

// H-10 — anti-stale A→B
it('H-10: resposta de fetch A não sobrescreve resultado de fetch B', async () => {
  let resolveA!: (v: MetaChatConversation[]) => void
  const pendingA = new Promise<MetaChatConversation[]>(res => { resolveA = res })

  const CONV_B: MetaChatConversation = { ...FAKE_CONV, id: 'conv-B-0001', instance_id: INSTANCE_B }

  mockGetConversations
    .mockReturnValueOnce(pendingA)                  // fetch A — pendente
    .mockResolvedValueOnce([CONV_B])               // fetch B — resolve rápido

  const { result, rerender } = renderHook(
    ({ instanceId }) => useMetaChatData(COMPANY_A, instanceId),
    { initialProps: { instanceId: INSTANCE_A } }
  )

  // Trocar para B antes de A completar
  rerender({ instanceId: INSTANCE_B })

  // Aguardar B completar
  await act(async () => { await Promise.resolve() })

  // Agora completar A com dados stale
  await act(async () => {
    resolveA([FAKE_CONV])
    await Promise.resolve()
  })

  // Resultado deve ser de B, não de A
  expect(result.current.conversations).toHaveLength(1)
  expect(result.current.conversations[0].id).toBe('conv-B-0001')
})

// H-11 — unmount não atualiza state
it('H-11: unmount antes do fetch completar → zero setState após desmontagem', async () => {
  // Spy em console.error para detectar warning de "setState no componente desmontado"
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  let resolveAfterUnmount!: (v: MetaChatConversation[]) => void
  const pendingLong = new Promise<MetaChatConversation[]>(res => { resolveAfterUnmount = res })
  mockGetConversations.mockReturnValueOnce(pendingLong)

  const { unmount } = renderHook(() =>
    useMetaChatData(COMPANY_A, INSTANCE_A)
  )

  // Desmontar antes do fetch completar
  unmount()

  // Completar o fetch após unmount — não deve causar erro/warning
  await act(async () => {
    resolveAfterUnmount([FAKE_CONV])
    await Promise.resolve()
  })

  // React 18 não lança warning de setState pós-unmount, mas consoleSpy capturaria
  expect(consoleSpy).not.toHaveBeenCalledWith(
    expect.stringContaining('unmounted')
  )

  consoleSpy.mockRestore()
})

// H-12 — refresh()
it('H-12: refresh() dispara novo fetch', async () => {
  mockGetConversations
    .mockResolvedValueOnce([])           // primeiro fetch
    .mockResolvedValueOnce([FAKE_CONV]) // após refresh

  const { result } = renderHook(() =>
    useMetaChatData(COMPANY_A, INSTANCE_A)
  )

  await act(async () => { await Promise.resolve() })
  expect(result.current.conversations).toEqual([])

  await act(async () => {
    result.current.refresh()
    await Promise.resolve()
  })

  expect(mockGetConversations).toHaveBeenCalledTimes(2)
  expect(result.current.conversations).toHaveLength(1)
})

// H-13 — setSelectedConversation apenas local
it('H-13: setSelectedConversation atualiza estado local sem chamar API', async () => {
  mockGetConversations.mockResolvedValueOnce([FAKE_CONV])

  const { result } = renderHook(() =>
    useMetaChatData(COMPANY_A, INSTANCE_A)
  )

  await act(async () => { await Promise.resolve() })

  act(() => {
    result.current.setSelectedConversation(CONV_ID)
  })

  expect(result.current.selectedConversationId).toBe(CONV_ID)
  // getConversations só foi chamado 1x (no mount) — setSelectedConversation não dispara fetch
  expect(mockGetConversations).toHaveBeenCalledTimes(1)
})

// H-14 — companyId passa a undefined → limpa estado
it('H-14: companyId passa a undefined → estado limpa, zero fetch adicional', async () => {
  mockGetConversations.mockResolvedValueOnce([FAKE_CONV])

  const { result, rerender } = renderHook(
    ({ companyId }) => useMetaChatData(companyId, INSTANCE_A),
    { initialProps: { companyId: COMPANY_A as string | undefined } }
  )

  await act(async () => { await Promise.resolve() })
  expect(result.current.conversations).toHaveLength(1)

  await act(async () => {
    rerender({ companyId: undefined })
    await Promise.resolve()
  })

  expect(result.current.conversations).toEqual([])
  expect(result.current.loading).toBe(false)
  expect(result.current.error).toBeNull()
  // Apenas 1 chamada no total (apenas com company presente)
  expect(mockGetConversations).toHaveBeenCalledTimes(1)
})

// =============================================================================
// REALTIME — MVP3E B2
// =============================================================================

// RT-CONV-01 — IDs válidos → cria channel em meta_conversations
it('RT-CONV-01: companyId + selectedInstanceId válidos → cria channel Realtime', async () => {
  mockGetConversations.mockResolvedValueOnce([])

  renderHook(() => useMetaChatData(COMPANY_A, INSTANCE_A))
  await act(async () => { await Promise.resolve() })

  expect(mockRtConv.channels).toHaveLength(1)
  expect(mockRtConv.last()?.channelName).toBe(`meta_conversations_${COMPANY_A}_${INSTANCE_A}`)
})

// RT-CONV-02 — configuração correta do .on()
it('RT-CONV-02: subscription usa UPDATE / public / meta_conversations', async () => {
  mockGetConversations.mockResolvedValueOnce([])

  renderHook(() => useMetaChatData(COMPANY_A, INSTANCE_A))
  await act(async () => { await Promise.resolve() })

  const ch = mockRtConv.last()
  expect(ch).not.toBeNull()
  expect(ch!.event).toBe('UPDATE')
  expect(ch!.schema).toBe('public')
  expect(ch!.table).toBe('meta_conversations')
})

// RT-CONV-03 — filtro correto
it('RT-CONV-03: filtro = company_id=eq.<companyId>', async () => {
  mockGetConversations.mockResolvedValueOnce([])

  renderHook(() => useMetaChatData(COMPANY_A, INSTANCE_A))
  await act(async () => { await Promise.resolve() })

  expect(mockRtConv.last()?.filter).toBe(`company_id=eq.${COMPANY_A}`)
})

// RT-CONV-04 — UPDATE → dispara GET canônico
it('RT-CONV-04: evento UPDATE → dispara load()/GET canônico', async () => {
  const CONV_UPDATED: MetaChatConversation = {
    ...FAKE_CONV,
    unread_count:         2,
    last_message_preview: 'nova mensagem',
    last_message_at:      '2026-09-21T19:00:00.000Z',
  }

  mockGetConversations
    .mockResolvedValueOnce([FAKE_CONV])   // fetch inicial
    .mockResolvedValueOnce([CONV_UPDATED]) // fetch após RT

  const { result } = renderHook(() => useMetaChatData(COMPANY_A, INSTANCE_A))
  await act(async () => { await Promise.resolve() })

  expect(mockGetConversations).toHaveBeenCalledTimes(1)

  // Simular evento UPDATE via Realtime
  await act(async () => {
    mockRtConv.last()?.simulateUpdate({ id: CONV_ID, company_id: COMPANY_A })
    await Promise.resolve()
  })

  // load() deve ter sido disparado pelo sinal de invalidação
  expect(mockGetConversations).toHaveBeenCalledTimes(2)
  expect(mockGetConversations).toHaveBeenNthCalledWith(2, COMPANY_A, { instanceId: INSTANCE_A })
  expect(result.current.conversations[0].unread_count).toBe(2)
})

// RT-CONV-05 — companyId ausente → nenhum channel
it('RT-CONV-05: companyId undefined → nenhum channel Realtime criado', () => {
  mockGetConversations.mockResolvedValueOnce([])

  renderHook(() => useMetaChatData(undefined, INSTANCE_A))

  expect(mockRtConv.channels).toHaveLength(0)
})

// RT-CONV-06 — selectedInstanceId ausente → nenhum channel
it('RT-CONV-06: selectedInstanceId undefined → nenhum channel Realtime criado', () => {
  mockGetConversations.mockResolvedValueOnce([])

  renderHook(() => useMetaChatData(COMPANY_A, undefined))

  expect(mockRtConv.channels).toHaveLength(0)
})

// RT-CONV-07 — company A→B → channel A unsubscribed + channel B criado
it('RT-CONV-07: company A→B → channel A unsubscribed + channel B criado', async () => {
  mockGetConversations.mockResolvedValue([])

  const { rerender } = renderHook(
    ({ companyId }) => useMetaChatData(companyId, INSTANCE_A),
    { initialProps: { companyId: COMPANY_A } }
  )
  await act(async () => { await Promise.resolve() })

  const channelA = mockRtConv.get(0)!
  expect(channelA.channelName).toBe(`meta_conversations_${COMPANY_A}_${INSTANCE_A}`)

  // Trocar company
  rerender({ companyId: COMPANY_B })
  await act(async () => { await Promise.resolve() })

  // Channel A deve ter sido unsubscribed
  expect(channelA.unsubscribeFn).toHaveBeenCalledTimes(1)

  // Channel B deve ter sido criado
  expect(mockRtConv.channels).toHaveLength(2)
  expect(mockRtConv.get(1)!.channelName).toBe(`meta_conversations_${COMPANY_B}_${INSTANCE_A}`)
})

// RT-CONV-08 — instance A→B → channel A unsubscribed + channel B criado
it('RT-CONV-08: instance A→B → channel A unsubscribed + channel B criado', async () => {
  mockGetConversations.mockResolvedValue([])

  const { rerender } = renderHook(
    ({ instanceId }) => useMetaChatData(COMPANY_A, instanceId),
    { initialProps: { instanceId: INSTANCE_A } }
  )
  await act(async () => { await Promise.resolve() })

  const channelA = mockRtConv.get(0)!
  expect(channelA.channelName).toBe(`meta_conversations_${COMPANY_A}_${INSTANCE_A}`)

  // Trocar instância
  rerender({ instanceId: INSTANCE_B })
  await act(async () => { await Promise.resolve() })

  // Channel A deve ter sido unsubscribed
  expect(channelA.unsubscribeFn).toHaveBeenCalledTimes(1)

  // Channel B criado com nova instância
  expect(mockRtConv.channels).toHaveLength(2)
  expect(mockRtConv.get(1)!.channelName).toBe(`meta_conversations_${COMPANY_A}_${INSTANCE_B}`)
})

// RT-CONV-09 — callback tardio de context anterior → NÃO dispara load
it('RT-CONV-09: callback tardio de context anterior (company+instance) → NÃO dispara load', async () => {
  mockGetConversations.mockResolvedValue([])

  const { rerender } = renderHook(
    ({ companyId, instanceId }) => useMetaChatData(companyId, instanceId),
    { initialProps: { companyId: COMPANY_A, instanceId: INSTANCE_A } }
  )
  await act(async () => { await Promise.resolve() })

  // Capturar channel A antes da troca
  const channelA = mockRtConv.get(0)!

  // Trocar para contexto B (outra empresa e instância)
  rerender({ companyId: COMPANY_B, instanceId: INSTANCE_B })
  await act(async () => { await Promise.resolve() })

  const callsBeforeLate = mockGetConversations.mock.calls.length

  // Disparar evento tardio do channel A após a troca
  await act(async () => {
    channelA.simulateUpdate({ id: CONV_ID, company_id: COMPANY_A })
    await Promise.resolve()
  })

  // Nenhum fetch adicional deve ter sido disparado
  expect(mockGetConversations.mock.calls.length).toBe(callsBeforeLate)
})

// RT-CONV-10 — unmount → channel.unsubscribe()
it('RT-CONV-10: unmount → channel.unsubscribe() chamado', async () => {
  mockGetConversations.mockResolvedValueOnce([])

  const { unmount } = renderHook(() => useMetaChatData(COMPANY_A, INSTANCE_A))
  await act(async () => { await Promise.resolve() })

  const ch = mockRtConv.last()!
  expect(ch.unsubscribeFn).not.toHaveBeenCalled()

  unmount()

  expect(ch.unsubscribeFn).toHaveBeenCalledTimes(1)
})

// RT-CONV-11 — evento após unmount → nenhum load útil
it('RT-CONV-11: evento Realtime após unmount → nenhum load disparado', async () => {
  mockGetConversations.mockResolvedValueOnce([])

  const { unmount } = renderHook(() => useMetaChatData(COMPANY_A, INSTANCE_A))
  await act(async () => { await Promise.resolve() })

  const ch = mockRtConv.last()!
  const callsBefore = mockGetConversations.mock.calls.length

  unmount()

  await act(async () => {
    ch.simulateUpdate({ id: CONV_ID, company_id: COMPANY_A })
    await Promise.resolve()
  })

  // mountedRef.current = false → load não executado
  expect(mockGetConversations.mock.calls.length).toBe(callsBefore)
})

// RT-CONV-12 — payload não é aplicado diretamente a conversations
it('RT-CONV-12: payload Realtime não é aplicado diretamente ao estado de conversations', async () => {
  const CONV_FRESH: MetaChatConversation = { ...FAKE_CONV, unread_count: 99 }

  mockGetConversations
    .mockResolvedValueOnce([FAKE_CONV])  // fetch inicial
    .mockResolvedValueOnce([FAKE_CONV])  // fetch após RT — ainda sem novidades

  const { result } = renderHook(() => useMetaChatData(COMPANY_A, INSTANCE_A))
  await act(async () => { await Promise.resolve() })

  // Disparar evento com payload contendo unread_count = 99
  const payloadFake = { id: CONV_ID, company_id: COMPANY_A, unread_count: 99 }
  await act(async () => {
    mockRtConv.last()?.simulateUpdate(payloadFake)
    await Promise.resolve()
  })

  // O unread_count NÃO deve ser 99 (que veio do payload)
  // O GET foi chamado → retornou FAKE_CONV (unread_count = 1) → esse é o estado correto
  expect(result.current.conversations[0].unread_count).not.toBe(CONV_FRESH.unread_count)
  expect(result.current.conversations[0].unread_count).toBe(FAKE_CONV.unread_count)

  // GET foi chamado 2x: mount + Realtime
  expect(mockGetConversations).toHaveBeenCalledTimes(2)
})

// RT-CONV-13 — UPDATE de outra instância mesma company → GET canônico; sem payload
it('RT-CONV-13: UPDATE de outra instância da mesma company pode disparar GET; resultado vem do GET', async () => {
  // Este teste documenta conscientemente a limitação do filtro company_id:
  // eventos de instâncias diferentes da mesma company chegam ao channel.
  // O guard de instance NÃO rejeita isso — o evento chega com o capturedInstanceId
  // correto (mesma instância). O GET é chamado com selectedInstanceId correto.
  // Payload é ignorado — GET determina o resultado.

  const CONV_AFTER_RT: MetaChatConversation = {
    ...FAKE_CONV,
    last_message_preview: 'mensagem atualizada',
    last_message_at:      '2026-09-21T20:00:00.000Z',
  }

  mockGetConversations
    .mockResolvedValueOnce([FAKE_CONV])      // fetch inicial
    .mockResolvedValueOnce([CONV_AFTER_RT])  // fetch após RT

  const { result } = renderHook(() => useMetaChatData(COMPANY_A, INSTANCE_A))
  await act(async () => { await Promise.resolve() })

  // Simular UPDATE de qualquer conversa da company (pode ser outra instância no sistema real)
  const payloadOutraInstancia = {
    id:          'conv-outra-instancia',
    company_id:  COMPANY_A,
    instance_id: 'instance-outra-0099',   // instância diferente de INSTANCE_A
    unread_count: 5,
  }

  await act(async () => {
    mockRtConv.last()?.simulateUpdate(payloadOutraInstancia)
    await Promise.resolve()
  })

  // GET foi chamado e retornou CONV_AFTER_RT — resultado vem do GET
  expect(mockGetConversations).toHaveBeenCalledTimes(2)
  expect(mockGetConversations).toHaveBeenNthCalledWith(2, COMPANY_A, { instanceId: INSTANCE_A })
  expect(result.current.conversations[0].last_message_preview).toBe('mensagem atualizada')

  // Nenhum dado do payload (instance outra, unread 5) no estado
  expect(result.current.conversations[0].unread_count).toBe(FAKE_CONV.unread_count) // original do GET
})
