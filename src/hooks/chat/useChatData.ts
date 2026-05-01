// =====================================================
// HOOK PRINCIPAL DO CHAT - ISOLADO
// =====================================================
// Hook principal para gerenciar dados do chat
// NÃO MODIFICA hooks existentes

import { useState, useEffect, useCallback, useMemo } from 'react'
import { chatApi } from '../../services/chat/chatApi'
import { supabase } from '../../lib/supabase'
import { useChatRealtime } from './useChatRealtime'
import { ChatEventBus, useChatEvent } from '../../services/chat/chatEventBus'
import { ChatFeatureManager } from '../../config/chatFeatures'
import type {
  ChatConversation,
  ConversationFilter,
  UseChatDataReturn
} from '../../types/whatsapp-chat'

// =====================================================
// HOOK PRINCIPAL
// =====================================================

export const useChatData = (
  companyId: string,
  userId: string,
  initialConversationId?: string
): UseChatDataReturn => {
  // Estados principais
  const [instances, setInstances] = useState<any[]>([])
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [selectedInstance, setSelectedInstance] = useState<string>()
  const [selectedConversation, setSelectedConversation] = useState<string>()
  const [filter, setFilter] = useState<ConversationFilter>({ type: 'all' })

  // Estados de loading
  const [instancesLoading, setInstancesLoading] = useState(true)
  const [conversationsLoading, setConversationsLoading] = useState(false)

  // =====================================================
  // BUSCAR INSTÂNCIAS DISPONÍVEIS
  // =====================================================

  const fetchInstances = useCallback(async () => {
    if (!companyId) return

    try {
      setInstancesLoading(true)
      const instancesData = await chatApi.getCompanyInstances(companyId)
      setInstances(instancesData)

      // NÃO auto-selecionar instância - deixar 'all' como padrão
      // Isso permite mostrar todas as conversas de todas as instâncias
      if (instancesData.length > 0 && !selectedInstance) {
        setSelectedInstance('all')
      }
    } catch (error) {
      console.error('Error fetching instances:', error)
      setInstances([])
    } finally {
      setInstancesLoading(false)
    }
  }, [companyId, selectedInstance])

  // =====================================================
  // BUSCAR CONVERSAS
  // =====================================================

  const fetchConversations = useCallback(async () => {
    if (!companyId || !userId) return

    try {
      setConversationsLoading(true)
      // Se selectedInstance for 'all', passar undefined para buscar todas as instâncias
      const instanceFilter = selectedInstance === 'all' ? undefined : selectedInstance
      const conversationsData = await chatApi.getConversations(
        companyId,
        userId,
        filter,
        instanceFilter
      )
      setConversations(conversationsData)
    } catch (error) {
      console.error('Error fetching conversations:', error)
      setConversations([])
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
      setConversations(prev => {
        // Evitar duplicatas
        if (prev.some(conv => conv.id === conversation.id)) return prev
        return [conversation, ...prev]
      })
    }
  }, [companyId])

  // Listener para conversas atualizadas
  useChatEvent('chat:conversation:updated', (payload: any) => {
    if (payload.data && payload.data.company_id === companyId) {
      setConversations(prev => 
        prev.map(conv => 
          conv.id === payload.data.id ? payload.data : conv
        )
      )
    }
  }, [companyId])

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
    setSelectedConversation(undefined) // Limpar conversa selecionada
    
    // Salvar no localStorage
    localStorage.setItem('chat_selected_instance', instanceId)
  }, [])

  const handleSetSelectedConversation = useCallback((conversationId: string) => {
    setSelectedConversation(conversationId)
  }, [])

  const handleSetFilter = useCallback((newFilter: ConversationFilter) => {
    setFilter(newFilter)
    setSelectedConversation(undefined) // Limpar conversa selecionada
    
    // Salvar no localStorage
    localStorage.setItem('chat_filter_state', JSON.stringify(newFilter))
  }, [])

  const refreshConversations = useCallback(() => {
    fetchConversations()
  }, [fetchConversations])

  // =====================================================
  // RESTAURAR ESTADO DO LOCALSTORAGE
  // =====================================================

  useEffect(() => {
    // Restaurar instância selecionada
    const savedInstance = localStorage.getItem('chat_selected_instance')
    if (savedInstance && instances.some(inst => inst.id === savedInstance)) {
      setSelectedInstance(savedInstance)
    }

    // Restaurar filtro
    const savedFilter = localStorage.getItem('chat_filter_state')
    if (savedFilter) {
      try {
        const parsedFilter = JSON.parse(savedFilter)
        setFilter(parsedFilter)
      } catch (error) {
        console.error('Error parsing saved filter:', error)
      }
    }
  }, [instances])

  // =====================================================
  // CONVERSAS FILTRADAS E ORDENADAS
  // =====================================================

  const filteredConversations = useMemo(() => {
    let filtered = [...conversations]

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
    // 'all' não precisa de filtro adicional

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
  }, [conversations, filter.search, filter.type])

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
              return [newConversation, ...prev]
            })
          } else if (payload.eventType === 'UPDATE') {
            // CORREÇÃO: Atualização parcial inteligente para preservar estrutura da view
            setConversations(prev => 
              prev.map(conv => 
                conv.id === payload.new.id 
                  ? { 
                      ...conv, 
                      unread_count: payload.new.unread_count,
                      last_message_at: payload.new.last_message_at ? new Date(payload.new.last_message_at) : conv.last_message_at,
                      last_message_content: payload.new.last_message_content || conv.last_message_content,
                      last_message_direction: payload.new.last_message_direction || conv.last_message_direction,
                      updated_at: new Date(payload.new.updated_at)
                    }
                  : conv
              )
            )
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
