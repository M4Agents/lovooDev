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
  const getPermissionBadge = () => {
    if (user.is_own) return null
    
    const badges = {
      view: '👁️',
      edit: '✏️',
      manage: '⚙️'
    }
    
    return user.permission ? badges[user.permission] : null
  }

  return (
    <div className="flex flex-col items-center gap-1.5 group">
      <button
        onClick={onClick}
        className={`relative transition-all duration-200 ${
          isActive
            ? 'scale-100'
            : 'scale-90 opacity-80 hover:scale-95 hover:opacity-100'
        }`}
      >
        {/* Avatar */}
        <div
          className={`relative ${
            isActive ? 'w-12 h-12' : 'w-10 h-10'
          } rounded-full overflow-hidden transition-all duration-200`}
          style={{
            boxShadow: isActive
              ? `0 0 0 3px white, 0 0 0 5px ${backgroundColor}, 0 4px 12px ${backgroundColor}40`
              : '0 0 0 2px white, 0 0 0 3px #E5E7EB'
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
              className="w-full h-full flex items-center justify-center text-white font-bold"
              style={{ backgroundColor }}
            >
              <span className={isActive ? 'text-sm' : 'text-xs'}>
                {initials}
              </span>
            </div>
          )}
        </div>

        {/* Badge de permissão */}
        {getPermissionBadge() && (
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-md text-xs">
            {getPermissionBadge()}
          </div>
        )}

        {/* Indicador de ativo */}
        {isActive && (
          <div
            className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-2 h-2 rounded-full"
            style={{ backgroundColor }}
          />
        )}
      </button>

      {/* Nome */}
      <span
        className={`text-xs transition-all duration-200 ${
          isActive
            ? 'font-bold text-gray-900'
            : 'font-medium text-gray-600 group-hover:text-gray-900'
        }`}
      >
        {user.is_own ? 'Você' : displayName.split(' ')[0]}
      </span>
    </div>
  )
}
