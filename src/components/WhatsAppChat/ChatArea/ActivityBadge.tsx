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

  // Próxima atividade para tooltip
  const nextActivity = activities[0]
  const activityTypeEmoji = {
    task: '✅',
    call: '📞',
    meeting: '🤝',
    email: '📧',
    follow_up: '🔄',
    other: '📋'
  }[nextActivity.activity_type] || '📅'

  return (
    <div className="relative">
      <button
        onClick={onActivityClick}
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

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute top-full left-0 mt-2 z-50 w-64 bg-white rounded-lg shadow-xl border border-gray-200 p-3">
          <div className="text-xs font-semibold text-gray-700 mb-2">
            Próxima atividade:
          </div>
          <div className="flex items-start gap-2">
            <span className="text-lg">{activityTypeEmoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {nextActivity.title}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                {new Date(nextActivity.scheduled_date).toLocaleDateString('pt-BR')} às {nextActivity.scheduled_time}
              </p>
              {nextActivity.is_overdue && (
                <p className="text-xs text-red-600 font-medium mt-1">
                  ⚠️ Atrasada
                </p>
              )}
              {nextActivity.is_today && (
                <p className="text-xs text-yellow-600 font-medium mt-1">
                  ⏰ Hoje
                </p>
              )}
              {nextActivity.is_urgent && !nextActivity.is_today && (
                <p className="text-xs text-orange-600 font-medium mt-1">
                  🔔 Amanhã
                </p>
              )}
            </div>
          </div>
          {totalCount > 1 && (
            <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500">
              + {totalCount - 1} {totalCount - 1 === 1 ? 'outra' : 'outras'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
