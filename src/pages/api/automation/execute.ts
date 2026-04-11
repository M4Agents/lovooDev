// =====================================================
// API: EXECUTE AUTOMATION FLOW
// Data: 13/03/2026
// Objetivo: Endpoint para executar fluxo manualmente (teste/debug)
// IMPORTANTE: Apenas para testes, não afeta sistema existente
// =====================================================

import type { NextApiRequest, NextApiResponse } from 'next'
import { automationEngine } from '../../../services/automation/AutomationEngine'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).end()
  }

  // Apenas POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { flowId, triggerData, companyId } = req.body

    // Validações
    if (!flowId) {
      return res.status(400).json({ error: 'flowId é obrigatório' })
    }

    if (!companyId) {
      return res.status(400).json({ error: 'companyId é obrigatório' })
    }

    console.log('🎯 API: Executando fluxo manualmente', { flowId, companyId })

    // Executar fluxo
    const executionId = await automationEngine.executeFlow(
      flowId,
      triggerData || {},
      companyId
    )

    if (!executionId) {
      return res.status(500).json({ error: 'Erro ao executar fluxo' })
    }

    return res.status(200).json({
      success: true,
      executionId,
      message: 'Fluxo executado com sucesso'
    })
  } catch (error: any) {
    console.error('❌ Erro na API de execução:', error)
    return res.status(500).json({ error: 'Erro ao executar fluxo' })
  }
}
