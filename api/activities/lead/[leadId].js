const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

module.exports = async function handler(req, res) {
  console.log('API Activities:', req.query.leadId, req.headers['x-company-id'])
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { leadId } = req.query
    const companyId = req.headers['x-company-id']

    if (!leadId || !companyId) {
      console.error('Missing params:', leadId, companyId)
      return res.status(400).json({ error: 'Missing leadId or companyId' })
    }

    console.log('Fetching activities...')

    // Buscar atividades pendentes do lead
    const { data: activities, error } = await supabase
      .from('lead_activities')
      .select(`
        id,
        title,
        description,
        activity_type,
        scheduled_date,
        scheduled_time,
        priority,
        status,
        created_at
      `)
      .eq('lead_id', leadId)
      .eq('company_id', companyId)
      .in('status', ['pending', 'in_progress'])
      .order('scheduled_date', { ascending: true })
      .order('scheduled_time', { ascending: true })
      .limit(10)

    if (error) {
      console.error('Supabase error:', error)
      return res.status(500).json({ error: 'Failed to fetch activities', details: error.message })
    }

    console.log('Activities found:', activities?.length || 0)

    // Processar atividades para adicionar informações de urgência
    const now = new Date()
    const processedActivities = (activities || []).map(activity => {
      if (!activity.scheduled_date || !activity.scheduled_time) {
        console.warn('Missing date/time for activity:', activity.id)
        return { ...activity, is_overdue: false, is_today: false, is_urgent: false, days_until: null }
      }
      
      const scheduledDateTime = new Date(`${activity.scheduled_date}T${activity.scheduled_time}`)
      
      if (isNaN(scheduledDateTime.getTime())) {
        console.warn('Invalid date:', activity.scheduled_date, activity.scheduled_time)
        return { ...activity, is_overdue: false, is_today: false, is_urgent: false, days_until: null }
      }
      
      const diffMs = scheduledDateTime.getTime() - now.getTime()
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
      
      return {
        ...activity,
        is_overdue: diffMs < 0,
        is_today: diffDays === 0,
        is_urgent: diffDays <= 1 && diffMs >= 0,
        days_until: diffDays
      }
    })

    console.log('Returning', processedActivities.length, 'activities')

    return res.status(200).json({ activities: processedActivities })
  } catch (error) {
    console.error('Unexpected error:', error.message, error.stack)
    return res.status(500).json({ error: 'Internal server error', message: error.message })
  }
}
