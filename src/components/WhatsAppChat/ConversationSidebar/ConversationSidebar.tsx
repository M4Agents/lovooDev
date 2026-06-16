// =====================================================
// CONVERSATION SIDEBAR - COMPONENTE ISOLADO
// =====================================================
// Sidebar com lista de conversas e filtros.
// Suporta canal WhatsApp e Instagram via ChannelSelector.
// O comportamento do canal WhatsApp permanece intacto.

import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { ChatConversation, ConversationFilter } from '../../../types/whatsapp-chat'
import type {
  InstagramChannelFilter,
  InstagramConnection,
  ChatChannel,
} from '../../../types/instagram-chat'
import type { UseInstagramCommentsDataReturn } from '../../../hooks/instagram/useInstagramCommentsData'
import { InstanceSelector } from '../InstanceSelector'
import { ChannelSelector } from '../ChannelSelector/ChannelSelector'
import { InstagramAccountSelector } from '../InstagramAccountSelector/InstagramAccountSelector'
import { InstagramSidebarContent } from '../InstagramSidebarContent'
import { resolvePhotoUrl } from '../../../utils/imageUtils'
import { chatApi } from '../../../services/chat/chatApi'

// =====================================================
// TIPOS DO COMPONENTE
// =====================================================

/** Dados do canal Instagram passados do ChatLayout */
export interface InstagramSidebarData {
  connections: InstagramConnection[]
  conversations: import('../../../types/instagram-chat').InstagramChatConversation[]
  filteredConversations: import('../../../types/instagram-chat').InstagramChatConversation[]
  selectedConnectionId: string
  selectedConversationId?: string
  filter: InstagramChannelFilter
  loading: boolean
  onSelectConnection: (id: string) => void
  onSelectConversation: (id: string) => void
  onFilterChange: (f: InstagramChannelFilter) => void
  onRefresh: () => void
}

interface ConversationSidebarProps {
  /** FASE 5ZG: necessários para busca no banco */
  companyId: string
  userId: string
  instances: any[]
  conversations: ChatConversation[]
  selectedInstance?: string
  selectedConversation?: string
  filter: ConversationFilter
  loading: boolean
  onSelectInstance: (instanceId: string) => void
  onSelectConversation: (conversationId: string) => void
  onFilterChange: (filter: ConversationFilter) => void
  onRefresh: () => void
  /** Paginação da lista de conversas */
  hasMoreConversations?: boolean
  loadMoreConversations?: () => Promise<void>
  loadingMoreConversations?: boolean
  /** Canal ativo — padrão 'whatsapp' */
  selectedChannel?: ChatChannel
  onChannelChange?: (channel: ChatChannel) => void
  /** Dados do canal Instagram (opcional quando whatsapp selecionado) */
  igData?: InstagramSidebarData
  /** Dados de comentários Instagram (opcional) */
  igCommentsData?: UseInstagramCommentsDataReturn
}

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  companyId,
  userId,
  instances,
  conversations,
  selectedInstance,
  selectedConversation,
  filter,
  loading,
  onSelectInstance,
  onSelectConversation,
  onFilterChange,
  onRefresh,
  hasMoreConversations = false,
  loadMoreConversations,
  loadingMoreConversations = false,
  selectedChannel,
  onChannelChange,
  igData,
  igCommentsData,
}) => {
  const { t } = useTranslation('chat')
  const [searchTerm, setSearchTerm] = useState('')

  // FASE 5ZG: estados de busca no banco
  const [searchResults,  setSearchResults]  = useState<ChatConversation[]>([])
  const [isSearching,    setIsSearching]    = useState(false)
  const [searchError,    setSearchError]    = useState(false)
  // Contador para descartar respostas de requests obsoletas (race condition)
  const searchRequestRef = useRef(0)

  const isInstagram = selectedChannel === 'instagram'

  // Tab ativa para Instagram (incluindo 'comments' e 'pending')
  const activeIgTab = igData?.filter.type ?? 'all'
  const isCommentTab = activeIgTab === 'comments' || activeIgTab === 'pending'

  // =====================================================
  // FILTROS (dinâmicos por canal)
  // =====================================================

  const filterOptions = useMemo(() => {
    if (isInstagram && igData) {
      const convs = igData.conversations
      const comments = igCommentsData?.comments ?? []
      return [
        { key: 'all'      as const, label: t('sidebar.filters.all'),      count: convs.length },
        { key: 'unread'   as const, label: t('sidebar.filters.unread'),   count: convs.filter(c => c.unread_count > 0).length },
        { key: 'comments' as const, label: t('instagram.comments.tabComments'), count: comments.filter(c => c.status !== 'ignored').length },
        { key: 'pending'  as const, label: t('instagram.comments.tabPending'),  count: comments.filter(c => c.status === 'pending').length },
      ]
    }
    return [
      { key: 'all' as const,        label: t('sidebar.filters.all'),        count: conversations.length },
      { key: 'unread' as const,     label: t('sidebar.filters.unread'),     count: conversations.filter(c => c.unread_count > 0).length },
      { key: 'assigned' as const,   label: t('sidebar.filters.assigned'),   count: conversations.filter(c => c.assigned_to).length },
      { key: 'unassigned' as const, label: t('sidebar.filters.unassigned'), count: conversations.filter(c => !c.assigned_to).length },
    ]
  }, [conversations, igData, igCommentsData, isInstagram, t])

  // =====================================================
  // FASE 5ZG — BUSCA REAL NO BANCO (debounce + anti-race)
  // =====================================================
  // Ativada quando searchTerm >= 2 chars (WhatsApp apenas).
  // Respeita visibilidade de sellers (FASE 5ZC via RPC).

  useEffect(() => {
    if (isInstagram || searchTerm.trim().length < 2) {
      setSearchResults([])
      setSearchError(false)
      return
    }

    const requestId = ++searchRequestRef.current

    const timeout = setTimeout(async () => {
      setIsSearching(true)
      setSearchError(false)
      try {
        const instanceFilter = selectedInstance === 'all' ? undefined : selectedInstance
        const results = await chatApi.searchConversations(
          companyId,
          userId,
          filter,
          searchTerm,
          instanceFilter
        )
        if (requestId === searchRequestRef.current) {
          setSearchResults(results)
        }
      } catch {
        if (requestId === searchRequestRef.current) {
          setSearchError(true)
        }
      } finally {
        if (requestId === searchRequestRef.current) {
          setIsSearching(false)
        }
      }
    }, 400)

    return () => clearTimeout(timeout)
  }, [searchTerm, companyId, userId, filter.type, selectedInstance, isInstagram])

  // =====================================================
  // CONVERSAS WA — origem dinâmica (busca ou lista paginada)
  // =====================================================
  // Quando busca ativa (>= 2 chars): usa resultados do banco.
  // Quando vazio/curto: usa lista paginada carregada (comportamento original).

  const isSearchActive = searchTerm.trim().length >= 2 && !isInstagram

  const filteredWaConversations = conversations.filter(conversation => {
    if (!searchTerm) return true
    const searchLower = searchTerm.toLowerCase()
    const isRestricted = conversation.is_lead_over_plan === true
    return (
      conversation.contact_name?.toLowerCase().includes(searchLower) ||
      (!isRestricted && conversation.contact_phone.includes(searchTerm)) ||
      (!isRestricted && conversation.last_message_content?.toLowerCase().includes(searchLower))
    )
  })

  const conversationsToShow = isSearchActive ? searchResults : filteredWaConversations

  // =====================================================
  // HANDLERS DO CANAL INSTAGRAM
  // =====================================================

  const handleIgFilterChange = (type: typeof filter.type) => {
    // Para tabs de comentário, atualizar o filtro de comentários também
    if (type === 'comments' || type === 'pending') {
      igCommentsData?.setFilter({ tab: type, connection_id: igData?.selectedConnectionId !== 'all' ? igData?.selectedConnectionId : undefined })
    }
    igData?.onFilterChange({ ...igData.filter, type: type as any })
  }

  // =====================================================
  // RENDER
  // =====================================================

  const activeLoading = isInstagram
    ? (isCommentTab ? (igCommentsData?.commentsLoading ?? false) : (igData?.loading ?? false))
    : loading

  return (
    <div className="flex flex-col h-full">
      {/* Header compacto */}
      <div className="p-3 border-b border-slate-200/60 bg-gradient-to-r from-white to-slate-50">

        {/* Linha única: ícone + título | pills canal + refresh */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`h-7 w-7 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0 ${
              isInstagram ? 'bg-gradient-to-br from-pink-500 to-purple-600' : 'bg-[#00a884]'
            }`}>
              {isInstagram ? (
                <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
                </svg>
              )}
            </div>
            <span className="text-sm font-semibold text-slate-800">{t('sidebar.title')}</span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Pills de canal — compacto */}
            <ChannelSelector
              compact
              selectedChannel={selectedChannel}
              onChannelChange={onChannelChange}
            />
            {/* Refresh */}
            <button
              onClick={isInstagram ? igData?.onRefresh : onRefresh}
              disabled={activeLoading}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-white/60 disabled:opacity-50 transition-all duration-200"
            >
              <svg className={`w-4 h-4 ${activeLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Seletor de Instância (WhatsApp) */}
        {!isInstagram && instances.length > 0 && (
          <div className="mb-2">
            <InstanceSelector
              instances={instances}
              selectedInstance={selectedInstance || 'all'}
              onSelectInstance={onSelectInstance}
              showAllOption={true}
              conversationCount={conversations.length}
            />
          </div>
        )}

        {/* Seletor de Conta (Instagram) */}
        {isInstagram && (
          <div className="mb-2">
            <InstagramAccountSelector
              connections={igData?.connections ?? []}
              selectedConnectionId={igData?.selectedConnectionId ?? 'all'}
              onSelectConnection={igData?.onSelectConnection ?? (() => {})}
              conversationCount={igData?.filteredConversations.length ?? 0}
            />
          </div>
        )}

        {/* Busca */}
        <div className="relative">
          <input
            type="text"
            placeholder={t('sidebar.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value)
              if (isInstagram) {
                igData?.onFilterChange({ ...(igData.filter), search: e.target.value })
              }
            }}
            className="w-full pl-10 pr-4 py-2 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all duration-200 placeholder-slate-400 text-sm"
          />
          <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Filtros — chips horizontais com scroll */}
      <div className="px-3 py-2 border-b border-slate-200/40 bg-slate-50/60">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
          {filterOptions.map(option => {
            const activeKey = isInstagram ? igData?.filter.type : filter.type
            const isActive = activeKey === option.key

            const handleClick = () => {
              if (isInstagram) {
                handleIgFilterChange(option.key)
              } else {
                onFilterChange({ ...filter, type: option.key as any })
              }
            }

            return (
              <button
                key={option.key}
                onClick={handleClick}
                className={`flex-shrink-0 flex items-center gap-1.5 min-h-[36px] px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200 ${
                  isActive
                    ? isInstagram
                      ? 'bg-pink-500 text-white shadow-sm'
                      : 'bg-[#009E7E] text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                <span className="leading-none">{option.label}</span>
                <span className={`leading-none font-bold ${isActive ? 'text-white/90' : 'text-slate-500'}`}>
                  {option.count}
                </span>
                {option.count > 0 && option.key === 'unread' && !isActive && (
                  <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse flex-shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Lista de Conversas / Comentários */}
      <div className="flex-1 overflow-y-auto bg-gradient-to-b from-white to-slate-50/50">
        {isInstagram
          ? (
            <InstagramSidebarContent
              igData={igData}
              igCommentsData={igCommentsData}
              activeTab={activeIgTab}
            />
          )
          : <WhatsAppConversationList
              loading={loading}
              filteredConversations={conversationsToShow}
              selectedConversation={selectedConversation}
              onSelectConversation={onSelectConversation}
              selectedInstance={selectedInstance}
              searchTerm={searchTerm}
              isSearchActive={isSearchActive}
              isSearching={isSearching}
              searchError={searchError}
              hasMoreConversations={!isSearchActive && hasMoreConversations}
              loadMoreConversations={loadMoreConversations}
              loadingMoreConversations={loadingMoreConversations}
            />
        }
      </div>
    </div>
  )
}

// =====================================================
// SUB-COMPONENTE: Lista WhatsApp
// =====================================================

interface WhatsAppConversationListProps {
  loading: boolean
  filteredConversations: ChatConversation[]
  selectedConversation?: string
  onSelectConversation: (id: string) => void
  selectedInstance?: string
  searchTerm: string
  /** FASE 5ZG: controles de busca no banco */
  isSearchActive?: boolean
  isSearching?: boolean
  searchError?: boolean
  hasMoreConversations?: boolean
  loadMoreConversations?: () => Promise<void>
  loadingMoreConversations?: boolean
}

const WhatsAppConversationList: React.FC<WhatsAppConversationListProps> = ({
  loading, filteredConversations, selectedConversation, onSelectConversation, selectedInstance, searchTerm,
  isSearchActive = false, isSearching = false, searchError = false,
  hasMoreConversations = false, loadMoreConversations, loadingMoreConversations = false
}) => {
  const { t } = useTranslation('chat')

  // Buscando no banco...
  if (isSearching) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-[#00a884]" />
        <p className="text-sm text-slate-500">Buscando...</p>
      </div>
    )
  }

  // Erro na busca
  if (searchError) {
    return (
      <div className="text-center py-12 px-6">
        <p className="text-sm text-red-500">Erro na busca. Tente novamente.</p>
      </div>
    )
  }

  return loading ? (
    <div className="flex items-center justify-center py-12">
      <div className="relative">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-[#00a884]"></div>
        <div className="absolute inset-0 rounded-full h-8 w-8 border-2 border-transparent border-t-[#00a884] animate-pulse"></div>
      </div>
    </div>
  ) : filteredConversations.length === 0 ? (
    <div className="text-center py-12 px-6">
      <div className="mb-4">
        <div className="mx-auto h-16 w-16 bg-gradient-to-br from-slate-300 to-slate-400 rounded-2xl flex items-center justify-center shadow-sm">
          <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
          </svg>
        </div>
      </div>
      <h4 className="text-lg font-semibold text-slate-700 mb-2">
        {searchTerm ? t('sidebar.emptyNoResults') : t('sidebar.emptyNoConversations')}
      </h4>
      <p className="text-slate-500 text-sm leading-relaxed">
        {searchTerm ? t('sidebar.emptyHintSearch') : t('sidebar.emptyHintDefault')}
      </p>
    </div>
  ) : (
    <div className="divide-y divide-slate-100">
      {filteredConversations.map(conversation => (
        <ConversationItem
          key={conversation.id}
          conversation={conversation}
          isSelected={conversation.id === selectedConversation}
          onClick={() => onSelectConversation(conversation.id)}
          photoUrl={conversation.profile_picture_url}
          showInstanceBadge={!selectedInstance || selectedInstance === 'all'}
        />
      ))}

      {hasMoreConversations && (
        <div className="p-3">
          <button
            onClick={loadMoreConversations}
            disabled={loadingMoreConversations}
            className="w-full py-2.5 px-4 rounded-xl text-sm font-medium transition-all duration-200 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 disabled:cursor-not-allowed text-slate-600"
          >
            {loadingMoreConversations
              ? t('sidebar.loadMoreLoading')
              : t('sidebar.loadMore')
            }
          </button>
        </div>
      )}
    </div>
  )
}

interface ConversationItemProps {
  conversation: ChatConversation
  isSelected: boolean
  onClick: () => void
  photoUrl?: string
  showInstanceBadge?: boolean
}

const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isSelected,
  onClick,
  photoUrl,
  showInstanceBadge = false
}) => {
  const { t } = useTranslation('chat')
  const formatTime = (date?: Date) => {
    if (!date) return ''
    
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    
    if (minutes < 1) return t('conversationItem.timeNow')
    if (minutes < 60) return `${minutes}m`
    if (hours < 24) return `${hours}h`
    if (days < 7) return `${days}d`
    
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  }

  const formatPhone = (phone: string) => {
    const cleaned = phone.replace(/\D/g, '')
    if (cleaned.length === 11) {
      return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`
    }
    return phone
  }


  return (
    <button
      onClick={onClick}
      className={`w-full p-4 text-left transition-all duration-200 ${
        isSelected 
          ? 'bg-blue-50 border-r-4 border-[#00a884] shadow-sm' 
          : conversation.unread_count > 0
            ? 'bg-green-50 hover:bg-green-100 border-l-4 border-green-400 shadow-sm' // NOVO: Destaque para não lidas
            : 'hover:bg-white/80 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start space-x-3">
        {/* Avatar */}
        <div className="flex-shrink-0">
          {resolvePhotoUrl(photoUrl) ? (
            <img
              src={resolvePhotoUrl(photoUrl)}
              alt={conversation.contact_name || conversation.contact_phone || t('conversationItem.contactAlt')}
              className="w-12 h-12 rounded-xl object-cover shadow-sm bg-slate-200"
            />
          ) : (
            <div className="w-12 h-12 bg-gradient-to-br from-slate-300 to-slate-400 rounded-xl flex items-center justify-center shadow-sm">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
            </div>
          )}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <div className="flex-1 min-w-0">
              {/* Nome do Lead + Badge de Instância */}
              <div className="flex items-center gap-2 mb-1">
                <h4 className={`text-sm truncate ${
                  conversation.unread_count > 0 ? 'font-bold' : 'font-semibold'
                } ${
                  isSelected ? 'text-slate-800' : 'text-slate-700'
                }`}>
                  {conversation.contact_name || t('conversationItem.leadNoName')}
                </h4>
                {/* Badge da Instância — só exibe em "Todas as instâncias" */}
                {showInstanceBadge && conversation.instance_name && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800 flex-shrink-0 max-w-[90px] truncate">
                    {conversation.instance_name}
                  </span>
                )}
                {/* Badge Desconectada/Deletada */}
                {(conversation as any).instance_status === 'disconnected' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-yellow-100 text-yellow-800 flex-shrink-0">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    {t('conversationItem.badgeDisconnected')}
                  </span>
                )}
                {(conversation as any).instance_deleted && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-red-100 text-red-800 flex-shrink-0">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                    {t('conversationItem.badgeDeleted')}
                  </span>
                )}
              </div>
              
              {/* NOVO: Nome da Empresa (só aparece se existir) */}
              {conversation.company_name && conversation.company_name.trim() !== '' && (
                <p className={`text-xs truncate mt-0.5 ${
                  isSelected ? 'text-slate-500' : 'text-slate-400'
                }`}>
                  {conversation.company_name}
                </p>
              )}
              
              {/* Telefone com fonte menor */}
              <p className={`text-xs truncate mt-0.5 ${
                isSelected ? 'text-slate-500' : 'text-slate-400'
              }`}>
                {conversation.is_lead_over_plan
                  ? <span className="italic text-amber-500">Número restrito</span>
                  : formatPhone(conversation.contact_phone)
                }
              </p>
            </div>
            <div className="flex items-center space-x-2 ml-3">
              {conversation.last_message_at && (
                <span className={`text-xs font-medium ${
                  isSelected ? 'text-slate-600' : 'text-slate-500'
                }`}>
                  {formatTime(conversation.last_message_at)}
                </span>
              )}
              {conversation.unread_count > 0 && (
                <span className="inline-flex items-center justify-center px-2.5 py-1 text-xs font-bold leading-none text-white bg-[#00a884] rounded-full shadow-sm">
                  {conversation.unread_count}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between mt-2">
            <p className={`text-sm truncate ${
              isSelected ? 'text-slate-600' : 'text-slate-500'
            }`}>
                {conversation.is_lead_over_plan ? (
                <span className="italic text-amber-500">Conteúdo restrito</span>
              ) : (
                <>
                  {conversation.last_message_direction === 'outbound' && (
                    <span className="text-[#00a884] mr-1 font-medium">→</span>
                  )}
                  {conversation.last_message_content || (
                    <span className="italic">{t('conversationItem.noMessages')}</span>
                  )}
                </>
              )}
            </p>
            
            {conversation.assigned_to && (
              <div className="flex-shrink-0 ml-2">
                <div className="w-3 h-3 bg-gradient-to-r from-emerald-400 to-green-500 rounded-full shadow-sm" title={t('conversationItem.assignedTitle')}></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

export default ConversationSidebar
