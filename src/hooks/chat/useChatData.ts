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
    const debugLogs = ChatFeatureManager.shouldShowDebugLogs()
    
    if (debugLogs) {
      console.log('💬 Nova conversa criada via Event Bus:', conversation)
    }
    
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
    const debugLogs = ChatFeatureManager.shouldShowDebugLogs()
    
    if (debugLogs) {
      console.log('🔄 Conversa atualizada via Event Bus:', payload)
    }
    
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
    const debugLogs = ChatFeatureManager.shouldShowDebugLogs()
    
    if (debugLogs) {
      console.log('📨 Mensagem recebida - atualizando conversa:', payload)
    }
    
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
    if (!companyId) return

    console.log('🚀 Iniciando subscriptions do chat:', { companyId, userId, selectedInstance })

    // Subscrever mudanças nas conversas
    const conversationSubscription = supabase
      .channel('chat_conversations')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_conversations',
          filter: `company_id=eq.${companyId}`
        },
        (payload) => {
          console.log('Conversation change:', payload)
          
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
    .subscribe()

    // Função específica para buscar nova conversa (sem dependências circulares)
    const fetchSingleConversation = async (conversationId: string) => {
      try {
        console.log('🔍 Buscando nova conversa:', conversationId)
        console.log('📋 Parâmetros:', { companyId, userId, selectedInstance })
        
        // Validar parâmetros necessários
        if (!companyId || !userId) {
          console.log('⚠️ Parâmetros faltando:', { companyId: !!companyId, userId: !!userId })
          return
        }
        
        const response = await chatApi.getConversations(companyId, userId, { type: 'all' }, selectedInstance)
        const newConversation = response.find(conv => conv.id === conversationId)
        
        if (newConversation) {
          console.log('✅ Nova conversa encontrada:', newConversation.contact_name || newConversation.contact_phone)
          setConversations(prev => {
            // Verificar se já existe para evitar duplicatas
            const exists = prev.some(conv => conv.id === conversationId)
            if (exists) {
              console.log('⚠️ Conversa já existe na lista, ignorando')
              return prev
            }
            console.log('📝 Adicionando nova conversa no topo da lista')
            return [newConversation, ...prev]
          })
        } else {
          console.log('❌ Nova conversa não encontrada no servidor')
        }
      } catch (error) {
        console.error('❌ Erro ao buscar nova conversa:', error)
      }
    }

    // Subscrever mudanças nas mensagens para atualizar contadores
    const messageSubscription = supabase
      .channel('chat_messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `company_id=eq.${companyId}` // CORREÇÃO: Filtrar por empresa
        },
        (payload) => {
          console.log('📨 Nova mensagem recebida via Realtime:', payload)
          
          // Atualizar conversa relacionada com atualização local otimista
          const newMessage = payload.new as any
          if (newMessage.conversation_id && newMessage.company_id === companyId) {
            console.log('🎯 Processando mensagem para conversa:', newMessage.conversation_id)
            console.log('📄 Conteúdo:', newMessage.content)
            console.log('📞 Telefone:', newMessage.from_phone || 'N/A')
            console.log('⬅️ Direção:', newMessage.direction)
            
            // 1. Primeiro: Atualização local otimista (instantânea)
            setConversations(prev => {
              const existingIndex = prev.findIndex(conv => conv.id === newMessage.conversation_id)
              console.log('🔍 Conversa existente encontrada no índice:', existingIndex)
              
              if (existingIndex >= 0) {
                // Conversa existe: atualizar e mover para o topo
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
                
                console.log('✅ Atualizando conversa existente:', {
                  contact: existingConv.contact_name || existingConv.contact_phone,
                  oldUnreadCount: existingConv.unread_count,
                  newUnreadCount: updatedConv.unread_count,
                  lastMessage: newMessage.content
                })
                
                // Remover da posição atual e adicionar no topo
                updated.splice(existingIndex, 1)
                return [updatedConv, ...updated]
              } else {
                // Conversa nova: buscar do servidor (sem dependência circular)
                console.log('🆕 Nova conversa detectada, buscando do servidor...')
                fetchSingleConversation(newMessage.conversation_id)
                return prev
              }
            })
            
            // 2. Emitir evento para consistência com outros sistemas
            ChatEventBus.emit('chat:message:received', {
              conversationId: newMessage.conversation_id,
              companyId: newMessage.company_id,
              message: newMessage,
              timestamp: new Date(newMessage.timestamp)
            })
            
            console.log('🚀 Evento emitido via ChatEventBus')
          } else {
            console.log('⚠️ Mensagem ignorada - não atende critérios:', {
              hasConversationId: !!newMessage.conversation_id,
              companyMatch: newMessage.company_id === companyId,
              expectedCompany: companyId,
              actualCompany: newMessage.company_id
            })
          }
        }
      )
      .subscribe()

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
