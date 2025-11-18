// =====================================================
// HOOK PRINCIPAL DO CHAT - ISOLADO
// =====================================================
// Hook principal para gerenciar dados do chat
// NÃO MODIFICA hooks existentes

import { useState, useEffect, useCallback, useMemo } from 'react'
import { chatApi } from '../../services/chat/chatApi'
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
  userId: string
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

      // Auto-selecionar primeira instância se disponível
      if (instancesData.length > 0 && !selectedInstance) {
        setSelectedInstance(instancesData[0].id)
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
      const conversationsData = await chatApi.getConversations(
        companyId,
        userId,
        filter,
        selectedInstance
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

  // Buscar conversas quando filtros mudarem
  useEffect(() => {
    if (selectedInstance) {
      fetchConversations()
    }
  }, [fetchConversations, selectedInstance])

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

    // Ordenar por última mensagem (mais recentes primeiro)
    filtered.sort((a, b) => {
      const aTime = a.last_message_at?.getTime() || 0
      const bTime = b.last_message_at?.getTime() || 0
      return bTime - aTime
    })

    return filtered
  }, [conversations, filter.search])

  // =====================================================
  // SUBSCRIPTION PARA TEMPO REAL
  // =====================================================

  useEffect(() => {
    if (!companyId) return

    // Subscrever mudanças nas conversas
    const subscription = chatApi.subscribeToConversations(
      companyId,
      (payload) => {
        console.log('Conversation change:', payload)
        
        // Atualizar lista de conversas
        if (payload.eventType === 'INSERT') {
          const newConversation = payload.new
          setConversations(prev => [newConversation, ...prev])
        } else if (payload.eventType === 'UPDATE') {
          const updatedConversation = payload.new
          setConversations(prev => 
            prev.map(conv => 
              conv.id === updatedConversation.id ? updatedConversation : conv
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

    return () => {
      subscription.unsubscribe()
    }
  }, [companyId])

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
