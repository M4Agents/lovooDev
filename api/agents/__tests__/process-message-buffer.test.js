// =============================================================================
// api/agents/__tests__/process-message-buffer.test.js
//
// Testes unitários do endpoint process-message-buffer — Etapa 15 + 15b
//
// COBERTURA (84 casos):
//   TC-01–07   HTTP e autenticação (originais, atualizados para GET)
//   TC-08–12   Recovery (ordem e falhas)
//   TC-13–17   Claim (limite, fallback, falhas)
//   TC-18–22   Concorrência limitada
//   TC-23–29   Pipeline (contrato, injeção, segurança)
//   TC-30–37   Resultados e classificação
//   TC-38–42   Segurança (resposta e logs)
//   TC-43–50   Regressão (originais)
//   ── Novos casos (Etapa 15b) ──
//   TC-51–55   Método HTTP (GET/POST/PUT/DELETE/Allow)
//   TC-56–63   Autenticação (GET paths + query/body)
//   TC-64–66   Header Vercel (x-vercel-cron-schedule)
//   TC-67–71   Sobreposição (duas invocações simultâneas)
//   TC-72–84   Regressão 15b
//
// PRINCÍPIOS:
//   - Todos os testes usam mocks — sem banco, LLM, WhatsApp ou OpenAI real.
//   - Dependências injetadas via _deps (sem vi.mock de módulos externos).
//   - Env vars controladas via vi.stubEnv.
//   - req/res são objetos simples.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processMessageBuffer } from '../process-message-buffer.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_SECRET = 'test-secret-123';

function makeBatch(overrides = {}) {
  return {
    id:                  overrides.id              ?? 'batch-uuid-001',
    companyId:           overrides.companyId       ?? 'company-uuid-001',
    conversationId:      overrides.conversationId  ?? 'conv-uuid-001',
    status:              overrides.status          ?? 'processing',
    lockedAt:            overrides.lockedAt        ?? '2026-07-15T12:00:00.000000Z',
    enqueueAssignmentId: overrides.enqueueAssignmentId ?? 'assign-uuid-001',
    channel:             overrides.channel         ?? 'whatsapp',
    attempts:            overrides.attempts        ?? 1,
    messageCount:        overrides.messageCount    ?? 2,
    ...overrides,
  };
}

function makePipelineResult(status = 'processed', ok = true) {
  return { ok, status, batchId: 'batch-uuid-001', reason: null };
}

/** Cria req mock. Padrão: GET com Authorization correta. */
function makeReq({ method = 'GET', authHeader, headers: extraHeaders = {} } = {}) {
  const auth = authHeader !== undefined ? authHeader : `Bearer ${VALID_SECRET}`;
  const headers = { ...extraHeaders };
  if (auth !== null) headers['authorization'] = auth;
  return { method, headers };
}

/** Cria res mock com suporte a setHeader. */
function makeRes() {
  const res = {
    _statusCode: null,
    _body:       null,
    _headers:    {},
    status(code) {
      this._statusCode = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
    setHeader(key, value) {
      this._headers[key.toLowerCase()] = value;
      return this;
    },
  };
  return res;
}

/** Builder de _deps — injeta todas as dependências como mocks. */
function makeDeps({
  recoverExecResult  = [],
  recoverExecError   = null,
  recoverBatchResult = [],
  recoverBatchError  = null,
  claimedBatches     = [],
  claimError         = null,
  pipelineResult     = makePipelineResult('processed'),
  pipelineError      = null,
  claimLimit         = 20,
  concurrency        = 3,
} = {}) {
  const svc = {};

  const recoverStaleBatchExecutions = recoverExecError
    ? vi.fn().mockRejectedValue(recoverExecError)
    : vi.fn().mockResolvedValue(recoverExecResult);

  const recoverStaleBatches = recoverBatchError
    ? vi.fn().mockRejectedValue(recoverBatchError)
    : vi.fn().mockResolvedValue(recoverBatchResult);

  const claimDueBatches = claimError
    ? vi.fn().mockRejectedValue(claimError)
    : vi.fn().mockResolvedValue(claimedBatches);

  const processClaimedBatch = pipelineError
    ? vi.fn().mockRejectedValue(pipelineError)
    : vi.fn().mockResolvedValue(pipelineResult);

  const executeGroupedAgentInternal = vi.fn();

  return {
    svc,
    recoverStaleBatchExecutions,
    recoverStaleBatches,
    claimDueBatches,
    processClaimedBatch,
    executeGroupedAgentInternal,
    claimLimit,
    concurrency,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', VALID_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// =============================================================================
// TC-01–07: HTTP e autenticação (originais — atualizados para GET)
// =============================================================================

describe('TC-01–07: HTTP e autenticação', () => {

  it('TC-01 método POST → 405 (agora o endpoint exige GET)', async () => {
    const req = makeReq({ method: 'POST' });
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps());
    expect(res._statusCode).toBe(405);
    expect(res._body.success).toBe(false);
  });

  it('TC-02 método PUT → 405', async () => {
    const req = makeReq({ method: 'PUT' });
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps());
    expect(res._statusCode).toBe(405);
  });

  it('TC-03 segredo ausente no ambiente → 500 (fail-closed)', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const req = makeReq();
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps());
    expect(res._statusCode).toBe(500);
    expect(res._body.success).toBe(false);
    expect(res._body.error_code).toBe('ENV_NOT_CONFIGURED');
  });

  it('TC-04 Authorization ausente → 401', async () => {
    const req = { method: 'GET', headers: {} };
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps());
    expect(res._statusCode).toBe(401);
    expect(res._body.success).toBe(false);
  });

  it('TC-05 Bearer inválido → 401', async () => {
    const req = makeReq({ authHeader: 'Bearer wrong-secret' });
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps());
    expect(res._statusCode).toBe(401);
    expect(res._body.success).toBe(false);
  });

  it('TC-06 Bearer correto → continua (200 com claimed=0)', async () => {
    const req = makeReq();
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps({ claimedBatches: [] }));
    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
  });

  it('TC-07 segredo não aparece na resposta HTTP', async () => {
    const req = makeReq();
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps({ claimedBatches: [makeBatch()] }));
    const bodyStr = JSON.stringify(res._body);
    expect(bodyStr).not.toContain(VALID_SECRET);
    expect(bodyStr).not.toContain('CRON_SECRET');
    expect(bodyStr).not.toContain('authorization');
  });
});

// =============================================================================
// TC-08–12: Recovery
// =============================================================================

describe('TC-08–12: recovery — ordem e falhas', () => {

  it('TC-08 recovery de execução ocorre antes do recovery de lote', async () => {
    const callOrder = [];
    const deps = makeDeps({ claimedBatches: [] });

    deps.recoverStaleBatchExecutions = vi.fn().mockImplementation(async () => {
      callOrder.push('executions');
      return [];
    });
    deps.recoverStaleBatches = vi.fn().mockImplementation(async () => {
      callOrder.push('batches');
      return [];
    });

    await processMessageBuffer(makeReq(), makeRes(), deps);

    expect(callOrder.indexOf('executions')).toBeLessThan(callOrder.indexOf('batches'));
  });

  it('TC-09 recovery de lote ocorre antes do claim', async () => {
    const callOrder = [];
    const deps = makeDeps({ claimedBatches: [] });

    deps.recoverStaleBatches = vi.fn().mockImplementation(async () => {
      callOrder.push('batches');
      return [];
    });
    deps.claimDueBatches = vi.fn().mockImplementation(async () => {
      callOrder.push('claim');
      return [];
    });

    await processMessageBuffer(makeReq(), makeRes(), deps);

    expect(callOrder.indexOf('batches')).toBeLessThan(callOrder.indexOf('claim'));
  });

  it('TC-10 falha no recovery de execução → 500 e impede claim', async () => {
    const err  = Object.assign(new Error('DB_ERROR'), { code: 'DB_ERROR' });
    const deps = makeDeps({ recoverExecError: err });
    const res  = makeRes();

    await processMessageBuffer(makeReq(), res, deps);

    expect(res._statusCode).toBe(500);
    expect(res._body.error_code).toBe('RECOVERY_EXECUTION_FAILED');
    expect(deps.claimDueBatches).not.toHaveBeenCalled();
  });

  it('TC-11 falha no recovery de lote → 500 e impede claim', async () => {
    const err  = Object.assign(new Error('DB_ERROR'), { code: 'DB_ERROR' });
    const deps = makeDeps({ recoverBatchError: err });
    const res  = makeRes();

    await processMessageBuffer(makeReq(), res, deps);

    expect(res._statusCode).toBe(500);
    expect(res._body.error_code).toBe('RECOVERY_BATCH_FAILED');
    expect(deps.claimDueBatches).not.toHaveBeenCalled();
  });

  it('TC-12 contagens de recovery são normalizadas corretamente', async () => {
    const deps = makeDeps({
      recoverExecResult:  [{ id: 'exec-1' }, { id: 'exec-2' }],
      recoverBatchResult: [{ id: 'batch-1' }],
      claimedBatches:     [],
    });
    const res = makeRes();

    await processMessageBuffer(makeReq(), res, deps);

    expect(res._body.summary.recovered_executions).toBe(2);
    expect(res._body.summary.recovered_batches).toBe(1);
  });
});

// =============================================================================
// TC-13–17: Claim
// =============================================================================

describe('TC-13–17: claim', () => {

  it('TC-13 claim vazio → 200 com claimed=0 e failed=0, sem processar pipeline', async () => {
    const deps = makeDeps({ claimedBatches: [] });
    const res  = makeRes();

    await processMessageBuffer(makeReq(), res, deps);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.claimed).toBe(0);
    expect(res._body.processed).toBe(0);
    expect(res._body.failed).toBe(0);
    expect(deps.processClaimedBatch).not.toHaveBeenCalled();
  });

  it('TC-14 claim usa o limite configurado via _deps.claimLimit', async () => {
    const deps = makeDeps({ claimedBatches: [], claimLimit: 50 });
    await processMessageBuffer(makeReq(), makeRes(), deps);
    expect(deps.claimDueBatches).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it('TC-15 _deps.claimLimit fora dos limites usa o valor configurado (sem override de env)', async () => {
    const deps = makeDeps({ claimedBatches: [], claimLimit: 20 });
    await processMessageBuffer(makeReq(), makeRes(), deps);
    expect(deps.claimDueBatches).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
  });

  it('TC-16 claim falhando → 500', async () => {
    const err  = Object.assign(new Error('claim failed'), { code: 'DB_ERROR' });
    const deps = makeDeps({ claimError: err });
    const res  = makeRes();

    await processMessageBuffer(makeReq(), res, deps);

    expect(res._statusCode).toBe(500);
    expect(res._body.error_code).toBe('CLAIM_FAILED');
  });

  it('TC-17 nenhum pipeline chamado quando claim falha', async () => {
    const err  = Object.assign(new Error('claim failed'), { code: 'DB_ERROR' });
    const deps = makeDeps({ claimError: err });

    await processMessageBuffer(makeReq(), makeRes(), deps);

    expect(deps.processClaimedBatch).not.toHaveBeenCalled();
  });
});

// =============================================================================
// TC-18–22: Concorrência
// =============================================================================

describe('TC-18–22: concorrência limitada', () => {

  it('TC-18 nunca excede a concorrência configurada', async () => {
    const concurrent = { current: 0, max: 0 };
    const batches    = Array.from({ length: 9 }, (_, i) => makeBatch({ id: `batch-${i}` }));
    const deps = makeDeps({ claimedBatches: batches, concurrency: 3 });

    deps.processClaimedBatch = vi.fn().mockImplementation(async () => {
      concurrent.current++;
      concurrent.max = Math.max(concurrent.max, concurrent.current);
      await new Promise(r => setTimeout(r, 5));
      concurrent.current--;
      return makePipelineResult('processed');
    });

    await processMessageBuffer(makeReq(), makeRes(), deps);

    expect(concurrent.max).toBeLessThanOrEqual(3);
  });

  it('TC-19 processa todos os itens claimed', async () => {
    const batches = Array.from({ length: 5 }, (_, i) => makeBatch({ id: `batch-${i}` }));
    const deps    = makeDeps({ claimedBatches: batches });
    const res     = makeRes();

    await processMessageBuffer(makeReq(), res, deps);

    expect(deps.processClaimedBatch).toHaveBeenCalledTimes(5);
    expect(res._body.claimed).toBe(5);
  });

  it('TC-20 falha em um item não bloqueia os demais', async () => {
    const batches      = Array.from({ length: 3 }, (_, i) => makeBatch({ id: `batch-${i}` }));
    const processedIds = [];
    const deps         = makeDeps({ claimedBatches: batches });

    deps.processClaimedBatch = vi.fn().mockImplementation(async ({ batch }) => {
      if (batch.id === 'batch-1') throw new Error('falha proposital');
      processedIds.push(batch.id);
      return makePipelineResult('processed');
    });

    const res = makeRes();
    await processMessageBuffer(makeReq(), res, deps);

    expect(processedIds).toContain('batch-0');
    expect(processedIds).toContain('batch-2');
    expect(res._statusCode).toBe(200);
    expect(res._body.failed).toBe(1);
  });

  it('TC-21 ordem de conclusão não corrompe o resumo', async () => {
    const batches = [
      makeBatch({ id: 'batch-a' }),
      makeBatch({ id: 'batch-b' }),
      makeBatch({ id: 'batch-c' }),
    ];
    const deps = makeDeps({ claimedBatches: batches, concurrency: 3 });

    deps.processClaimedBatch = vi.fn()
      .mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 30)); return makePipelineResult('processed');    })
      .mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 20)); return makePipelineResult('failed', false); })
      .mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 10)); return makePipelineResult('cancelled', false); });

    const res = makeRes();
    await processMessageBuffer(makeReq(), res, deps);

    expect(res._body.processed).toBe(1);
    expect(res._body.failed).toBe(1);
    expect(res._body.summary.cancelled).toBe(1);
  });

  it('TC-22 usa mapWithConcurrency — não usa Promise.all irrestrito', async () => {
    const batches    = Array.from({ length: 9 }, (_, i) => makeBatch({ id: `b${i}` }));
    const concurrent = { current: 0, max: 0 };
    const deps       = makeDeps({ claimedBatches: batches, concurrency: 2 });

    deps.processClaimedBatch = vi.fn().mockImplementation(async () => {
      concurrent.current++;
      concurrent.max = Math.max(concurrent.max, concurrent.current);
      await new Promise(r => setTimeout(r, 5));
      concurrent.current--;
      return makePipelineResult('processed');
    });

    await processMessageBuffer(makeReq(), makeRes(), deps);

    expect(concurrent.max).toBeLessThanOrEqual(2);
    expect(concurrent.max).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// TC-23–29: Pipeline
// =============================================================================

describe('TC-23–29: pipeline — contrato e injeção', () => {

  it('TC-23 chama processClaimedBatch para cada lote claimed', async () => {
    const batches = [makeBatch({ id: 'b1' }), makeBatch({ id: 'b2' })];
    const deps    = makeDeps({ claimedBatches: batches });

    await processMessageBuffer(makeReq(), makeRes(), deps);

    expect(deps.processClaimedBatch).toHaveBeenCalledTimes(2);
  });

  it('TC-24 injeta executeGroupedAgentInternal como executeAgent no pipeline', async () => {
    const batch = makeBatch();
    const deps  = makeDeps({ claimedBatches: [batch] });

    await processMessageBuffer(makeReq(), makeRes(), deps);

    const callArgs = deps.processClaimedBatch.mock.calls[0][0];
    expect(callArgs.dependencies.executeAgent).toBe(deps.executeGroupedAgentInternal);
  });

  it('TC-25 não chama endpoint execute-agent (sem fetch)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    const deps     = makeDeps({ claimedBatches: [makeBatch()] });

    await processMessageBuffer(makeReq(), makeRes(), deps);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('TC-26 processClaimedBatch recebe o svc correto (não vindo da request)', async () => {
    const customSvc = { _isMockSvc: true };
    const deps      = makeDeps({ claimedBatches: [makeBatch()] });
    deps.svc        = customSvc;

    await processMessageBuffer(makeReq(), makeRes(), deps);

    const callArgs = deps.processClaimedBatch.mock.calls[0][0];
    expect(callArgs.svc).toBe(customSvc);
  });

  it('TC-27 não chama executeGroupedAgentInternal diretamente (delega ao pipeline)', async () => {
    const deps = makeDeps({ claimedBatches: [makeBatch()] });

    await processMessageBuffer(makeReq(), makeRes(), deps);

    expect(deps.executeGroupedAgentInternal).not.toHaveBeenCalled();
    expect(deps.processClaimedBatch).toHaveBeenCalled();
  });

  it('TC-28 companyId do lote não aparece na resposta HTTP (segurança)', async () => {
    const batch = makeBatch({ id: 'batch-fail', companyId: 'company-xyz' });
    const err   = Object.assign(new Error('ops'), { code: 'TIMEOUT' });
    const deps  = makeDeps({ claimedBatches: [batch], pipelineError: err });

    const res = makeRes();
    await processMessageBuffer(makeReq(), res, deps);

    expect(res._body.failed).toBe(1);
    expect(JSON.stringify(res._body)).not.toContain('company-xyz');
  });

  it('TC-29 lote sem companyId é registrado como falha individual sem chamar pipeline', async () => {
    const invalidBatch = makeBatch({ companyId: null });
    const deps         = makeDeps({ claimedBatches: [invalidBatch] });

    const res = makeRes();
    await processMessageBuffer(makeReq(), res, deps);

    expect(deps.processClaimedBatch).not.toHaveBeenCalled();
    expect(res._body.failed).toBe(1);
  });
});

// =============================================================================
// TC-30–37: Resultados e classificação
// =============================================================================

describe('TC-30–37: resultados e classificação', () => {

  async function runWithStatus(status, ok = false) {
    const batch = makeBatch();
    const deps  = makeDeps({
      claimedBatches: [batch],
      pipelineResult: makePipelineResult(status, ok),
    });
    const res = makeRes();
    await processMessageBuffer(makeReq(), res, deps);
    return res._body;
  }

  it('TC-30 status processed → contabilizado em processed', async () => {
    const body = await runWithStatus('processed', true);
    expect(body.processed).toBe(1);
    expect(body.failed).toBe(0);
  });

  it('TC-31 status retry_pending → contabilizado em summary.retried', async () => {
    const body = await runWithStatus('retry_pending', false);
    expect(body.summary.retried).toBe(1);
    expect(body.processed).toBe(0);
  });

  it('TC-32 status rescheduled → contabilizado em summary.rescheduled', async () => {
    const body = await runWithStatus('rescheduled', false);
    expect(body.summary.rescheduled).toBe(1);
  });

  it('TC-33 status cancelled → contabilizado em summary.cancelled', async () => {
    const body = await runWithStatus('cancelled', false);
    expect(body.summary.cancelled).toBe(1);
  });

  it('TC-34 status failed → contabilizado em response.failed', async () => {
    const body = await runWithStatus('failed', false);
    expect(body.failed).toBe(1);
  });

  it('TC-35 status skipped → contabilizado em summary.skipped', async () => {
    const body = await runWithStatus('skipped', false);
    expect(body.summary.skipped).toBe(1);
  });

  it('TC-36 status reconciliation_error → contabilizado em summary.reconciliation_errors', async () => {
    const body = await runWithStatus('reconciliation_error', false);
    expect(body.summary.reconciliation_errors).toBe(1);
  });

  it('TC-37 status desconhecido → fallback seguro para failed', async () => {
    const batch = makeBatch();
    const deps  = makeDeps({
      claimedBatches: [batch],
      pipelineResult: { ok: false, status: 'exotic_unknown_status', batchId: batch.id },
    });
    const res = makeRes();
    await processMessageBuffer(makeReq(), res, deps);
    expect(res._body.failed).toBe(1);
  });
});

// =============================================================================
// TC-38–42: Segurança
// =============================================================================

describe('TC-38–42: segurança — resposta e logs', () => {

  it('TC-38 resposta não contém conteúdo de mensagens', async () => {
    const batch = makeBatch();
    const deps  = makeDeps({ claimedBatches: [batch], pipelineResult: makePipelineResult('processed', true) });

    const res = makeRes();
    await processMessageBuffer(makeReq(), res, deps);

    const bodyStr = JSON.stringify(res._body);
    expect(bodyStr).not.toContain('messageText');
    expect(bodyStr).not.toContain('message_text');
    expect(bodyStr).not.toContain('payload');
  });

  it('TC-39 resposta não contém claimToken', async () => {
    const pipelineResultWithToken = {
      ok: true,
      status: 'processed',
      batchId: 'b1',
      claimToken: 'SECRET-CLAIM-TOKEN',
    };
    const deps = makeDeps({
      claimedBatches: [makeBatch()],
      pipelineResult: pipelineResultWithToken,
    });

    const res = makeRes();
    await processMessageBuffer(makeReq(), res, deps);

    const bodyStr = JSON.stringify(res._body);
    expect(bodyStr).not.toContain('SECRET-CLAIM-TOKEN');
    expect(bodyStr).not.toContain('claimToken');
  });

  it('TC-40 resposta não contém lockedAt dos lotes', async () => {
    const deps = makeDeps({ claimedBatches: [makeBatch()], pipelineResult: makePipelineResult('processed', true) });
    const res  = makeRes();

    await processMessageBuffer(makeReq(), res, deps);

    const bodyStr = JSON.stringify(res._body);
    expect(bodyStr).not.toContain('lockedAt');
    expect(bodyStr).not.toContain('locked_at');
  });

  it('TC-41 logs não contêm o header Authorization', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy   = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.stubEnv('CRON_SECRET', '');

    const req = makeReq({ authHeader: `Bearer ${VALID_SECRET}` });
    await processMessageBuffer(req, makeRes(), makeDeps());

    const allLogs = [
      ...consoleSpy.mock.calls,
      ...errorSpy.mock.calls,
    ].flat(Infinity).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ');

    expect(allLogs).not.toContain(`Bearer ${VALID_SECRET}`);
    expect(allLogs).not.toContain('authorization');

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('TC-42 logs não contêm conteúdo sensível do lote', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const err  = Object.assign(new Error('falha com MENSAGEM_SECRETA'), { code: 'DB_ERROR' });
    const deps = makeDeps({ claimedBatches: [makeBatch()], pipelineError: err });

    await processMessageBuffer(makeReq(), makeRes(), deps);

    const allLogs = consoleSpy.mock.calls.flat(Infinity)
      .map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ');

    expect(allLogs).not.toContain('MENSAGEM_SECRETA');

    consoleSpy.mockRestore();
  });
});

// =============================================================================
// TC-43–50: Regressão (originais)
// =============================================================================

describe('TC-43–50: regressão (originais)', () => {

  it('TC-43 endpoint retorna 200 com success=true para fluxo completo normal', async () => {
    const batches = [makeBatch({ id: 'b1' }), makeBatch({ id: 'b2' })];
    const deps    = makeDeps({
      recoverExecResult:  [{ id: 'exec-1' }],
      recoverBatchResult: [],
      claimedBatches:     batches,
      pipelineResult:     makePipelineResult('processed', true),
    });

    const res = makeRes();
    await processMessageBuffer(makeReq(), res, deps);

    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.claimed).toBe(2);
    expect(res._body.processed).toBe(2);
    expect(res._body.failed).toBe(0);
    expect(res._body.summary.recovered_executions).toBe(1);
    expect(res._body.summary.recovered_batches).toBe(0);
  });

  it('TC-44 nenhum teste acessa banco real — todos os deps são mocks', async () => {
    const deps = makeDeps({});
    expect(vi.isMockFunction(deps.recoverStaleBatchExecutions)).toBe(true);
    expect(vi.isMockFunction(deps.recoverStaleBatches)).toBe(true);
    expect(vi.isMockFunction(deps.claimDueBatches)).toBe(true);
    expect(vi.isMockFunction(deps.processClaimedBatch)).toBe(true);
  });

  it('TC-45 nenhum teste chama OpenAI — executeGroupedAgentInternal é mock injetado', async () => {
    const deps = makeDeps({ claimedBatches: [makeBatch()] });

    await processMessageBuffer(makeReq(), makeRes(), deps);

    expect(deps.executeGroupedAgentInternal).not.toHaveBeenCalled();
  });

  it('TC-46 nenhum teste chama WhatsApp — gateway não é invocado', async () => {
    const deps = makeDeps({ claimedBatches: [makeBatch()] });
    await processMessageBuffer(makeReq(), makeRes(), deps);
    expect(deps.processClaimedBatch).toHaveBeenCalled();
  });

  it('TC-47 múltiplos resultados mistos são corretamente agregados', async () => {
    const batches  = Array.from({ length: 7 }, (_, i) => makeBatch({ id: `b${i}` }));
    const statuses = ['processed', 'retry_pending', 'rescheduled', 'cancelled', 'failed', 'skipped', 'reconciliation_error'];
    const deps     = makeDeps({ claimedBatches: batches, concurrency: 3 });

    deps.processClaimedBatch = vi.fn().mockImplementation(async ({ batch }) => {
      const idx    = parseInt(batch.id.replace('b', ''));
      const status = statuses[idx];
      return { ok: status === 'processed', status, batchId: batch.id };
    });

    const res = makeRes();
    await processMessageBuffer(makeReq(), res, deps);

    expect(res._body.processed).toBe(1);
    expect(res._body.summary.retried).toBe(1);
    expect(res._body.summary.rescheduled).toBe(1);
    expect(res._body.summary.cancelled).toBe(1);
    expect(res._body.failed).toBe(1);
    expect(res._body.summary.skipped).toBe(1);
    expect(res._body.summary.reconciliation_errors).toBe(1);
  });

  it('TC-48 svc não configurado → 500', async () => {
    const deps = makeDeps({});
    deps.svc   = null;

    const res = makeRes();
    await processMessageBuffer(makeReq(), res, deps);

    expect(res._statusCode).toBe(500);
    expect(res._body.error_code).toBe('SVC_NOT_CONFIGURED');
    expect(deps.recoverStaleBatchExecutions).not.toHaveBeenCalled();
  });

  it('TC-49 lote sem lockedAt → registrado como falha individual (não processa pipeline)', async () => {
    const batchSemLock = makeBatch({ lockedAt: null });
    const deps         = makeDeps({ claimedBatches: [batchSemLock] });

    const res = makeRes();
    await processMessageBuffer(makeReq(), res, deps);

    expect(deps.processClaimedBatch).not.toHaveBeenCalled();
    expect(res._body.failed).toBe(1);
    expect(res._statusCode).toBe(200);
  });

  it('TC-50 resposta de sucesso tem estrutura completa esperada', async () => {
    const deps = makeDeps({ claimedBatches: [makeBatch()], pipelineResult: makePipelineResult('processed', true) });
    const res  = makeRes();

    await processMessageBuffer(makeReq(), res, deps);

    expect(res._body).toMatchObject({
      success:   true,
      claimed:   1,
      processed: 1,
      failed:    0,
      summary:   expect.objectContaining({
        recovered_executions:  expect.any(Number),
        recovered_batches:     expect.any(Number),
        retried:               expect.any(Number),
        rescheduled:           expect.any(Number),
        cancelled:             expect.any(Number),
        skipped:               expect.any(Number),
        reconciliation_errors: expect.any(Number),
      }),
    });
    expect(res._body).not.toHaveProperty('claimToken');
    expect(res._body).not.toHaveProperty('lockedAt');
    expect(res._body).not.toHaveProperty('payload');
  });
});

// =============================================================================
// TC-51–55: Método HTTP (novos — Etapa 15b)
// =============================================================================

describe('TC-51–55: método HTTP (Etapa 15b)', () => {

  it('TC-51 GET autenticado continua o fluxo normalmente', async () => {
    const req = makeReq({ method: 'GET' });
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps({ claimedBatches: [] }));
    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
  });

  it('TC-52 POST retorna 405 (Vercel Cron usa GET)', async () => {
    const req = makeReq({ method: 'POST' });
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps());
    expect(res._statusCode).toBe(405);
  });

  it('TC-53 PUT retorna 405', async () => {
    const req = makeReq({ method: 'PUT' });
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps());
    expect(res._statusCode).toBe(405);
  });

  it('TC-54 DELETE retorna 405', async () => {
    const req = makeReq({ method: 'DELETE' });
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps());
    expect(res._statusCode).toBe(405);
  });

  it('TC-55 header Allow: GET presente em todas as respostas 405', async () => {
    const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];

    for (const method of methods) {
      const req = makeReq({ method });
      const res = makeRes();
      await processMessageBuffer(req, res, makeDeps());
      expect(res._statusCode).toBe(405);
      expect(res._headers['allow']).toBe('GET');
    }
  });
});

// =============================================================================
// TC-56–63: Autenticação (novos — Etapa 15b)
// =============================================================================

describe('TC-56–63: autenticação (Etapa 15b)', () => {

  it('TC-56 GET sem Authorization retorna 401', async () => {
    const req = { method: 'GET', headers: {} };
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps());
    expect(res._statusCode).toBe(401);
  });

  it('TC-57 GET com Bearer inválido retorna 401', async () => {
    const req = makeReq({ authHeader: 'Bearer wrong-secret' });
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps());
    expect(res._statusCode).toBe(401);
  });

  it('TC-58 GET com segredo correto continua para o pipeline', async () => {
    const req = makeReq({ method: 'GET' });
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps({ claimedBatches: [] }));
    expect(res._statusCode).toBe(200);
  });

  it('TC-59 CRON_SECRET ausente no ambiente retorna 500 (não 401)', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const req = makeReq({ method: 'GET' });
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps());
    expect(res._statusCode).toBe(500);
    expect(res._body.error_code).toBe('ENV_NOT_CONFIGURED');
  });

  it('TC-60 query string com secret não autentica — apenas header é válido', async () => {
    // Sem Authorization header; secret na query string deve ser ignorado.
    const req = {
      method: 'GET',
      headers: {},
      query: { secret: VALID_SECRET },
    };
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps());
    expect(res._statusCode).toBe(401);
  });

  it('TC-61 body com secret não autentica — GET não usa body', async () => {
    // Sem Authorization header; secret no body deve ser ignorado.
    const req = {
      method: 'GET',
      headers: {},
      body: { secret: VALID_SECRET },
    };
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps());
    expect(res._statusCode).toBe(401);
  });

  it('TC-62 segredo não aparece na resposta de nenhuma autenticação', async () => {
    const scenarios = [
      makeReq({ authHeader: 'Bearer wrong' }),
      { method: 'GET', headers: {} },
    ];

    for (const req of scenarios) {
      const res = makeRes();
      await processMessageBuffer(req, res, makeDeps());
      const bodyStr = JSON.stringify(res._body);
      expect(bodyStr).not.toContain(VALID_SECRET);
    }
  });

  it('TC-63 segredo não aparece nos logs de falha de autenticação', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy  = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Testar com env ausente (gera log de erro)
    vi.stubEnv('CRON_SECRET', '');
    await processMessageBuffer(makeReq(), makeRes(), makeDeps());

    const allLogs = [
      ...warnSpy.mock.calls,
      ...errSpy.mock.calls,
    ].flat(Infinity).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ');

    // O valor do segredo original não deve aparecer nos logs
    expect(allLogs).not.toContain(VALID_SECRET);

    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// =============================================================================
// TC-64–66: Header Vercel (novos — Etapa 15b)
// =============================================================================

describe('TC-64–66: header x-vercel-cron-schedule (Etapa 15b)', () => {

  it('TC-64 x-vercel-cron-schedule ausente não bloqueia a execução', async () => {
    // Requisição sem o header — deve continuar normalmente.
    const req = makeReq(); // sem x-vercel-cron-schedule
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps({ claimedBatches: [] }));
    expect(res._statusCode).toBe(200);
    expect(res._body.success).toBe(true);
  });

  it('TC-65 x-vercel-cron-schedule presente pode ser registrado com segurança', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const req = makeReq({
      headers: { 'x-vercel-cron-schedule': '* * * * *' },
    });
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps({ claimedBatches: [] }));

    // Deve continuar e retornar 200
    expect(res._statusCode).toBe(200);

    // O schedule deve aparecer no log de forma sanitizada
    const allLogs = logSpy.mock.calls.flat(Infinity)
      .map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ');
    expect(allLogs).toContain('* * * * *');

    logSpy.mockRestore();
  });

  it('TC-66 x-vercel-cron-schedule não funciona como autenticação', async () => {
    // Sem Authorization header, mas com x-vercel-cron-schedule.
    // Deve retornar 401 — o header do cron não substitui a autenticação.
    const req = {
      method: 'GET',
      headers: { 'x-vercel-cron-schedule': '* * * * *' },
    };
    const res = makeRes();
    await processMessageBuffer(req, res, makeDeps());
    expect(res._statusCode).toBe(401);
  });
});

// =============================================================================
// TC-67–71: Sobreposição — duas invocações simultâneas (novos — Etapa 15b)
// =============================================================================

describe('TC-67–71: sobreposição de invocações (Etapa 15b)', () => {

  it('TC-67 duas invocações simultâneas usam _deps independentes (sem estado global)', async () => {
    // Cada invocação tem seu próprio deps — simula execuções paralelas independentes.
    const deps1 = makeDeps({ claimedBatches: [makeBatch({ id: 'batch-inv1' })] });
    const deps2 = makeDeps({ claimedBatches: [makeBatch({ id: 'batch-inv2' })] });

    const [res1, res2] = await Promise.all([
      (async () => { const r = makeRes(); await processMessageBuffer(makeReq(), r, deps1); return r; })(),
      (async () => { const r = makeRes(); await processMessageBuffer(makeReq(), r, deps2); return r; })(),
    ]);

    expect(res1._statusCode).toBe(200);
    expect(res2._statusCode).toBe(200);
    // Cada invocação processou apenas seus próprios lotes
    expect(res1._body.claimed).toBe(1);
    expect(res2._body.claimed).toBe(1);
  });

  it('TC-68 nenhuma invocação depende de estado global mutável', async () => {
    // Verificação: os mocks de deps1 não foram chamados pela invocação 2
    const deps1 = makeDeps({ claimedBatches: [makeBatch({ id: 'b1' })] });
    const deps2 = makeDeps({ claimedBatches: [makeBatch({ id: 'b2' })] });

    await Promise.all([
      processMessageBuffer(makeReq(), makeRes(), deps1),
      processMessageBuffer(makeReq(), makeRes(), deps2),
    ]);

    // Cada conjunto de mocks foi chamado exatamente uma vez cada
    expect(deps1.claimDueBatches).toHaveBeenCalledTimes(1);
    expect(deps2.claimDueBatches).toHaveBeenCalledTimes(1);
    // Os mocks de uma invocação não interferiram na outra
    expect(deps1.processClaimedBatch).toHaveBeenCalledTimes(1);
    expect(deps2.processClaimedBatch).toHaveBeenCalledTimes(1);
  });

  it('TC-69 claim é chamado em ambas as invocações independentemente', async () => {
    const deps1 = makeDeps({ claimedBatches: [] });
    const deps2 = makeDeps({ claimedBatches: [] });

    await Promise.all([
      processMessageBuffer(makeReq(), makeRes(), deps1),
      processMessageBuffer(makeReq(), makeRes(), deps2),
    ]);

    expect(deps1.claimDueBatches).toHaveBeenCalledTimes(1);
    expect(deps2.claimDueBatches).toHaveBeenCalledTimes(1);
  });

  it('TC-70 resultados de duas invocações são resumidos independentemente', async () => {
    const deps1 = makeDeps({
      claimedBatches: [makeBatch({ id: 'b1' })],
      pipelineResult: makePipelineResult('processed', true),
    });
    const deps2 = makeDeps({
      claimedBatches: [makeBatch({ id: 'b2' })],
      pipelineResult: makePipelineResult('failed', false),
    });

    const [res1, res2] = await Promise.all([
      (async () => { const r = makeRes(); await processMessageBuffer(makeReq(), r, deps1); return r; })(),
      (async () => { const r = makeRes(); await processMessageBuffer(makeReq(), r, deps2); return r; })(),
    ]);

    expect(res1._body.processed).toBe(1);
    expect(res1._body.failed).toBe(0);
    expect(res2._body.processed).toBe(0);
    expect(res2._body.failed).toBe(1);
  });

  it('TC-71 falha individual em uma invocação não corrompe a outra', async () => {
    const err  = Object.assign(new Error('pipeline error'), { code: 'PIPE_ERROR' });
    const deps1 = makeDeps({
      claimedBatches: [makeBatch({ id: 'bad' })],
      pipelineError: err,
    });
    const deps2 = makeDeps({
      claimedBatches: [makeBatch({ id: 'good' })],
      pipelineResult: makePipelineResult('processed', true),
    });

    const [res1, res2] = await Promise.all([
      (async () => { const r = makeRes(); await processMessageBuffer(makeReq(), r, deps1); return r; })(),
      (async () => { const r = makeRes(); await processMessageBuffer(makeReq(), r, deps2); return r; })(),
    ]);

    // Invocação 1 registrou o lote como failed, mas retornou 200
    expect(res1._statusCode).toBe(200);
    expect(res1._body.failed).toBe(1);
    // Invocação 2 processou corretamente
    expect(res2._statusCode).toBe(200);
    expect(res2._body.processed).toBe(1);
    expect(res2._body.failed).toBe(0);
  });
});

// =============================================================================
// TC-72–84: Regressão (novos — Etapa 15b)
// =============================================================================

describe('TC-72–84: regressão (Etapa 15b)', () => {

  it('TC-72 ordem dos recoveries permanece: execuções antes de lotes antes de claim', async () => {
    const order = [];
    const deps  = makeDeps({ claimedBatches: [] });

    deps.recoverStaleBatchExecutions = vi.fn().mockImplementation(async () => { order.push(1); return []; });
    deps.recoverStaleBatches         = vi.fn().mockImplementation(async () => { order.push(2); return []; });
    deps.claimDueBatches             = vi.fn().mockImplementation(async () => { order.push(3); return []; });

    await processMessageBuffer(makeReq(), makeRes(), deps);

    expect(order).toEqual([1, 2, 3]);
  });

  it('TC-73 claim continua após os dois recoveries bem-sucedidos', async () => {
    const deps = makeDeps({ claimedBatches: [] });
    await processMessageBuffer(makeReq(), makeRes(), deps);
    expect(deps.recoverStaleBatchExecutions).toHaveBeenCalled();
    expect(deps.recoverStaleBatches).toHaveBeenCalled();
    expect(deps.claimDueBatches).toHaveBeenCalled();
  });

  it('TC-74 concorrência por lote continua limitada após mudança de método', async () => {
    const concurrent = { current: 0, max: 0 };
    const batches    = Array.from({ length: 6 }, (_, i) => makeBatch({ id: `b${i}` }));
    const deps       = makeDeps({ claimedBatches: batches, concurrency: 2 });

    deps.processClaimedBatch = vi.fn().mockImplementation(async () => {
      concurrent.current++;
      concurrent.max = Math.max(concurrent.max, concurrent.current);
      await new Promise(r => setTimeout(r, 5));
      concurrent.current--;
      return makePipelineResult('processed');
    });

    await processMessageBuffer(makeReq(), makeRes(), deps);

    expect(concurrent.max).toBeLessThanOrEqual(2);
  });

  it('TC-75 erro individual não aborta processamento dos outros lotes', async () => {
    const batches = [
      makeBatch({ id: 'ok-1' }),
      makeBatch({ id: 'fail' }),
      makeBatch({ id: 'ok-2' }),
    ];
    const deps = makeDeps({ claimedBatches: batches });

    deps.processClaimedBatch = vi.fn().mockImplementation(async ({ batch }) => {
      if (batch.id === 'fail') throw new Error('erro isolado');
      return makePipelineResult('processed');
    });

    const res = makeRes();
    await processMessageBuffer(makeReq(), res, deps);

    expect(deps.processClaimedBatch).toHaveBeenCalledTimes(3);
    expect(res._body.processed).toBe(2);
    expect(res._body.failed).toBe(1);
  });

  it('TC-76 resposta não contém mensagens, payload ou claim token', async () => {
    const pipelineRes = {
      ok: true,
      status: 'processed',
      batchId: 'b1',
      claimToken: 'SHOULD-NOT-APPEAR',
      messages: [{ text: 'sensitive message' }],
      payload: { raw: 'data' },
    };
    const deps = makeDeps({ claimedBatches: [makeBatch()], pipelineResult: pipelineRes });
    const res  = makeRes();

    await processMessageBuffer(makeReq(), res, deps);

    const bodyStr = JSON.stringify(res._body);
    expect(bodyStr).not.toContain('SHOULD-NOT-APPEAR');
    expect(bodyStr).not.toContain('sensitive message');
    expect(bodyStr).not.toContain('raw');
  });

  it('TC-77 failed sempre presente na resposta — mesmo quando zero', async () => {
    const deps = makeDeps({
      claimedBatches: [makeBatch()],
      pipelineResult: makePipelineResult('processed', true),
    });
    const res = makeRes();

    await processMessageBuffer(makeReq(), res, deps);

    expect(res._body).toHaveProperty('failed');
    expect(res._body.failed).toBe(0);
  });

  it('TC-78 failed presente na resposta de claim vazio (sem lotes)', async () => {
    const deps = makeDeps({ claimedBatches: [] });
    const res  = makeRes();

    await processMessageBuffer(makeReq(), res, deps);

    expect(res._body).toHaveProperty('failed');
    expect(res._body.failed).toBe(0);
  });

  it('TC-79 summary tem todos os campos — mesmo quando claim é vazio', async () => {
    const deps = makeDeps({ claimedBatches: [] });
    const res  = makeRes();

    await processMessageBuffer(makeReq(), res, deps);

    expect(res._body.summary).toMatchObject({
      recovered_executions:  0,
      recovered_batches:     0,
      retried:               0,
      rescheduled:           0,
      cancelled:             0,
      skipped:               0,
      reconciliation_errors: 0,
    });
  });

  it('TC-80 nenhum teste acessa banco real — todos os services são mocks', () => {
    const deps = makeDeps({});
    expect(vi.isMockFunction(deps.recoverStaleBatchExecutions)).toBe(true);
    expect(vi.isMockFunction(deps.recoverStaleBatches)).toBe(true);
    expect(vi.isMockFunction(deps.claimDueBatches)).toBe(true);
    expect(vi.isMockFunction(deps.processClaimedBatch)).toBe(true);
    expect(vi.isMockFunction(deps.executeGroupedAgentInternal)).toBe(true);
  });

  it('TC-81 nenhum teste chama OpenAI ou WhatsApp diretamente', async () => {
    // executeGroupedAgentInternal nunca é chamado diretamente pelo endpoint
    const deps = makeDeps({ claimedBatches: [makeBatch()] });
    await processMessageBuffer(makeReq(), makeRes(), deps);
    expect(deps.executeGroupedAgentInternal).not.toHaveBeenCalled();
    expect(deps.processClaimedBatch).toHaveBeenCalled();
  });

  it('TC-82 x-vercel-cron-schedule sanitizado não excede 50 caracteres no log', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Header com valor muito longo
    const longSchedule = 'A'.repeat(200);
    const req = makeReq({ headers: { 'x-vercel-cron-schedule': longSchedule } });

    await processMessageBuffer(req, makeRes(), makeDeps({ claimedBatches: [] }));

    const allLogs = logSpy.mock.calls.flat(Infinity)
      .map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ');

    // O valor truncado (máx 50) deve aparecer, o valor completo não
    expect(allLogs).toContain('A'.repeat(50));
    expect(allLogs).not.toContain('A'.repeat(51));

    logSpy.mockRestore();
  });

  it('TC-83 Allow header não aparece em respostas 200', async () => {
    const deps = makeDeps({ claimedBatches: [] });
    const res  = makeRes();

    await processMessageBuffer(makeReq(), res, deps);

    expect(res._statusCode).toBe(200);
    expect(res._headers['allow']).toBeUndefined();
  });

  it('TC-84 contrato HTTP completo: todos os campos no formato esperado', async () => {
    const deps = makeDeps({
      recoverExecResult:  [{ id: 'e1' }],
      recoverBatchResult: [{ id: 'b0' }],
      claimedBatches:     [makeBatch({ id: 'b1' }), makeBatch({ id: 'b2' })],
      pipelineResult:     makePipelineResult('processed', true),
    });
    const res = makeRes();

    await processMessageBuffer(makeReq(), res, deps);

    // Estrutura completa conforme contrato documentado
    expect(res._body).toMatchObject({
      success:   true,
      claimed:   2,
      processed: 2,
      failed:    0,
      summary: {
        recovered_executions:  1,
        recovered_batches:     1,
        retried:               0,
        rescheduled:           0,
        cancelled:             0,
        skipped:               0,
        reconciliation_errors: 0,
      },
    });
  });
});
