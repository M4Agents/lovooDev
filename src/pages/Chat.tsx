// =====================================================
// PÁGINA CHAT - COMPONENTE ISOLADO
// =====================================================
// Página principal do sistema de chat
// NÃO MODIFICA páginas existentes

import React from 'react'
import { useAuth } from '../contexts/AuthContext'
import { AdaptiveChatLayout } from '../components/WhatsAppChat/ChatLayout'

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

const ChatPage: React.FC = () => {
  const { user, company } = useAuth()

  // =====================================================
  // VERIFICAÇÕES DE ACESSO
  // =====================================================

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Acesso Restrito
          </h2>
          <p className="text-gray-600">
            Você precisa estar logado para acessar o chat.
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
          <p className="text-gray-600">Carregando empresa...</p>
        </div>
      </div>
    )
  }

  // =====================================================
  // RENDER PRINCIPAL
  // =====================================================

  return (
    <div className="h-[calc(100vh-80px)] bg-gray-50">
      <AdaptiveChatLayout 
        companyId={company.id}
        userId={user.id}
      />
    </div>
  )
}

export default ChatPage
