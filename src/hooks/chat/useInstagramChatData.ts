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
  InstagramChatConversation,
  InstagramChatMessage,
  InstagramChannelFilter,
  InstagramSendMessagePayload,
} from '../../types/instagram-chat'

// =====================================================
// TIPOS DO RETORNO
// =====================================================

export interface UseInstagramChatDataReturn {
  // Conexões
  connections: InstagramConnection[]
  selectedConnectionId: string
  connectionsLoading: boolean

  // Conversas
  conversations: InstagramChatConversation[]
  filteredConversations: InstagramChatConversation[]
  selectedConversationId: string | undefined
  filter: InstagramChannelFilter
  conversationsLoading: boolean

  // Mensagens
  messages: InstagramChatMessage[]
  messagesLoading: boolean
  messagesError: string | undefined

  // Actions
  setSelectedConnection: (id: string) => void
  setSelectedConversation: (id: string) => void
  setFilter: (f: InstagramChannelFilter) => void
  refreshConversations: () => void
  sendMessage: (payload: InstagramSendMessagePayload) => Promise<void>
  sendLoading: boolean
  sendError: string | undefined
  clearSendError: () => void
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
    // #region agent log
    console.log('[postWithAuth][debug] error response body:', JSON.stringify(data))
    // #endregion
    throw Object.assign(new Error(data.message ?? data.error ?? `HTTP ${res.status}`), {
      errorCode: data.error,
      debugInfo: (data as any)._debug,
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
  const [connectionsLoading,  setConnectionsLoading]  = useState(false)

  const [selectedConnectionId, setSelectedConnectionIdState] = useState<string>(() => {
    return localStorage.getItem(`ig_chat_connection_${userId}`) ?? 'all'
  })

  const [conversations,        setConversations]        = useState<InstagramChatConversation[]>([])
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [selectedConversationId, setSelectedConversationIdState] = useState<string | undefined>()

  // Ref para acessar conversations dentro do useEffect sem adicioná-la como dependência
  const conversationsRef = useRef(conversations)
  useEffect(() => { conversationsRef.current = conversations }, [conversations])

  const [filter, setFilterState] = useState<InstagramChannelFilter>({ type: 'all' })

  const [messages,        setMessages]        = useState<InstagramChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError,   setMessagesError]   = useState<string | undefined>()

  const [sendLoading, setSendLoading] = useState(false)
  const [sendError,   setSendError]   = useState<string | undefined>()

  // =====================================================
  // FETCH CONEXÕES
  // =====================================================

  const fetchConnections = useCallback(async () => {
    if (!enabled || !companyId) return
    try {
      setConnectionsLoading(true)
      const data = await fetchWithAuth<{ connections?: InstagramConnection[] }>(
        `/api/instagram/connections?company_id=${companyId}`
      )
      // Retorna todas as conexões para o selector poder exibir/desabilitar não-ativas
      setConnections(data.connections ?? [])
    } catch {
      setConnections([])
    } finally {
      setConnectionsLoading(false)
    }
  }, [enabled, companyId])

  // =====================================================
  // FETCH CONVERSAS
  // =====================================================

  const fetchConversations = useCallback(async () => {
    if (!enabled || !companyId) return
    try {
      setConversationsLoading(true)

      const params = new URLSearchParams({ company_id: companyId, filter: filter.type })
      if (selectedConnectionId && selectedConnectionId !== 'all') {
        params.set('connection_id', selectedConnectionId)
      }
      if (filter.search?.trim()) {
        params.set('search', filter.search.trim())
      }

      const data = await fetchWithAuth<{ conversations?: InstagramChatConversation[] }>(
        `/api/instagram/conversations?${params}`
      )
      setConversations(data.conversations ?? [])
    } catch {
      setConversations([])
    } finally {
      setConversationsLoading(false)
    }
  }, [enabled, companyId, selectedConnectionId, filter])

  // =====================================================
  // FETCH MENSAGENS
  // =====================================================

  const fetchMessages = useCallback(async (conversationId: string) => {
    if (!conversationId) return
    try {
      setMessagesLoading(true)
      setMessagesError(undefined)
      const data = await fetchWithAuth<{ messages?: InstagramChatMessage[] }>(
        `/api/instagram/conversations/${conversationId}/messages`
      )
      setMessages(data.messages ?? [])
    } catch (err: any) {
      setMessagesError(err.message ?? 'Erro ao carregar mensagens')
      setMessages([])
    } finally {
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
    if (enabled) fetchConversations()
  }, [fetchConversations, enabled])

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([])
      setMessagesError(undefined)
      return
    }

    fetchMessages(selectedConversationId)

    // Enriquecer perfil do participante se ainda não preenchido
    const conv = conversationsRef.current.find(c => c.id === selectedConversationId)
    if (conv && !conv.participant_name) {
      postWithAuth<{
        participant_name:     string | null
        participant_username: string | null
        participant_avatar:   string | null
      }>(
        `/api/instagram/conversations/${selectedConversationId}/enrich-participant`,
        {}
      )
        .then((data) => {
          setConversations(prev =>
            prev.map(c =>
              c.id === selectedConversationId
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
        .catch((err: any) => {
          // #region agent log
          console.log('[enrich-participant][frontend] error:', err?.message, err)
          // #endregion
          // Não-fatal: o perfil simplesmente não aparece enriquecido
        })
    }
  }, [selectedConversationId, fetchMessages])

  // =====================================================
  // REALTIME — instagram_conversations (sidebar)
  // =====================================================
  // Atualiza a lista de conversas em tempo real quando:
  //   - chega nova mensagem inbound (webhook → UPDATE na conversa)
  //   - nova conversa é criada (INSERT)
  // Segue o mesmo padrão do useChatData (WhatsApp).

  useEffect(() => {
    if (!enabled || !companyId) return

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
          if (payload.eventType === 'INSERT') {
            const newConv = payload.new as InstagramChatConversation
            setConversations(prev => {
              if (prev.some(c => c.id === newConv.id)) return prev
              return [newConv, ...prev]
            })
          } else if (payload.eventType === 'UPDATE') {
            setConversations(prev =>
              prev.map(c =>
                c.id === payload.new.id
                  ? {
                      ...c,
                      unread_count:         payload.new.unread_count         ?? c.unread_count,
                      last_message_at:      payload.new.last_message_at      ?? c.last_message_at,
                      last_message_preview: payload.new.last_message_preview ?? c.last_message_preview,
                      assigned_to:          payload.new.assigned_to          ?? c.assigned_to,
                      updated_at:           payload.new.updated_at           ?? c.updated_at,
                    }
                  : c
              )
            )
          }
        }
      )
      .subscribe()

    return () => { channel.unsubscribe() }
  }, [enabled, companyId])

  // =====================================================
  // REALTIME — instagram_messages (thread da conversa aberta)
  // =====================================================
  // Recebe mensagens inbound em tempo real para a conversa selecionada.
  // Deduplicação por ig_message_id evita duplicar mensagens outbound
  // que já foram adicionadas localmente pelo sendMessage.

  useEffect(() => {
    if (!selectedConversationId) return

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
    setSelectedConnectionIdState(id)
    setSelectedConversationIdState(undefined)
    setMessages([])
    localStorage.setItem(`ig_chat_connection_${userId}`, id)
  }, [userId])

  const setSelectedConversation = useCallback((id: string) => {
    setSelectedConversationIdState(id)
  }, [])

  const setFilter = useCallback((f: InstagramChannelFilter) => {
    setFilterState(f)
    setSelectedConversationIdState(undefined)
    setMessages([])
  }, [])

  const refreshConversations = useCallback(() => {
    fetchConversations()
  }, [fetchConversations])

  const sendMessage = useCallback(async ({ text }: InstagramSendMessagePayload) => {
    if (!selectedConversationId) return
    setSendLoading(true)
    setSendError(undefined)
    try {
      const data = await postWithAuth<{ message: InstagramChatMessage }>(
        `/api/instagram/conversations/${selectedConversationId}/send`,
        { text }
      )
      // Adicionar localmente para feedback imediato
      if (data.message) {
        setMessages(prev => [...prev, data.message])
      }
      // Atualizar preview na lista de conversas
      setConversations(prev =>
        prev.map(c =>
          c.id === selectedConversationId
            ? {
                ...c,
                last_message_preview: text.slice(0, 100),
                last_message_at:      new Date().toISOString(),
              }
            : c
        )
      )
    } catch (err: any) {
      setSendError(err.message ?? 'Erro ao enviar mensagem')
    } finally {
      setSendLoading(false)
    }
  }, [selectedConversationId])

  const clearSendError = useCallback(() => setSendError(undefined), [])

  // =====================================================
  // RETORNO
  // =====================================================

  return {
    connections,
    selectedConnectionId,
    connectionsLoading,

    conversations,
    filteredConversations,
    selectedConversationId,
    filter,
    conversationsLoading,

    messages,
    messagesLoading,
    messagesError,

    setSelectedConnection,
    setSelectedConversation,
    setFilter,
    refreshConversations,
    sendMessage,
    sendLoading,
    sendError,
    clearSendError,
  }
}
