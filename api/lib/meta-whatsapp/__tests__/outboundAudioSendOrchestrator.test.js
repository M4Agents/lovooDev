// =============================================================================
// outboundAudioSendOrchestrator.test.js — B3.2-C.3-D.3-D.2-C
// Mocks locais. Sem Graph real, S3, SQL remoto ou fetch.
// enabled: true só neste arquivo, com deps mockadas e relógio injetado.
// HTTP permanece gated.
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OUTBOUND_AUDIO_UPLOAD_FILENAME,
  OUTBOUND_AUDIO_UPLOAD_MIME,
  orchestrateOutboundAudioSend,
} from '../outboundAudioSendOrchestrator.js';

const COMPANY = 'aaaa0000-0000-0000-0000-000000000001';
const USER = 'bbbb0000-0000-4000-8000-000000000002';
const INSTANCE = 'cccc0000-0000-4000-8000-000000000003';
const CONVERSATION = 'dddd0000-0000-4000-8000-000000000004';
const OP = 'a0b1c2d3-e4f5-4a67-8b90-123456789abc';
const SHA = 'a'.repeat(64);
const STARTED_AT = '2026-11-18T16:00:00.000Z';
const MEDIA_ID = '1013859600285441';
const WAMID = 'wamid.HBgLNTU1MTk4NzY1NDMyMQIVAgARGBI4NzY1NDMyMQ==';
const PHONE_NUMBER_ID = '106540352242922';
const WA_ID = '5511987654321';
const TOKEN = 'EAAAN_fake_business_token_not_real_XYZ789';
const BYTES = Buffer.from('fake-aac-lc-bytes');
const NOW_MS = Date.parse(STARTED_AT);
const UPLOAD_TIMEOUT_MS = 20_000;
const SEND_TIMEOUT_MS = 10_000;
const PERSIST_RESERVE_MS = 2_000;
const CLAIM_RESERVE_MS = 1_000;
const NEED_BEFORE_CLAIM = CLAIM_RESERVE_MS + UPLOAD_TIMEOUT_MS + SEND_TIMEOUT_MS + PERSIST_RESERVE_MS;

const ORCH_SRC = readFileSync(
  fileURLToPath(new URL('../outboundAudioSendOrchestrator.js', import.meta.url)),
  'utf8',
);
const SEND_AUDIO_SRC = readFileSync(
  fileURLToPath(new URL('../../../whatsapp/meta/messages/send-audio.js', import.meta.url)),
  'utf8',
);

function context(overrides = {}) {
  return {
    companyId: COMPANY,
    operationId: OP,
    userId: USER,
    instanceId: INSTANCE,
    conversationId: CONVERSATION,
    phoneNumberId: PHONE_NUMBER_ID,
    recipientWaId: WA_ID,
    accessToken: TOKEN,
    audioBytes: BYTES,
    audioSha256: SHA,
    operationStatus: 'created',
    customerServiceWindowOpen: true,
    ...overrides,
  };
}

function claimedRow(overrides = {}) {
  return {
    company_id: COMPANY,
    operation_id: OP,
    user_id: USER,
    instance_id: INSTANCE,
    conversation_id: CONVERSATION,
    audio_sha256: SHA,
    status: 'graph_in_flight',
    wamid: null,
    graph_started_at: STARTED_AT,
    ...overrides,
  };
}

function makeDeps(overrides = {}) {
  return {
    claimCreatedToGraphInFlight: vi.fn(async () => ({ ok: true, row: claimedRow() })),
    uploadMedia: vi.fn(async () => ({ mediaId: MEDIA_ID })),
    sendAudioMessage: vi.fn(async () => ({ messageId: WAMID })),
    markUnknown: vi.fn(async () => ({ ok: true, row: { status: 'unknown' } })),
    markGraphAccepted: vi.fn(async () => ({
      ok: true,
      row: { status: 'graph_accepted', wamid: WAMID },
    })),
    markCompleted: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

function now() {
  return STARTED_AT;
}

function makeClock(nowMs = NOW_MS) {
  const clock = vi.fn(() => nowMs);
  clock.advanceTo = (value) => {
    clock.mockImplementation(() => value);
  };
  return clock;
}

function budget(overrides = {}) {
  return {
    deadlineAtMs: NOW_MS + 60_000,
    uploadTimeoutMs: UPLOAD_TIMEOUT_MS,
    sendTimeoutMs: SEND_TIMEOUT_MS,
    persistReserveMs: PERSIST_RESERVE_MS,
    claimReserveMs: CLAIM_RESERVE_MS,
    clock: makeClock(),
    ...overrides,
  };
}

async function run(overrides = {}) {
  const deps = overrides.deps ?? makeDeps();
  const result = await orchestrateOutboundAudioSend({
    enabled: true,
    context: context(),
    deps,
    now,
    ...budget(),
    ...overrides,
    deps: overrides.deps ?? deps,
  });
  return { result, deps: overrides.deps ?? deps };
}

function expectNoSecret(result) {
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(TOKEN);
  expect(serialized).not.toContain('fake-aac-lc-bytes');
  expect(result).not.toHaveProperty('accessToken');
  expect(result.mayRetryGraph).toBe(false);
  expect(result.mayMintOperationId).toBe(false);
}

function expectNoGraph(deps) {
  expect(deps.uploadMedia).not.toHaveBeenCalled();
  expect(deps.sendAudioMessage).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called in outboundAudioSendOrchestrator tests');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gate', () => {
  it('enabled false → nenhuma dependência chamada', async () => {
    const deps = makeDeps();
    const clock = makeClock();
    const result = await orchestrateOutboundAudioSend({
      enabled: false,
      context: context(),
      deps,
      now,
      clock,
      deadlineAtMs: NOW_MS + 60_000,
    });
    expect(result).toMatchObject({
      ok: false,
      error: 'audio_send_not_enabled',
      claimed: false,
    });
    expect(clock).not.toHaveBeenCalled();
    expect(deps.claimCreatedToGraphInFlight).not.toHaveBeenCalled();
    expect(deps.markUnknown).not.toHaveBeenCalled();
    expect(deps.markGraphAccepted).not.toHaveBeenCalled();
    expectNoGraph(deps);
    expectNoSecret(result);
  });

  it('enabled ausente → nenhuma dependência chamada', async () => {
    const deps = makeDeps();
    const clock = makeClock();
    const result = await orchestrateOutboundAudioSend({
      context: context(),
      deps,
      now,
      clock,
      deadlineAtMs: NOW_MS + 60_000,
    });
    expect(result.error).toBe('audio_send_not_enabled');
    expect(clock).not.toHaveBeenCalled();
    expect(deps.claimCreatedToGraphInFlight).not.toHaveBeenCalled();
    expectNoGraph(deps);
  });

  it('enabled false sem deadline continua audio_send_not_enabled', async () => {
    const deps = makeDeps();
    const result = await orchestrateOutboundAudioSend({
      enabled: false,
      context: context(),
      deps,
      now,
    });
    expect(result.error).toBe('audio_send_not_enabled');
    expect(deps.claimCreatedToGraphInFlight).not.toHaveBeenCalled();
    expectNoGraph(deps);
  });
});

describe('pré-condições', () => {
  it('contexto inválido → nenhum claim', async () => {
    const deps = makeDeps();
    const result = await orchestrateOutboundAudioSend({
      enabled: true,
      context: context({ customerServiceWindowOpen: false }),
      deps,
      now,
      ...budget(),
    });
    expect(result.error).toBe('invalid_context');
    expect(deps.claimCreatedToGraphInFlight).not.toHaveBeenCalled();
    expectNoGraph(deps);
  });

  it('destinatário ou phone_number_id de formulário inválidos não passam', async () => {
    const deps = makeDeps();
    const phone = await orchestrateOutboundAudioSend({
      enabled: true,
      context: context({ phoneNumberId: 'not-numeric' }),
      deps,
      now,
      ...budget(),
    });
    const to = await orchestrateOutboundAudioSend({
      enabled: true,
      context: context({ recipientWaId: '+5511987654321' }),
      deps,
      now,
      ...budget(),
    });
    expect(phone.error).toBe('invalid_context');
    expect(to.error).toBe('invalid_context');
    expect(deps.claimCreatedToGraphInFlight).not.toHaveBeenCalled();
  });

  it('enabled true sem deadline → rejeição antes do claim', async () => {
    const deps = makeDeps();
    const result = await orchestrateOutboundAudioSend({
      enabled: true,
      context: context(),
      deps,
      now,
      clock: makeClock(),
    });
    expect(result.error).toBe('invalid_deadline');
    expect(result.claimed).toBe(false);
    expect(deps.claimCreatedToGraphInFlight).not.toHaveBeenCalled();
    expectNoGraph(deps);
  });

  it.each([
    ['ausente', undefined],
    ['não inteiro', 1.5],
    ['string', '8000'],
    ['passado', NOW_MS - 1],
    ['igual ao relógio', NOW_MS],
  ])('deadline %s → rejeição antes do claim', async (_label, deadlineAtMs) => {
    const deps = makeDeps();
    const result = await orchestrateOutboundAudioSend({
      enabled: true,
      context: context(),
      deps,
      now,
      ...budget({ deadlineAtMs }),
    });
    expect(result.error).toBe('invalid_deadline');
    expect(deps.claimCreatedToGraphInFlight).not.toHaveBeenCalled();
    expectNoGraph(deps);
  });

  it.each([
    ['uploadTimeoutMs', { uploadTimeoutMs: 0 }],
    ['sendTimeoutMs', { sendTimeoutMs: -1 }],
    ['sendTimeoutMs decimal', { sendTimeoutMs: 10_000.2 }],
    ['persistReserveMs string', { persistReserveMs: '2000' }],
    ['claimReserveMs NaN', { claimReserveMs: Number.NaN }],
  ])('orçamento inválido (%s) → rejeição antes do claim', async (_label, override) => {
    const deps = makeDeps();
    const result = await orchestrateOutboundAudioSend({
      enabled: true,
      context: context(),
      deps,
      now,
      ...budget(override),
    });
    expect(result.error).toBe('invalid_budget');
    expect(deps.claimCreatedToGraphInFlight).not.toHaveBeenCalled();
    expectNoGraph(deps);
  });
});

describe('deadline', () => {
  it('prazo insuficiente antes do claim → zero Graph', async () => {
    const { result, deps } = await run({
      deadlineAtMs: NOW_MS + NEED_BEFORE_CLAIM - 1,
    });
    expect(result.error).toBe('deadline_insufficient_before_claim');
    expect(result.claimed).toBe(false);
    expect(result.mayRetryGraph).toBe(false);
    expect(deps.claimCreatedToGraphInFlight).not.toHaveBeenCalled();
    expect(deps.markUnknown).not.toHaveBeenCalled();
    expectNoGraph(deps);
    expectNoSecret(result);
  });

  it('prazo exatamente no limite mínimo → claim e Graph', async () => {
    const { result, deps } = await run({
      deadlineAtMs: NOW_MS + NEED_BEFORE_CLAIM,
    });
    expect(result.ok).toBe(true);
    expect(deps.claimCreatedToGraphInFlight).toHaveBeenCalledTimes(1);
    expect(deps.uploadMedia).toHaveBeenCalledTimes(1);
    expect(deps.sendAudioMessage).toHaveBeenCalledTimes(1);
  });

  it('prazo insuficiente após claim → markUnknown sem Graph', async () => {
    const clock = makeClock(NOW_MS);
    const deps = makeDeps({
      claimCreatedToGraphInFlight: vi.fn(async () => {
        clock.advanceTo(NOW_MS + 5_000);
        return { ok: true, row: claimedRow() };
      }),
    });
    const { result } = await run({
      deps,
      clock,
      deadlineAtMs: NOW_MS + NEED_BEFORE_CLAIM,
    });
    expect(result.error).toBe('deadline_insufficient_after_claim');
    expect(result.claimed).toBe(true);
    expect(result.persistedStatus).toBe('unknown');
    expect(result.mayRetryGraph).toBe(false);
    expect(deps.uploadMedia).not.toHaveBeenCalled();
    expect(deps.sendAudioMessage).not.toHaveBeenCalled();
    expect(deps.markUnknown).toHaveBeenCalledTimes(1);
    expect(deps.markGraphAccepted).not.toHaveBeenCalled();
  });

  it('markUnknown falha após deadline pós-claim → persist_unknown_failed', async () => {
    const clock = makeClock(NOW_MS);
    const deps = makeDeps({
      claimCreatedToGraphInFlight: vi.fn(async () => {
        clock.advanceTo(NOW_MS + 5_000);
        return { ok: true, row: claimedRow() };
      }),
      markUnknown: vi.fn(async () => ({ ok: false, reason: 'db_error' })),
    });
    const { result } = await run({
      deps,
      clock,
      deadlineAtMs: NOW_MS + NEED_BEFORE_CLAIM,
    });
    expect(result.error).toBe('persist_unknown_failed');
    expect(result.claimed).toBe(true);
    expect(result.persistFailed).toBe(true);
    expect(result.persistedStatus).toBeNull();
    expectNoGraph(deps);
  });

  it('upload ok e prazo insuficiente para send → markUnknown', async () => {
    const clock = makeClock(NOW_MS);
    const deps = makeDeps({
      uploadMedia: vi.fn(async () => {
        clock.advanceTo(NOW_MS + 50_000);
        return { mediaId: MEDIA_ID };
      }),
    });
    const { result } = await run({ deps, clock });
    expect(result.error).toBe('deadline_insufficient_after_claim');
    expect(result.persistedStatus).toBe('unknown');
    expect(deps.uploadMedia).toHaveBeenCalledTimes(1);
    expect(deps.sendAudioMessage).not.toHaveBeenCalled();
    expect(deps.markUnknown).toHaveBeenCalledTimes(1);
    expect(deps.markGraphAccepted).not.toHaveBeenCalled();
  });

  it('deadline ultrapassado após wamid ainda tenta markGraphAccepted', async () => {
    const clock = makeClock(NOW_MS);
    const deps = makeDeps({
      sendAudioMessage: vi.fn(async () => {
        clock.advanceTo(NOW_MS + 120_000);
        return { messageId: WAMID };
      }),
    });
    const { result } = await run({ deps, clock });
    expect(result.ok).toBe(true);
    expect(result.persistedStatus).toBe('graph_accepted');
    expect(result.wamid).toBe(WAMID);
    expect(deps.markGraphAccepted).toHaveBeenCalledTimes(1);
    expect(deps.markUnknown).not.toHaveBeenCalled();
    expect(deps.uploadMedia).toHaveBeenCalledTimes(1);
    expect(deps.sendAudioMessage).toHaveBeenCalledTimes(1);
  });
});

describe('claim', () => {
  it('not_claimed → nenhum Graph', async () => {
    const deps = makeDeps({
      claimCreatedToGraphInFlight: vi.fn(async () => ({ ok: false, reason: 'not_claimed' })),
    });
    const { result } = await run({ deps });
    expect(result.error).toBe('claim_not_claimed');
    expect(result.claimed).toBe(false);
    expectNoGraph(deps);
    expect(deps.markUnknown).not.toHaveBeenCalled();
  });

  it('db_error → nenhum Graph', async () => {
    const deps = makeDeps({
      claimCreatedToGraphInFlight: vi.fn(async () => ({ ok: false, reason: 'db_error' })),
    });
    const { result } = await run({ deps });
    expect(result.error).toBe('claim_db_error');
    expectNoGraph(deps);
  });

  it('linha inconsistente de company_id → nenhum Graph nem markUnknown', async () => {
    const deps = makeDeps({
      claimCreatedToGraphInFlight: vi.fn(async () => ({
        ok: true,
        row: claimedRow({ company_id: 'eeee0000-0000-4000-8000-000000000005' }),
      })),
    });
    const { result } = await run({ deps });
    expect(result.error).toBe('claim_inconsistent');
    expect(result.claimed).toBe(false);
    expectNoGraph(deps);
    expect(deps.markUnknown).not.toHaveBeenCalled();
    expect(deps.markGraphAccepted).not.toHaveBeenCalled();
  });

  it.each([
    ['user_id', { user_id: 'ffff0000-0000-4000-8000-000000000006' }],
    ['instance_id', { instance_id: 'aaaa1111-0000-4000-8000-000000000007' }],
    ['conversation_id', { conversation_id: 'bbbb1111-0000-4000-8000-000000000008' }],
    ['audio_sha256', { audio_sha256: 'b'.repeat(64) }],
    ['status', { status: 'created' }],
    ['graph_started_at ausente', { graph_started_at: null }],
    ['graph_started_at inválido', { graph_started_at: 'not-an-iso-timestamp' }],
    ['wamid preenchido', { wamid: WAMID }],
  ])('claim com %s divergente → claim_inconsistent sem Graph', async (_label, rowOverrides) => {
    const deps = makeDeps({
      claimCreatedToGraphInFlight: vi.fn(async () => ({
        ok: true,
        row: claimedRow(rowOverrides),
      })),
    });
    const { result } = await run({ deps });
    expect(result.error).toBe('claim_inconsistent');
    expect(result.claimed).toBe(false);
    expectNoGraph(deps);
    expect(deps.markUnknown).not.toHaveBeenCalled();
    expect(deps.markGraphAccepted).not.toHaveBeenCalled();
  });

  it('claim válido com identidade completa → exatamente um upload', async () => {
    const { result, deps } = await run();
    expect(result.ok).toBe(true);
    expect(deps.claimCreatedToGraphInFlight).toHaveBeenCalledTimes(1);
    expect(deps.uploadMedia).toHaveBeenCalledTimes(1);
    expect(deps.uploadMedia).toHaveBeenCalledWith(
      TOKEN,
      PHONE_NUMBER_ID,
      BYTES,
      OUTBOUND_AUDIO_UPLOAD_MIME,
      OUTBOUND_AUDIO_UPLOAD_FILENAME,
      UPLOAD_TIMEOUT_MS,
    );
  });
});

describe('upload e send', () => {
  it('upload válido → exatamente um send sem voice', async () => {
    const { deps } = await run();
    expect(deps.sendAudioMessage).toHaveBeenCalledTimes(1);
    expect(deps.sendAudioMessage.mock.calls[0]).toEqual([
      TOKEN,
      PHONE_NUMBER_ID,
      WA_ID,
      MEDIA_ID,
      { timeoutMs: SEND_TIMEOUT_MS },
    ]);
    expect(deps.sendAudioMessage.mock.calls[0][4]).not.toHaveProperty('voice');
  });

  it('timeouts customizados são transmitidos sem voice', async () => {
    const { deps } = await run({
      uploadTimeoutMs: 15_000,
      sendTimeoutMs: 8_000,
    });
    expect(deps.uploadMedia.mock.calls[0][5]).toBe(15_000);
    expect(deps.sendAudioMessage.mock.calls[0][4]).toEqual({ timeoutMs: 8_000 });
  });

  it('upload inválido → nenhum send e tenta unknown', async () => {
    const deps = makeDeps({
      uploadMedia: vi.fn(async () => ({ mediaId: '' })),
    });
    const { result } = await run({ deps });
    expect(result.persistedStatus).toBe('unknown');
    expect(deps.sendAudioMessage).not.toHaveBeenCalled();
    expect(deps.markUnknown).toHaveBeenCalledTimes(1);
    expect(deps.uploadMedia).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['upload_media_timeout'],
    ['upload_media_network_error'],
  ])('timeout/rede de upload (%s) → unknown', async (code) => {
    const deps = makeDeps({
      uploadMedia: vi.fn(async () => {
        const err = new Error('hidden');
        err.code = code;
        throw err;
      }),
    });
    const { result } = await run({ deps });
    expect(result.error).toBe('operation_unknown');
    expect(result.persistedStatus).toBe('unknown');
    expect(deps.sendAudioMessage).not.toHaveBeenCalled();
    expect(deps.markGraphAccepted).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('hidden');
  });

  it.each([
    [400],
    [503],
  ])('HTTP %s de upload → unknown', async (graphStatus) => {
    const deps = makeDeps({
      uploadMedia: vi.fn(async () => {
        const err = new Error('META_RAW');
        err.code = 'upload_media_failed';
        err.graphStatus = graphStatus;
        throw err;
      }),
    });
    const { result } = await run({ deps });
    expect(result.persistedStatus).toBe('unknown');
    expect(deps.sendAudioMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['send_audio_timeout'],
    ['send_audio_network_error'],
  ])('timeout/rede de send (%s) → unknown', async (code) => {
    const deps = makeDeps({
      sendAudioMessage: vi.fn(async () => {
        const err = new Error('hidden');
        err.code = code;
        throw err;
      }),
    });
    const { result } = await run({ deps });
    expect(result.persistedStatus).toBe('unknown');
    expect(deps.markGraphAccepted).not.toHaveBeenCalled();
    expect(deps.sendAudioMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400],
    [500],
  ])('HTTP %s de send → unknown', async (graphStatus) => {
    const deps = makeDeps({
      sendAudioMessage: vi.fn(async () => {
        const err = new Error('META_RAW');
        err.code = 'send_audio_failed';
        err.graphStatus = graphStatus;
        throw err;
      }),
    });
    const { result } = await run({ deps });
    expect(result.persistedStatus).toBe('unknown');
    expect(deps.markGraphAccepted).not.toHaveBeenCalled();
  });

  it('send sem wamid → unknown', async () => {
    const deps = makeDeps({
      sendAudioMessage: vi.fn(async () => ({ messageId: '' })),
    });
    const { result } = await run({ deps });
    expect(result.persistedStatus).toBe('unknown');
    expect(deps.markGraphAccepted).not.toHaveBeenCalled();
  });
});

describe('persistência', () => {
  it('wamid válido → markGraphAccepted e não completed', async () => {
    const { result, deps } = await run();
    expect(result).toMatchObject({
      ok: true,
      claimed: true,
      persistedStatus: 'graph_accepted',
      wamid: WAMID,
    });
    expect(deps.markGraphAccepted).toHaveBeenCalledTimes(1);
    expect(deps.markGraphAccepted).toHaveBeenCalledWith({
      companyId: COMPANY,
      operationId: OP,
      wamid: WAMID,
    });
    expect(deps.markCompleted).not.toHaveBeenCalled();
    expect(deps.markUnknown).not.toHaveBeenCalled();
    expectNoSecret(result);
  });

  it('falha de markUnknown → erro de persistência', async () => {
    const deps = makeDeps({
      uploadMedia: vi.fn(async () => {
        const err = new Error('x');
        err.code = 'upload_media_timeout';
        throw err;
      }),
      markUnknown: vi.fn(async () => ({ ok: false, reason: 'db_error' })),
    });
    const { result } = await run({ deps });
    expect(result.error).toBe('persist_unknown_failed');
    expect(result.persistFailed).toBe(true);
    expect(result.persistedStatus).toBeNull();
    expect(deps.sendAudioMessage).not.toHaveBeenCalled();
  });

  it('falha de markGraphAccepted → erro de persistência com wamid em memória', async () => {
    const deps = makeDeps({
      markGraphAccepted: vi.fn(async () => ({ ok: false, reason: 'not_transitioned' })),
    });
    const { result } = await run({ deps });
    expect(result.error).toBe('persist_wamid_failed');
    expect(result.persistFailed).toBe(true);
    expect(result.wamidInMemory).toBe(WAMID);
    expect(result.persistedStatus).toBeNull();
    expect(result).not.toHaveProperty('wamid');
    expect(deps.uploadMedia).toHaveBeenCalledTimes(1);
    expect(deps.sendAudioMessage).toHaveBeenCalledTimes(1);
    expectNoSecret(result);
  });
});

describe('invariantes', () => {
  it('nenhum retry Graph e nenhuma geração de operation_id', async () => {
    const deps = makeDeps({
      uploadMedia: vi.fn(async () => {
        const err = new Error('x');
        err.code = 'upload_media_failed';
        err.graphStatus = 500;
        throw err;
      }),
    });
    await run({ deps });
    expect(deps.uploadMedia).toHaveBeenCalledTimes(1);
    expect(deps.sendAudioMessage).not.toHaveBeenCalled();
    const executable = ORCH_SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(executable).not.toContain('randomUUID');
    expect(executable).not.toContain('process.env');
    expect(executable).not.toContain('graphClient');
    expect(executable).not.toContain('getSupabaseAdmin');
    expect(executable).not.toContain('tokenCrypto');
    expect(executable).not.toContain('awsUpload');
    expect(executable).not.toContain('markCompleted');
    expect(executable).not.toContain('voice: true');
  });

  it('exceção de dependência após claim não reenvia Graph', async () => {
    const deps = makeDeps({
      uploadMedia: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const { result } = await run({ deps });
    expect(result.claimed).toBe(true);
    expect(deps.uploadMedia).toHaveBeenCalledTimes(1);
    expect(deps.sendAudioMessage).not.toHaveBeenCalled();
    expect(deps.markUnknown).toHaveBeenCalledTimes(1);
  });

  it('HTTP chama o orquestrador com enabled true após auth, sem env de gate', () => {
    const executable = SEND_AUDIO_SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(SEND_AUDIO_SRC).toContain('orchestrateOutboundAudioSend');
    expect(SEND_AUDIO_SRC).toContain('outboundAudioSendOrchestrator');
    expect(SEND_AUDIO_SRC).not.toContain('META_OUTBOUND_AUDIO_GRAPH_ENABLED');
    expect(executable).toContain('enabled: true');
    expect(executable).toContain('claimCreatedToGraphInFlight');
    expect(executable).toContain('decryptMetaToken');
    expect(SEND_AUDIO_SRC).not.toContain("error: 'audio_send_not_enabled'");
    expect(fetch).not.toHaveBeenCalled();
  });
});
