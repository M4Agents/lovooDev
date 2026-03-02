// =====================================================
// CHAT REALTIME HOOK - SUBSCRIPTION UNIFICADA
// =====================================================
// Hook centralizado para gerenciar todas as subscriptions do chat
// Mantém compatibilidade total com sistema atual

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ChatEventBus } from '../../services/chat/chatEventBus'

// =====================================================
// CONFIGURAÇÕES
// =====================================================

interface ChatRealtimeOptions {
  enabled?: boolean
  debug?: boolean
  fallbackToLegacy?: boolean
  reconnectInterval?: number
}

interface ConnectionStatus {
  connected: boolean
  lastConnected?: Date
  reconnectAttempts: number
  error?: string
}

// =====================================================
// HOOK PRINCIPAL
// =====================================================

export const useChatRealtime = (
  companyId: string, 
  options: ChatRealtimeOptions = {}
) => {
  const {
    enabled = true,
    debug = true,
    fallbackToLegacy = true,
    reconnectInterval = 5000
  } = options

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
    reconnectAttempts: 0
  })

  const channelRef = useRef<any>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>()

  // =====================================================
  // FUNÇÃO DE CONEXÃO
  // =====================================================

  const connect = () => {
    if (!enabled || !companyId) {
      if (debug) console.log('Chat realtime desabilitado')
      return
    }

    if (channelRef.current) {
      if (debug) console.log('Desconectando canal anterior...')
      channelRef.current.unsubscribe()
    }

    if (debug) {
      console.log('Iniciando subscription unificada')
    }

    const channelName = `chat-unified-${companyId}-${Date.now()}`
    
    try {
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'chat_messages',
            filter: `company_id=eq.${companyId}`
          },
          (payload) => {
            if (debug) {
              console.log('Mensagem recebida via subscription')
            }

            // Processar diferentes tipos de eventos
            handleMessageEvent(payload)
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'chat_conversations',
            filter: `company_id=eq.${companyId}`
          },
          (payload) => {
            if (debug) {
              console.log('Conversa atualizada via subscription')
            }

            handleConversationEvent(payload)
          }
        )
        .subscribe((status) => {
          if (debug) {
            console.log('Status da subscription:', status)
          }

          if (status === 'SUBSCRIBED') {
            setConnectionStatus({
              connected: true,
              lastConnected: new Date(),
              reconnectAttempts: 0
            })
            
            // Limpar timeout de reconexão se existir
            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current)
            }
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            setConnectionStatus(prev => ({
              ...prev,
              connected: false,
              error: `Connection ${status}`
            }))
            
            // Tentar reconectar
            scheduleReconnect()
          }
        })

      channelRef.current = channel

    } catch (error) {
      console.error('❌ Erro ao criar subscription:', error)
      setConnectionStatus(prev => ({
        ...prev,
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }))
      
      scheduleReconnect()
    }
  }

  // =====================================================
  // HANDLERS DE EVENTOS
  // =====================================================

  const handleMessageEvent = (payload: any) => {
    const { eventType, new: newData, old: oldData } = payload

    try {
      switch (eventType) {
        case 'INSERT':
          // Nova mensagem recebida
          if (newData) {
            ChatEventBus.emitMessageReceived(newData.conversation_id, newData)
            
            // Compatibilidade com sistema atual
            if (fallbackToLegacy) {
              window.dispatchEvent(new CustomEvent('refreshMessages', {
                detail: {
                  conversationId: newData.conversation_id,
                  companyId: newData.company_id
                }
              }))
            }
          }
          break

        case 'UPDATE':
          // Status de mensagem atualizado
          if (newData && oldData) {
            ChatEventBus.emitMessageStatusUpdate(
              newData.id,
              newData.status,
              newData.conversation_id
            )
            
            // Emitir evento específico para a conversa
            ChatEventBus.emit(`chat:message:${newData.id}:updated`, newData)
          }
          break

        case 'DELETE':
          // Mensagem deletada (raro, mas possível)
          if (oldData) {
            ChatEventBus.emit('chat:message:deleted', oldData)
          }
          break
      }
    } catch (error) {
      console.error('❌ Erro ao processar evento de mensagem:', error)
    }
  }

  const handleConversationEvent = (payload: any) => {
    const { eventType, new: newData, old: oldData } = payload

    try {
      switch (eventType) {
        case 'INSERT':
          // Nova conversa criada
          if (newData) {
            ChatEventBus.emit('chat:conversation:created', newData)
          }
          break

        case 'UPDATE':
          // Conversa atualizada (nova mensagem, atribuição, etc.)
          if (newData) {
            ChatEventBus.emitConversationUpdate(newData.id, newData)
          }
          break

        case 'DELETE':
          // Conversa deletada/arquivada
          if (oldData) {
            ChatEventBus.emit('chat:conversation:deleted', oldData)
          }
          break
      }
    } catch (error) {
      console.error('❌ Erro ao processar evento de conversa:', error)
    }
  }

  // =====================================================
  // RECONEXÃO AUTOMÁTICA
  // =====================================================

  const scheduleReconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }

    setConnectionStatus(prev => ({
      ...prev,
      reconnectAttempts: prev.reconnectAttempts + 1
    }))

    const delay = Math.min(reconnectInterval * Math.pow(2, connectionStatus.reconnectAttempts), 30000)
    
    if (debug) {
      console.log(`Reagendando reconexão em ${delay}ms`)
    }

    reconnectTimeoutRef.current = setTimeout(() => {
      if (debug) {
        console.log('Tentando reconectar...')
      }
      connect()
    }, delay)
  }

  // =====================================================
  // EFEITOS
  // =====================================================

  useEffect(() => {
    connect()

    return () => {
      if (debug) {
        console.log('Desconectando subscription unificada')
      }
      
      if (channelRef.current) {
        channelRef.current.unsubscribe()
      }
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [companyId, enabled])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [])

  // =====================================================
  // MÉTODOS PÚBLICOS
  // =====================================================

  const forceReconnect = () => {
    if (debug) {
      console.log('Forçando reconexão...')
    }
    connect()
  }

  const disconnect = () => {
    if (debug) {
      console.log('Desconectando manualmente...')
    }
    
    if (channelRef.current) {
      channelRef.current.unsubscribe()
      channelRef.current = null
    }
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    
    setConnectionStatus({
      connected: false,
      reconnectAttempts: 0
    })
  }

  return {
    connectionStatus,
    forceReconnect,
    disconnect,
    isConnected: connectionStatus.connected
  }
}

// =====================================================
// HOOK PARA MENSAGENS ESPECÍFICAS DE UMA CONVERSA
// =====================================================

export const useConversationRealtime = (
  conversationId: string,
  onMessageReceived?: (message: any) => void,
  onMessageUpdated?: (message: any) => void
) => {
  useEffect(() => {
    if (!conversationId) return

    const unsubscribeReceived = ChatEventBus.on(
      `chat:conversation:${conversationId}:message`,
      (payload: any) => {
        if (payload.action === 'insert' && onMessageReceived) {
          onMessageReceived(payload.data)
        }
      }
    )

    const unsubscribeUpdated = ChatEventBus.on(
      `chat:conversation:${conversationId}:status`,
      (payload: any) => {
        if (payload.action === 'update' && onMessageUpdated) {
          onMessageUpdated(payload.data)
        }
      }
    )

    return () => {
      unsubscribeReceived()
      unsubscribeUpdated()
    }
  }, [conversationId, onMessageReceived, onMessageUpdated])
}

export default useChatRealtime
