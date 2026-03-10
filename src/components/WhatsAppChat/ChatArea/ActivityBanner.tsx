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

interface ActivityBannerProps {
  leadId: number
  companyId: string
  onViewDetails?: () => void
}

export const ActivityBanner: React.FC<ActivityBannerProps> = ({
  leadId,
  companyId,
  onViewDetails
}) => {
  const [urgentActivity, setUrgentActivity] = useState<Activity | null>(null)
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    fetchUrgentActivity()
  }, [leadId, companyId])

  const fetchUrgentActivity = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/activities/lead/${leadId}`, {
        headers: {
          'x-company-id': companyId
        }
      })

      if (response.ok) {
        const data = await response.json()
        const activities = data.activities || []
        
        // Pegar apenas atividades atrasadas ou para hoje
        const urgent = activities.find((a: Activity) => a.is_overdue || a.is_today)
        setUrgentActivity(urgent || null)
      }
    } catch (error) {
      console.error('Error fetching urgent activity:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading || !urgentActivity || dismissed) {
    return null
  }

  const activityTypeEmoji = {
    task: '✅',
    call: '📞',
    meeting: '🤝',
    email: '📧',
    follow_up: '🔄',
    other: '📋'
  }[urgentActivity.activity_type] || '📅'

  const isOverdue = urgentActivity.is_overdue

  return (
    <div className={`
      border-b px-4 py-3 flex items-center justify-between
      ${isOverdue ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}
    `}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={`
          w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0
          ${isOverdue ? 'bg-red-100' : 'bg-yellow-100'}
        `}>
          <span className="text-xl">{isOverdue ? '⚠️' : '⏰'}</span>
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`
              text-xs font-bold uppercase tracking-wide
              ${isOverdue ? 'text-red-700' : 'text-yellow-700'}
            `}>
              {isOverdue ? 'Atividade Atrasada' : 'Atividade Hoje'}
            </span>
            {isOverdue && (
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-sm">{activityTypeEmoji}</span>
            <p className={`
              text-sm font-medium truncate
              ${isOverdue ? 'text-red-900' : 'text-yellow-900'}
            `}>
              {urgentActivity.title}
            </p>
            <span className={`
              text-xs px-2 py-0.5 rounded-full
              ${isOverdue ? 'bg-red-200 text-red-800' : 'bg-yellow-200 text-yellow-800'}
            `}>
              {new Date(urgentActivity.scheduled_date).toLocaleDateString('pt-BR')} às {urgentActivity.scheduled_time}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 ml-3">
        {onViewDetails && (
          <button
            onClick={onViewDetails}
            className={`
              px-3 py-1.5 text-xs font-medium rounded-md transition-colors
              ${isOverdue 
                ? 'bg-red-600 text-white hover:bg-red-700' 
                : 'bg-yellow-600 text-white hover:bg-yellow-700'
              }
            `}
          >
            Ver Detalhes
          </button>
        )}
        
        <button
          onClick={() => setDismissed(true)}
          className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
          title="Dispensar"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
