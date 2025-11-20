// =====================================================
// CHAT AREA - COMPONENTE ISOLADO
// =====================================================
// Área principal do chat com mensagens e input
// NÃO MODIFICA componentes existentes

import React, { useState, useEffect, useRef } from 'react'
import { chatApi } from '../../../services/chat/chatApi'
import { ChatEventBus, useChatEvent } from '../../../services/chat/chatEventBus'
import { ChatFeatureManager } from '../../../config/chatFeatures'
import { useConversationRealtime } from '../../../hooks/chat/useChatRealtime'
import type { ChatMessage, SendMessageForm, ChatAreaProps } from '../../../types/whatsapp-chat'

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const ChatArea: React.FC<ChatAreaProps> = ({
  conversationId,
  companyId,
  userId
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [conversation, setConversation] = useState<any>(null)
  // 🚨 EMERGÊNCIA: Cache desabilitado temporariamente para resolver tela branca
  const [sentMessages, setSentMessages] = useState<ChatMessage[]>([])
  
  // Limpar qualquer cache existente que possa estar corrompido
  useEffect(() => {
    if (conversationId) {
      try {
        localStorage.removeItem(`sentMessages_${conversationId}`)
        console.log('🧹 Cache limpo para resolver tela branca')
      } catch (error) {
        console.warn('Erro ao limpar cache:', error)
      }
    }
  }, [conversationId])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 🚨 EMERGÊNCIA: Persistência desabilitada temporariamente
  // useEffect para cache desabilitado até resolver tela branca

  // =====================================================
  // BUSCAR MENSAGENS
  // =====================================================

  const fetchMessages = async () => {
    try {
      setLoading(true)
      console.log('🔍 DEBUG: Iniciando fetchMessages', {
        conversationId,
        companyId,
        timestamp: new Date().toISOString()
      })
      
      const messagesData = await chatApi.getMessages(conversationId, companyId, 100) // Aumentar limite para 100
      
      console.log('📊 DEBUG: Dados retornados da API:', {
        total: messagesData?.length || 0,
        primeiras3: messagesData?.slice(0, 3).map(m => ({
          id: m.id,
          content: m.content?.substring(0, 30),
          direction: m.direction,
          status: m.status,
          timestamp: m.timestamp
        })),
        ultimas3: messagesData?.slice(-3).map(m => ({
          id: m.id,
          content: m.content?.substring(0, 30),
          direction: m.direction,
          status: m.status,
          timestamp: m.timestamp
        }))
      })
      
      // Merge inteligente: preservar mensagens locais temporárias
      setMessages(prev => {
        console.log('🔄 DEBUG: Estado anterior do chat:', {
          total: prev.length,
          temporarias: prev.filter(msg => msg.id.startsWith('temp-')).length,
          permanentes: prev.filter(msg => !msg.id.startsWith('temp-')).length
        })
        
        // Mensagens temporárias (ainda não confirmadas no banco)
        const tempMessages = prev.filter(msg => msg.id.startsWith('temp-'))
        
        // Mensagens do banco
        const bankMessages = messagesData || []
        
        // Combinar sem duplicatas
        const allMessages = [...bankMessages, ...tempMessages]
        
        // Ordenar por timestamp
        const sortedMessages = allMessages.sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
        
        console.log('✅ DEBUG: Merge concluído:', {
          banco: bankMessages.length,
          temporarias: tempMessages.length,
          total: sortedMessages.length,
          finalMessages: sortedMessages.slice(-3).map(m => ({
            id: m.id,
            content: m.content?.substring(0, 30),
            direction: m.direction,
            status: m.status,
            source: bankMessages.find(b => b.id === m.id) ? 'BANCO' : 'TEMP'
          }))
        })
        
        return sortedMessages
      })
      
    } catch (error) {
      console.error('❌ DEBUG: Erro ao buscar mensagens:', error)
      // Em caso de erro, manter mensagens existentes
    } finally {
      setLoading(false)
    }
  }

  // =====================================================
  // BUSCAR DADOS DA CONVERSA
  // =====================================================

  const fetchConversation = async () => {
    try {
      const conversations = await chatApi.getConversations(companyId, userId, { type: 'all' })
      const conv = conversations.find(c => c.id === conversationId)
      setConversation(conv)
    } catch (error) {
      console.error('Error fetching conversation:', error)
    }
  }

  // =====================================================
  // ENVIAR MENSAGEM
  // =====================================================

  const handleSendMessage = async (messageForm: SendMessageForm) => {
    if (!messageForm.content.trim()) return

    // 1. Criar mensagem local imediatamente (UX instantâneo)
    const tempMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      conversation_id: conversationId,
      company_id: companyId,
      instance_id: conversation?.instance_id || '',
      message_type: messageForm.message_type,
      content: messageForm.content,
      media_url: messageForm.media_url,
      direction: 'outbound',
      status: 'sending',
      is_scheduled: false,
      sent_by: userId,
      timestamp: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    }

    try {
      setSending(true)
      console.log('🚀 DEBUG: Iniciando envio de mensagem', {
        conversationId,
        companyId,
        userId,
        content: messageForm.content,
        tempId: tempMessage.id
      })
      
      // Adicionar mensagem local imediatamente
      setMessages(prev => {
        console.log('📝 DEBUG: Adicionando mensagem temporária ao estado')
        return [...prev, tempMessage]
      })
      
      // 2. Enviar para o banco
      const messageId = await chatApi.sendMessage(conversationId, companyId, messageForm, userId)
      console.log('✅ DEBUG: Mensagem enviada com sucesso', {
        tempId: tempMessage.id,
        realId: messageId,
        timestamp: new Date().toISOString()
      })
      
      // 3. Atualizar mensagem local com ID real
      setMessages(prev => {
        const updated = prev.map(msg => 
          msg.id === tempMessage.id 
            ? { ...msg, id: messageId, status: 'sent' as const }
            : msg
        )
        console.log('🔄 DEBUG: Mensagem temporária atualizada com ID real')
        return updated
      })
      
      // 4. Aguardar um pouco e recarregar para garantir sincronização
      setTimeout(async () => {
        try {
          console.log('⏰ DEBUG: Iniciando recarregamento após 2s delay')
          
          // 🔧 CORREÇÃO: Buscar mais mensagens para garantir que a nova seja incluída
          const messagesData = await chatApi.getMessages(conversationId, companyId, 100) // Aumentar limite
          
          console.log('📊 DEBUG: Recarregamento com limite aumentado:', {
            total: messagesData?.length || 0,
            contemMensagemEnviada: messagesData?.some(m => m.id === messageId) || false
          })
          
          // Se a mensagem não estiver no resultado, forçar inclusão
          setMessages(prev => {
            const bankMessages = messagesData || []
            const hasNewMessage = bankMessages.some(m => m.id === messageId)
            
            if (!hasNewMessage) {
              console.log('🚨 DEBUG: Mensagem não encontrada no banco, mantendo no estado')
              // Manter mensagem atual se não estiver no banco
              return prev
            }
            
            // Se encontrou, usar dados do banco
            const sortedMessages = bankMessages.sort((a, b) => 
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            )
            
            console.log('✅ DEBUG: Mensagem encontrada no banco, atualizando estado')
            return sortedMessages
          })
          
          console.log('🔄 DEBUG: Recarregamento concluído')
        } catch (error) {
          console.warn('⚠️ DEBUG: Erro ao recarregar mensagens:', error)
        }
      }, 2000)
      
    } catch (error) {
      console.error('❌ Erro ao enviar mensagem:', error)
      // Remover mensagem local em caso de erro
      setMessages(prev => prev.filter(msg => msg.id !== tempMessage.id))
      throw error
    } finally {
      setSending(false)
    }
  }

  // =====================================================
  // EFEITOS
  // =====================================================

  useEffect(() => {
    if (conversationId && companyId) {
      fetchMessages()
      fetchConversation()
    }
  }, [conversationId, companyId])

  // Auto-scroll para última mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ✅ CORREÇÃO: Removido listener de refreshMessages que causava loop
  // O sistema de cache + tempo real agora garante atualizações sem auto-refresh

  // =====================================================
  // SUBSCRIPTION TEMPO REAL OTIMIZADA
  // =====================================================

  // Hook para receber mensagens em tempo real desta conversa
  useConversationRealtime(
    conversationId,
    // Callback para nova mensagem recebida
    (message) => {
      const debugLogs = ChatFeatureManager.shouldShowDebugLogs()
      
      if (debugLogs) {
        console.log('📨 Nova mensagem recebida via realtime:', message)
      }
      
      setMessages(prev => {
        // Evitar duplicatas
        if (prev.some(m => m.id === message.id)) {
          if (debugLogs) {
            console.log('⚠️ Mensagem duplicada ignorada:', message.id)
          }
          return prev
        }
        return [...prev, message]
      })
    },
    // Callback para status de mensagem atualizado
    (statusUpdate) => {
      const debugLogs = ChatFeatureManager.shouldShowDebugLogs()
      
      if (debugLogs) {
        console.log('🔄 Status de mensagem atualizado:', statusUpdate)
      }
      
      setMessages(prev => 
        prev.map(m => {
          // Atualizar por ID ou por tempId (para mensagens otimísticas)
          const msg = m as any
          if (m.id === statusUpdate.messageId || msg._tempId === statusUpdate.messageId) {
            return { ...m, status: statusUpdate.status }
          }
          return m
        })
      )
    }
  )

  // ✅ NOVO: Listener para eventos do chat via Event Bus
  useChatEvent(`chat:conversation:${conversationId}:message`, (payload) => {
    const debugLogs = ChatFeatureManager.shouldShowDebugLogs()
    
    if (debugLogs) {
      console.log('📨 Evento de mensagem via Event Bus:', payload)
    }
    
    if (payload.action === 'insert' && payload.data) {
      setMessages(prev => {
        // Evitar duplicatas
        if (prev.some(m => m.id === payload.data.id)) return prev
        return [...prev, payload.data]
      })
    }
  }, [conversationId])

  // ✅ NOVO: Listener para atualizações de status via Event Bus
  useChatEvent(`chat:conversation:${conversationId}:status`, (payload) => {
    const debugLogs = ChatFeatureManager.shouldShowDebugLogs()
    
    if (debugLogs) {
      console.log('🔄 Evento de status via Event Bus:', payload)
    }
    
    if (payload.action === 'update' && payload.data) {
      const { messageId, status } = payload.data
      setMessages(prev => 
        prev.map(m => {
          const msg = m as any
          if (m.id === messageId || msg._tempId === messageId) {
            return { ...m, status }
          }
          return m
        })
      )
    }
  }, [conversationId])

  // ✅ FALLBACK: Manter subscription legada se Event Bus desabilitado
  useEffect(() => {
    if (!conversationId || ChatFeatureManager.shouldUseEventBus()) return

    const debugLogs = ChatFeatureManager.shouldShowDebugLogs()
    
    if (debugLogs) {
      console.log('🔄 Usando subscription legada (fallback)')
    }

    const subscription = chatApi.subscribeToMessages(conversationId, (payload) => {
      if (payload.eventType === 'INSERT') {
        const newMessage = payload.new
        setMessages(prev => {
          if (prev.some(m => m.id === newMessage.id)) return prev
          return [...prev, newMessage]
        })
      } else if (payload.eventType === 'UPDATE') {
        const updatedMessage = payload.new
        setMessages(prev => 
          prev.map(m => 
            m.id === updatedMessage.id 
              ? { ...m, status: updatedMessage.status, uazapi_message_id: updatedMessage.uazapi_message_id }
              : m
          )
        )
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [conversationId])

  // =====================================================
  // LOADING STATE
  // =====================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando mensagens...</p>
        </div>
      </div>
    )
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                {conversation?.contact_name || conversation?.contact_phone || 'Conversa'}
              </h3>
              {conversation?.contact_name && (
                <p className="text-sm text-gray-600">{conversation.contact_phone}</p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {conversation?.assigned_to && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                Atribuída
              </span>
            )}
            
            <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
            </svg>
            <p className="text-gray-600">Nenhuma mensagem ainda</p>
            <p className="text-sm text-gray-500 mt-1">Envie a primeira mensagem para começar a conversa</p>
          </div>
        ) : (
          messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              isOwn={message.direction === 'outbound'}
              showTimestamp={
                index === 0 ||
                (messages[index - 1] && (() => {
                  try {
                    const currentTime = message.timestamp instanceof Date ? 
                      message.timestamp.getTime() : new Date(message.timestamp).getTime()
                    const prevTime = messages[index - 1].timestamp instanceof Date ? 
                      messages[index - 1].timestamp.getTime() : new Date(messages[index - 1].timestamp).getTime()
                    return Math.abs(currentTime - prevTime) > 300000 // 5 minutos
                  } catch (error) {
                    console.warn('⚠️ Erro ao calcular timestamp, mostrando sempre:', error)
                    return true // Mostrar timestamp em caso de erro
                  }
                })())
              }
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 bg-white p-4">
        <MessageInput
          onSendMessage={handleSendMessage}
          disabled={sending}
          placeholder="Digite sua mensagem..."
        />
      </div>
    </div>
  )
}

// =====================================================
// COMPONENTE BOLHA DE MENSAGEM
// =====================================================

interface MessageBubbleProps {
  message: ChatMessage
  isOwn: boolean
  showTimestamp?: boolean
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isOwn,
  showTimestamp
}) => {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('pt-BR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  const getStatusIcon = (status: ChatMessage['status']) => {
    switch (status) {
      case 'sending':
        return <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
      case 'sent':
        return <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      case 'delivered':
        return <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      case 'read':
        return <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      case 'failed':
        return <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      default:
        return null
    }
  }

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-xs lg:max-w-md ${isOwn ? 'order-2' : 'order-1'}`}>
        {showTimestamp && (
          <div className="text-center text-xs text-gray-500 mb-2">
            {formatTime(message.timestamp)}
          </div>
        )}
        
        <div
          className={`px-4 py-2 rounded-lg ${
            isOwn
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-900'
          }`}
        >
          <p className="text-sm">{message.content}</p>
          
          {isOwn && (
            <div className="flex items-center justify-end mt-1 space-x-1">
              <span className="text-xs opacity-75">
                {formatTime(message.timestamp)}
              </span>
              {getStatusIcon(message.status)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// =====================================================
// COMPONENTE INPUT DE MENSAGEM
// =====================================================

interface MessageInputProps {
  onSendMessage: (message: SendMessageForm) => void
  disabled?: boolean
  placeholder?: string
}

const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  disabled,
  placeholder = 'Digite sua mensagem...'
}) => {
  const [message, setMessage] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!message.trim() || disabled) return

    onSendMessage({
      content: message.trim(),
      message_type: 'text'
    })

    setMessage('')
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end space-x-3">
      <div className="flex-1">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none disabled:opacity-50"
          style={{ minHeight: '40px', maxHeight: '120px' }}
        />
      </div>
      
      <button
        type="button"
        className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
      </button>

      <button
        type="submit"
        disabled={!message.trim() || disabled}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      </button>
    </form>
  )
}

export default ChatArea
