import React, { useState, useEffect } from 'react'

interface Activity {
  id: string
  title: string
  description: string
  activity_type: string
  scheduled_date: string
  scheduled_time: string
  priority: string
  status: string
  is_overdue: boolean
  is_today: boolean
  is_urgent: boolean
  days_until: number
}

interface ActivityBadgeProps {
  leadId: number
  companyId: string
  onActivityClick?: (activity: Activity) => void
}

export const ActivityBadge: React.FC<ActivityBadgeProps> = ({
  leadId,
  companyId,
  onActivityClick
}) => {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [showTooltip, setShowTooltip] = useState(false)

  useEffect(() => {
    fetchActivities()
  }, [leadId, companyId])

  const fetchActivities = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/activities/lead/${leadId}`, {
        headers: {
          'x-company-id': companyId
        }
      })

      if (response.ok) {
        const data = await response.json()
        setActivities(data.activities || [])
      }
    } catch (error) {
      console.error('Error fetching activities:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading || activities.length === 0) {
    return null
  }

  const overdueCount = activities.filter(a => a.is_overdue).length
  const todayCount = activities.filter(a => a.is_today).length
  const urgentCount = activities.filter(a => a.is_urgent).length
  const totalCount = activities.length

  // Determinar cor do badge
  let badgeColor = 'bg-blue-100 text-blue-700 border-blue-200'
  if (overdueCount > 0) {
    badgeColor = 'bg-red-100 text-red-700 border-red-200'
  } else if (todayCount > 0) {
    badgeColor = 'bg-yellow-100 text-yellow-700 border-yellow-200'
  } else if (urgentCount > 0) {
    badgeColor = 'bg-orange-100 text-orange-700 border-orange-200'
  }

  // Função para obter emoji do tipo de atividade
  const getActivityEmoji = (type: string) => {
    const emojis: Record<string, string> = {
      task: '✅',
      call: '📞',
      meeting: '🤝',
      email: '📧',
      follow_up: '🔄',
      other: '📋'
    }
    return emojis[type] || '📅'
  }

  return (
    <div className="relative">
      <button
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`
          inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
          border transition-all hover:shadow-md cursor-pointer
          ${badgeColor}
        `}
      >
        <span className="text-sm">📅</span>
        <span>{totalCount} {totalCount === 1 ? 'atividade' : 'atividades'}</span>
        {overdueCount > 0 && (
          <span className="ml-1 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
        )}
      </button>

      {/* Tooltip com todas as atividades */}
      {showTooltip && (
        <div className="absolute top-full left-0 mt-2 z-50 w-72 bg-white rounded-lg shadow-xl border border-gray-200 max-h-96 overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 sticky top-0">
            <p className="text-xs font-semibold text-gray-700">
              {totalCount} {totalCount === 1 ? 'Atividade' : 'Atividades'}
            </p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {activities.map((activity, idx) => (
              <div
                key={activity.id}
                onClick={() => {
                  setShowTooltip(false)
                  onActivityClick?.(activity)
                }}
                className={`p-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                  idx !== activities.length - 1 ? 'border-b border-gray-100' : ''
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="text-lg flex-shrink-0">{getActivityEmoji(activity.activity_type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {activity.title}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {new Date(activity.scheduled_date).toLocaleDateString('pt-BR')} às {activity.scheduled_time}
                    </p>
                    {activity.is_overdue && (
                      <p className="text-xs text-red-600 font-medium mt-1">⚠️ Atrasada</p>
                    )}
                    {activity.is_today && !activity.is_overdue && (
                      <p className="text-xs text-yellow-600 font-medium mt-1">⏰ Hoje</p>
                    )}
                    {activity.is_urgent && !activity.is_today && !activity.is_overdue && (
                      <p className="text-xs text-orange-600 font-medium mt-1">🔔 Amanhã</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 text-center">
            <p className="text-xs text-gray-500">Clique para ver detalhes</p>
          </div>
        </div>
      )}
    </div>
  )
}
