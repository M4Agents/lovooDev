// =====================================================
// CONVERSATION SIDEBAR - COMPONENTE ISOLADO
// =====================================================
// Sidebar com lista de conversas e filtros
// NÃO MODIFICA componentes existentes

import React, { useState } from 'react'
import type { ChatConversation, ConversationFilter } from '../../../types/whatsapp-chat'

// =====================================================
// TIPOS DO COMPONENTE
// =====================================================

interface ConversationSidebarProps {
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
}

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  instances,
  conversations,
  selectedInstance,
  selectedConversation,
  filter,
  loading,
  onSelectInstance,
  onSelectConversation,
  onFilterChange,
  onRefresh
}) => {
  const [searchTerm, setSearchTerm] = useState('')

  // =====================================================
  // FILTROS
  // =====================================================

  const filterOptions = [
    { key: 'all', label: 'Todas', count: conversations.length },
    { 
      key: 'unread', 
      label: 'Não Lidas', 
      count: conversations.filter(c => c.unread_count > 0).length 
    },
    { 
      key: 'assigned', 
      label: 'Atribuídas', 
      count: conversations.filter(c => c.assigned_to).length 
    },
    { 
      key: 'unassigned', 
      label: 'Não Atrib.', 
      count: conversations.filter(c => !c.assigned_to).length 
    }
  ]

  // =====================================================
  // CONVERSAS FILTRADAS
  // =====================================================

  const filteredConversations = conversations.filter(conversation => {
    if (!searchTerm) return true
    
    const searchLower = searchTerm.toLowerCase()
    return (
      conversation.contact_name?.toLowerCase().includes(searchLower) ||
      conversation.contact_phone.includes(searchTerm) ||
      conversation.last_message_content?.toLowerCase().includes(searchLower)
    )
  })

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-6 border-b border-slate-200/60 bg-gradient-to-r from-white to-slate-50">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="h-8 w-8 bg-[#00a884] rounded-lg flex items-center justify-center shadow-sm">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-800">Conversas</h2>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-white/60 disabled:opacity-50 transition-all duration-200 shadow-sm hover:shadow-md"
          >
            <svg className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Seletor de Instância */}
        {instances.length > 1 && (
          <div className="mb-4">
            <select
              value={selectedInstance || ''}
              onChange={(e) => onSelectInstance(e.target.value)}
              className="w-full px-4 py-3 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all duration-200"
            >
              <option value="">Selecione uma instância</option>
              {instances.map(instance => (
                <option key={instance.id} value={instance.id}>
                  {instance.instance_name} ({instance.phone_number || 'Sem número'})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Busca */}
        <div className="relative">
          <input
            type="text"
            placeholder="Buscar conversas..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all duration-200 placeholder-slate-400"
          />
          <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
            <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Filtros Compactos */}
      <div className="px-4 py-3 border-b border-slate-200/40 bg-gradient-to-br from-slate-50/80 via-white to-slate-50/60 backdrop-blur-sm">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {filterOptions.map(option => {
            const getCardStyles = () => {
              if (filter.type !== option.key) {
                return 'bg-white/60 backdrop-blur-sm text-slate-500 hover:bg-white/80 hover:shadow-sm border border-slate-100/50 hover:border-slate-200/50 transition-all duration-200 ease-out'
              }

              switch (option.key) {
                case 'all':
                  return 'bg-[#D9FDD3] text-green-800 shadow-sm shadow-green-200/20 hover:bg-[#E8FEE4] hover:shadow-md hover:shadow-green-200/25 border border-green-200/30 transition-all duration-200 ease-out'
                case 'unread':
                  return 'bg-[#FEF9E7] text-amber-700 shadow-sm shadow-yellow-200/15 hover:bg-[#FFFBF0] hover:shadow-md hover:shadow-yellow-200/20 border border-yellow-200/25 transition-all duration-200 ease-out'
                case 'assigned':
                  return 'bg-[#EBF4FF] text-blue-700 shadow-sm shadow-blue-200/15 hover:bg-[#F0F7FF] hover:shadow-md hover:shadow-blue-200/20 border border-blue-200/25 transition-all duration-200 ease-out'
                case 'unassigned':
                  return 'bg-[#F8FAFC] text-slate-600 shadow-sm shadow-slate-200/10 hover:bg-[#F1F5F9] hover:shadow-md hover:shadow-slate-200/15 border border-slate-200/20 transition-all duration-200 ease-out'
                default:
                  return 'bg-[#D9FDD3] text-green-800 shadow-sm shadow-green-200/20 transition-all duration-200 ease-out'
              }
            }

            return (
            <button
              key={option.key}
              onClick={() => onFilterChange({ ...filter, type: option.key as any })}
              className={`group relative overflow-hidden rounded-lg p-2.5 text-center transform hover:scale-[1.005] ${getCardStyles()}`}
            >
              {/* Efeito de brilho no hover */}
              <div className={`absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent transform -skew-x-12 transition-transform duration-700 ${
                filter.type === option.key ? 'translate-x-full' : 'group-hover:translate-x-full -translate-x-full'
              }`} />
              
              <div className="relative z-10">
                <div className="text-xs font-medium mb-1 leading-tight text-slate-700">
                  {option.label}
                </div>
                <div className="text-lg font-semibold text-slate-700">
                  {option.count}
                </div>
                {option.count > 0 && option.key === 'unread' && (
                  <div className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                )}
              </div>
              
              {/* Indicador ativo */}
              {filter.type === option.key && (
                <div className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full animate-pulse ${
                  option.key === 'all' ? 'bg-green-600' :
                  option.key === 'unread' ? 'bg-amber-600' :
                  option.key === 'assigned' ? 'bg-blue-600' :
                  'bg-slate-500'
                }`} />
              )}
            </button>
            )
          })}
        </div>
      </div>

      {/* Lista de Conversas */}
      <div className="flex-1 overflow-y-auto bg-gradient-to-b from-white to-slate-50/50">
        {loading ? (
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
              {searchTerm ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa ainda'}
            </h4>
            <p className="text-slate-500 text-sm leading-relaxed">
              {searchTerm 
                ? 'Tente ajustar os termos da busca' 
                : 'As conversas aparecerão aqui quando você receber mensagens'
              }
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// =====================================================
// COMPONENTE ITEM DA CONVERSA
// =====================================================

interface ConversationItemProps {
  conversation: ChatConversation
  isSelected: boolean
  onClick: () => void
  photoUrl?: string
}

const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isSelected,
  onClick,
  photoUrl
}) => {
  const formatTime = (date?: Date) => {
    if (!date) return ''
    
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    
    if (minutes < 1) return 'Agora'
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
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={conversation.contact_name || conversation.contact_phone || 'Contato'}
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
              {/* Nome do Lead */}
              <h4 className={`text-sm truncate ${
                conversation.unread_count > 0 ? 'font-bold' : 'font-semibold' // NOVO: Negrito para não lidas
              } ${
                isSelected ? 'text-slate-800' : 'text-slate-700'
              }`}>
                {conversation.contact_name || 'Lead sem nome'}
              </h4>
              
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
                {formatPhone(conversation.contact_phone)}
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
              {conversation.last_message_direction === 'outbound' && (
                <span className="text-[#00a884] mr-1 font-medium">→</span>
              )}
              {conversation.last_message_content || (
                <span className="italic">Sem mensagens</span>
              )}
            </p>
            
            {conversation.assigned_to && (
              <div className="flex-shrink-0 ml-2">
                <div className="w-3 h-3 bg-gradient-to-r from-emerald-400 to-green-500 rounded-full shadow-sm" title="Atribuída"></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

export default ConversationSidebar
