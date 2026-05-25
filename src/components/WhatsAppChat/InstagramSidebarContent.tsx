// =====================================================
// InstagramSidebarContent — conteúdo da área de lista Instagram
// =====================================================
// Encapsula a lógica de renderizar lista de DMs OU lista de Comentários
// dependendo do filtro ativo, mantendo ConversationSidebar enxuto.
//
// ISOLAMENTO:
//   - tabs 'all' e 'unread' → DMs (InstagramConversationList)
//   - tabs 'comments' e 'pending' → Comentários (InstagramCommentsList)
//   - Nunca mistura as duas entidades
// =====================================================

import React from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { InstagramCommentsList } from '../InstagramComments/InstagramCommentsList'
import type { InstagramSidebarData } from './ConversationSidebar/ConversationSidebar'
import type { UseInstagramCommentsDataReturn } from '../../hooks/instagram/useInstagramCommentsData'

interface InstagramSidebarContentProps {
  igData?: InstagramSidebarData
  igCommentsData?: UseInstagramCommentsDataReturn
  activeTab: string
}

export const InstagramSidebarContent: React.FC<InstagramSidebarContentProps> = ({
  igData,
  igCommentsData,
  activeTab,
}) => {
  const isCommentTab = activeTab === 'comments' || activeTab === 'pending'

  if (isCommentTab) {
    if (!igCommentsData) return null
    return (
      <InstagramCommentsList
        comments={igCommentsData.comments}
        loading={igCommentsData.commentsLoading}
        error={igCommentsData.commentsError}
        selectedCommentId={igCommentsData.selectedCommentId}
        onSelectComment={igCommentsData.setSelectedComment}
        onRefresh={igCommentsData.refreshComments}
      />
    )
  }

  // Tabs 'all' e 'unread' → DMs
  return <InstagramConversationList igData={igData} />
}

// =====================================================
// Lista de DMs Instagram (extraída do ConversationSidebar)
// =====================================================

interface InstagramConversationListProps {
  igData?: InstagramSidebarData
}

const InstagramConversationList: React.FC<InstagramConversationListProps> = ({ igData }) => {
  const { t }    = useTranslation('chat')
  const navigate = useNavigate()

  if (!igData) return null

  if (igData.loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-pink-500" />
      </div>
    )
  }

  if (igData.connections.filter(c => c.status === 'active').length === 0) {
    return (
      <div className="text-center py-12 px-6">
        <div className="mb-4">
          <div
            className="mx-auto h-16 w-16 rounded-2xl flex items-center justify-center shadow-sm"
            style={{ background: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285AEB 90%)' }}
          >
            <svg className="h-8 w-8 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
            </svg>
          </div>
        </div>
        <h4 className="text-lg font-semibold text-slate-700 mb-2">{t('instagram.noAccounts')}</h4>
        <p className="text-slate-500 text-sm leading-relaxed mb-4">{t('instagram.noAccountsHint')}</p>
        <button
          onClick={() => navigate('/settings?tab=integracoes&integration=instagram')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-600 text-white text-sm font-medium rounded-xl shadow-sm hover:shadow-md transition-all"
        >
          {t('instagram.connectButton')}
        </button>
      </div>
    )
  }

  const convs = igData.filteredConversations

  if (convs.length === 0) {
    return (
      <div className="text-center py-12 px-6">
        <div className="mb-4">
          <div className="mx-auto h-16 w-16 bg-gradient-to-br from-slate-300 to-slate-400 rounded-2xl flex items-center justify-center shadow-sm">
            <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
            </svg>
          </div>
        </div>
        <h4 className="text-lg font-semibold text-slate-700 mb-2">{t('instagram.noConversations')}</h4>
        <p className="text-slate-500 text-sm leading-relaxed">{t('instagram.noConversationsHint')}</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-slate-100">
      {convs.map(conv => (
        <IgConvItem
          key={conv.id}
          conversation={conv}
          isSelected={conv.id === igData.selectedConversationId}
          onClick={() => igData.onSelectConversation(conv.id)}
        />
      ))}
    </div>
  )
}

// Alias de IgConvItem — mantém o mesmo visual de antes
import type { InstagramChatConversation } from '../../types/instagram-chat'

interface IgConvItemProps {
  conversation: InstagramChatConversation
  isSelected: boolean
  onClick: () => void
}

const IgConvItem: React.FC<IgConvItemProps> = ({ conversation, isSelected, onClick }) => {
  const formatTime = (ts: string | null) => {
    if (!ts) return ''
    try {
      const d = new Date(ts), now = new Date()
      const diff = now.getTime() - d.getTime()
      const minutes = Math.floor(diff / 60000)
      const hours   = Math.floor(diff / 3600000)
      const days    = Math.floor(diff / 86400000)
      if (minutes < 1)  return 'Agora'
      if (minutes < 60) return `${minutes}m`
      if (hours < 24)   return `${hours}h`
      if (days < 7)     return `${days}d`
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    } catch { return '' }
  }

  const displayName = conversation.participant_name
    || (conversation.participant_username ? `@${conversation.participant_username}` : 'Usuário Instagram')

  return (
    <button
      onClick={onClick}
      className={`w-full p-4 text-left transition-all duration-200 ${
        isSelected
          ? 'bg-pink-50 border-r-4 border-pink-500 shadow-sm'
          : conversation.unread_count > 0
            ? 'bg-pink-50/50 hover:bg-pink-50 border-l-4 border-pink-400 shadow-sm'
            : 'hover:bg-white/80 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">
          {conversation.participant_avatar ? (
            <img
              src={conversation.participant_avatar}
              alt={displayName}
              className="w-12 h-12 rounded-xl object-cover shadow-sm"
            />
          ) : (
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg font-bold shadow-sm"
              style={{ background: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285AEB 90%)' }}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h4 className={`text-sm truncate ${conversation.unread_count > 0 ? 'font-bold' : 'font-semibold'} ${isSelected ? 'text-slate-800' : 'text-slate-700'}`}>
              {displayName}
            </h4>
            <div className="flex items-center space-x-2 ml-3 flex-shrink-0">
              {conversation.last_message_at && (
                <span className="text-xs font-medium text-slate-500">
                  {formatTime(conversation.last_message_at)}
                </span>
              )}
              {conversation.unread_count > 0 && (
                <span className="inline-flex items-center justify-center px-2.5 py-1 text-xs font-bold leading-none text-white bg-pink-500 rounded-full shadow-sm">
                  {conversation.unread_count}
                </span>
              )}
            </div>
          </div>
          {conversation.participant_username && conversation.participant_name && (
            <p className="text-xs text-slate-400 truncate">@{conversation.participant_username}</p>
          )}
          {conversation.last_message_preview && (
            <p className={`text-sm truncate mt-1 ${isSelected ? 'text-slate-600' : 'text-slate-500'}`}>
              {conversation.last_message_preview}
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

export default InstagramSidebarContent
