// =============================================================================
// graphAudioOutcome.test.js — B3.2-C.3-D.1
// Classificação pura. Sem Graph, S3, filesystem, Supabase ou fetch.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GRAPH_AUDIO_PHASE,
  GRAPH_SEND_CODES,
  GRAPH_UPLOAD_CODES,
  classifyPersistWamidOutcome,
  classifySendAudioOutcome,
  classifyUploadMediaOutcome,
  isValidGraphMediaId,
  isValidGraphWamid,
} from '../graphAudioOutcome.js';
import {
  OUTBOUND_AUDIO_STATUS,
  canAutomaticallyClassifyAsFailed,
  isAllowedTransition,
} from '../outboundAudioOperation.js';

const MEDIA_ID = '1013859600285441';
const WAMID = 'wamid.HBgLNTU1MTk4NzY1NDMyMQIVAgARGBI4NzY1NDMyMQ==';
const SOURCE_PATH = fileURLToPath(new URL('../graphAudioOutcome.js', import.meta.url));
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');

function assertNoGraphRetry(decision) {
  expect(decision.mayCallGraph).toBe(false);
  expect(decision.mayRetryGraph).toBe(false);
  expect(decision.mayMintOperationId).toBe(false);
  expect(decision.nextStatus).not.toBe(OUTBOUND_AUDIO_STATUS.FAILED);
  expect(canAutomaticallyClassifyAsFailed(decision.reason)).toBe(false);
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called in graphAudioOutcome tests');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('identificadores', () => {
  it('mediaId segue o contrato numérico do graphClient', () => {
    expect(isValidGraphMediaId(MEDIA_ID)).toBe(true);
    expect(isValidGraphMediaId('0')).toBe(true);
    expect(isValidGraphMediaId('')).toBe(false);
    expect(isValidGraphMediaId('wamid.xxx')).toBe(false);
    expect(isValidGraphMediaId(1013859600285441)).toBe(false);
  });

  it('wamid válido, ausente, vazio ou malformado', () => {
    expect(isValidGraphWamid(WAMID)).toBe(true);
    expect(isValidGraphWamid('wamid.x')).toBe(true);
    expect(isValidGraphWamid('')).toBe(false);
    expect(isValidGraphWamid('   ')).toBe(false);
    expect(isValidGraphWamid(null)).toBe(false);
    expect(isValidGraphWamid(undefined)).toBe(false);
    expect(isValidGraphWamid('x'.repeat(201))).toBe(false);
  });
});

describe('classifyUploadMediaOutcome', () => {
  it('sucesso com mediaId permanece in-flight e não envia mensagem', () => {
    const decision = classifyUploadMediaOutcome({ ok: true, mediaId: MEDIA_ID });
    expect(decision.ok).toBe(true);
    expect(decision.phase).toBe(GRAPH_AUDIO_PHASE.UPLOAD);
    expect(decision.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.GRAPH_IN_FLIGHT);
    expect(decision.mayContinueSend).toBe(true);
    expect(decision.mayPersistWamid).toBe(false);
    expect(decision.mediaId).toBe(MEDIA_ID);
    expect(decision.wamid).toBeNull();
    expect(decision.reason).toBe('upload_ok');
    assertNoGraphRetry(decision);
  });

  it('sucesso sem mediaId não autoriza envio', () => {
    const decision = classifyUploadMediaOutcome({ ok: true });
    expect(decision.ok).toBe(false);
    expect(decision.mayContinueSend).toBe(false);
    expect(decision.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.UNKNOWN);
    expect(decision.reason).toBe(GRAPH_UPLOAD_CODES.INVALID_RESPONSE);
    assertNoGraphRetry(decision);
  });

  it.each([
    [GRAPH_UPLOAD_CODES.TIMEOUT, 'timeout de upload'],
    [GRAPH_UPLOAD_CODES.NETWORK, 'rede no upload'],
    [GRAPH_UPLOAD_CODES.INVALID_RESPONSE, 'resposta inválida de upload'],
    [GRAPH_UPLOAD_CODES.INVALID_INPUT, 'input inválido de upload'],
  ])('%s classifica unknown sem retry', (code) => {
    const decision = classifyUploadMediaOutcome({ ok: false, code });
    expect(decision.ok).toBe(false);
    expect(decision.phase).toBe(GRAPH_AUDIO_PHASE.UPLOAD);
    expect(decision.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.UNKNOWN);
    expect(decision.mayContinueSend).toBe(false);
    expect(decision.reason).toBe(code);
    assertNoGraphRetry(decision);
  });

  it('HTTP 5xx de upload não é rejeição definitiva', () => {
    const decision = classifyUploadMediaOutcome({
      ok: false,
      code: GRAPH_UPLOAD_CODES.FAILED,
      graphStatus: 503,
      message: 'META_RAW_MESSAGE_MUST_BE_IGNORED',
    });
    expect(decision.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.UNKNOWN);
    expect(decision.httpClass).toBe('5xx');
    expect(decision.reason).toBe(GRAPH_UPLOAD_CODES.FAILED);
    expect(JSON.stringify(decision)).not.toContain('META_RAW_MESSAGE_MUST_BE_IGNORED');
    assertNoGraphRetry(decision);
  });

  it('HTTP 4xx de upload sem prova definitiva não vira failed', () => {
    const decision = classifyUploadMediaOutcome({
      ok: false,
      code: GRAPH_UPLOAD_CODES.FAILED,
      graphStatus: 400,
      metaErrorCode: 190,
    });
    expect(decision.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.UNKNOWN);
    expect(decision.httpClass).toBe('4xx');
    expect(decision.metaErrorCode).toBe(190);
    assertNoGraphRetry(decision);
  });
});

describe('classifySendAudioOutcome', () => {
  it('wamid válido autoriza graph_accepted e persistência, nunca Graph', () => {
    const decision = classifySendAudioOutcome({ ok: true, messageId: WAMID });
    expect(decision.ok).toBe(true);
    expect(decision.phase).toBe(GRAPH_AUDIO_PHASE.SEND);
    expect(decision.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.GRAPH_ACCEPTED);
    expect(decision.mayPersistWamid).toBe(true);
    expect(decision.mayResumeLocal).toBe(true);
    expect(decision.mayContinueSend).toBe(false);
    expect(decision.wamid).toBe(WAMID);
    expect(isAllowedTransition('graph_in_flight', decision.nextStatus)).toBe(true);
    assertNoGraphRetry(decision);
  });

  it.each([
    ['ausente', {}],
    ['vazio', { messageId: '' }],
    ['whitespace', { messageId: '   ' }],
    ['longo demais', { messageId: 'w'.repeat(201) }],
  ])('2xx sem wamid %s → unknown', (_label, extra) => {
    const decision = classifySendAudioOutcome({ ok: true, ...extra });
    expect(decision.ok).toBe(false);
    expect(decision.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.UNKNOWN);
    expect(decision.mayPersistWamid).toBe(false);
    expect(decision.reason).toBe(GRAPH_SEND_CODES.INVALID_RESPONSE);
    assertNoGraphRetry(decision);
  });

  it.each([
    [GRAPH_SEND_CODES.TIMEOUT],
    [GRAPH_SEND_CODES.NETWORK],
    [GRAPH_SEND_CODES.INVALID_RESPONSE],
    [GRAPH_SEND_CODES.INVALID_INPUT],
  ])('%s de envio → unknown sem retry', (code) => {
    const decision = classifySendAudioOutcome({ ok: false, code });
    expect(decision.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.UNKNOWN);
    expect(decision.mayPersistWamid).toBe(false);
    expect(decision.reason).toBe(code);
    assertNoGraphRetry(decision);
  });

  it('HTTP 5xx de envio não prova rejeição', () => {
    const decision = classifySendAudioOutcome({
      ok: false,
      code: GRAPH_SEND_CODES.FAILED,
      graphStatus: 500,
    });
    expect(decision.httpClass).toBe('5xx');
    expect(decision.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.UNKNOWN);
    assertNoGraphRetry(decision);
  });

  it('HTTP 4xx com metaErrorCode 131047 não vira failed nem retry', () => {
    const decision = classifySendAudioOutcome({
      ok: false,
      code: GRAPH_SEND_CODES.FAILED,
      graphStatus: 400,
      metaErrorCode: 131047,
      message: 'Re-engage user after 24 hours',
    });
    expect(decision.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.UNKNOWN);
    expect(decision.httpClass).toBe('4xx');
    expect(decision.metaErrorCode).toBe(131047);
    expect(JSON.stringify(decision)).not.toContain('Re-engage user after 24 hours');
    expect(isAllowedTransition('graph_in_flight', 'failed')).toBe(false);
    assertNoGraphRetry(decision);
  });

  it('upload bem-sucedido não é confundido com envio', () => {
    const upload = classifyUploadMediaOutcome({ ok: true, mediaId: MEDIA_ID });
    const send = classifySendAudioOutcome({
      ok: false,
      code: GRAPH_SEND_CODES.TIMEOUT,
    });
    expect(upload.mayContinueSend).toBe(true);
    expect(upload.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.GRAPH_IN_FLIGHT);
    expect(upload.wamid).toBeNull();
    expect(send.mayContinueSend).toBe(false);
    expect(send.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.UNKNOWN);
    expect(send.phase).not.toBe(upload.phase);
  });
});

describe('classifyPersistWamidOutcome', () => {
  it('falha de persistência após aceite não reenvia e preserva graph_accepted', () => {
    const decision = classifyPersistWamidOutcome({ wamid: WAMID });
    expect(decision.ok).toBe(false);
    expect(decision.phase).toBe(GRAPH_AUDIO_PHASE.PERSIST_WAMID);
    expect(decision.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.GRAPH_ACCEPTED);
    expect(decision.mayPersistWamid).toBe(true);
    expect(decision.mayResumeLocal).toBe(true);
    expect(decision.wamid).toBe(WAMID);
    assertNoGraphRetry(decision);
  });

  it('persistência sem wamid válido é unknown', () => {
    const decision = classifyPersistWamidOutcome({ wamid: '' });
    expect(decision.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.UNKNOWN);
    expect(decision.mayPersistWamid).toBe(false);
    assertNoGraphRetry(decision);
  });
});

describe('unknown / graph_accepted nunca autorizam reenvio', () => {
  it('unknown e graph_accepted não voltam para Graph', () => {
    expect(isAllowedTransition('unknown', 'graph_in_flight')).toBe(false);
    expect(isAllowedTransition('graph_accepted', 'graph_in_flight')).toBe(false);
    const unknownDecision = classifySendAudioOutcome({
      ok: false,
      code: GRAPH_SEND_CODES.TIMEOUT,
    });
    const accepted = classifySendAudioOutcome({ ok: true, messageId: WAMID });
    expect(unknownDecision.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.UNKNOWN);
    expect(accepted.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.GRAPH_ACCEPTED);
    assertNoGraphRetry(unknownDecision);
    assertNoGraphRetry(accepted);
  });

  it('resultados inesperados falham de forma conservadora', () => {
    for (const input of [null, undefined, 'timeout', { code: 'send_failed' }, { ok: false }]) {
      const upload = classifyUploadMediaOutcome(input);
      const send = classifySendAudioOutcome(input);
      expect(upload.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.UNKNOWN);
      expect(send.nextStatus).toBe(OUTBOUND_AUDIO_STATUS.UNKNOWN);
      assertNoGraphRetry(upload);
      assertNoGraphRetry(send);
    }
  });

  it('failed pós-claim nunca é produzido pelas funções Graph', () => {
    const samples = [
      classifyUploadMediaOutcome({ ok: false, code: GRAPH_UPLOAD_CODES.FAILED, graphStatus: 400 }),
      classifySendAudioOutcome({ ok: false, code: GRAPH_SEND_CODES.FAILED, graphStatus: 400 }),
      classifySendAudioOutcome({ ok: false, code: GRAPH_SEND_CODES.FAILED, graphStatus: 500 }),
      classifyPersistWamidOutcome({ wamid: WAMID }),
    ];
    for (const decision of samples) {
      expect(decision.nextStatus).not.toBe(OUTBOUND_AUDIO_STATUS.FAILED);
      expect(isAllowedTransition('graph_in_flight', 'failed')).toBe(false);
    }
  });
});

describe('pureza do módulo', () => {
  it('não importa Graph client, SQL, S3 nem gera operation_id', () => {
    const executable = SOURCE
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(executable).not.toContain('graphClient');
    expect(executable).not.toContain('uploadMedia');
    expect(executable).not.toContain('sendAudioMessage');
    expect(executable).not.toContain('supabase');
    expect(executable).not.toContain('awsUpload');
    expect(executable).not.toContain('randomUUID');
    expect(executable).not.toContain('console.');
    expect(executable).not.toContain('fetch(');
    expect(SOURCE).toContain(GRAPH_UPLOAD_CODES.TIMEOUT);
    expect(SOURCE).toContain(GRAPH_SEND_CODES.TIMEOUT);
  });
});
