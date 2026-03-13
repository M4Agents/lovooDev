// =====================================================
// API: GET FLOW EXECUTIONS
// Data: 13/03/2026
// Objetivo: Listar execuções de um fluxo
// =====================================================

import type { NextApiRequest, NextApiResponse } from 'next'
import { supabase } from '../../../../lib/supabase'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { flowId } = req.query
    const { limit = '50', offset = '0' } = req.query

    if (!flowId || typeof flowId !== 'string') {
      return res.status(400).json({ error: 'flowId inválido' })
    }

    // Buscar execuções
    const { data: executions, error } = await supabase
      .from('automation_executions')
      .select('*')
      .eq('flow_id', flowId)
      .order('started_at', { ascending: false })
      .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1)

    if (error) throw error

    return res.status(200).json({
      success: true,
      executions: executions || [],
      total: executions?.length || 0
    })
  } catch (error: any) {
    console.error('Erro ao buscar execuções:', error)
    return res.status(500).json({
      error: 'Erro ao buscar execuções',
      details: error.message
    })
  }
}
