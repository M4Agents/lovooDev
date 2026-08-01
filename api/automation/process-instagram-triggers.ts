// =====================================================
// API: POST /api/automation/process-instagram-triggers
//
// Cron job: processa schedules do Instagram DM (entity_type = 'instagram_dm_received').
// Chamado pelo Vercel Cron a cada minuto.
//
// Fluxo por schedule:
//   1. Lock atômico: pending → processing (UPDATE condicional)
//   2. Validação: company_id, entity_id, trigger_data, conversation_id
//   3. Lease de conversa: claim_automation_conversation_lock_v1
//      - Se ocupada → adia schedule (sem retry count)
//   4. dispatchMessageReceivedTrigger → cria executions por flow
//   5. Marca schedule como processed (ou failed em erro sistêmico)
//   6. Libera lease em finally
//
// Idempotência:
//   - Schedules: índice idx_ig_dm_dedup (entity_type + entity_id + company_id)
//   - Executions: índice idx_ae_ig_execution_dedup (23505 = já criada)
//
// Retry com limite:
//   - attempt_count em trigger_data.attempt_count
//   - MAX_ATTEMPTS = 3 (erros sistêmicos)
//   - Erros permanentes → failed imediato
//   - Conversa ocupada → adia sem incrementar attempt_count
//
// Stuck recovery:
//   - Schedules processing > STUCK_THRESHOLD_MS → pending
//   - Executions Instagram running > EXEC_STUCK_THRESHOLD_MS → failed
//     (apenas se execution não tiver locked_at recente)
//
// Separação de responsabilidades:
//   - Este arquivo: lock, lease, retry, stuck
//   - dispatchMessageReceivedTrigger: avaliação de flows + executions
//   - instagramSender / executor: envio e persistência
// =====================================================

// @ts-expect-error -- módulo JS sem tipos declarados
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
// @ts-expect-error -- módulo JS sem tipos declarados
import { dispatchMessageReceivedTrigger } from '../lib/automation/dispatchMessageReceivedTrigger.js'

// ── Constantes ────────────────────────────────────────────────────────────────

const BATCH_LIMIT           = 3    // homologação: reduzido para medir tempo real por schedule (máx 18s × 3 = 54s < 60s)
const MAX_ATTEMPTS          = 3    // tentativas sistêmicas antes de marcar failed
const STUCK_THRESHOLD_MS    = 10 * 60 * 1000  // 10 min — schedule processing preso
const EXEC_STUCK_THRESHOLD_MS = 20 * 60 * 1000 // 20 min — execution running abandonada
const LEASE_DURATION_SEC    = 180  // 3 min por conversa
const POSTPONE_DELAY_SEC    = 35   // adiamento por conversa ocupada

// Backoff por attempt (segundos) — não usados para "conversa ocupada"
const BACKOFF_SECONDS: Record<number, number> = { 1: 60, 2: 120, 3: 240 }

// Erros da Meta que são permanentes (não devem ser retentados)
const PERMANENT_META_ERROR_CODES = new Set([10, 100, 131047, 190, 200, 2018001, 2018009])

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization as string | undefined
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = getSupabaseAdmin()
  const now = new Date().toISOString()

  console.log('[ig-triggers] iniciando processamento')

  // 0. Stuck recovery — schedules e executions presas
  await releaseStuckSchedules(supabase, now)
  await markAbandonedExecutionsFailed(supabase, now)

  // 1. Buscar schedules pendentes
  const { data: candidates, error: fetchErr } = await supabase
    .from('automation_schedules')
    .select('id, company_id, entity_id, entity_type, trigger_data, scheduled_for, created_at')
    .eq('status', 'pending')
    .eq('entity_type', 'instagram_dm_received')
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })
    .order('created_at',    { ascending: true })
    .limit(BATCH_LIMIT)

  if (fetchErr) {
    console.error('[ig-triggers] erro ao buscar schedules:', fetchErr.message)
    return res.status(200).json({ ok: true, error: fetchErr.message })
  }

  if (!candidates || candidates.length === 0) {
    console.log('[ig-triggers] nenhum schedule pendente')
    return res.status(200).json({ ok: true, processed: 0 })
  }

  console.log(`[ig-triggers] ${candidates.length} schedule(s) encontrado(s)`)

  const results = { processed: 0, failed: 0, postponed: 0, skipped: 0 }

  for (const candidate of candidates) {
    await processSchedule(supabase, candidate, results)
  }

  console.log('[ig-triggers] concluído:', results)
  return res.status(200).json({ ok: true, ...results })
}

// ── Processamento de um schedule ─────────────────────────────────────────────

async function processSchedule(supabase: any, candidate: any, results: any) {
  const scheduleId = candidate.id
  const companyId  = candidate.company_id
  const igMsgId    = candidate.entity_id  // ig_message_id
  const td         = candidate.trigger_data ?? {}

  // 2. Lock atômico: pending → processing
  const { data: locked, error: lockErr } = await supabase
    .from('automation_schedules')
    .update({ status: 'processing', executed_at: new Date().toISOString() })
    .eq('id', scheduleId)
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .select('id')
    .single()

  if (lockErr || !locked) {
    console.log(`[ig-triggers] schedule ${scheduleId} capturado por outro worker — skip`)
    results.skipped++
    return
  }

  // 3. Validação de campos obrigatórios
  const conversationId = td.conversation_id ?? null
  const connectionId   = td.connection_id   ?? null
  const channel        = td.channel         ?? null

  if (!companyId || !igMsgId || channel !== 'instagram' || !conversationId || !connectionId) {
    const reason = !companyId ? 'missing_company_id'
      : !igMsgId              ? 'missing_ig_message_id'
      : channel !== 'instagram' ? `unexpected_channel:${channel}`
      : !conversationId       ? 'missing_conversation_id'
      : 'missing_connection_id'

    console.error(`[ig-triggers] schedule ${scheduleId} inválido: ${reason}`)
    await markSchedule(supabase, scheduleId, 'failed',
      `validation_failed:${reason}`, td)
    results.failed++
    return
  }

  // Consistência: entity_id deve corresponder ao ig_message_id no trigger_data
  const tdIgMsgId = td.ig_message_id ?? null
  if (tdIgMsgId && tdIgMsgId !== igMsgId) {
    console.error(`[ig-triggers] schedule ${scheduleId}: entity_id=${igMsgId} diverge de trigger_data.ig_message_id=${tdIgMsgId}`)
    await markSchedule(supabase, scheduleId, 'failed',
      `ig_message_id_mismatch:entity_id=${igMsgId},td=${tdIgMsgId}`, td)
    results.failed++
    return
  }

  // 4. Tentar adquirir lease da conversa
  const { data: leaseResult, error: leaseErr } = await supabase.rpc(
    'claim_automation_conversation_lock_v1',
    {
      p_company_id:       companyId,
      p_channel:          'instagram',
      p_conversation_id:  conversationId,
      p_schedule_id:      scheduleId,
      p_duration_seconds: LEASE_DURATION_SEC,
    }
  )

  if (leaseErr) {
    console.error(`[ig-triggers] schedule ${scheduleId}: erro na RPC de lease:`, leaseErr.message)
    // Erro na RPC de lease = erro sistêmico → retry com backoff
    await handleRetry(supabase, scheduleId, td, 'lease_rpc_error:' + leaseErr.message)
    results.failed++
    return
  }

  if (!leaseResult?.acquired) {
    // Conversa ocupada por outro schedule — adiar, NÃO é falha
    console.log(`[ig-triggers] schedule ${scheduleId}: conversa ${conversationId} ocupada — adiando`)
    await postponeSchedule(supabase, scheduleId)
    results.postponed++
    return
  }

  const lockId    = leaseResult.lock_id
  let   scheduled = 'processed'
  let   errorMsg: string | null = null

  // 5. Processar dentro do contexto da lease (finally garante liberação)
  //
  // IMPORTANTE — scoping de attempt_count e updatedTriggerData:
  //   Declarados FORA do try para serem acessíveis no catch.
  //   Sem isso, o catch leria `td` (original) e o returnToPendingWithBackoff
  //   sobrescreveria o banco com attempt_count original → MAX_ATTEMPTS nunca
  //   seria atingido → retries potencialmente infinitos.
  const currentAttemptCount = (td.attempt_count ?? 0) + 1
  const updatedTriggerData  = { ...td, attempt_count: currentAttemptCount }

  try {
    // Persistir attempt_count incrementado ANTES de iniciar processamento
    await supabase
      .from('automation_schedules')
      .update({ trigger_data: updatedTriggerData })
      .eq('id', scheduleId)

    // Chamada ao dispatcher — avalia flows e cria executions
    const dispatchResult = await dispatchMessageReceivedTrigger({
      companyId,
      leadId:             td.lead_id          ?? null,
      conversationId,
      instanceId:         connectionId,  // connectionId mapeado como instanceId
      messageId:          td.message_id  ?? null,
      igMessageId:        igMsgId,
      channel:            'instagram',
      text:               td.text        ?? null,
      direction:          'inbound',
      from_agent:         false,
      sender_type:        'lead',
      origin:             'instagram',
      is_from_me:         false,
      entry_point_source: null,
      connectionId,
    })

    // Registrar resultado aggregado no trigger_data para auditoria
    const processingResult = {
      matched_flows:      dispatchResult?.matchedFlows      ?? 0,
      created_executions: dispatchResult?.createdExecutions ?? 0,
      existing_executions:dispatchResult?.existingExecutions ?? 0,
      skipped_flows:      dispatchResult?.skippedFlows      ?? 0,
      failed_flows:       dispatchResult?.failedFlows       ?? 0,
      processed_at:       new Date().toISOString(),
    }

    const finalTd = { ...updatedTriggerData, processing_result: processingResult }
    await supabase
      .from('automation_schedules')
      .update({ trigger_data: finalTd })
      .eq('id', scheduleId)

    console.log(`[ig-triggers] schedule ${scheduleId}: processado com sucesso`, processingResult)
    results.processed++

  } catch (err: any) {
    errorMsg = sanitizeError(err?.message ?? 'unknown_error')
    console.error(`[ig-triggers] schedule ${scheduleId}: erro no processamento:`, errorMsg)

    if (isPermanentError(err)) {
      scheduled = 'failed'
      results.failed++
    } else {
      // currentAttemptCount já reflete o incremento (declarado acima, fora do try)
      if (currentAttemptCount >= MAX_ATTEMPTS) {
        console.error(`[ig-triggers] schedule ${scheduleId}: max attempts atingido (${MAX_ATTEMPTS})`)
        scheduled = 'failed'
        results.failed++
      } else {
        // Erro temporário com retries disponíveis → devolver para pending com backoff
        // updatedTriggerData contém attempt_count incrementado — preservado no banco
        const backoff = BACKOFF_SECONDS[currentAttemptCount] ?? 240
        await returnToPendingWithBackoff(supabase, scheduleId, updatedTriggerData, errorMsg, backoff)
        results.failed++
        scheduled = '' // não chamar markSchedule abaixo
      }
    }

  } finally {
    // Liberar lease independentemente do resultado
    if (lockId) {
      await supabase.rpc('release_automation_conversation_lock_v1', {
        p_company_id:      companyId,
        p_channel:         'instagram',
        p_conversation_id: conversationId,
        p_lock_id:         lockId,
        p_schedule_id:     scheduleId,
      })
    }
  }

  // Marcar status final (se não foi devolvido para pending pelo retry)
  if (scheduled) {
    await markSchedule(supabase, scheduleId, scheduled, errorMsg, updatedTriggerData)
  }
}

// ── Utilitários de estado ─────────────────────────────────────────────────────

async function markSchedule(
  supabase:     any,
  scheduleId:   string,
  status:       string,
  errorMessage: string | null,
  existingTd:   Record<string, any> | null = null,
) {
  try {
    let triggerDataUpdate: Record<string, any> | undefined
    if (errorMessage && existingTd !== null) {
      triggerDataUpdate = { ...existingTd, error_message: errorMessage }
    }

    await supabase
      .from('automation_schedules')
      .update({
        status,
        executed_at: new Date().toISOString(),
        ...(triggerDataUpdate !== undefined ? { trigger_data: triggerDataUpdate } : {}),
      })
      .eq('id', scheduleId)
  } catch (err: any) {
    console.error(`[ig-triggers] falha ao marcar schedule ${scheduleId} como ${status}:`, err?.message)
  }
}

// Adia schedule por conversa ocupada — NÃO incrementa attempt_count, NÃO registra erro
async function postponeSchedule(supabase: any, scheduleId: string) {
  try {
    const newScheduledFor = new Date(Date.now() + POSTPONE_DELAY_SEC * 1000).toISOString()
    await supabase
      .from('automation_schedules')
      .update({
        status:        'pending',
        executed_at:   null,
        scheduled_for: newScheduledFor,
        // trigger_data NÃO alterado
      })
      .eq('id', scheduleId)
  } catch (err: any) {
    console.error(`[ig-triggers] falha ao adiar schedule ${scheduleId}:`, err?.message)
  }
}

// Devolve para pending com backoff (erro temporário com retry disponível)
async function returnToPendingWithBackoff(
  supabase:     any,
  scheduleId:   string,
  existingTd:   Record<string, any>,
  errorMsg:     string,
  backoffSec:   number,
) {
  try {
    const newScheduledFor = new Date(Date.now() + backoffSec * 1000).toISOString()
    const updatedTd = { ...existingTd, last_error: errorMsg, last_retry_at: new Date().toISOString() }
    await supabase
      .from('automation_schedules')
      .update({
        status:        'pending',
        executed_at:   null,
        scheduled_for: newScheduledFor,
        trigger_data:  updatedTd,
      })
      .eq('id', scheduleId)
  } catch (err: any) {
    console.error(`[ig-triggers] falha ao devolver schedule ${scheduleId} para pending:`, err?.message)
  }
}

async function handleRetry(
  supabase:   any,
  scheduleId: string,
  td:         Record<string, any>,
  errorMsg:   string,
) {
  const attemptCount = td.attempt_count ?? 0
  if (attemptCount >= MAX_ATTEMPTS) {
    await markSchedule(supabase, scheduleId, 'failed', errorMsg, td)
  } else {
    const backoff = BACKOFF_SECONDS[attemptCount + 1] ?? 240
    await returnToPendingWithBackoff(supabase, scheduleId, td, errorMsg, backoff)
  }
}

// ── Stuck recovery ────────────────────────────────────────────────────────────

// Schedules presos em 'processing' por mais de STUCK_THRESHOLD_MS
async function releaseStuckSchedules(supabase: any, now: string) {
  try {
    const stuckBefore = new Date(new Date(now).getTime() - STUCK_THRESHOLD_MS).toISOString()

    const { data: stuck, error } = await supabase
      .from('automation_schedules')
      .update({ status: 'pending', executed_at: null })
      .eq('status', 'processing')
      .eq('entity_type', 'instagram_dm_received')
      .not('executed_at', 'is', null)
      .lte('executed_at', stuckBefore)
      .select('id')

    if (error) {
      console.warn('[ig-triggers] cleanup: erro ao liberar schedules presos:', error.message)
      return
    }

    if (stuck && stuck.length > 0) {
      const ids = stuck.map((s: any) => s.id).join(', ')
      console.warn(`[ig-triggers] cleanup: ${stuck.length} schedule(s) preso(s) liberado(s): ${ids}`)
    }
  } catch (err: any) {
    console.warn('[ig-triggers] cleanup: exceção ao liberar schedules:', err?.message)
  }
}

// Executions Instagram em 'running' por mais de EXEC_STUCK_THRESHOLD_MS,
// sem lock ativo recente — considera abandono e marca como failed.
// Não toca executions com locked_at recente (processamento ativo).
// Não toca executions com status 'paused'.
async function markAbandonedExecutionsFailed(supabase: any, now: string) {
  try {
    const stuckBefore   = new Date(new Date(now).getTime() - EXEC_STUCK_THRESHOLD_MS).toISOString()
    const lockThreshold = new Date(new Date(now).getTime() - (STUCK_THRESHOLD_MS)).toISOString()

    const { data: stuck, error } = await supabase
      .from('automation_executions')
      .update({
        status:        'failed',
        error_message: 'ig_triggers_stuck_recovery: execution running abandonada',
        completed_at:  now,
      })
      .eq('status', 'running')
      .eq('trigger_data->>channel', 'instagram')
      .lte('started_at', stuckBefore)
      .or(`locked_at.is.null,locked_at.lte.${lockThreshold}`)
      .select('id, flow_id, company_id')

    if (error) {
      console.warn('[ig-triggers] exec-cleanup: erro:', error.message)
      return
    }

    if (stuck && stuck.length > 0) {
      console.warn(`[ig-triggers] exec-cleanup: ${stuck.length} execution(s) abandonada(s) marcada(s) como failed`)
    }
  } catch (err: any) {
    console.warn('[ig-triggers] exec-cleanup: exceção:', err?.message)
  }
}

// ── Helpers de classificação de erros ────────────────────────────────────────

function isPermanentError(err: any): boolean {
  const msg = err?.message?.toLowerCase() ?? ''

  // Erros explicitamente permanentes
  if (msg.includes('token') && (msg.includes('expired') || msg.includes('invalid'))) return true
  if (msg.includes('24h') || msg.includes('24 hour') || msg.includes('messaging_window')) return true
  if (msg.includes('connection_inactive') || msg.includes('connection not found')) return true
  if (msg.includes('conversation not found') || msg.includes('company_id mismatch')) return true
  if (msg.includes('tenant_violation')) return true
  if (msg.includes('flow disabled') || msg.includes('flow not found')) return true

  // Códigos de erro Meta permanentes
  const metaCode = err?.metaErrorCode ?? err?.code
  if (metaCode && PERMANENT_META_ERROR_CODES.has(Number(metaCode))) return true

  return false
}

// Remove dados sensíveis do erro antes de persistir
function sanitizeError(msg: string): string {
  return msg
    .substring(0, 500)
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/access_token=[^\s&"]+/gi, 'access_token=[REDACTED]')
    .replace(/token[=:]\s*[^\s,}"]+/gi, 'token=[REDACTED]')
}
