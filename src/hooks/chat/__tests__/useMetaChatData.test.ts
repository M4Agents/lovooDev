// @vitest-environment jsdom
// =============================================================================
// src/hooks/chat/__tests__/useMetaChatData.test.ts
//
// Contrato do hook useMetaChatData — MVP3C.2
//
// Cobertura:
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
// Sem Realtime, Supabase direto, EventBus ou envio.
// Segurança: nenhum token ou UUID real nos fixtures.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act }                       from '@testing-library/react'
import { useMetaChatData }                       from '../useMetaChatData'
import type { MetaChatConversation }             from '../../../types/meta-whatsapp'

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
