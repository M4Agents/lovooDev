import React, { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Bell, Check, Calendar, Clock, User, ChevronDown, Filter, Search } from 'lucide-react'
import { ActivityModal } from '../components/Calendar/ActivityModal'
import type { LeadActivity } from '../types/calendar'

interface CompanyUser {
  user_id: string
  email: string
  display_name?: string
  role: string
}

interface ActivityNotification {
  id: string
  activity_id?: string  // Tornar opcional
  title: string
  message: string
  status: 'pending' | 'sent' | 'read'
  sent_at: string
  created_at: string
  source?: 'activity' | 'system'  // Adicionar
  notification_type?: 'info' | 'success' | 'warning' | 'error'  // Adicionar
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

export const Notifications: React.FC = () => {
  const { user, company, currentRole } = useAuth()
  const [selectedUserId, setSelectedUserId] = useState(user?.id || '')
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([])
  const [notifications, setNotifications] = useState<ActivityNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [filterStatus, setFilterStatus] = useState<'all' | 'sent' | 'read'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedActivity, setSelectedActivity] = useState<LeadActivity | null>(null)
  const [showActivityModal, setShowActivityModal] = useState(false)

  const isMaster = currentRole === 'super_admin' || 
                   currentRole === 'support' || 
                   currentRole === 'admin'

  // Buscar usuários da empresa (apenas Master)
  const loadCompanyUsers = async () => {
    if (!isMaster || !company?.id) return

    try {
      const { data, error } = await supabase
        .from('company_users')
        .select(`
          user_id,
          email,
          display_name,
          role
        `)
        .eq('company_id', company.id)
        .eq('is_active', true)
        .neq('user_id', user?.id)
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
    
    // Buscar notificações de atividades
    const activityResponse = await fetch(`/api/notifications/activities?user_id=${userId}&limit=200`)
    const activityData = await activityResponse.json()
    
    // Buscar notificações do sistema
    const systemResponse = await fetch(`/api/notifications/system?user_id=${userId}&limit=200`)
    const systemData = await systemResponse.json()
    
    // Mesclar e ordenar por data
    const allNotifications = [
      ...(activityData.notifications || []).map(n => ({ ...n, source: 'activity' })),
      ...(systemData.notifications || []).map(n => ({ ...n, source: 'system' }))
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    
    setNotifications(allNotifications)
  } catch (error) {
    console.error('Erro ao carregar notificações:', error)
  } finally {
    setLoading(false)
  }
}
  // Marcar notificação como lida (apenas próprias notificações)
  const markAsRead = async (notificationId: string, source: string = 'activity') => {
  if (selectedUserId !== user?.id) return

  try {
    const endpoint = source === 'system' ? '/api/notifications/system' : '/api/notifications/activities'
    
    const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notification_id: notificationId,
          action: 'mark_read'
        })
      })

      if (response.ok) {
  // Marcar todas como lidas (apenas próprias notificações)
const markAllAsRead = async () => {
  if (selectedUserId !== user?.id) return

  try {
    // Marcar notificações de atividades
    await fetch('/api/notifications/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user?.id,
        action: 'mark_all_read'
      })
    })
    
    // Marcar notificações do sistema
    await fetch('/api/notifications/system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user?.id,
        action: 'mark_all_read'
      })
    })

    setNotifications(prev =>
      prev.map(n => ({ ...n, status: 'read' as const }))
    )
  } catch (error) {
    console.error('Erro ao marcar todas como lidas:', error)
  }
}
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
  }, [isMaster, company?.id])

  // Carregar notificações quando usuário selecionado mudar
  useEffect(() => {
    if (selectedUserId) {
      loadNotifications(selectedUserId)
    }
  }, [selectedUserId])

  // Subscription para notificações em tempo real (apenas próprias)
  useEffect(() => {
    if (selectedUserId !== user?.id) return

    const channel = supabase
      .channel('activity_notifications_page')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'activity_notifications',
          filter: `user_id=eq.${user?.id}`
        },
        () => {
          loadNotifications(user?.id || '')
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedUserId, user?.id])

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
    if (selectedUserId === user?.id) {
      return 'Minhas Notificações'
    }
    const selectedUser = companyUsers.find(u => u.user_id === selectedUserId)
    return selectedUser?.display_name || selectedUser?.email || 'Usuário'
  }

  // Filtrar notificações
  const filteredNotifications = notifications.filter(n => {
    // Filtro por status
    if (filterStatus !== 'all' && n.status !== filterStatus) return false
    
    // Filtro por busca
    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      return (
        n.title.toLowerCase().includes(search) ||
        n.message.toLowerCase().includes(search) ||
        n.activity?.lead?.name.toLowerCase().includes(search)
      )
    }
    
    return true
  })

  // Agrupar notificações por data
  const groupedNotifications = filteredNotifications.reduce((groups, notification) => {
    const date = new Date(notification.sent_at || notification.created_at)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    
    let groupKey = ''
    if (date.toDateString() === today.toDateString()) {
      groupKey = 'Hoje'
    } else if (date.toDateString() === yesterday.toDateString()) {
      groupKey = 'Ontem'
    } else if (date > new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)) {
      groupKey = 'Esta semana'
    } else {
      groupKey = 'Mais antigas'
    }
    
    if (!groups[groupKey]) {
      groups[groupKey] = []
    }
    groups[groupKey].push(notification)
    return groups
  }, {} as Record<string, ActivityNotification[]>)

  const unreadCount = notifications.filter(n => n.status === 'sent').length
  const isViewingOwnNotifications = selectedUserId === user?.id

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Bell className="w-8 h-8 text-indigo-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Notificações</h1>
                <p className="text-sm text-gray-500 mt-1">
                  {unreadCount > 0 ? `${unreadCount} não lida${unreadCount !== 1 ? 's' : ''}` : 'Todas as notificações lidas'}
                </p>
              </div>
            </div>
          </div>

          {/* Seletor de Usuário (apenas Master) */}
          {isMaster && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Visualizar notificações de:
              </label>
              <div className="relative max-w-md">
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
                  <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showUserDropdown ? 'rotate-180' : ''}`} />
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
                          setSelectedUserId(user?.id || '')
                          setShowUserDropdown(false)
                        }}
                        className={`w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors ${
                          selectedUserId === user?.id ? 'bg-indigo-50' : ''
                        }`}
                      >
                        <span className="text-sm font-medium text-gray-900">
                          Minhas Notificações
                        </span>
                        {selectedUserId === user?.id && unreadCount > 0 && (
                          <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                            {unreadCount}
                          </span>
                        )}
                      </button>
                      {companyUsers.length > 0 && (
                        <div className="border-t border-gray-200">
                          {companyUsers.map(companyUser => (
                            <button
                              key={companyUser.user_id}
                              onClick={() => {
                                setSelectedUserId(companyUser.user_id)
                                setShowUserDropdown(false)
                              }}
                              className={`w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors ${
                                selectedUserId === companyUser.user_id ? 'bg-indigo-50' : ''
                              }`}
                            >
                              <div className="flex flex-col items-start">
                                <span className="text-sm font-medium text-gray-900">
                                  {companyUser.display_name || companyUser.email}
                                </span>
                                <span className="text-xs text-gray-500 capitalize">
                                  {companyUser.role}
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
            </div>
          )}

          {/* Filtros e Ações */}
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Busca */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar notificações..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Filtro de Status */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                <option value="all">Todas</option>
                <option value="sent">Não lidas</option>
                <option value="read">Lidas</option>
              </select>
            </div>

            {/* Marcar todas como lidas */}
            {isViewingOwnNotifications && unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
              >
                Marcar todas como lidas
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Lista de Notificações */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
            <p className="text-sm text-gray-500">Carregando notificações...</p>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <Check className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchTerm || filterStatus !== 'all' 
                ? 'Nenhuma notificação encontrada'
                : 'Nenhuma notificação'
              }
            </h3>
            <p className="text-sm text-gray-500">
              {searchTerm || filterStatus !== 'all'
                ? 'Tente ajustar os filtros de busca'
                : isViewingOwnNotifications 
                  ? 'Você não tem notificações no momento'
                  : 'Este usuário não tem notificações'
              }
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedNotifications).map(([group, groupNotifications]) => (
              <div key={group}>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  {group} ({groupNotifications.length})
                </h2>
                <div className="space-y-3">
                  {groupNotifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`bg-white rounded-lg border p-4 transition-all cursor-pointer ${
                        notification.status === 'sent'
                          ? 'border-blue-200 hover:border-blue-300 shadow-sm'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={async () => {
  // Marcar como lida se for própria notificação
  if (isViewingOwnNotifications && notification.status === 'sent') {
    markAsRead(notification.id, notification.source || 'activity')
  }
  
  // Abrir modal da atividade (apenas para notificações de atividade)
  if (notification.source === 'activity' && notification.activity_id) {
                          try {
                            const { data, error } = await supabase
                              .from('lead_activities')
                              .select(`
                                *,
                                lead:leads(id, name, phone, email, company_name)
                              `)
                              .eq('id', notification.activity_id)
                              .single()
                            
                            if (error) throw error
                            if (data) {
                              setSelectedActivity(data as LeadActivity)
                              setShowActivityModal(true)
                            }
                          } catch (error) {
                            console.error('Erro ao carregar atividade:', error)
                          }
                        }
                      }}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
                          notification.status === 'sent' ? 'bg-indigo-100' : 'bg-gray-100'
                        }`}>
                         <span className="text-2xl">
  {notification.source === 'system' 
    ? (notification.notification_type === 'success' ? '✅' :
       notification.notification_type === 'warning' ? '⚠️' :
       notification.notification_type === 'error' ? '❌' : 'ℹ️')
    : (notification.activity?.activity_type 
        ? getActivityTypeEmoji(notification.activity.activity_type)
        : '🔔'
      )
  }
</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <p className={`text-sm font-medium text-gray-900 ${
                                notification.status === 'sent' ? 'font-semibold' : ''
                              }`}>
                                {notification.title}
                              </p>
                              <p className="text-sm text-gray-600 mt-1">
                                {notification.message}
                              </p>
                              {notification.activity && (
                                <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                                  <div className="flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {new Date(notification.activity.scheduled_date).toLocaleDateString('pt-BR')}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {notification.activity.scheduled_time}
                                  </div>
                                  {notification.activity.lead && (
                                    <div className="flex items-center gap-1">
                                      <User className="w-3 h-3" />
                                      {notification.activity.lead.name}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <p className="text-xs text-gray-400 whitespace-nowrap">
                                {formatDate(notification.sent_at || notification.created_at)}
                              </p>
                              {notification.status === 'sent' && (
                                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer Info */}
        {!isViewingOwnNotifications && filteredNotifications.length > 0 && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800 text-center">
              ℹ️ Você está visualizando notificações de outro usuário. Não é possível marcar como lida.
            </p>
          </div>
        )}
      </div>

      {/* Modal de Atividade */}
      {showActivityModal && selectedActivity && (
        <ActivityModal
          activity={selectedActivity}
          onClose={() => {
            setShowActivityModal(false)
            setSelectedActivity(null)
          }}
          onSave={() => {
            setShowActivityModal(false)
            setSelectedActivity(null)
            loadNotifications(selectedUserId)
          }}
          onDelete={() => {
            setShowActivityModal(false)
            setSelectedActivity(null)
            loadNotifications(selectedUserId)
          }}
        />
      )}
    </div>
  )
}
