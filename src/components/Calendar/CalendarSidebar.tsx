import React from 'react'
import { Settings } from 'lucide-react'
import type { CalendarUser } from '../../types/calendar'

interface CalendarSidebarProps {
  availableCalendars: CalendarUser[]
  selectedCalendars: string[]
  onToggleCalendar: (userId: string) => void
}

export const CalendarSidebar: React.FC<CalendarSidebarProps> = ({
  availableCalendars,
  selectedCalendars,
  onToggleCalendar
}) => {
  const ownCalendar = availableCalendars.find(cal => cal.is_own)
  const sharedCalendars = availableCalendars.filter(cal => !cal.is_own)

  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Meus Calendários</h3>
        
        {ownCalendar && (
          <label className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={selectedCalendars.includes(ownCalendar.id)}
              onChange={() => onToggleCalendar(ownCalendar.id)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <div className="flex items-center gap-2 flex-1">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: ownCalendar.color }}
              />
              <span className="text-sm font-medium text-gray-900">
                {ownCalendar.display_name || 'Meu Calendário'}
              </span>
            </div>
          </label>
        )}
      </div>

      {sharedCalendars.length > 0 && (
        <div className="p-4 flex-1 overflow-y-auto">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Calendários Compartilhados
          </h3>
          
          <div className="space-y-1">
            {sharedCalendars.map(calendar => (
              <label
                key={calendar.id}
                className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedCalendars.includes(calendar.id)}
                  onChange={() => onToggleCalendar(calendar.id)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <div className="flex items-center gap-2 flex-1">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: calendar.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {calendar.display_name || calendar.email}
                    </p>
                    {calendar.permission && (
                      <p className="text-xs text-gray-500">
                        {calendar.permission === 'view' && '👁️ Visualizar'}
                        {calendar.permission === 'edit' && '✏️ Editar'}
                        {calendar.permission === 'manage' && '⚙️ Gerenciar'}
                      </p>
                    )}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="p-4 border-t border-gray-200">
        <button className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors">
          <Settings className="w-4 h-4" />
          Gerenciar Permissões
        </button>
      </div>
    </div>
  )
}
