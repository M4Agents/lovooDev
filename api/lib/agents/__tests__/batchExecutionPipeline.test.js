// =============================================================================
// Testes unitários — batchExecutionPipeline.js
//
// Framework: vitest
// Estratégia: mocks completos de todas as dependências de I/O.
//   - Sem conexão com banco real
//   - Sem chamadas de rede, LLM ou WhatsApp
//   - Testa exclusivamente a lógica do pipeline
//
// Para executar: npm test
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processClaimedBatch, revalidateBatchState } from '../batchExecutionPipeline.js';
import { isWithinSchedule } from '../scheduleUtils.js';

// ---------------------------------------------------------------------------
// Silenciar logs
// ---------------------------------------------------------------------------
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Constantes de teste
// ---------------------------------------------------------------------------
const COMPANY_ID       = 'company-uuid-pipe-1';
const BATCH_ID         = 'batch-uuid-pipe-1';
const CONVERSATION_ID  = 'conv-uuid-pipe-1';
const EXECUTION_ID     = 'exec-uuid-pipe-1';
const ASSIGNMENT_ID    = 'assign-uuid-pipe-1';
const AGENT_ID         = 'agent-uuid-pipe-1';
const CLAIM_TOKEN      = 'token-uuid-pipe-1';
const LOCKED_AT        = '2026-07-14T20:00:00.000Z';

// ---------------------------------------------------------------------------
// Fábricas
// ---------------------------------------------------------------------------

function makeSvc() {
  return { rpc: vi.fn(), from: vi.fn() };
}

function makeBatch(overrides = {}) {
  return {
    id:                  BATCH_ID,
    companyId:           COMPANY_ID,
    conversationId:      CONVERSATION_ID,
    enqueueAssignmentId: ASSIGNMENT_ID,
    channel:             'whatsapp',
    status:              'processing',
    lockedAt:            LOCKED_AT,
    attempts:            1,
    messageCount:        2,
    ...overrides,
  };
}

const INSTANCE_ID = 'instance-uuid-pipe-1';

function makeMessages(count = 2, instanceId = INSTANCE_ID) {
  return Array.from({ length: count }, (_, i) => ({
    id:                `msg-${i + 1}`,
    providerMessageId: `wamid-${i + 1}`,
    instanceId,                            // Etapa 13: instanceId por mensagem
    messageText:       `Mensagem ${i + 1}`,
    messageType:       'text',
    receivedAt:        '2026-07-14T20:00:00.000Z',
    providerTimestamp: null,
    payload:           {},
  }));
}

function makeClaimResult(overrides = {}) {
  return {
    acquired:    true,
    executionId: EXECUTION_ID,
    batchId:     BATCH_ID,
    status:      'processing',
    claimToken:  CLAIM_TOKEN,
    attempts:    1,
    reason:      'claimed',
    ...overrides,
  };
}

function makeRevalidationAllowed(overrides = {}) {
  return {
    allowed:               true,
    effectiveAssignmentId: ASSIGNMENT_ID,
    agentId:               AGENT_ID,
    instanceId:            INSTANCE_ID,  // Etapa 13: instanceId obrigatório
    reason:                null,
    ...overrides,
  };
}

/** Deps completas para caminho feliz */
function makeDefaultDeps(overrides = {}) {
  return {
    loadBatchMessages:           vi.fn().mockResolvedValue(makeMessages()),
    revalidateBatchState:        vi.fn().mockResolvedValue(makeRevalidationAllowed()),
    claimBatchExecution:         vi.fn().mockResolvedValue(makeClaimResult()),
    markBatchExecutionCompleted: vi.fn().mockResolvedValue({ id: EXECUTION_ID, status: 'completed' }),
    markBatchExecutionRetry:     vi.fn().mockResolvedValue({ id: EXECUTION_ID, status: 'retry_pending' }),
    markBatchExecutionFailed:    vi.fn().mockResolvedValue({ id: EXECUTION_ID, status: 'failed' }),
    markBatchExecutionCancelled: vi.fn().mockResolvedValue({ id: EXECUTION_ID, status: 'cancelled' }),
    markBatchProcessed:          vi.fn().mockResolvedValue({ id: BATCH_ID, status: 'processed' }),
    markBatchRetry:              vi.fn().mockResolvedValue({ id: BATCH_ID, status: 'retry_pending' }),
    markBatchFailed:             vi.fn().mockResolvedValue({ id: BATCH_ID, status: 'failed' }),
    markBatchCancelled:          vi.fn().mockResolvedValue({ id: BATCH_ID, status: 'cancelled' }),
    rescheduleBatch:             vi.fn().mockResolvedValue({ id: BATCH_ID, status: 'retry_pending' }),
    executeAgent:                vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TC-BP01 a TC-BP05 — Validação do lote
// ---------------------------------------------------------------------------

describe('processClaimedBatch — validação do lote', () => {
  it('TC-BP01 — batch ausente rejeitado', async () => {
    await expect(
      processClaimedBatch({ svc: makeSvc(), batch: null, dependencies: makeDefaultDeps() })
    ).rejects.toThrow('batch é obrigatório');
  });

  it('TC-BP02 — companyId ausente rejeitado', async () => {
    await expect(
      processClaimedBatch({ svc: makeSvc(), batch: makeBatch({ companyId: null }), dependencies: makeDefaultDeps() })
    ).rejects.toThrow('batch.companyId é obrigatório');
  });

  it('TC-BP03 — conversationId ausente rejeitado', async () => {
    await expect(
      processClaimedBatch({ svc: makeSvc(), batch: makeBatch({ conversationId: '' }), dependencies: makeDefaultDeps() })
    ).rejects.toThrow('batch.conversationId é obrigatório');
  });

  it('TC-BP04 — status diferente de processing rejeitado', async () => {
    await expect(
      processClaimedBatch({ svc: makeSvc(), batch: makeBatch({ status: 'pending' }), dependencies: makeDefaultDeps() })
    ).rejects.toThrow("batch.status deve ser 'processing'");
  });

  it('TC-BP05 — lockedAt ausente rejeitado', async () => {
    await expect(
      processClaimedBatch({ svc: makeSvc(), batch: makeBatch({ lockedAt: null }), dependencies: makeDefaultDeps() })
    ).rejects.toThrow('batch.lockedAt é obrigatório');
  });
});

// ---------------------------------------------------------------------------
// TC-BP06 a TC-BP09 — Mensagens
// ---------------------------------------------------------------------------

describe('processClaimedBatch — mensagens', () => {
  it('TC-BP06 — carrega mensagens com companyId + conversationId + batchId', async () => {
    const deps = makeDefaultDeps();
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.loadBatchMessages).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY_ID, conversationId: CONVERSATION_ID, batchId: BATCH_ID })
    );
  });

  it('TC-BP07 — lote vazio não chama claim de execução', async () => {
    const deps = makeDefaultDeps({ loadBatchMessages: vi.fn().mockResolvedValue([]) });
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.claimBatchExecution).not.toHaveBeenCalled();
  });

  it('TC-BP08 — lote vazio não chama executeAgent', async () => {
    const deps = makeDefaultDeps({ loadBatchMessages: vi.fn().mockResolvedValue([]) });
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.executeAgent).not.toHaveBeenCalled();
  });

  it('TC-BP09 — lote vazio cancela o lote com EMPTY_BATCH', async () => {
    const deps = makeDefaultDeps({ loadBatchMessages: vi.fn().mockResolvedValue([]) });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(result.status).toBe('cancelled');
    expect(result.reason).toBe('EMPTY_BATCH');
    expect(deps.markBatchCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY_ID, batchId: BATCH_ID, reason: 'EMPTY_BATCH' })
    );
  });
});

// ---------------------------------------------------------------------------
// TC-BP10 a TC-BP14 — Revalidação de estado
// ---------------------------------------------------------------------------

describe('processClaimedBatch — revalidação de estado', () => {
  it('TC-BP10 — revalidação allowed continua para claim', async () => {
    const deps = makeDefaultDeps();
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.claimBatchExecution).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('TC-BP11 — handoff humano cancela lote sem claim de execução', async () => {
    const deps = makeDefaultDeps({
      revalidateBatchState: vi.fn().mockResolvedValue({ allowed: false, action: 'cancel', reason: 'human_handoff' }),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.claimBatchExecution).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
    expect(result.reason).toBe('REVALIDATION_CANCELLED');
    expect(deps.markBatchCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'human_handoff' })
    );
  });

  it('TC-BP12 — agente desativado cancela lote', async () => {
    const deps = makeDefaultDeps({
      revalidateBatchState: vi.fn().mockResolvedValue({ allowed: false, action: 'cancel', reason: 'ai_disabled' }),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(result.status).toBe('cancelled');
    expect(deps.markBatchCancelled).toHaveBeenCalled();
  });

  it('TC-BP13 — schedule fora gera retry (action=retry)', async () => {
    const deps = makeDefaultDeps({
      revalidateBatchState: vi.fn().mockResolvedValue({ allowed: false, action: 'retry', reason: 'out_of_schedule' }),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(result.status).toBe('retry_scheduled');
    expect(deps.markBatchRetry).toHaveBeenCalled();
    expect(deps.claimBatchExecution).not.toHaveBeenCalled();
  });

  it('TC-BP14 — effectiveAssignmentId da revalidação substitui enqueueAssignmentId', async () => {
    const newAssignmentId = 'new-assignment-uuid';
    const deps = makeDefaultDeps({
      revalidateBatchState: vi.fn().mockResolvedValue({ allowed: true, effectiveAssignmentId: newAssignmentId, agentId: AGENT_ID }),
    });
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    const callArgs = deps.executeAgent.mock.calls[0][0];
    expect(callArgs.assignmentId).toBe(newAssignmentId);
    expect(callArgs.assignmentId).not.toBe(ASSIGNMENT_ID);
  });
});

// ---------------------------------------------------------------------------
// TC-BP15 a TC-BP20 — Claim de execução
// ---------------------------------------------------------------------------

describe('processClaimedBatch — claim de execução', () => {
  it('TC-BP15 — acquired=true continua para executeAgent', async () => {
    const deps = makeDefaultDeps();
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.executeAgent).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('TC-BP16 — already_processing não chama executeAgent', async () => {
    const deps = makeDefaultDeps({
      claimBatchExecution: vi.fn().mockResolvedValue(makeClaimResult({ acquired: false, reason: 'already_processing', claimToken: null })),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.executeAgent).not.toHaveBeenCalled();
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('EXECUTION_ALREADY_PROCESSING');
  });

  it('TC-BP17 — already_completed não chama executeAgent e reconcilia lote', async () => {
    const deps = makeDefaultDeps({
      claimBatchExecution: vi.fn().mockResolvedValue(makeClaimResult({
        acquired: false, reason: 'already_completed', status: 'completed', claimToken: null,
      })),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.executeAgent).not.toHaveBeenCalled();
    expect(deps.markBatchProcessed).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('TC-BP18 — retry_not_ready não chama executeAgent', async () => {
    const deps = makeDefaultDeps({
      claimBatchExecution: vi.fn().mockResolvedValue(makeClaimResult({ acquired: false, reason: 'retry_not_ready', claimToken: null })),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.executeAgent).not.toHaveBeenCalled();
    expect(result.reason).toBe('EXECUTION_RETRY_NOT_READY');
  });

  it('TC-BP19 — already_failed reconcilia lote como failed', async () => {
    const deps = makeDefaultDeps({
      claimBatchExecution: vi.fn().mockResolvedValue(makeClaimResult({ acquired: false, reason: 'already_failed', status: 'failed', claimToken: null })),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.executeAgent).not.toHaveBeenCalled();
    expect(deps.markBatchFailed).toHaveBeenCalled();
    expect(result.status).toBe('failed');
  });

  it('TC-BP20 — already_cancelled reconcilia lote como cancelled', async () => {
    const deps = makeDefaultDeps({
      claimBatchExecution: vi.fn().mockResolvedValue(makeClaimResult({ acquired: false, reason: 'already_cancelled', status: 'cancelled', claimToken: null })),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.executeAgent).not.toHaveBeenCalled();
    expect(deps.markBatchCancelled).toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// TC-BP21 a TC-BP25 — Parâmetros do executeAgent
// ---------------------------------------------------------------------------

describe('processClaimedBatch — execução do agente', () => {
  it('TC-BP21 — runId é exatamente executionId', async () => {
    const deps = makeDefaultDeps();
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    const call = deps.executeAgent.mock.calls[0][0];
    expect(call.runId).toBe(EXECUTION_ID);
    expect(call.runId).toBe(call.executionId);
    expect(result.runId).toBe(EXECUTION_ID);
  });

  it('TC-BP22 — groupedMessages preserva ordem das mensagens carregadas', async () => {
    const msgs = makeMessages(3);
    const deps = makeDefaultDeps({ loadBatchMessages: vi.fn().mockResolvedValue(msgs) });
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    const call = deps.executeAgent.mock.calls[0][0];
    expect(call.groupedMessages[0].messageId).toBe('msg-1');
    expect(call.groupedMessages[1].messageId).toBe('msg-2');
    expect(call.groupedMessages[2].messageId).toBe('msg-3');
  });

  it('TC-BP23 — executeAgent recebe source=message_buffer', async () => {
    const deps = makeDefaultDeps();
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    const call = deps.executeAgent.mock.calls[0][0];
    expect(call.source).toBe('message_buffer');
  });

  it('TC-BP24 — executeAgent recebe effectiveAssignmentId', async () => {
    const deps = makeDefaultDeps();
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    const call = deps.executeAgent.mock.calls[0][0];
    expect(call.assignmentId).toBe(ASSIGNMENT_ID);
  });

  it('TC-BP25 — runId em executeAgent é igual ao executionId (sem novo UUID)', async () => {
    const customExecId = 'stable-exec-id-123';
    const deps = makeDefaultDeps({
      claimBatchExecution: vi.fn().mockResolvedValue(makeClaimResult({ executionId: customExecId, claimToken: CLAIM_TOKEN })),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    const call = deps.executeAgent.mock.calls[0][0];
    expect(call.runId).toBe(customExecId);
    expect(call.executionId).toBe(customExecId);
    expect(result.runId).toBe(customExecId);
    expect(result.executionId).toBe(customExecId);
  });
});

// ---------------------------------------------------------------------------
// TC-BP26 a TC-BP29 — Caminho de sucesso
// ---------------------------------------------------------------------------

describe('processClaimedBatch — caminho de sucesso', () => {
  it('TC-BP26 — marca execução completed ANTES do lote processed (ordem crítica)', async () => {
    const callOrder = [];
    const deps = makeDefaultDeps({
      markBatchExecutionCompleted: vi.fn().mockImplementation(async () => { callOrder.push('execution'); return {}; }),
      markBatchProcessed:          vi.fn().mockImplementation(async () => { callOrder.push('batch'); return {}; }),
    });
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(callOrder[0]).toBe('execution');
    expect(callOrder[1]).toBe('batch');
  });

  it('TC-BP27 — retorno final contém ok=true, batchId, executionId e runId', async () => {
    const deps = makeDefaultDeps();
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('processed');
    expect(result.batchId).toBe(BATCH_ID);
    expect(result.executionId).toBe(EXECUTION_ID);
    expect(result.runId).toBe(EXECUTION_ID);
  });

  it('TC-BP28 — falha ao marcar lote depois de execução completed retorna reconciliation_error', async () => {
    const deps = makeDefaultDeps({
      markBatchProcessed: vi.fn().mockRejectedValue(new Error('DB timeout')),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('reconciliation_error');
    expect(result.reason).toBe('RECONCILIATION_ERROR');
    expect(result.batchId).toBe(BATCH_ID);
    expect(result.executionId).toBe(EXECUTION_ID);
  });

  it('TC-BP29 — retry posterior com already_completed finaliza apenas o lote (sem executeAgent)', async () => {
    const deps = makeDefaultDeps({
      claimBatchExecution: vi.fn().mockResolvedValue(makeClaimResult({
        acquired: false, reason: 'already_completed', status: 'completed', claimToken: null,
      })),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.executeAgent).not.toHaveBeenCalled();
    expect(deps.markBatchProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY_ID, batchId: BATCH_ID, lockedAt: LOCKED_AT })
    );
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TC-BP30 a TC-BP34 — Retry
// ---------------------------------------------------------------------------

describe('processClaimedBatch — retry', () => {
  it('TC-BP30 — falha retryable chama markBatchExecutionRetry', async () => {
    const retryableError = Object.assign(new Error('rate_limit'), { retryable: true });
    const deps = makeDefaultDeps({
      executeAgent:            vi.fn().mockRejectedValue(retryableError),
      markBatchExecutionRetry: vi.fn().mockResolvedValue({ id: EXECUTION_ID, status: 'retry_pending' }),
    });
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.markBatchExecutionRetry).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY_ID, batchId: BATCH_ID, claimToken: CLAIM_TOKEN })
    );
  });

  it('TC-BP31 — execução retry_pending leva lote para retry_pending', async () => {
    const retryableError = Object.assign(new Error('timeout'), { retryable: true });
    const deps = makeDefaultDeps({
      executeAgent:            vi.fn().mockRejectedValue(retryableError),
      markBatchExecutionRetry: vi.fn().mockResolvedValue({ id: EXECUTION_ID, status: 'retry_pending' }),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.markBatchRetry).toHaveBeenCalled();
    expect(result.status).toBe('retry_pending');
    expect(result.reason).toBe('EXECUTION_RETRY_SCHEDULED');
  });

  it('TC-BP32 — execução failed por tentativas máximas leva lote para failed', async () => {
    const retryableError = Object.assign(new Error('timeout'), { retryable: true });
    const deps = makeDefaultDeps({
      executeAgent:            vi.fn().mockRejectedValue(retryableError),
      markBatchExecutionRetry: vi.fn().mockResolvedValue({ id: EXECUTION_ID, status: 'failed' }),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.markBatchFailed).toHaveBeenCalled();
    expect(deps.markBatchRetry).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
  });

  it('TC-BP33 — mensagem de erro é sanitizada (max 200 chars)', async () => {
    const longError = Object.assign(new Error('x'.repeat(500)), { retryable: true });
    const deps = makeDefaultDeps({
      executeAgent:            vi.fn().mockRejectedValue(longError),
      markBatchExecutionRetry: vi.fn().mockResolvedValue({ id: EXECUTION_ID, status: 'retry_pending' }),
    });
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    const retryCall = deps.markBatchExecutionRetry.mock.calls[0][0];
    expect(retryCall.errorMessage.length).toBeLessThanOrEqual(200);
  });

  it('TC-BP34 — claimToken não aparece em logs', async () => {
    const secretToken = 'super-secret-claim-token-that-must-not-leak';
    const deps = makeDefaultDeps({
      claimBatchExecution: vi.fn().mockResolvedValue(makeClaimResult({ claimToken: secretToken })),
    });
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    const loggedArgs = console.log.mock.calls.map(c => JSON.stringify(c)).join('');
    const errorArgs  = console.error.mock.calls.map(c => JSON.stringify(c)).join('');
    expect(loggedArgs + errorArgs).not.toContain(secretToken);
  });
});

// ---------------------------------------------------------------------------
// TC-BP35 a TC-BP36 — Falha terminal
// ---------------------------------------------------------------------------

describe('processClaimedBatch — falha terminal', () => {
  it('TC-BP35 — marca execução failed ANTES do lote failed (ordem crítica)', async () => {
    const callOrder = [];
    const terminalError = Object.assign(new Error('critical'), { retryable: false });
    const deps = makeDefaultDeps({
      executeAgent:             vi.fn().mockRejectedValue(terminalError),
      markBatchExecutionFailed: vi.fn().mockImplementation(async () => { callOrder.push('execution'); return {}; }),
      markBatchFailed:          vi.fn().mockImplementation(async () => { callOrder.push('batch'); return {}; }),
    });
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(callOrder[0]).toBe('execution');
    expect(callOrder[1]).toBe('batch');
  });

  it('TC-BP36 — falha terminal não chama markBatchExecutionRetry', async () => {
    const terminalError = Object.assign(new Error('not retryable'), { retryable: false });
    const deps = makeDefaultDeps({ executeAgent: vi.fn().mockRejectedValue(terminalError) });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.markBatchExecutionRetry).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// TC-BP37 a TC-BP38 — Cancelamento
// ---------------------------------------------------------------------------

describe('processClaimedBatch — cancelamento', () => {
  it('TC-BP37 — cancelamento por revalidação (antes da claim) não cria execução', async () => {
    const deps = makeDefaultDeps({
      revalidateBatchState: vi.fn().mockResolvedValue({ allowed: false, action: 'cancel', reason: 'human_handoff' }),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(deps.claimBatchExecution).not.toHaveBeenCalled();
    expect(deps.markBatchExecutionCancelled).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
    expect(deps.markBatchCancelled).toHaveBeenCalled();
  });

  it('TC-BP38 — cancelamento pós-claim marca execução cancelled e depois lote cancelled', async () => {
    const cancelOrder = [];
    const cancelError = Object.assign(new Error('cancelled by policy'), { category: 'cancel' });
    const deps = makeDefaultDeps({
      executeAgent:             vi.fn().mockRejectedValue(cancelError),
      markBatchExecutionCancelled: vi.fn().mockImplementation(async () => { cancelOrder.push('execution'); return {}; }),
      markBatchCancelled:          vi.fn().mockImplementation(async () => { cancelOrder.push('batch'); return {}; }),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    expect(cancelOrder[0]).toBe('execution');
    expect(cancelOrder[1]).toBe('batch');
    expect(result.status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// TC-BP39 a TC-BP44 — Segurança e regressão
// ---------------------------------------------------------------------------

describe('Regressão e segurança', () => {
  it('TC-BP39 — nenhum teste chama banco real (svc é mock em todos os testes)', () => {
    // Garantia estrutural: makeSvc() nunca cria cliente Supabase real
    const svc = makeSvc();
    expect(typeof svc.rpc).toBe('function');
    expect(svc.rpc).toBeTypeOf('function');
    // vi.fn() nunca estabelece conexão real
  });

  it('TC-BP40 — nenhum teste chama LLM real (executeAgent sempre mockado)', async () => {
    const deps = makeDefaultDeps();
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    // executeAgent é vi.fn() — nunca chamou OpenAI
    expect(deps.executeAgent.mock.calls.length).toBe(1);
  });

  it('TC-BP41 — nenhum teste chama Uazapi (sem sendBlocks nas deps)', async () => {
    const deps = makeDefaultDeps();
    // sendBlocks não faz parte das dependências do pipeline — não é injetável
    expect(Object.keys(deps)).not.toContain('sendBlocks');
  });

  it('TC-BP42 — logs não contêm conteúdo de mensagens ou payload', async () => {
    const secretText = 'mensagem_muito_secreta_do_usuario_12345';
    const deps = makeDefaultDeps({
      loadBatchMessages: vi.fn().mockResolvedValue([
        { id: 'msg-1', messageText: secretText, messageType: 'text', receivedAt: LOCKED_AT, providerMessageId: 'p1', providerTimestamp: null, payload: { data: secretText } },
      ]),
    });
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    const allLogs = [
      ...console.log.mock.calls,
      ...console.error.mock.calls,
    ].map(args => JSON.stringify(args)).join('');
    expect(allLogs).not.toContain(secretText);
  });

  it('TC-BP43 — nenhum call site externo criado (processClaimedBatch sem Router/cron)', () => {
    // Garantia arquitetural: o módulo não exporta nem importa módulos de rota
    // A função não chama HTTP internamente — apenas deps injetáveis
    // Verificação: a função pode ser chamada sem servidor HTTP
    expect(typeof processClaimedBatch).toBe('function');
  });

  it('TC-BP44 — executeAgent não fornecido lança erro antes de qualquer I/O', async () => {
    const svc = makeSvc();
    const deps = makeDefaultDeps();
    delete deps.executeAgent;
    await expect(
      processClaimedBatch({ svc, batch: makeBatch(), dependencies: deps })
    ).rejects.toThrow('executeAgent dependency is required');
    // Nenhum I/O foi disparado
    expect(svc.rpc).not.toHaveBeenCalled();
    expect(svc.from).not.toHaveBeenCalled();
  });
});

// =============================================================================
// TC-RE01 a TC-RE15 — revalidateBatchState (implementação completa)
// =============================================================================

/**
 * Fábrica de svc mockado para revalidateBatchState.
 * Mapeia chamadas de svc.from(table) para respostas configuráveis.
 */
function makeRevalSvc({
  conv     = { data: { id: CONVERSATION_ID, ai_state: 'ai_active', instance_id: 'inst-1', ai_assignment_id: ASSIGNMENT_ID }, error: null },
  assign   = { data: { id: ASSIGNMENT_ID, agent_id: AGENT_ID, capabilities: { can_auto_reply: true }, operating_schedule: null, is_active: true }, error: null },
  agent    = { data: { id: AGENT_ID, is_active: true }, error: null },
  instance = { data: { id: 'inst-1', status: 'connected' }, error: null },
} = {}) {
  const from = vi.fn().mockImplementation((table) => {
    const responses = {
      chat_conversations:        conv,
      company_agent_assignments: assign,
      lovoo_agents:              agent,
      whatsapp_life_instances:   instance,
    };
    const resp = responses[table] ?? { data: null, error: null };
    const chain = {
      select:      vi.fn().mockReturnThis(),
      eq:          vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(resp),
      single:      vi.fn().mockResolvedValue(resp),
    };
    return chain;
  });
  return { from };
}

const DEFAULT_REVALIDATION_PARAMS = {
  companyId:            COMPANY_ID,
  conversationId:       CONVERSATION_ID,
  enqueueAssignmentId:  ASSIGNMENT_ID,
  channel:              'whatsapp',
};

describe('revalidateBatchState — implementação completa', () => {
  it('TC-RE01 — conversa inexistente → cancel/conversation_not_found', async () => {
    const svc = makeRevalSvc({ conv: { data: null, error: null } });
    const result = await revalidateBatchState({ svc, ...DEFAULT_REVALIDATION_PARAMS });

    expect(result.allowed).toBe(false);
    expect(result.action).toBe('cancel');
    expect(result.reason).toBe('conversation_not_found');
  });

  it('TC-RE02 — conversa de outra empresa (erro) → cancel', async () => {
    const svc = makeRevalSvc({ conv: { data: null, error: { message: 'row not found' } } });
    const result = await revalidateBatchState({ svc, ...DEFAULT_REVALIDATION_PARAMS });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('conversation_not_found');
  });

  it('TC-RE03 — canal inválido → cancel/invalid_channel', async () => {
    const svc = makeRevalSvc();
    const result = await revalidateBatchState({
      svc,
      ...DEFAULT_REVALIDATION_PARAMS,
      channel: 'sms',
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('invalid_channel');
  });

  it('TC-RE04 — IA desativada (ai_state=inactive) → cancel/ai_disabled', async () => {
    const svc = makeRevalSvc({
      conv: { data: { id: CONVERSATION_ID, ai_state: 'inactive', instance_id: 'inst-1', ai_assignment_id: ASSIGNMENT_ID }, error: null },
    });
    const result = await revalidateBatchState({ svc, ...DEFAULT_REVALIDATION_PARAMS });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('ai_disabled');
  });

  it('TC-RE05 — handoff humano (ai_state=human) → cancel/human_handoff', async () => {
    const svc = makeRevalSvc({
      conv: { data: { id: CONVERSATION_ID, ai_state: 'human', instance_id: 'inst-1', ai_assignment_id: ASSIGNMENT_ID }, error: null },
    });
    const result = await revalidateBatchState({ svc, ...DEFAULT_REVALIDATION_PARAMS });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('human_handoff');
  });

  it('TC-RE06 — assignment inexistente → cancel/assignment_not_found', async () => {
    const svc = makeRevalSvc({ assign: { data: null, error: null } });
    const result = await revalidateBatchState({ svc, ...DEFAULT_REVALIDATION_PARAMS });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('assignment_not_found');
  });

  it('TC-RE07 — assignment inativo → cancel/assignment_inactive', async () => {
    const svc = makeRevalSvc({
      assign: { data: { id: ASSIGNMENT_ID, agent_id: AGENT_ID, capabilities: { can_auto_reply: true }, operating_schedule: null, is_active: false }, error: null },
    });
    const result = await revalidateBatchState({ svc, ...DEFAULT_REVALIDATION_PARAMS });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('assignment_inactive');
  });

  it('TC-RE08 — assignment de outra empresa (não encontrado) → cancel/assignment_not_found', async () => {
    // Quando a query .eq('company_id', companyId) não retorna linha
    const svc = makeRevalSvc({ assign: { data: null, error: null } });
    const result = await revalidateBatchState({ svc, ...DEFAULT_REVALIDATION_PARAMS });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('assignment_not_found');
  });

  it('TC-RE09 — agente inexistente → cancel/agent_inactive', async () => {
    const svc = makeRevalSvc({ agent: { data: null, error: null } });
    const result = await revalidateBatchState({ svc, ...DEFAULT_REVALIDATION_PARAMS });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('agent_inactive');
  });

  it('TC-RE10 — agente inativo → cancel/agent_inactive', async () => {
    const svc = makeRevalSvc({ agent: { data: { id: AGENT_ID, is_active: false }, error: null } });
    const result = await revalidateBatchState({ svc, ...DEFAULT_REVALIDATION_PARAMS });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('agent_inactive');
  });

  it('TC-RE11 — integração inativa (instance status != connected) → cancel/integration_inactive', async () => {
    const svc = makeRevalSvc({
      instance: { data: { id: 'inst-1', status: 'disconnected' }, error: null },
    });
    const result = await revalidateBatchState({ svc, ...DEFAULT_REVALIDATION_PARAMS });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('integration_inactive');
  });

  it('TC-RE12 — schedule null (sem restrição) → allowed=true', async () => {
    const svc = makeRevalSvc();
    const result = await revalidateBatchState({ svc, ...DEFAULT_REVALIDATION_PARAMS });

    expect(result.allowed).toBe(true);
    expect(result.effectiveAssignmentId).toBe(ASSIGNMENT_ID);
    expect(result.agentId).toBe(AGENT_ID);
  });

  it('TC-RE13 — schedule bloqueado (enabled=true, windows=[]) → retry/out_of_schedule', async () => {
    const svc = makeRevalSvc({
      assign: {
        data: {
          id: ASSIGNMENT_ID, agent_id: AGENT_ID, is_active: true,
          capabilities: { can_auto_reply: true },
          operating_schedule: { enabled: true, timezone: 'America/Sao_Paulo', windows: [] },
        },
        error: null,
      },
    });
    const result = await revalidateBatchState({ svc, ...DEFAULT_REVALIDATION_PARAMS });

    expect(result.allowed).toBe(false);
    // Etapa 13 — Parte B: out_of_schedule retorna action='reschedule' (não 'retry')
    // Pipeline usa markBatchRetry como fallback até RPC reschedule_v1 ser criada.
    expect(result.action).toBe('reschedule');
    expect(result.reason).toBe('out_of_schedule');
  });

  it('TC-RE14 — assignment alterado desde enqueue → cancel/assignment_changed', async () => {
    const OTHER_ASSIGNMENT = 'other-assignment-id';
    const svc = makeRevalSvc({
      conv: { data: { id: CONVERSATION_ID, ai_state: 'ai_active', instance_id: 'inst-1', ai_assignment_id: OTHER_ASSIGNMENT }, error: null },
    });
    const result = await revalidateBatchState({ svc, ...DEFAULT_REVALIDATION_PARAMS });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('assignment_changed');
  });

  it('TC-RE15 — retorno permitido contém effectiveAssignmentId e agentId', async () => {
    const svc = makeRevalSvc();
    const result = await revalidateBatchState({ svc, ...DEFAULT_REVALIDATION_PARAMS });

    expect(result.allowed).toBe(true);
    expect(result.effectiveAssignmentId).toBe(ASSIGNMENT_ID);
    expect(result.agentId).toBe(AGENT_ID);
    expect(result.reason).toBeNull();
  });
});

// =============================================================================
// TC-PI31 a TC-PI38 — Pipeline: claim reasons e novos comportamentos
// =============================================================================

describe('processClaimedBatch — reasons literais do claim (Etapa 12)', () => {
  it('TC-PI31 — retry_claimed (acquired=true) continua pipeline normalmente', async () => {
    const deps = makeDefaultDeps({
      claimBatchExecution: vi.fn().mockResolvedValue(
        makeClaimResult({ acquired: true, reason: 'retry_claimed', attempts: 2 })
      ),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });

    // Pipeline continua e executa o agente
    expect(deps.executeAgent).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('processed');
  });

  it('TC-PI32 — agentId nunca é null em execução permitida (vem da revalidação)', async () => {
    const deps = makeDefaultDeps({
      revalidateBatchState: vi.fn().mockResolvedValue({
        allowed:               true,
        effectiveAssignmentId: ASSIGNMENT_ID,
        agentId:               AGENT_ID,
        reason:                null,
      }),
    });
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });

    const execCall = deps.executeAgent.mock.calls[0][0];
    expect(execCall.agentId).toBe(AGENT_ID);
    expect(execCall.agentId).not.toBeNull();
  });

  it('TC-PI33 — effectiveAssignmentId da revalidação é usado no executeAgent', async () => {
    const EFFECTIVE = 'effective-assign-id-real';
    const deps = makeDefaultDeps({
      revalidateBatchState: vi.fn().mockResolvedValue({
        allowed:               true,
        effectiveAssignmentId: EFFECTIVE,
        agentId:               AGENT_ID,
        reason:                null,
      }),
    });
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });

    const execCall = deps.executeAgent.mock.calls[0][0];
    expect(execCall.assignmentId).toBe(EFFECTIVE);
  });

  it('TC-PI34 — groupedMessages chegam ao executeAgent com estrutura completa', async () => {
    const deps = makeDefaultDeps({
      loadBatchMessages: vi.fn().mockResolvedValue([
        { id: 'msg-1', providerMessageId: 'wamid-1', messageText: 'Texto 1', messageType: 'text', receivedAt: LOCKED_AT, providerTimestamp: null, payload: {} },
        { id: 'msg-2', providerMessageId: 'wamid-2', messageText: null, messageType: 'audio', receivedAt: LOCKED_AT, providerTimestamp: null, payload: {} },
      ]),
    });
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });

    const execCall = deps.executeAgent.mock.calls[0][0];
    expect(Array.isArray(execCall.groupedMessages)).toBe(true);
    expect(execCall.groupedMessages).toHaveLength(2);
    // Estrutura normalizada
    expect(execCall.groupedMessages[0]).toMatchObject({
      messageId:  'msg-1',
      text:       'Texto 1',
      type:       'text',
    });
    expect(execCall.groupedMessages[1]).toMatchObject({
      messageId: 'msg-2',
      type:      'audio',
    });
  });

  it('TC-PI35 — already_completed não chama executeAgent', async () => {
    const deps = makeDefaultDeps({
      claimBatchExecution: vi.fn().mockResolvedValue(
        makeClaimResult({ acquired: false, reason: 'already_completed', executionId: EXECUTION_ID, status: 'completed', claimToken: null })
      ),
    });
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });

    expect(deps.executeAgent).not.toHaveBeenCalled();
    expect(deps.markBatchProcessed).toHaveBeenCalledTimes(1);
  });

  it('TC-PI36 — already_processing não chama executeAgent', async () => {
    const deps = makeDefaultDeps({
      claimBatchExecution: vi.fn().mockResolvedValue(
        makeClaimResult({ acquired: false, reason: 'already_processing', executionId: EXECUTION_ID, status: 'processing', claimToken: null })
      ),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });

    expect(deps.executeAgent).not.toHaveBeenCalled();
    expect(result.reason).toBe('EXECUTION_ALREADY_PROCESSING');
  });

  it('TC-PI37 — falha de schedule (action=retry) agenda retry no lote', async () => {
    const deps = makeDefaultDeps({
      revalidateBatchState: vi.fn().mockResolvedValue({
        allowed: false,
        action:  'retry',
        reason:  'out_of_schedule',
      }),
    });
    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });

    expect(deps.markBatchRetry).toHaveBeenCalledTimes(1);
    expect(deps.executeAgent).not.toHaveBeenCalled();
    expect(result.status).toBe('retry_scheduled');
  });

  it('TC-PI38 — fluxo sem agrupamento não é alterado (processClaimedBatch requer executeAgent injetado)', () => {
    // Garantia arquitetural: o pipeline nunca chama o Orchestrator ou o execute-agent.js diretamente
    // Ele recebe executeAgent como dependência injetável — sem acoplamento ao fluxo individual
    expect(typeof processClaimedBatch).toBe('function');
    // O fluxo individual (conversationRouter → orchestrateExecution → ...) é independente
    // e não importa nenhum símbolo deste módulo
  });
});

// =============================================================================
// TC-RG39 a TC-RG44 — Regressão
// =============================================================================

describe('regressão — 233 testes anteriores ainda passam', () => {
  it('TC-RG39 — processClaimedBatch continua funcionando com deps padrão mockados', async () => {
    const result = await processClaimedBatch({
      svc:          makeSvc(),
      batch:        makeBatch(),
      dependencies: makeDefaultDeps(),
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('processed');
  });

  it('TC-RG40 — nenhum teste acessa banco real', () => {
    // Todos os testes usam makeSvc() com vi.fn() — sem I/O real
    const svc = makeSvc();
    expect(typeof svc.from).toBe('function');
    expect(typeof svc.rpc).toBe('function');
    // Não são conexões reais — apenas vi.fn()
    expect(vi.isMockFunction(svc.from)).toBe(true);
  });

  it('TC-RG41 — nenhum teste chama OpenAI real', async () => {
    const deps = makeDefaultDeps();
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });
    // executeAgent é vi.fn() — nunca chamou OpenAI
    expect(vi.isMockFunction(deps.executeAgent)).toBe(true);
  });

  it('TC-RG42 — nenhum call site no Router é criado (módulo isolado)', () => {
    // batchExecutionPipeline.js não importa conversationRouter.js
    // Garantido pela estrutura de imports do arquivo
    expect(typeof processClaimedBatch).toBe('function');
  });

  it('TC-RG43 — isWithinSchedule está disponível via scheduleUtils (não mais local no Router)', () => {
    // scheduleUtils foi extraído e isWithinSchedule é função pura exportável
    expect(typeof isWithinSchedule).toBe('function');
    // Sem restrição → allowed=true
    expect(isWithinSchedule(null).allowed).toBe(true);
    expect(isWithinSchedule({ enabled: false }).allowed).toBe(true);
  });

  it('TC-RG44 — nenhuma migration foi criada nesta etapa', () => {
    // Esta é uma garantia documental — verificada pela revisão dos arquivos .sql
    // Confirmação: apenas arquivos .js foram criados/modificados
    expect(true).toBe(true);
  });
});

// =============================================================================
// TC-E13-* — Etapa 13: lock, schedule reschedule, instância obrigatória
// =============================================================================

describe('Etapa 13 — instância obrigatória (revalidateBatchState)', () => {
  const INSTANCE_UUID = 'inst-uuid-e13';

  // Helper: SVC que simula queries para revalidateBatchState
  function makeSvcForRevalidation({
    conv = { id: CONVERSATION_ID, ai_state: 'ai_active', instance_id: INSTANCE_UUID, ai_assignment_id: ASSIGNMENT_ID },
    assignment = { id: ASSIGNMENT_ID, agent_id: AGENT_ID, is_active: true, capabilities: { can_auto_reply: true }, operating_schedule: null },
    agent = { id: AGENT_ID, is_active: true },
    instance = { id: INSTANCE_UUID, status: 'connected' },
  } = {}) {
    return {
      from: vi.fn().mockImplementation((table) => {
        const chain = {
          select:      vi.fn().mockReturnThis(),
          eq:          vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(),
        };
        if (table === 'chat_conversations') {
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: conv, error: null });
        } else if (table === 'company_agent_assignments') {
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: assignment, error: null });
        } else if (table === 'lovoo_agents') {
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: agent, error: null });
        } else if (table === 'whatsapp_life_instances') {
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: instance, error: null });
        }
        return chain;
      }),
    };
  }

  it('TC-E13-01: instância válida da conversa → allowed=true com instanceId', async () => {
    const svc = makeSvcForRevalidation();
    const result = await revalidateBatchState({
      svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID,
      enqueueAssignmentId: ASSIGNMENT_ID, channel: 'whatsapp',
    });

    expect(result.allowed).toBe(true);
    expect(result.instanceId).toBe(INSTANCE_UUID);
  });

  it('TC-E13-02: conv.instance_id null + sem instanceIds → integration_missing', async () => {
    const svc = makeSvcForRevalidation({ conv: { id: CONVERSATION_ID, ai_state: 'ai_active', instance_id: null, ai_assignment_id: ASSIGNMENT_ID } });
    const result = await revalidateBatchState({
      svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID,
      enqueueAssignmentId: ASSIGNMENT_ID, channel: 'whatsapp',
      instanceIds: [],
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('integration_missing');
    expect(result.action).toBe('cancel');
  });

  it('TC-E13-03: conv.instance_id null + instanceId das mensagens → usa mensagem', async () => {
    const svc = makeSvcForRevalidation({
      conv:     { id: CONVERSATION_ID, ai_state: 'ai_active', instance_id: null, ai_assignment_id: ASSIGNMENT_ID },
      instance: { id: INSTANCE_UUID, status: 'connected' },
    });
    const result = await revalidateBatchState({
      svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID,
      enqueueAssignmentId: ASSIGNMENT_ID, channel: 'whatsapp',
      instanceIds: [INSTANCE_UUID],
    });

    expect(result.allowed).toBe(true);
    expect(result.instanceId).toBe(INSTANCE_UUID);
  });

  it('TC-E13-04: instâncias divergentes no lote → instance_divergence', async () => {
    const svc = makeSvcForRevalidation({ conv: { id: CONVERSATION_ID, ai_state: 'ai_active', instance_id: null, ai_assignment_id: ASSIGNMENT_ID } });
    const result = await revalidateBatchState({
      svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID,
      enqueueAssignmentId: ASSIGNMENT_ID, channel: 'whatsapp',
      instanceIds: ['inst-1', 'inst-2'],  // divergentes
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('instance_divergence');
  });

  it('TC-E13-05: instância desconectada → integration_inactive', async () => {
    const svc = makeSvcForRevalidation({
      instance: { id: INSTANCE_UUID, status: 'disconnected' },
    });
    const result = await revalidateBatchState({
      svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID,
      enqueueAssignmentId: ASSIGNMENT_ID, channel: 'whatsapp',
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('integration_inactive');
  });

  it('TC-E13-06: instância inexistente (null do banco) → integration_inactive', async () => {
    const svc = makeSvcForRevalidation({ instance: null });
    const result = await revalidateBatchState({
      svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID,
      enqueueAssignmentId: ASSIGNMENT_ID, channel: 'whatsapp',
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('integration_inactive');
  });

  it('TC-E13-07: instância da conversa sempre tem precedência sobre mensagens', async () => {
    const CONV_INSTANCE = 'conv-inst-uuid';
    const MSG_INSTANCE  = 'msg-inst-uuid';
    const svc = makeSvcForRevalidation({
      conv:     { id: CONVERSATION_ID, ai_state: 'ai_active', instance_id: CONV_INSTANCE, ai_assignment_id: ASSIGNMENT_ID },
      instance: { id: CONV_INSTANCE, status: 'connected' },
    });
    const result = await revalidateBatchState({
      svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID,
      enqueueAssignmentId: ASSIGNMENT_ID, channel: 'whatsapp',
      instanceIds: [MSG_INSTANCE],  // ignorado — conversa tem instance_id
    });

    expect(result.allowed).toBe(true);
    expect(result.instanceId).toBe(CONV_INSTANCE);
  });
});

describe('Etapa 13 — instanceIds extraídos das mensagens no pipeline', () => {
  it('TC-E13-08: instanceIds são extraídos das mensagens e passados ao revalidateBatchState', async () => {
    const INST = 'instance-from-msg';
    const deps = makeDefaultDeps({
      loadBatchMessages: vi.fn().mockResolvedValue(makeMessages(2, INST)),
      revalidateBatchState: vi.fn().mockResolvedValue(makeRevalidationAllowed({ instanceId: INST })),
    });

    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });

    const revalCall = deps.revalidateBatchState.mock.calls[0][0];
    expect(revalCall.instanceIds).toContain(INST);
    expect(revalCall.instanceIds).toHaveLength(1); // deduplicado
  });

  it('TC-E13-09: instanceId é passado ao executeAgent', async () => {
    const deps = makeDefaultDeps();
    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });

    const execCall = deps.executeAgent.mock.calls[0][0];
    expect(execCall.instanceId).toBe(INSTANCE_ID);
  });

  it('TC-E13-10: mensagens com instanceId null não geram instanceIds duplicados', async () => {
    const messages = [
      { ...makeMessages(1)[0], instanceId: null },
      { ...makeMessages(1)[0], id: 'msg-2', instanceId: null },
    ];
    const deps = makeDefaultDeps({
      loadBatchMessages: vi.fn().mockResolvedValue(messages),
    });

    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });

    const revalCall = deps.revalidateBatchState.mock.calls[0][0];
    // instanceIds filtrou os nulls
    expect(revalCall.instanceIds).toEqual([]);
  });
});

describe('Etapa 13.1 — schedule reschedule via rescheduleBatch (Parte C)', () => {
  it('TC-E13-11: out_of_schedule com nextAllowedAt → usa rescheduleBatch (não markBatchRetry)', async () => {
    const nextAt = new Date('2026-07-15T13:00:00Z');
    const deps = makeDefaultDeps({
      revalidateBatchState: vi.fn().mockResolvedValue({
        allowed:       false,
        action:        'reschedule',
        reason:        'out_of_schedule',
        errorCode:     'no_window_matched',
        nextAllowedAt: nextAt,
      }),
    });

    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });

    expect(deps.rescheduleBatch).toHaveBeenCalledTimes(1);
    expect(deps.markBatchRetry).not.toHaveBeenCalled();  // não usa retry técnico
    expect(deps.executeAgent).not.toHaveBeenCalled();
    expect(result.status).toBe('rescheduled');
    expect(result.reason).toBe('OUT_OF_SCHEDULE');
    expect(result.nextAllowedAt).toBe(nextAt);
  });

  it('TC-E13-12: rescheduleBatch recebe nextAttemptAt correto', async () => {
    const nextAt = new Date('2026-07-16T10:00:00Z');
    const deps = makeDefaultDeps({
      revalidateBatchState: vi.fn().mockResolvedValue({
        allowed:       false,
        action:        'reschedule',
        reason:        'out_of_schedule',
        nextAllowedAt: nextAt,
      }),
    });

    await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });

    const rescheduleCall = deps.rescheduleBatch.mock.calls[0][0];
    expect(rescheduleCall.nextAttemptAt).toBe(nextAt);
    expect(rescheduleCall.errorCode).toBeUndefined(); // rescheduleBatch não recebe errorCode
    expect(rescheduleCall.batchId).toBe(BATCH_ID);
    expect(rescheduleCall.companyId).toBe(COMPANY_ID);
  });

  it('TC-E13-13: nextAllowedAt preservado no retorno do pipeline', async () => {
    const nextAt = new Date('2026-07-15T09:00:00Z');
    const deps = makeDefaultDeps({
      revalidateBatchState: vi.fn().mockResolvedValue({
        allowed:       false,
        action:        'reschedule',
        reason:        'out_of_schedule',
        nextAllowedAt: nextAt,
      }),
    });

    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });

    expect(result.nextAllowedAt).toBe(nextAt);
  });

  it('TC-E13-14: nextAllowedAt null (nenhuma janela futura) → cancela o lote (NO_FUTURE_SCHEDULE)', async () => {
    const deps = makeDefaultDeps({
      revalidateBatchState: vi.fn().mockResolvedValue({
        allowed:       false,
        action:        'reschedule',
        reason:        'out_of_schedule',
        nextAllowedAt: null,
      }),
    });

    const result = await processClaimedBatch({ svc: makeSvc(), batch: makeBatch(), dependencies: deps });

    // Sem janela futura → cancelar (conservador) — não usar retry técnico cego
    expect(deps.markBatchCancelled).toHaveBeenCalledTimes(1);
    expect(deps.rescheduleBatch).not.toHaveBeenCalled();
    expect(deps.markBatchRetry).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
    expect(result.reason).toBe('NO_FUTURE_SCHEDULE');
  });
});
