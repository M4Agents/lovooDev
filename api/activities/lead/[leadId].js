const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { leadId } = req.query
    const companyId = req.headers['x-company-id']

    if (!leadId || !companyId) {
      return res.status(400).json({ error: 'Missing leadId or companyId' })
    }

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
      console.error('Error fetching activities:', error)
      return res.status(500).json({ error: 'Failed to fetch activities' })
    }

    // Processar atividades para adicionar informações de urgência
    const now = new Date()
    const processedActivities = (activities || []).map(activity => {
      const scheduledDateTime = new Date(`${activity.scheduled_date}T${activity.scheduled_time}`)
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

    return res.status(200).json({ activities: processedActivities })
  } catch (error) {
    console.error('Error in activities API:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
