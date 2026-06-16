// =====================================================
// HOOK PRINCIPAL DO CHAT - ISOLADO
// =====================================================
// Hook principal para gerenciar dados do chat
// NÃO MODIFICA hooks existentes

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { chatApi } from '../../services/chat/chatApi'
import { supabase } from '../../lib/supabase'
import { useChatRealtime } from './useChatRealtime'
import { ChatEventBus, useChatEvent } from '../../services/chat/chatEventBus'
import { ChatFeatureManager } from '../../config/chatFeatures'
import { isConversationVisibleForUser } from '../../utils/chatVisibility'
import type { ChatVisibilityContext } from '../../utils/chatVisibility'
import type {
  ChatConversation,
  ConversationFilter,
  UseChatDataReturn
} from '../../types/whatsapp-chat'

// Tamanho de página para paginação da lista de conversas.
// Definido aqui (camada de hook) — o chatApi não conhece este valor.
const CONVERSATIONS_PAGE_SIZE = 50

// Helper de deduplicação por id
const dedupeConversations = (list: ChatConversation[]): ChatConversation[] => {
  const seen = new Set<string>()
  return list.filter(c => seen.has(c.id) ? false : (seen.add(c.id), true))
}

// =====================================================
// HOOK PRINCIPAL
// =====================================================

export const useChatData = (
  companyId: string,
  userId: string,
  initialConversationId?: string,
  visibilityContext?: ChatVisibilityContext
): UseChatDataReturn => {
  // Estados principais
  const [instances, setInstances] = useState<any[]>([])
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [selectedInstance, setSelectedInstance] = useState<string>(() => {
    const saved = localStorage.getItem(`chat_selected_instance_${userId}`)
    return saved || 'all'
  })
  const [selectedConversation, setSelectedConversation] = useState<string>()
  const [filter, setFilter] = useState<ConversationFilter>(() => {
    const saved = localStorage.getItem(`chat_filter_state_${userId}`)
    if (saved) {
      try { return JSON.parse(saved) } catch { /* ignore */ }
    }
    return { type: 'all' }
  })

  // Estados de loading
  const [instancesLoading, setInstancesLoading] = useState(true)
  const [conversationsLoading, setConversationsLoading] = useState(false)

  // Estados de paginação da lista de conversas
  const [loadedConversationPages,    setLoadedConversationPages]    = useState(1)
  const [hasMoreConversations,       setHasMoreConversations]       = useState(false)
  const [loadingMoreConversations,   setLoadingMoreConversations]   = useState(false)

  // Ref sincronizado para uso nos listeners de realtime (evita stale closure)
  const loadedPagesRef = useRef(1)
  useEffect(() => {
    loadedPagesRef.current = loadedConversationPages
  }, [loadedConversationPages])

  // =====================================================
  // CARREGAR MAIS CONVERSAS (paginação — "Load more")
  // =====================================================

  const loadMoreConversations = useCallback(async () => {
    if (!companyId || !userId || loadingMoreConversations || !hasMoreConversations) return

    // Snapshots para proteção contra race condition
    const instanceSnapshot = selectedInstance
    const filterTypeSnapshot = filter.type
    const companyIdSnapshot = companyId

    const offset = loadedConversationPages * CONVERSATIONS_PAGE_SIZE
    const instanceFilter = selectedInstance === 'all' ? undefined : selectedInstance

    setLoadingMoreConversations(true)
    try {
      const { conversations: newData, hasMore } = await chatApi.getConversationsPage(
        companyId,
        userId,
        filter,
        instanceFilter,
        offset,
        CONVERSATIONS_PAGE_SIZE
      )

      // Descartar resultado se o contexto mudou durante o await
      if (
        companyId      !== companyIdSnapshot  ||
        selectedInstance !== instanceSnapshot  ||
        filter.type    !== filterTypeSnapshot
      ) return

      const nextPages  = loadedConversationPages + 1
      const maxVisible = nextPages * CONVERSATIONS_PAGE_SIZE

      setConversations(prev =>
        dedupeConversations([...prev, ...newData]).slice(0, maxVisible)
      )
      setLoadedConversationPages(nextPages)
      setHasMoreConversations(hasMore)
    } catch (error) {
      console.error('Error loading more conversations:', error)
    } finally {
      // Só limpa o loading se o contexto ainda for o mesmo
      if (
        companyId        === companyIdSnapshot  &&
        selectedInstance === instanceSnapshot   &&
        filter.type      === filterTypeSnapshot
      ) {
        setLoadingMoreConversations(false)
      }
    }
  }, [companyId, userId, filter, selectedInstance, loadedConversationPages, hasMoreConversations, loadingMoreConversations])

  // =====================================================
  // BUSCAR INSTÂNCIAS DISPONÍVEIS
  // =====================================================

  const fetchInstances = useCallback(async () => {
    if (!companyId) return

    try {
      setInstancesLoading(true)
      const instancesData = await chatApi.getCompanyInstances(companyId)

      // FASE 5ZD: seller restrito vê apenas instâncias atribuídas a ele.
      // Admin/manager/system_admin/super_admin: sem filtro.
      // #region agent log
      console.log('[DEBUG 449c25] fetchInstances: visibilityContext', { flag: visibilityContext?.flag, role: visibilityContext?.role, userId: visibilityContext?.userId })
      // #endregion
      const filtered =
        visibilityContext?.flag && visibilityContext?.role === 'seller'
          ? instancesData.filter(
              (i: any) => i.assigned_user_id === visibilityContext.userId
            )
          : instancesData

      setInstances(filtered)
    } catch (error) {
      console.error('Error fetching instances:', error)
      setInstances([])
    } finally {
      setInstancesLoading(false)
    }
  }, [companyId, visibilityContext])

  // =====================================================
  // BUSCAR CONVERSAS
  // =====================================================

  const fetchConversations = useCallback(async () => {
    if (!companyId || !userId) return

    try {
      setConversationsLoading(true)
      const instanceFilter = selectedInstance === 'all' ? undefined : selectedInstance
      const { conversations: data, hasMore } = await chatApi.getConversationsPage(
        companyId,
        userId,
        filter,
        instanceFilter,
        0,
        CONVERSATIONS_PAGE_SIZE
      )
      setConversations(data)
      setLoadedConversationPages(1)
      setHasMoreConversations(hasMore)
    } catch (error) {
      console.error('Error fetching conversations:', error)
      setConversations([])
      setHasMoreConversations(false)
    } finally {
      setConversationsLoading(false)
    }
  }, [companyId, userId, filter, selectedInstance])

  // =====================================================
  // EFEITOS
  // =====================================================

  // Buscar instâncias ao montar
  useEffect(() => {
    fetchInstances()
  }, [fetchInstances])

  // Selecionar conversa inicial se fornecida
  useEffect(() => {
    if (initialConversationId && !selectedConversation) {
      setSelectedConversation(initialConversationId)
    }
  }, [initialConversationId, selectedConversation])

  // Buscar conversas quando filtros mudarem
  useEffect(() => {
    // Buscar conversas sempre que houver instância selecionada (incluindo 'all')
    if (selectedInstance) {
      fetchConversations()
    }
  }, [fetchConversations, selectedInstance])

  // =====================================================
  // SISTEMA DE TEMPO REAL UNIFICADO
  // =====================================================

  // Ativar subscription unificada para esta empresa
  const realtimeStatus = useChatRealtime(companyId, {
    enabled: ChatFeatureManager.shouldUseUnifiedRealtime(),
    debug: ChatFeatureManager.shouldShowDebugLogs(),
    fallbackToLegacy: ChatFeatureManager.shouldFallbackToLegacy()
  })

  // Listener para novas conversas criadas
  useChatEvent('chat:conversation:created', (conversation: ChatConversation) => {
    if (conversation.company_id === companyId) {
      if (visibilityContext && !isConversationVisibleForUser(conversation, visibilityContext)) return
      setConversations(prev => {
        if (prev.some(conv => conv.id === conversation.id)) return prev
        // Slice via ref para evitar stale closure após load more
        return [conversation, ...prev].slice(0, loadedPagesRef.current * CONVERSATIONS_PAGE_SIZE)
      })
    }
  }, [companyId, visibilityContext])

  // Listener para conversas atualizadas
  useChatEvent('chat:conversation:updated', (payload: any) => {
    if (payload.data && payload.data.company_id === companyId) {
      const updated: ChatConversation = payload.data
      if (visibilityContext) {
        const visible = isConversationVisibleForUser(updated, visibilityContext)
        setConversations(prev => {
          const exists = prev.some(conv => conv.id === updated.id)
          if (!visible) {
            return prev.filter(conv => conv.id !== updated.id)
          }
          if (!exists) {
            // Conversa passou a ser visível — prepend com slice via ref
            return [updated, ...prev].slice(0, loadedPagesRef.current * CONVERSATIONS_PAGE_SIZE)
          }
          return prev.map(conv => conv.id === updated.id ? updated : conv)
        })
      } else {
        setConversations(prev =>
          prev.map(conv => conv.id === updated.id ? updated : conv)
        )
      }
    }
  }, [companyId, visibilityContext])

  // Listener para mensagens recebidas (atualizar última mensagem da conversa)
  useChatEvent('chat:message:received', (payload: any) => {
    if (payload.data && payload.companyId === companyId) {
      const message = payload.data
      
      setConversations(prev => 
        prev.map(conv => {
          if (conv.id === message.conversation_id) {
            return {
              ...conv,
              last_message_at: new Date(message.timestamp),
              last_message_content: message.content,
              last_message_direction: message.direction,
              unread_count: message.direction === 'inbound' ? conv.unread_count + 1 : conv.unread_count
            }
          }
          return conv
        })
      )
    }
  }, [companyId])

  // NOVO: Listener para marcar conversa como lida (atualização local otimista)
  useChatEvent('chat:conversation:mark-as-read', (payload: any) => {
    if (payload.conversationId && payload.companyId === companyId) {
      // Atualização local instantânea (sem aguardar servidor)
      setConversations(prev => 
        prev.map(conv => 
          conv.id === payload.conversationId 
            ? { 
                ...conv, 
                unread_count: 0,
                last_read_at: payload.timestamp,
                updated_at: payload.timestamp
              }
            : conv
        )
      )
    }
  }, [companyId])

  // Reordenação otimista: mensagem outbound enviada com sucesso pelo usuário.
  // Atualiza last_message_at/content/direction antes que o Realtime propague o evento do banco.
  // O Realtime sobrescreverá posteriormente com o timestamp oficial — comportamento seguro e esperado.
  useChatEvent('chat:conversation:message:sent', (payload: any) => {
    if (payload.companyId !== companyId) return
    setConversations(prev =>
      prev.map(conv =>
        conv.id === payload.conversationId
          ? {
              ...conv,
              last_message_at: payload.timestamp,
              last_message_content: payload.content,
              last_message_direction: 'outbound' as const,
            }
          : conv
      )
    )
  }, [companyId])

  // Listener para conversas deletadas
  useChatEvent('chat:conversation:deleted', (payload: any) => {
    if (payload.company_id === companyId) {
      setConversations(prev =>
        prev.filter(conv => conv.id !== payload.id)
      )
    }
  }, [companyId])

  // =====================================================
  // HANDLERS
  // =====================================================

  const handleSetSelectedInstance = useCallback((instanceId: string) => {
    setSelectedInstance(instanceId)
    setSelectedConversation(undefined)
    // Reset de paginação ao trocar de instância
    setConversations([])
    setLoadedConversationPages(1)
    setHasMoreConversations(false)
    localStorage.setItem(`chat_selected_instance_${userId}`, instanceId)
  }, [userId])

  const handleSetSelectedConversation = useCallback((conversationId: string) => {
    setSelectedConversation(conversationId)
  }, [])

  const handleSetFilter = useCallback((newFilter: ConversationFilter) => {
    setFilter(newFilter)
    setSelectedConversation(undefined)
    // Reset de paginação ao trocar de filtro
    setConversations([])
    setLoadedConversationPages(1)
    setHasMoreConversations(false)
    localStorage.setItem(`chat_filter_state_${userId}`, JSON.stringify(newFilter))
  }, [userId])

  const refreshConversations = useCallback(() => {
    fetchConversations()
  }, [fetchConversations])

  // =====================================================
  // VALIDAR INSTÂNCIA SALVA QUANDO AS INSTÂNCIAS CARREGAM
  // =====================================================

  // Se a instância salva foi deletada ou não existe mais, faz fallback para 'all'
  useEffect(() => {
    if (instances.length === 0) return
    if (selectedInstance === 'all') return
    const stillExists = instances.some(inst => inst.id === selectedInstance)
    if (!stillExists) {
      setSelectedInstance('all')
      localStorage.removeItem(`chat_selected_instance_${userId}`)
    }
  }, [instances, selectedInstance, userId])

  // =====================================================
  // CONVERSAS FILTRADAS E ORDENADAS
  // =====================================================

  const filteredConversations = useMemo(() => {
    // Aplicar restrição de visibilidade por seller (espelho client-side do RLS).
    // Necessário porque o RPC chat_get_conversations é SECURITY DEFINER e bypassa o RLS,
    // retornando todas as conversas da empresa independentemente do assigned_to.
    let filtered = visibilityContext
      ? conversations.filter(conv => isConversationVisibleForUser(conv, visibilityContext))
      : [...conversations]

    // Aplicar busca por texto se fornecida
    if (filter.search) {
      const searchLower = filter.search.toLowerCase()
      filtered = filtered.filter(conv => 
        conv.contact_name?.toLowerCase().includes(searchLower) ||
        conv.contact_phone.includes(filter.search!) ||
        conv.last_message_content?.toLowerCase().includes(searchLower)
      )
    }
    // NOVO: Aplicar filtro por tipo
    if (filter.type === 'unread') {
      filtered = filtered.filter(conv => conv.unread_count > 0)
    } else if (filter.type === 'assigned') {
      filtered = filtered.filter(conv => conv.assigned_to)
    } else if (filter.type === 'unassigned') {
      filtered = filtered.filter(conv => !conv.assigned_to)
    }
    // ✅ CORREÇÃO: Ordenar por última mensagem (mais recentes primeiro) com proteção
    filtered.sort((a, b) => {
      try {
        const aTime = a.last_message_at ? 
          (a.last_message_at instanceof Date ? a.last_message_at.getTime() : new Date(a.last_message_at).getTime()) : 0
        const bTime = b.last_message_at ? 
          (b.last_message_at instanceof Date ? b.last_message_at.getTime() : new Date(b.last_message_at).getTime()) : 0
        return bTime - aTime
      } catch (error) {
        console.warn('⚠️ Erro na ordenação de conversas, usando fallback:', error)
        return 0 // Mantém ordem original em caso de erro
      }
    })

    return filtered
  }, [conversations, filter.search, filter.type, visibilityContext])

  // =====================================================
  // SUBSCRIPTION PARA TEMPO REAL
  // =====================================================

  useEffect(() => {
    if (ChatFeatureManager.shouldUseUnifiedRealtime()) return
    if (!companyId) return

    // Subscrever mudanças nas conversas
    const conversationSubscription = supabase
      .channel(`chat_conversations_${companyId}`) // Channel único por empresa
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_conversations',
          filter: `company_id=eq.${companyId}`
        },
        (payload) => {
          // Atualizar lista de conversas
          if (payload.eventType === 'INSERT') {
            const newConversation = payload.new as ChatConversation
            setConversations(prev => {
              // Verificar se já existe para evitar duplicatas
              const exists = prev.some(conv => conv.id === newConversation.id)
              if (exists) return prev
              // Verificar visibilidade antes de adicionar
              if (visibilityContext && !isConversationVisibleForUser(newConversation, visibilityContext)) return prev
              return [newConversation, ...prev]
            })
          } else if (payload.eventType === 'UPDATE') {
            // CORREÇÃO: Atualização parcial inteligente para preservar estrutura da view
            setConversations(prev => {
              const updated = prev.map(conv =>
                conv.id === payload.new.id
                  ? {
                      ...conv,
                      unread_count: payload.new.unread_count,
                      last_message_at: payload.new.last_message_at ? new Date(payload.new.last_message_at) : conv.last_message_at,
                      last_message_content: payload.new.last_message_content || conv.last_message_content,
                      last_message_direction: payload.new.last_message_direction || conv.last_message_direction,
                      assigned_to: payload.new.assigned_to !== undefined
                        ? payload.new.assigned_to
                        : conv.assigned_to,
                      updated_at: new Date(payload.new.updated_at)
                    }
                  : conv
              )
              // Re-aplicar filtro de visibilidade após merge (assigned_to pode ter mudado)
              if (!visibilityContext) return updated
              return updated.filter(conv => isConversationVisibleForUser(conv, visibilityContext))
            })
        } else if (payload.eventType === 'DELETE') {
          const deletedId = payload.old.id
          setConversations(prev => 
            prev.filter(conv => conv.id !== deletedId)
          )
        }
      }
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.error('❌ Erro na subscription de conversas')
      } else if (status === 'TIMED_OUT') {
        console.error('⏰ Timeout na subscription de conversas')
      }
    })

    // Função específica para buscar nova conversa (sem dependências circulares)
    const fetchSingleConversation = async (conversationId: string) => {
      try {
        if (!companyId || !userId) return
        
        const response = await chatApi.getConversations(companyId, userId, { type: 'all' }, selectedInstance)
        const newConversation = response.find(conv => conv.id === conversationId)
        
        if (newConversation) {
          setConversations(prev => {
            if (prev.some(conv => conv.id === conversationId)) return prev
            return [newConversation, ...prev]
          })
        }
      } catch (error) {
        console.error('❌ Erro ao buscar nova conversa:', error)
      }
    }

    // Subscrever mudanças nas mensagens para atualizar contadores
    const messageSubscription = supabase
      .channel(`chat_messages_${companyId}`) // Channel único por empresa
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `company_id=eq.${companyId}` // CORREÇÃO: Filtrar por empresa
        },
        (payload) => {
          const newMessage = payload.new as any
          if (newMessage.conversation_id && newMessage.company_id === companyId) {
            // Ignorar mensagens outbound próprias (já estão no estado local do ChatArea)
            if (newMessage.direction === 'outbound' && newMessage.sent_by === userId) return
            
            // Atualização local otimista
            setConversations(prev => {
              const existingIndex = prev.findIndex(conv => conv.id === newMessage.conversation_id)
              
              if (existingIndex >= 0) {
                const updated = [...prev]
                const existingConv = updated[existingIndex]
                const updatedConv = {
                  ...existingConv,
                  last_message_at: new Date(newMessage.timestamp),
                  last_message_content: newMessage.content,
                  last_message_direction: newMessage.direction,
                  unread_count: newMessage.direction === 'inbound' ? existingConv.unread_count + 1 : existingConv.unread_count,
                  updated_at: new Date(newMessage.timestamp)
                }
                updated.splice(existingIndex, 1)
                return [updatedConv, ...updated]
              } else {
                fetchSingleConversation(newMessage.conversation_id)
                return prev
              }
            })
            
            ChatEventBus.emit('chat:message:received', {
              conversationId: newMessage.conversation_id,
              companyId: newMessage.company_id,
              message: newMessage,
              timestamp: new Date(newMessage.timestamp)
            })
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('❌ Erro na subscription de mensagens')
        } else if (status === 'TIMED_OUT') {
          console.error('⏰ Timeout na subscription de mensagens')
        }
      })

    return () => {
      conversationSubscription.unsubscribe()
      messageSubscription.unsubscribe()
    }
  }, [companyId, userId, selectedInstance]) // CORREÇÃO: Adicionar todas as dependências necessárias

  // =====================================================
  // RETORNO DO HOOK
  // =====================================================

  return {
    // Estados
    instances,
    conversations: filteredConversations,
    selectedInstance,
    selectedConversation,
    filter,
    
    // Loading states
    instancesLoading,
    conversationsLoading,
    
    // Paginação da lista de conversas
    hasMoreConversations,
    loadMoreConversations,
    loadingMoreConversations,
    
    // Actions
    setSelectedInstance: handleSetSelectedInstance,
    setSelectedConversation: handleSetSelectedConversation,
    setFilter: handleSetFilter,
    refreshConversations
  }
}

// =====================================================
// HOOK PARA BUSCA DE CONVERSAS
// =====================================================

export const useConversationSearch = (
  conversations: ChatConversation[],
  searchTerm: string
) => {
  return useMemo(() => {
    if (!searchTerm.trim()) return conversations

    const searchLower = searchTerm.toLowerCase()
    
    return conversations.filter(conv => 
      conv.contact_name?.toLowerCase().includes(searchLower) ||
      conv.contact_phone.includes(searchTerm) ||
      conv.last_message_content?.toLowerCase().includes(searchLower)
    )
  }, [conversations, searchTerm])
}

// =====================================================
// HOOK PARA ESTATÍSTICAS DO CHAT
// =====================================================

export const useChatStats = (conversations: ChatConversation[]) => {
  return useMemo(() => {
    const total = conversations.length
    const unassigned = conversations.filter(conv => !conv.assigned_to).length
    const withUnread = conversations.filter(conv => conv.unread_count > 0).length
    const totalUnread = conversations.reduce((sum, conv) => sum + conv.unread_count, 0)

    return {
      total,
      unassigned,
      withUnread,
      totalUnread,
      assigned: total - unassigned
    }
  }, [conversations])
}
