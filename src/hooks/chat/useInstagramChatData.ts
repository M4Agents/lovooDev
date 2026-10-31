// =====================================================
// HOOK: useInstagramChatData
// =====================================================
// Gerencia dados Instagram no Chat.
// Completamente separado de useChatData (WhatsApp).
//
// Responsabilidades:
//   - Buscar conexões Instagram da empresa
//   - Buscar conversas com filtros
//   - Buscar mensagens da conversa selecionada
//   - Enviar mensagem via backend
//   - Gerenciar estados de loading/error
//   - Persistir seleção de conexão no localStorage

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import type {
  InstagramConnection,
  InstagramByoChatAccount,
  InstagramChatConversation,
  InstagramChatMessage,
  InstagramChannelFilter,
  InstagramSendMessagePayload,
  InstagramSendMediaPayload,
  InstagramReactPayload,
  InstagramMessageReaction,
  CreateInstagramLeadPayload,
  CreateInstagramLeadResponse,
} from '../../types/instagram-chat'
import {
  instagramChatStorageKey,
  legacyInstagramChatStorageKey,
  resolveInstagramChatSelection,
} from './instagramChatSelection'
import {
  instagramMessageEventApplies,
  instagramSubscriptionEventApplies,
  nextInstagramQueryContext,
  sameInstagramMessageContext,
  sameInstagramQueryContext,
  type InstagramMessageContext,
  type InstagramQueryContext,
} from './instagramRequestGate'

// =====================================================
// TIPOS DO RETORNO
// =====================================================

export interface UseInstagramChatDataReturn {
  // Conexões
  connections: InstagramConnection[]
  byoAccounts: InstagramByoChatAccount[]
  selectedConnectionId: string
  connectionsLoading: boolean

  // Conversas
  conversations: InstagramChatConversation[]
  filteredConversations: InstagramChatConversation[]
  conversationTotal: number
  hasMoreConversations: boolean
  loadingMoreConversations: boolean
  conversationPageError: boolean
  selectedConversationId: string | undefined
  filter: InstagramChannelFilter
  conversationsLoading: boolean

  // Mensagens
  messages: InstagramChatMessage[]
  messagesLoading: boolean
  messagesError: string | undefined

  // Reply
  replyingTo: InstagramChatMessage | null
  setReplyingTo: (msg: InstagramChatMessage | null) => void

  // Actions
  setSelectedConnection: (id: string) => void
  setSelectedConversation: (id: string) => void
  setFilter: (f: InstagramChannelFilter) => void
  refreshConversations: () => void
  loadMoreConversations: () => void
  retryLoadMoreConversations: () => void
  sendMessage: (payload: InstagramSendMessagePayload) => Promise<void>
  sendMedia: (payload: InstagramSendMediaPayload) => Promise<void>
  reactToMessage: (payload: InstagramReactPayload) => Promise<void>
  createLead: (conversationId: string, payload: CreateInstagramLeadPayload) => Promise<CreateInstagramLeadResponse | null>
  sendLoading: boolean
  sendMediaLoading: boolean
  createLeadLoading: boolean
  sendError: string | undefined
  createLeadError: string | undefined
  clearSendError: () => void
  clearCreateLeadError: () => void
}

// =====================================================
// HELPERS
// =====================================================

async function fetchWithAuth<T>(url: string): Promise<T> {
  const session = await supabase.auth.getSession()
  const token   = session.data.session?.access_token ?? ''

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

async function postWithAuth<T>(url: string, body: unknown): Promise<T> {
  const session = await supabase.auth.getSession()
  const token   = session.data.session?.access_token ?? ''

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw Object.assign(new Error(data.message ?? data.error ?? `HTTP ${res.status}`), {
      errorCode: data.error,
    })
  }
  return data
}

// =====================================================
// HOOK PRINCIPAL
// =====================================================

export function useInstagramChatData(
  companyId: string,
  userId: string,
  enabled = true
): UseInstagramChatDataReturn {
  const [connections,         setConnections]         = useState<InstagramConnection[]>([])
  const [byoAccounts,         setByoAccounts]         = useState<InstagramByoChatAccount[]>([])
  const [connectionsLoading,  setConnectionsLoading]  = useState(false)
  const [loadedForCompany,   setLoadedForCompany]   = useState<string | null>(null)

  const [selectedConnectionId, setSelectedConnectionIdState] = useState('all')
  const [selectionReady, setSelectionReady] = useState(false)

  const [conversations,        setConversations]        = useState<InstagramChatConversation[]>([])
  const [conversationTotal,    setConversationTotal]    = useState(0)
  const [hasMoreConversations, setHasMoreConversations] = useState(false)
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false)
  const [conversationPageError, setConversationPageError] = useState(false)
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [selectedConversationId, setSelectedConversationIdState] = useState<string | undefined>()
  const [trackedCompanyId, setTrackedCompanyId] = useState(companyId)

  // Ref para acessar conversations dentro do useEffect sem adicioná-la como dependência
  const conversationsRef = useRef(conversations)
  useEffect(() => { conversationsRef.current = conversations }, [conversations])
  const cursorRef = useRef<{ at: string | null; id: string } | null>(null)
  const migratedCompanyRef = useRef<string | null>(null)
  const connectionFetchRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const pageErrorRef = useRef(false)
  const selectionReadyRef = useRef(false)
  const companyIdRef = useRef(companyId)
  const conversationIdRef = useRef('')
  const messageGenerationRef = useRef(0)
  const listContextRef = useRef<InstagramQueryContext>({
    generation: 0,
    companyId,
    owner: 'all',
    filterType: 'all',
    search: '',
  })
  const subscriptionContextRef = useRef<InstagramQueryContext>({
    generation: 0,
    companyId,
    owner: 'all',
    filterType: 'all',
    search: '',
  })
  const leadOperationRef = useRef(0)
  const messageSubscriptionRef = useRef<InstagramMessageContext>({
    generation: 0,
    companyId: '',
    conversationId: '',
  })
  const loadConversationsRef = useRef<(append: boolean) => Promise<void>>(async () => {})

  const [filter, setFilterState] = useState<InstagramChannelFilter>({ type: 'all' })

  const [messages,        setMessages]        = useState<InstagramChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError,   setMessagesError]   = useState<string | undefined>()

  const [sendLoading,      setSendLoading]      = useState(false)
  const [sendMediaLoading, setSendMediaLoading] = useState(false)
  const [createLeadLoading, setCreateLeadLoading] = useState(false)
  const [sendError,        setSendError]        = useState<string | undefined>()
  const [createLeadError,  setCreateLeadError]  = useState<string | undefined>()
  const [replyingTo, setReplyingTo]   = useState<InstagramChatMessage | null>(null)

  selectionReadyRef.current = selectionReady
  companyIdRef.current = companyId
  conversationIdRef.current = selectedConversationId ?? ''

  if (companyId !== trackedCompanyId) {
    setTrackedCompanyId(companyId)
    setSelectionReady(false)
    setSelectedConnectionIdState('all')
    setConversations([])
    setConversationTotal(0)
    setHasMoreConversations(false)
    setLoadingMoreConversations(false)
    setConversationsLoading(false)
    setConversationPageError(false)
    setSelectedConversationIdState(undefined)
    setMessages([])
    setMessagesError(undefined)
    setMessagesLoading(false)
    setReplyingTo(null)
    setSendLoading(false)
    setSendMediaLoading(false)
    setSendError(undefined)
    setCreateLeadLoading(false)
    setCreateLeadError(undefined)
    leadOperationRef.current += 1
    cursorRef.current = null
    pageErrorRef.current = false
    loadingMoreRef.current = false
    selectionReadyRef.current = false
    migratedCompanyRef.current = null
    conversationsRef.current = []
    messageGenerationRef.current += 1
    conversationIdRef.current = ''
    companyIdRef.current = companyId
    listContextRef.current = {
      generation: listContextRef.current.generation + 1,
      companyId,
      owner: 'all',
      filterType: filter.type,
      search: filter.search?.trim() ?? '',
    }
    subscriptionContextRef.current = {
      generation: subscriptionContextRef.current.generation + 1,
      companyId,
      owner: 'all',
      filterType: filter.type,
      search: filter.search?.trim() ?? '',
    }
  } else {
    const advanced = nextInstagramQueryContext(listContextRef.current, {
      companyId,
      owner: selectedConnectionId,
      filterType: filter.type,
      search: filter.search?.trim() ?? '',
    })
    if (advanced !== listContextRef.current) {
      listContextRef.current = advanced
      subscriptionContextRef.current = {
        generation: subscriptionContextRef.current.generation + 1,
        companyId: advanced.companyId,
        owner: advanced.owner,
        filterType: advanced.filterType,
        search: advanced.search,
      }
      cursorRef.current = null
      if (pageErrorRef.current) {
        pageErrorRef.current = false
        setConversationPageError(false)
      }
    }
  }

  const currentMessageContext = (): InstagramMessageContext => ({
    generation: messageGenerationRef.current,
    companyId: companyIdRef.current,
    conversationId: conversationIdRef.current,
  })

  const closeMessageContext = () => {
    messageGenerationRef.current += 1
    conversationIdRef.current = ''
    leadOperationRef.current += 1
    setCreateLeadLoading(false)
    setCreateLeadError(undefined)
  }

  // =====================================================
  // FETCH CONEXÕES
  // =====================================================

  const fetchConnections = useCallback(async () => {
    if (!enabled || !companyId) return
    const generation = connectionFetchRef.current + 1
    connectionFetchRef.current = generation
    try {
      setConnectionsLoading(true)
      const data = await fetchWithAuth<{
        connections?: InstagramConnection[]
        byo_accounts?: InstagramByoChatAccount[]
      }>(
        `/api/instagram/connections?company_id=${encodeURIComponent(companyId)}`
      )
      if (connectionFetchRef.current !== generation) return
      setConnections(data.connections ?? [])
      setByoAccounts(data.byo_accounts ?? [])
    } catch {
      if (connectionFetchRef.current !== generation) return
      setConnections([])
      setByoAccounts([])
    } finally {
      if (connectionFetchRef.current === generation) {
        setConnectionsLoading(false)
        setLoadedForCompany(companyId)
      }
    }
  }, [enabled, companyId])

  // =====================================================
  // FETCH CONVERSAS
  // =====================================================

  const listStillCurrent = (captured: InstagramQueryContext) =>
    sameInstagramQueryContext(captured, listContextRef.current)

  const messageStillCurrent = (captured: InstagramMessageContext) =>
    sameInstagramMessageContext(captured, currentMessageContext())

  const loadConversations = useCallback(async (append: boolean) => {
    if (!enabled || !companyIdRef.current || !selectionReadyRef.current) return
    if (append && (pageErrorRef.current || !cursorRef.current)) return

    const cursor = append ? cursorRef.current : null
    if (append) {
      setLoadingMoreConversations(true)
    } else {
      listContextRef.current = {
        ...listContextRef.current,
        generation: listContextRef.current.generation + 1,
      }
      cursorRef.current = null
      pageErrorRef.current = false
      loadingMoreRef.current = false
      setConversationPageError(false)
      setLoadingMoreConversations(false)
      setConversationsLoading(true)
    }

    const captured = { ...listContextRef.current }
    try {
      const params = new URLSearchParams({
        company_id: captured.companyId,
        filter: captured.filterType,
        owner: captured.owner,
      })
      if (captured.search) params.set('search', captured.search)
      if (append && cursor) {
        params.set('cursor_id', cursor.id)
        params.set('cursor_at', cursor.at ?? 'null')
      }

      const data = await fetchWithAuth<{
        conversations?: InstagramChatConversation[]
        total?: number
        next_cursor?: { at: string | null; id: string } | null
      }>(`/api/instagram/conversations?${params}`)
      if (!listStillCurrent(captured)) return
      const rows = data.conversations ?? []
      setConversationTotal(typeof data.total === 'number' ? data.total : rows.length)
      cursorRef.current = data.next_cursor ?? null
      setHasMoreConversations(Boolean(data.next_cursor))
      pageErrorRef.current = false
      setConversationPageError(false)
      setConversations((prev) => {
        const merged = append ? [...prev, ...rows] : rows
        const seen = new Set<string>()
        return merged.filter((conversation) => {
          if (seen.has(conversation.id)) return false
          seen.add(conversation.id)
          return true
        })
      })
    } catch {
      if (!listStillCurrent(captured)) return
      if (!append) {
        setConversations([])
        setConversationTotal(0)
        setHasMoreConversations(false)
        cursorRef.current = null
      } else {
        pageErrorRef.current = true
        setConversationPageError(true)
      }
    } finally {
      if (!listStillCurrent(captured)) return
      if (append) setLoadingMoreConversations(false)
      else setConversationsLoading(false)
    }
  }, [enabled])

  loadConversationsRef.current = loadConversations

  // =====================================================
  // FETCH MENSAGENS
  // =====================================================

  const fetchMessages = useCallback(async (captured: InstagramMessageContext) => {
    if (!captured.conversationId) return
    try {
      if (!messageStillCurrent(captured)) return
      setMessagesLoading(true)
      setMessagesError(undefined)
      const data = await fetchWithAuth<{ messages?: InstagramChatMessage[] }>(
        `/api/instagram/conversations/${captured.conversationId}/messages`
      )
      if (!messageStillCurrent(captured)) return
      setMessages(data.messages ?? [])
    } catch (err: any) {
      if (!messageStillCurrent(captured)) return
      setMessagesError(err.message ?? 'Erro ao carregar mensagens')
      setMessages([])
    } finally {
      if (!messageStillCurrent(captured)) return
      setMessagesLoading(false)
    }
  }, [])

  // =====================================================
  // EFEITOS
  // =====================================================

  useEffect(() => {
    if (enabled) fetchConnections()
  }, [fetchConnections, enabled])

  useEffect(() => {
    if (!enabled || !companyId || loadedForCompany !== companyId || connectionsLoading) return
    if (migratedCompanyRef.current === companyId) return
    const scopedKey = instagramChatStorageKey(userId, companyId)
    const stored = localStorage.getItem(scopedKey)
      ?? localStorage.getItem(legacyInstagramChatStorageKey(userId))
    const resolved = resolveInstagramChatSelection(stored, connections, byoAccounts)
    localStorage.setItem(scopedKey, resolved)
    localStorage.removeItem(legacyInstagramChatStorageKey(userId))
    migratedCompanyRef.current = companyId
    cursorRef.current = null
    setSelectedConnectionIdState(resolved)
    setSelectionReady(true)
  }, [enabled, companyId, userId, loadedForCompany, connectionsLoading, connections, byoAccounts])

  useEffect(() => {
    if (!enabled || !selectionReady) return
    void loadConversationsRef.current(false)
  }, [enabled, companyId, selectedConnectionId, filter, selectionReady])

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([])
      setMessagesError(undefined)
      return
    }

    const captured: InstagramMessageContext = {
      generation: messageGenerationRef.current,
      companyId: companyIdRef.current,
      conversationId: selectedConversationId,
    }
    void fetchMessages(captured)

    const conv = conversationsRef.current.find(c => c.id === selectedConversationId)
    if (conv && !conv.byo_account_id && conv.connection_id && !conv.participant_name) {
      postWithAuth<{
        participant_name:     string | null
        participant_username: string | null
        participant_avatar:   string | null
      }>(
        `/api/instagram/conversations/${selectedConversationId}/enrich-participant`,
        {}
      )
        .then((data) => {
          if (!messageStillCurrent(captured)) return
          setConversations(prev =>
            prev.map(c =>
              c.id === captured.conversationId
                ? {
                    ...c,
                    participant_name:     data.participant_name,
                    participant_username: data.participant_username,
                    participant_avatar:   data.participant_avatar,
                  }
                : c
            )
          )
        })
        .catch(() => {
          // Não-fatal: o perfil simplesmente não aparece enriquecido
        })
    }
  }, [selectedConversationId, fetchMessages])

  // =====================================================
  // REALTIME — instagram_connections (health status)
  // =====================================================
  // Propaga mudanças de status feitas pelo cron (ex: reauth_required) em
  // tempo real para que a UI exiba banners de alerta imediatamente.

  useEffect(() => {
    if (!enabled || !companyId) return

    const channel = supabase
      .channel(`ig_connections_${companyId}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'instagram_connections',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const updated = payload.new as InstagramConnection
          setConnections(prev =>
            prev.map(c => c.id === updated.id ? { ...c, ...updated } : c)
          )
        }
      )
      .subscribe()

    return () => { channel.unsubscribe() }
  }, [enabled, companyId])

  // =====================================================
  // REALTIME — instagram_conversations (sidebar)
  // =====================================================
  // Atualiza a lista de conversas em tempo real quando:
  //   - chega nova mensagem inbound (webhook → UPDATE na conversa)
  //   - nova conversa é criada (INSERT)
  // Segue o mesmo padrão do useChatData (WhatsApp).

  useEffect(() => {
    if (!enabled || !companyId) return
    const subscribed = { ...subscriptionContextRef.current }

    const channel = supabase
      .channel(`ig_conversations_${companyId}`)
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  'instagram_conversations',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const row = (payload.new ?? {}) as InstagramChatConversation
          if (!instagramSubscriptionEventApplies(subscribed, subscriptionContextRef.current, row)) return
          if (payload.eventType === 'INSERT') {
            setConversations(prev => {
              if (prev.some(c => c.id === row.id)) return prev
              return [row, ...prev]
            })
            setConversationTotal(prev => prev + 1)
          } else if (payload.eventType === 'UPDATE') {
            setConversations(prev =>
              prev.map(c =>
                c.id === row.id
                  ? {
                      ...c,
                      unread_count:         row.unread_count         ?? c.unread_count,
                      last_message_at:      row.last_message_at      ?? c.last_message_at,
                      last_message_preview: row.last_message_preview ?? c.last_message_preview,
                      assigned_to:          row.assigned_to          ?? c.assigned_to,
                      updated_at:           row.updated_at           ?? c.updated_at,
                      participant_name:     row.participant_name     ?? c.participant_name,
                      participant_username: row.participant_username ?? c.participant_username,
                      participant_avatar:   row.participant_avatar   ?? c.participant_avatar,
                    }
                  : c
              )
            )
          }
        }
      )
      .subscribe()

    return () => { channel.unsubscribe() }
  }, [enabled, companyId, selectedConnectionId, filter])

  // =====================================================
  // REALTIME — instagram_messages (thread da conversa aberta)
  // =====================================================
  // Recebe mensagens inbound em tempo real para a conversa selecionada.
  // Deduplicação por ig_message_id evita duplicar mensagens outbound
  // que já foram adicionadas localmente pelo sendMessage.

  useEffect(() => {
    if (!selectedConversationId) return
    const subscribed: InstagramMessageContext = {
      generation: messageSubscriptionRef.current.generation + 1,
      companyId: companyIdRef.current,
      conversationId: selectedConversationId,
    }
    messageSubscriptionRef.current = subscribed

    const channel = supabase
      .channel(`ig_messages_${selectedConversationId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'instagram_messages',
          filter: `conversation_id=eq.${selectedConversationId}`,
        },
        (payload) => {
          const newMsg = payload.new as InstagramChatMessage
          if (!instagramMessageEventApplies(subscribed, messageSubscriptionRef.current, newMsg)) return
          setMessages(prev => {
            const isDupe = prev.some(m =>
              m.ig_message_id === newMsg.ig_message_id ||
              (newMsg.direction === 'outbound' && m.ig_message_id?.startsWith('local_') && m.content === newMsg.content)
            )
            if (isDupe) {
              return prev.map(m =>
                m.ig_message_id?.startsWith('local_') && m.content === newMsg.content && newMsg.direction === 'outbound'
                  ? { ...m, ...newMsg }
                  : m
              )
            }
            return [...prev, newMsg]
          })
        }
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
      if (messageSubscriptionRef.current === subscribed) {
        messageSubscriptionRef.current = {
          ...subscribed,
          generation: subscribed.generation + 1,
          conversationId: '',
        }
      }
    }
  }, [selectedConversationId])

  // =====================================================
  // REALTIME — instagram_message_reactions
  // =====================================================
  // Atualiza reactions nas mensagens da conversa aberta em tempo real.

  useEffect(() => {
    if (!selectedConversationId) return

    const channel = supabase
      .channel(`ig_reactions_${selectedConversationId}`)
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  'instagram_message_reactions',
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as {
            message_id: string
            emoji: string
            source: 'business' | 'participant'
            actor_ig_id: string
            user_id: string | null
            removed_at: string | null
          }
          if (!row?.message_id) return

          setMessages(prev =>
            prev.map(m => {
              if (m.id !== row.message_id) return m

              const reaction: InstagramMessageReaction = {
                emoji:       row.emoji,
                source:      row.source,
                actor_ig_id: row.actor_ig_id,
                user_id:     row.user_id,
              }

              if (payload.eventType === 'DELETE' || row.removed_at) {
                return {
                  ...m,
                  reactions: m.reactions.filter(r => r.actor_ig_id !== row.actor_ig_id),
                }
              }

              const exists = m.reactions.some(r => r.actor_ig_id === row.actor_ig_id)
              return {
                ...m,
                reactions: exists
                  ? m.reactions.map(r => r.actor_ig_id === row.actor_ig_id ? reaction : r)
                  : [...m.reactions, reaction],
              }
            })
          )
        }
      )
      .subscribe()

    return () => { channel.unsubscribe() }
  }, [selectedConversationId])

  // =====================================================
  // CONVERSAS FILTRADAS (busca local sobre resultado já filtrado)
  // =====================================================

  const filteredConversations = useMemo(() => {
    if (!filter.search?.trim()) return conversations
    const s = filter.search.toLowerCase()
    return conversations.filter(c =>
      c.participant_username?.toLowerCase().includes(s) ||
      c.participant_name?.toLowerCase().includes(s) ||
      c.last_message_preview?.toLowerCase().includes(s)
    )
  }, [conversations, filter.search])

  // =====================================================
  // ACTIONS
  // =====================================================

  const setSelectedConnection = useCallback((id: string) => {
    closeMessageContext()
    setSelectedConnectionIdState(id)
    setSelectedConversationIdState(undefined)
    setMessages([])
    setMessagesError(undefined)
    setReplyingTo(null)
    cursorRef.current = null
    pageErrorRef.current = false
    setConversationPageError(false)
    if (companyIdRef.current) {
      localStorage.setItem(instagramChatStorageKey(userId, companyIdRef.current), id)
    }
  }, [userId])

  const setSelectedConversation = useCallback((id: string) => {
    closeMessageContext()
    conversationIdRef.current = id
    setSelectedConversationIdState(id)
  }, [])

  const setFilter = useCallback((f: InstagramChannelFilter) => {
    closeMessageContext()
    setFilterState(f)
    setSelectedConversationIdState(undefined)
    setMessages([])
    setMessagesError(undefined)
    setReplyingTo(null)
  }, [])

  const refreshConversations = useCallback(() => {
    void loadConversationsRef.current(false)
  }, [])

  const loadMoreConversations = useCallback(() => {
    if (loadingMoreRef.current || pageErrorRef.current || !cursorRef.current) return
    loadingMoreRef.current = true
    void loadConversationsRef.current(true).finally(() => {
      loadingMoreRef.current = false
    })
  }, [])

  const retryLoadMoreConversations = useCallback(() => {
    if (!pageErrorRef.current || loadingMoreRef.current || !cursorRef.current) return
    pageErrorRef.current = false
    setConversationPageError(false)
    loadingMoreRef.current = true
    void loadConversationsRef.current(true).finally(() => {
      loadingMoreRef.current = false
    })
  }, [])

  const sendMessage = useCallback(async ({ text, reply_to_ig_message_id }: InstagramSendMessagePayload) => {
    const captured = currentMessageContext()
    if (!captured.conversationId) return
    const current = conversationsRef.current.find(c => c.id === captured.conversationId)
    if (current && (current.byo_account_id || current.connection_id == null)) return
    setSendLoading(true)
    setSendError(undefined)
    try {
      const body: Record<string, unknown> = { text }
      if (reply_to_ig_message_id) body.reply_to_ig_message_id = reply_to_ig_message_id

      const data = await postWithAuth<{ message: InstagramChatMessage }>(
        `/api/instagram/conversations/${captured.conversationId}/send`,
        body
      )
      if (!messageStillCurrent(captured)) return
      if (data.message) {
        setMessages(prev => [...prev, { ...data.message, reactions: data.message.reactions ?? [] }])
      }
      setReplyingTo(null)
      setConversations(prev =>
        prev.map(c =>
          c.id === captured.conversationId
            ? {
                ...c,
                last_message_preview: text.slice(0, 100),
                last_message_at:      new Date().toISOString(),
              }
            : c
        )
      )
    } catch (err: any) {
      if (!messageStillCurrent(captured)) return
      setSendError(err.message ?? 'Erro ao enviar mensagem')
    } finally {
      if (!messageStillCurrent(captured)) return
      setSendLoading(false)
    }
  }, [currentMessageContext, messageStillCurrent])

  const sendMedia = useCallback(async ({ media_url, media_type, reply_to_ig_message_id }: InstagramSendMediaPayload) => {
    const captured = currentMessageContext()
    if (!captured.conversationId) return
    const current = conversationsRef.current.find(c => c.id === captured.conversationId)
    if (current && (current.byo_account_id || current.connection_id == null)) return
    setSendMediaLoading(true)
    setSendError(undefined)
    try {
      const body: Record<string, unknown> = { media_url, media_type }
      if (reply_to_ig_message_id) body.reply_to_ig_message_id = reply_to_ig_message_id

      const data = await postWithAuth<{ message: InstagramChatMessage }>(
        `/api/instagram/conversations/${captured.conversationId}/send-media`,
        body
      )
      if (!messageStillCurrent(captured)) return
      if (data.message) {
        setMessages(prev => [...prev, { ...data.message, reactions: data.message.reactions ?? [] }])
      }
      setReplyingTo(null)
      setConversations(prev =>
        prev.map(c =>
          c.id === captured.conversationId
            ? { ...c, last_message_preview: `[${media_type}]`, last_message_at: new Date().toISOString() }
            : c
        )
      )
    } catch (err: any) {
      if (!messageStillCurrent(captured)) return
      setSendError(err.message ?? 'Erro ao enviar mídia')
    } finally {
      if (!messageStillCurrent(captured)) return
      setSendMediaLoading(false)
    }
  }, [currentMessageContext, messageStillCurrent])

  const reactToMessage = useCallback(async ({ ig_message_id, emoji, action }: InstagramReactPayload) => {
    const captured = currentMessageContext()
    if (!captured.conversationId) return
    const current = conversationsRef.current.find(c => c.id === captured.conversationId)
    if (current && (current.byo_account_id || current.connection_id == null)) return
    try {
      await postWithAuth(
        `/api/instagram/conversations/${captured.conversationId}/react`,
        { ig_message_id, emoji, action }
      )
      if (!messageStillCurrent(captured)) return
    } catch {
      // Não-fatal: reação simplesmente não persiste
    }
  }, [currentMessageContext, messageStillCurrent])

  const createLead = useCallback(async (
    conversationId: string,
    payload: CreateInstagramLeadPayload
  ): Promise<CreateInstagramLeadResponse | null> => {
    if (!conversationId || conversationId !== conversationIdRef.current) return null
    const operation = leadOperationRef.current + 1
    leadOperationRef.current = operation
    const captured: InstagramMessageContext = {
      generation: messageGenerationRef.current,
      companyId: companyIdRef.current,
      conversationId,
    }
    const stillCurrent = () => operation === leadOperationRef.current && sameInstagramMessageContext(captured, {
      generation: messageGenerationRef.current,
      companyId: companyIdRef.current,
      conversationId: conversationIdRef.current,
    })
    setCreateLeadLoading(true)
    setCreateLeadError(undefined)
    try {
      const res = await postWithAuth<CreateInstagramLeadResponse>(
        `/api/instagram/conversations/${conversationId}/create-lead`,
        payload
      )
      if (!stillCurrent()) return null
      if (res.lead_id) {
        setConversations(prev =>
          prev.map(c =>
            c.id === conversationId ? { ...c, lead_id: res.lead_id } : c
          )
        )
      }
      return res
    } catch (err: any) {
      if (!stillCurrent()) return null
      const msg = err.errorCode === 'plan_limit_exceeded'
        ? 'plan_limit_exceeded'
        : (err.message ?? 'Erro ao criar lead')
      setCreateLeadError(msg)
      return null
    } finally {
      if (stillCurrent()) setCreateLeadLoading(false)
    }
  }, [])

  const clearSendError = useCallback(() => setSendError(undefined), [])
  const clearCreateLeadError = useCallback(() => setCreateLeadError(undefined), [])

  // =====================================================
  // RETORNO
  // =====================================================

  return {
    connections,
    byoAccounts,
    selectedConnectionId,
    connectionsLoading,

    conversations,
    filteredConversations,
    conversationTotal,
    hasMoreConversations,
    loadingMoreConversations,
    conversationPageError,
    selectedConversationId,
    filter,
    conversationsLoading,

    messages,
    messagesLoading,
    messagesError,

    replyingTo,
    setReplyingTo,

    setSelectedConnection,
    setSelectedConversation,
    setFilter,
    refreshConversations,
    loadMoreConversations,
    retryLoadMoreConversations,
    sendMessage,
    sendMedia,
    reactToMessage,
    createLead,
    sendLoading,
    sendMediaLoading,
    createLeadLoading,
    sendError,
    createLeadError,
    clearSendError,
    clearCreateLeadError,
  }
}
