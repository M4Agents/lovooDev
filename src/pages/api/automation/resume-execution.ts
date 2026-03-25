import { NextApiRequest, NextApiResponse } from 'next'
import { automationEngine } from '@/services/automation/AutomationEngine'

/**
 * API Endpoint: Resume Automation Execution
 * 
 * Chamado pelo webhook após retomar execução no banco
 * Executa AutomationEngine.resumeExecution() para continuar o fluxo
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }
  
  if (req.method !== 'POST') {
    res.status(405).json({ 
      success: false, 
      error: 'Método não permitido. Use POST.' 
    })
    return
  }
  
  try {
    const { execution_id, user_response } = req.body
    
    if (!execution_id || !user_response) {
      res.status(400).json({ 
        success: false, 
        error: 'execution_id e user_response são obrigatórios' 
      })
      return
    }
    
    console.log('🔄 ENDPOINT: Retomando execução:', execution_id)
    console.log('📝 ENDPOINT: Resposta do usuário:', user_response)
    
    // Executar resumeExecution do AutomationEngine
    await automationEngine.resumeExecution(execution_id, user_response)
    
    console.log('✅ ENDPOINT: Execução retomada e processada com sucesso')
    
    res.status(200).json({ 
      success: true,
      message: 'Execução retomada com sucesso',
      execution_id
    })
    
  } catch (error: any) {
    console.error('❌ ENDPOINT: Erro ao retomar execução:', error)
    
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Erro ao retomar execução'
    })
  }
}
