// =====================================================
// API: GET FLOW EXECUTIONS
// Data: 13/03/2026
// Objetivo: Listar execuções de um fluxo
// =====================================================

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://etzdsywunlpbgxkphuil.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const token = authHeader.replace('Bearer ', '').trim()

  try {
    const { flowId } = req.query
    const { limit = '50', offset = '0' } = req.query

    if (!flowId || typeof flowId !== 'string') {
      return res.status(400).json({ error: 'flowId inválido' })
    }

    // Validar JWT e obter usuário
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token)
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Cliente com JWT do usuário — RLS aplica automaticamente
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    })

    // Derivar company_id da sessão autenticada
    const { data: membership, error: membershipError } = await userClient
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id)
      .limit(1)
      .single()

    if (membershipError || !membership?.company_id) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const companyId = membership.company_id
    const offsetInt = parseInt(offset as string)
    const limitInt = parseInt(limit as string)

    // Buscar execuções filtradas por flow_id e company_id
    const { data: executions, error } = await userClient
      .from('automation_executions')
      .select('id, flow_id, status, created_at, completed_at, current_node_id')
      .eq('flow_id', flowId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(offsetInt, offsetInt + limitInt - 1)

    if (error) throw error

    return res.status(200).json({
      success: true,
      executions: executions || [],
      total: executions?.length || 0
    })
  } catch (error: any) {
    console.error('Erro ao buscar execuções:', error)
    return res.status(500).json({ error: 'Erro ao buscar execuções' })
  }
}
