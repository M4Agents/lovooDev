import React, { useState, useEffect } from 'react'
import { X, Bell, Check, Calendar, Clock, User, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface CompanyUser {
  user_id: string
  email: string
  display_name?: string
  role: string
}

interface ActivityNotification {
  id: string
  activity_id: string
  title: string
  message: string
  status: 'pending' | 'sent' | 'read'
  sent_at: string
  created_at: string
  activity?: {
    id: string
    title: string
    scheduled_date: string
    scheduled_time: string
    activity_type: string
    lead?: {
      id: number
      name: string
    }
  }
}

interface NotificationsModalProps {
  isOpen: boolean
  onClose: () => void
  isMaster: boolean
  currentUserId: string
  companyId: string
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  isOpen,
  onClose,
  isMaster,
  currentUserId,
  companyId
}) => {
  const [selectedUserId, setSelectedUserId] = useState(currentUserId)
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([])
  const [notifications, setNotifications] = useState<ActivityNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [showUserDropdown, setShowUserDropdown] = useState(false)

  // Buscar usuários da empresa (apenas Master)
  const loadCompanyUsers = async () => {
    if (!isMaster || !companyId) return

    try {
      const { data, error } = await supabase
        .from('company_users')
        .select(`
          user_id,
          email,
          display_name,
          role
        `)
        .eq('company_id', companyId)
        .eq('is_active', true)
        .neq('user_id', currentUserId)
        .order('display_name')

      if (error) throw error

      setCompanyUsers(data || [])
    } catch (error) {
      console.error('Erro ao carregar usuários:', error)
    }
  }

  // Buscar notificações do usuário selecionado
  const loadNotifications = async (userId: string) => {
    if (!userId) return

    try {
      setLoading(true)
      const response = await fetch(`/api/notifications/activities?user_id=${userId}&limit=100`)
      const data = await response.json()

      if (data.success) {
        setNotifications(data.notifications || [])
      }
    } catch (error) {
      console.error('Erro ao carregar notificações:', error)
    } finally {
      setLoading(false)
    }
  }

  // Marcar notificação como lida (apenas próprias notificações)
  const markAsRead = async (notificationId: string) => {
    if (selectedUserId !== currentUserId) return // Não pode marcar notificações de outros

    try {
      const response = await fetch('/api/notifications/activities', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notification_id: notificationId,
          action: 'mark_read'
        })
      })

      if (response.ok) {
        setNotifications(prev =>
          prev.map(n => n.id === notificationId ? { ...n, status: 'read' as const } : n)
        )
      }
    } catch (error) {
      console.error('Erro ao marcar notificação como lida:', error)
    }
  }

  // Marcar todas como lidas (apenas próprias notificações)
  const markAllAsRead = async () => {
    if (selectedUserId !== currentUserId) return

    try {
      const response = await fetch('/api/notifications/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUserId,
          action: 'mark_all_read'
        })
      })

      if (response.ok) {
        setNotifications(prev =>
          prev.map(n => ({ ...n, status: 'read' as const }))
        )
      }
    } catch (error) {
      console.error('Erro ao marcar todas como lidas:', error)
    }
  }

  // Carregar usuários ao montar (se Master)
  useEffect(() => {
    if (isMaster) {
      loadCompanyUsers()
    }
  }, [isMaster, companyId])

  // Carregar notificações quando usuário selecionado mudar
  useEffect(() => {
    loadNotifications(selectedUserId)
  }, [selectedUserId])

  // Subscription para notificações em tempo real (apenas próprias)
  useEffect(() => {
    if (selectedUserId !== currentUserId) return

    const channel = supabase
      .channel('activity_notifications_modal')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'activity_notifications',
          filter: `user_id=eq.${currentUserId}`
        },
        () => {
          loadNotifications(currentUserId)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedUserId, currentUserId])

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Agora'
    if (diffMins < 60) return `${diffMins}m atrás`
    
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h atrás`
    
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d atrás`
    
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  }

  const getActivityTypeEmoji = (type: string) => {
    const emojis: Record<string, string> = {
      call: '📞',
      meeting: '🤝',
      email: '📧',
      task: '✅',
      follow_up: '🔄',
      demo: '🎯',
      other: '📋'
    }
    return emojis[type] || '📅'
  }

  const getSelectedUserName = () => {
    if (selectedUserId === currentUserId) {
      return 'Minhas Notificações'
    }
    const user = companyUsers.find(u => u.user_id === selectedUserId)
    return user?.display_name || user?.email || 'Usuário'
  }

  const unreadCount = notifications.filter(n => n.status === 'sent').length
  const isViewingOwnNotifications = selectedUserId === currentUserId

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-blue-50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Bell className="w-6 h-6 text-indigo-600" />
              <h2 className="text-xl font-semibold text-gray-900">Notificações</h2>
              {unreadCount > 0 && (
                <span className="px-2.5 py-1 bg-red-500 text-white text-xs font-bold rounded-full">
                  {unreadCount}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Seletor de Usuário (apenas Master) */}
          {isMaster && (
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Visualizar notificações de:
              </label>
              <button
                onClick={() => setShowUserDropdown(!showUserDropdown)}
                className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-300 rounded-lg hover:border-indigo-400 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-900">
                    {getSelectedUserName()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {selectedUserId === currentUserId && unreadCount > 0 && (
                    <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                      {unreadCount}
                    </span>
                  )}
                  <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showUserDropdown ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {/* Dropdown de Usuários */}
              {showUserDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowUserDropdown(false)}
                  />
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-xl z-20 max-h-64 overflow-y-auto">
                    <button
                      onClick={() => {
                        setSelectedUserId(currentUserId)
                        setShowUserDropdown(false)
                      }}
                      className={`w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors ${
                        selectedUserId === currentUserId ? 'bg-indigo-50' : ''
                      }`}
                    >
                      <span className="text-sm font-medium text-gray-900">
                        Minhas Notificações
                      </span>
                      {unreadCount > 0 && (
                        <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                          {unreadCount}
                        </span>
                      )}
                    </button>
                    {companyUsers.length > 0 && (
                      <div className="border-t border-gray-200">
                        {companyUsers.map(user => (
                          <button
                            key={user.user_id}
                            onClick={() => {
                              setSelectedUserId(user.user_id)
                              setShowUserDropdown(false)
                            }}
                            className={`w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors ${
                              selectedUserId === user.user_id ? 'bg-indigo-50' : ''
                            }`}
                          >
                            <div className="flex flex-col items-start">
                              <span className="text-sm font-medium text-gray-900">
                                {user.display_name || user.email}
                              </span>
                              <span className="text-xs text-gray-500 capitalize">
                                {user.role}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Ações */}
          {isViewingOwnNotifications && unreadCount > 0 && (
            <div className="mt-4">
              <button
                onClick={markAllAsRead}
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Marcar todas como lidas
              </button>
            </div>
          )}
        </div>

        {/* Lista de Notificações */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
              <p className="text-sm text-gray-500">Carregando notificações...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Check className="w-16 h-16 text-green-500 mb-4" />
              <p className="text-lg font-medium text-gray-900 mb-2">
                Nenhuma notificação
              </p>
              <p className="text-sm text-gray-500">
                {isViewingOwnNotifications 
                  ? 'Você não tem notificações no momento'
                  : 'Este usuário não tem notificações'
                }
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-4 rounded-lg border transition-all cursor-pointer ${
                    notification.status === 'sent'
                      ? 'bg-blue-50/50 border-blue-200 hover:bg-blue-50'
                      : 'bg-white border-gray-200 hover:bg-gray-50'
                  }`}
                  onClick={() => {
                    if (isViewingOwnNotifications && notification.status === 'sent') {
                      markAsRead(notification.id)
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                      notification.status === 'sent' ? 'bg-indigo-100' : 'bg-gray-100'
                    }`}>
                      <span className="text-xl">
                        {notification.activity?.activity_type 
                          ? getActivityTypeEmoji(notification.activity.activity_type)
                          : '🔔'
                        }
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium text-gray-900 ${
                        notification.status === 'sent' ? 'font-semibold' : ''
                      }`}>
                        {notification.title}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        {notification.message}
                      </p>
                      {notification.activity && (
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(notification.activity.scheduled_date).toLocaleDateString('pt-BR')}
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {notification.activity.scheduled_time}
                          </div>
                        </div>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {formatDate(notification.sent_at || notification.created_at)}
                      </p>
                    </div>
                    {notification.status === 'sent' && (
                      <div className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {!isViewingOwnNotifications && (
          <div className="p-4 border-t border-gray-200 bg-gray-50">
            <p className="text-xs text-gray-500 text-center">
              ℹ️ Você está visualizando notificações de outro usuário. Não é possível marcar como lida.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
