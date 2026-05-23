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

import { useState, useEffect, useCallback, useMemo } from 'react'
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
  const [connectionsLoading,  setConnectionsLoading]  = useState(false)

  const [selectedConnectionId, setSelectedConnectionIdState] = useState<string>(() => {
    return localStorage.getItem(`ig_chat_connection_${userId}`) ?? 'all'
  })

  const [conversations,        setConversations]        = useState<InstagramChatConversation[]>([])
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [selectedConversationId, setSelectedConversationIdState] = useState<string | undefined>()

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
    if (selectedConversationId) {
      fetchMessages(selectedConversationId)
    } else {
      setMessages([])
      setMessagesError(undefined)
    }
  }, [selectedConversationId, fetchMessages])

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
