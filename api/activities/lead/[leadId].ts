import { validateCaller } from '../../lib/activities/activityAuth.js'

const OPEN_LEAD_ACTIVITY_SELECT = `
  id, title, description, activity_type, priority, status,
  scheduled_date, scheduled_time, scheduled_datetime,
  assigned_to, owner_user_id, lead_id, company_id,
  duration_minutes, reminder_minutes, visibility, created_by,
  notification_sent, created_at, updated_at,
  lead:leads(id, name, phone, email)
`

function queryText(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function headerText(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const leadId = queryText(req.query?.leadId)
  if (!/^\d+$/.test(leadId)) {
    return res.status(400).json({ error: 'leadId inválido' })
  }

  const authResult = await validateCaller(req, headerText(req.headers?.['x-company-id']))
  if (!authResult.ok) {
    return res.status(authResult.status).json({ error: authResult.error })
  }

  try {
    const { data: activities, error } = await authResult.ctx.supabase
      .from('lead_activities')
      .select(OPEN_LEAD_ACTIVITY_SELECT)
      .eq('lead_id', Number(leadId))
      .eq('company_id', authResult.ctx.companyId)
      .in('status', ['pending', 'in_progress'])
      .order('scheduled_date', { ascending: true })
      .order('scheduled_time', { ascending: true })
      .limit(10)

    if (error) {
      console.error('Error fetching lead activities:', error)
      return res.status(500).json({ error: 'Failed to fetch activities' })
    }

    const now = new Date()
    const processedActivities = (activities || []).map(activity => {
      if (!activity.scheduled_date || !activity.scheduled_time) {
        return { ...activity, is_overdue: false, is_today: false, is_urgent: false, days_until: null }
      }

      const scheduledDateTime = new Date(`${activity.scheduled_date}T${activity.scheduled_time}`)
      if (Number.isNaN(scheduledDateTime.getTime())) {
        return { ...activity, is_overdue: false, is_today: false, is_urgent: false, days_until: null }
      }

      const diffMs = scheduledDateTime.getTime() - now.getTime()
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

      return {
        ...activity,
        is_overdue: diffMs < 0,
        is_today: diffDays === 0,
        is_urgent: diffDays <= 1 && diffMs >= 0,
        days_until: diffDays,
      }
    })

    return res.status(200).json({ activities: processedActivities })
  } catch (error) {
    console.error('Error in lead activities API:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
