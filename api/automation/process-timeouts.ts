// =====================================================
// API: POST /api/automation/process-timeouts
//
// Cron job:
//  1. Finaliza execuções pausadas em user_input cujo timeout_at já passou.
//  2. Limpa registros de automation_trigger_events com mais de 60 dias (retenção).
//
// Sem imports de src/ — usa apenas supabaseAdmin.js.
//
// Race condition: validação atômica por status antes de
// qualquer update — garante que continue-execution não
// e este cron não processem a mesma execução ao mesmo tempo.
// =====================================================

// @ts-ignore — arquivo JS ESM em api/lib/automation
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'

const BATCH_LIMIT = 50

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization as string | undefined
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = getSupabaseAdmin()
  const now = new Date().toISOString()

  console.log('[process-timeouts] iniciando verificação de timeouts expirados')

  // 0. Limpeza de retenção: apagar trigger_events com mais de 60 dias
  await purgeOldTriggerEvents(supabase)

  // 1. Buscar execuções pausadas com timeout expirado e _awaiting_input presente
  //
  // A condição jsonb usa o operador ? para verificar a chave — filtra apenas
  // execuções que estão aguardando resposta de user_input (não delay genérico).
  const { data: candidates, error: fetchErr } = await supabase
    .from('automation_executions')
    .select('id, flow_id, company_id, current_node_id, timeout_at, variables')
    .eq('status', 'paused')
    .not('timeout_at', 'is', null)
    .lte('timeout_at', now)
    .limit(BATCH_LIMIT)

  if (fetchErr) {
    console.error('[process-timeouts] erro ao buscar execuções:', fetchErr.message)
    return res.status(500).json({ error: 'Erro ao buscar execuções', detail: fetchErr.message })
  }

  // Filtrar no lado JS apenas as que têm _awaiting_input
  // (Supabase client não suporta jsonb key check diretamente no filter)
  const expired = (candidates || []).filter(
    (e: any) => e.variables && e.variables._awaiting_input
  )

  if (expired.length === 0) {
    console.log('[process-timeouts] nenhum timeout expirado')
    return res.status(200).json({ success: true, processed: 0, failed: 0 })
  }

  console.log(`[process-timeouts] ${expired.length} execução(ões) com timeout expirado`)

  const results = { processed: 0, failed: 0 }

  for (const execution of expired) {
    try {
      await handleTimeout(supabase, execution, now)
      results.processed++
    } catch (err: any) {
      console.error(`[process-timeouts] erro ao processar timeout da execução ${execution.id}:`, err?.message)
      results.failed++
    }
  }

  console.log(`[process-timeouts] concluído — processados: ${results.processed}, falhas: ${results.failed}`)

  return res.status(200).json({
    success: true,
    ...results,
    total: expired.length,
  })
}

// ---------------------------------------------------------------------------
// Limpeza de retenção: apaga automation_trigger_events com mais de 60 dias
// ---------------------------------------------------------------------------

const RETENTION_DAYS = 60

async function purgeOldTriggerEvents(supabase: any): Promise<void> {
  try {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS)
    const cutoffIso = cutoff.toISOString()

    const { data: deleted, error } = await supabase
      .from('automation_trigger_events')
      .delete()
      .lt('triggered_at', cutoffIso)
      .select('id')

    if (error) {
      console.warn('[process-timeouts][retention] erro ao apagar registros antigos:', error.message)
      return
    }

    const count = deleted?.length ?? 0
    if (count > 0) {
      console.log(`[process-timeouts][retention] ${count} registro(s) de trigger_events apagado(s) (>${RETENTION_DAYS} dias)`)
    } else {
      console.log(`[process-timeouts][retention] nenhum registro expirado encontrado`)
    }
  } catch (err: any) {
    console.warn('[process-timeouts][retention] exceção inesperada:', err?.message)
  }
}

// ---------------------------------------------------------------------------
// Processar timeout de uma execução individual
// ---------------------------------------------------------------------------

async function handleTimeout(supabase: any, execution: any, now: string) {
  const executionId  = execution.id
  const nodeId       = execution.current_node_id
  const awaitingInput = execution.variables?._awaiting_input

  console.log(`[process-timeouts] processando timeout — execução: ${executionId}, nó: ${nodeId}`)

  // 2. Lock atômico: atualizar apenas se ainda estiver paused
  //    Garante que continue-execution não retomou no meio do cron
  const updatedVariables = { ...(execution.variables || {}) }
  delete updatedVariables._awaiting_input

  const { data: updated, error: updateErr } = await supabase
    .from('automation_executions')
    .update({
      status:          'completed',
      completed_at:    now,
      current_node_id: null,
      timeout_at:      null,
      paused_at:       null,
      variables:       updatedVariables,
      error_message:   'Finalizado por timeout de user_input',
    })
    .eq('id', executionId)
    .eq('status', 'paused')  // condição atômica — só atualiza se ainda estiver paused
    .select('id')
    .single()

  if (updateErr || !updated) {
    // Execução foi retomada por continue-execution antes do cron — OK, não é erro
    console.log(`[process-timeouts] execução ${executionId} não estava mais paused — skip (provavelmente retomada por continue-execution)`)
    return
  }

  // 3. Registrar log de timeout em automation_logs
  try {
    await supabase.from('automation_logs').insert({
      execution_id:  executionId,
      flow_id:       execution.flow_id,
      company_id:    execution.company_id,
      node_id:       nodeId        || null,
      node_type:     'user_input',
      action:        'timeout',
      status:        'timeout',
      input_data:    awaitingInput ? { awaiting_input: awaitingInput } : null,
      output_data: {
        timeout_at:     execution.timeout_at,
        processed_at:   now,
        variable_name:  awaitingInput?.variable_name  || null,
        question:       awaitingInput?.question        || null,
      },
      error_message: 'Execução finalizada por timeout de user_input',
      executed_at:   now,
    })
  } catch (logErr: any) {
    // Não bloquear o processo por falha de log
    console.warn(`[process-timeouts] falha ao registrar log de timeout para ${executionId}:`, logErr?.message)
  }

  console.log(`[process-timeouts] execução ${executionId} finalizada por timeout (node: ${nodeId}, timeout_at: ${execution.timeout_at})`)
}
