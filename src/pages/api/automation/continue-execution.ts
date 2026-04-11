// =====================================================
// API: CONTINUE EXECUTION
// Objetivo: Delegar retomada de execução ao AutomationEngine (fonte de verdade)
// Chamado por: api/automation/resume-execution.js (shim JS → TS)
// Protegido por: x-internal-secret (apenas chamadas internas)
// =====================================================

import type { NextApiRequest, NextApiResponse } from 'next'
import { automationEngine } from '../../../services/automation/AutomationEngine'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const secret = process.env.INTERNAL_SECRET
  const received = req.headers['x-internal-secret']
  if (!secret || received !== secret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { execution_id, user_response } = req.body

    if (!execution_id) {
      return res.status(400).json({ error: 'execution_id é obrigatório' })
    }

    if (!UUID_REGEX.test(String(execution_id))) {
      return res.status(400).json({ error: 'execution_id inválido' })
    }

    console.log('▶️ continue-execution: delegando ao engine:', execution_id)

    await automationEngine.resumeExecution(execution_id, user_response ?? '')

    return res.status(200).json({ success: true, execution_id })
  } catch (error: any) {
    console.error('❌ continue-execution: erro ao retomar execução:', error)
    return res.status(500).json({ error: 'Erro ao continuar execução' })
  }
}
