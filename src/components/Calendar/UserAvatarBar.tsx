import React from 'react'
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

  // Mostrar até 5 avatares sobrepostos
  const visibleCalendars = sortedCalendars.slice(0, 5)

  return (
    <div className="flex items-center">
      {visibleCalendars.map((calendar, index) => (
        <div
          key={calendar.id}
          className="relative"
          style={{ 
            marginLeft: index > 0 ? '-8px' : '0',
            zIndex: visibleCalendars.length - index
          }}
        >
          <UserAvatar
            user={calendar}
            isActive={calendar.id === selectedUserId}
            onClick={() => onSelectUser(calendar.id)}
          />
        </div>
      ))}
    </div>
  )
}
