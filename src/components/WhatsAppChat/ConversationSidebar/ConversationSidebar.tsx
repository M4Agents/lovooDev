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
    { key: 'all', label: 'Todas as Conversas', count: conversations.length },
    { 
      key: 'assigned', 
      label: 'Atribuídas', 
      count: conversations.filter(c => c.assigned_to).length 
    },
    { 
      key: 'unassigned', 
      label: 'Não Atribuídas', 
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
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Chat</h2>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 disabled:opacity-50"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* Filtros */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex space-x-1">
          {filterOptions.map(option => (
            <button
              key={option.key}
              onClick={() => onFilterChange({ ...filter, type: option.key as any })}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                filter.type === option.key
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <div className="text-center">
                <div>{option.label}</div>
                <div className="text-xs opacity-75">({option.count})</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Lista de Conversas */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="text-center py-8 px-4">
            <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
            </svg>
            <p className="text-gray-600 text-sm">
              {searchTerm ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa ainda'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredConversations.map(conversation => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                isSelected={conversation.id === selectedConversation}
                onClick={() => onSelectConversation(conversation.id)}
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
}

const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isSelected,
  onClick
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
      className={`w-full p-4 text-left hover:bg-gray-50 transition-colors ${
        isSelected ? 'bg-blue-50 border-r-2 border-blue-500' : ''
      }`}
    >
      <div className="flex items-start space-x-3">
        {/* Avatar */}
        <div className="flex-shrink-0">
          <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
          </div>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-sm font-medium text-gray-900 truncate">
              {conversation.contact_name || formatPhone(conversation.contact_phone)}
            </h4>
            <div className="flex items-center space-x-2">
              {conversation.last_message_at && (
                <span className="text-xs text-gray-500">
                  {formatTime(conversation.last_message_at)}
                </span>
              )}
              {conversation.unread_count > 0 && (
                <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-blue-600 rounded-full">
                  {conversation.unread_count}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600 truncate">
              {conversation.last_message_direction === 'outbound' && (
                <span className="text-blue-600 mr-1">→</span>
              )}
              {conversation.last_message_content || 'Sem mensagens'}
            </p>
            
            {conversation.assigned_to && (
              <div className="flex-shrink-0 ml-2">
                <div className="w-4 h-4 bg-green-500 rounded-full" title="Atribuída"></div>
              </div>
            )}
          </div>

          {!conversation.contact_name && (
            <p className="text-xs text-gray-500 mt-1">
              {formatPhone(conversation.contact_phone)}
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

export default ConversationSidebar
