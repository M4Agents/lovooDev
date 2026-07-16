// =====================================================
// API: POST /api/automation/process-schedules
//
// Cron job: retoma execuções pausadas por nó `delay`.
// Chamado pelo Vercel Cron (ou manualmente com CRON_SECRET).
//
// Sem imports de src/ — usa apenas api/lib/automation/.
//
// Lock atômico por schedule: UPDATE ... WHERE status='pending' AND company_id=...
// RETURNING * — apenas quem atualiza recebe o registro.
//
// entity_type suportados:
//   delay_resume           — delay simples (legado)
//   delay_response_timeout — delay com espera por resposta do lead
// =====================================================

// @ts-ignore — arquivo JS ESM em api/lib/automation
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
// @ts-ignore — arquivo JS ESM em api/lib/automation
import { resumeFromNode, resumeClaimedExecution } from '../lib/automation/executor.js'

const BATCH_LIMIT         = 20
const STUCK_THRESHOLD_MS  = 10 * 60 * 1000   // 10 minutos — define "processing preso"

// Limite total de re-entradas de schedule pós-claim por lock indisponível.
//
// Cada vez que o cron devolver o schedule para 'pending' por lock,
// incrementa post_claim.lock_retry_count em trigger_data.
// Ao atingir o limite, o schedule é marcado como 'failed' com log crítico.
//
// Justificativa: 3 re-entradas com TTL do lock de 10min oferecem ~30min de
// janela de recuperação antes de desistir. A execução pode ainda estar
// 'running' — requer monitoramento ou intervenção manual após este ponto.
const MAX_LOCK_RETRY_TOTAL = 3

// Estrutura do estado pós-claim persistido em trigger_data.post_claim.
// NÃO inclui: variables, response, dados pessoais, marker completo.
// Para timeout: marker não é necessário (response_variable não é usada).
interface PostClaimState {
  paused_node_id:   string
  resume_reason:    string
  awaiting_type:    string
  claimed_at:       string
  lock_retry_count: number
}

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

  // 0. Cleanup: liberar schedules presos em 'processing'.
  //    Critério: status='processing' + executed_at <= (agora - STUCK_THRESHOLD_MS).
  //    trigger_data é PRESERVADO — permite que re-entrada detecte post_claim.
  await releaseStuckSchedules(supabase, now)

  // 1. Buscar schedules pendentes — ambos os entity_types
  const { data: candidates, error: fetchErr } = await supabase
    .from('automation_schedules')
    .select('id, execution_id, flow_id, company_id, entity_id, entity_type, trigger_data, scheduled_for')
    .eq('status', 'pending')
    .in('entity_type', ['delay_resume', 'delay_response_timeout'])
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
    const entityType  = candidate.entity_type
    const companyId   = candidate.company_id

    // 2. Lock atômico: pending → processing com filtro de company_id (defesa em profundidade).
    //    Zero linhas retornadas: outro worker venceu → skip sem processar.
    const { data: locked, error: lockErr } = await supabase
      .from('automation_schedules')
      .update({ status: 'processing', executed_at: new Date().toISOString() })
      .eq('id', scheduleId)
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .select('id')
      .single()

    if (lockErr || !locked) {
      console.log(`[process-schedules] schedule ${scheduleId} já foi capturado por outro processo — skip`)
      results.skipped++
      continue
    }

    console.log(`[process-schedules] processando schedule ${scheduleId} (execution: ${executionId}, type: ${entityType})`)

    try {
      let outcome: { skipped: boolean }

      if (entityType === 'delay_resume') {
        outcome = await processDelayResumeSchedule(candidate, supabase)
      } else if (entityType === 'delay_response_timeout') {
        outcome = await processDelayResponseTimeoutSchedule(candidate, supabase)
      } else {
        throw new Error(`entity_type não suportado: ${entityType}`)
      }

      if (outcome.skipped) {
        results.skipped++
      } else {
        results.processed++
      }
    } catch (err: any) {
      console.error(`[process-schedules] erro no schedule ${scheduleId} (${entityType}):`, err?.message)
      // Merge seguro: preservar trigger_data existente ao registrar o erro.
      await markSchedule(supabase, scheduleId, 'failed', err?.message, candidate.trigger_data ?? null)
      results.failed++
    }
  }

  console.log(
    `[process-schedules] concluído — processados: ${results.processed}, ` +
    `falhas: ${results.failed}, skipped: ${results.skipped}`
  )

  return res.status(200).json({
    success: true,
    ...results,
    total: candidates.length,
  })
}

// ---------------------------------------------------------------------------
// Rotina legada: delay_resume
//
// CORRIGIDO: agora inclui company_id nas buscas de execution e flow
// (defesa em profundidade — não altera comportamento funcional correto).
// Antes: buscava execution apenas por execution_id (sem isolamento tenant).
// ---------------------------------------------------------------------------

export async function processDelayResumeSchedule(
  schedule: any,
  supabase: any,
): Promise<{ skipped: boolean }> {
  const scheduleId  = schedule.id
  const executionId = schedule.execution_id
  const flowId      = schedule.flow_id
  const delayNodeId = schedule.entity_id
  const companyId   = schedule.company_id

  // Carregar execution COM isolamento por company_id
  const { data: execution, error: execErr } = await supabase
    .from('automation_executions')
    .select('id, flow_id, company_id, status, lead_id, opportunity_id, trigger_data, variables, executed_nodes')
    .eq('id', executionId)
    .eq('company_id', companyId)
    .single()

  if (execErr || !execution) {
    throw new Error(`Execução ${executionId} não encontrada para company ${companyId}`)
  }

  if (execution.status !== 'paused') {
    console.warn(
      `[process-schedules] execução ${executionId} não está pausada ` +
      `(status: ${execution.status}) — skip`
    )
    await markSchedule(supabase, scheduleId, 'processed', null)
    return { skipped: true }
  }

  // Carregar flow COM isolamento por company_id
  const { data: flow, error: flowErr } = await supabase
    .from('automation_flows')
    .select('id, nodes, edges, company_id')
    .eq('id', flowId)
    .eq('company_id', companyId)
    .single()

  if (flowErr || !flow) {
    throw new Error(`Flow ${flowId} não encontrado para company ${companyId}`)
  }

  // Validar que o nó delay ainda existe (flow pode ter sido editado)
  const allNodes = flow.nodes || []
  const delayNode = allNodes.find((n: any) => n.id === delayNodeId)
  if (!delayNode) {
    throw new Error(`Nó delay "${delayNodeId}" não encontrado no flow — flow foi editado após o pause`)
  }

  // Retomar execução (caminho legado)
  await resumeFromNode(execution, flow, delayNodeId, supabase)

  await markSchedule(supabase, scheduleId, 'processed', null)
  console.log(`[process-schedules] schedule ${scheduleId} (delay_resume) processado com sucesso`)

  return { skipped: false }
}

// ---------------------------------------------------------------------------
// Rotina nova: delay_response_timeout
//
// Dois estados possíveis detectados via trigger_data.post_claim:
//
//   Estado A — sem post_claim: primeiro processamento.
//     Ordem obrigatória: Claim RPC → persistir post_claim → resumeClaimedExecution
//
//   Estado B — post_claim presente: re-entrada (cron anterior falhou por lock).
//     Ordem: skip Claim RPC → re-carregar execution → resumeClaimedExecution
//
// Recovery de queda abrupta da Function:
//   Se a Function cair após o claim e antes do resume, o schedule fica em
//   'processing'. O releaseStuckSchedules devolve para 'pending' após 10min,
//   preservando trigger_data. Na próxima invocação, post_claim sinaliza Estado B.
//
// Janela residual documentada:
//   Existe uma janela entre Claim RPC e persistPostClaimState onde uma queda
//   da Function resulta em um schedule sem post_claim mas com execução 'running'.
//   Nesse caso, a re-entrada fará nova Claim RPC que retornará claimed=false
//   (execução já está running), e o schedule será marcado processed (stale).
//   A execução permanece em 'running' — exige intervenção manual ou monitoramento.
//   Para minimizar essa janela, persistPostClaimState é chamado ANTES do resume.
// ---------------------------------------------------------------------------

export async function processDelayResponseTimeoutSchedule(
  schedule: any,
  supabase: any,
): Promise<{ skipped: boolean }> {
  const scheduleId         = schedule.id
  const executionId        = schedule.execution_id
  const flowId             = schedule.flow_id
  const nodeId             = schedule.entity_id
  const companyId          = schedule.company_id
  const existingTriggerData: Record<string, any> = schedule.trigger_data ?? {}
  const postClaim: PostClaimState | null = existingTriggerData.post_claim ?? null

  // ───── Estado B: re-entrada pós-claim ─────
  if (postClaim !== null) {
    return handlePostClaimReentry({ schedule, existingTriggerData, postClaim, supabase })
  }

  // ───── Estado A: primeiro processamento ─────

  console.log(
    `[process-schedules] [timeout] iniciando — ` +
    `schedule: ${scheduleId}, execution: ${executionId}, node: ${nodeId}, company: ${companyId}`
  )

  // 1. Carregar execution e flow (ambos com isolamento por company_id)
  const { data: execution, error: execErr } = await supabase
    .from('automation_executions')
    .select('id, flow_id, company_id, status, lead_id, opportunity_id, trigger_data, variables')
    .eq('id', executionId)
    .eq('company_id', companyId)
    .single()

  if (execErr || !execution) {
    throw new Error(`Execução ${executionId} não encontrada para company ${companyId}`)
  }

  const resolvedFlowId = flowId || execution.flow_id
  const { data: flow, error: flowErr } = await supabase
    .from('automation_flows')
    .select('id, nodes, edges, company_id')
    .eq('id', resolvedFlowId)
    .eq('company_id', companyId)
    .single()

  if (flowErr || !flow) {
    throw new Error(`Flow ${resolvedFlowId} não encontrado para company ${companyId}`)
  }

  // 2. Claim atômico (execution + post_claim) em uma única transação.
  //
  //    claim_delay_response_timeout_v1 executa atomicamente:
  //      a) execution: paused → running, marcador removido, campos de pausa limpos
  //      b) schedule:  trigger_data.post_claim persistido (lock_retry_count=0)
  //
  //    A janela irrecuperável anterior (claim_paused_execution_v1 → persistPostClaimState)
  //    foi eliminada: após commit, post_claim está garantido no schedule.
  //    Se a Function cair após o commit, releaseStuckSchedules retorna o
  //    schedule (processing) para pending com post_claim intacto → Estado B.
  const { data: claimResult, error: claimErr } = await supabase.rpc(
    'claim_delay_response_timeout_v1',
    {
      p_company_id:     companyId,
      p_schedule_id:    scheduleId,
      p_execution_id:   executionId,
      p_paused_node_id: nodeId,
    },
  )

  if (claimErr) {
    // Erro SQL real — não é stale. Não chamar executor.
    console.error(
      `[process-schedules] [timeout] erro SQL na Claim RPC — ` +
      `schedule: ${scheduleId}, execution: ${executionId}: ${claimErr.message}`
    )
    throw new Error(`Claim RPC erro SQL: ${claimErr.message}`)
  }

  if (!claimResult?.claimed) {
    // Stale ou corrida perdida — finalização operacional normal.
    const reason = claimResult?.reason ?? 'already_claimed_or_stale'
    console.log(
      `[process-schedules] [timeout] claim não realizado (stale) — ` +
      `schedule: ${scheduleId}, execution: ${executionId}, reason: ${reason}`
    )
    await markSchedule(supabase, scheduleId, 'processed', null)
    return { skipped: true }
  }

  // 3. claimed=true — post_claim JÁ está no schedule (garantido pela RPC atomicamente).
  //    NÃO é necessário persistPostClaimState separadamente.
  console.log(
    `[process-schedules] [timeout] claim realizado atomicamente (execution + post_claim) — ` +
    `schedule: ${scheduleId}, execution: ${executionId}, claimed_at: ${claimResult.claimed_at}`
  )

  // 4. Tentar resume com dados pós-claim retornados pela RPC
  const claimedExecution = claimResult.execution
  const claimedMarker    = claimResult.marker ?? null
  const claimedPostClaim = claimResult.post_claim as PostClaimState

  try {
    await resumeClaimedExecution({
      execution:    claimedExecution,
      flow,
      pausedNodeId: nodeId,
      supabase,
      userResponse:  undefined,
      resumeReason:  'timeout',
      awaitingType:  'delay_response',
      scheduleId,
      claimedMarker,
    })

    await markSchedule(supabase, scheduleId, 'processed', null)
    console.log(`[process-schedules] [timeout] schedule ${scheduleId} processado com sucesso`)
    return { skipped: false }

  } catch (resumeErr: any) {
    if (isPostClaimLockError(resumeErr)) {
      // Lock indisponível — retornar para pending com contador incrementado.
      // post_claim já está no schedule (via RPC). Apenas atualizar lock_retry_count.
      const updatedPostClaim: PostClaimState = { ...claimedPostClaim, lock_retry_count: 1 }
      const updatedTriggerData = { ...existingTriggerData, post_claim: updatedPostClaim }
      await returnScheduleToPending(supabase, scheduleId, updatedTriggerData)
      console.warn(
        `[process-schedules] [timeout] lock indisponível — schedule ${scheduleId} ` +
        `devolvido para pending (retry 1/${MAX_LOCK_RETRY_TOTAL})`
      )
      return { skipped: true }
    }

    // Erro real em processNode — propagar para o main loop marcar como failed.
    throw resumeErr
  }
}

// ---------------------------------------------------------------------------
// Handler de re-entrada pós-claim (Estado B).
//
// Chamado quando trigger_data.post_claim está presente.
// Suporta resume_reason = 'timeout' e 'lead_response'.
//
// NÃO chama nenhuma Claim RPC — execução já foi claimed.
// Re-carrega execution do banco para estado atual (pós-claim).
//
// Guard obrigatório de status (lead_response e timeout):
//   Antes de chamar resumeClaimedExecution, verifica execution.status.
//   Se status != 'running':
//     - Webhook concluiu o executor mas caiu antes de marcar schedule processed
//     - Execução completou ou falhou de forma independente
//     - Apenas finalizar schedule (processed), sem executar novamente.
//
//   Cobre o cenário:
//     webhook concluiu → schedule permanece processing → TTL → pending
//     → cron re-entra → execution.status=completed → skip + processed
//
// Para lead_response:
//   variables[response_variable] já foi salva atomicamente pela RPC.
//   Não é necessário recuperar a resposta da mensagem.
//   claimedMarker=null evita novo salvamento de response_variable.
// ---------------------------------------------------------------------------

async function handlePostClaimReentry({
  schedule,
  existingTriggerData,
  postClaim,
  supabase,
}: {
  schedule:            any
  existingTriggerData: Record<string, any>
  postClaim:           PostClaimState
  supabase:            any
}): Promise<{ skipped: boolean }> {
  const scheduleId   = schedule.id
  const executionId  = schedule.execution_id
  const flowId       = schedule.flow_id
  const companyId    = schedule.company_id
  const nodeId       = postClaim.paused_node_id
  const retryCount   = postClaim.lock_retry_count ?? 0
  const resumeReason = postClaim.resume_reason    // 'timeout' | 'lead_response'
  const logTag       = resumeReason === 'lead_response' ? '[lead_response]' : '[timeout]'

  console.log(
    `[process-schedules] ${logTag} re-entrada pós-claim — ` +
    `schedule: ${scheduleId}, execution: ${executionId}, ` +
    `resume_reason: ${resumeReason}, retry: ${retryCount}/${MAX_LOCK_RETRY_TOTAL}`
  )

  // Verificar limite de re-entradas por lock
  if (retryCount >= MAX_LOCK_RETRY_TOTAL) {
    console.error(
      `[CRÍTICO][process-schedules] limite de retries pós-claim atingido — ` +
      `schedule: ${scheduleId}, execution: ${executionId}, ` +
      `company: ${companyId}, node: ${nodeId}, ` +
      `resume_reason: ${resumeReason}, retry_count: ${retryCount}`
    )
    throw new Error(
      `Limite de retries pós-claim atingido (${MAX_LOCK_RETRY_TOTAL}) — ` +
      `schedule: ${scheduleId}, execution: ${executionId}`
    )
  }

  // Re-carregar execution atualizado (com isolamento por company_id)
  const { data: execution, error: execErr } = await supabase
    .from('automation_executions')
    .select('id, flow_id, company_id, status, lead_id, opportunity_id, trigger_data, variables')
    .eq('id', executionId)
    .eq('company_id', companyId)
    .single()

  if (execErr || !execution) {
    throw new Error(`Execução ${executionId} não encontrada na re-entrada para company ${companyId}`)
  }

  // ── Guard obrigatório de status ──────────────────────────────────────────
  // Se execution.status != 'running', o flow já foi concluído ou falhou
  // por outro processo (geralmente: webhook executou o flow mas caiu antes
  // de marcar o schedule como processed).
  // Ação: apenas finalizar o schedule sem executar novamente.
  if (execution.status !== 'running') {
    console.log(
      `[process-schedules] ${logTag} execution status=${execution.status} na re-entrada — ` +
      `flow já concluído, apenas finalizando schedule — ` +
      `schedule: ${scheduleId}, execution: ${executionId}`
    )
    await markSchedule(supabase, scheduleId, 'processed', null)
    return { skipped: true }
  }

  const resolvedFlowId = flowId || execution.flow_id
  const { data: flow, error: flowErr } = await supabase
    .from('automation_flows')
    .select('id, nodes, edges, company_id')
    .eq('id', resolvedFlowId)
    .eq('company_id', companyId)
    .single()

  if (flowErr || !flow) {
    throw new Error(`Flow ${resolvedFlowId} não encontrado na re-entrada para company ${companyId}`)
  }

  // Tentar resume sem Claim RPC
  //
  // claimedMarker=null — evita segundo salvamento de response_variable
  //   (para lead_response: já salva atomicamente pela RPC;
  //    para timeout:       response_variable não é usada)
  //
  // userResponse=undefined — response_variable já está em execution.variables
  //   (para lead_response: salva pela RPC durante o claim;
  //    para timeout:       sem resposta do lead para salvar)
  try {
    await resumeClaimedExecution({
      execution,
      flow,
      pausedNodeId:  nodeId,
      supabase,
      userResponse:  undefined,
      resumeReason,
      awaitingType:  postClaim.awaiting_type,
      scheduleId,
      claimedMarker: null,
    })

    await markSchedule(supabase, scheduleId, 'processed', null)
    console.log(
      `[process-schedules] ${logTag} re-entrada bem-sucedida — ` +
      `schedule: ${scheduleId} (retry: ${retryCount})`
    )
    return { skipped: false }

  } catch (resumeErr: any) {
    if (isPostClaimLockError(resumeErr)) {
      const nextCount      = retryCount + 1
      const hasMoreRetries = nextCount < MAX_LOCK_RETRY_TOTAL

      if (hasMoreRetries) {
        const updatedPostClaim: PostClaimState = { ...postClaim, lock_retry_count: nextCount }
        const updatedTriggerData = { ...existingTriggerData, post_claim: updatedPostClaim }
        await returnScheduleToPending(supabase, scheduleId, updatedTriggerData)
        console.warn(
          `[process-schedules] ${logTag} lock indisponível na re-entrada — ` +
          `schedule ${scheduleId} devolvido para pending ` +
          `(retry ${nextCount}/${MAX_LOCK_RETRY_TOTAL})`
        )
        return { skipped: true }
      }

      // Último retry esgotado por lock — propagar para main loop marcar failed
      throw resumeErr
    }

    // Erro de processNode — propagar para main loop marcar failed
    throw resumeErr
  }
}

// ---------------------------------------------------------------------------
// Cleanup: liberar schedules presos em 'processing'
//
// IMPORTANTE: a atualização NÃO toca trigger_data — preserva post_claim
// persistido, garantindo que a re-entrada (Estado B) funcione corretamente.
// ---------------------------------------------------------------------------

async function releaseStuckSchedules(supabase: any, now: string) {
  try {
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
      console.warn(`[process-schedules] cleanup: ${count} schedule(s) preso(s) liberado(s) para pending — ids: ${ids}`)
    } else {
      console.log('[process-schedules] cleanup: nenhum schedule preso encontrado')
    }
  } catch (err: any) {
    console.warn('[process-schedules] cleanup: exceção inesperada:', err?.message)
  }
}

// ---------------------------------------------------------------------------
// Utilitário: atualizar status de um schedule
//
// @param existingTriggerData — se fornecido, mescla com error_message ao invés
//   de substituir o JSON inteiro. Preserva campos como delay_config e post_claim.
//   Quando null (legado), comportamento original: substitui inteiro se houver erro.
// ---------------------------------------------------------------------------

async function markSchedule(
  supabase:            any,
  scheduleId:          string,
  status:              string,
  errorMessage:        string | null,
  existingTriggerData: Record<string, any> | null = null,
) {
  try {
    let triggerDataUpdate: Record<string, any> | undefined

    if (errorMessage) {
      if (existingTriggerData !== null) {
        // Merge seguro: preserva campos existentes e adiciona error_message
        triggerDataUpdate = { ...existingTriggerData, error_message: errorMessage }
      } else {
        // Comportamento legado: substitui inteiro (mantém compatibilidade)
        triggerDataUpdate = { error_message: errorMessage }
      }
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
    console.error(`[process-schedules] falha ao atualizar status do schedule ${scheduleId}:`, err?.message)
  }
}

// ---------------------------------------------------------------------------
// Utilitário: devolver schedule para 'pending' com trigger_data atualizado
// Usado quando lock impede o resume e há retries disponíveis.
// executed_at: null é consistente com releaseStuckSchedules.
// ---------------------------------------------------------------------------

async function returnScheduleToPending(
  supabase:    any,
  scheduleId:  string,
  triggerData: Record<string, any>,
) {
  try {
    const { error } = await supabase
      .from('automation_schedules')
      .update({
        status:      'pending',
        executed_at: null,
        trigger_data: triggerData,
      })
      .eq('id', scheduleId)

    if (error) {
      console.error(
        `[process-schedules] falha ao devolver schedule ${scheduleId} para pending:`,
        error.message
      )
    }
  } catch (err: any) {
    console.error(
      `[process-schedules] exceção ao devolver schedule ${scheduleId} para pending:`,
      err?.message
    )
  }
}

// ---------------------------------------------------------------------------
// Helper: verificar se erro é POST_CLAIM_LOCK_UNAVAILABLE
// ---------------------------------------------------------------------------

function isPostClaimLockError(err: any): boolean {
  return (
    typeof err?.message === 'string' &&
    err.message.includes('POST_CLAIM_LOCK_UNAVAILABLE')
  )
}
