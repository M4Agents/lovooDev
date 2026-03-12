import React, { useState, useEffect } from 'react'
import { Bell, X, Check, Calendar, Clock } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

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

interface ActivityNotificationsProps {
  onActivityClick?: (activityId: string) => void
}

export const ActivityNotifications: React.FC<ActivityNotificationsProps> = ({ onActivityClick }) => {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<ActivityNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(false)

  // Buscar notificações
  const loadNotifications = async () => {
    if (!user?.id) return

    try {
      setLoading(true)
      const response = await fetch(`/api/notifications/activities?user_id=${user.id}&limit=20`)
      const data = await response.json()

      if (data.success) {
        setNotifications(data.notifications || [])
        const unread = data.notifications?.filter((n: ActivityNotification) => n.status === 'sent').length || 0
        setUnreadCount(unread)
      }
    } catch (error) {
      console.error('Erro ao carregar notificações:', error)
    } finally {
      setLoading(false)
    }
  }

  // Marcar como lida
  const markAsRead = async (notificationId: string) => {
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
        setUnreadCount(prev => Math.max(0, prev - 1))
      }
    } catch (error) {
      console.error('Erro ao marcar notificação como lida:', error)
    }
  }

  // Marcar todas como lidas
  const markAllAsRead = async () => {
    if (!user?.id) return

    try {
      const response = await fetch('/api/notifications/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          action: 'mark_all_read'
        })
      })

      if (response.ok) {
        setNotifications(prev =>
          prev.map(n => ({ ...n, status: 'read' as const }))
        )
        setUnreadCount(0)
      }
    } catch (error) {
      console.error('Erro ao marcar todas como lidas:', error)
    }
  }

  // Carregar notificações ao montar
  useEffect(() => {
    loadNotifications()
  }, [user?.id])

  // Polling a cada 30 segundos
  useEffect(() => {
    const interval = setInterval(() => {
      loadNotifications()
    }, 30000)

    return () => clearInterval(interval)
  }, [user?.id])

  // Subscription para notificações em tempo real
  useEffect(() => {
    if (!user?.id) return

    const channel = supabase
      .channel('activity_notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'activity_notifications',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          console.log('🔔 Nova notificação recebida:', payload)
          loadNotifications()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id])

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

  return (
    <div className="relative">
      {/* Botão de Notificações */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative p-2 rounded-lg hover:bg-slate-800 transition-colors"
      >
        <Bell className="w-5 h-5 text-slate-300" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown de Notificações */}
      {showDropdown && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowDropdown(false)}
          />

          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-lg shadow-2xl border border-gray-200 z-50 max-h-[600px] flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-indigo-50 to-blue-50">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-indigo-600" />
                <h3 className="font-semibold text-gray-900">Notificações</h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">
                    {unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    Marcar todas como lidas
                  </button>
                )}
                <button
                  onClick={() => setShowDropdown(false)}
                  className="p-1 hover:bg-gray-200 rounded transition-colors"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            </div>

            {/* Lista de Notificações */}
            <div className="overflow-y-auto flex-1">
              {loading ? (
                <div className="p-8 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                  <p className="text-sm text-gray-500 mt-2">Carregando...</p>
                </div>
              ) : notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Check className="w-12 h-12 text-green-500 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Nenhuma notificação</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-4 hover:bg-gray-50 transition-colors cursor-pointer ${
                        notification.status === 'sent' ? 'bg-blue-50/50' : ''
                      }`}
                      onClick={() => {
                        if (notification.status === 'sent') {
                          markAsRead(notification.id)
                        }
                        if (onActivityClick && notification.activity_id) {
                          onActivityClick(notification.activity_id)
                          setShowDropdown(false)
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
                          <p className="text-sm text-gray-600 mt-0.5">
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
                          <div className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full"></div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
