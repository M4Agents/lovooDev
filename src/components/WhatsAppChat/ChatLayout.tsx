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
      <div className="flex items-center justify-center h-full bg-gradient-to-br from-slate-50 to-gray-100">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-200 border-t-slate-600 mx-auto mb-6"></div>
            <div className="absolute inset-0 rounded-full h-10 w-10 border-2 border-transparent border-t-blue-500 animate-pulse mx-auto"></div>
          </div>
          <p className="text-slate-600 font-medium">Carregando instâncias...</p>
          <p className="text-slate-400 text-sm mt-1">Preparando seu ambiente de chat</p>
        </div>
      </div>
    )
  }

  // =====================================================
  // NO INSTANCES STATE
  // =====================================================

  if (chatData.instances.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-gradient-to-br from-slate-50 to-gray-100">
        <div className="text-center max-w-md p-8 bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20">
          <div className="mb-6">
            <div className="mx-auto h-16 w-16 bg-gradient-to-br from-emerald-400 to-blue-500 rounded-2xl flex items-center justify-center shadow-lg">
              <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
              </svg>
            </div>
          </div>
          <h3 className="text-xl font-semibold text-slate-800 mb-3">
            Bem-vindo ao Chat WhatsApp
          </h3>
          <p className="text-slate-600 mb-6 leading-relaxed">
            Para começar a usar o chat, você precisa conectar pelo menos uma instância WhatsApp Business.
          </p>
          <button
            onClick={() => window.location.href = '/settings/whatsapp-life'}
            className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-emerald-500 to-blue-600 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
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
    <div className="flex h-full bg-gradient-to-br from-slate-50 to-gray-100">
      {/* Sidebar Conversas - 25% */}
      <div className="w-1/4 min-w-[320px] bg-white/80 backdrop-blur-sm border-r border-slate-200/60 shadow-sm">
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
      <div className="flex-1 flex flex-col bg-white/60 backdrop-blur-sm">
        {chatData.selectedConversation ? (
          <ChatArea
            conversationId={chatData.selectedConversation}
            companyId={companyId}
            userId={userId}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center p-8 bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 max-w-md">
              <div className="mb-6">
                <div className="mx-auto h-20 w-20 bg-gradient-to-br from-slate-400 to-slate-600 rounded-3xl flex items-center justify-center shadow-lg">
                  <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
                  </svg>
                </div>
              </div>
              <h3 className="text-xl font-semibold text-slate-800 mb-3">
                Selecione uma conversa
              </h3>
              <p className="text-slate-600 leading-relaxed">
                Escolha uma conversa na sidebar para começar a trocar mensagens com seus clientes
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Painel Lead - 25% */}
      <div className="w-1/4 min-w-[320px] bg-white/80 backdrop-blur-sm border-l border-slate-200/60 shadow-sm">
        {chatData.selectedConversation ? (
          <LeadPanel
            conversationId={chatData.selectedConversation}
            companyId={companyId}
          />
        ) : (
          <div className="flex items-center justify-center h-full p-6">
            <div className="text-center">
              <div className="mb-6">
                <div className="mx-auto h-16 w-16 bg-gradient-to-br from-indigo-400 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
                  <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              </div>
              <h4 className="text-lg font-semibold text-slate-800 mb-2">
                Informações do Lead
              </h4>
              <p className="text-sm text-slate-600 leading-relaxed">
                Selecione uma conversa para visualizar e editar as informações do contato
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
