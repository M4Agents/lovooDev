import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req, res) {
  const { method } = req
  const { company_id } = req.query

  if (!company_id) {
    return res.status(400).json({ error: 'company_id is required' })
  }

  try {
    switch (method) {
      case 'GET':
        // Listar tipos de atividades da empresa
        const { data: types, error: getError } = await supabase
          .from('custom_activity_types')
          .select('*')
          .eq('company_id', company_id)
          .eq('is_active', true)
          .order('display_order', { ascending: true })

        if (getError) {
          console.error('Error fetching activity types:', getError)
          return res.status(500).json({ error: getError.message })
        }

        return res.status(200).json(types || [])

      case 'POST':
        // Criar novo tipo de atividade
        const { name, icon, color } = req.body

        if (!name || !icon) {
          return res.status(400).json({ error: 'name and icon are required' })
        }

        // Buscar próximo display_order
        const { data: maxOrder } = await supabase
          .from('custom_activity_types')
          .select('display_order')
          .eq('company_id', company_id)
          .order('display_order', { ascending: false })
          .limit(1)
          .single()

        const nextOrder = (maxOrder?.display_order || 0) + 1

        const { data: newType, error: createError } = await supabase
          .from('custom_activity_types')
          .insert({
            company_id,
            name,
            icon,
            color: color || 'blue',
            is_system: false,
            display_order: nextOrder
          })
          .select()
          .single()

        if (createError) {
          console.error('Error creating activity type:', createError)
          return res.status(500).json({ error: createError.message })
        }

        return res.status(201).json(newType)

      case 'DELETE':
        // Deletar tipo de atividade (soft delete)
        const { id } = req.body

        if (!id) {
          return res.status(400).json({ error: 'id is required' })
        }

        const { error: deleteError } = await supabase
          .from('custom_activity_types')
          .update({ is_active: false })
          .eq('id', id)
          .eq('company_id', company_id)
          .eq('is_system', false) // Não permite deletar tipos do sistema

        if (deleteError) {
          console.error('Error deleting activity type:', deleteError)
          return res.status(500).json({ error: deleteError.message })
        }

        return res.status(200).json({ success: true })

      default:
        res.setHeader('Allow', ['GET', 'POST', 'DELETE'])
        return res.status(405).end(`Method ${method} Not Allowed`)
    }
  } catch (error) {
    console.error('Activity types API error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
