// =============================================================================
// outboundAudioOperation.test.js — B3.2-C.3-B / C.3-B.1 / C.3-D.1
// Contratos puros. Sem Graph, S3, filesystem, Supabase ou fetch.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INVALID_OPERATION_ID_RESPONSE,
  NON_DEFINITIVE_GRAPH_OUTCOMES,
  OUTBOUND_AUDIO_STATUS,
  OUTBOUND_AUDIO_STATUSES,
  canAutomaticallyClassifyAsFailed,
  conservativeStatusAfterStartedGraph,
  classifyOperationStatus,
  compareOperationIdentity,
  evaluateStatusCoherence,
  isAllowedTransition,
  isAudioSha256,
  isSchemaCompatibleTransition,
  isUuidV4,
  parseOperationId,
  resolveExistingOperationDecision,
} from '../outboundAudioOperation.js';

const OP = '11111111-1111-4111-8111-111111111111';
const OP_CANONICAL_UPPER = 'A0B1C2D3-E4F5-4A67-8B90-123456789ABC';
const OP_CANONICAL_LOWER = 'a0b1c2d3-e4f5-4a67-8b90-123456789abc';
const OP_CANONICAL_MIXED = 'A0b1C2d3-E4f5-4A67-8b90-123456789AbC';
const COMPANY = 'aaaa0000-0000-0000-0000-000000000001';
const USER = 'bbbb0000-0000-4000-8000-000000000002';
const INSTANCE = 'cccc0000-0000-4000-8000-000000000003';
const CONVERSATION = 'dddd0000-0000-4000-8000-000000000004';
const SHA = 'a'.repeat(64);

const UUID_V1 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const UUID_V3 = '6fa459ea-ee8a-3ca4-894e-db77e160355e';
const UUID_V5 = '886313e1-3b8a-5372-9b90-0c9aee199e5d';
const UUID_V4_VARIANT_C = '11111111-1111-4111-c111-111111111111';

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

function stored(status, overrides = {}) {
  return { ...identity(), status, ...overrides };
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called in outboundAudioOperation tests');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseOperationId / isUuidV4', () => {
  it('aceita UUID v4 minúsculo e preserva a forma canônica', () => {
    expect(isUuidV4(OP)).toBe(true);
    expect(parseOperationId(OP)).toEqual({ ok: true, operationId: OP });
  });

  it('canonicaliza UUID v4 maiúsculo para minúsculas', () => {
    expect(parseOperationId(OP_CANONICAL_UPPER)).toEqual({
      ok: true,
      operationId: OP_CANONICAL_LOWER,
    });
  });

  it('canonicaliza UUID v4 misto para minúsculas', () => {
    expect(parseOperationId(OP_CANONICAL_MIXED)).toEqual({
      ok: true,
      operationId: OP_CANONICAL_LOWER,
    });
  });

  it('o mesmo UUID com representações diferentes produz o mesmo canônico', () => {
    const lower = parseOperationId(OP_CANONICAL_LOWER);
    const upper = parseOperationId(OP_CANONICAL_UPPER);
    const mixed = parseOperationId(OP_CANONICAL_MIXED);
    expect(lower).toEqual(upper);
    expect(upper).toEqual(mixed);
    expect(lower.operationId).toBe(OP_CANONICAL_LOWER);
  });

  it('aceita v4 em array de um único elemento e canonicaliza', () => {
    expect(parseOperationId([OP_CANONICAL_UPPER])).toEqual({
      ok: true,
      operationId: OP_CANONICAL_LOWER,
    });
  });

  it('rejeita UUID v1, v3 e v5', () => {
    expect(parseOperationId(UUID_V1)).toEqual({ ok: false });
    expect(parseOperationId(UUID_V3)).toEqual({ ok: false });
    expect(parseOperationId(UUID_V5)).toEqual({ ok: false });
  });

  it('rejeita v4 com variante inválida', () => {
    expect(parseOperationId(UUID_V4_VARIANT_C)).toEqual({ ok: false });
  });

  it('rejeita vazio, whitespace, objeto, null e undefined', () => {
    expect(parseOperationId('')).toEqual({ ok: false });
    expect(parseOperationId('  ' + OP)).toEqual({ ok: false });
    expect(parseOperationId(OP + ' ')).toEqual({ ok: false });
    expect(parseOperationId('  ' + OP_CANONICAL_UPPER)).toEqual({ ok: false });
    expect(parseOperationId(null)).toEqual({ ok: false });
    expect(parseOperationId(undefined)).toEqual({ ok: false });
    expect(parseOperationId({ operation_id: OP })).toEqual({ ok: false });
    expect(parseOperationId('not-a-uuid')).toEqual({ ok: false });
  });

  it('rejeita arrays vazios ou com mais de um valor', () => {
    expect(parseOperationId([])).toEqual({ ok: false });
    expect(parseOperationId([OP, OP])).toEqual({ ok: false });
    expect(parseOperationId([OP, 'x'])).toEqual({ ok: false });
  });
});

describe('compareOperationIdentity', () => {
  it('identidade igual', () => {
    expect(compareOperationIdentity(identity(), identity())).toEqual({
      ok: true,
      equal: true,
    });
  });

  it('mesmo operation_id com casing diferente não gera conflito', () => {
    const left = identity({ operation_id: OP_CANONICAL_LOWER });
    const right = identity({ operation_id: OP_CANONICAL_UPPER });
    expect(compareOperationIdentity(left, right)).toEqual({ ok: true, equal: true });
    const decision = resolveExistingOperationDecision(
      stored('completed', { operation_id: OP_CANONICAL_LOWER }),
      identity({ operation_id: OP_CANONICAL_MIXED }),
    );
    expect(decision.httpStatus).toBe(200);
    expect(decision.mayCallGraph).toBe(false);
  });

  it.each([
    ['company_id', 'eeee0000-0000-4000-8000-000000000005'],
    ['operation_id', '22222222-2222-4222-8222-222222222222'],
    ['user_id', 'ffff0000-0000-4000-8000-000000000006'],
    ['instance_id', '99999999-0000-4000-8000-000000000007'],
    ['conversation_id', '88888888-0000-4000-8000-000000000008'],
    ['audio_sha256', 'b'.repeat(64)],
  ])('divergência em %s é conflito', (field, value) => {
    const result = compareOperationIdentity(identity(), identity({ [field]: value }));
    expect(result).toEqual({ ok: true, equal: false });
  });

  it('não normaliza company_id, user_id, instance_id ou conversation_id', () => {
    const result = compareOperationIdentity(
      identity(),
      identity({ company_id: COMPANY.toUpperCase() }),
    );
    expect(result).toEqual({ ok: true, equal: false });
  });

  it('SHA-256 inválido não compara e não autoriza reutilização', () => {
    expect(isAudioSha256(SHA)).toBe(true);
    expect(isAudioSha256(SHA.toUpperCase())).toBe(false);
    expect(isAudioSha256('ab'.repeat(31))).toBe(false);
    expect(compareOperationIdentity(
      identity(),
      identity({ audio_sha256: 'G'.repeat(64) }),
    )).toEqual({ ok: false, reason: 'invalid_identity' });
    const decision = resolveExistingOperationDecision(
      stored('created'),
      identity({ audio_sha256: 'G'.repeat(64) }),
    );
    expect(decision.mayClaim).toBe(false);
    expect(decision.mayCallGraph).toBe(false);
    expect(decision.httpStatus).toBe(409);
  });

  it('identidade incompleta nunca é aceita', () => {
    expect(compareOperationIdentity(identity(), { company_id: COMPANY })).toEqual({
      ok: false,
      reason: 'invalid_identity',
    });
    expect(compareOperationIdentity(identity(), identity({ user_id: '' }))).toEqual({
      ok: false,
      reason: 'invalid_identity',
    });
    expect(compareOperationIdentity(null, identity())).toEqual({
      ok: false,
      reason: 'invalid_identity',
    });
  });

  it('completed com identidade diferente continua conflito', () => {
    const left = stored(OUTBOUND_AUDIO_STATUS.COMPLETED);
    const right = identity({ instance_id: '99999999-0000-4000-8000-000000000007' });
    expect(compareOperationIdentity(left, right)).toEqual({ ok: true, equal: false });
    const decision = resolveExistingOperationDecision(left, right);
    expect(decision.mayCallGraph).toBe(false);
    expect(decision.httpStatus).toBe(409);
    expect(decision.body).toEqual({ ok: false, error: 'operation_conflict' });
  });
});

describe('classifyOperationStatus', () => {
  it.each(OUTBOUND_AUDIO_STATUSES)('classifica %s sem autorizar Graph', (status) => {
    const classified = classifyOperationStatus(status);
    expect(classified.known).toBe(true);
    expect(classified.status).toBe(status);
    expect(classified.mayCallGraph).toBe(false);
  });

  it('created permite claim; demais não', () => {
    expect(classifyOperationStatus('created').mayClaim).toBe(true);
    expect(classifyOperationStatus('graph_in_flight').mayClaim).toBe(false);
    expect(classifyOperationStatus('graph_accepted').mayClaim).toBe(false);
    expect(classifyOperationStatus('completed').mayClaim).toBe(false);
    expect(classifyOperationStatus('failed').mayClaim).toBe(false);
    expect(classifyOperationStatus('unknown').mayClaim).toBe(false);
  });

  it('failed e completed são terminais; unknown não autoriza Graph', () => {
    expect(classifyOperationStatus('failed').terminal).toBe(true);
    expect(classifyOperationStatus('completed').terminal).toBe(true);
    expect(classifyOperationStatus('unknown').terminal).toBe(false);
    expect(classifyOperationStatus('unknown').mayCallGraph).toBe(false);
    expect(classifyOperationStatus('graph_accepted').mayCallGraph).toBe(false);
    expect(classifyOperationStatus('created').terminal).toBe(false);
  });

  it('somente graph_accepted permite resume local', () => {
    expect(classifyOperationStatus('graph_accepted').mayResumeLocal).toBe(true);
    expect(classifyOperationStatus('created').mayResumeLocal).toBe(false);
    expect(classifyOperationStatus('completed').mayResumeLocal).toBe(false);
  });

  it('estado ausente, inesperado ou malformado não autoriza Graph', () => {
    for (const status of [null, undefined, '', 'CREATED', 'retry', 1, {}]) {
      const classified = classifyOperationStatus(status);
      expect(classified.known).toBe(false);
      expect(classified.mayCallGraph).toBe(false);
      expect(classified.mayClaim).toBe(false);
      expect(classified.mayResumeLocal).toBe(false);
    }
  });
});

describe('isAllowedTransition', () => {
  it.each([
    ['created', 'graph_in_flight'],
    ['created', 'failed'],
    ['graph_in_flight', 'graph_accepted'],
    ['graph_in_flight', 'unknown'],
    ['graph_accepted', 'completed'],
  ])('permite %s → %s', (from, to) => {
    expect(isAllowedTransition(from, to)).toBe(true);
  });

  it.each([
    ['graph_in_flight', 'failed'],
    ['unknown', 'created'],
    ['unknown', 'graph_in_flight'],
    ['failed', 'graph_in_flight'],
    ['completed', 'graph_in_flight'],
    ['graph_accepted', 'graph_in_flight'],
    ['completed', 'completed'],
    ['created', 'completed'],
    ['created', 'graph_accepted'],
    ['created', 'unknown'],
    ['graph_in_flight', 'created'],
    ['graph_in_flight', 'completed'],
    ['graph_accepted', 'failed'],
    ['graph_accepted', 'unknown'],
    ['failed', 'created'],
    ['failed', 'failed'],
    ['unknown', 'unknown'],
    ['unknown', 'failed'],
    ['failed', 'unknown'],
  ])('rejeita %s → %s', (from, to) => {
    expect(isAllowedTransition(from, to)).toBe(false);
  });

  it('pós-claim nunca produz failed; timeout/rede/4xx/5xx → unknown', () => {
    expect(isAllowedTransition('graph_in_flight', 'failed')).toBe(false);
    expect(isAllowedTransition('graph_in_flight', 'unknown')).toBe(true);
    expect(isAllowedTransition('created', 'failed')).toBe(true);
    expect(NON_DEFINITIVE_GRAPH_OUTCOMES).toEqual([
      'timeout',
      'network_error',
      'ambiguous_response',
      'http_4xx',
      'http_5xx',
    ]);
    for (const outcome of NON_DEFINITIVE_GRAPH_OUTCOMES) {
      expect(canAutomaticallyClassifyAsFailed(outcome)).toBe(false);
      expect(conservativeStatusAfterStartedGraph(outcome)).toBe('unknown');
    }
    expect(canAutomaticallyClassifyAsFailed('definitive_not_accepted')).toBe(false);
    expect(conservativeStatusAfterStartedGraph('definitive_not_accepted')).toBeNull();
  });
});

describe('evaluateStatusCoherence / CHECK', () => {
  const started = '2026-11-18T16:00:00.000Z';
  const completedAt = '2026-11-18T16:01:00.000Z';
  const wamid = 'wamid.HBgLNTU1MTk4NzY1NDMyMQIVAgARGBI4NzY1NDMyMQ==';
  const s3Key = 'clientes/aaaa/meta-outbound/file.m4a';

  it('created e failed exigem graph_started_at, wamid e completed_at nulos', () => {
    expect(evaluateStatusCoherence('created', {}).ok).toBe(true);
    expect(evaluateStatusCoherence('failed', { wamid: null }).ok).toBe(true);
    expect(evaluateStatusCoherence('created', { graph_started_at: started }).ok).toBe(false);
    expect(evaluateStatusCoherence('failed', { graph_started_at: started }).ok).toBe(false);
    expect(evaluateStatusCoherence('failed', { wamid }).ok).toBe(false);
  });

  it('graph_in_flight e unknown exigem started_at e proíbem wamid', () => {
    expect(evaluateStatusCoherence('graph_in_flight', { graph_started_at: started }).ok).toBe(true);
    expect(evaluateStatusCoherence('unknown', { graph_started_at: started }).ok).toBe(true);
    expect(evaluateStatusCoherence('graph_in_flight', {}).ok).toBe(false);
    expect(evaluateStatusCoherence('unknown', { graph_started_at: started, wamid }).ok).toBe(false);
    expect(evaluateStatusCoherence('graph_in_flight', { graph_started_at: started, wamid: '  ' }).ok)
      .toBe(false);
  });

  it('graph_accepted exige wamid não-vazio e started_at; completed_at nulo', () => {
    expect(evaluateStatusCoherence('graph_accepted', {
      wamid,
      graph_started_at: started,
    }).ok).toBe(true);
    expect(evaluateStatusCoherence('graph_accepted', { graph_started_at: started }).ok).toBe(false);
    expect(evaluateStatusCoherence('graph_accepted', {
      wamid: '   ',
      graph_started_at: started,
    }).ok).toBe(false);
    expect(evaluateStatusCoherence('graph_accepted', {
      wamid,
      graph_started_at: started,
      completed_at: completedAt,
    }).ok).toBe(false);
  });

  it('completed exige wamid, s3_key e completed_at válidos', () => {
    expect(evaluateStatusCoherence('completed', {
      wamid,
      s3_key: s3Key,
      graph_started_at: started,
      completed_at: completedAt,
    }).ok).toBe(true);
    expect(evaluateStatusCoherence('completed', {
      wamid,
      s3_key: '  ',
      graph_started_at: started,
      completed_at: completedAt,
    }).ok).toBe(false);
    expect(evaluateStatusCoherence('completed', {
      wamid,
      s3_key: s3Key,
      graph_started_at: started,
    }).ok).toBe(false);
  });

  it('transição schema-compatível exige allowlist e campos do CHECK', () => {
    expect(isSchemaCompatibleTransition('created', 'graph_in_flight', {
      graph_started_at: started,
    })).toBe(true);
    expect(isSchemaCompatibleTransition('created', 'graph_in_flight', {})).toBe(false);
    expect(isSchemaCompatibleTransition('created', 'failed', {})).toBe(true);
    expect(isSchemaCompatibleTransition('graph_in_flight', 'failed', {
      graph_started_at: started,
    })).toBe(false);
    expect(isSchemaCompatibleTransition('graph_in_flight', 'unknown', {
      graph_started_at: started,
    })).toBe(true);
    expect(isSchemaCompatibleTransition('graph_in_flight', 'graph_accepted', {
      wamid,
      graph_started_at: started,
    })).toBe(true);
    expect(isSchemaCompatibleTransition('graph_in_flight', 'graph_accepted', {
      graph_started_at: started,
    })).toBe(false);
    expect(isSchemaCompatibleTransition('graph_accepted', 'completed', {
      wamid,
      s3_key: s3Key,
      graph_started_at: started,
      completed_at: completedAt,
    })).toBe(true);
    expect(isSchemaCompatibleTransition('unknown', 'graph_in_flight', {
      graph_started_at: started,
    })).toBe(false);
  });
});

describe('resolveExistingOperationDecision', () => {
  it('created com identidade igual não chama Graph e permite claim', () => {
    const decision = resolveExistingOperationDecision(
      stored('created'),
      identity(),
    );
    expect(decision.mayClaim).toBe(true);
    expect(decision.mayCallGraph).toBe(false);
    expect(decision.httpStatus).toBeNull();
  });

  it('graph_in_flight nunca autoriza segundo claim nem Graph', () => {
    const decision = resolveExistingOperationDecision(
      stored('graph_in_flight'),
      identity(),
    );
    expect(decision.mayClaim).toBe(false);
    expect(decision.mayCallGraph).toBe(false);
    expect(decision.httpStatus).toBe(409);
    expect(decision.body).toEqual({ ok: false, error: 'operation_in_progress' });
  });

  it('graph_accepted retoma persistência local e nunca Graph', () => {
    const decision = resolveExistingOperationDecision(
      stored('graph_accepted'),
      identity(),
    );
    expect(decision.mayResumeLocal).toBe(true);
    expect(decision.mayCallGraph).toBe(false);
    expect(decision.mayClaim).toBe(false);
    expect(decision.httpStatus).toBeNull();
  });

  it('completed com identidade igual é 200 idempotente', () => {
    const decision = resolveExistingOperationDecision(
      stored('completed'),
      identity(),
    );
    expect(decision.httpStatus).toBe(200);
    expect(decision.body).toEqual({ ok: true });
    expect(decision.mayCallGraph).toBe(false);
    expect(decision.mayClaim).toBe(false);
  });

  it('failed é 409 operation_failed e terminal', () => {
    const decision = resolveExistingOperationDecision(stored('failed'), identity());
    expect(decision.httpStatus).toBe(409);
    expect(decision.body).toEqual({ ok: false, error: 'operation_failed' });
    expect(decision.mayCallGraph).toBe(false);
    expect(decision.mayClaim).toBe(false);
    expect(decision.mayResumeLocal).toBe(false);
    expect(isAllowedTransition('failed', 'graph_in_flight')).toBe(false);
  });

  it('completed não sofre nova transição de escrita', () => {
    const decision = resolveExistingOperationDecision(stored('completed'), identity());
    expect(decision.httpStatus).toBe(200);
    expect(isAllowedTransition('completed', 'completed')).toBe(false);
    expect(isAllowedTransition('completed', 'graph_in_flight')).toBe(false);
    expect(decision.mayClaim).toBe(false);
    expect(decision.mayResumeLocal).toBe(false);
  });

  it('unknown é 409 operation_unknown e nunca Graph', () => {
    const decision = resolveExistingOperationDecision(stored('unknown'), identity());
    expect(decision.httpStatus).toBe(409);
    expect(decision.body).toEqual({ ok: false, error: 'operation_unknown' });
    expect(decision.mayCallGraph).toBe(false);
  });

  it('identidade inválida resulta em 409 operation_conflict sem Graph', () => {
    const decision = resolveExistingOperationDecision(stored('created'), { company_id: 'x' });
    expect(decision.httpStatus).toBe(409);
    expect(decision.body).toEqual({ ok: false, error: 'operation_conflict' });
    expect(decision.mayCallGraph).toBe(false);
  });

  it('mapeia invalid_operation_id para 400', () => {
    expect(INVALID_OPERATION_ID_RESPONSE).toEqual({
      httpStatus: 400,
      body: { ok: false, error: 'invalid_operation_id' },
    });
  });
});
