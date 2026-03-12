import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'

interface ActivityNotificationButtonProps {
  isMaster: boolean
  currentUserId: string
  companyId: string
  collapsed?: boolean
}

export const ActivityNotificationButton: React.FC<ActivityNotificationButtonProps> = ({
  isMaster,
  currentUserId,
  companyId,
  collapsed = false
}) => {
  const navigate = useNavigate()
  const [unreadCount, setUnreadCount] = useState(0)

  // Buscar contador de notificações não lidas
  const loadUnreadCount = async () => {
    if (!currentUserId) return

    try {
      const response = await fetch(`/api/notifications/activities?user_id=${currentUserId}&status=sent&limit=100`)
      const data = await response.json()

      if (data.success) {
        const unread = data.notifications?.filter((n: any) => n.status === 'sent').length || 0
        setUnreadCount(unread)
      }
    } catch (error) {
      console.error('Erro ao carregar contador de notificações:', error)
    }
  }

  // Carregar contador ao montar
  useEffect(() => {
    loadUnreadCount()
  }, [currentUserId])

  // Polling a cada 30 segundos
  useEffect(() => {
    const interval = setInterval(() => {
      loadUnreadCount()
    }, 30000)

    return () => clearInterval(interval)
  }, [currentUserId])

  return (
    <button
      onClick={() => navigate('/notificacoes')}
      className={`
        w-full flex items-center justify-between px-3 py-2 rounded-lg 
        hover:bg-slate-700/50 transition-colors
        ${collapsed ? 'justify-center' : ''}
      `}
      title={collapsed ? 'Notificações' : undefined}
    >
      <div className="flex items-center gap-2">
        <Bell className="w-4 h-4 text-slate-300" />
        {!collapsed && (
          <span className="text-sm text-slate-300">Notificações</span>
        )}
      </div>
      {unreadCount > 0 && (
        <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full font-medium">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  )
}
