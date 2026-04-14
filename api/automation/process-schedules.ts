// =====================================================
// API: POST /api/automation/process-schedules
//
// Cron job: retoma execuções pausadas por nó `delay`.
// Chamado pelo Vercel Cron (ou manualmente com CRON_SECRET).
//
// Sem imports de src/ — usa apenas api/lib/automation/.
//
// Lock atômico por schedule: UPDATE ... WHERE status='pending'
// RETURNING * — apenas quem atualiza recebe o registro.
// Garante que dois Lambdas simultâneos não processem o mesmo item.
// =====================================================

// @ts-ignore — arquivo JS ESM em api/lib/automation
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
// @ts-ignore — arquivo JS ESM em api/lib/automation
import { resumeFromNode } from '../lib/automation/executor.js'

const BATCH_LIMIT = 20        // máximo de schedules por invocação do cron
const STUCK_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutos — define "processing preso"

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Validar segredo do cron
  const authHeader = req.headers.authorization as string | undefined
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = getSupabaseAdmin()

  console.log('[process-schedules] iniciando processamento de schedules pendentes')

  const now = new Date().toISOString()

  // 0. Cleanup: liberar schedules presos em 'processing'
  //    Critério: status='processing' + executed_at <= (agora - 10 min)
  //    Causa: Lambda caiu após pegar o lock mas antes de marcar processed/failed.
  //    Ação segura: voltar para 'pending' para que a próxima invocação reprocesse.
  await releaseStuckSchedules(supabase, now)

  // 1. Buscar schedules pendentes com scheduled_for já passado
  const { data: candidates, error: fetchErr } = await supabase
    .from('automation_schedules')
    .select('id, execution_id, flow_id, company_id, entity_id, entity_type, trigger_data')
    .eq('status', 'pending')
    .eq('entity_type', 'delay_resume')
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })
    .limit(BATCH_LIMIT)

  if (fetchErr) {
    console.error('[process-schedules] erro ao buscar schedules:', fetchErr.message)
    return res.status(500).json({ error: 'Erro ao buscar schedules', detail: fetchErr.message })
  }

  if (!candidates || candidates.length === 0) {
    console.log('[process-schedules] nenhum schedule pendente')
    return res.status(200).json({ success: true, processed: 0, failed: 0, skipped: 0 })
  }

  console.log(`[process-schedules] ${candidates.length} schedule(s) candidato(s)`)

  const results = { processed: 0, failed: 0, skipped: 0 }

  for (const candidate of candidates) {
    const scheduleId  = candidate.id
    const executionId = candidate.execution_id
    const flowId      = candidate.flow_id
    const delayNodeId = candidate.entity_id // nó delay que gerou este schedule

    // 2. Lock atômico: tentar marcar como 'processing' APENAS se ainda estiver 'pending'
    //    Se dois Lambdas tentarem ao mesmo tempo, apenas um receberá dados no RETURNING.
    const { data: locked, error: lockErr } = await supabase
      .from('automation_schedules')
      .update({ status: 'processing', executed_at: new Date().toISOString() })
      .eq('id', scheduleId)
      .eq('status', 'pending') // condição atômica — só atualiza se ainda pending
      .select('id')
      .single()

    if (lockErr || !locked) {
      console.log(`[process-schedules] schedule ${scheduleId} já foi capturado por outro processo — skip`)
      results.skipped++
      continue
    }

    console.log(`[process-schedules] processando schedule ${scheduleId} (execution: ${executionId})`)

    try {
      // 3. Buscar execution
      const { data: execution, error: execErr } = await supabase
        .from('automation_executions')
        .select('id, flow_id, company_id, status, lead_id, opportunity_id, trigger_data, variables, executed_nodes')
        .eq('id', executionId)
        .single()

      if (execErr || !execution) {
        throw new Error(`Execução ${executionId} não encontrada`)
      }

      if (execution.status !== 'paused') {
        console.warn(`[process-schedules] execução ${executionId} não está pausada (status: ${execution.status}) — skip`)
        await markSchedule(supabase, scheduleId, 'processed', null)
        results.skipped++
        continue
      }

      // 4. Buscar flow
      const { data: flow, error: flowErr } = await supabase
        .from('automation_flows')
        .select('id, nodes, edges, company_id')
        .eq('id', flowId)
        .single()

      if (flowErr || !flow) {
        throw new Error(`Flow ${flowId} não encontrado`)
      }

      // 5. Validar que o nó delay ainda existe (flow pode ter sido editado)
      const allNodes = flow.nodes || []
      const delayNode = allNodes.find((n: any) => n.id === delayNodeId)
      if (!delayNode) {
        throw new Error(`Nó delay "${delayNodeId}" não encontrado no flow — flow foi editado após o pause`)
      }

      // 6. Retomar execução a partir do nó delay
      await resumeFromNode(execution, flow, delayNodeId, supabase)

      // 7. Marcar schedule como processado
      await markSchedule(supabase, scheduleId, 'processed', null)

      console.log(`[process-schedules] schedule ${scheduleId} processado com sucesso`)
      results.processed++
    } catch (err: any) {
      console.error(`[process-schedules] erro no schedule ${scheduleId}:`, err?.message)
      await markSchedule(supabase, scheduleId, 'failed', err?.message)
      results.failed++
    }
  }

  console.log(`[process-schedules] concluído — processados: ${results.processed}, falhas: ${results.failed}, skipped: ${results.skipped}`)

  return res.status(200).json({
    success: true,
    ...results,
    total: candidates.length,
  })
}

// ---------------------------------------------------------------------------
// Cleanup: liberar schedules presos em 'processing'
// ---------------------------------------------------------------------------

async function releaseStuckSchedules(supabase: any, now: string) {
  try {
    // Threshold: schedules marcados como 'processing' há mais de STUCK_THRESHOLD_MS
    const stuckBefore = new Date(new Date(now).getTime() - STUCK_THRESHOLD_MS).toISOString()

    const { data: stuck, error } = await supabase
      .from('automation_schedules')
      .update({ status: 'pending', executed_at: null })
      .eq('status', 'processing')
      .not('executed_at', 'is', null)
      .lte('executed_at', stuckBefore)
      .select('id')

    if (error) {
      console.warn('[process-schedules] cleanup: erro ao liberar schedules presos:', error.message)
      return
    }

    const count = stuck?.length ?? 0
    if (count > 0) {
      const ids = (stuck as any[]).map((s: any) => s.id).join(', ')
      console.warn(`[process-schedules] cleanup: ${count} schedule(s) preso(s) liberado(s) de volta para pending — ids: ${ids}`)
    } else {
      console.log('[process-schedules] cleanup: nenhum schedule preso encontrado')
    }
  } catch (err: any) {
    // Não bloquear o processamento principal por falha no cleanup
    console.warn('[process-schedules] cleanup: exceção inesperada:', err?.message)
  }
}

// ---------------------------------------------------------------------------
// Utilitário: atualizar status de um schedule
// ---------------------------------------------------------------------------

async function markSchedule(supabase: any, scheduleId: string, status: string, errorMessage: string | null) {
  try {
    await supabase
      .from('automation_schedules')
      .update({
        status,
        executed_at: new Date().toISOString(),
        ...(errorMessage ? { trigger_data: { error_message: errorMessage } } : {}),
      })
      .eq('id', scheduleId)
  } catch (err: any) {
    console.error(`[process-schedules] falha ao atualizar status do schedule ${scheduleId}:`, err?.message)
  }
}
