// =============================================================================
// outboundAudioSendOrchestrator.js — Orquestração local claim → Graph → wamid
// (B3.2-C.3-D.3-D.2-C)
//
// Dependências injetadas. Sem graphClient, Supabase, tokenCrypto, S3 ou HTTP.
// enabled !== true → audio_send_not_enabled; zero claim, Graph, clock ou transições.
// enabled é argumento explícito do handler após JWT/RBAC/tenant — não é env.
// enabled true exige deadlineAtMs futuro + clock.nowMs. Sem deadline implícito.
// Após claim: identidade completa. Orçamento insuficiente → markUnknown, sem Graph.
// wamid conhecido → markGraphAccepted mesmo com deadline estourado.
// Não lê variáveis de ambiente. Não gera operation_id. Não retenta Graph.
// =============================================================================

import {
  classifySendAudioOutcome,
  classifyUploadMediaOutcome,
  isValidGraphMediaId,
} from './graphAudioOutcome.js';
import {
  OUTBOUND_AUDIO_STATUS,
  isAudioSha256,
  isUuid,
  parseOperationId,
} from './outboundAudioOperation.js';

const AUDIO_MIME = 'audio/mp4';
const AUDIO_FILENAME = 'audio.m4a';
const PHONE_ID_RE = /^[0-9]+$/;
const WA_ID_RE = /^[0-9]+$/;
const ISO_TZ_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const DEFAULT_UPLOAD_TIMEOUT_MS = 20_000;
const DEFAULT_SEND_TIMEOUT_MS = 10_000;
const DEFAULT_PERSIST_RESERVE_MS = 2_000;
const DEFAULT_CLAIM_RESERVE_MS = 1_000;

const DEP_KEYS = Object.freeze([
  'claimCreatedToGraphInFlight',
  'uploadMedia',
  'sendAudioMessage',
  'markUnknown',
  'markGraphAccepted',
]);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function hasBytes(value) {
  return value != null && typeof value.length === 'number' && value.length > 0;
}

function locked(overrides) {
  return {
    ok: false,
    claimed: false,
    persistedStatus: null,
    mayRetryGraph: false,
    mayMintOperationId: false,
    ...overrides,
    mayRetryGraph: false,
    mayMintOperationId: false,
  };
}

function disabledResult() {
  return locked({ error: 'audio_send_not_enabled' });
}

function readToken(context) {
  return typeof context.accessToken === 'string' && context.accessToken.length > 0
    ? context.accessToken
    : null;
}

function readContext(input) {
  if (!isPlainObject(input)) return null;
  const operationId = parseOperationId(input.operationId);
  if (!operationId.ok) return null;
  if (!isUuid(input.companyId) || !isUuid(input.userId)) return null;
  if (!isUuid(input.instanceId) || !isUuid(input.conversationId)) return null;
  if (!isAudioSha256(input.audioSha256)) return null;
  if (typeof input.phoneNumberId !== 'string' || !PHONE_ID_RE.test(input.phoneNumberId)) {
    return null;
  }
  if (typeof input.recipientWaId !== 'string' || !WA_ID_RE.test(input.recipientWaId)) {
    return null;
  }
  if (!hasBytes(input.audioBytes)) return null;
  if (!readToken(input)) return null;
  if (input.operationStatus !== OUTBOUND_AUDIO_STATUS.CREATED) return null;
  if (input.customerServiceWindowOpen !== true) return null;
  return {
    companyId: input.companyId,
    operationId: operationId.operationId,
    userId: input.userId,
    instanceId: input.instanceId,
    conversationId: input.conversationId,
    phoneNumberId: input.phoneNumberId,
    recipientWaId: input.recipientWaId,
    audioBytes: input.audioBytes,
    audioSha256: input.audioSha256,
  };
}

function readDeps(input) {
  if (!isPlainObject(input)) return null;
  const deps = {};
  for (const key of DEP_KEYS) {
    if (typeof input[key] !== 'function') return null;
    deps[key] = input[key];
  }
  return deps;
}

function readPositiveInt(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function readClock(input) {
  if (typeof input.clock === 'function') return input.clock;
  if (isPlainObject(input.clock) && typeof input.clock.nowMs === 'function') {
    return () => input.clock.nowMs();
  }
  return null;
}

function readNowMs(clock) {
  try {
    const value = clock();
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function readBudget(input) {
  const clock = readClock(input);
  if (!clock) return { error: 'invalid_deadline' };
  const nowMs = readNowMs(clock);
  if (nowMs == null) return { error: 'invalid_deadline' };
  const deadlineAtMs = input.deadlineAtMs;
  if (
    typeof deadlineAtMs !== 'number'
    || !Number.isInteger(deadlineAtMs)
    || !Number.isFinite(deadlineAtMs)
    || deadlineAtMs <= nowMs
  ) {
    return { error: 'invalid_deadline' };
  }
  const uploadTimeoutMs = readPositiveInt(input.uploadTimeoutMs, DEFAULT_UPLOAD_TIMEOUT_MS);
  const sendTimeoutMs = readPositiveInt(input.sendTimeoutMs, DEFAULT_SEND_TIMEOUT_MS);
  const persistReserveMs = readPositiveInt(input.persistReserveMs, DEFAULT_PERSIST_RESERVE_MS);
  const claimReserveMs = readPositiveInt(input.claimReserveMs, DEFAULT_CLAIM_RESERVE_MS);
  if (
    uploadTimeoutMs == null
    || sendTimeoutMs == null
    || persistReserveMs == null
    || claimReserveMs == null
  ) {
    return { error: 'invalid_budget' };
  }
  return {
    clock,
    deadlineAtMs,
    uploadTimeoutMs,
    sendTimeoutMs,
    persistReserveMs,
    claimReserveMs,
  };
}

function remainingMs(budget) {
  const nowMs = readNowMs(budget.clock);
  if (nowMs == null) return null;
  return budget.deadlineAtMs - nowMs;
}

function readGraphError(err) {
  if (!isPlainObject(err)) return { code: undefined, graphStatus: undefined, metaErrorCode: undefined };
  return {
    code: typeof err.code === 'string' ? err.code : undefined,
    graphStatus: err.graphStatus,
    metaErrorCode: err.metaErrorCode,
  };
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (!ISO_TZ_RE.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function claimMatches(row, context) {
  return isPlainObject(row)
    && row.status === OUTBOUND_AUDIO_STATUS.GRAPH_IN_FLIGHT
    && row.company_id === context.companyId
    && row.operation_id === context.operationId
    && row.user_id === context.userId
    && row.instance_id === context.instanceId
    && row.conversation_id === context.conversationId
    && row.audio_sha256 === context.audioSha256
    && isIsoTimestamp(row.graph_started_at)
    && row.wamid == null;
}

async function invoke(fn, ...args) {
  try {
    return { ok: true, value: await fn(...args) };
  } catch (err) {
    return { ok: false, error: err };
  }
}

async function persistUnknown(deps, context) {
  const marked = await invoke(deps.markUnknown, {
    companyId: context.companyId,
    operationId: context.operationId,
  });
  if (!marked.ok || marked.value?.ok !== true) {
    return locked({
      claimed: true,
      error: 'persist_unknown_failed',
      persistFailed: true,
    });
  }
  return locked({
    claimed: true,
    persistedStatus: OUTBOUND_AUDIO_STATUS.UNKNOWN,
    error: 'operation_unknown',
  });
}

async function persistUnknownForDeadline(deps, context) {
  const persisted = await persistUnknown(deps, context);
  if (persisted.error === 'persist_unknown_failed') return persisted;
  return locked({
    claimed: true,
    persistedStatus: persisted.persistedStatus,
    error: 'deadline_insufficient_after_claim',
  });
}

/**
 * Orquestra claim + upload + send + persistência do wamid.
 * HTTP e autorização ficam fora. enabled true só após o handler autenticar.
 *
 * @param {{
 *   enabled?: boolean,
 *   context?: object,
 *   deps?: object,
 *   now?: () => string,
 *   clock?: (() => number)|{ nowMs: () => number },
 *   deadlineAtMs?: number,
 *   uploadTimeoutMs?: number,
 *   sendTimeoutMs?: number,
 *   persistReserveMs?: number,
 *   claimReserveMs?: number,
 * }} input
 */
export async function orchestrateOutboundAudioSend(input = {}) {
  if (!isPlainObject(input) || input.enabled !== true) {
    return disabledResult();
  }

  const context = readContext(input.context);
  const deps = readDeps(input.deps);
  const now = input.now;
  if (!context || !deps || typeof now !== 'function') {
    return locked({ error: 'invalid_context' });
  }

  const graphStartedAt = now();
  if (typeof graphStartedAt !== 'string' || graphStartedAt.length === 0) {
    return locked({ error: 'invalid_context' });
  }

  const budget = readBudget(input);
  if (budget.error) {
    return locked({ error: budget.error });
  }

  const beforeClaim = remainingMs(budget);
  const needBeforeClaim = budget.claimReserveMs
    + budget.uploadTimeoutMs
    + budget.sendTimeoutMs
    + budget.persistReserveMs;
  if (beforeClaim == null || beforeClaim < needBeforeClaim) {
    return locked({ error: 'deadline_insufficient_before_claim' });
  }

  const claimed = await invoke(deps.claimCreatedToGraphInFlight, {
    companyId: context.companyId,
    operationId: context.operationId,
    graphStartedAt,
  });
  if (!claimed.ok) {
    return locked({ error: 'claim_failed' });
  }
  if (claimed.value?.ok !== true) {
    const reason = claimed.value?.reason;
    if (reason === 'not_claimed') {
      return locked({ error: 'claim_not_claimed' });
    }
    if (reason === 'db_error') {
      return locked({ error: 'claim_db_error' });
    }
    return locked({ error: 'claim_failed' });
  }
  if (!claimMatches(claimed.value.row, context)) {
    return locked({ error: 'claim_inconsistent' });
  }

  const needBeforeUpload = budget.uploadTimeoutMs
    + budget.sendTimeoutMs
    + budget.persistReserveMs;
  const beforeUpload = remainingMs(budget);
  if (beforeUpload == null || beforeUpload < needBeforeUpload) {
    return persistUnknownForDeadline(deps, context);
  }

  const token = readToken(input.context);
  const uploaded = await invoke(
    deps.uploadMedia,
    token,
    context.phoneNumberId,
    context.audioBytes,
    AUDIO_MIME,
    AUDIO_FILENAME,
    budget.uploadTimeoutMs,
  );
  const uploadDecision = uploaded.ok
    ? classifyUploadMediaOutcome({
      ok: true,
      mediaId: uploaded.value?.mediaId,
    })
    : classifyUploadMediaOutcome({
      ok: false,
      ...readGraphError(uploaded.error),
    });

  if (!uploadDecision.mayContinueSend || !isValidGraphMediaId(uploadDecision.mediaId)) {
    return persistUnknown(deps, context);
  }

  const needBeforeSend = budget.sendTimeoutMs + budget.persistReserveMs;
  const beforeSend = remainingMs(budget);
  if (beforeSend == null || beforeSend < needBeforeSend) {
    return persistUnknownForDeadline(deps, context);
  }

  const sent = await invoke(
    deps.sendAudioMessage,
    token,
    context.phoneNumberId,
    context.recipientWaId,
    uploadDecision.mediaId,
    { timeoutMs: budget.sendTimeoutMs },
  );
  const sendDecision = sent.ok
    ? classifySendAudioOutcome({
      ok: true,
      messageId: sent.value?.messageId ?? sent.value?.wamid,
    })
    : classifySendAudioOutcome({
      ok: false,
      ...readGraphError(sent.error),
    });

  if (!sendDecision.mayPersistWamid || !sendDecision.wamid) {
    if (sendDecision.metaErrorCode === 131047) {
      const persisted = await persistUnknown(deps, context);
      if (persisted.error === 'persist_unknown_failed') return persisted;
      return locked({
        claimed: true,
        persistedStatus: persisted.persistedStatus,
        error: 'customer_service_window_closed',
        metaErrorCode: 131047,
      });
    }
    return persistUnknown(deps, context);
  }

  const accepted = await invoke(deps.markGraphAccepted, {
    companyId: context.companyId,
    operationId: context.operationId,
    wamid: sendDecision.wamid,
  });
  if (!accepted.ok || accepted.value?.ok !== true) {
    return locked({
      claimed: true,
      error: 'persist_wamid_failed',
      persistFailed: true,
      wamidInMemory: sendDecision.wamid,
      persistedStatus: null,
    });
  }

  return locked({
    ok: true,
    claimed: true,
    persistedStatus: OUTBOUND_AUDIO_STATUS.GRAPH_ACCEPTED,
    wamid: sendDecision.wamid,
  });
}

export const OUTBOUND_AUDIO_UPLOAD_MIME = AUDIO_MIME;
export const OUTBOUND_AUDIO_UPLOAD_FILENAME = AUDIO_FILENAME;
