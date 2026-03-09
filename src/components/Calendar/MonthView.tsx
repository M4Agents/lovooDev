import React from 'react'
import type { LeadActivity, CalendarUser } from '../../types/calendar'

interface MonthViewProps {
  currentDate: Date
  activities: LeadActivity[]
  availableCalendars: CalendarUser[]
  onEditActivity: (activity: LeadActivity) => void
  onViewDay?: (day: number) => void
}

export const MonthView: React.FC<MonthViewProps> = ({
  currentDate,
  activities,
  availableCalendars,
  onEditActivity,
  onViewDay
}) => {
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  // Função para parse de data sem conversão de timezone
  const parseLocalDate = (dateString: string): Date => {
    const [year, month, day] = dateString.split('-').map(Number)
    return new Date(year, month - 1, day)
  }

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
    const activityDate = parseLocalDate(activity.scheduled_date)
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
    const activityUserId = activity.assigned_to || activity.owner_user_id
    const calendar = availableCalendars.find(cal => cal.id === activityUserId)
    return calendar?.color || '#3B82F6'
  }

  const isWeekend = (index: number) => {
    const dayOfWeek = index % 7
    return dayOfWeek === 0 || dayOfWeek === 6 // Domingo (0) ou Sábado (6)
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Header com dias da semana */}
      <div className="grid grid-cols-7 border-b border-gray-200">
        {weekDays.map((day) => (
          <div
            key={day}
            className="py-2 text-center text-[11px] font-medium text-gray-600 uppercase"
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
              className={`min-h-[160px] border-r border-b border-gray-200 p-2 transition-colors ${
                day 
                  ? isWeekendDay 
                    ? 'bg-gray-50 hover:bg-gray-100' 
                    : 'bg-white hover:bg-gray-50'
                  : 'bg-gray-50'
              } ${
                isTodayDay 
                  ? 'bg-blue-50' 
                  : ''
              }`}
            >
              {day && (
                <>
                  <div className="flex items-center justify-between mb-1.5">
                    {isTodayDay ? (
                      <span className="w-6 h-6 flex items-center justify-center rounded-full bg-blue-600 text-white text-xs font-medium">
                        {day}
                      </span>
                    ) : (
                      <span className={`text-xs font-normal ${isWeekendDay ? 'text-gray-500' : 'text-gray-700'}`}>
                        {day}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {dayActivities.slice(0, 5).map(activity => {
                      const activityColor = getActivityColor(activity)
                      return (
                        <button
                          key={activity.id}
                          onClick={() => onEditActivity(activity)}
                          className="w-full text-left px-2 py-1 rounded bg-white hover:bg-gray-50 transition-colors border-l-3"
                          style={{
                            borderLeftColor: activityColor,
                            borderLeftWidth: '3px'
                          }}
                        >
                          <p className="text-xs font-normal text-gray-900 truncate">
                            {activity.title}
                          </p>
                          <p className="text-[10px] text-gray-600">
                            {activity.scheduled_time.slice(0, 5)}
                          </p>
                        </button>
                      )
                    })}

                    {dayActivities.length > 5 && (
                      <button
                        onClick={() => onViewDay?.(day)}
                        className="w-full text-xs font-medium text-blue-600 text-center py-1 hover:bg-gray-50 transition-colors"
                      >
                        +{dayActivities.length - 5} mais
                      </button>
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
