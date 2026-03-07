import React from 'react'
import type { LeadActivity, CalendarUser } from '../../types/calendar'
import { ACTIVITY_TYPES, PRIORITIES } from '../../types/calendar'

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
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50 overflow-hidden">
      {/* Header com dias da semana */}
      <div className="grid grid-cols-7 border-b border-gray-200/50 bg-gradient-to-r from-slate-50 via-blue-50/30 to-slate-50">
        {weekDays.map((day, index) => (
          <div
            key={day}
            className={`p-3 text-center text-sm font-bold tracking-wide ${
              index === 0 || index === 6 
                ? 'text-blue-600' 
                : 'text-gray-700'
            }`}
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
              className={`min-h-[130px] border-r border-b border-gray-200/30 p-2.5 transition-all duration-200 ${
                day 
                  ? isWeekendDay 
                    ? 'bg-gradient-to-br from-slate-50/50 to-blue-50/20 hover:from-slate-100/50 hover:to-blue-100/30' 
                    : 'bg-white hover:bg-gradient-to-br hover:from-blue-50/20 hover:to-transparent'
                  : 'bg-slate-50/30'
              } ${
                isTodayDay 
                  ? 'bg-gradient-to-br from-blue-100/40 to-blue-50/30 ring-2 ring-blue-400/30 ring-inset' 
                  : ''
              }`}
            >
              {day && (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={`text-sm font-bold transition-all duration-200 ${
                        isTodayDay
                          ? 'bg-gradient-to-br from-blue-600 to-blue-500 text-white w-7 h-7 rounded-full flex items-center justify-center shadow-lg shadow-blue-500/40 ring-2 ring-blue-300/50'
                          : isWeekendDay
                          ? 'text-blue-600'
                          : 'text-gray-700'
                      }`}
                    >
                      {day}
                    </span>
                    {dayActivities.length > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold text-blue-700 bg-blue-100 rounded-full">
                        {dayActivities.length}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {dayActivities.slice(0, 3).map(activity => {
                      const activityColor = getActivityColor(activity)
                      return (
                        <button
                          key={activity.id}
                          onClick={() => onEditActivity(activity)}
                          className="w-full text-left p-2 rounded-lg text-xs bg-white/60 backdrop-blur-sm hover:bg-white hover:shadow-lg transition-all duration-200 group border border-gray-200/50 hover:border-blue-300/50 hover:scale-[1.02] active:scale-[0.98]"
                          style={{
                            borderLeft: `4px solid ${activityColor}`,
                            boxShadow: `0 1px 3px ${activityColor}15`
                          }}
                        >
                          <div className="flex items-start gap-2">
                            <span className="flex items-center justify-center w-5 h-5 bg-gradient-to-br from-blue-50 to-blue-100 rounded-md text-xs flex-shrink-0">
                              {getActivityIcon(activity)}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900 truncate group-hover:text-blue-600 transition-colors">
                                {activity.title}
                              </p>
                              <p className="text-gray-600 truncate font-medium text-[10px] mt-0.5">
                                {activity.scheduled_time.slice(0, 5)}
                              </p>
                            </div>
                            <span className="text-sm flex-shrink-0">{getPriorityColor(activity)}</span>
                          </div>
                        </button>
                      )
                    })}

                    {dayActivities.length > 3 && (
                      <button
                        onClick={() => onViewDay?.(day)}
                        className="w-full text-xs font-semibold text-blue-600 text-center py-1.5 bg-blue-50/50 rounded-lg border border-blue-100/50 hover:bg-blue-100 hover:border-blue-200 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                      >
                        +{dayActivities.length - 3} mais
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
