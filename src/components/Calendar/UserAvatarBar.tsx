import React from 'react'
import { Users } from 'lucide-react'
import type { CalendarUser } from '../../types/calendar'
import { UserAvatar } from './UserAvatar'

interface UserAvatarBarProps {
  currentUser: CalendarUser
  availableCalendars: CalendarUser[]
  selectedUserId: string
  onSelectUser: (userId: string) => void
}

export const UserAvatarBar: React.FC<UserAvatarBarProps> = ({
  currentUser,
  availableCalendars,
  selectedUserId,
  onSelectUser
}) => {
  // Ordenar: próprio usuário primeiro, depois outros
  const sortedCalendars = [
    currentUser,
    ...availableCalendars.filter(cal => !cal.is_own)
  ]

  // Mostrar até 6 avatares
  const visibleCalendars = sortedCalendars.slice(0, 6)
  const remainingCount = sortedCalendars.length - 6

  return (
    <div className="flex items-center gap-4 px-6 py-4 bg-white/80 backdrop-blur-sm border-b border-gray-200/50">
      {/* Label */}
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-gray-500" />
        <span className="text-sm font-semibold text-gray-700">
          Calendários:
        </span>
      </div>

      {/* Avatares */}
      <div className="flex items-center gap-4">
        {visibleCalendars.map(calendar => (
          <UserAvatar
            key={calendar.id}
            user={calendar}
            isActive={calendar.id === selectedUserId}
            onClick={() => onSelectUser(calendar.id)}
          />
        ))}

        {/* Botão +N se houver mais usuários */}
        {remainingCount > 0 && (
          <button
            className="flex flex-col items-center gap-1.5 group"
            title={`Mais ${remainingCount} ${remainingCount === 1 ? 'usuário' : 'usuários'}`}
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-600 font-bold text-xs border-2 border-gray-300 hover:border-blue-400 hover:from-blue-50 hover:to-blue-100 hover:text-blue-600 transition-all duration-200 group-hover:scale-95">
              +{remainingCount}
            </div>
            <span className="text-xs font-medium text-gray-600 group-hover:text-gray-900 transition-colors">
              Mais
            </span>
          </button>
        )}
      </div>

      {/* Indicador de visualização */}
      {selectedUserId !== currentUser.id && (
        <div className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium border border-blue-200/50">
          <span>👁️</span>
          <span>
            Visualizando calendário de{' '}
            <strong>
              {availableCalendars.find(cal => cal.id === selectedUserId)?.display_name || 'outro usuário'}
            </strong>
          </span>
        </div>
      )}
    </div>
  )
}
