// =============================================================================
// graphAudioOutcome.js — Classificação pura de resultados Graph já normalizados
// (B3.2-C.3-D.1)
//
// Sem SQL, Graph, S3, filesystem, logs ou mint de operation_id.
// Não autoriza retry. Não altera estado persistido.
// Códigos compatíveis com graphClient.js (uploadMedia / sendAudioMessage).
// =============================================================================

import { OUTBOUND_AUDIO_STATUS } from './outboundAudioOperation.js';

export const GRAPH_AUDIO_PHASE = Object.freeze({
  UPLOAD: 'upload',
  SEND: 'send',
  PERSIST_WAMID: 'persist_wamid',
});

export const GRAPH_UPLOAD_CODES = Object.freeze({
  INVALID_INPUT: 'upload_media_invalid_input',
  FAILED: 'upload_media_failed',
  TIMEOUT: 'upload_media_timeout',
  NETWORK: 'upload_media_network_error',
  INVALID_RESPONSE: 'upload_media_invalid_response',
});

export const GRAPH_SEND_CODES = Object.freeze({
  INVALID_INPUT: 'send_audio_invalid_input',
  FAILED: 'send_audio_failed',
  TIMEOUT: 'send_audio_timeout',
  NETWORK: 'send_audio_network_error',
  INVALID_RESPONSE: 'send_audio_invalid_response',
});

const MEDIA_ID_RE = /^[0-9]+$/;
const WAMID_MAX_LEN = 200;
const UPLOAD_CODE_SET = new Set(Object.values(GRAPH_UPLOAD_CODES));
const SEND_CODE_SET = new Set(Object.values(GRAPH_SEND_CODES));

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function readGraphStatus(value) {
  if (!isFiniteNumber(value) || !Number.isInteger(value)) return null;
  if (value < 100 || value > 599) return null;
  return value;
}

function readMetaErrorCode(value) {
  return isFiniteNumber(value) && Number.isInteger(value) ? value : null;
}

function httpClass(graphStatus) {
  if (graphStatus == null) return null;
  if (graphStatus >= 500) return '5xx';
  if (graphStatus >= 400) return '4xx';
  return null;
}

export function isValidGraphMediaId(value) {
  return typeof value === 'string' && MEDIA_ID_RE.test(value);
}

export function isValidGraphWamid(value) {
  return typeof value === 'string'
    && value.trim() !== ''
    && value.length <= WAMID_MAX_LEN;
}

function safetyLocks() {
  return {
    mayCallGraph: false,
    mayRetryGraph: false,
    mayMintOperationId: false,
    nextStatusNeverFailed: true,
  };
}

function decision(overrides) {
  return {
    ok: false,
    phase: null,
    nextStatus: OUTBOUND_AUDIO_STATUS.UNKNOWN,
    mayContinueSend: false,
    mayPersistWamid: false,
    mayResumeLocal: false,
    mediaId: null,
    wamid: null,
    graphStatus: null,
    metaErrorCode: null,
    httpClass: null,
    reason: 'unexpected_outcome',
    ...overrides,
    ...safetyLocks(),
  };
}

function classifyHttpFailure(code, graphStatus) {
  const klass = httpClass(readGraphStatus(graphStatus));
  if (klass === '5xx' || klass === '4xx') {
    return { reason: code, httpClass: klass };
  }
  return { reason: code, httpClass: null };
}

/**
 * Upload de mídia. Sucesso com mediaId NÃO significa mensagem enviada.
 * Pós-claim: qualquer falha → unknown. Nunca failed. Nunca retry Graph.
 */
export function classifyUploadMediaOutcome(input) {
  const base = { phase: GRAPH_AUDIO_PHASE.UPLOAD };
  if (!isPlainObject(input)) {
    return decision({ ...base });
  }

  const graphStatus = readGraphStatus(input.graphStatus);
  const metaErrorCode = readMetaErrorCode(input.metaErrorCode);

  if (input.ok === true) {
    if (!isValidGraphMediaId(input.mediaId)) {
      return decision({
        ...base,
        reason: GRAPH_UPLOAD_CODES.INVALID_RESPONSE,
      });
    }
    return decision({
      ...base,
      ok: true,
      nextStatus: OUTBOUND_AUDIO_STATUS.GRAPH_IN_FLIGHT,
      mayContinueSend: true,
      mediaId: input.mediaId,
      reason: 'upload_ok',
    });
  }

  const code = input.code;
  if (typeof code !== 'string' || !UPLOAD_CODE_SET.has(code)) {
    return decision({ ...base, graphStatus, metaErrorCode });
  }

  if (code === GRAPH_UPLOAD_CODES.FAILED) {
    const http = classifyHttpFailure(code, graphStatus);
    return decision({
      ...base,
      graphStatus,
      metaErrorCode,
      httpClass: http.httpClass,
      reason: http.reason,
    });
  }

  return decision({
    ...base,
    graphStatus,
    metaErrorCode,
    reason: code,
  });
}

/**
 * Envio da mensagem. Somente wamid válido autoriza graph_accepted.
 * Timeout, rede, 4xx, 5xx e 2xx sem wamid → unknown. Nunca failed. Nunca retry.
 */
export function classifySendAudioOutcome(input) {
  const base = { phase: GRAPH_AUDIO_PHASE.SEND };
  if (!isPlainObject(input)) {
    return decision({ ...base });
  }

  const graphStatus = readGraphStatus(input.graphStatus);
  const metaErrorCode = readMetaErrorCode(input.metaErrorCode);
  const wamid = input.messageId ?? input.wamid;

  if (input.ok === true) {
    if (!isValidGraphWamid(wamid)) {
      return decision({
        ...base,
        reason: GRAPH_SEND_CODES.INVALID_RESPONSE,
      });
    }
    return decision({
      ...base,
      ok: true,
      nextStatus: OUTBOUND_AUDIO_STATUS.GRAPH_ACCEPTED,
      mayPersistWamid: true,
      mayResumeLocal: true,
      wamid,
      reason: 'send_ok',
    });
  }

  const code = input.code;
  if (typeof code !== 'string' || !SEND_CODE_SET.has(code)) {
    return decision({ ...base, graphStatus, metaErrorCode });
  }

  if (code === GRAPH_SEND_CODES.FAILED) {
    const http = classifyHttpFailure(code, graphStatus);
    return decision({
      ...base,
      graphStatus,
      metaErrorCode,
      httpClass: http.httpClass,
      reason: http.reason,
    });
  }

  return decision({
    ...base,
    graphStatus,
    metaErrorCode,
    reason: code,
  });
}

/**
 * Graph já devolveu wamid; a gravação local falhou.
 * Não reenvia. Autoriza somente nova tentativa de persistência.
 */
export function classifyPersistWamidOutcome(input) {
  const base = { phase: GRAPH_AUDIO_PHASE.PERSIST_WAMID };
  if (!isPlainObject(input)) {
    return decision({ ...base });
  }

  const wamid = input.messageId ?? input.wamid;
  if (!isValidGraphWamid(wamid)) {
    return decision({
      ...base,
      reason: 'persist_wamid_missing',
    });
  }

  return decision({
    ...base,
    ok: false,
    nextStatus: OUTBOUND_AUDIO_STATUS.GRAPH_ACCEPTED,
    mayPersistWamid: true,
    mayResumeLocal: true,
    wamid,
    reason: 'persist_wamid_failed',
  });
}
