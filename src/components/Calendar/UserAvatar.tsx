import React from 'react'
import type { CalendarUser } from '../../types/calendar'

interface UserAvatarProps {
  user: CalendarUser
  isActive: boolean
  onClick: () => void
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  user,
  isActive,
  onClick
}) => {
  // Gerar iniciais do nome
  const getInitials = (name: string) => {
    const parts = name.split(' ')
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    }
    return name.slice(0, 2).toUpperCase()
  }

  // Gerar cor baseada no nome (hash simples)
  const getColorFromName = (name: string) => {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    const colors = [
      '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
      '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16'
    ]
    return colors[Math.abs(hash) % colors.length]
  }

  const displayName = user.display_name || user.email.split('@')[0]
  const initials = getInitials(displayName)
  const backgroundColor = user.color || getColorFromName(displayName)

  // Badge de permissão
  const getPermissionLabel = () => {
    if (user.is_own) return 'Seu calendário'
    
    const labels = {
      view: 'Visualizar',
      edit: 'Editar',
      manage: 'Gerenciar'
    }
    
    return user.permission ? labels[user.permission] : 'Visualizar'
  }

  const tooltipText = user.is_own 
    ? 'Você' 
    : `${displayName} - ${getPermissionLabel()}`

  return (
    <button
      onClick={onClick}
      title={tooltipText}
      className={`relative transition-all duration-200 hover:z-[999] ${
        isActive ? 'z-50' : 'z-auto'
      }`}
    >
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full overflow-hidden transition-all duration-200"
        style={{
          boxShadow: isActive
            ? `0 0 0 3px ${backgroundColor}, 0 2px 8px ${backgroundColor}40`
            : '0 0 0 2px white, 0 1px 3px rgba(0,0,0,0.1)',
          transform: isActive ? 'scale(1.1)' : 'scale(1)'
        }}
      >
        {user.profile_picture_url ? (
          <img
            src={user.profile_picture_url}
            alt={displayName}
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-white font-bold text-xs"
            style={{ backgroundColor }}
          >
            {initials}
          </div>
        )}
      </div>

      {/* Badge de permissão (pequeno) */}
      {!user.is_own && (
        <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-white rounded-full flex items-center justify-center shadow-sm text-[8px]">
          {user.permission === 'view' && '👁️'}
          {user.permission === 'edit' && '✏️'}
          {user.permission === 'manage' && '⚙️'}
        </div>
      )}
    </button>
  )
}
