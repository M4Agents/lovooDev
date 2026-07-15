// =============================================================================
// api/lib/agents/batchExecutionPipeline.js
//
// Pipeline interno — Processamento de Lote Agrupado
//
// RESPONSABILIDADE:
//   Orquestrar o processamento de um lote já reivindicado (status=processing)
//   garantindo idempotência, coordenação entre execução e lote, e transições
//   de estado corretas em caso de sucesso, retry ou falha.
//
// FLUXO:
//   1. Validar lote recebido localmente (sem I/O)
//   2. Carregar mensagens do lote
//   3. Revalidar estado atual da conversa/agente/assignment
//   4. Reivindicar execução idempotente (agent_batch_executions)
//   5. Chamar executeAgent com runId = executionId (sem novo UUID)
//   6. Marcar execução e lote conforme resultado
//
// IDENTIFICADOR ESTÁVEL:
//   runId = executionId (retornado pelo claim, nunca gerado aqui).
//   Retries do mesmo batch reutilizam o mesmo execution_id.
//   Na integração futura, este ID será usado como chat_messages.ai_run_id.
//
// ORDEM DE MARCAÇÃO (CRÍTICO):
//   Sucesso:  execução completed → lote processed
//   Retry:    execução retry_pending/failed → lote retry_pending/failed
//   Terminal: execução failed → lote failed
//   Se a segunda marcação falhar: retornar RECONCILIATION_ERROR.
//   O retry subsequente detectará already_completed e reconciliará apenas o lote.
//
// DEPENDÊNCIAS INJETÁVEIS:
//   Todas as dependências de I/O são injetáveis para facilitar testes com mocks.
//   executeAgent é obrigatório — sem default.
//   Demais dependências têm default apontando para os serviços reais.
//
// CALL SITES:
//   Nenhum call site externo nesta etapa. Sem cron, sem Router, sem endpoint.
//
// LOGS PERMITIDOS:
//   operation, company_id, conversation_id, batch_id, execution_id,
//   batch_status, execution_status, attempts, reason, error_code,
//   message_count, duration_ms.
//   PROIBIDO: claimToken, lockedAt integral, conteúdo de mensagem, payload,
//   prompt, resposta LLM, credenciais, secrets.
// =============================================================================

import {
  loadBatchMessages   as _loadBatchMessages,
  markBatchProcessed  as _markBatchProcessed,
  markBatchRetry      as _markBatchRetry,
  markBatchFailed     as _markBatchFailed,
  markBatchCancelled  as _markBatchCancelled,
  rescheduleBatch     as _rescheduleBatch,
} from './messageBufferService.js';

import {
  claimBatchExecution          as _claimBatchExecution,
  markBatchExecutionCompleted  as _markBatchExecutionCompleted,
  markBatchExecutionRetry      as _markBatchExecutionRetry,
  markBatchExecutionFailed     as _markBatchExecutionFailed,
  markBatchExecutionCancelled  as _markBatchExecutionCancelled,
} from './batchExecutionService.js';

import { isWithinSchedule, getNextAllowedScheduleAt } from './scheduleUtils.js';


// ── revalidateBatchState ──────────────────────────────────────────────────────

/**
 * Revalida se o lote ainda pode ser executado consultando o banco.
 *
 * Verificações realizadas (na ordem):
 *  1. Conversa existe e pertence à empresa
 *  2. ai_state === 'ai_active'
 *  3. Canal é whatsapp
 *  4. Assignment não mudou desde o enqueue (conservador: cancela se mudou)
 *  5. Assignment existe, pertence à empresa, está ativo, can_auto_reply = true
 *  6. Schedule permite execução agora (fora do horário → reschedule com nextAllowedAt)
 *  7. Agente referenciado pelo assignment existe e está ativo
 *  8. Instância WhatsApp — OBRIGATÓRIA (Etapa 13):
 *     a. Tenta resolver de conv.instance_id (fonte primária)
 *     b. Fallback: verifica instanceIds (das mensagens do lote)
 *     c. Se instâncias divergentes no lote → cancela (instance_divergence)
 *     d. Se nenhuma instância → cancela (integration_missing)
 *     e. Valida status 'connected' e pertencimento à empresa
 *
 * Decisão sobre assignment_changed:
 *   Conservadora para V1. Se conv.ai_assignment_id divergir do enqueueAssignmentId,
 *   o lote é cancelado. O sistema não tentará resolver um novo assignment
 *   automaticamente nesta versão.
 *
 * Decisão sobre out_of_schedule (Etapa 13.1):
 *   action = 'reschedule' com nextAllowedAt calculado por getNextAllowedScheduleAt.
 *   Pipeline usa agent_message_batch_reschedule_v1 via rescheduleBatch() para definir
 *   next_attempt_at explicitamente sem consumir tentativa técnica.
 *   Se nextAllowedAt = null (nenhuma janela em 8 dias) → cancelar com NO_FUTURE_SCHEDULE.
 *   NÃO usar markBatchRetry para schedule — não é falha técnica.
 *
 * @param {{ svc, companyId, conversationId, enqueueAssignmentId, channel, instanceIds? }} p
 *   instanceIds: array de UUIDs de instância extraídos das mensagens do lote (pode ser vazio)
 * @returns {Promise<
 *   { allowed: true, effectiveAssignmentId: string, agentId: string, instanceId: string, reason: null }
 * | { allowed: false, action: 'cancel'|'retry'|'reschedule', reason: string, errorCode?: string, nextAllowedAt?: Date|null }
 * >}
 */
export async function revalidateBatchState({
  svc,
  companyId,
  conversationId,
  enqueueAssignmentId,
  channel,
  instanceIds = [],  // UUIDs de instância extraídos das mensagens do lote (Etapa 13)
}) {
  // 1. Conversa: existe, pertence à empresa, ai_state, instance_id, ai_assignment_id
  const { data: conv, error: convError } = await svc
    .from('chat_conversations')
    .select('id, ai_state, instance_id, ai_assignment_id')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (convError || !conv) {
    return { allowed: false, action: 'cancel', reason: 'conversation_not_found' };
  }

  // 2. ai_state
  if (conv.ai_state !== 'ai_active') {
    const reason = conv.ai_state === 'human' ? 'human_handoff' : 'ai_disabled';
    return { allowed: false, action: 'cancel', reason };
  }

  // 3. Canal: apenas whatsapp suportado nesta versão
  if (channel && channel !== 'whatsapp') {
    return { allowed: false, action: 'cancel', reason: 'invalid_channel' };
  }

  // 4. Assignment: detectar mudança desde o enqueue (conservador → cancelar)
  if (conv.ai_assignment_id && conv.ai_assignment_id !== enqueueAssignmentId) {
    return { allowed: false, action: 'cancel', reason: 'assignment_changed' };
  }

  // 5. Assignment: validar existência, empresa, ativo, can_auto_reply
  const { data: assignment, error: assignError } = await svc
    .from('company_agent_assignments')
    .select('id, agent_id, capabilities, operating_schedule, is_active')
    .eq('id', enqueueAssignmentId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (assignError || !assignment) {
    return { allowed: false, action: 'cancel', reason: 'assignment_not_found' };
  }

  if (!assignment.is_active) {
    return { allowed: false, action: 'cancel', reason: 'assignment_inactive' };
  }

  if (!assignment.capabilities?.can_auto_reply) {
    return { allowed: false, action: 'cancel', reason: 'capability_denied' };
  }

  // 6. Schedule (Etapa 13: action='reschedule' com nextAllowedAt calculado)
  const scheduleCheck = isWithinSchedule(assignment.operating_schedule, {
    assignmentId:   enqueueAssignmentId,
    companyId,
    conversationId,
  });

  if (!scheduleCheck.allowed) {
    // Calcular próxima janela válida (Etapa 13 — Parte B)
    // Retorno: null = sem restrição, Date = próxima janela, undefined = nenhuma em 7 dias
    const nextAllowedAt = getNextAllowedScheduleAt(assignment.operating_schedule);

    return {
      allowed:       false,
      action:        'reschedule',   // pipeline usa rescheduleBatch com nextAllowedAt explícito
      reason:        'out_of_schedule',
      errorCode:     scheduleCheck.reason,
      nextAllowedAt: nextAllowedAt ?? null,  // null quando indefinido (sem janelas)
    };
  }

  // 7. Agente: existe e está ativo
  const { data: agent, error: agentError } = await svc
    .from('lovoo_agents')
    .select('id, is_active')
    .eq('id', assignment.agent_id)
    .eq('company_id', companyId)
    .maybeSingle();

  if (agentError || !agent || !agent.is_active) {
    return { allowed: false, action: 'cancel', reason: 'agent_inactive' };
  }

  // 8. Instância WhatsApp — OBRIGATÓRIA (Etapa 13 — Parte C)
  //
  //  Resolução em ordem de confiabilidade:
  //    a) conv.instance_id — fonte primária (conversa sempre vinculada a uma instância)
  //    b) instanceIds[0]   — fallback: extraídos de agent_message_batch_messages.instance_id
  //
  //  Rejeição explícita:
  //    - instâncias divergentes no mesmo lote (instance_divergence)
  //    - nenhuma instância encontrada (integration_missing)
  //    - instância não 'connected' ou não pertence à empresa (integration_inactive)

  // Verificar divergência nas mensagens do lote
  const uniqueMessageInstanceIds = [...new Set(instanceIds.filter(Boolean))];
  if (uniqueMessageInstanceIds.length > 1) {
    // Lote com mensagens de instâncias diferentes — não deveria acontecer
    // (webhook garante instance_id por mensagem; mas por segurança cancelamos)
    return { allowed: false, action: 'cancel', reason: 'instance_divergence' };
  }

  // Resolver instância: conversa primeiro, mensagens como fallback
  const resolvedInstanceId =
    conv.instance_id ?? uniqueMessageInstanceIds[0] ?? null;

  if (!resolvedInstanceId) {
    return { allowed: false, action: 'cancel', reason: 'integration_missing' };
  }

  const { data: instance, error: instanceError } = await svc
    .from('whatsapp_life_instances')
    .select('id, status')
    .eq('id', resolvedInstanceId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (instanceError || !instance || instance.status !== 'connected') {
    return { allowed: false, action: 'cancel', reason: 'integration_inactive' };
  }

  return {
    allowed:               true,
    effectiveAssignmentId: enqueueAssignmentId,
    agentId:               assignment.agent_id,
    instanceId:            resolvedInstanceId,   // Etapa 13: agora sempre presente
    reason:                null,
  };
}


// ── Helpers privados ──────────────────────────────────────────────────────────

/**
 * Classifica um erro de execução em categoria de tratamento.
 * Prioridade: retryable explícito → cancel → terminal (default).
 */
function classifyExecutionFailure(err) {
  if (!err) return 'terminal';
  if (err?.retryable === true)        return 'retryable';
  if (err?.category === 'cancel')     return 'cancel';
  return 'terminal';
}

/** Limita código de erro a 100 chars para segurança. */
function sanitizeCode(code) {
  return String(code ?? 'EXECUTION_FAILED').slice(0, 100);
}

/** Limita mensagem de erro a 200 chars; nunca inclui conteúdo do usuário. */
function sanitizeMessage(msg) {
  return String(msg ?? 'Erro durante execução agrupada').slice(0, 200);
}

/**
 * Transforma rows de loadBatchMessages em estrutura de mensagens agrupadas.
 * Preserva a ordem retornada pelo service.
 */
function buildGroupedMessages(messages) {
  return messages.map(m => ({
    messageId:         m.id,
    providerMessageId: m.providerMessageId,
    text:              m.messageText      ?? null,
    type:              m.messageType      ?? 'text',
    receivedAt:        m.receivedAt,
    providerTimestamp: m.providerTimestamp ?? null,
    payload:           m.payload          ?? {},
  }));
}


// ── processClaimedBatch ───────────────────────────────────────────────────────

/**
 * Processa um lote já reivindicado (status=processing).
 *
 * @param {{ svc, batch, dependencies }} opts
 * @param {object} opts.svc   - Cliente Supabase service_role
 * @param {object} opts.batch - Lote reivindicado com status=processing
 * @param {object} [opts.dependencies] - Overrides para injeção/teste
 *
 * @throws {Error} Se executeAgent não for fornecido ou batch for inválido (step 1)
 * @returns {Promise<object>} Resultado estruturado (nunca lança após step 1)
 */
export async function processClaimedBatch({ svc, batch, dependencies = {} }) {
  const OP = 'processClaimedBatch';
  const startMs = Date.now();

  // executeAgent não tem default — requer injeção explícita
  if (!dependencies.executeAgent) {
    throw new Error(`${OP}: executeAgent dependency is required`);
  }

  const deps = {
    loadBatchMessages:           dependencies.loadBatchMessages           ?? _loadBatchMessages,
    claimBatchExecution:         dependencies.claimBatchExecution         ?? _claimBatchExecution,
    markBatchExecutionCompleted: dependencies.markBatchExecutionCompleted ?? _markBatchExecutionCompleted,
    markBatchExecutionRetry:     dependencies.markBatchExecutionRetry     ?? _markBatchExecutionRetry,
    markBatchExecutionFailed:    dependencies.markBatchExecutionFailed    ?? _markBatchExecutionFailed,
    markBatchExecutionCancelled: dependencies.markBatchExecutionCancelled ?? _markBatchExecutionCancelled,
    markBatchProcessed:          dependencies.markBatchProcessed          ?? _markBatchProcessed,
    markBatchRetry:              dependencies.markBatchRetry              ?? _markBatchRetry,
    markBatchFailed:             dependencies.markBatchFailed             ?? _markBatchFailed,
    markBatchCancelled:          dependencies.markBatchCancelled          ?? _markBatchCancelled,
    rescheduleBatch:             dependencies.rescheduleBatch             ?? _rescheduleBatch,
    revalidateBatchState:        dependencies.revalidateBatchState        ?? revalidateBatchState,
    executeAgent:                dependencies.executeAgent,
  };

  // ── STEP 1: Validar lote (sem I/O — erros lançados antes de qualquer operação) ──
  if (!batch)                         throw new Error(`${OP}: batch é obrigatório`);
  if (!batch.id)                      throw new Error(`${OP}: batch.id é obrigatório`);
  if (!batch.companyId)               throw new Error(`${OP}: batch.companyId é obrigatório`);
  if (!batch.conversationId)          throw new Error(`${OP}: batch.conversationId é obrigatório`);
  if (batch.status !== 'processing')  throw new Error(`${OP}: batch.status deve ser 'processing', recebido: '${batch.status}'`);
  if (!batch.lockedAt)                throw new Error(`${OP}: batch.lockedAt é obrigatório`);

  const { id: batchId, companyId, conversationId, lockedAt, enqueueAssignmentId, channel } = batch;

  console.log(`🤖 [PIPE] 🚀 ${OP}:`, {
    operation:       OP,
    company_id:      companyId,
    conversation_id: conversationId,
    batch_id:        batchId,
    attempts:        batch.attempts,
  });

  // ── STEP 2: Carregar mensagens ────────────────────────────────────────────
  const messages = await deps.loadBatchMessages({ svc, companyId, conversationId, batchId });

  if (messages.length === 0) {
    console.log(`🤖 [PIPE] ⏭️  ${OP}: lote vazio — cancelando`, {
      operation:     OP,
      company_id:    companyId,
      batch_id:      batchId,
      message_count: 0,
    });
    await deps.markBatchCancelled({ svc, companyId, batchId, lockedAt, reason: 'EMPTY_BATCH' });
    return { ok: false, status: 'cancelled', reason: 'EMPTY_BATCH', batchId };
  }

  // ── STEP 3: Revalidar estado atual ────────────────────────────────────────
  // Etapa 13 — Parte C: extrair instanceIds das mensagens para resolução de instância
  const instanceIds = [...new Set(messages.map((m) => m.instanceId).filter(Boolean))];

  const revalidation = await deps.revalidateBatchState({
    svc, companyId, conversationId, enqueueAssignmentId, channel, instanceIds,
  });

  if (!revalidation.allowed) {
    console.log(`🤖 [PIPE] ⏭️  ${OP}: revalidação negou execução`, {
      operation:  OP,
      company_id: companyId,
      batch_id:   batchId,
      reason:     revalidation.reason,
      action:     revalidation.action,
    });

    if (revalidation.action === 'retry') {
      await deps.markBatchRetry({
        svc, companyId, batchId, lockedAt, errorCode: revalidation.reason,
      });
      return { ok: false, status: 'retry_scheduled', reason: 'REVALIDATION_CANCELLED', batchId };
    }

    // Etapa 13.1 — Parte C: reschedule via RPC dedicada (sem consumir tentativa técnica)
    // Usa agent_message_batch_reschedule_v1 que compensa o incremento do claim.
    // Se nextAllowedAt for null (nenhuma janela futura em 8 dias), cancelar o lote —
    // não usar retry técnico cego sem janela definida.
    if (revalidation.action === 'reschedule') {
      const nextAllowedAt = revalidation.nextAllowedAt ?? null;

      if (!nextAllowedAt) {
        // Nenhuma janela futura configurada no schedule — cancelar (conservador)
        console.log(`🤖 [PIPE] ⏰ ${OP}: nenhuma janela futura no schedule — cancelando`, {
          operation:  OP,
          company_id: companyId,
          batch_id:   batchId,
          reason:     'no_future_schedule',
        });
        await deps.markBatchCancelled({
          svc, companyId, batchId, lockedAt, reason: 'NO_FUTURE_SCHEDULE',
        });
        return {
          ok:     false,
          status: 'cancelled',
          reason: 'NO_FUTURE_SCHEDULE',
          batchId,
        };
      }

      console.log(`🤖 [PIPE] ⏰ ${OP}: reagendando para próxima janela`, {
        operation:       OP,
        company_id:      companyId,
        batch_id:        batchId,
        next_allowed_at: nextAllowedAt.toISOString(),
      });

      await deps.rescheduleBatch({
        svc, companyId, batchId, lockedAt,
        nextAttemptAt: nextAllowedAt,
        reason:        'OUT_OF_SCHEDULE',
      });
      return {
        ok:            false,
        status:        'rescheduled',
        reason:        'OUT_OF_SCHEDULE',
        nextAllowedAt,
        batchId,
      };
    }

    // padrão: cancel
    await deps.markBatchCancelled({ svc, companyId, batchId, lockedAt, reason: revalidation.reason });
    return { ok: false, status: 'cancelled', reason: 'REVALIDATION_CANCELLED', batchId };
  }

  const { effectiveAssignmentId, agentId, instanceId } = revalidation;

  // ── STEP 4: Reivindicar execução idempotente ──────────────────────────────
  const claim = await deps.claimBatchExecution({ svc, companyId, batchId });

  console.log(`🤖 [PIPE] ${claim.acquired ? '✅' : 'ℹ️'} ${OP}: claim`, {
    operation:    OP,
    company_id:   companyId,
    batch_id:     batchId,
    execution_id: claim.executionId,
    reason:       claim.reason,
    acquired:     claim.acquired,
    // claimToken NUNCA logado
  });

  if (!claim.acquired) {
    const { reason, executionId: execId } = claim;

    if (reason === 'already_processing') {
      return { ok: false, status: 'skipped', reason: 'EXECUTION_ALREADY_PROCESSING', batchId };
    }

    if (reason === 'already_completed') {
      // Execução já concluída, lote ainda não finalizado — reconciliar
      try {
        await deps.markBatchProcessed({ svc, companyId, batchId, lockedAt });
      } catch {
        console.error(`🤖 [PIPE] ❌ ${OP}: reconciliação already_completed falhou`, {
          operation:    OP,
          company_id:   companyId,
          batch_id:     batchId,
          execution_id: execId,
          error_code:   'RECONCILIATION_ERROR',
        });
        return { ok: false, status: 'reconciliation_error', reason: 'RECONCILIATION_ERROR', batchId, executionId: execId };
      }
      return { ok: true, status: 'processed', reason: 'EXECUTION_ALREADY_COMPLETED', batchId, executionId: execId, runId: execId };
    }

    if (reason === 'retry_not_ready') {
      return { ok: false, status: 'skipped', reason: 'EXECUTION_RETRY_NOT_READY', batchId };
    }

    if (reason === 'already_failed') {
      await deps.markBatchFailed({ svc, companyId, batchId, lockedAt, errorCode: 'EXECUTION_ALREADY_FAILED' }).catch(() => {});
      return { ok: false, status: 'failed', reason: 'EXECUTION_ALREADY_FAILED', batchId };
    }

    if (reason === 'already_cancelled') {
      await deps.markBatchCancelled({ svc, companyId, batchId, lockedAt, reason: 'EXECUTION_ALREADY_CANCELLED' }).catch(() => {});
      return { ok: false, status: 'cancelled', reason: 'EXECUTION_ALREADY_CANCELLED', batchId };
    }

    return { ok: false, status: 'skipped', reason: claim.reason ?? 'UNKNOWN_CLAIM_REASON', batchId };
  }

  const { executionId, claimToken } = claim;
  const runId = executionId; // identificador estável — nunca gerar novo UUID aqui

  // ── STEP 5: Executar agente ───────────────────────────────────────────────
  const groupedMessages = buildGroupedMessages(messages);

  let execResult = null;
  let execError  = null;

  try {
    execResult = await deps.executeAgent({
      svc,
      companyId,
      conversationId,
      assignmentId:  effectiveAssignmentId,
      agentId,
      instanceId,              // Etapa 13: instância validada e obrigatória
      batchId,
      executionId,
      runId,                   // runId = executionId — estável, sem novo UUID
      source:        'message_buffer',
      groupedMessages,
    });
  } catch (thrown) {
    execError = thrown;
  }

  // ── STEP 6: Tratar resultado ──────────────────────────────────────────────
  const isSuccess = !execError && execResult?.ok === true;

  if (isSuccess) {
    // SUCESSO: marcar execução primeiro, depois lote (ordem crítica para reconciliação)
    let executionMarked = false;
    try {
      await deps.markBatchExecutionCompleted({ svc, companyId, batchId, claimToken });
      executionMarked = true;
      await deps.markBatchProcessed({ svc, companyId, batchId, lockedAt });
    } catch {
      const code = executionMarked ? 'RECONCILIATION_ERROR' : 'MARK_EXECUTION_FAILED';
      console.error(`🤖 [PIPE] ❌ ${OP}: falha ao marcar sucesso`, {
        operation:    OP,
        company_id:   companyId,
        batch_id:     batchId,
        execution_id: executionId,
        error_code:   code,
      });
      return { ok: false, status: 'reconciliation_error', reason: code, batchId, executionId, runId };
    }

    const durationMs = Date.now() - startMs;
    console.log(`🤖 [PIPE] ✅ ${OP}: processado com sucesso`, {
      operation:       OP,
      company_id:      companyId,
      conversation_id: conversationId,
      batch_id:        batchId,
      execution_id:    executionId,
      batch_status:    'processed',
      execution_status:'completed',
      message_count:   messages.length,
      duration_ms:     durationMs,
    });
    return { ok: true, status: 'processed', batchId, executionId, runId };
  }

  // FALHA: classificar e coordenar estado entre execução e lote
  const error     = execError ?? { retryable: execResult?.retryable ?? false, code: execResult?.errorCode, message: execResult?.errorMessage };
  const category  = classifyExecutionFailure(error);
  const errorCode = sanitizeCode(error?.code ?? error?.errorCode);
  const errorMsg  = sanitizeMessage(error?.message ?? error?.errorMessage);

  console.error(`🤖 [PIPE] ❌ ${OP}: executeAgent falhou`, {
    operation:    OP,
    company_id:   companyId,
    batch_id:     batchId,
    execution_id: executionId,
    error_code:   errorCode,
    category,
  });

  if (category === 'retryable') {
    let retryExec;
    try {
      retryExec = await deps.markBatchExecutionRetry({
        svc, companyId, batchId, claimToken, errorCode, errorMessage: errorMsg,
      });
    } catch {
      return { ok: false, status: 'reconciliation_error', reason: 'MARK_EXECUTION_FAILED', batchId, executionId };
    }

    const execStatus = retryExec?.status;

    if (execStatus === 'retry_pending') {
      await deps.markBatchRetry({ svc, companyId, batchId, lockedAt, errorCode, errorMessage: errorMsg }).catch(() => {});
      return { ok: false, status: 'retry_pending', reason: 'EXECUTION_RETRY_SCHEDULED', batchId, executionId };
    }

    // execStatus === 'failed' — limite de tentativas atingido na RPC
    await deps.markBatchFailed({ svc, companyId, batchId, lockedAt, errorCode, errorMessage: errorMsg }).catch(() => {});
    return { ok: false, status: 'failed', reason: 'EXECUTION_FAILED', batchId, executionId };
  }

  if (category === 'cancel') {
    await deps.markBatchExecutionCancelled({ svc, companyId, batchId, claimToken, reason: errorCode }).catch(() => {});
    await deps.markBatchCancelled({ svc, companyId, batchId, lockedAt, reason: errorCode }).catch(() => {});
    return { ok: false, status: 'cancelled', reason: 'EXECUTION_CANCELLED', batchId, executionId };
  }

  // terminal
  await deps.markBatchExecutionFailed({ svc, companyId, batchId, claimToken, errorCode, errorMessage: errorMsg }).catch(() => {});
  await deps.markBatchFailed({ svc, companyId, batchId, lockedAt, errorCode, errorMessage: errorMsg }).catch(() => {});
  return { ok: false, status: 'failed', reason: 'EXECUTION_FAILED', batchId, executionId };
}
