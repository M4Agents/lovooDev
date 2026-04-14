// =====================================================
// API: CONTINUE EXECUTION (interno)
// Chamado por: api/automation/resume-execution.js (shim externo)
// Protegido por: x-internal-secret (apenas chamadas internas)
//
// Retoma execução pausada a partir do current_node_id registrado
// em automation_executions — sem depender de src/.
//
// user_response: opcional para retomada de delay; obrigatório para user_input.
//   Salvo na variável configurada no nó (config.variable || 'user_response').
// =====================================================

// @ts-ignore — arquivo JS ESM em api/lib/automation
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
// @ts-ignore — arquivo JS ESM em api/lib/automation
import { resumeFromNode } from '../lib/automation/executor.js'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const secret   = process.env.INTERNAL_SECRET
  const received = req.headers['x-internal-secret']
  if (!secret || received !== secret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { execution_id, user_response } = req.body ?? {}

  if (!execution_id) {
    return res.status(400).json({ error: 'execution_id é obrigatório' })
  }

  if (!UUID_REGEX.test(String(execution_id))) {
    return res.status(400).json({ error: 'execution_id inválido' })
  }

  const supabase = getSupabaseAdmin()

  try {
    // 1. Buscar execution — precisa de current_node_id e flow_id para retomar
    const { data: execution, error: execErr } = await supabase
      .from('automation_executions')
      .select('id, flow_id, company_id, status, current_node_id, lead_id, opportunity_id, trigger_data, variables')
      .eq('id', execution_id)
      .single()

    if (execErr || !execution) {
      return res.status(404).json({ error: `Execução "${execution_id}" não encontrada` })
    }

    if (execution.status !== 'paused') {
      return res.status(409).json({
        error: `Execução não está pausada (status atual: ${execution.status})`,
        execution_id,
        status: execution.status,
      })
    }

    if (!execution.current_node_id) {
      return res.status(422).json({
        error: 'current_node_id ausente na execução — não é possível determinar de onde retomar',
        execution_id,
      })
    }

    // 2. Buscar flow
    const { data: flow, error: flowErr } = await supabase
      .from('automation_flows')
      .select('id, nodes, edges, company_id')
      .eq('id', execution.flow_id)
      .single()

    if (flowErr || !flow) {
      return res.status(404).json({ error: `Flow "${execution.flow_id}" não encontrado` })
    }

    console.log(`[continue-execution] retomando execução ${execution_id} a partir do nó: ${execution.current_node_id}`)

    // Detectar se é retomada de user_input e validar user_response antecipadamente
    const awaitingInput = (execution as any).variables?._awaiting_input
    if (awaitingInput) {
      if (!user_response || String(user_response).trim() === '') {
        return res.status(422).json({
          error: 'user_response é obrigatório para retomar uma execução aguardando user_input',
          execution_id,
          awaiting_variable: awaitingInput.variable_name || 'user_response',
        })
      }
      console.log(`[continue-execution] user_input detectado — salvando em "${awaitingInput.variable_name || 'user_response'}"`)
    }

    // 3. Retomar execução a partir do nó onde pausou, passando user_response se houver
    const result = await resumeFromNode(execution, flow, execution.current_node_id, supabase, user_response ?? undefined)

    return res.status(200).json({ success: true, execution_id, result })
  } catch (error: any) {
    console.error('[continue-execution] erro ao retomar execução:', error?.message)
    return res.status(500).json({ error: 'Erro ao continuar execução', detail: error?.message })
  }
}
