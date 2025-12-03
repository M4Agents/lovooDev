// =====================================================
// CHAT FEATURES - CONFIGURAÇÃO DE FUNCIONALIDADES
// =====================================================
// Controle centralizado de features do chat para rollback seguro

export interface ChatFeatureConfig {
  UNIFIED_REALTIME: boolean      // Subscription unificada
  OPTIMISTIC_MESSAGES: boolean   // Mensagens otimísticas melhoradas
  EVENT_BUS: boolean            // Sistema de eventos centralizado
  DEBUG_LOGS: boolean           // Logs detalhados
  FALLBACK_TO_LEGACY: boolean   // Fallback para sistema atual
  AUTO_RECONNECT: boolean       // Reconexão automática
  MESSAGE_TIMEOUT: number       // Timeout para mensagens (ms)
  RECONNECT_INTERVAL: number    // Intervalo de reconexão (ms)
}

// =====================================================
// CONFIGURAÇÃO PADRÃO (SEGURA)
// =====================================================

export const CHAT_FEATURES: ChatFeatureConfig = {
  // Features principais (ativadas gradualmente)
  UNIFIED_REALTIME: true,        // ✅ Ativar subscription unificada
  OPTIMISTIC_MESSAGES: true,     // ✅ Ativar mensagens otimísticas
  EVENT_BUS: true,              // ✅ Ativar event bus
  
  // Debug e fallbacks (sempre ativos para segurança)
  DEBUG_LOGS: process.env.NODE_ENV !== 'production', // ✅ Debug apenas em dev
  FALLBACK_TO_LEGACY: true,     // ✅ Sempre manter fallback
  AUTO_RECONNECT: true,         // ✅ Reconexão automática
  
  // Timeouts (valores conservadores)
  MESSAGE_TIMEOUT: 30000,       // 30 segundos para timeout de mensagem
  RECONNECT_INTERVAL: 5000      // 5 segundos para reconexão
}

// =====================================================
// CONFIGURAÇÕES POR AMBIENTE
// =====================================================

export const getFeatureConfig = (): ChatFeatureConfig => {
  const env = process.env.NODE_ENV
  
  switch (env) {
    case 'development':
      return {
        ...CHAT_FEATURES,
        DEBUG_LOGS: true,
        MESSAGE_TIMEOUT: 10000,    // Timeout menor em dev
        RECONNECT_INTERVAL: 2000   // Reconexão mais rápida em dev
      }
    
    case 'production':
      return {
        ...CHAT_FEATURES,
        DEBUG_LOGS: false,
        MESSAGE_TIMEOUT: 45000,    // Timeout maior em prod
        RECONNECT_INTERVAL: 10000  // Reconexão mais conservadora em prod
      }
    
    default:
      return CHAT_FEATURES
  }
}

// =====================================================
// UTILITÁRIOS PARA CONTROLE DE FEATURES
// =====================================================

export class ChatFeatureManager {
  private static config = getFeatureConfig()
  
  static isEnabled(feature: keyof ChatFeatureConfig): boolean {
    return Boolean(this.config[feature])
  }
  
  static getValue<K extends keyof ChatFeatureConfig>(feature: K): ChatFeatureConfig[K] {
    return this.config[feature]
  }
  
  static updateConfig(updates: Partial<ChatFeatureConfig>) {
    this.config = { ...this.config, ...updates }
    console.log('🔧 Chat features atualizadas:', updates)
  }
  
  static resetToDefault() {
    this.config = getFeatureConfig()
    console.log('🔄 Chat features resetadas para padrão')
  }
  
  static getFullConfig(): ChatFeatureConfig {
    return { ...this.config }
  }
  
  // Métodos de conveniência para features específicas
  static shouldUseUnifiedRealtime(): boolean {
    return this.isEnabled('UNIFIED_REALTIME')
  }
  
  static shouldUseOptimisticMessages(): boolean {
    return this.isEnabled('OPTIMISTIC_MESSAGES')
  }
  
  static shouldUseEventBus(): boolean {
    return this.isEnabled('EVENT_BUS')
  }
  
  static shouldShowDebugLogs(): boolean {
    return this.isEnabled('DEBUG_LOGS')
  }
  
  static shouldFallbackToLegacy(): boolean {
    return this.isEnabled('FALLBACK_TO_LEGACY')
  }
  
  static getMessageTimeout(): number {
    return this.getValue('MESSAGE_TIMEOUT')
  }
  
  static getReconnectInterval(): number {
    return this.getValue('RECONNECT_INTERVAL')
  }
}

// =====================================================
// CONFIGURAÇÕES DE EMERGÊNCIA (ROLLBACK TOTAL)
// =====================================================

export const EMERGENCY_ROLLBACK_CONFIG: ChatFeatureConfig = {
  UNIFIED_REALTIME: false,       // ❌ Desativar subscription unificada
  OPTIMISTIC_MESSAGES: false,    // ❌ Desativar mensagens otimísticas
  EVENT_BUS: false,             // ❌ Desativar event bus
  DEBUG_LOGS: true,             // ✅ Manter logs para debug
  FALLBACK_TO_LEGACY: true,     // ✅ Forçar uso do sistema legado
  AUTO_RECONNECT: false,        // ❌ Desativar reconexão automática
  MESSAGE_TIMEOUT: 60000,       // Timeout muito alto
  RECONNECT_INTERVAL: 30000     // Reconexão muito lenta
}

// Função para rollback de emergência
export const enableEmergencyRollback = () => {
  ChatFeatureManager.updateConfig(EMERGENCY_ROLLBACK_CONFIG)
  console.warn('🚨 EMERGENCY ROLLBACK ATIVADO - Sistema voltou ao comportamento legado')
}

// =====================================================
// HOOK PARA REACT
// =====================================================

import { useState, useEffect } from 'react'

export const useChatFeatures = () => {
  const [config, setConfig] = useState(ChatFeatureManager.getFullConfig())
  
  useEffect(() => {
    // Listener para mudanças na configuração
    const interval = setInterval(() => {
      const currentConfig = ChatFeatureManager.getFullConfig()
      setConfig(currentConfig)
    }, 1000) // Check a cada segundo
    
    return () => clearInterval(interval)
  }, [])
  
  return {
    config,
    isEnabled: ChatFeatureManager.isEnabled,
    getValue: ChatFeatureManager.getValue,
    updateConfig: ChatFeatureManager.updateConfig,
    resetToDefault: ChatFeatureManager.resetToDefault,
    enableEmergencyRollback
  }
}

export default ChatFeatureManager
