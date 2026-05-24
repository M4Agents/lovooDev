// =====================================================
// CHAT LAYOUT - COMPONENTE PRINCIPAL ISOLADO
// =====================================================
// Layout principal do chat com 3 colunas.
// Suporta canal WhatsApp (comportamento original) e Instagram.
// NÃO refatora lógica WhatsApp existente.

import React, { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatData } from '../../hooks/chat/useChatData'
import { useInstagramChatData } from '../../hooks/chat/useInstagramChatData'
import { ConversationSidebar } from './ConversationSidebar/ConversationSidebar'
import { ChatArea } from './ChatArea/ChatArea'
import { InstagramChatArea } from './ChatArea/InstagramChatArea'
import { LeadPanel } from './LeadPanel/LeadPanel'
import { LockedChatPanel } from './LockedChatPanel'
import type { ChatConversation, ChatLayoutProps } from '../../types/whatsapp-chat'
import type { ChatChannel } from '../../types/instagram-chat'
import type { InstagramSidebarData } from './ConversationSidebar/ConversationSidebar'

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const ChatLayout: React.FC<ChatLayoutProps> = ({
  companyId,
  userId,
  initialConversationId,
  hideConversationSidebar = false
}) => {
  const { t } = useTranslation('chat')
  const chatData = useChatData(companyId, userId, initialConversationId)

  // Canal ativo — persiste entre sessões com fallback seguro
  const [selectedChannel, setSelectedChannel] = useState<ChatChannel>(() => {
    const saved = localStorage.getItem(`chat_channel_${userId}`)
    return saved === 'instagram' || saved === 'whatsapp' ? saved : 'whatsapp'
  })

  const handleChannelChange = useCallback((channel: ChatChannel) => {
    setSelectedChannel(channel)
    localStorage.setItem(`chat_channel_${userId}`, channel)
  }, [userId])

  // Hook Instagram — sempre chamado (regra dos hooks), enabled apenas quando canal = instagram
  const igChatData = useInstagramChatData(companyId, userId, selectedChannel === 'instagram')

  // igSidebarData memoizado para evitar re-render do Sidebar a cada render do ChatLayout
  const igSidebarData: InstagramSidebarData = useMemo(() => ({
    connections:            igChatData.connections,
    conversations:          igChatData.conversations,
    filteredConversations:  igChatData.filteredConversations,
    selectedConnectionId:   igChatData.selectedConnectionId,
    selectedConversationId: igChatData.selectedConversationId,
    filter:                 igChatData.filter,
    loading:                igChatData.conversationsLoading,
    onSelectConnection:     igChatData.setSelectedConnection,
    onSelectConversation:   igChatData.setSelectedConversation,
    onFilterChange:         igChatData.setFilter,
    onRefresh:              igChatData.refreshConversations,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    igChatData.connections,
    igChatData.conversations,
    igChatData.filteredConversations,
    igChatData.selectedConnectionId,
    igChatData.selectedConversationId,
    igChatData.filter,
    igChatData.conversationsLoading,
  ])

  // Conversa clicada que está bloqueada (lead is_over_plan = true) — apenas WhatsApp
  const [lockedConversation, setLockedConversation] = useState<ChatConversation | null>(null)

  const handleSelectConversation = useCallback((conversationId: string) => {
    const conversation = chatData.conversations.find(c => c.id === conversationId)
    if (conversation?.is_lead_over_plan) {
      setLockedConversation(conversation)
      return
    }
    setLockedConversation(null)
    chatData.setSelectedConversation(conversationId)
  }, [chatData])

  // =====================================================
  // LOADING STATE — apenas para WhatsApp (Instagram não bloqueia o layout)
  // =====================================================

  if (selectedChannel === 'whatsapp' && chatData.instancesLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-gradient-to-br from-slate-50 to-gray-100">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-200 border-t-slate-600 mx-auto mb-6"></div>
            <div className="absolute inset-0 rounded-full h-10 w-10 border-2 border-transparent border-t-blue-500 animate-pulse mx-auto"></div>
          </div>
          <p className="text-slate-600 font-medium">{t('layout.loadingInstances')}</p>
          <p className="text-slate-400 text-sm mt-1">{t('layout.loadingInstancesHint')}</p>
        </div>
      </div>
    )
  }

  // =====================================================
  // NO INSTANCES STATE — apenas para WhatsApp
  // =====================================================

  if (selectedChannel === 'whatsapp' && chatData.instances.length === 0) {
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
            {t('layout.noInstancesTitle')}
          </h3>
          <p className="text-slate-600 mb-6 leading-relaxed">
            {t('layout.noInstancesBody')}
          </p>
          <button
            onClick={() => window.location.href = '/settings/whatsapp-life'}
            className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-emerald-500 to-blue-600 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            {t('layout.connectWhatsApp')}
          </button>
        </div>
      </div>
    )
  }

  // =====================================================
  // LAYOUT PRINCIPAL — Instagram ou WhatsApp
  // =====================================================

  // Conversa Instagram selecionada
  const selectedIgConversation = igChatData.selectedConversationId
    ? igChatData.conversations.find(c => c.id === igChatData.selectedConversationId)
    : undefined

  // Conexão ativa da conversa Instagram selecionada
  const igConnectionActive = selectedIgConversation
    ? (igChatData.connections.find(c => c.id === selectedIgConversation.connection_id)?.status === 'active')
    : true

  return (
    <div className="flex h-full bg-gradient-to-br from-slate-50 to-gray-100">
      {/* Sidebar Conversas - 25% */}
      {!hideConversationSidebar && (
        <div className="w-1/4 min-w-[320px] bg-white/80 backdrop-blur-sm border-r border-slate-200/60 shadow-sm">
          <ConversationSidebar
            instances={chatData.instances}
            conversations={chatData.conversations}
            selectedInstance={chatData.selectedInstance}
            selectedConversation={chatData.selectedConversation}
            filter={chatData.filter}
            loading={chatData.conversationsLoading}
            onSelectInstance={chatData.setSelectedInstance}
            onSelectConversation={handleSelectConversation}
            onFilterChange={chatData.setFilter}
            onRefresh={chatData.refreshConversations}
            selectedChannel={selectedChannel}
            onChannelChange={handleChannelChange}
            igData={igSidebarData}
          />
        </div>
      )}

      {/* Área Chat - 50% */}
      <div className={`${hideConversationSidebar ? 'flex-[3]' : 'flex-1'} flex flex-col bg-white/60 backdrop-blur-sm`}>
        {selectedChannel === 'instagram' ? (
          selectedIgConversation ? (
            <InstagramChatArea
              conversation={selectedIgConversation}
              messages={igChatData.messages}
              messagesLoading={igChatData.messagesLoading}
              messagesError={igChatData.messagesError}
              sendLoading={igChatData.sendLoading}
              sendError={igChatData.sendError}
              replyingTo={igChatData.replyingTo}
              onSetReplyingTo={igChatData.setReplyingTo}
              onSendMessage={(text, replyToIgMessageId) =>
                igChatData.sendMessage({ text, reply_to_ig_message_id: replyToIgMessageId ?? null })
              }
              onReactToMessage={igChatData.reactToMessage}
              onRetryLoadMessages={() => igChatData.setSelectedConversation(selectedIgConversation.id)}
              onClearSendError={igChatData.clearSendError}
              connectionActive={igConnectionActive}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center p-8 bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 max-w-md">
                <div className="mb-6">
                  <div className="mx-auto h-20 w-20 rounded-3xl flex items-center justify-center shadow-lg"
                    style={{ background: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285AEB 90%)' }}
                  >
                    <svg className="h-10 w-10 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                    </svg>
                  </div>
                </div>
                <h3 className="text-xl font-semibold text-slate-800 mb-3">
                  {t('instagram.noConversationSelected')}
                </h3>
                <p className="text-slate-600 leading-relaxed">
                  {t('instagram.noConversationSelectedHint')}
                </p>
              </div>
            </div>
          )
        ) : (
          lockedConversation ? (
            <LockedChatPanel contactName={lockedConversation.contact_name} />
          ) : chatData.selectedConversation ? (
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
                  {t('layout.selectConversationTitle')}
                </h3>
                <p className="text-slate-600 leading-relaxed">
                  {t('layout.selectConversationBody')}
                </p>
              </div>
            </div>
          )
        )}
      </div>

      {/* Painel Lead - 25% (apenas WhatsApp por ora) */}
      <div className={`${hideConversationSidebar ? 'flex-[2] h-full' : 'w-1/4 min-w-[320px]'} bg-white/80 backdrop-blur-sm border-l border-slate-200/60 shadow-sm`}>
        {selectedChannel === 'whatsapp' && !lockedConversation && chatData.selectedConversation ? (
          <LeadPanel
            conversationId={chatData.selectedConversation}
            companyId={companyId}
            userId={userId}
            onLeadSaved={chatData.refreshConversations}
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
                {t('layout.leadPanelTitle')}
              </h4>
              <p className="text-sm text-slate-600 leading-relaxed">
                {t('layout.leadPanelBody')}
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
  const { t } = useTranslation('chat')
  const chatData = useChatData(companyId, userId)
  const [activeView, setActiveView] = React.useState<'conversations' | 'chat' | 'lead'>('conversations')
  const [lockedConversation, setLockedConversation] = React.useState<ChatConversation | null>(null)

  const handleSelectConversationMobile = useCallback((conversationId: string) => {
    const conversation = chatData.conversations.find(c => c.id === conversationId)
    if (conversation?.is_lead_over_plan) {
      setLockedConversation(conversation)
      setActiveView('chat')
      return
    }
    setLockedConversation(null)
    chatData.setSelectedConversation(conversationId)
    setActiveView('chat')
  }, [chatData])

  if (chatData.instancesLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{t('mobile.loading')}</p>
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
          {t('mobile.conversations')}
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
              {t('mobile.chat')}
            </button>
            <button
              onClick={() => setActiveView('lead')}
              className={`flex-1 py-3 px-4 text-sm font-medium ${
                activeView === 'lead'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600'
              }`}
            >
              {t('mobile.lead')}
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
            onSelectConversation={handleSelectConversationMobile}
            onFilterChange={chatData.setFilter}
            onRefresh={chatData.refreshConversations}
          />
        )}

        {activeView === 'chat' && (
          lockedConversation
            ? <LockedChatPanel contactName={lockedConversation.contact_name} />
            : chatData.selectedConversation
              ? <ChatArea
                  conversationId={chatData.selectedConversation}
                  companyId={companyId}
                  userId={userId}
                />
              : null
        )}

        {activeView === 'lead' && chatData.selectedConversation && (
          <LeadPanel
            conversationId={chatData.selectedConversation}
            companyId={companyId}
            userId={userId}
            onLeadSaved={chatData.refreshConversations}
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
