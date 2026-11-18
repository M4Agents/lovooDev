// =============================================================================
// outboundAudioPersistenceOrchestrator.js — Persistência local após
// graph_accepted (B3.2-C.3-D.3-E.2-B.6)
//
// Ordem: operação durável → S3 → biblioteca → tracking → chat → markCompleted.
// Dependências injetadas. Sem Graph, HTTP, getSupabaseAdmin, process.env,
// Date.now, SQL direto, DELETE S3 ou segundo markCompleted.
// =============================================================================

import { isValidGraphWamid } from './graphAudioOutcome.js';
import {
  OUTBOUND_AUDIO_STATUS,
  classifyOperationStatus,
  compareOperationIdentity,
  evaluateStatusCoherence,
  isAudioSha256,
  isUuid,
  parseOperationId,
} from './outboundAudioOperation.js';
import {
  OUTBOUND_AUDIO_CML_FILENAME,
  OUTBOUND_AUDIO_CML_MIME_TYPE,
  OUTBOUND_AUDIO_S3_KEY_INFIX,
} from './outboundAudioPersistenceContracts.js';

const DEP_KEYS = Object.freeze([
  'selectByCompanyOperation',
  'uploadMetaOutboundAudio',
  'persistOutboundAudioMediaLibrary',
  'persistOutboundAudioTracking',
  'persistOutboundAudioChat',
  'markCompleted',
]);

const ISO_TZ_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (!ISO_TZ_RE.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function failed(error) {
  return { ok: false, error };
}

function succeeded(fields) {
  return { ok: true, ...fields };
}

function hasBytes(value) {
  return value != null && typeof value.length === 'number' && value.length > 0;
}

function expectedS3Key(companyId, operationId) {
  const parsed = parseOperationId(operationId);
  if (!parsed.ok || typeof companyId !== 'string' || !isUuid(companyId)) return null;
  return (
    `clientes/${companyId.toLowerCase()}/${OUTBOUND_AUDIO_S3_KEY_INFIX}`
    + `/${parsed.operationId}/${OUTBOUND_AUDIO_CML_FILENAME}`
  );
}

function incomingIdentity(context) {
  if (!isPlainObject(context)) return null;
  return {
    company_id: context.companyId,
    operation_id: context.operationId,
    user_id: context.userId,
    instance_id: context.instanceId,
    conversation_id: context.conversationId,
    audio_sha256: context.audioSha256,
  };
}

function readSelectPair(context) {
  if (!isPlainObject(context) || !isUuid(context.companyId)) return null;
  const parsed = parseOperationId(context.operationId);
  if (!parsed.ok) return null;
  return { companyId: context.companyId, operationId: parsed.operationId };
}

function readDeps(input) {
  if (!isPlainObject(input)) return null;
  const deps = {};
  for (const key of DEP_KEYS) {
    if (typeof input[key] !== 'function') return null;
    deps[key] = input[key];
  }
  if (typeof input.now === 'function') deps.now = input.now;
  return deps;
}

function readCompletedAt(context, deps) {
  if (isIsoTimestamp(context.completedAt)) return context.completedAt;
  if (typeof deps.now === 'function') {
    const value = deps.now();
    if (isIsoTimestamp(value)) return value;
  }
  return null;
}

function audioSizeBytes(context) {
  if (!hasBytes(context.audioBytes)) return null;
  const size = context.audioBytes.length;
  if (context.audioSizeBytes !== undefined && context.audioSizeBytes !== size) {
    return null;
  }
  return size;
}

async function invoke(fn, ...args) {
  try {
    return { ok: true, value: await fn(...args) };
  } catch {
    return { ok: false };
  }
}

function identityMatches(stored, context) {
  const compared = compareOperationIdentity(stored, incomingIdentity(context));
  return compared.ok === true && compared.equal === true;
}

function confirmCompletedRow(row, context, expectedKey) {
  if (!isPlainObject(row) || row.status !== OUTBOUND_AUDIO_STATUS.COMPLETED) {
    return null;
  }
  if (!identityMatches(row, context)) return null;
  if (!isValidGraphWamid(row.wamid)) return null;
  if (row.s3_key !== expectedKey) return null;
  const coherence = evaluateStatusCoherence(row.status, row);
  if (!coherence.ok) return null;
  return succeeded({
    idempotent: true,
    operationId: row.operation_id,
    wamid: row.wamid,
    s3Key: row.s3_key,
  });
}

function s3Confirmed(result, expectedKey, sizeBytes) {
  return isPlainObject(result)
    && result.ok === true
    && result.objectKey === expectedKey
    && result.contentType === OUTBOUND_AUDIO_CML_MIME_TYPE
    && result.sizeBytes === sizeBytes;
}

async function rereadCompleted(deps, context, expectedKey) {
  const selected = await invoke(deps.selectByCompanyOperation, {
    companyId: context.companyId,
    operationId: context.operationId,
  });
  if (!selected.ok || selected.value?.ok !== true || !selected.value.row) {
    return failed('completion_indeterminate');
  }
  const confirmed = confirmCompletedRow(selected.value.row, context, expectedKey);
  if (confirmed) return confirmed;
  if (selected.value.row.status === OUTBOUND_AUDIO_STATUS.GRAPH_ACCEPTED) {
    return failed('completion_indeterminate');
  }
  return failed('completion_conflict');
}

async function completeAfterPersist(deps, context, payload) {
  const marked = await invoke(deps.markCompleted, {
    companyId: payload.companyId,
    operationId: payload.operationId,
    s3Key: payload.s3Key,
    completedAt: payload.completedAt,
  });
  if (marked.ok && marked.value?.ok === true && isPlainObject(marked.value.row)) {
    const confirmed = confirmCompletedRow(marked.value.row, context, payload.s3Key);
    if (!confirmed) return failed('completion_conflict');
    return succeeded({
      idempotent: false,
      operationId: payload.operationId,
      wamid: payload.wamid,
      mediaAssetId: payload.mediaAssetId,
      trackingId: payload.trackingId,
      chatMessageId: payload.chatMessageId,
      s3Key: payload.s3Key,
    });
  }
  return rereadCompleted(deps, context, payload.s3Key);
}

/**
 * Finaliza a persistência local de um áudio outbound já aceito pelo Graph.
 * Não autoriza acesso. Não envia ao Graph. Não cria cliente Supabase/S3.
 *
 * @param {{ context?: object, dependencies?: object }} input
 */
export async function completeMetaOutboundAudioPersistence({
  context,
  dependencies,
} = {}) {
  const deps = readDeps(dependencies);
  const pair = readSelectPair(context);
  if (!deps || !pair) return failed('invalid_input');
  if (!isUuid(context.userId) || !isUuid(context.instanceId) || !isUuid(context.conversationId)) {
    return failed('invalid_input');
  }
  if (!isAudioSha256(context.audioSha256)) return failed('invalid_input');
  if (context.s3Key !== undefined) {
    const expected = expectedS3Key(context.companyId, context.operationId);
    if (!expected || context.s3Key !== expected) return failed('invalid_input');
  }

  const selected = await invoke(deps.selectByCompanyOperation, {
    companyId: pair.companyId,
    operationId: pair.operationId,
  });
  if (!selected.ok) return failed('operation_indeterminate');
  if (selected.value?.ok !== true) {
    if (selected.value?.reason === 'not_found') return failed('operation_not_found');
    if (selected.value?.reason === 'invalid_identity') return failed('invalid_input');
    return failed('operation_indeterminate');
  }

  const stored = selected.value.row;
  if (!isPlainObject(stored)) return failed('operation_indeterminate');
  if (!identityMatches(stored, context)) {
    return failed('operation_identity_conflict');
  }

  const expectedKey = expectedS3Key(stored.company_id, stored.operation_id);
  if (!expectedKey) return failed('invalid_input');

  const classified = classifyOperationStatus(stored.status);
  if (classified.status === OUTBOUND_AUDIO_STATUS.COMPLETED) {
    const confirmed = confirmCompletedRow(stored, context, expectedKey);
    return confirmed || failed('completion_conflict');
  }
  if (classified.status !== OUTBOUND_AUDIO_STATUS.GRAPH_ACCEPTED) {
    return failed('operation_state_not_eligible');
  }

  const coherence = evaluateStatusCoherence(stored.status, stored);
  if (
    !coherence.ok
    || !isValidGraphWamid(stored.wamid)
    || !isIsoTimestamp(stored.graph_started_at)
  ) {
    return failed('operation_indeterminate');
  }

  const sizeBytes = audioSizeBytes(context);
  const completedAt = readCompletedAt(context, deps);
  if (sizeBytes == null || !isIsoTimestamp(context.providerTimestamp) || !completedAt) {
    return failed('invalid_input');
  }

  const uploaded = await invoke(deps.uploadMetaOutboundAudio, {
    companyId: stored.company_id,
    operationId: stored.operation_id,
    audioBytes: context.audioBytes,
    audioSha256: stored.audio_sha256,
  });
  if (!uploaded.ok || !s3Confirmed(uploaded.value, expectedKey, sizeBytes)) {
    return failed('s3_confirmation_failed');
  }

  const library = await invoke(deps.persistOutboundAudioMediaLibrary, {
    companyId: stored.company_id,
    operationId: stored.operation_id,
    audioSha256: stored.audio_sha256,
    s3Key: expectedKey,
    audioSizeBytes: sizeBytes,
  });
  if (
    !library.ok
    || library.value?.ok !== true
    || !isUuid(library.value.mediaAssetId)
  ) {
    return failed('media_library_persistence_failed');
  }

  const tracking = await invoke(deps.persistOutboundAudioTracking, {
    companyId: stored.company_id,
    instanceId: stored.instance_id,
    wamid: stored.wamid,
  });
  if (
    !tracking.ok
    || tracking.value?.ok !== true
    || !isUuid(tracking.value.trackingId)
  ) {
    return failed('tracking_persistence_failed');
  }

  const chat = await invoke(deps.persistOutboundAudioChat, {
    companyId: stored.company_id,
    instanceId: stored.instance_id,
    conversationId: stored.conversation_id,
    wamid: stored.wamid,
    mediaAssetId: library.value.mediaAssetId,
    providerTimestamp: context.providerTimestamp,
  });
  if (!chat.ok || chat.value?.ok !== true || !isUuid(chat.value.chatMessageId)) {
    return failed('chat_persistence_failed');
  }

  return completeAfterPersist(deps, context, {
    companyId: stored.company_id,
    operationId: stored.operation_id,
    wamid: stored.wamid,
    s3Key: expectedKey,
    completedAt,
    mediaAssetId: library.value.mediaAssetId,
    trackingId: tracking.value.trackingId,
    chatMessageId: chat.value.chatMessageId,
  });
}
