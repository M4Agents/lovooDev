// =====================================================
// CHAT AREA - COMPONENTE ISOLADO
// =====================================================
// Área principal do chat com mensagens e input
// NÃO MODIFICA componentes existentes

import React, { useState, useEffect, useRef } from 'react'
import { chatApi } from '../../../services/chat/chatApi'
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
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [conversation, setConversation] = useState<any>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // =====================================================
  // BUSCAR MENSAGENS
  // =====================================================

  const fetchMessages = async () => {
    try {
      setLoading(true)
      const messagesData = await chatApi.getMessages(conversationId, companyId)
      setMessages(messagesData)
    } catch (error) {
      console.error('Error fetching messages:', error)
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

    try {
      setSending(true)
      
      // Adicionar mensagem otimisticamente
      const optimisticMessage: ChatMessage = {
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

      setMessages(prev => [...prev, optimisticMessage])

      // Enviar mensagem
      await chatApi.sendMessage(conversationId, companyId, messageForm, userId)
      
      // Recarregar mensagens para pegar a versão real
      await fetchMessages()
    } catch (error) {
      console.error('Error sending message:', error)
      // Remover mensagem otimística em caso de erro
      setMessages(prev => prev.filter(m => !m.id.startsWith('temp-')))
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

  // =====================================================
  // SUBSCRIPTION TEMPO REAL
  // =====================================================

  useEffect(() => {
    if (!conversationId) return

    const subscription = chatApi.subscribeToMessages(conversationId, (payload) => {
      if (payload.eventType === 'INSERT') {
        const newMessage = payload.new
        setMessages(prev => {
          // Evitar duplicatas
          if (prev.some(m => m.id === newMessage.id)) return prev
          return [...prev, newMessage]
        })
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
                (messages[index - 1] &&
                  Math.abs(message.timestamp.getTime() - messages[index - 1].timestamp.getTime()) > 300000) // 5 minutos
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
