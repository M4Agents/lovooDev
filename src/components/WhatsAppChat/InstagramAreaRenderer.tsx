// =====================================================
// InstagramAreaRenderer — renderizador de área central e painel direito do Instagram
// =====================================================
// Responsabilidade única: decidir o que renderizar nas colunas central e direita
// quando o canal Instagram está ativo.
//
// ISOLAMENTO CRÍTICO:
//   - tabs 'all' e 'unread' → DMs (InstagramChatArea + CreateInstagramLeadPanel)
//   - tabs 'comments' e 'pending' → Comentários (InstagramCommentDetail + CommentLeadPanel)
//   - Nunca mistura as duas entidades
// =====================================================

import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { InstagramChatArea } from './ChatArea/InstagramChatArea'
import { CreateInstagramLeadPanel } from './InstagramLeadPanel/CreateInstagramLeadPanel'
import { LinkedInstagramLeadCard } from './InstagramLeadPanel/LinkedInstagramLeadCard'
import { InstagramCommentDetail } from '../InstagramComments/InstagramCommentDetail'
import { CommentLeadPanel } from '../InstagramComments/CommentLeadPanel'
import type { UseInstagramCommentsDataReturn } from '../../hooks/instagram/useInstagramCommentsData'
import type { InstagramSidebarData } from './ConversationSidebar/ConversationSidebar'
import type { ChatLayoutProps } from '../../types/whatsapp-chat'

interface InstagramAreaRendererProps {
  companyId: string
  igSidebarData: InstagramSidebarData
  igChatDataRaw: {
    messages: any[]
    messagesLoading: boolean
    messagesError?: string
    sendLoading: boolean
    sendMediaLoading: boolean
    sendError?: string
    replyingTo: any
    setReplyingTo: (msg: any) => void
    sendMessage: (payload: any) => Promise<void>
    sendMedia: (payload: any) => Promise<void>
    reactToMessage: (payload: any) => Promise<void>
    clearSendError: () => void
    createLead: (payload: any) => Promise<any>
    createLeadLoading: boolean
    createLeadError?: string
    clearCreateLeadError: () => void
    connections: any[]
    setSelectedConversation: (id: string) => void
  }
  igCommentsData: UseInstagramCommentsDataReturn
  activeTab: string
}

// ── Área Central ─────────────────────────────────────────────────────────────

export const InstagramMainArea: React.FC<InstagramAreaRendererProps> = ({
  companyId,
  igSidebarData,
  igChatDataRaw,
  igCommentsData,
  activeTab,
}) => {
  const { t }    = useTranslation('chat')
  const navigate = useNavigate()

  const isCommentTab = activeTab === 'comments' || activeTab === 'pending'

  if (isCommentTab) {
    // ── Área de Comentários ────────────────────────────────────────────────
    const { selectedComment } = igCommentsData

    if (!selectedComment) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center p-8 bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 max-w-md">
            <div className="mb-6">
              <div className="mx-auto h-20 w-20 rounded-3xl flex items-center justify-center shadow-lg"
                style={{ background: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285AEB 90%)' }}
              >
                <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
                </svg>
              </div>
            </div>
            <h3 className="text-xl font-semibold text-slate-800 mb-3">
              {t('instagram.comments.selectComment')}
            </h3>
            <p className="text-slate-600 leading-relaxed">
              {t('instagram.comments.selectCommentHint')}
            </p>
          </div>
        </div>
      )
    }

    const handleOpenConversation = (conversationId: string) => {
      // Mudar para tab 'all' de DMs e selecionar a conversa
      igSidebarData.onFilterChange({ ...igSidebarData.filter, type: 'all' })
      igSidebarData.onSelectConversation(conversationId)
    }

    return (
      <InstagramCommentDetail
        comment={selectedComment}
        commentsData={igCommentsData}
        onOpenConversation={handleOpenConversation}
      />
    )
  }

  // ── Área de DMs ────────────────────────────────────────────────────────────
  const selectedIgConversation = igSidebarData.selectedConversationId
    ? igSidebarData.conversations.find(c => c.id === igSidebarData.selectedConversationId)
    : undefined

  const igConnectionActive = selectedIgConversation
    ? (igChatDataRaw.connections.find(c => c.id === selectedIgConversation.connection_id)?.status === 'active')
    : true

  if (!selectedIgConversation) {
    return (
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
  }

  return (
    <InstagramChatArea
      conversation={selectedIgConversation}
      messages={igChatDataRaw.messages}
      messagesLoading={igChatDataRaw.messagesLoading}
      messagesError={igChatDataRaw.messagesError}
      sendLoading={igChatDataRaw.sendLoading}
      sendMediaLoading={igChatDataRaw.sendMediaLoading}
      sendError={igChatDataRaw.sendError}
      replyingTo={igChatDataRaw.replyingTo}
      onSetReplyingTo={igChatDataRaw.setReplyingTo}
      onSendMessage={(text, replyToIgMessageId) =>
        igChatDataRaw.sendMessage({ text, reply_to_ig_message_id: replyToIgMessageId ?? null })
      }
      onSendMedia={igChatDataRaw.sendMedia}
      onReactToMessage={igChatDataRaw.reactToMessage}
      onRetryLoadMessages={() => igChatDataRaw.setSelectedConversation(selectedIgConversation.id)}
      onClearSendError={igChatDataRaw.clearSendError}
      connectionActive={igConnectionActive}
      companyId={companyId}
    />
  )
}

// ── Painel Direito ────────────────────────────────────────────────────────────

export const InstagramRightPanel: React.FC<InstagramAreaRendererProps> = ({
  igSidebarData,
  igChatDataRaw,
  igCommentsData,
  activeTab,
}) => {
  const { t } = useTranslation('chat')

  const isCommentTab = activeTab === 'comments' || activeTab === 'pending'

  if (isCommentTab) {
    const { selectedComment } = igCommentsData
    if (!selectedComment) return <LeadPanelEmpty t={t} />

    return (
      <CommentLeadPanel
        comment={selectedComment}
        createLeadLoading={igCommentsData.createLeadLoading}
        createLeadError={igCommentsData.createLeadError}
        onCreateLead={igCommentsData.createLead}
        onClearError={igCommentsData.clearCreateLeadError}
      />
    )
  }

  // ── Painel Lead para DMs ───────────────────────────────────────────────────
  const selectedIgConversation = igSidebarData.selectedConversationId
    ? igSidebarData.conversations.find(c => c.id === igSidebarData.selectedConversationId)
    : undefined

  if (!selectedIgConversation) return <LeadPanelEmpty t={t} />

  if (selectedIgConversation.lead_id) {
    return (
      <LinkedInstagramLeadCard
        conversation={selectedIgConversation}
        leadId={selectedIgConversation.lead_id}
      />
    )
  }

  return (
    <CreateInstagramLeadPanel
      conversation={selectedIgConversation}
      onCreateLead={igChatDataRaw.createLead}
      createLeadLoading={igChatDataRaw.createLeadLoading}
      createLeadError={igChatDataRaw.createLeadError}
      onClearError={igChatDataRaw.clearCreateLeadError}
    />
  )
}

// ── Estado vazio painel direito ────────────────────────────────────────────

const LeadPanelEmpty: React.FC<{ t: (k: string) => string }> = ({ t }) => (
  <div className="flex items-center justify-center h-full p-6">
    <div className="text-center">
      <div className="mb-6">
        <div className="mx-auto h-16 w-16 bg-gradient-to-br from-indigo-400 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
          <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
      </div>
      <h4 className="text-lg font-semibold text-slate-800 mb-2">{t('layout.leadPanelTitle')}</h4>
      <p className="text-sm text-slate-600 leading-relaxed">{t('layout.leadPanelBody')}</p>
    </div>
  </div>
)
