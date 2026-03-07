import React from 'react'
import type { LeadActivity, CalendarUser } from '../../types/calendar'
import { ACTIVITY_TYPES, PRIORITIES } from '../../types/calendar'

interface DayViewProps {
  currentDate: Date
  activities: LeadActivity[]
  availableCalendars: CalendarUser[]
  onEditActivity: (activity: LeadActivity) => void
}

export const DayView: React.FC<DayViewProps> = ({
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

  // Filtrar atividades do dia
  const dayStr = currentDate.toISOString().split('T')[0]
  const dayActivities = activities.filter(activity => activity.scheduled_date === dayStr)

  // Horários (8h às 20h, intervalos de 30min)
  const timeSlots = Array.from({ length: 25 }, (_, i) => {
    const hour = Math.floor(i / 2) + 8
    const minute = (i % 2) * 30
    return { hour, minute, label: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}` }
  })

  const getActivityColor = (activity: LeadActivity) => {
    const activityUserId = activity.assigned_to || activity.owner_user_id
    const calendar = availableCalendars.find(cal => cal.id === activityUserId)
    return calendar?.color || '#3B82F6'
  }

  const getActivityIcon = (activity: LeadActivity) => {
    const type = ACTIVITY_TYPES.find(t => t.value === activity.activity_type)
    return type?.icon || '📋'
  }

  const getPriorityIcon = (activity: LeadActivity) => {
    const priority = PRIORITIES.find(p => p.value === activity.priority)
    return priority?.icon || '🟡'
  }

  const getActivityPosition = (activity: LeadActivity) => {
    const [hours, minutes] = activity.scheduled_time.split(':').map(Number)
    const totalMinutes = (hours - 8) * 60 + minutes
    const top = (totalMinutes / 30) * 50 // 50px por slot de 30min
    const height = (activity.duration_minutes / 30) * 50
    return { top, height }
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('pt-BR', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long',
      year: 'numeric'
    })
  }

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50 overflow-hidden">
      {/* Header com data */}
      <div className="p-4 border-b border-gray-200/50 bg-gradient-to-r from-slate-50 via-blue-50/30 to-slate-50">
        <h3 className="text-lg font-bold text-gray-900 capitalize text-center">
          {formatDate(currentDate)}
        </h3>
        {dayActivities.length > 0 && (
          <p className="text-sm text-center text-gray-600 mt-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium text-xs">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
              {dayActivities.length} {dayActivities.length === 1 ? 'atividade' : 'atividades'}
            </span>
          </p>
        )}
      </div>

      {/* Grid de horários */}
      <div className="relative overflow-auto max-h-[600px]">
        <div className="relative">
          {/* Slots de tempo */}
          {timeSlots.map((slot, index) => (
            <div
              key={`${slot.hour}-${slot.minute}`}
              className={`flex border-b border-gray-200/30 hover:bg-blue-50/20 transition-colors ${
                slot.minute === 0 ? 'border-gray-300/50' : ''
              }`}
            >
              <div className={`w-20 p-3 text-right flex-shrink-0 ${
                slot.minute === 0 ? 'font-semibold text-gray-700' : 'text-gray-500 text-xs'
              }`}>
                {slot.minute === 0 ? slot.label : ''}
              </div>
              <div className="flex-1 h-[50px] relative border-l border-gray-200/30">
                {/* Linha de separação de hora */}
                {slot.minute === 0 && (
                  <div className="absolute inset-x-0 top-0 border-t border-gray-300/30"></div>
                )}
              </div>
            </div>
          ))}

          {/* Atividades */}
          <div className="absolute inset-0 left-20 pointer-events-none">
            {dayActivities.map(activity => {
              const { top, height } = getActivityPosition(activity)
              const activityColor = getActivityColor(activity)
              
              return (
                <button
                  key={activity.id}
                  onClick={() => onEditActivity(activity)}
                  className="absolute left-2 right-2 pointer-events-auto"
                  style={{
                    top: `${top}px`,
                    height: `${Math.max(height, 50)}px`
                  }}
                >
                  <div
                    className="h-full p-3 rounded-xl text-sm bg-white/90 backdrop-blur-sm hover:bg-white hover:shadow-xl transition-all duration-200 group border border-gray-200/50 hover:border-blue-300/50 overflow-hidden"
                    style={{
                      borderLeft: `5px solid ${activityColor}`,
                      boxShadow: `0 2px 8px ${activityColor}20`
                    }}
                  >
                    <div className="flex items-start gap-2 h-full">
                      <span className="flex items-center justify-center w-6 h-6 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg text-sm flex-shrink-0">
                        {getActivityIcon(activity)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-900 truncate group-hover:text-blue-600 transition-colors">
                          {activity.title}
                        </p>
                        <p className="text-gray-600 text-xs mt-1">
                          {activity.scheduled_time.slice(0, 5)} - {activity.duration_minutes} min
                        </p>
                        {activity.lead && (
                          <p className="text-gray-500 text-xs mt-1 truncate">
                            📋 {activity.lead.name}
                          </p>
                        )}
                        {activity.description && height > 80 && (
                          <p className="text-gray-600 text-xs mt-2 line-clamp-2">
                            {activity.description}
                          </p>
                        )}
                      </div>
                      <span className="text-lg flex-shrink-0">{getPriorityIcon(activity)}</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Empty state */}
      {dayActivities.length === 0 && (
        <div className="p-12 text-center">
          <div className="text-6xl mb-4">📅</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Nenhuma atividade agendada
          </h3>
          <p className="text-sm text-gray-600">
            Clique em "Nova Atividade" para agendar algo para este dia
          </p>
        </div>
      )}
    </div>
  )
}
