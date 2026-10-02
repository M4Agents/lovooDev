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
      case 'GET': {
        // Lista operacional omite tipos ocultos.
        // include_hidden=1 só para admin da empresa ou admin da empresa pai.
        // current_id devolve um tipo já usado numa atividade, mesmo oculto.
        const includeHidden = String(req.query.include_hidden || '') === '1'
        const currentId = typeof req.query.current_id === 'string' && UUID_RE.test(req.query.current_id)
          ? req.query.current_id
          : null

        if (includeHidden) {
          const allowed = await callerIsActivityTypeAdmin(req, company_id)
          if (!allowed) {
            return res.status(403).json({ error: 'Apenas admin pode ver tipos ocultos' })
          }
        }

        let query = supabase
          .from('custom_activity_types')
          .select('*')
          .eq('company_id', company_id)
          .eq('is_active', true)

        if (!includeHidden) {
          query = currentId
            ? query.or(`is_hidden.eq.false,id.eq.${currentId}`)
            : query.eq('is_hidden', false)
        }

        const { data: types, error: getError } = await query
          .order('display_order', { ascending: true })

        if (getError) {
          console.error('Error fetching activity types:', getError)
          return res.status(500).json({ error: getError.message })
        }

        return res.status(200).json(types || [])
      }

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COMPANY_ADMIN_ROLES = ['admin', 'super_admin', 'system_admin']

async function callerIsActivityTypeAdmin(req, companyId) {
  const header = req.headers?.authorization || req.headers?.Authorization
  if (!header || !header.startsWith('Bearer ') || !supabaseServiceKey) return false

  const token = header.slice(7).trim()
  const url = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || supabaseUrl
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon || !token) return false

  const caller = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user } } = await caller.auth.getUser()
  if (!user) return false

  const { data: direct } = await supabase
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle()

  if (direct && COMPANY_ADMIN_ROLES.includes(direct.role)) return true

  const { data: company } = await supabase
    .from('companies')
    .select('parent_company_id')
    .eq('id', companyId)
    .maybeSingle()

  if (!company?.parent_company_id) return false

  const { data: parentMember } = await supabase
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', company.parent_company_id)
    .eq('is_active', true)
    .in('role', ['super_admin', 'system_admin'])
    .maybeSingle()

  return !!parentMember
}
