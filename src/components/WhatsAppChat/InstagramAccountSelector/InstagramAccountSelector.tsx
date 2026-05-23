// =====================================================
// InstagramAccountSelector
// =====================================================
// Dropdown para selecionar conta Instagram conectada.
// Segue o mesmo visual do InstanceSelector (WhatsApp).
// Contas não-ativas são exibidas como desabilitadas com badge de status.
// =====================================================

import React, { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Check } from 'lucide-react'
import type { InstagramConnection } from '../../../types/instagram-chat'

interface InstagramAccountSelectorProps {
  connections: InstagramConnection[]
  selectedConnectionId: string
  onSelectConnection: (id: string) => void
  conversationCount?: number
  className?: string
}

const InstagramGradientIcon: React.FC = () => (
  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
    style={{ background: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)' }}
  >
    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  </div>
)

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  revoked:         { label: 'Revogada',     color: 'bg-red-100 text-red-700' },
  error:           { label: 'Erro',         color: 'bg-red-100 text-red-700' },
  expired:         { label: 'Expirada',     color: 'bg-amber-100 text-amber-700' },
  reauth_required: { label: 'Reautenticar', color: 'bg-amber-100 text-amber-700' },
}

export const InstagramAccountSelector: React.FC<InstagramAccountSelectorProps> = ({
  connections,
  selectedConnectionId,
  onSelectConnection,
  conversationCount = 0,
  className = '',
}) => {
  const { t } = useTranslation('chat')
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const activeConnections   = connections.filter(c => c.status === 'active')
  const inactiveConnections = connections.filter(c => c.status !== 'active')

  const selectedConnection = selectedConnectionId === 'all'
    ? null
    : connections.find(c => c.id === selectedConnectionId)

  const handleSelect = (conn: InstagramConnection) => {
    // Bloquear seleção de contas não-ativas
    if (conn.status !== 'active') return
    onSelectConnection(conn.id)
    setIsOpen(false)
  }

  const renderAvatar = (conn: InstagramConnection) =>
    conn.profile_picture_url
      ? <img src={conn.profile_picture_url} alt={conn.instagram_username} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
      : <InstagramGradientIcon />

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-lg hover:bg-white hover:border-pink-300 focus:ring-2 focus:ring-pink-400 focus:border-pink-400 shadow-sm transition-all duration-200 flex items-center justify-between"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {selectedConnectionId === 'all' ? (
            <>
              <InstagramGradientIcon />
              <div className="flex-1 min-w-0 text-left">
                <p className="font-medium text-gray-900 truncate">{t('instagram.allAccounts')}</p>
                <p className="text-xs text-gray-500">
                  {conversationCount} {conversationCount === 1 ? 'conversa' : 'conversas'}
                </p>
              </div>
            </>
          ) : selectedConnection ? (
            <>
              {renderAvatar(selectedConnection)}
              <div className="flex-1 min-w-0 text-left">
                <p className="font-medium text-gray-900 truncate">@{selectedConnection.instagram_username}</p>
                {selectedConnection.status !== 'active' && (
                  <p className="text-xs text-amber-600">
                    {STATUS_BADGE[selectedConnection.status]?.label ?? 'Inativa'}
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-gray-500">{t('instagram.accountSelectorLabel')}</p>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-slate-200 z-50 max-h-80 overflow-y-auto">
          {/* Todas as contas */}
          <button
            onClick={() => { onSelectConnection('all'); setIsOpen(false) }}
            className={`w-full px-3 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors ${selectedConnectionId === 'all' ? 'bg-pink-50' : ''}`}
          >
            <InstagramGradientIcon />
            <div className="flex-1 min-w-0 text-left">
              <p className="font-medium text-gray-900">{t('instagram.allAccounts')}</p>
              <p className="text-xs text-gray-500">
                {conversationCount} {conversationCount === 1 ? 'conversa' : 'conversas'}
              </p>
            </div>
            {selectedConnectionId === 'all' && <Check className="w-5 h-5 text-pink-600 flex-shrink-0" />}
          </button>

          {/* Contas ativas */}
          {activeConnections.length > 0 && <div className="border-t border-gray-100" />}
          {activeConnections.map(conn => (
            <button
              key={conn.id}
              onClick={() => handleSelect(conn)}
              className={`w-full px-3 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors ${selectedConnectionId === conn.id ? 'bg-pink-50' : ''}`}
            >
              {renderAvatar(conn)}
              <div className="flex-1 min-w-0 text-left">
                <p className="font-medium text-gray-900 truncate">@{conn.instagram_username}</p>
              </div>
              {selectedConnectionId === conn.id && <Check className="w-5 h-5 text-pink-600 flex-shrink-0" />}
            </button>
          ))}

          {/* Contas inativas — visíveis mas não selecionáveis */}
          {inactiveConnections.length > 0 && (
            <>
              <div className="border-t border-gray-100 mx-3 my-1" />
              <p className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                Reconexão necessária
              </p>
              {inactiveConnections.map(conn => {
                const badge = STATUS_BADGE[conn.status]
                return (
                  <div
                    key={conn.id}
                    className="w-full px-3 py-2 flex items-center gap-2 opacity-50 cursor-not-allowed"
                    title="Reconecte esta conta em Configurações → Integrações → Instagram"
                  >
                    <div className="relative">
                      {renderAvatar(conn)}
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-amber-500 rounded-full border border-white flex items-center justify-center">
                        <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-medium text-gray-900 truncate">@{conn.instagram_username}</p>
                    </div>
                    {badge && (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badge.color} flex-shrink-0`}>
                        {badge.label}
                      </span>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {connections.length === 0 && (
            <div className="px-4 py-6 text-center text-gray-500 text-sm">{t('instagram.noAccounts')}</div>
          )}
        </div>
      )}
    </div>
  )
}

export default InstagramAccountSelector
