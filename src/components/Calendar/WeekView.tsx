import React from 'react'
import type { LeadActivity, CalendarUser } from '../../types/calendar'
import { ACTIVITY_TYPES, PRIORITIES } from '../../types/calendar'

interface WeekViewProps {
  currentDate: Date
  activities: LeadActivity[]
  availableCalendars: CalendarUser[]
  onEditActivity: (activity: LeadActivity) => void
}

export const WeekView: React.FC<WeekViewProps> = ({
  currentDate,
  activities,
  availableCalendars,
  onEditActivity
}) => {
  // Função para parse de data sem conversão de timezone
  const parseLocalDate = (dateString: string): Date => {
    const [year, month, day] = dateString.split('-').map(Number)
    return new Date(year, month - 1, day)
  }

  // Calcular início da semana (domingo)
  const startOfWeek = new Date(currentDate)
  const day = startOfWeek.getDay()
  startOfWeek.setDate(startOfWeek.getDate() - day)
  startOfWeek.setHours(0, 0, 0, 0)

  // Gerar array de 7 dias da semana
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(startOfWeek)
    date.setDate(date.getDate() + i)
    return date
  })

  // Horários (8h às 20h)
  const hours = Array.from({ length: 13 }, (_, i) => i + 8)

  // Agrupar atividades por dia
  const activitiesByDay = weekDays.map(day => {
    const dayStr = day.toISOString().split('T')[0]
    return activities.filter(activity => activity.scheduled_date === dayStr)
  })

  const isToday = (date: Date) => {
    const today = new Date()
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
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

  const getActivityPosition = (activity: LeadActivity) => {
    const [hours, minutes] = activity.scheduled_time.split(':').map(Number)
    const totalMinutes = (hours - 8) * 60 + minutes
    const top = (totalMinutes / 60) * 60 // 60px por hora
    const height = (activity.duration_minutes / 60) * 60
    return { top, height }
  }

  const weekDayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50 overflow-hidden">
      {/* Header com dias da semana */}
      <div className="grid grid-cols-8 border-b border-gray-200/50 bg-gradient-to-r from-slate-50 via-blue-50/30 to-slate-50 sticky top-0 z-10">
        <div className="p-3 text-center text-sm font-bold text-gray-500">
          Hora
        </div>
        {weekDays.map((day, index) => (
          <div
            key={day.toISOString()}
            className={`p-3 text-center border-l border-gray-200/30 ${
              isToday(day) ? 'bg-blue-100/50' : ''
            }`}
          >
            <div className={`text-xs font-bold ${
              index === 0 || index === 6 ? 'text-blue-600' : 'text-gray-600'
            }`}>
              {weekDayNames[index]}
            </div>
            <div className={`text-lg font-bold mt-1 ${
              isToday(day)
                ? 'bg-gradient-to-br from-blue-600 to-blue-500 text-white w-8 h-8 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-blue-500/40'
                : 'text-gray-900'
            }`}>
              {day.getDate()}
            </div>
          </div>
        ))}
      </div>

      {/* Grid de horários */}
      <div className="relative overflow-auto max-h-[600px]">
        <div className="grid grid-cols-8">
          {/* Coluna de horários */}
          <div className="border-r border-gray-200/30">
            {hours.map(hour => (
              <div
                key={hour}
                className="h-[60px] border-b border-gray-200/30 p-2 text-xs font-semibold text-gray-500 text-right"
              >
                {hour.toString().padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Colunas de dias */}
          {weekDays.map((day, dayIndex) => (
            <div
              key={day.toISOString()}
              className={`relative border-l border-gray-200/30 ${
                isToday(day) ? 'bg-blue-50/20' : ''
              }`}
            >
              {/* Linhas de horário */}
              {hours.map(hour => (
                <div
                  key={hour}
                  className="h-[60px] border-b border-gray-200/30 hover:bg-blue-50/30 transition-colors cursor-pointer"
                />
              ))}

              {/* Atividades */}
              <div className="absolute inset-0 pointer-events-none">
                {activitiesByDay[dayIndex].map(activity => {
                  const { top, height } = getActivityPosition(activity)
                  const activityColor = getActivityColor(activity)
                  
                  return (
                    <button
                      key={activity.id}
                      onClick={() => onEditActivity(activity)}
                      className="absolute left-1 right-1 pointer-events-auto"
                      style={{
                        top: `${top}px`,
                        height: `${Math.max(height, 30)}px`
                      }}
                    >
                      <div
                        className="h-full p-2 rounded-lg text-xs bg-white/80 backdrop-blur-sm hover:bg-white hover:shadow-lg transition-all duration-200 group border border-gray-200/50 hover:border-blue-300/50 overflow-hidden"
                        style={{
                          borderLeft: `4px solid ${activityColor}`,
                          boxShadow: `0 1px 3px ${activityColor}15`
                        }}
                      >
                        <div className="flex items-start gap-1">
                          <span className="text-xs flex-shrink-0">{getActivityIcon(activity)}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 truncate group-hover:text-blue-600 transition-colors text-[11px]">
                              {activity.title}
                            </p>
                            <p className="text-gray-600 truncate text-[10px] mt-0.5">
                              {activity.scheduled_time.slice(0, 5)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
