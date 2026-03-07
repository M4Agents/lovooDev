import React from 'react'
import type { LeadActivity, CalendarUser } from '../../types/calendar'
import { ACTIVITY_TYPES, PRIORITIES } from '../../types/calendar'

interface MonthViewProps {
  currentDate: Date
  activities: LeadActivity[]
  availableCalendars: CalendarUser[]
  onEditActivity: (activity: LeadActivity) => void
}

export const MonthView: React.FC<MonthViewProps> = ({
  currentDate,
  activities,
  availableCalendars,
  onEditActivity
}) => {
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  // Primeiro dia do mês
  const firstDay = new Date(year, month, 1)
  const firstDayOfWeek = firstDay.getDay() // 0 = Domingo

  // Último dia do mês
  const lastDay = new Date(year, month + 1, 0)
  const daysInMonth = lastDay.getDate()

  // Dias da semana
  const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

  // Criar array de dias do calendário
  const calendarDays: (number | null)[] = []
  
  // Adicionar dias vazios antes do primeiro dia
  for (let i = 0; i < firstDayOfWeek; i++) {
    calendarDays.push(null)
  }
  
  // Adicionar dias do mês
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day)
  }

  // Agrupar atividades por dia
  const activitiesByDay = activities.reduce((acc, activity) => {
    const activityDate = new Date(activity.scheduled_date)
    const day = activityDate.getDate()
    
    if (activityDate.getMonth() === month && activityDate.getFullYear() === year) {
      if (!acc[day]) acc[day] = []
      acc[day].push(activity)
    }
    
    return acc
  }, {} as Record<number, LeadActivity[]>)

  const isToday = (day: number) => {
    const today = new Date()
    return (
      today.getDate() === day &&
      today.getMonth() === month &&
      today.getFullYear() === year
    )
  }

  const getActivityColor = (activity: LeadActivity) => {
    const calendar = availableCalendars.find(cal => cal.id === activity.owner_user_id)
    return calendar?.color || '#3B82F6'
  }

  const getActivityIcon = (activity: LeadActivity) => {
    const type = ACTIVITY_TYPES.find(t => t.value === activity.activity_type)
    return type?.icon || '📋'
  }

  const getPriorityColor = (activity: LeadActivity) => {
    const priority = PRIORITIES.find(p => p.value === activity.priority)
    return priority?.icon || '🟡'
  }

  const isWeekend = (index: number) => {
    const dayOfWeek = index % 7
    return dayOfWeek === 0 || dayOfWeek === 6 // Domingo (0) ou Sábado (6)
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Header com dias da semana */}
      <div className="grid grid-cols-7 border-b border-gray-200">
        {weekDays.map(day => (
          <div
            key={day}
            className="p-3 text-center text-sm font-semibold text-gray-700 bg-gray-50"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Grid de dias */}
      <div className="grid grid-cols-7">
        {calendarDays.map((day, index) => {
          const dayActivities = day ? activitiesByDay[day] || [] : []
          const isTodayDay = day ? isToday(day) : false
          const isWeekendDay = isWeekend(index)

          return (
            <div
              key={index}
              className={`min-h-[120px] border-r border-b border-gray-200 p-2 ${
                day 
                  ? isWeekendDay 
                    ? 'bg-gray-50 hover:bg-gray-100' 
                    : 'bg-white hover:bg-gray-50'
                  : 'bg-gray-50'
              } ${isTodayDay ? 'bg-blue-50' : ''}`}
            >
              {day && (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={`text-sm font-medium ${
                        isTodayDay
                          ? 'bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center'
                          : 'text-gray-700'
                      }`}
                    >
                      {day}
                    </span>
                    {dayActivities.length > 0 && (
                      <span className="text-xs text-gray-500">
                        {dayActivities.length}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {dayActivities.slice(0, 3).map(activity => (
                      <button
                        key={activity.id}
                        onClick={() => onEditActivity(activity)}
                        className="w-full text-left p-1.5 rounded text-xs hover:bg-white hover:shadow-sm transition-all group"
                        style={{
                          borderLeft: `3px solid ${getActivityColor(activity)}`
                        }}
                      >
                        <div className="flex items-start gap-1">
                          <span className="text-xs">{getActivityIcon(activity)}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate group-hover:text-blue-600">
                              {activity.title}
                            </p>
                            <p className="text-gray-500 truncate">
                              {activity.scheduled_time.slice(0, 5)}
                            </p>
                          </div>
                          <span className="text-xs">{getPriorityColor(activity)}</span>
                        </div>
                      </button>
                    ))}

                    {dayActivities.length > 3 && (
                      <div className="text-xs text-gray-500 text-center py-1">
                        +{dayActivities.length - 3} mais
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
