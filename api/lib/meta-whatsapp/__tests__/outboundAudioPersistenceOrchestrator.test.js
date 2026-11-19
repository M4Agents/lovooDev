// =============================================================================
// outboundAudioPersistenceOrchestrator.test.js — B3.2-C.3-D.3-E.2-B.6
// Dependências mockadas. Zero Graph, S3 real, SQL remoto, HTTP ou process.env.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeMetaOutboundAudioPersistence } from '../outboundAudioPersistenceOrchestrator.js';

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../outboundAudioPersistenceOrchestrator.js'),
  'utf8',
);
const SEND_AUDIO_SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../whatsapp/meta/messages/send-audio.js'),
  'utf8',
);

const COMPANY = 'aaaa0000-0000-4000-8000-000000000001';
const COMPANY_B = 'bbbb0000-0000-4000-8000-000000000002';
const USER = 'cccc0000-0000-4000-8000-000000000003';
const USER_B = 'dddd0000-0000-4000-8000-000000000004';
const INSTANCE = 'eeee0000-0000-4000-8000-000000000005';
const INSTANCE_B = 'ffff0000-0000-4000-8000-000000000006';
const CONVERSATION = '11111111-0000-4000-8000-000000000007';
const CONVERSATION_B = '22222222-0000-4000-8000-000000000008';
const OP = 'a0b1c2d3-e4f5-4a67-8b90-123456789abc';
const OP_B = 'b1c2d3e4-f5a6-4b78-8c90-23456789abcd';
const ASSET = '99999999-0000-4000-8000-000000000009';
const TRACKING = '88888888-0000-4000-8000-000000000008';
const CHAT = '77777777-0000-4000-8000-000000000007';
const SHA = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const WAMID = 'wamid.HBgLNTU1MTk4NzY1NDMyMQIVAgARGBI4NzY1NDMyMQ==';
const WAMID_B = 'wamid.OTHERFAKEWAMID==';
const STARTED_AT = '2026-11-18T16:00:00.000Z';
const COMPLETED_AT = '2026-11-18T16:05:00.000Z';
const PROVIDER_TS = '2026-11-18T16:04:30.000Z';
const BYTES = Buffer.from('fake-aac-lc-bytes');
const S3_KEY = `clientes/${COMPANY}/meta-outbound/${OP}/audio.m4a`;
const S3_OTHER = `clientes/${COMPANY}/meta-outbound/${OP_B}/audio.m4a`;

function context(overrides = {}) {
  return {
    companyId: COMPANY,
    userId: USER,
    instanceId: INSTANCE,
    conversationId: CONVERSATION,
    operationId: OP,
    audioSha256: SHA,
    audioBytes: BYTES,
    audioSizeBytes: BYTES.length,
    s3Key: S3_KEY,
    providerTimestamp: PROVIDER_TS,
    completedAt: COMPLETED_AT,
    ...overrides,
  };
}

function acceptedRow(overrides = {}) {
  return {
    company_id: COMPANY,
    operation_id: OP,
    user_id: USER,
    instance_id: INSTANCE,
    conversation_id: CONVERSATION,
    audio_sha256: SHA,
    status: 'graph_accepted',
    wamid: WAMID,
    s3_key: null,
    graph_started_at: STARTED_AT,
    completed_at: null,
    ...overrides,
  };
}

function completedRow(overrides = {}) {
  return acceptedRow({
    status: 'completed',
    s3_key: S3_KEY,
    completed_at: COMPLETED_AT,
    ...overrides,
  });
}

function s3Ok(overrides = {}) {
  return {
    ok: true,
    idempotent: false,
    objectKey: S3_KEY,
    contentType: 'audio/mp4',
    sizeBytes: BYTES.length,
    ...overrides,
  };
}

function makeDeps(overrides = {}) {
  return {
    selectByCompanyOperation: vi.fn(async () => ({ ok: true, row: acceptedRow() })),
    uploadMetaOutboundAudio: vi.fn(async () => s3Ok()),
    persistOutboundAudioMediaLibrary: vi.fn(async () => ({
      ok: true,
      idempotent: false,
      mediaAssetId: ASSET,
    })),
    persistOutboundAudioTracking: vi.fn(async () => ({
      ok: true,
      idempotent: false,
      trackingId: TRACKING,
    })),
    persistOutboundAudioChat: vi.fn(async () => ({
      ok: true,
      idempotent: false,
      chatMessageId: CHAT,
    })),
    markCompleted: vi.fn(async () => ({ ok: true, row: completedRow() })),
    ...overrides,
  };
}

function successBody(overrides = {}) {
  return {
    ok: true,
    idempotent: false,
    operationId: OP,
    wamid: WAMID,
    mediaAssetId: ASSET,
    trackingId: TRACKING,
    chatMessageId: CHAT,
    s3Key: S3_KEY,
    ...overrides,
  };
}

async function run({ ctx, deps } = {}) {
  return completeMetaOutboundAudioPersistence({
    context: ctx ?? context(),
    dependencies: deps ?? makeDeps(),
  });
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called in persistence orchestrator tests');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('identidade e estado', () => {
  it('graph_accepted válido completa tracking → S3 → biblioteca → chat → completed', async () => {
    const deps = makeDeps();
    const result = await run({ deps });
    expect(result).toEqual(successBody());
    expect(deps.selectByCompanyOperation).toHaveBeenCalledWith({
      companyId: COMPANY,
      operationId: OP,
    });
    expect(deps.uploadMetaOutboundAudio).toHaveBeenCalledTimes(1);
    expect(deps.persistOutboundAudioMediaLibrary).toHaveBeenCalledTimes(1);
    expect(deps.persistOutboundAudioTracking).toHaveBeenCalledWith({
      companyId: COMPANY,
      instanceId: INSTANCE,
      wamid: WAMID,
    });
    expect(deps.persistOutboundAudioChat.mock.calls[0][0]).toMatchObject({
      wamid: WAMID,
      mediaAssetId: ASSET,
      providerTimestamp: PROVIDER_TS,
    });
    expect(deps.markCompleted).toHaveBeenCalledWith({
      companyId: COMPANY,
      operationId: OP,
      s3Key: S3_KEY,
      completedAt: COMPLETED_AT,
    });
    expect(deps.persistOutboundAudioTracking.mock.invocationCallOrder[0])
      .toBeLessThan(deps.uploadMetaOutboundAudio.mock.invocationCallOrder[0]);
    expect(deps.uploadMetaOutboundAudio.mock.invocationCallOrder[0])
      .toBeLessThan(deps.persistOutboundAudioMediaLibrary.mock.invocationCallOrder[0]);
    expect(deps.persistOutboundAudioMediaLibrary.mock.invocationCallOrder[0])
      .toBeLessThan(deps.persistOutboundAudioChat.mock.invocationCallOrder[0]);
    expect(deps.persistOutboundAudioChat.mock.invocationCallOrder[0])
      .toBeLessThan(deps.markCompleted.mock.invocationCallOrder[0]);
  });

  it('SELECT ausente, erro, exceção e identidades divergentes não tocam S3', async () => {
    const cases = [
      {
        deps: makeDeps({
          selectByCompanyOperation: vi.fn(async () => ({ ok: false, reason: 'not_found' })),
        }),
        error: 'operation_not_found',
      },
      {
        deps: makeDeps({
          selectByCompanyOperation: vi.fn(async () => ({ ok: false, reason: 'db_error' })),
        }),
        error: 'operation_indeterminate',
      },
      {
        deps: makeDeps({
          selectByCompanyOperation: vi.fn(async () => { throw new Error('select boom'); }),
        }),
        error: 'operation_indeterminate',
      },
      {
        ctx: context({
          companyId: COMPANY_B,
          s3Key: `clientes/${COMPANY_B}/meta-outbound/${OP}/audio.m4a`,
        }),
        error: 'operation_identity_conflict',
      },
      {
        ctx: context({
          operationId: OP_B,
          s3Key: `clientes/${COMPANY}/meta-outbound/${OP_B}/audio.m4a`,
        }),
        error: 'operation_identity_conflict',
      },
      {
        ctx: context({ userId: USER_B }),
        error: 'operation_identity_conflict',
      },
      {
        ctx: context({ instanceId: INSTANCE_B }),
        error: 'operation_identity_conflict',
      },
      {
        ctx: context({ conversationId: CONVERSATION_B }),
        error: 'operation_identity_conflict',
      },
      {
        ctx: context({ audioSha256: SHA_B }),
        error: 'operation_identity_conflict',
      },
    ];

    for (const item of cases) {
      const deps = item.deps ?? makeDeps();
      const result = await run({ ctx: item.ctx, deps });
      expect(result).toEqual({ ok: false, error: item.error });
      expect(deps.persistOutboundAudioTracking).not.toHaveBeenCalled();
      expect(deps.uploadMetaOutboundAudio).not.toHaveBeenCalled();
      expect(deps.persistOutboundAudioMediaLibrary).not.toHaveBeenCalled();
      expect(deps.markCompleted).not.toHaveBeenCalled();
    }
  });

  it('wamid/started_at inválidos e estados não elegíveis bloqueiam persistência', async () => {
    const blocked = [
      { row: acceptedRow({ wamid: null }), error: 'operation_indeterminate' },
      { row: acceptedRow({ wamid: '   ' }), error: 'operation_indeterminate' },
      { row: acceptedRow({ graph_started_at: null }), error: 'operation_indeterminate' },
      { row: acceptedRow({ graph_started_at: 'not-iso' }), error: 'operation_indeterminate' },
      { row: acceptedRow({ status: 'created', wamid: null, graph_started_at: null }), error: 'operation_state_not_eligible' },
      { row: acceptedRow({ status: 'graph_in_flight', wamid: null }), error: 'operation_state_not_eligible' },
      { row: acceptedRow({ status: 'unknown', wamid: null }), error: 'operation_state_not_eligible' },
      { row: acceptedRow({ status: 'failed', wamid: null, graph_started_at: null }), error: 'operation_state_not_eligible' },
    ];
    for (const item of blocked) {
      const deps = makeDeps({
        selectByCompanyOperation: vi.fn(async () => ({ ok: true, row: item.row })),
      });
      const result = await run({ deps });
      expect(result).toEqual({ ok: false, error: item.error });
      expect(deps.persistOutboundAudioTracking).not.toHaveBeenCalled();
      expect(deps.uploadMetaOutboundAudio).not.toHaveBeenCalled();
      expect(deps.markCompleted).not.toHaveBeenCalled();
    }
  });

  it('completed compatível não repete S3 nem INSERTs; divergente conflita', async () => {
    const compatible = makeDeps({
      selectByCompanyOperation: vi.fn(async () => ({ ok: true, row: completedRow() })),
    });
    await expect(run({ deps: compatible })).resolves.toEqual({
      ok: true,
      idempotent: true,
      operationId: OP,
      wamid: WAMID,
      s3Key: S3_KEY,
    });
    expect(compatible.uploadMetaOutboundAudio).not.toHaveBeenCalled();
    expect(compatible.persistOutboundAudioMediaLibrary).not.toHaveBeenCalled();
    expect(compatible.persistOutboundAudioTracking).not.toHaveBeenCalled();
    expect(compatible.persistOutboundAudioChat).not.toHaveBeenCalled();
    expect(compatible.markCompleted).not.toHaveBeenCalled();

    const divergent = makeDeps({
      selectByCompanyOperation: vi.fn(async () => ({
        ok: true,
        row: completedRow({ s3_key: S3_OTHER, wamid: WAMID_B }),
      })),
    });
    await expect(run({ deps: divergent })).resolves.toEqual({
      ok: false,
      error: 'completion_conflict',
    });
    expect(divergent.uploadMetaOutboundAudio).not.toHaveBeenCalled();
    expect(divergent.markCompleted).not.toHaveBeenCalled();
  });
});

describe('S3, biblioteca, tracking e chat', () => {
  it('upload novo ou idempotente segue; falhas S3 preservam tracking e não avançam', async () => {
    const idempotent = makeDeps({
      uploadMetaOutboundAudio: vi.fn(async () => s3Ok({ idempotent: true })),
    });
    await expect(run({ deps: idempotent })).resolves.toEqual(successBody());

    const failures = [
      { ok: false, error: 'aws_upload_failed' },
      { ok: false, error: 'aws_upload_indeterminate' },
      s3Ok({ objectKey: S3_OTHER }),
      s3Ok({ contentType: 'audio/ogg' }),
      s3Ok({ sizeBytes: BYTES.length + 9 }),
    ];
    for (const upload of failures) {
      const deps = makeDeps({
        uploadMetaOutboundAudio: vi.fn(async () => upload),
      });
      const result = await run({ deps });
      expect(result).toEqual({ ok: false, error: 's3_confirmation_failed' });
      expect(deps.persistOutboundAudioTracking).toHaveBeenCalledTimes(1);
      expect(deps.persistOutboundAudioMediaLibrary).not.toHaveBeenCalled();
      expect(deps.markCompleted).not.toHaveBeenCalled();
    }

    const throwing = makeDeps({
      uploadMetaOutboundAudio: vi.fn(async () => { throw new Error('s3 boom'); }),
    });
    await expect(run({ deps: throwing })).resolves.toEqual({
      ok: false,
      error: 's3_confirmation_failed',
    });
    expect(throwing.persistOutboundAudioTracking).toHaveBeenCalledTimes(1);
    expect(throwing.persistOutboundAudioMediaLibrary).not.toHaveBeenCalled();
  });

  it('biblioteca nova/recuperada segue; falha ou id inválido preserva tracking e não cria chat', async () => {
    const recovered = makeDeps({
      persistOutboundAudioMediaLibrary: vi.fn(async () => ({
        ok: true,
        idempotent: true,
        mediaAssetId: ASSET,
      })),
    });
    await expect(run({ deps: recovered })).resolves.toMatchObject({ ok: true, mediaAssetId: ASSET });

    const failures = [
      { ok: false, error: 'media_library_conflict' },
      { ok: true, mediaAssetId: 'not-uuid' },
    ];
    for (const library of failures) {
      const deps = makeDeps({
        persistOutboundAudioMediaLibrary: vi.fn(async () => library),
      });
      const result = await run({ deps });
      expect(result).toEqual({ ok: false, error: 'media_library_persistence_failed' });
      expect(deps.persistOutboundAudioTracking).toHaveBeenCalledTimes(1);
      expect(deps.persistOutboundAudioChat).not.toHaveBeenCalled();
      expect(deps.markCompleted).not.toHaveBeenCalled();
    }

    const throwing = makeDeps({
      persistOutboundAudioMediaLibrary: vi.fn(async () => { throw new Error('cml boom'); }),
    });
    await expect(run({ deps: throwing })).resolves.toEqual({
      ok: false,
      error: 'media_library_persistence_failed',
    });
    expect(throwing.persistOutboundAudioTracking).toHaveBeenCalledTimes(1);
    expect(throwing.persistOutboundAudioChat).not.toHaveBeenCalled();
  });

  it('tracking e chat novos/recuperados; falha não avança', async () => {
    const recovered = makeDeps({
      persistOutboundAudioTracking: vi.fn(async () => ({
        ok: true,
        idempotent: true,
        trackingId: TRACKING,
      })),
      persistOutboundAudioChat: vi.fn(async () => ({
        ok: true,
        idempotent: true,
        chatMessageId: CHAT,
      })),
    });
    await expect(run({ deps: recovered })).resolves.toMatchObject({
      ok: true,
      trackingId: TRACKING,
      chatMessageId: CHAT,
    });

    const trackingFail = makeDeps({
      persistOutboundAudioTracking: vi.fn(async () => ({ ok: false, error: 'tracking_conflict' })),
    });
    await expect(run({ deps: trackingFail })).resolves.toEqual({
      ok: false,
      error: 'tracking_persistence_failed',
    });
    expect(trackingFail.uploadMetaOutboundAudio).not.toHaveBeenCalled();
    expect(trackingFail.persistOutboundAudioMediaLibrary).not.toHaveBeenCalled();
    expect(trackingFail.persistOutboundAudioChat).not.toHaveBeenCalled();
    expect(trackingFail.markCompleted).not.toHaveBeenCalled();

    const trackingBadId = makeDeps({
      persistOutboundAudioTracking: vi.fn(async () => ({ ok: true, trackingId: 'bad' })),
    });
    await expect(run({ deps: trackingBadId })).resolves.toEqual({
      ok: false,
      error: 'tracking_persistence_failed',
    });
    expect(trackingBadId.uploadMetaOutboundAudio).not.toHaveBeenCalled();
    expect(trackingBadId.persistOutboundAudioChat).not.toHaveBeenCalled();

    const trackingThrow = makeDeps({
      persistOutboundAudioTracking: vi.fn(async () => { throw new Error('trk boom'); }),
    });
    await expect(run({ deps: trackingThrow })).resolves.toEqual({
      ok: false,
      error: 'tracking_persistence_failed',
    });
    expect(trackingThrow.uploadMetaOutboundAudio).not.toHaveBeenCalled();

    const chatFail = makeDeps({
      persistOutboundAudioChat: vi.fn(async () => ({ ok: false, error: 'chat_conflict' })),
    });
    await expect(run({ deps: chatFail })).resolves.toEqual({
      ok: false,
      error: 'chat_persistence_failed',
    });
    expect(chatFail.markCompleted).not.toHaveBeenCalled();

    const chatBadId = makeDeps({
      persistOutboundAudioChat: vi.fn(async () => ({ ok: true, chatMessageId: 'bad' })),
    });
    await expect(run({ deps: chatBadId })).resolves.toEqual({
      ok: false,
      error: 'chat_persistence_failed',
    });
    expect(chatBadId.markCompleted).not.toHaveBeenCalled();

    const chatThrow = makeDeps({
      persistOutboundAudioChat: vi.fn(async () => { throw new Error('chat boom'); }),
    });
    await expect(run({ deps: chatThrow })).resolves.toEqual({
      ok: false,
      error: 'chat_persistence_failed',
    });
    expect(chatThrow.markCompleted).not.toHaveBeenCalled();
  });

  it('tracking idempotente sent/delivered/read/failed segue S3 sem segundo Graph', async () => {
    for (const status of ['sent', 'delivered', 'read', 'failed']) {
      const deps = makeDeps({
        persistOutboundAudioTracking: vi.fn(async () => ({
          ok: true,
          idempotent: true,
          trackingId: TRACKING,
          status,
        })),
      });
      await expect(run({ deps })).resolves.toMatchObject({
        ok: true,
        trackingId: TRACKING,
      });
      expect(deps.persistOutboundAudioTracking).toHaveBeenCalledTimes(1);
      expect(deps.uploadMetaOutboundAudio).toHaveBeenCalledTimes(1);
      expect(deps.markCompleted).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(deps.persistOutboundAudioTracking.mock.calls[0][0]))
        .not.toContain('status');
    }
  });

  it('graph_accepted sem tracking cria tracking antes do S3; com tracking não duplica envio', async () => {
    const created = makeDeps();
    await expect(run({ deps: created })).resolves.toMatchObject({ ok: true, idempotent: false });
    expect(created.persistOutboundAudioTracking).toHaveBeenCalledTimes(1);
    expect(created.persistOutboundAudioTracking.mock.invocationCallOrder[0])
      .toBeLessThan(created.uploadMetaOutboundAudio.mock.invocationCallOrder[0]);

    const existing = makeDeps({
      persistOutboundAudioTracking: vi.fn(async () => ({
        ok: true,
        idempotent: true,
        trackingId: TRACKING,
      })),
    });
    await expect(run({ deps: existing })).resolves.toMatchObject({ ok: true, trackingId: TRACKING });
    expect(existing.persistOutboundAudioTracking).toHaveBeenCalledTimes(1);
    expect(existing.uploadMetaOutboundAudio).toHaveBeenCalledTimes(1);
  });
});

describe('CAS completed e recuperação', () => {
  it('CAS sem linha reconhece completed compatível e não reexecuta markCompleted', async () => {
    const deps = makeDeps({
      selectByCompanyOperation: vi.fn()
        .mockResolvedValueOnce({ ok: true, row: acceptedRow() })
        .mockResolvedValueOnce({ ok: true, row: completedRow() }),
      markCompleted: vi.fn(async () => ({ ok: false, reason: 'not_transitioned' })),
    });
    await expect(run({ deps })).resolves.toEqual({
      ok: true,
      idempotent: true,
      operationId: OP,
      wamid: WAMID,
      s3Key: S3_KEY,
    });
    expect(deps.markCompleted).toHaveBeenCalledTimes(1);
    expect(deps.uploadMetaOutboundAudio).toHaveBeenCalledTimes(1);
    expect(deps.persistOutboundAudioMediaLibrary).toHaveBeenCalledTimes(1);
    expect(deps.selectByCompanyOperation).toHaveBeenCalledTimes(2);
  });

  it('CAS sem linha + graph_accepted ou divergência/falha de releitura', async () => {
    const stillAccepted = makeDeps({
      selectByCompanyOperation: vi.fn()
        .mockResolvedValueOnce({ ok: true, row: acceptedRow() })
        .mockResolvedValueOnce({ ok: true, row: acceptedRow() }),
      markCompleted: vi.fn(async () => ({ ok: false, reason: 'not_transitioned' })),
    });
    await expect(run({ deps: stillAccepted })).resolves.toEqual({
      ok: false,
      error: 'completion_indeterminate',
    });
    expect(stillAccepted.markCompleted).toHaveBeenCalledTimes(1);

    const divergent = makeDeps({
      selectByCompanyOperation: vi.fn()
        .mockResolvedValueOnce({ ok: true, row: acceptedRow() })
        .mockResolvedValueOnce({ ok: true, row: completedRow({ s3_key: S3_OTHER }) }),
      markCompleted: vi.fn(async () => ({ ok: false, reason: 'not_transitioned' })),
    });
    await expect(run({ deps: divergent })).resolves.toEqual({
      ok: false,
      error: 'completion_conflict',
    });
    expect(divergent.markCompleted).toHaveBeenCalledTimes(1);

    const rereadFail = makeDeps({
      selectByCompanyOperation: vi.fn()
        .mockResolvedValueOnce({ ok: true, row: acceptedRow() })
        .mockResolvedValueOnce({ ok: false, reason: 'db_error' }),
      markCompleted: vi.fn(async () => ({ ok: false, reason: 'not_transitioned' })),
    });
    await expect(run({ deps: rereadFail })).resolves.toEqual({
      ok: false,
      error: 'completion_indeterminate',
    });
    expect(rereadFail.markCompleted).toHaveBeenCalledTimes(1);
  });

  it('exception de markCompleted só reconhece completed após releitura durável', async () => {
    const recovered = makeDeps({
      selectByCompanyOperation: vi.fn()
        .mockResolvedValueOnce({ ok: true, row: acceptedRow() })
        .mockResolvedValueOnce({ ok: true, row: completedRow() }),
      markCompleted: vi.fn(async () => { throw new Error('cas boom'); }),
    });
    await expect(run({ deps: recovered })).resolves.toEqual({
      ok: true,
      idempotent: true,
      operationId: OP,
      wamid: WAMID,
      s3Key: S3_KEY,
    });
    expect(recovered.markCompleted).toHaveBeenCalledTimes(1);

    const indeterminate = makeDeps({
      selectByCompanyOperation: vi.fn()
        .mockResolvedValueOnce({ ok: true, row: acceptedRow() })
        .mockRejectedValueOnce(new Error('reread boom')),
      markCompleted: vi.fn(async () => { throw new Error('cas boom'); }),
    });
    await expect(run({ deps: indeterminate })).resolves.toEqual({
      ok: false,
      error: 'completion_indeterminate',
    });
    expect(indeterminate.markCompleted).toHaveBeenCalledTimes(1);
  });
});

describe('segurança e pureza', () => {
  it('não muta o context, não devolve token e usa wamid durável', async () => {
    const input = Object.freeze(context({ wamid: WAMID_B }));
    const before = JSON.stringify(input);
    const deps = makeDeps();
    const result = await run({ ctx: input, deps });
    expect(JSON.stringify(input)).toBe(before);
    expect(result.wamid).toBe(WAMID);
    expect(deps.persistOutboundAudioTracking.mock.calls[0][0].wamid).toBe(WAMID);
    expect(JSON.stringify(result)).not.toContain('accessToken');
    expect(JSON.stringify(result)).not.toContain('EAA');
  });

  it('fonte sem Graph, env, HTTP, SQL, DELETE S3, Date.now; HTTP sem env de gate', () => {
    const executable = SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(executable).not.toContain('getSupabaseAdmin');
    expect(executable).not.toContain('graphClient');
    expect(executable).not.toContain('uploadMedia');
    expect(executable).not.toContain('sendAudioMessage');
    expect(executable).not.toContain('process.env');
    expect(executable).not.toContain('Date.now');
    expect(executable).not.toContain('.from(');
    expect(executable).not.toContain('.rpc(');
    expect(executable).not.toContain('DeleteObject');
    expect(executable).not.toContain('.delete(');
    expect(executable).not.toContain('upsert');
    expect(executable).not.toContain('onConflict');
    expect(executable).not.toContain('@aws-sdk');
    expect(SEND_AUDIO_SRC).not.toMatch(/META_OUTBOUND_AUDIO_GRAPH_ENABLED/);
    expect(SEND_AUDIO_SRC).toContain('completeMetaOutboundAudioPersistence');
    expect(SEND_AUDIO_SRC).toContain('claimCreatedToGraphInFlight');
  });
});
