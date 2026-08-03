// =============================================================================
// api/cron/process-agent-schedules.js
//
// Cron: Processar schedules de follow-up de agentes IA.
// Execução: a cada minuto (vercel.json: "* * * * *")
//
// RESPONSABILIDADE:
//   1. Recuperar schedules presos em 'processing' (stale recovery, 10 min).
//   2. Claim atômico via RPC FOR UPDATE SKIP LOCKED (retorna processing_token).
//   3. Para cada schedule: validar ownership + invocar pipeline LLM + enviar.
//   4. Finalizar atomicamente: sent (+ próxima tentativa) | retry | cancel.
//
// CONCORRÊNCIA — GARANTIAS:
//   - Cada schedule recebe processing_token exclusivo no claim (gen_random_uuid()).
//   - Ownership verificado antes do LLM e antes do sendBlocks.
//   - finalize_followup_schedule exige processing_token + usa FOR UPDATE.
//   - Stale recovery com 10 min (> Vercel Pro 300s) + limpa processing_token.
//   - Worker tardio com token antigo não consegue finalizar nem enviar.
//
// VALIDAÇÕES DE NEGÓCIO:
//   - assignment_changed: conversa mudou de assignment → cancela sem consumir tentativa.
//   - agent_mismatch: agent_id do schedule diverge do assignment atual → cancela.
//   - lead_responded: last_inbound_at > snapshot → cancela.
//   - max_attempts: limite atingido → cancela.
//
// PIPELINE PROATIVO (sem inbound real):
//   buildContext → executeAgent → compose → sendBlocks
//   event_type: 'agent.proactive_follow_up' identifica este fluxo.
//   A instrução em message_text vai para o LLM mas NÃO é persistida no banco.
//   Apenas a resposta final do agente é persistida como outbound.
//
// LIMITE POR INVOCAÇÃO:
//   SCHEDULE_BATCH_LIMIT=5: pipeline LLM leva ~5-10s por schedule.
//   Vercel Pro: 300s. Cap de segurança para não estourar timeout.
//
// SEGURANÇA MULTI-TENANT:
//   - company_id revalidado em cada query (conversa, assignment, schedule)
//   - service_role apenas no backend
//   - Nunca confia em dados cached — recarrega do banco antes de cada etapa crítica
// =============================================================================

import { randomUUID }   from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { buildContext } from '../lib/agents/contextBuilder.js'
import { executeAgent } from '../lib/agents/agentExecutor.js'
import { compose }      from '../lib/agents/responseComposer.js'
import { sendBlocks }   from '../lib/agents/whatsappGateway.js'

const SCHEDULE_BATCH_LIMIT = 5   // pipeline LLM real: ~5-10s por item
const STALE_MINUTES        = 10  // > Vercel Pro max exec (300s). Evita recuperar workers legítimos.

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function validateCronAuth(req) {
  const auth     = req.headers.authorization
  const expected = `Bearer ${process.env.CRON_SECRET}`
  return auth === expected
}

// ── Hints progressivos por tentativa ─────────────────────────────────────────
//
// Cada tentativa de follow-up recebe uma instrução diferente para o LLM,
// forçando abordagens progressivamente distintas e evitando mensagens repetidas.
// attemptNumber = valor ANTES de incrementar (0 = 1ª tentativa, 1 = 2ª, etc.)
function getFollowUpHint(attemptNumber) {
  switch (attemptNumber) {
    case 0:
      return (
        '[FOLLOWUP-1/REENGAJAMENTO] O lead parou de responder. ' +
        'Retome a conversa de forma natural, fazendo referência ao último ponto ' +
        'discutido. Use uma única pergunta curta e direta para reengajar. ' +
        'Não repita informações já enviadas. Seja caloroso e conciso.'
      )
    case 1:
      return (
        '[FOLLOWUP-2/NOVO-ANGULO] Segunda tentativa. O lead não respondeu ao primeiro follow-up. ' +
        'Use um ângulo COMPLETAMENTE DIFERENTE do anterior — não repita os mesmos argumentos. ' +
        'Destaque um benefício ou ponto de valor que ainda não foi mencionado na conversa. ' +
        'Crie leveza e senso de oportunidade sem ser invasivo. Seja breve.'
      )
    default:
      return (
        '[FOLLOWUP-FINAL/ENCERRAMENTO] Última tentativa de contato. ' +
        'Seja objetivo e empático. Faça uma pergunta simples e fácil de responder. ' +
        'Não pressione. Deixe a porta aberta para retomada futura caso o lead ' +
        'queira continuar depois. Não repita nada do que já foi dito antes.'
      )
  }
}

// ── Handler principal ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (!validateCronAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const svc = getServiceSupabase()
  if (!svc) {
    return res.status(500).json({ error: 'Supabase service_role não configurado' })
  }

  console.log('[CRON:agent-schedules] Iniciando processamento')

  // ── PASSO 1: Stale recovery (10 min — superior ao timeout da Vercel Function) ─
  // Executa antes do claim para liberar schedules com workers abandonados.
  // Limpa processing_token: invalida qualquer worker tardio com token antigo.
  try {
    const { data: recovered, error: recoverErr } = await svc
      .rpc('recover_stale_agent_schedules', { p_stale_minutes: STALE_MINUTES, p_max_retry: 5 })

    if (recoverErr) {
      console.warn('[CRON:agent-schedules] Aviso na recuperação de stale:', recoverErr.message)
    } else if (recovered > 0) {
      console.log(`[CRON:agent-schedules] 🔄 ${recovered} schedules stale recuperados/marcados`)
    }
  } catch (err) {
    console.warn('[CRON:agent-schedules] Exceção na recuperação stale:', err.message)
  }

  // ── PASSO 2: Claim atômico via RPC FOR UPDATE SKIP LOCKED ───────────────────
  // Retorna schedules com processing_token exclusivo gerado no banco.
  const { data: schedules, error: claimErr } = await svc
    .rpc('claim_agent_contact_schedules', {
      p_limit:  SCHEDULE_BATCH_LIMIT,
      p_reason: 'follow_up',
    })

  if (claimErr) {
    console.error('[CRON:agent-schedules] Erro no claim atômico:', claimErr.message)
    return res.status(500).json({ error: claimErr.message })
  }

  if (!schedules?.length) {
    console.log('[CRON:agent-schedules] Nenhum schedule pendente')
    return res.status(200).json({ processed: 0 })
  }

  console.log(`[CRON:agent-schedules] ${schedules.length} schedules claimed`)

  let processed = 0
  let cancelled = 0
  let failed    = 0

  // ── PASSO 3: Processar cada schedule ────────────────────────────────────────
  for (const schedule of schedules) {
    const startMs        = Date.now()
    const processingToken = schedule.processing_token ?? null

    try {
      const result = await processFollowUpSchedule(svc, schedule, processingToken)
      const duration = Date.now() - startMs

      console.log('[CRON:agent-schedules] Resultado:', {
        schedule_id:    schedule.id,
        company_id:     schedule.company_id,
        conversation_id: schedule.conversation_id,
        assignment_id:  schedule.assignment_id,
        attempt_number: schedule.attempt_number,
        retry_count:    schedule.retry_count,
        outcome:        result.outcome,
        reason:         result.reason ?? null,
        duration_ms:    duration,
      })

      if (result.outcome === 'sent')           processed++
      else if (result.outcome === 'cancelled') cancelled++
      else                                      failed++

    } catch (err) {
      const duration = Date.now() - startMs
      console.error('[CRON:agent-schedules] Exceção inesperada:', {
        schedule_id: schedule.id,
        company_id:  schedule.company_id,
        error:       err.message,
        duration_ms: duration,
      })

      // Só chama finalize se tivermos token — sem token, não é possível provar ownership.
      if (processingToken) {
        await finalize(svc, schedule, 'technical_failure', err.message?.slice(0, 200), processingToken)
      } else {
        console.error('[CRON:agent-schedules] Token ausente — schedule não pode ser finalizado:', {
          schedule_id: schedule.id,
        })
      }
      failed++
    }
  }

  console.log(`[CRON:agent-schedules] Concluído: ${processed} sent, ${cancelled} cancelled, ${failed} failed`)
  return res.status(200).json({ processed, cancelled, failed, total: schedules.length })
}

// ── processFollowUpSchedule ────────────────────────────────────────────────────
//
// Orquestra validações + pipeline LLM + envio para um schedule de follow_up.
// processingToken: token gerado no claim — necessário em todas as chamadas a finalize.
// Retorna { outcome: 'sent'|'cancelled'|'retry'|'lease_lost', reason?: string }

async function processFollowUpSchedule(svc, schedule, processingToken) {
  const {
    id, company_id, conversation_id, agent_id, assignment_id,
    attempt_number, max_attempts, interval_hours,
    last_inbound_snapshot, message_hint,
  } = schedule

  // ── Validação 1: Recarregar conversa do banco ────────────────────────────────
  const { data: conv, error: convErr } = await svc
    .from('chat_conversations')
    .select('id, company_id, ai_state, ai_assignment_id, contact_phone, instance_id, last_inbound_at, lead_id')
    .eq('id', conversation_id)
    .eq('company_id', company_id)
    .maybeSingle()

  if (convErr || !conv) {
    console.error('[CRON:agent-schedules] Conversa não encontrada:', { conversation_id, company_id })
    await finalize(svc, schedule, 'cancel', 'conversation_not_found', processingToken)
    return { outcome: 'cancelled', reason: 'conversation_not_found' }
  }

  // ── Validação 2: ai_state — conversa deve estar com IA ativa ────────────────
  if (schedule.reason === 'follow_up' && conv.ai_state !== 'ai_active') {
    console.log('[CRON:agent-schedules] Conversa não está com IA ativa — cancelando:', {
      schedule_id: id,
      ai_state:    conv.ai_state,
    })
    await finalize(svc, schedule, 'cancel', 'conversation_not_active', processingToken)
    return { outcome: 'cancelled', reason: 'conversation_not_active' }
  }

  // ── Validação 3: Recarregar assignment do banco ─────────────────────────────
  const { data: assignment, error: assignErr } = await svc
    .from('company_agent_assignments')
    .select('id, company_id, agent_id, follow_up_enabled, capabilities, price_display_policy, is_active')
    .eq('id', assignment_id)
    .eq('company_id', company_id)
    .maybeSingle()

  if (assignErr || !assignment) {
    console.error('[CRON:agent-schedules] Assignment não encontrado:', { assignment_id, company_id })
    await finalize(svc, schedule, 'cancel', 'invalid_assignment', processingToken)
    return { outcome: 'cancelled', reason: 'invalid_assignment' }
  }

  if (!assignment.is_active) {
    console.log('[CRON:agent-schedules] Assignment inativo — cancelando:', { assignment_id })
    await finalize(svc, schedule, 'cancel', 'assignment_inactive', processingToken)
    return { outcome: 'cancelled', reason: 'assignment_inactive' }
  }

  if (!assignment.follow_up_enabled) {
    console.log('[CRON:agent-schedules] Follow-up desabilitado no assignment — cancelando:', { assignment_id })
    await finalize(svc, schedule, 'cancel', 'followup_disabled', processingToken)
    return { outcome: 'cancelled', reason: 'followup_disabled' }
  }

  // ── Validação 4: assignment_changed (NOVO) ───────────────────────────────────
  // A conversa mudou de assignment desde a criação do schedule.
  // Não continuar com o assignment antigo — seria envio fora de contexto.
  if (conv.ai_assignment_id !== assignment_id) {
    console.warn('[CRON:agent-schedules] ai_assignment_id mudou — cancelando sem consumir tentativa:', {
      schedule_id:         id,
      schedule_assignment: assignment_id,
      conv_assignment:     conv.ai_assignment_id,
    })
    await finalize(svc, schedule, 'cancel', 'assignment_changed', processingToken)
    return { outcome: 'cancelled', reason: 'assignment_changed' }
  }

  // ── Validação 5: agent_mismatch (NOVO) ──────────────────────────────────────
  // O agent_id registrado no schedule diverge do agent do assignment atual.
  // Pode ocorrer se o assignment foi reconfigurado com outro agente.
  if (agent_id !== assignment.agent_id) {
    console.warn('[CRON:agent-schedules] agent_id diverge do assignment atual — cancelando:', {
      schedule_id:     id,
      schedule_agent:  agent_id,
      assignment_agent: assignment.agent_id,
    })
    await finalize(svc, schedule, 'cancel', 'agent_mismatch', processingToken)
    return { outcome: 'cancelled', reason: 'agent_mismatch' }
  }

  // ── Validação 6: Limite de tentativas ────────────────────────────────────────
  if (attempt_number >= max_attempts) {
    console.log('[CRON:agent-schedules] Max attempts atingido:', { attempt_number, max_attempts })
    await finalize(svc, schedule, 'cancel', 'max_attempts_already_reached', processingToken)
    return { outcome: 'cancelled', reason: 'max_attempts_already_reached' }
  }

  // ── Validação 7: Revalidar ausência (lead respondeu após criação?) ────────────
  if (last_inbound_snapshot && conv.last_inbound_at) {
    if (new Date(conv.last_inbound_at) > new Date(last_inbound_snapshot)) {
      console.log('[CRON:agent-schedules] Lead respondeu após criação do schedule — cancelando:', {
        schedule_id:          id,
        snapshot:             last_inbound_snapshot,
        current_last_inbound: conv.last_inbound_at,
      })
      await finalize(svc, schedule, 'cancel', 'lead_responded', processingToken)
      return { outcome: 'cancelled', reason: 'lead_responded' }
    }
  }

  // ── Validação 8: Campos obrigatórios para o gateway ──────────────────────────
  if (!conv.contact_phone) {
    console.error('[CRON:agent-schedules] contact_phone ausente na conversa:', { conversation_id })
    await finalize(svc, schedule, 'technical_failure', 'missing_contact_phone', processingToken)
    return { outcome: 'retry', reason: 'missing_contact_phone' }
  }

  if (!conv.instance_id) {
    console.error('[CRON:agent-schedules] instance_id ausente na conversa:', { conversation_id })
    await finalize(svc, schedule, 'technical_failure', 'missing_instance_id', processingToken)
    return { outcome: 'retry', reason: 'missing_instance_id' }
  }

  // ── Verificação de ownership pré-LLM (NOVO) ──────────────────────────────────
  // Garante que o stale recovery não recuperou este schedule enquanto as validações
  // anteriores eram executadas. Se o token não corresponder mais, abortar sem finalizar.
  const ownedBeforeLLM = await checkOwnership(svc, id, company_id, processingToken)
  if (!ownedBeforeLLM) {
    console.log('[CRON:agent-schedules] processing_lease_lost antes do LLM:', {
      schedule_id: id,
      company_id,
    })
    return { outcome: 'lease_lost', reason: 'processing_lease_lost' }
  }

  // ── Pipeline LLM ─────────────────────────────────────────────────────────────
  //
  // Monta OrchestratorContext sintético sem passar pelo ConversationOrchestrator.
  // event_type: 'agent.proactive_follow_up':
  //   - Não tratado como webhook inbound real
  //   - message_text vai para o LLM mas NÃO é persistido como mensagem
  //   - Apenas a resposta final do LLM é persistida como outbound
  //   - session_id: null — gateway não incrementa contador de sessão

  const runId = randomUUID()
  const proactiveInstruction = getFollowUpHint(attempt_number)

  // #region agent log
  fetch('http://127.0.0.1:7824/ingest/c7c9ded9-54a3-4071-a103-7e7846ef9215',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'acb88e'},body:JSON.stringify({sessionId:'acb88e',location:'process-agent-schedules.js:proactive-hint',message:'hint_por_tentativa',data:{schedule_id:id,attempt_number,hint_used:proactiveInstruction.slice(0,80)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  const proactiveContext = {
    run_id:                runId,
    session_id:            null,
    agent_id:              agent_id,
    assignment_id:         assignment_id,
    capabilities:          assignment.capabilities ?? {},
    price_display_policy:  assignment.price_display_policy ?? 'disabled',
    rule_id:               null,
    flow_state_id:         null,
    locked_opportunity_id: null,
    conversation: {
      id:            conversation_id,
      contact_phone: conv.contact_phone,
      ai_state:      conv.ai_state,
    },
    event: {
      company_id:      company_id,
      conversation_id: conversation_id,
      instance_id:     conv.instance_id,
      event_type:      'agent.proactive_follow_up',
      message_text:    proactiveInstruction,
    },
    grouped_messages: null,
  }

  // ── Etapa 1: buildContext ──────────────────────────────────────────────────
  let ctxResult
  try {
    ctxResult = await buildContext(proactiveContext)
  } catch (err) {
    console.error('[CRON:agent-schedules] Exceção em buildContext:', { run_id: runId, error: err.message })
    await finalize(svc, schedule, 'technical_failure', `buildContext_exception: ${err.message?.slice(0, 100)}`, processingToken)
    return { outcome: 'retry', reason: 'buildContext_exception' }
  }

  if (!ctxResult.success) {
    console.error('[CRON:agent-schedules] buildContext falhou:', { run_id: runId, skip_reason: ctxResult.skip_reason })
    await finalize(svc, schedule, 'technical_failure', `buildContext: ${ctxResult.skip_reason}`, processingToken)
    return { outcome: 'retry', reason: `buildContext_${ctxResult.skip_reason}` }
  }

  // ── Etapa 2: executeAgent ──────────────────────────────────────────────────
  let execResult
  try {
    execResult = await executeAgent(ctxResult.output)
  } catch (err) {
    console.error('[CRON:agent-schedules] Exceção em executeAgent:', { run_id: runId, error: err.message })
    await finalize(svc, schedule, 'technical_failure', `executeAgent_exception: ${err.message?.slice(0, 100)}`, processingToken)
    return { outcome: 'retry', reason: 'executeAgent_exception' }
  }

  if (!execResult.success) {
    console.error('[CRON:agent-schedules] executeAgent falhou:', { run_id: runId, skip_reason: execResult.skip_reason })
    await finalize(svc, schedule, 'technical_failure', `executeAgent: ${execResult.skip_reason}`, processingToken)
    return { outcome: 'retry', reason: `executeAgent_${execResult.skip_reason}` }
  }

  // ── Etapa 3: compose ───────────────────────────────────────────────────────
  let composeResult
  try {
    composeResult = compose(execResult.output)
  } catch (err) {
    console.error('[CRON:agent-schedules] Exceção em compose:', { run_id: runId, error: err.message })
    await finalize(svc, schedule, 'technical_failure', `compose_exception: ${err.message?.slice(0, 100)}`, processingToken)
    return { outcome: 'retry', reason: 'compose_exception' }
  }

  if (!composeResult.success) {
    console.error('[CRON:agent-schedules] compose falhou:', { run_id: runId, skip_reason: composeResult.skip_reason })
    await finalize(svc, schedule, 'technical_failure', `compose: ${composeResult.skip_reason}`, processingToken)
    return { outcome: 'retry', reason: `compose_${composeResult.skip_reason}` }
  }

  // ── Verificação pré-sendBlocks (revalida tudo antes de comprometer com o envio) ──
  // Ordem: ownership → ai_state → assignment_unchanged → lead_responded → assignment_enabled
  const preSend = await validatePreSend(svc, schedule, processingToken)
  if (!preSend.ok) {
    if (preSend.leaseLost) {
      console.log('[CRON:agent-schedules] processing_lease_lost antes do sendBlocks:', {
        schedule_id: id, company_id,
      })
      return { outcome: 'lease_lost', reason: 'processing_lease_lost' }
    }
    console.log('[CRON:agent-schedules] Cancelando antes do sendBlocks:', {
      schedule_id: id, reason: preSend.reason,
    })
    await finalize(svc, schedule, 'cancel', preSend.reason, processingToken)
    return { outcome: 'cancelled', reason: preSend.reason }
  }

  // ── begin_send_schedule: processing → sending (NOVO) ─────────────────────────
  //
  // Transição atômica antes de chamar sendBlocks.
  // Persiste send_idempotency_key = runId (= ai_run_id nas chat_messages).
  //
  // Garante: se a Vercel Function morrer durante sendBlocks (timeout),
  // o schedule permanece em 'sending'. O stale recovery NÃO devolve para
  // 'pending' automaticamente (move para 'delivery_unknown').
  // Reconciliação: SELECT * FROM chat_messages WHERE ai_run_id = send_idempotency_key.
  const { data: beginResult, error: beginErr } = await svc
    .rpc('begin_send_schedule', {
      p_schedule_id:          id,
      p_company_id:           company_id,
      p_processing_token:     processingToken,
      p_send_idempotency_key: runId,   // runId = stable key por commercial attempt
    })

  if (beginErr || !beginResult?.success) {
    console.log('[CRON:agent-schedules] begin_send_schedule falhou — lease perdido:', {
      schedule_id: id,
      error:       beginErr?.message ?? beginResult?.error,
    })
    return { outcome: 'lease_lost', reason: 'begin_send_failed' }
  }

  // ── Etapa 4: sendBlocks ───────────────────────────────────────────────────
  // O gateway revalida ai_state antes de cada bloco (checkAiState interno).
  // Se o lead responder durante o envio, o gateway aborta com ai_state_changed.
  // IMPORTANTE: exceções aqui são tratadas com technical_failure (erro CONFIRMADO
  // de envio — gateway não chegou a chamar Uazapi ou Uazapi retornou erro explícito).
  // Não usar technical_failure quando incerto se Uazapi recebeu a chamada.
  let gatewayResult
  try {
    gatewayResult = await sendBlocks(composeResult.output)
  } catch (err) {
    // Exceção durante sendBlocks: gateway não chegou a enviar.
    // Seguro chamar technical_failure — schedule volta para pending com retry.
    console.error('[CRON:agent-schedules] Exceção em sendBlocks:', { run_id: runId, error: err.message })
    await finalize(svc, schedule, 'technical_failure', `sendBlocks_exception: ${err.message?.slice(0, 100)}`, processingToken)
    return { outcome: 'retry', reason: 'sendBlocks_exception' }
  }

  // Falha com abortReason confirmado: sabemos que não foi enviado → technical_failure
  if (!gatewayResult.success && gatewayResult.abortReason !== 'ai_state_changed') {
    console.error('[CRON:agent-schedules] sendBlocks falhou:', {
      run_id:       runId,
      abort_reason: gatewayResult.abortReason,
      error:        gatewayResult.error,
    })
    await finalize(svc, schedule, 'technical_failure', `sendBlocks: ${gatewayResult.abortReason ?? gatewayResult.error}`, processingToken)
    return { outcome: 'retry', reason: `sendBlocks_${gatewayResult.abortReason}` }
  }

  // Lead respondeu durante envio: cancela sem consumir tentativa
  if (gatewayResult.abortReason === 'ai_state_changed') {
    console.log('[CRON:agent-schedules] Lead respondeu durante envio (ai_state mudou):', { run_id: runId })
    await finalize(svc, schedule, 'cancel', 'lead_responded_during_send', processingToken)
    return { outcome: 'cancelled', reason: 'lead_responded_during_send' }
  }

  // ── SUCESSO: finalizar atomicamente e criar próxima tentativa ───────────────
  const newAttemptNumber = attempt_number + 1
  const hasMoreAttempts  = newAttemptNumber < max_attempts
  const nextScheduledAt  = hasMoreAttempts
    ? new Date(Date.now() + Number(interval_hours) * 60 * 60 * 1000).toISOString()
    : null

  // Snapshot atualizado de last_inbound_at para a próxima tentativa
  const { data: freshConv } = await svc
    .from('chat_conversations')
    .select('last_inbound_at')
    .eq('id', conversation_id)
    .eq('company_id', company_id)
    .maybeSingle()

  // Nota: se finalize falhar aqui, a mensagem JÁ foi enviada mas o schedule
  // permanece em 'sending'. O stale recovery moverá para 'delivery_unknown'
  // após 15 min. NÃO haverá reenvio automático.
  // Reconciliação: SELECT * FROM chat_messages WHERE ai_run_id = runId AND status='sent'.
  const { data: finalizeResult, error: finalizeErr } = await svc
    .rpc('finalize_followup_schedule', {
      p_schedule_id:         id,
      p_company_id:          company_id,
      p_processing_token:    processingToken,
      p_outcome:             'success',
      p_cancel_reason:       null,
      p_new_attempt_number:  newAttemptNumber,
      p_create_next:         hasMoreAttempts,
      p_next_scheduled_at:   nextScheduledAt,
      p_last_inbound_now:    freshConv?.last_inbound_at ?? null,
      p_gateway_message_ids: gatewayResult.messageIds?.length ? gatewayResult.messageIds : null,
    })

  if (finalizeErr || finalizeResult?.success === false) {
    // Mensagem JÁ enviada — o schedule permanecerá em 'sending' até stale recovery.
    // Stale recovery → delivery_unknown (não haverá reenvio automático).
    console.error('[CRON:agent-schedules] Erro ao finalizar (mensagem JÁ enviada → delivery_unknown em 15min):', {
      schedule_id:       id,
      send_idempotency:  runId,
      finalize_error:    finalizeErr?.message ?? finalizeResult?.error,
    })
  } else {
    console.log('[CRON:agent-schedules] ✅ Follow-up enviado e finalizado:', {
      schedule_id:      id,
      company_id,
      conversation_id,
      assignment_id,
      run_id:           runId,
      attempt_done:     newAttemptNumber,
      max_attempts,
      next_schedule_id: finalizeResult?.next_schedule_id ?? null,
      success_count:    gatewayResult.successCount,
    })
  }

  return { outcome: 'sent', attempt_number: newAttemptNumber }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Verifica se este worker ainda possui o schedule (processing_token corresponde).
 * Retorna false se o token foi limpo (stale recovery) ou alterado.
 * Sem token (pré-migration): retorna true por compatibilidade — logar aviso.
 */
async function checkOwnership(svc, scheduleId, companyId, processingToken) {
  if (!processingToken) {
    console.warn('[CRON:agent-schedules] checkOwnership: processingToken ausente — verificação ignorada:', {
      scheduleId,
    })
    return true
  }

  const { data } = await svc
    .from('agent_contact_schedules')
    .select('id')
    .eq('id', scheduleId)
    .eq('company_id', companyId)
    .eq('status', 'processing')
    .eq('processing_token', processingToken)
    .maybeSingle()

  return !!data
}

/**
 * Revalida ownership + conversa + assignment imediatamente antes do sendBlocks.
 * Ordem: ownership → ai_state → assignment_unchanged → lead_responded → assignment_enabled
 *
 * Retorna:
 *   { ok: true }
 *   { ok: false, leaseLost: true, reason: 'processing_lease_lost' }
 *   { ok: false, reason: string }
 */
async function validatePreSend(svc, schedule, processingToken) {
  // 1. Ownership (token)
  const owned = await checkOwnership(svc, schedule.id, schedule.company_id, processingToken)
  if (!owned) return { ok: false, leaseLost: true, reason: 'processing_lease_lost' }

  // 2. Reload conversa: ai_state + ai_assignment_id + last_inbound_at
  const { data: conv } = await svc
    .from('chat_conversations')
    .select('ai_state, last_inbound_at, ai_assignment_id')
    .eq('id', schedule.conversation_id)
    .eq('company_id', schedule.company_id)
    .maybeSingle()

  if (!conv)                        return { ok: false, reason: 'conversation_not_found' }
  if (conv.ai_state !== 'ai_active') return { ok: false, reason: 'conversation_not_active' }
  if (conv.ai_assignment_id !== schedule.assignment_id)
                                    return { ok: false, reason: 'assignment_changed' }

  // 3. Lead respondeu desde o snapshot?
  if (schedule.last_inbound_snapshot && conv.last_inbound_at) {
    if (new Date(conv.last_inbound_at) > new Date(schedule.last_inbound_snapshot)) {
      return { ok: false, reason: 'lead_responded' }
    }
  }

  // 4. Assignment ainda ativo e habilitado
  const { data: assignment } = await svc
    .from('company_agent_assignments')
    .select('is_active, follow_up_enabled')
    .eq('id', schedule.assignment_id)
    .eq('company_id', schedule.company_id)
    .maybeSingle()

  if (!assignment || !assignment.is_active || !assignment.follow_up_enabled) {
    return { ok: false, reason: 'followup_disabled' }
  }

  return { ok: true }
}

/**
 * Finaliza um schedule via RPC transacional.
 * processingToken obrigatório: a RPC valida ownership antes de qualquer alteração.
 * Se token for null (pré-migration), a RPC retornará schedule_not_found — registramos mas não lançamos.
 */
async function finalize(svc, schedule, outcome, reason, processingToken) {
  try {
    const { data, error } = await svc.rpc('finalize_followup_schedule', {
      p_schedule_id:         schedule.id,
      p_company_id:          schedule.company_id,
      p_processing_token:    processingToken ?? null,
      p_outcome:             outcome,
      p_cancel_reason:       reason ?? null,
      p_new_attempt_number:  null,
      p_create_next:         false,
      p_next_scheduled_at:   null,
      p_last_inbound_now:    null,
      p_gateway_message_ids: null,
    })

    if (error) {
      console.error('[CRON:agent-schedules] Erro na RPC finalize_followup_schedule:', {
        schedule_id: schedule.id,
        outcome,
        reason,
        error: error.message,
      })
    } else if (data?.success === false) {
      console.error('[CRON:agent-schedules] finalize retornou sucesso=false:', {
        schedule_id: schedule.id,
        outcome,
        reason,
        rpc_error: data.error,
      })
    }
  } catch (err) {
    console.error('[CRON:agent-schedules] Exceção em finalize:', {
      schedule_id: schedule.id,
      error: err.message,
    })
  }
}
