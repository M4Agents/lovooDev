// =====================================================
// CHAT LAYOUT - COMPONENTE PRINCIPAL ISOLADO
// =====================================================
// Layout principal do chat com 3 colunas
// NÃO MODIFICA componentes existentes

import React from 'react'
import { useChatData } from '../../hooks/chat/useChatData'
import { ConversationSidebar } from './ConversationSidebar/ConversationSidebar'
import { ChatArea } from './ChatArea/ChatArea'
import { LeadPanel } from './LeadPanel/LeadPanel'
import type { ChatLayoutProps } from '../../types/whatsapp-chat'

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const ChatLayout: React.FC<ChatLayoutProps> = ({
  companyId,
  userId
}) => {
  const chatData = useChatData(companyId, userId)

  // =====================================================
  // LOADING STATE
  // =====================================================

  if (chatData.instancesLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando instâncias...</p>
        </div>
      </div>
    )
  }

  // =====================================================
  // NO INSTANCES STATE
  // =====================================================

  if (chatData.instances.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center max-w-md">
          <div className="mb-4">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Nenhuma instância WhatsApp conectada
          </h3>
          <p className="text-gray-600 mb-4">
            Você precisa conectar pelo menos uma instância WhatsApp para usar o chat.
          </p>
          <button
            onClick={() => window.location.href = '/settings/whatsapp-life'}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Conectar WhatsApp
          </button>
        </div>
      </div>
    )
  }

  // =====================================================
  // LAYOUT PRINCIPAL
  // =====================================================

  return (
    <div className="flex h-full bg-white">
      {/* Sidebar Conversas - 25% */}
      <div className="w-1/4 min-w-[300px] border-r border-gray-200 bg-gray-50">
        <ConversationSidebar
          instances={chatData.instances}
          conversations={chatData.conversations}
          selectedInstance={chatData.selectedInstance}
          selectedConversation={chatData.selectedConversation}
          filter={chatData.filter}
          loading={chatData.conversationsLoading}
          onSelectInstance={chatData.setSelectedInstance}
          onSelectConversation={chatData.setSelectedConversation}
          onFilterChange={chatData.setFilter}
          onRefresh={chatData.refreshConversations}
        />
      </div>

      {/* Área Chat - 50% */}
      <div className="flex-1 flex flex-col">
        {chatData.selectedConversation ? (
          <ChatArea
            conversationId={chatData.selectedConversation}
            companyId={companyId}
            userId={userId}
          />
        ) : (
          <div className="flex items-center justify-center h-full bg-white">
            <div className="text-center">
              <div className="mb-4">
                <svg className="mx-auto h-16 w-16 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Selecione uma conversa
              </h3>
              <p className="text-gray-600">
                Escolha uma conversa na sidebar para começar a conversar
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Painel Lead - 25% */}
      <div className="w-1/4 min-w-[300px] border-l border-gray-200 bg-gray-50">
        {chatData.selectedConversation ? (
          <LeadPanel
            conversationId={chatData.selectedConversation}
            companyId={companyId}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center px-4">
              <div className="mb-4">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <h4 className="text-sm font-medium text-gray-900 mb-1">
                Informações do Lead
              </h4>
              <p className="text-xs text-gray-600">
                Selecione uma conversa para ver as informações do contato
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// =====================================================
// COMPONENTE RESPONSIVO PARA MOBILE
// =====================================================

export const ChatLayoutMobile: React.FC<ChatLayoutProps> = ({
  companyId,
  userId
}) => {
  const chatData = useChatData(companyId, userId)
  const [activeView, setActiveView] = React.useState<'conversations' | 'chat' | 'lead'>('conversations')

  if (chatData.instancesLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header Mobile */}
      <div className="flex border-b border-gray-200 bg-white">
        <button
          onClick={() => setActiveView('conversations')}
          className={`flex-1 py-3 px-4 text-sm font-medium ${
            activeView === 'conversations'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600'
          }`}
        >
          Conversas
        </button>
        {chatData.selectedConversation && (
          <>
            <button
              onClick={() => setActiveView('chat')}
              className={`flex-1 py-3 px-4 text-sm font-medium ${
                activeView === 'chat'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600'
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setActiveView('lead')}
              className={`flex-1 py-3 px-4 text-sm font-medium ${
                activeView === 'lead'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600'
              }`}
            >
              Lead
            </button>
          </>
        )}
      </div>

      {/* Content Mobile */}
      <div className="flex-1 overflow-hidden">
        {activeView === 'conversations' && (
          <ConversationSidebar
            instances={chatData.instances}
            conversations={chatData.conversations}
            selectedInstance={chatData.selectedInstance}
            selectedConversation={chatData.selectedConversation}
            filter={chatData.filter}
            loading={chatData.conversationsLoading}
            onSelectInstance={chatData.setSelectedInstance}
            onSelectConversation={(id) => {
              chatData.setSelectedConversation(id)
              setActiveView('chat')
            }}
            onFilterChange={chatData.setFilter}
            onRefresh={chatData.refreshConversations}
          />
        )}

        {activeView === 'chat' && chatData.selectedConversation && (
          <ChatArea
            conversationId={chatData.selectedConversation}
            companyId={companyId}
            userId={userId}
          />
        )}

        {activeView === 'lead' && chatData.selectedConversation && (
          <LeadPanel
            conversationId={chatData.selectedConversation}
            companyId={companyId}
          />
        )}
      </div>
    </div>
  )
}

// =====================================================
// COMPONENTE ADAPTATIVO
// =====================================================

export const AdaptiveChatLayout: React.FC<ChatLayoutProps> = (props) => {
  const [isMobile, setIsMobile] = React.useState(false)

  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024)
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)

    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return isMobile ? (
    <ChatLayoutMobile {...props} />
  ) : (
    <ChatLayout {...props} />
  )
}

export default AdaptiveChatLayout
