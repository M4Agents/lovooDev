import React from 'react'
import { Calendar, CalendarDays, CalendarRange } from 'lucide-react'
import type { CalendarView } from '../../types/calendar'

interface ViewSelectorProps {
  currentView: CalendarView
  onViewChange: (view: CalendarView) => void
}

export const ViewSelector: React.FC<ViewSelectorProps> = ({
  currentView,
  onViewChange
}) => {
  const views: { value: CalendarView; label: string; icon: React.ReactNode }[] = [
    { value: 'month', label: 'Mês', icon: <Calendar className="w-4 h-4" /> },
    { value: 'week', label: 'Semana', icon: <CalendarRange className="w-4 h-4" /> },
    { value: 'day', label: 'Dia', icon: <CalendarDays className="w-4 h-4" /> }
  ]

  return (
    <div className="inline-flex items-center gap-1 bg-white/80 backdrop-blur-sm rounded-xl p-1 border border-gray-200/50 shadow-sm">
      {views.map(view => (
        <button
          key={view.value}
          onClick={() => onViewChange(view.value)}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200
            ${currentView === view.value
              ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-md shadow-blue-500/30'
              : 'text-gray-600 hover:text-blue-600 hover:bg-blue-50/50'
            }
          `}
        >
          {view.icon}
          <span>{view.label}</span>
        </button>
      ))}
    </div>
  )
}
