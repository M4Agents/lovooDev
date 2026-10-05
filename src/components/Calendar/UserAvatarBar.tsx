import React from 'react'
import type { CalendarUser } from '../../types/calendar'
import { UserAvatar } from './UserAvatar'

interface UserAvatarBarProps {
  currentUser: CalendarUser
  availableCalendars: CalendarUser[]
  selectedUserId: string
  allSelected: boolean
  onSelectUser: (userId: string) => void
  onSelectAll: () => void
}

export const UserAvatarBar: React.FC<UserAvatarBarProps> = ({
  currentUser,
  availableCalendars,
  selectedUserId,
  allSelected,
  onSelectUser,
  onSelectAll
}) => {
  // Ordenar: próprio usuário primeiro, depois outros
  const sortedCalendars = [
    currentUser,
    ...availableCalendars.filter(cal => !cal.is_own)
  ]

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
      {sortedCalendars.length > 1 && (
        <button
          type="button"
          onClick={onSelectAll}
          className={[
            'shrink-0 rounded-full border px-3 py-1 text-xs font-semibold',
            allSelected
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300',
          ].join(' ')}
        >
          Todas
        </button>
      )}
      {sortedCalendars.map(calendar => {
        const label = (calendar.display_name || calendar.email || 'Usuário').split(' ')[0]
        const active = !allSelected && calendar.id === selectedUserId
        return (
          <button
            key={calendar.id}
            type="button"
            onClick={() => onSelectUser(calendar.id)}
            title={calendar.display_name || calendar.email}
            className={[
              'flex shrink-0 items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2',
              active ? 'border-blue-600 bg-blue-50' : 'border-transparent hover:bg-white',
            ].join(' ')}
          >
            <UserAvatar
              user={calendar}
              isActive={active}
              onClick={() => onSelectUser(calendar.id)}
              decorative
            />
            <span className="text-xs font-medium text-gray-800">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
