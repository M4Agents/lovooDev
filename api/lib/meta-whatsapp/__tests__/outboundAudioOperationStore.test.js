// =============================================================================
// outboundAudioOperationStore.test.js — B3.2-C.3-C.2 / C.3-D.2
// Mocks locais. Sem Graph, S3, SQL remoto ou fetch.
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  META_OUTBOUND_AUDIO_OPERATIONS_TABLE,
  claimCreatedToGraphInFlight,
  insertCreated,
  markCompleted,
  markFailedBeforeClaim,
  markGraphAccepted,
  markUnknown,
  selectByCompanyOperation,
} from '../outboundAudioOperationStore.js';

const COMPANY = 'aaaa0000-0000-0000-0000-000000000001';
const OTHER_COMPANY = 'eeee0000-0000-4000-8000-000000000005';
const USER = 'bbbb0000-0000-4000-8000-000000000002';
const INSTANCE = 'cccc0000-0000-4000-8000-000000000003';
const CONVERSATION = 'dddd0000-0000-4000-8000-000000000004';
const OP = 'a0b1c2d3-e4f5-4a67-8b90-123456789abc';
const OP_UPPER = 'A0B1C2D3-E4F5-4A67-8B90-123456789ABC';
const SHA = 'a'.repeat(64);
const STARTED_AT = '2026-11-18T16:00:00.000Z';
const COMPLETED_AT = '2026-11-18T16:05:00.000Z';
const WAMID = 'wamid.HBgLNTU1MTk4NzY1NDMyMQIVAgARGBI4NzY1NDMyMQ==';
const S3_KEY = `clientes/${COMPANY}/meta-outbound/audio.m4a`;
const STORE_SRC = readFileSync(
  fileURLToPath(new URL('../outboundAudioOperationStore.js', import.meta.url)),
  'utf8',
);
const SEND_AUDIO_SRC = readFileSync(
  fileURLToPath(new URL('../../../whatsapp/meta/messages/send-audio.js', import.meta.url)),
  'utf8',
);

function identity(overrides = {}) {
  return {
    company_id: COMPANY,
    operation_id: OP,
    user_id: USER,
    instance_id: INSTANCE,
    conversation_id: CONVERSATION,
    audio_sha256: SHA,
    ...overrides,
  };
}

function storedRow(overrides = {}) {
  return { ...identity(), status: 'created', wamid: null, s3_key: null, ...overrides };
}

function makeSelectChain({ data = null, error = null } = {}) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  return chain;
}

function makeInsertChain({ data = null, error = null } = {}) {
  const chain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  return chain;
}

function makeUpdateChain({ data = null, error = null } = {}) {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  return chain;
}

function makeSvc(chain) {
  return {
    from: vi.fn(() => chain),
  };
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called in outboundAudioOperationStore tests');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('selectByCompanyOperation', () => {
  it('retorna a linha filtrando company_id e operation_id', async () => {
    const row = storedRow();
    const chain = makeSelectChain({ data: row });
    const result = await selectByCompanyOperation(makeSvc(chain), {
      companyId: COMPANY,
      operationId: OP_UPPER,
    });
    expect(result).toEqual({ ok: true, row });
    expect(chain.eq).toHaveBeenNthCalledWith(1, 'company_id', COMPANY);
    expect(chain.eq).toHaveBeenNthCalledWith(2, 'operation_id', OP);
    expect(chain.eq.mock.calls.map((call) => call[1])).not.toContain(OP_UPPER);
  });

  it('nunca consulta somente por operation_id', async () => {
    const chain = makeSelectChain({ data: storedRow() });
    await selectByCompanyOperation(makeSvc(chain), { companyId: COMPANY, operationId: OP });
    const fields = chain.eq.mock.calls.map(([field]) => field);
    expect(fields).toEqual(['company_id', 'operation_id']);
  });

  it('empresas diferentes usam company_id distintos', async () => {
    const chain = makeSelectChain({ data: null });
    await selectByCompanyOperation(makeSvc(chain), {
      companyId: OTHER_COMPANY,
      operationId: OP,
    });
    expect(chain.eq).toHaveBeenCalledWith('company_id', OTHER_COMPANY);
    expect(chain.eq).not.toHaveBeenCalledWith('company_id', COMPANY);
  });

  it('linha ausente é not_found, não db_error', async () => {
    const result = await selectByCompanyOperation(
      makeSvc(makeSelectChain({ data: null })),
      { companyId: COMPANY, operationId: OP },
    );
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('erro de SELECT é db_error, não not_found', async () => {
    const result = await selectByCompanyOperation(
      makeSvc(makeSelectChain({ data: null, error: { code: 'PGRST301' } })),
      { companyId: COMPANY, operationId: OP },
    );
    expect(result).toEqual({ ok: false, reason: 'db_error' });
  });

  it('rejeita operation_id isolado ou inválido sem consultar', async () => {
    const svc = makeSvc(makeSelectChain());
    expect(await selectByCompanyOperation(svc, { operationId: OP })).toEqual({
      ok: false,
      reason: 'invalid_identity',
    });
    expect(await selectByCompanyOperation(svc, { companyId: COMPANY, operationId: 'not-a-uuid' }))
      .toEqual({ ok: false, reason: 'invalid_identity' });
    expect(svc.from).not.toHaveBeenCalled();
  });
});

describe('insertCreated', () => {
  it('INSERT simples em created com identidade autorizada', async () => {
    const row = storedRow();
    const chain = makeInsertChain({ data: row });
    const result = await insertCreated(makeSvc(chain), identity());
    expect(result).toEqual({ ok: true, row });
    expect(chain.insert).toHaveBeenCalledTimes(1);
    expect(chain.insert.mock.calls[0][0]).toEqual({ ...identity(), status: 'created' });
    expect(chain.insert.mock.calls[0][0]).not.toHaveProperty('onConflict');
  });

  it('canonicaliza operation_id no INSERT', async () => {
    const chain = makeInsertChain({ data: storedRow() });
    await insertCreated(makeSvc(chain), identity({ operation_id: OP_UPPER }));
    expect(chain.insert.mock.calls[0][0].operation_id).toBe(OP);
  });

  it('23505 retorna unique_violation pelo code, não pelo texto', async () => {
    const chain = makeInsertChain({
      error: { code: '23505', message: 'duplicate key SECRET_SQL_CANARY' },
    });
    const result = await insertCreated(makeSvc(chain), identity());
    expect(result).toEqual({ ok: false, reason: 'unique_violation' });
  });

  it('erro diferente de 23505 é db_error', async () => {
    const chain = makeInsertChain({
      error: { code: '23503', message: 'fk violation' },
    });
    expect(await insertCreated(makeSvc(chain), identity())).toEqual({
      ok: false,
      reason: 'db_error',
    });
  });

  it('não insere identidade incompleta ou SHA inválido', async () => {
    const svc = makeSvc(makeInsertChain());
    expect(await insertCreated(svc, identity({ audio_sha256: 'G'.repeat(64) })))
      .toEqual({ ok: false, reason: 'invalid_identity' });
    expect(await insertCreated(svc, { company_id: COMPANY })).toEqual({
      ok: false,
      reason: 'invalid_identity',
    });
    expect(svc.from).not.toHaveBeenCalled();
  });
});

describe('claimCreatedToGraphInFlight', () => {
  it('UPDATE condicional created → graph_in_flight com graph_started_at', async () => {
    const row = storedRow({ status: 'graph_in_flight', graph_started_at: STARTED_AT });
    const chain = makeUpdateChain({ data: row });
    const result = await claimCreatedToGraphInFlight(makeSvc(chain), {
      companyId: COMPANY,
      operationId: OP,
      graphStartedAt: STARTED_AT,
    });
    expect(result).toEqual({ ok: true, row });
    expect(chain.update).toHaveBeenCalledWith({
      status: 'graph_in_flight',
      graph_started_at: STARTED_AT,
    });
    expect(chain.eq.mock.calls).toEqual([
      ['company_id', COMPANY],
      ['operation_id', OP],
      ['status', 'created'],
    ]);
  });

  it('zero linhas é not_claimed, não db_error', async () => {
    const result = await claimCreatedToGraphInFlight(
      makeSvc(makeUpdateChain({ data: null })),
      { companyId: COMPANY, operationId: OP, graphStartedAt: STARTED_AT },
    );
    expect(result).toEqual({ ok: false, reason: 'not_claimed' });
  });

  it('erro de UPDATE é db_error', async () => {
    const result = await claimCreatedToGraphInFlight(
      makeSvc(makeUpdateChain({ error: { code: '57014' } })),
      { companyId: COMPANY, operationId: OP, graphStartedAt: STARTED_AT },
    );
    expect(result).toEqual({ ok: false, reason: 'db_error' });
  });

  it('timestamp inválido não toca o banco', async () => {
    const svc = makeSvc(makeUpdateChain());
    expect(await claimCreatedToGraphInFlight(svc, {
      companyId: COMPANY,
      operationId: OP,
      graphStartedAt: 'not-iso',
    })).toEqual({ ok: false, reason: 'invalid_started_at' });
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('duas empresas não compartilham o filtro de claim', async () => {
    const chain = makeUpdateChain({ data: null });
    await claimCreatedToGraphInFlight(makeSvc(chain), {
      companyId: OTHER_COMPANY,
      operationId: OP,
      graphStartedAt: STARTED_AT,
    });
    expect(chain.eq).toHaveBeenCalledWith('company_id', OTHER_COMPANY);
    expect(chain.eq).not.toHaveBeenCalledWith('company_id', COMPANY);
  });
});

describe('tabela e efeitos', () => {
  it('usa somente meta_outbound_audio_operations', async () => {
    const chain = makeSelectChain({ data: storedRow() });
    const svc = makeSvc(chain);
    await selectByCompanyOperation(svc, { companyId: COMPANY, operationId: OP });
    expect(svc.from).toHaveBeenCalledWith(META_OUTBOUND_AUDIO_OPERATIONS_TABLE);
    expect(svc.from).not.toHaveBeenCalledWith('meta_messages');
    expect(fetch).not.toHaveBeenCalled();
  });
});

function expectTenantStatusFilters(chain, companyId, fromStatus) {
  expect(chain.eq.mock.calls).toEqual([
    ['company_id', companyId],
    ['operation_id', OP],
    ['status', fromStatus],
  ]);
}

function expectNoIdentityMutation(patch) {
  expect(patch).not.toHaveProperty('company_id');
  expect(patch).not.toHaveProperty('operation_id');
  expect(patch).not.toHaveProperty('user_id');
  expect(patch).not.toHaveProperty('instance_id');
  expect(patch).not.toHaveProperty('conversation_id');
  expect(patch).not.toHaveProperty('audio_sha256');
}

describe('markUnknown', () => {
  it('transição com uma linha: graph_in_flight → unknown sem tocar wamid', async () => {
    const row = storedRow({
      status: 'unknown',
      graph_started_at: STARTED_AT,
    });
    const chain = makeUpdateChain({ data: row });
    const result = await markUnknown(makeSvc(chain), {
      companyId: COMPANY,
      operationId: OP,
    });
    expect(result).toEqual({ ok: true, row });
    expect(chain.update).toHaveBeenCalledWith({ status: 'unknown' });
    expectNoIdentityMutation(chain.update.mock.calls[0][0]);
    expect(chain.update.mock.calls[0][0]).not.toHaveProperty('wamid');
    expect(chain.update.mock.calls[0][0]).not.toHaveProperty('graph_started_at');
    expectTenantStatusFilters(chain, COMPANY, 'graph_in_flight');
  });

  it('zero linhas é not_transitioned, não unknown', async () => {
    const result = await markUnknown(
      makeSvc(makeUpdateChain({ data: null })),
      { companyId: COMPANY, operationId: OP },
    );
    expect(result).toEqual({ ok: false, reason: 'not_transitioned' });
  });

  it('erro de UPDATE é db_error', async () => {
    const result = await markUnknown(
      makeSvc(makeUpdateChain({ error: { code: '57014', message: 'SECRET' } })),
      { companyId: COMPANY, operationId: OP },
    );
    expect(result).toEqual({ ok: false, reason: 'db_error' });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('UPDATE de unknown após graph_accepted não assume o estado', async () => {
    const chain = makeUpdateChain({ data: null });
    const result = await markUnknown(makeSvc(chain), {
      companyId: COMPANY,
      operationId: OP,
    });
    expect(result).toEqual({ ok: false, reason: 'not_transitioned' });
    expect(chain.eq).toHaveBeenCalledWith('status', 'graph_in_flight');
    expect(chain.eq).not.toHaveBeenCalledWith('status', 'graph_accepted');
  });
});

describe('markGraphAccepted', () => {
  it('transição com uma linha persiste wamid e status juntos', async () => {
    const row = storedRow({
      status: 'graph_accepted',
      wamid: WAMID,
      graph_started_at: STARTED_AT,
    });
    const chain = makeUpdateChain({ data: row });
    const result = await markGraphAccepted(makeSvc(chain), {
      companyId: COMPANY,
      operationId: OP,
      wamid: WAMID,
    });
    expect(result).toEqual({ ok: true, row });
    expect(chain.update).toHaveBeenCalledWith({
      status: 'graph_accepted',
      wamid: WAMID,
    });
    expectNoIdentityMutation(chain.update.mock.calls[0][0]);
    expect(chain.update.mock.calls[0][0]).not.toHaveProperty('graph_started_at');
    expectTenantStatusFilters(chain, COMPANY, 'graph_in_flight');
  });

  it('zero linhas não declara graph_accepted', async () => {
    const result = await markGraphAccepted(
      makeSvc(makeUpdateChain({ data: null })),
      { companyId: COMPANY, operationId: OP, wamid: WAMID },
    );
    expect(result).toEqual({ ok: false, reason: 'not_transitioned' });
  });

  it.each(['', '   ', 'x'.repeat(201), null, undefined])(
    'wamid inválido (%s) não toca o banco',
    async (wamid) => {
      const svc = makeSvc(makeUpdateChain());
      expect(await markGraphAccepted(svc, {
        companyId: COMPANY,
        operationId: OP,
        wamid,
      })).toEqual({ ok: false, reason: 'invalid_input' });
      expect(svc.from).not.toHaveBeenCalled();
    },
  );

  it('UPDATE de accepted após unknown filtra graph_in_flight', async () => {
    const chain = makeUpdateChain({ data: null });
    const result = await markGraphAccepted(makeSvc(chain), {
      companyId: COMPANY,
      operationId: OP,
      wamid: WAMID,
    });
    expect(result).toEqual({ ok: false, reason: 'not_transitioned' });
    expect(chain.eq).toHaveBeenCalledWith('status', 'graph_in_flight');
    expect(chain.eq).not.toHaveBeenCalledWith('status', 'unknown');
  });
});

describe('markCompleted', () => {
  it('transição com uma linha grava s3_key e completed_at sem mutar identidade', async () => {
    const row = storedRow({
      status: 'completed',
      wamid: WAMID,
      s3_key: S3_KEY,
      graph_started_at: STARTED_AT,
      completed_at: COMPLETED_AT,
    });
    const chain = makeUpdateChain({ data: row });
    const result = await markCompleted(makeSvc(chain), {
      companyId: COMPANY,
      operationId: OP,
      s3Key: S3_KEY,
      completedAt: COMPLETED_AT,
    });
    expect(result).toEqual({ ok: true, row });
    expect(chain.update).toHaveBeenCalledWith({
      status: 'completed',
      s3_key: S3_KEY,
      completed_at: COMPLETED_AT,
    });
    expectNoIdentityMutation(chain.update.mock.calls[0][0]);
    expect(chain.update.mock.calls[0][0]).not.toHaveProperty('wamid');
    expect(chain.update.mock.calls[0][0]).not.toHaveProperty('graph_started_at');
    expectTenantStatusFilters(chain, COMPANY, 'graph_accepted');
  });

  it('s3_key vazia ou timestamp inválido não toca o banco', async () => {
    const svc = makeSvc(makeUpdateChain());
    expect(await markCompleted(svc, {
      companyId: COMPANY,
      operationId: OP,
      s3Key: '  ',
      completedAt: COMPLETED_AT,
    })).toEqual({ ok: false, reason: 'invalid_input' });
    expect(await markCompleted(svc, {
      companyId: COMPANY,
      operationId: OP,
      s3Key: S3_KEY,
      completedAt: 'not-iso',
    })).toEqual({ ok: false, reason: 'invalid_input' });
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('tentativa de completar sem aceite retorna not_transitioned', async () => {
    const chain = makeUpdateChain({ data: null });
    const result = await markCompleted(makeSvc(chain), {
      companyId: COMPANY,
      operationId: OP,
      s3Key: S3_KEY,
      completedAt: COMPLETED_AT,
    });
    expect(result).toEqual({ ok: false, reason: 'not_transitioned' });
    expect(chain.eq).toHaveBeenCalledWith('status', 'graph_accepted');
    expect(chain.eq).not.toHaveBeenCalledWith('status', 'graph_in_flight');
  });
});

describe('markFailedBeforeClaim', () => {
  it('created → failed exige evidência definitiva e não preenche Graph', async () => {
    const row = storedRow({ status: 'failed' });
    const chain = makeUpdateChain({ data: row });
    const result = await markFailedBeforeClaim(makeSvc(chain), {
      companyId: COMPANY,
      operationId: OP,
      definitiveFailureEvidence: true,
      errorCode: 'pre_claim_rejected',
    });
    expect(result).toEqual({ ok: true, row });
    expect(chain.update).toHaveBeenCalledWith({
      status: 'failed',
      error_code: 'pre_claim_rejected',
    });
    expect(chain.update.mock.calls[0][0]).not.toHaveProperty('graph_started_at');
    expect(chain.update.mock.calls[0][0]).not.toHaveProperty('wamid');
    expect(chain.update.mock.calls[0][0]).not.toHaveProperty('completed_at');
    expectTenantStatusFilters(chain, COMPANY, 'created');
  });

  it('sem evidência definitiva não inventa failed', async () => {
    const svc = makeSvc(makeUpdateChain());
    expect(await markFailedBeforeClaim(svc, {
      companyId: COMPANY,
      operationId: OP,
    })).toEqual({ ok: false, reason: 'invalid_input' });
    expect(await markFailedBeforeClaim(svc, {
      companyId: COMPANY,
      operationId: OP,
      definitiveFailureEvidence: 'true',
    })).toEqual({ ok: false, reason: 'invalid_input' });
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('tentativa de marcar failed após claim filtra created', async () => {
    const chain = makeUpdateChain({ data: null });
    const result = await markFailedBeforeClaim(makeSvc(chain), {
      companyId: COMPANY,
      operationId: OP,
      definitiveFailureEvidence: true,
    });
    expect(result).toEqual({ ok: false, reason: 'not_transitioned' });
    expect(chain.eq).toHaveBeenCalledWith('status', 'created');
    expect(chain.eq).not.toHaveBeenCalledWith('status', 'graph_in_flight');
  });
});

describe('concorrência, tenant e HTTP', () => {
  it('duas tentativas concorrentes: segunda vê zero linhas', async () => {
    const winner = makeUpdateChain({
      data: storedRow({ status: 'unknown', graph_started_at: STARTED_AT }),
    });
    const loser = makeUpdateChain({ data: null });
    const first = await markUnknown(makeSvc(winner), { companyId: COMPANY, operationId: OP });
    const second = await markUnknown(makeSvc(loser), { companyId: COMPANY, operationId: OP });
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: 'not_transitioned' });
    expect(winner.eq).toHaveBeenCalledWith('status', 'graph_in_flight');
    expect(loser.eq).toHaveBeenCalledWith('status', 'graph_in_flight');
  });

  it('tenant diferente não reutiliza company_id', async () => {
    const chain = makeUpdateChain({ data: null });
    await markUnknown(makeSvc(chain), { companyId: OTHER_COMPANY, operationId: OP });
    expect(chain.eq).toHaveBeenCalledWith('company_id', OTHER_COMPANY);
    expect(chain.eq).not.toHaveBeenCalledWith('company_id', COMPANY);
    expect(chain.eq.mock.calls.map(([field]) => field)).toContain('company_id');
    expect(chain.eq.mock.calls.map(([field]) => field)).not.toEqual(['operation_id']);
  });

  it('nenhuma consulta sem company_id e HTTP não chama claim/unknown/failed', () => {
    const executable = STORE_SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(executable).toContain(".eq('company_id'");
    expect(executable).not.toContain('uploadMedia');
    expect(executable).not.toContain('sendAudioMessage');
    expect(executable).not.toContain('awsUpload');
    expect(executable).not.toContain('onConflict');
    expect(SEND_AUDIO_SRC).toContain('markUnknown');
    expect(SEND_AUDIO_SRC).toContain('markGraphAccepted');
    expect(SEND_AUDIO_SRC).toContain('markCompleted');
    expect(SEND_AUDIO_SRC).not.toContain('markFailedBeforeClaim');
    expect(SEND_AUDIO_SRC).toContain('claimCreatedToGraphInFlight');
  });

  it('erro de banco não vira sucesso', async () => {
    const result = await markGraphAccepted(
      makeSvc(makeUpdateChain({ error: { code: '23514', message: 'check_violation' } })),
      { companyId: COMPANY, operationId: OP, wamid: WAMID },
    );
    expect(result).toEqual({ ok: false, reason: 'db_error' });
    expect(result).not.toHaveProperty('row');
  });
});

