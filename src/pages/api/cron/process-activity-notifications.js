import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  // Verificar se é uma requisição de cron da Vercel
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log('⚠️ Requisição não autorizada para cron job')
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    console.log('🔔 Iniciando processamento de notificações de atividades...')

    const now = new Date()
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    // Buscar atividades pendentes que precisam de notificação
    const { data: activities, error: activitiesError } = await supabase
      .from('lead_activities')
      .select(`
        id,
        company_id,
        title,
        scheduled_date,
        scheduled_time,
        scheduled_datetime,
        reminder_minutes,
        notification_sent,
        assigned_to,
        owner_user_id,
        activity_type,
        lead:leads(id, name)
      `)
      .eq('status', 'pending')
      .eq('notification_sent', false)
      .gte('scheduled_datetime', now.toISOString())
      .lte('scheduled_datetime', in24Hours.toISOString())
      .not('assigned_to', 'is', null)

    if (activitiesError) {
      console.error('❌ Erro ao buscar atividades:', activitiesError)
      throw activitiesError
    }

    console.log(`📋 Encontradas ${activities?.length || 0} atividades para verificar`)

    let notificationsCreated = 0
    let activitiesUpdated = 0

    for (const activity of activities || []) {
      try {
        // Calcular horário de notificação
        const scheduledTime = new Date(activity.scheduled_datetime)
        const notificationTime = new Date(
          scheduledTime.getTime() - (activity.reminder_minutes * 60 * 1000)
        )

        // Se já passou do horário de notificar
        if (now >= notificationTime) {
          console.log(`⏰ Criando notificação para atividade: ${activity.title}`)

          // Criar mensagem da notificação
          const leadName = activity.lead?.name || 'Lead'
          const timeUntil = Math.round((scheduledTime - now) / (60 * 1000))
          
          let timeMessage = ''
          if (timeUntil <= 0) {
            timeMessage = 'agora'
          } else if (timeUntil < 60) {
            timeMessage = `em ${timeUntil} minutos`
          } else if (timeUntil < 1440) {
            const hours = Math.round(timeUntil / 60)
            timeMessage = `em ${hours} ${hours === 1 ? 'hora' : 'horas'}`
          } else {
            const days = Math.round(timeUntil / 1440)
            timeMessage = `em ${days} ${days === 1 ? 'dia' : 'dias'}`
          }

          const activityTypeEmoji = {
            call: '📞',
            meeting: '🤝',
            email: '📧',
            task: '✅',
            follow_up: '🔄',
            demo: '🎯',
            other: '📋'
          }[activity.activity_type] || '📅'

          // Criar notificação
          const { error: notificationError } = await supabase
            .from('activity_notifications')
            .insert({
              company_id: activity.company_id,
              activity_id: activity.id,
              user_id: activity.assigned_to,
              notification_type: 'activity_reminder',
              title: `${activityTypeEmoji} ${activity.title}`,
              message: `Sua atividade com ${leadName} começa ${timeMessage}`,
              status: 'sent',
              sent_at: now.toISOString(),
              scheduled_for: notificationTime.toISOString()
            })

          if (notificationError) {
            console.error(`❌ Erro ao criar notificação para atividade ${activity.id}:`, notificationError)
            continue
          }

          notificationsCreated++

          // Marcar atividade como notificada
          const { error: updateError } = await supabase
            .from('lead_activities')
            .update({
              notification_sent: true,
              updated_at: now.toISOString()
            })
            .eq('id', activity.id)

          if (updateError) {
            console.error(`❌ Erro ao atualizar atividade ${activity.id}:`, updateError)
            continue
          }

          activitiesUpdated++
          console.log(`✅ Notificação criada para: ${activity.title}`)
        }
      } catch (error) {
        console.error(`❌ Erro ao processar atividade ${activity.id}:`, error)
        continue
      }
    }

    console.log(`✅ Processamento concluído:`)
    console.log(`   - Notificações criadas: ${notificationsCreated}`)
    console.log(`   - Atividades atualizadas: ${activitiesUpdated}`)

    return res.status(200).json({
      success: true,
      processed: activities?.length || 0,
      notifications_created: notificationsCreated,
      activities_updated: activitiesUpdated
    })

  } catch (error) {
    console.error('❌ Erro no processamento de notificações:', error)
    return res.status(500).json({
      success: false,
      error: error.message
    })
  }
}
