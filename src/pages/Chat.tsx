// =====================================================
// PÁGINA CHAT - COMPONENTE ISOLADO
// =====================================================
// Página principal do sistema de chat
// NÃO MODIFICA páginas existentes

import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { AdaptiveChatLayout } from '../components/WhatsAppChat/ChatLayout'
import { InstanceDisconnectedNotification } from '../components/WhatsAppChat/InstanceDisconnectedNotification'

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

const ChatPage: React.FC = () => {
  const { t } = useTranslation('chat')
  const { user, company } = useAuth()

  // Deep-link do Dashboard: /chat?conversation_id=xxx
  const [searchParams] = useSearchParams()
  const initialConversationId = searchParams.get('conversation_id') ?? undefined

  // =====================================================
  // VERIFICAÇÕES DE ACESSO
  // =====================================================

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {t('access.restrictedTitle')}
          </h2>
          <p className="text-gray-600">
            {t('access.restrictedBody')}
          </p>
        </div>
      </div>
    )
  }

  if (!company) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{t('page.loadingCompany')}</p>
        </div>
      </div>
    )
  }

  // =====================================================
  // RENDER PRINCIPAL
  // =====================================================

  return (
    <div className="h-[calc(100vh-80px)] bg-gray-50">
      <InstanceDisconnectedNotification />
      <AdaptiveChatLayout
        companyId={company.id}
        userId={user.id}
        initialConversationId={initialConversationId}
      />
    </div>
  )
}

export default ChatPage
