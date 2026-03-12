import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-company-id')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // GET - Buscar notificações do usuário
    if (req.method === 'GET') {
      const { user_id, status, limit = 50 } = req.query

      if (!user_id) {
        return res.status(400).json({ error: 'user_id é obrigatório' })
      }

      let query = supabase
        .from('activity_notifications')
        .select(`
          *,
          activity:lead_activities(
            id,
            title,
            scheduled_date,
            scheduled_time,
            activity_type,
            lead:leads(id, name)
          )
        `)
        .eq('user_id', user_id)
        .order('created_at', { ascending: false })
        .limit(parseInt(limit))

      // Filtrar por status se fornecido
      if (status) {
        query = query.eq('status', status)
      }

      const { data, error } = await query

      if (error) throw error

      return res.status(200).json({
        success: true,
        notifications: data || []
      })
    }

    // PUT - Marcar notificação como lida
    if (req.method === 'PUT') {
      const { notification_id, action } = req.body

      if (!notification_id) {
        return res.status(400).json({ error: 'notification_id é obrigatório' })
      }

      if (action === 'mark_read') {
        const { data, error } = await supabase
          .from('activity_notifications')
          .update({
            status: 'read',
            read_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', notification_id)
          .select()
          .single()

        if (error) throw error

        return res.status(200).json({
          success: true,
          notification: data
        })
      }

      return res.status(400).json({ error: 'Ação inválida' })
    }

    // POST - Marcar todas como lidas
    if (req.method === 'POST') {
      const { user_id, action } = req.body

      if (!user_id) {
        return res.status(400).json({ error: 'user_id é obrigatório' })
      }

      if (action === 'mark_all_read') {
        const { data, error } = await supabase
          .from('activity_notifications')
          .update({
            status: 'read',
            read_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user_id)
          .eq('status', 'sent')
          .select()

        if (error) throw error

        return res.status(200).json({
          success: true,
          updated_count: data?.length || 0
        })
      }

      return res.status(400).json({ error: 'Ação inválida' })
    }

    return res.status(405).json({ error: 'Método não permitido' })

  } catch (error) {
    console.error('Erro na API de notificações:', error)
    return res.status(500).json({
      success: false,
      error: error.message
    })
  }
}
