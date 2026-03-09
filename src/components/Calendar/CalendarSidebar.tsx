import React from 'react'
import type { CalendarUser } from '../../types/calendar'

interface CalendarSidebarProps {
  availableCalendars: CalendarUser[]
  selectedCalendars: string[]
  onToggleCalendar: (userId: string) => void
  onClose: () => void
}

export const CalendarSidebar: React.FC<CalendarSidebarProps> = ({
  availableCalendars,
  selectedCalendars,
  onToggleCalendar,
  onClose
}) => {
  const ownCalendar = availableCalendars.find(cal => cal.is_own)
  const sharedCalendars = availableCalendars.filter(cal => !cal.is_own)

  return (
    <>
      {/* Overlay */}
      <div 
        className="fixed inset-0 bg-black/30 z-40 backdrop-blur-sm animate-fadeIn"
        onClick={onClose}
      />
      
      {/* Sidebar */}
      <div className="fixed left-0 top-0 bottom-0 w-80 bg-gradient-to-br from-white via-blue-50/20 to-white border-r border-gray-200/50 flex flex-col shadow-2xl z-50 animate-slideInLeft">
      <div className="p-5 border-b border-gray-200/50 bg-gradient-to-r from-blue-50/30 to-transparent">
        <h3 className="text-sm font-bold text-gray-900 mb-4 tracking-wide uppercase text-xs">Meus Calendários</h3>
        
        {ownCalendar && (
          <label className="flex items-center gap-3 p-3 hover:bg-white/80 rounded-xl cursor-pointer transition-all duration-200 group border border-transparent hover:border-blue-200/50 hover:shadow-md">
            <input
              type="checkbox"
              checked={selectedCalendars.includes(ownCalendar.id)}
              onChange={() => onToggleCalendar(ownCalendar.id)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 transition-all"
            />
            <div className="flex items-center gap-3 flex-1">
              <div
                className="w-4 h-4 rounded-full shadow-lg transition-all duration-200 group-hover:scale-110"
                style={{ 
                  backgroundColor: ownCalendar.color,
                  boxShadow: `0 0 12px ${ownCalendar.color}40`
                }}
              />
              <span className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                {ownCalendar.display_name || 'Meu Calendário'}
              </span>
            </div>
          </label>
        )}
      </div>

      {sharedCalendars.length > 0 && (
        <div className="p-5 flex-1 overflow-y-auto">
          <h3 className="text-sm font-bold text-gray-900 mb-4 tracking-wide uppercase text-xs">
            Calendários Compartilhados
          </h3>
          
          <div className="space-y-2">
            {sharedCalendars.map(calendar => (
              <label
                key={calendar.id}
                className="flex items-center gap-3 p-3 hover:bg-white/80 rounded-xl cursor-pointer transition-all duration-200 group border border-transparent hover:border-blue-200/50 hover:shadow-md"
              >
                <input
                  type="checkbox"
                  checked={selectedCalendars.includes(calendar.id)}
                  onChange={() => onToggleCalendar(calendar.id)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 transition-all"
                />
                <div className="flex items-center gap-3 flex-1">
                  <div
                    className="w-4 h-4 rounded-full shadow-lg transition-all duration-200 group-hover:scale-110"
                    style={{ 
                      backgroundColor: calendar.color,
                      boxShadow: `0 0 12px ${calendar.color}40`
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-blue-600 transition-colors">
                      {calendar.display_name || calendar.email}
                    </p>
                    {calendar.permission && (
                      <p className="text-xs font-medium text-gray-500 mt-0.5">
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
    </div>
    </>
  )
}
