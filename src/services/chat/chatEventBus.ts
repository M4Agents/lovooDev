// =====================================================
// CHAT EVENT BUS - SISTEMA DE EVENTOS UNIFICADO
// =====================================================
// Sistema centralizado para comunicação entre componentes do chat
// Mantém compatibilidade total com sistema atual

export interface ChatEventPayload {
  type: 'message' | 'conversation' | 'status'
  action: 'insert' | 'update' | 'delete'
  data: any
  conversationId?: string
  companyId?: string
  timestamp: number
}

// =====================================================
// CLASSE PRINCIPAL DO EVENT BUS
// =====================================================

export class ChatEventBus {
  private static listeners: Map<string, Function[]> = new Map()
  private static debugMode = true

  // =====================================================
  // EMITIR EVENTOS
  // =====================================================

  static emit(event: string, data: any) {
    if (this.debugMode) {
      console.log(`🔔 ChatEvent: ${event}`, {
        timestamp: new Date().toISOString(),
        data: data
      })
    }
    
    // Método atual (mantém compatibilidade 100%)
    try {
      window.dispatchEvent(new CustomEvent(event, { detail: data }))
    } catch (error) {
      console.warn('Fallback to window events failed:', error)
    }
    
    // Método otimizado (novo sistema)
    const callbacks = this.listeners.get(event) || []
    callbacks.forEach((callback, index) => {
      try {
        callback(data)
      } catch (error) {
        console.error(`Error in event listener ${index} for ${event}:`, error)
      }
    })
  }

  // =====================================================
  // ESCUTAR EVENTOS
  // =====================================================

  static on(event: string, callback: Function): () => void {
    const listeners = this.listeners.get(event) || []
    listeners.push(callback)
    this.listeners.set(event, listeners)
    
    if (this.debugMode) {
      console.log(`👂 Listener adicionado para: ${event}`, {
        totalListeners: listeners.length
      })
    }
    
    // Retorna função para remover listener
    return () => {
      const updated = this.listeners.get(event)?.filter(cb => cb !== callback) || []
      this.listeners.set(event, updated)
      
      if (this.debugMode) {
        console.log(`🔇 Listener removido de: ${event}`, {
          remainingListeners: updated.length
        })
      }
    }
  }

  // =====================================================
  // EVENTOS ESPECÍFICOS DO CHAT
  // =====================================================

  static emitMessageReceived(conversationId: string, message: any) {
    const payload: ChatEventPayload = {
      type: 'message',
      action: 'insert',
      data: message,
      conversationId,
      companyId: message.company_id,
      timestamp: Date.now()
    }

    this.emit('chat:message:received', payload)
    this.emit(`chat:conversation:${conversationId}:message`, payload)
    this.emit('chat:message', payload) // Evento geral
  }

  static emitMessageStatusUpdate(messageId: string, status: string, conversationId?: string) {
    const payload: ChatEventPayload = {
      type: 'status',
      action: 'update',
      data: { messageId, status },
      conversationId,
      timestamp: Date.now()
    }

    this.emit('chat:message:status', payload)
    if (conversationId) {
      this.emit(`chat:conversation:${conversationId}:status`, payload)
    }
  }

  static emitConversationUpdate(conversationId: string, conversation: any) {
    const payload: ChatEventPayload = {
      type: 'conversation',
      action: 'update',
      data: conversation,
      conversationId,
      companyId: conversation.company_id,
      timestamp: Date.now()
    }

    this.emit('chat:conversation:updated', payload)
    this.emit(`chat:conversation:${conversationId}:updated`, payload)
  }

  // Emite atualização otimista imediata após envio bem-sucedido de mensagem outbound.
  // Permite que useChatData reordene a lista antes que o Realtime propague o evento do banco.
  static emitConversationMessageSent(
    companyId: string,
    conversationId: string,
    content: string,
    timestamp: Date
  ) {
    this.emit('chat:conversation:message:sent', {
      companyId,
      conversationId,
      content,
      timestamp,
      direction: 'outbound' as const,
    })
  }

  // =====================================================
  // UTILITÁRIOS
  // =====================================================

  static setDebugMode(enabled: boolean) {
    this.debugMode = enabled
    console.log(`🐛 Chat debug mode: ${enabled ? 'ON' : 'OFF'}`)
  }

  static getListenerCount(event?: string): number | Record<string, number> {
    if (event) {
      return this.listeners.get(event)?.length || 0
    }
    
    const counts: Record<string, number> = {}
    this.listeners.forEach((listeners, eventName) => {
      counts[eventName] = listeners.length
    })
    return counts
  }

  static clearAllListeners() {
    const eventCount = this.listeners.size
    this.listeners.clear()
    console.log(`🧹 Removidos listeners de ${eventCount} eventos`)
  }

  // =====================================================
  // COMPATIBILIDADE COM SISTEMA ATUAL
  // =====================================================

  static emitLegacy(event: string, data: any) {
    // Mantém compatibilidade total com código existente
    window.dispatchEvent(new CustomEvent(event, { detail: data }))
  }

  static onLegacy(event: string, callback: (event: CustomEvent) => void): () => void {
    // Mantém compatibilidade total com código existente
    window.addEventListener(event, callback as EventListener)
    
    return () => {
      window.removeEventListener(event, callback as EventListener)
    }
  }
}

// =====================================================
// HOOKS PARA REACT
// =====================================================

import { useEffect, useCallback } from 'react'

export const useChatEvent = (event: string, callback: Function, deps: any[] = []) => {
  const memoizedCallback = useCallback(callback, deps)

  useEffect(() => {
    const unsubscribe = ChatEventBus.on(event, memoizedCallback)
    return unsubscribe
  }, [event, memoizedCallback])
}

export const useChatEventEmitter = () => {
  return useCallback((event: string, data: any) => {
    ChatEventBus.emit(event, data)
  }, [])
}

// =====================================================
// CONFIGURAÇÃO INICIAL
// =====================================================

// Configurar debug mode baseado no ambiente
if (typeof window !== 'undefined') {
  const isProduction = process.env.NODE_ENV === 'production'
  ChatEventBus.setDebugMode(!isProduction)
}

export default ChatEventBus
