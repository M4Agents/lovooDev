// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstagramChatConversation, InstagramChatMessage } from '../../../types/instagram-chat'
import { useInstagramChatData } from '../useInstagramChatData'

const COMPANY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const COMPANY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OFFICIAL_ID = '11111111-1111-4111-8111-111111111111'
const BYO_ID = '22222222-2222-4222-8222-222222222222'

const realtime = vi.hoisted(() => ({
  channels: [] as Array<{
    name: string
    handler?: (payload: { eventType?: string; new?: unknown }) => void
  }>,
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'token' } } }),
    },
    channel: (name: string) => {
      const entry: { name: string; handler?: (payload: { eventType?: string; new?: unknown }) => void } = { name }
      realtime.channels.push(entry)
      const api = {
        on: (_kind: string, _config: unknown, handler?: (payload: { eventType?: string; new?: unknown }) => void) => {
          if (handler) entry.handler = handler
          return api
        },
        subscribe: () => api,
        unsubscribe: () => undefined,
      }
      return api
    },
  },
}))

type Pending = {
  url: string
  method: string
  resolve: (value: { ok: boolean; status: number; json: () => Promise<unknown> }) => void
}

const calls: Array<{ url: string; method: string }> = []
const pending: Pending[] = []

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

function param(url: string, key: string) {
  return new URL(url, 'http://localhost').searchParams.get(key)
}

function conversation(id: string, overrides: Partial<InstagramChatConversation> = {}): InstagramChatConversation {
  return {
    id,
    company_id: COMPANY_A,
    connection_id: OFFICIAL_ID,
    byo_account_id: null,
    byo_instagram_username: null,
    ig_thread_id: id,
    ig_participant_id: id,
    participant_name: 'Ana',
    participant_username: 'ana',
    participant_avatar: null,
    lead_id: null,
    status: 'active',
    unread_count: 0,
    last_message_preview: 'ola',
    last_message_at: '2026-10-30T00:00:00.000Z',
    assigned_to: null,
    created_at: '2026-10-30T00:00:00.000Z',
    updated_at: '2026-10-30T00:00:00.000Z',
    ...overrides,
  }
}

function message(id: string, conversationId: string): InstagramChatMessage {
  return {
    id,
    conversation_id: conversationId,
    company_id: COMPANY_A,
    ig_message_id: id,
    direction: 'inbound',
    message_type: 'text',
    content: 'mensagem antiga',
    media_url: null,
    sent_by: null,
    status: 'sent',
    timestamp: '2026-10-30T00:00:00.000Z',
    created_at: '2026-10-30T00:00:00.000Z',
    reply_to_ig_message_id: null,
    reply_to_content: null,
    reply_to_direction: null,
    reactions: [],
  }
}

async function take(match: (url: string, method: string) => boolean) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const index = pending.findIndex((item) => match(item.url, item.method))
    if (index >= 0) return pending.splice(index, 1)[0]
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(`requisição ausente: ${calls.map((call) => `${call.method} ${call.url}`).join(' | ')}`)
}

function conversationGets() {
  return calls.filter((call) => call.method === 'GET' && call.url.includes('/api/instagram/conversations'))
}

function listHandlers() {
  return realtime.channels.filter((channel) => channel.name.startsWith('ig_conversations_') && channel.handler)
}

function lastListHandler() {
  const handlers = listHandlers()
  const handler = handlers[handlers.length - 1]?.handler
  if (!handler) throw new Error('assinatura da lista ausente')
  return handler
}

function lastMessageHandler() {
  const handlers = realtime.channels.filter((channel) => channel.name.startsWith('ig_messages_') && channel.handler)
  const handler = handlers[handlers.length - 1]?.handler
  if (!handler) throw new Error('assinatura de mensagens ausente')
  return handler
}

describe('useInstagramChatData — respostas obsoletas', () => {
  beforeEach(() => {
    calls.length = 0
    pending.length = 0
    realtime.channels.length = 0
    localStorage.clear()
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method })
      return new Promise((resolve) => {
        pending.push({ url, method, resolve })
      })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function renderCompany(companyId = COMPANY_A) {
    const rendered = renderHook(
      ({ companyId: current }: { companyId: string }) => useInstagramChatData(current, 'user-1', true),
      { initialProps: { companyId } },
    )
    const connections = await take((url) => url.includes('/api/instagram/connections'))
    await act(async () => {
      connections.resolve(jsonResponse({ connections: [], byo_accounts: [] }))
    })
    const list = await take((url, method) => method === 'GET' && url.includes('/api/instagram/conversations'))
    return { ...rendered, list }
  }

  it('descarta a lista da empresa A quando a empresa B já está ativa', async () => {
    const { result, rerender, list } = await renderCompany()
    rerender({ companyId: COMPANY_B })
    expect(result.current.conversations).toEqual([])
    expect(result.current.selectedConversationId).toBeUndefined()
    expect(result.current.messages).toEqual([])

    const connectionsB = await take((url) => url.includes('/api/instagram/connections') && url.includes(COMPANY_B))
    await act(async () => {
      connectionsB.resolve(jsonResponse({ connections: [], byo_accounts: [] }))
    })
    const listB = await take((url, method) => (
      method === 'GET'
      && url.includes('/api/instagram/conversations')
      && param(url, 'company_id') === COMPANY_B
    ))
    expect(result.current.conversationsLoading).toBe(true)
    await act(async () => {
      list.resolve(jsonResponse({
        conversations: [conversation('da-empresa-a')],
        total: 9,
        next_cursor: { at: '2026-10-30T00:00:00.000Z', id: 'da-empresa-a' },
      }))
    })
    expect(result.current.conversations).toEqual([])
    expect(result.current.conversationsLoading).toBe(true)
    expect(result.current.conversationTotal).not.toBe(9)

    await act(async () => {
      listB.resolve(jsonResponse({
        conversations: [conversation('da-empresa-b', { company_id: COMPANY_B })],
        total: 1,
        next_cursor: null,
      }))
    })
    expect(result.current.conversations.map((item) => item.id)).toEqual(['da-empresa-b'])
    expect(result.current.conversationTotal).toBe(1)
  })

  it('descarta a lista oficial quando a seleção já é BYO', async () => {
    const { result, list } = await renderCompany()
    await act(async () => {
      list.resolve(jsonResponse({ conversations: [], total: 0, next_cursor: null }))
    })
    act(() => { result.current.setSelectedConnection(`official:${OFFICIAL_ID}`) })
    const official = await take((url) => param(url, 'owner') === `official:${OFFICIAL_ID}`)
    act(() => { result.current.setSelectedConnection(`byo:${BYO_ID}`) })
    const byo = await take((url) => param(url, 'owner') === `byo:${BYO_ID}`)
    await act(async () => {
      official.resolve(jsonResponse({
        conversations: [conversation('oficial-atrasada')],
        total: 1,
        next_cursor: null,
      }))
    })
    expect(result.current.conversations).toEqual([])
    await act(async () => {
      byo.resolve(jsonResponse({
        conversations: [conversation('byo-atual', { connection_id: null, byo_account_id: BYO_ID })],
        total: 1,
        next_cursor: null,
      }))
    })
    expect(result.current.conversations.map((item) => item.id)).toEqual(['byo-atual'])
  })

  it('descarta Todas quando a seleção já é BYO', async () => {
    const { result, list } = await renderCompany()
    act(() => { result.current.setSelectedConnection(`byo:${BYO_ID}`) })
    const byo = await take((url) => param(url, 'owner') === `byo:${BYO_ID}`)
    await act(async () => {
      list.resolve(jsonResponse({
        conversations: [conversation('todas-atrasada')],
        total: 1,
        next_cursor: null,
      }))
    })
    expect(result.current.conversations.map((item) => item.id)).not.toContain('todas-atrasada')
    await act(async () => {
      byo.resolve(jsonResponse({
        conversations: [conversation('so-byo', { connection_id: null, byo_account_id: BYO_ID })],
        total: 1,
        next_cursor: null,
      }))
    })
    expect(result.current.conversations.map((item) => item.id)).toEqual(['so-byo'])
  })

  it('descarta a página adicional quando o refresh já começou', async () => {
    const { result, list } = await renderCompany()
    await act(async () => {
      list.resolve(jsonResponse({
        conversations: [conversation('pagina-1')],
        total: 2,
        next_cursor: { at: '2026-10-30T00:00:00.000Z', id: 'pagina-1' },
      }))
    })
    act(() => { result.current.loadMoreConversations() })
    const page = await take((url) => url.includes('cursor_id=pagina-1'))
    act(() => { result.current.refreshConversations() })
    await act(async () => {
      page.resolve(jsonResponse({
        conversations: [conversation('pagina-2')],
        total: 2,
        next_cursor: null,
      }))
    })
    expect(result.current.conversations.map((item) => item.id)).toEqual(['pagina-1'])
    const refresh = await take((url, method) => (
      method === 'GET'
      && url.includes('/api/instagram/conversations')
      && !url.includes('cursor_id=')
    ))
    await act(async () => {
      refresh.resolve(jsonResponse({
        conversations: [conversation('atualizada')],
        total: 1,
        next_cursor: null,
      }))
    })
    expect(result.current.conversations.map((item) => item.id)).toEqual(['atualizada'])
    expect(result.current.conversationPageError).toBe(false)
  })

  it('não reabre mensagens da empresa A depois da troca', async () => {
    const { result, rerender, list } = await renderCompany()
    await act(async () => {
      list.resolve(jsonResponse({
        conversations: [conversation('conv-a')],
        total: 1,
        next_cursor: null,
      }))
    })
    act(() => { result.current.setSelectedConversation('conv-a') })
    const messages = await take((url) => url.includes('/conversations/conv-a/messages'))
    rerender({ companyId: COMPANY_B })
    expect(result.current.selectedConversationId).toBeUndefined()
    expect(result.current.messages).toEqual([])
    await act(async () => {
      messages.resolve(jsonResponse({ messages: [message('antiga', 'conv-a')] }))
    })
    expect(result.current.messages).toEqual([])
    expect(result.current.selectedConversationId).toBeUndefined()
  })

  it('não aplica enriquecimento, envio nem reação atrasados', async () => {
    const { result, rerender, list } = await renderCompany()
    await act(async () => {
      list.resolve(jsonResponse({
        conversations: [conversation('conv-a', { participant_name: null })],
        total: 1,
        next_cursor: null,
      }))
    })
    act(() => { result.current.setSelectedConversation('conv-a') })
    const enrich = await take((url, method) => method === 'POST' && url.includes('/enrich-participant'))
    const messages = await take((url) => url.includes('/messages'))
    await act(async () => {
      messages.resolve(jsonResponse({ messages: [message('m1', 'conv-a')] }))
    })
    let sendDone = Promise.resolve()
    let reactDone = Promise.resolve()
    act(() => {
      sendDone = result.current.sendMessage({ text: 'oi' })
      reactDone = result.current.reactToMessage({ ig_message_id: 'm1', emoji: 'like', action: 'react' })
    })
    const send = await take((url, method) => method === 'POST' && url.endsWith('/send'))
    const react = await take((url, method) => method === 'POST' && url.endsWith('/react'))
    rerender({ companyId: COMPANY_B })
    await act(async () => {
      enrich.resolve(jsonResponse({
        participant_name: 'Nome atrasado',
        participant_username: 'atrasado',
        participant_avatar: null,
      }))
      send.resolve(jsonResponse({
        message: { ...message('enviada', 'conv-a'), content: 'oi', direction: 'outbound' },
      }))
      react.resolve(jsonResponse({ ok: true }))
      await sendDone
      await reactDone
    })
    expect(result.current.messages).toEqual([])
    expect(result.current.conversations.some((item) => item.participant_name === 'Nome atrasado')).toBe(false)
    expect(result.current.sendError).toBeUndefined()
  })

  it('registra o erro da segunda página sem repetir sozinho e recupera no retry', async () => {
    const { result, list } = await renderCompany()
    await act(async () => {
      list.resolve(jsonResponse({
        conversations: [conversation('pagina-1')],
        total: 2,
        next_cursor: { at: '2026-10-30T00:00:00.000Z', id: 'pagina-1' },
      }))
    })
    act(() => { result.current.loadMoreConversations() })
    const page = await take((url) => url.includes('cursor_id=pagina-1'))
    await act(async () => {
      page.resolve(jsonResponse({ error: 'falhou' }, false, 500))
    })
    expect(result.current.conversationPageError).toBe(true)
    expect(result.current.conversations.map((item) => item.id)).toEqual(['pagina-1'])
    expect(result.current.hasMoreConversations).toBe(true)
    const before = conversationGets().length
    act(() => { result.current.loadMoreConversations() })
    await act(async () => { await Promise.resolve() })
    expect(conversationGets().length).toBe(before)

    act(() => { result.current.retryLoadMoreConversations() })
    const retry = await take((url) => url.includes('cursor_id=pagina-1'))
    await act(async () => {
      retry.resolve(jsonResponse({
        conversations: [conversation('pagina-2')],
        total: 2,
        next_cursor: null,
      }))
    })
    expect(result.current.conversationPageError).toBe(false)
    expect(result.current.conversations.map((item) => item.id)).toEqual(['pagina-1', 'pagina-2'])
  })

  it('carrega e envia na conta oficial', async () => {
    const { result, list } = await renderCompany()
    await act(async () => {
      list.resolve(jsonResponse({ conversations: [], total: 0, next_cursor: null }))
    })
    act(() => { result.current.setSelectedConnection(`official:${OFFICIAL_ID}`) })
    const official = await take((url) => param(url, 'owner') === `official:${OFFICIAL_ID}`)
    await act(async () => {
      official.resolve(jsonResponse({
        conversations: [conversation('oficial')],
        total: 1,
        next_cursor: null,
      }))
    })
    act(() => { result.current.setSelectedConversation('oficial') })
    const messages = await take((url) => url.includes('/conversations/oficial/messages'))
    await act(async () => {
      messages.resolve(jsonResponse({ messages: [message('recebida', 'oficial')] }))
    })
    let sent = Promise.resolve()
    act(() => { sent = result.current.sendMessage({ text: 'resposta' }) })
    const send = await take((url, method) => method === 'POST' && url.endsWith('/send'))
    await act(async () => {
      send.resolve(jsonResponse({
        message: { ...message('enviada', 'oficial'), content: 'resposta', direction: 'outbound' },
      }))
      await sent
    })
    expect(result.current.messages.map((item) => item.content)).toEqual(['mensagem antiga', 'resposta'])
    expect(result.current.selectedConnectionId).toBe(`official:${OFFICIAL_ID}`)
  })

  it('mantém o envio BYO bloqueado', async () => {
    const { result, list } = await renderCompany()
    await act(async () => {
      list.resolve(jsonResponse({
        conversations: [conversation('byo', { connection_id: null, byo_account_id: BYO_ID })],
        total: 1,
        next_cursor: null,
      }))
    })
    act(() => { result.current.setSelectedConversation('byo') })
    const before = calls.length
    await act(async () => {
      await result.current.sendMessage({ text: 'nao' })
      await result.current.sendMedia({ media_url: 'https://example.test/a.jpg', media_type: 'image' })
      await result.current.reactToMessage({ ig_message_id: 'ig-1', emoji: 'like', action: 'react' })
    })
    expect(calls.slice(before).some((call) => (
      call.url.includes('/send') || call.url.includes('/react')
    ))).toBe(false)
    expect(result.current.messages).toEqual([])
  })

  it('rejeita INSERT e UPDATE da assinatura antiga depois da troca de empresa', async () => {
    const { result, rerender, list } = await renderCompany()
    await act(async () => {
      list.resolve(jsonResponse({ conversations: [conversation('da-a')], total: 1, next_cursor: null }))
    })
    const handlerA = lastListHandler()
    rerender({ companyId: COMPANY_B })
    const connectionsB = await take((url) => url.includes('/api/instagram/connections') && url.includes(COMPANY_B))
    await act(async () => {
      connectionsB.resolve(jsonResponse({ connections: [], byo_accounts: [] }))
    })
    const listB = await take((url, method) => method === 'GET' && param(url, 'company_id') === COMPANY_B)
    await act(async () => {
      listB.resolve(jsonResponse({
        conversations: [conversation('da-b', { company_id: COMPANY_B, last_message_preview: 'empresa b' })],
        total: 1,
        next_cursor: null,
      }))
    })
    act(() => {
      handlerA({
        eventType: 'INSERT',
        new: conversation('parece-b', { company_id: COMPANY_B }),
      })
      handlerA({
        eventType: 'UPDATE',
        new: conversation('da-b', { company_id: COMPANY_B, last_message_preview: 'vazou' }),
      })
    })
    expect(result.current.conversations.map((item) => item.id)).toEqual(['da-b'])
    expect(result.current.conversations[0]?.last_message_preview).toBe('empresa b')
    expect(result.current.conversationTotal).toBe(1)
  })

  it('rejeita evento oficial antigo depois da seleção BYO e aceita o evento BYO atual', async () => {
    const { result, list } = await renderCompany()
    await act(async () => {
      list.resolve(jsonResponse({ conversations: [], total: 0, next_cursor: null }))
    })
    act(() => { result.current.setSelectedConnection(`official:${OFFICIAL_ID}`) })
    const officialList = await take((url) => param(url, 'owner') === `official:${OFFICIAL_ID}`)
    await act(async () => {
      officialList.resolve(jsonResponse({ conversations: [], total: 0, next_cursor: null }))
    })
    const officialHandler = lastListHandler()
    act(() => {
      officialHandler({
        eventType: 'INSERT',
        new: conversation('oficial-atual'),
      })
    })
    expect(result.current.conversations.map((item) => item.id)).toEqual(['oficial-atual'])
    act(() => { result.current.setSelectedConnection(`byo:${BYO_ID}`) })
    const byoList = await take((url) => param(url, 'owner') === `byo:${BYO_ID}`)
    await act(async () => {
      byoList.resolve(jsonResponse({ conversations: [], total: 0, next_cursor: null }))
    })
    act(() => {
      officialHandler({
        eventType: 'INSERT',
        new: conversation('oficial-atrasado', { company_id: COMPANY_A, connection_id: null, byo_account_id: BYO_ID }),
      })
    })
    expect(result.current.conversations).toEqual([])
    act(() => {
      lastListHandler()({
        eventType: 'INSERT',
        new: conversation('byo-atual', { company_id: COMPANY_A, connection_id: null, byo_account_id: BYO_ID }),
      })
    })
    expect(result.current.conversations.map((item) => item.id)).toEqual(['byo-atual'])
  })

  it('rejeita evento BYO antigo depois de Todas e aceita o evento oficial atual', async () => {
    const { result, list } = await renderCompany()
    await act(async () => {
      list.resolve(jsonResponse({ conversations: [], total: 0, next_cursor: null }))
    })
    act(() => { result.current.setSelectedConnection(`byo:${BYO_ID}`) })
    const byoList = await take((url) => param(url, 'owner') === `byo:${BYO_ID}`)
    await act(async () => {
      byoList.resolve(jsonResponse({ conversations: [], total: 0, next_cursor: null }))
    })
    const byoHandler = lastListHandler()
    act(() => { result.current.setSelectedConnection('all') })
    const allList = await take((url) => param(url, 'owner') === 'all' && !url.includes('cursor_id='))
    await act(async () => {
      allList.resolve(jsonResponse({ conversations: [], total: 0, next_cursor: null }))
    })
    act(() => {
      byoHandler({
        eventType: 'INSERT',
        new: conversation('byo-atrasado', { connection_id: null, byo_account_id: BYO_ID }),
      })
      lastListHandler()({
        eventType: 'INSERT',
        new: conversation('outra-empresa', { company_id: COMPANY_B }),
      })
    })
    expect(result.current.conversations).toEqual([])
    act(() => {
      lastListHandler()({
        eventType: 'INSERT',
        new: conversation('oficial-atual'),
      })
    })
    expect(result.current.conversations.map((item) => item.id)).toEqual(['oficial-atual'])
  })

  it('não aplica lead antigo depois da troca de empresa nem deixa o finally apagar o loading novo', async () => {
    const { result, rerender, list } = await renderCompany()
    await act(async () => {
      list.resolve(jsonResponse({
        conversations: [conversation('conv-a')],
        total: 1,
        next_cursor: null,
      }))
    })
    act(() => { result.current.setSelectedConversation('conv-a') })
    let first = Promise.resolve<Awaited<ReturnType<typeof result.current.createLead>>>(null)
    act(() => { first = result.current.createLead('conv-a', { name: 'Ana', email: 'ana@example.test' }) })
    const firstPost = await take((url, method) => method === 'POST' && url.includes('/conv-a/create-lead'))
    rerender({ companyId: COMPANY_B })
    expect(result.current.createLeadLoading).toBe(false)
    expect(result.current.createLeadError).toBeUndefined()
    expect(result.current.selectedConversationId).toBeUndefined()
    const connectionsB = await take((url) => url.includes('/api/instagram/connections') && url.includes(COMPANY_B))
    await act(async () => {
      connectionsB.resolve(jsonResponse({ connections: [], byo_accounts: [] }))
    })
    const listB = await take((url, method) => method === 'GET' && param(url, 'company_id') === COMPANY_B)
    await act(async () => {
      listB.resolve(jsonResponse({
        conversations: [conversation('conv-b', { company_id: COMPANY_B })],
        total: 1,
        next_cursor: null,
      }))
    })
    act(() => { result.current.setSelectedConversation('conv-b') })
    let second = Promise.resolve<Awaited<ReturnType<typeof result.current.createLead>>>(null)
    act(() => { second = result.current.createLead('conv-b', { name: 'Bia', email: 'bia@example.test' }) })
    const secondPost = await take((url, method) => method === 'POST' && url.includes('/conv-b/create-lead'))
    expect(result.current.createLeadLoading).toBe(true)
    let firstResult: Awaited<ReturnType<typeof result.current.createLead>> = { success: true, action: 'lead_created', lead_id: 1, conversation_id: 'conv-a' }
    await act(async () => {
      firstPost.resolve(jsonResponse({ success: true, action: 'lead_created', lead_id: 11, conversation_id: 'conv-a' }))
      firstResult = await first
    })
    expect(firstResult).toBeNull()
    expect(result.current.createLeadLoading).toBe(true)
    expect(result.current.conversations.find((item) => item.id === 'conv-b')?.lead_id).toBeNull()
    await act(async () => {
      secondPost.resolve(jsonResponse({ success: true, action: 'lead_created', lead_id: 22, conversation_id: 'conv-b' }))
      expect((await second)?.lead_id).toBe(22)
    })
    expect(result.current.conversations.find((item) => item.id === 'conv-b')?.lead_id).toBe(22)
    expect(result.current.createLeadLoading).toBe(false)
    expect(result.current.createLeadError).toBeUndefined()
  })

  it('não aplica lead depois de fechar a conversa e aplica o lead da conversa que continua aberta', async () => {
    const { result, list } = await renderCompany()
    await act(async () => {
      list.resolve(jsonResponse({
        conversations: [conversation('conv-a'), conversation('conv-b')],
        total: 2,
        next_cursor: null,
      }))
    })
    act(() => { result.current.setSelectedConversation('conv-a') })
    let closed = Promise.resolve<Awaited<ReturnType<typeof result.current.createLead>>>(null)
    act(() => { closed = result.current.createLead('conv-a', { name: 'Ana', email: 'ana@example.test' }) })
    const closedPost = await take((url, method) => method === 'POST' && url.includes('/conv-a/create-lead'))
    act(() => { result.current.setSelectedConversation('conv-b') })
    let current = Promise.resolve<Awaited<ReturnType<typeof result.current.createLead>>>(null)
    act(() => { current = result.current.createLead('conv-b', { name: 'Bia', email: 'bia@example.test' }) })
    const currentPost = await take((url, method) => method === 'POST' && url.includes('/conv-b/create-lead'))
    await act(async () => {
      closedPost.resolve(jsonResponse({ success: true, action: 'lead_created', lead_id: 11, conversation_id: 'conv-a' }))
      expect(await closed).toBeNull()
    })
    expect(result.current.conversations.find((item) => item.id === 'conv-a')?.lead_id).toBeNull()
    expect(result.current.createLeadLoading).toBe(true)
    await act(async () => {
      currentPost.resolve(jsonResponse({ success: true, action: 'lead_created', lead_id: 22, conversation_id: 'conv-b' }))
      expect((await current)?.lead_id).toBe(22)
    })
    expect(result.current.conversations.find((item) => item.id === 'conv-b')?.lead_id).toBe(22)
    expect(result.current.selectedConversationId).toBe('conv-b')
    expect(result.current.createLeadLoading).toBe(false)
  })

  it('rejeita mensagem antiga da empresa A depois da troca, mesmo com payload da empresa B', async () => {
    const { result, rerender, list } = await renderCompany()
    await act(async () => {
      list.resolve(jsonResponse({
        conversations: [conversation('conv-a')],
        total: 1,
        next_cursor: null,
      }))
    })
    act(() => { result.current.setSelectedConversation('conv-a') })
    const messagesA = await take((url) => url.includes('/conversations/conv-a/messages'))
    await act(async () => {
      messagesA.resolve(jsonResponse({ messages: [message('da-a', 'conv-a')] }))
    })
    const handlerA = lastMessageHandler()
    rerender({ companyId: COMPANY_B })
    const connectionsB = await take((url) => url.includes('/api/instagram/connections') && url.includes(COMPANY_B))
    await act(async () => {
      connectionsB.resolve(jsonResponse({ connections: [], byo_accounts: [] }))
    })
    const listB = await take((url, method) => method === 'GET' && param(url, 'company_id') === COMPANY_B)
    await act(async () => {
      listB.resolve(jsonResponse({
        conversations: [conversation('conv-b', { company_id: COMPANY_B })],
        total: 1,
        next_cursor: null,
      }))
    })
    act(() => { result.current.setSelectedConversation('conv-b') })
    const messagesB = await take((url) => url.includes('/conversations/conv-b/messages'))
    await act(async () => {
      messagesB.resolve(jsonResponse({ messages: [message('da-b', 'conv-b')] }))
    })
    act(() => {
      handlerA({
        eventType: 'INSERT',
        new: { ...message('vazou', 'conv-b'), company_id: COMPANY_B, content: 'vazou' },
      })
    })
    expect(result.current.messages.map((item) => item.id)).toEqual(['da-b'])
  })

  it('rejeita mensagem antiga da conversa A e aceita o INSERT da conversa aberta', async () => {
    const { result, list } = await renderCompany()
    await act(async () => {
      list.resolve(jsonResponse({
        conversations: [conversation('conv-a'), conversation('conv-b')],
        total: 2,
        next_cursor: null,
      }))
    })
    act(() => { result.current.setSelectedConversation('conv-a') })
    const messagesA = await take((url) => url.includes('/conversations/conv-a/messages'))
    await act(async () => {
      messagesA.resolve(jsonResponse({ messages: [message('da-a', 'conv-a')] }))
    })
    const handlerA = lastMessageHandler()
    act(() => { result.current.setSelectedConversation('conv-b') })
    const messagesB = await take((url) => url.includes('/conversations/conv-b/messages'))
    await act(async () => {
      messagesB.resolve(jsonResponse({ messages: [message('da-b', 'conv-b')] }))
    })
    act(() => {
      handlerA({
        eventType: 'INSERT',
        new: { ...message('vazou', 'conv-b'), content: 'vazou' },
      })
    })
    expect(result.current.messages.map((item) => item.id)).toEqual(['da-b'])
    act(() => {
      lastMessageHandler()({
        eventType: 'INSERT',
        new: { ...message('nova', 'conv-b'), content: 'chegou' },
      })
    })
    expect(result.current.messages.map((item) => item.content)).toEqual(['mensagem antiga', 'chegou'])
  })

  it('mantém o realtime válido depois do retry da mesma conversa', async () => {
    const { result, list } = await renderCompany()
    await act(async () => {
      list.resolve(jsonResponse({
        conversations: [conversation('conv-a')],
        total: 1,
        next_cursor: null,
      }))
    })
    act(() => { result.current.setSelectedConversation('conv-a') })
    const messages = await take((url) => url.includes('/conversations/conv-a/messages'))
    await act(async () => {
      messages.resolve(jsonResponse({ messages: [message('da-a', 'conv-a')] }))
    })
    const handler = lastMessageHandler()
    const channelsBefore = realtime.channels.filter((channel) => channel.name.startsWith('ig_messages_')).length
    act(() => { result.current.setSelectedConversation('conv-a') })
    expect(realtime.channels.filter((channel) => channel.name.startsWith('ig_messages_')).length).toBe(channelsBefore)
    act(() => {
      handler({
        eventType: 'INSERT',
        new: { ...message('nova', 'conv-a'), content: 'depois do retry' },
      })
    })
    expect(result.current.messages.map((item) => item.content)).toEqual(['mensagem antiga', 'depois do retry'])
  })
})
