import React from 'react'
import type { LeadActivity, CalendarUser } from '../../types/calendar'
import { useAuth } from '../../contexts/AuthContext'
import {
  activityCompanyDate,
  activityCompanyTime,
  companyWallFromInstant,
  daysInCivilMonth,
} from '../../utils/companyTime'

interface MonthViewProps {
  currentDate: Date
  activities: LeadActivity[]
  availableCalendars: CalendarUser[]
  onEditActivity: (activity: LeadActivity) => void
  onViewDay?: (date: string) => void
  onCreateActivity?: (date: string) => void
}

export const MonthView: React.FC<MonthViewProps> = ({
  currentDate,
  activities,
  availableCalendars,
  onEditActivity,
  onViewDay,
  onCreateActivity
}) => {
  const { companyTimezone } = useAuth()
  const anchor = companyWallFromInstant(currentDate, companyTimezone)
  const [year, month] = anchor.date.split('-').map(Number)
  const today = companyWallFromInstant(new Date(), companyTimezone).date

  const firstDayOfWeek = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const daysInMonth = daysInCivilMonth(year, month)

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
    const activityDate = activityCompanyDate(activity, companyTimezone)
    const [activityYear, activityMonth, activityDay] = activityDate.split('-').map(Number)

    if (activityYear === year && activityMonth === month) {
      if (!acc[activityDay]) acc[activityDay] = []
      acc[activityDay].push(activity)
    }
    
    return acc
  }, {} as Record<number, LeadActivity[]>)

  const isToday = (day: number) => {
    const dayText = String(day).padStart(2, '0')
    const monthText = String(month).padStart(2, '0')
    return today === `${year}-${monthText}-${dayText}`
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
              onClick={() => {
                if (day && onCreateActivity) {
                  const selectedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                  onCreateActivity(selectedDate)
                }
              }}
              style={{ cursor: day ? 'pointer' : 'default' }}
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
                          onClick={(e) => {
                            e.stopPropagation()
                            onEditActivity(activity)
                          }}
                          className="w-full text-left px-2 py-1 rounded bg-white hover:bg-gray-50 transition-colors border-l-3"
                          style={{
                            borderLeftColor: activityColor,
                            borderLeftWidth: '3px'
                          }}
                        >
                          <div className="flex items-center gap-1">
                            <p className="text-xs font-normal text-gray-900 truncate flex-1">
                              {activity.title}
                            </p>
                            {activity.lead_id ? (
                              <span className="text-[9px] text-blue-600">📊</span>
                            ) : (
                              <span className="text-[9px] text-gray-400">👤</span>
                            )}
                          </div>
                          <p className="text-[10px] text-gray-600">
                            {activityCompanyTime(activity, companyTimezone)}
                          </p>
                        </button>
                      )
                    })}

                    {dayActivities.length > 5 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onViewDay?.(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
                        }}
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
