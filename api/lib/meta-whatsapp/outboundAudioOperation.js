// =============================================================================
// outboundAudioOperation.js — Contratos puros da máquina de estados
// (B3.2-C.3-B / C.3-B.1 / C.3-D.1)
//
// Sem Supabase, Graph, S3, filesystem ou rede.
// Não gera operation_id. Não autoriza Graph a partir de estado armazenado.
// operation_id UUID v4 é canonicalizado para minúsculas após validação.
// Transições alinhadas ao CHECK moao_status_coherence_check.
// =============================================================================

export const OUTBOUND_AUDIO_STATUS = Object.freeze({
  CREATED:          'created',
  GRAPH_IN_FLIGHT:  'graph_in_flight',
  GRAPH_ACCEPTED:   'graph_accepted',
  COMPLETED:        'completed',
  FAILED:           'failed',
  UNKNOWN:          'unknown',
});

export const OUTBOUND_AUDIO_STATUSES = Object.freeze([
  OUTBOUND_AUDIO_STATUS.CREATED,
  OUTBOUND_AUDIO_STATUS.GRAPH_IN_FLIGHT,
  OUTBOUND_AUDIO_STATUS.GRAPH_ACCEPTED,
  OUTBOUND_AUDIO_STATUS.COMPLETED,
  OUTBOUND_AUDIO_STATUS.FAILED,
  OUTBOUND_AUDIO_STATUS.UNKNOWN,
]);

const STATUS_SET = new Set(OUTBOUND_AUDIO_STATUSES);

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AUDIO_SHA256_RE = /^[a-f0-9]{64}$/;

const IDENTITY_KEYS = Object.freeze([
  'company_id',
  'operation_id',
  'user_id',
  'instance_id',
  'conversation_id',
  'audio_sha256',
]);

// Allowlist estrutural alinhada ao CHECK. NÃO prova que a causa é segura.
// created → failed: somente pré-claim, com evidência definitiva do orquestrador.
// graph_in_flight → failed: PROIBIDO — CHECK exige graph_started_at NULL em failed.
// Pós-claim sem wamid confirmado → unknown. Com wamid válido → graph_accepted.
const ALLOWED_TRANSITIONS = Object.freeze(new Set([
  'created>graph_in_flight',
  'created>failed',
  'graph_in_flight>graph_accepted',
  'graph_in_flight>unknown',
  'graph_accepted>completed',
]));

export const NON_DEFINITIVE_GRAPH_OUTCOMES = Object.freeze([
  'timeout',
  'network_error',
  'ambiguous_response',
  'http_4xx',
  'http_5xx',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

export function isUuidV4(value) {
  return isNonEmptyString(value) && UUID_V4_RE.test(value);
}

export function isUuid(value) {
  return isNonEmptyString(value) && UUID_RE.test(value);
}

export function isAudioSha256(value) {
  return typeof value === 'string' && AUDIO_SHA256_RE.test(value);
}

/**
 * Interpreta o campo multipart `operation_id`.
 * Aceita hex maiúsculo/minúsculo. Retorna sempre UUID v4 canônico em minúsculas.
 * Não gera ID. Não faz trim. Não escolhe o primeiro valor de um array.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, operationId: string } | { ok: false }}
 */
export function parseOperationId(raw) {
  if (Array.isArray(raw)) {
    if (raw.length !== 1) return { ok: false };
    return parseOperationId(raw[0]);
  }
  if (!isUuidV4(raw)) return { ok: false };
  return { ok: true, operationId: raw.toLowerCase() };
}

function readIdentity(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const identity = {};
  for (const key of IDENTITY_KEYS) {
    const value = input[key];
    if (!isNonEmptyString(value)) return null;
    identity[key] = value;
  }
  if (!isUuid(identity.company_id)) return null;
  if (!isUuid(identity.user_id)) return null;
  if (!isUuid(identity.instance_id)) return null;
  if (!isUuid(identity.conversation_id)) return null;
  if (!isAudioSha256(identity.audio_sha256)) return null;
  const parsedOperationId = parseOperationId(identity.operation_id);
  if (!parsedOperationId.ok) return null;
  identity.operation_id = parsedOperationId.operationId;
  return identity;
}

/**
 * Compara a identidade imutável.
 * operation_id: igualdade após canonicalização UUID v4.
 * Demais campos: igualdade byte-a-byte, sem normalizar.
 *
 * @returns {{ ok: true, equal: boolean } | { ok: false, reason: 'invalid_identity' }}
 */
export function compareOperationIdentity(stored, incoming) {
  const left = readIdentity(stored);
  const right = readIdentity(incoming);
  if (!left || !right) {
    return { ok: false, reason: 'invalid_identity' };
  }
  const equal = IDENTITY_KEYS.every((key) => left[key] === right[key]);
  return { ok: true, equal };
}

/**
 * Classifica um status persistido. Conservador: ausente/malformado nunca
 * autoriza Graph, claim ou resume local. Status armazenado nunca autoriza Graph.
 */
export function classifyOperationStatus(status) {
  if (!isNonEmptyString(status) || !STATUS_SET.has(status)) {
    return {
      status: null,
      known: false,
      terminal: false,
      mayClaim: false,
      mayCallGraph: false,
      mayResumeLocal: false,
    };
  }

  return {
    status,
    known: true,
    terminal:
      status === OUTBOUND_AUDIO_STATUS.COMPLETED
      || status === OUTBOUND_AUDIO_STATUS.FAILED,
    mayClaim: status === OUTBOUND_AUDIO_STATUS.CREATED,
    mayCallGraph: false,
    mayResumeLocal: status === OUTBOUND_AUDIO_STATUS.GRAPH_ACCEPTED,
  };
}

/**
 * Transição estruturalmente possível e compatível com o CHECK.
 * Não classifica erros Graph e não autoriza Graph.
 */
export function isAllowedTransition(from, to) {
  if (!STATUS_SET.has(from) || !STATUS_SET.has(to)) return false;
  return ALLOWED_TRANSITIONS.has(`${from}>${to}`);
}

function isAbsent(value) {
  return value == null;
}

function isNonBlankText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function hasTimestamp(value) {
  return value != null && value !== '';
}

/**
 * Espelha moao_status_coherence_check. Não escreve no banco.
 *
 * @param {string} status
 * @param {{ wamid?: unknown, s3_key?: unknown, graph_started_at?: unknown, completed_at?: unknown }} [fields]
 * @returns {{ ok: boolean, reason: string }}
 */
export function evaluateStatusCoherence(status, fields = {}) {
  if (!STATUS_SET.has(status)) {
    return { ok: false, reason: 'unknown_status' };
  }
  if (fields == null || typeof fields !== 'object' || Array.isArray(fields)) {
    return { ok: false, reason: 'invalid_fields' };
  }

  const wamid = fields.wamid;
  const s3Key = fields.s3_key;
  const startedAt = fields.graph_started_at;
  const completedAt = fields.completed_at;
  const wamidPresent = isNonBlankText(wamid);
  const s3Present = isNonBlankText(s3Key);
  const started = hasTimestamp(startedAt);
  const completed = hasTimestamp(completedAt);

  if (
    status === OUTBOUND_AUDIO_STATUS.CREATED
    || status === OUTBOUND_AUDIO_STATUS.FAILED
  ) {
    if (isAbsent(wamid) && !started && !completed) {
      return { ok: true, reason: 'coherent' };
    }
    return { ok: false, reason: 'pre_claim_requires_null_graph_fields' };
  }

  if (
    status === OUTBOUND_AUDIO_STATUS.GRAPH_IN_FLIGHT
    || status === OUTBOUND_AUDIO_STATUS.UNKNOWN
  ) {
    if (isAbsent(wamid) && started && !completed) {
      return { ok: true, reason: 'coherent' };
    }
    return { ok: false, reason: 'post_claim_without_wamid_requires_started_at' };
  }

  if (status === OUTBOUND_AUDIO_STATUS.GRAPH_ACCEPTED) {
    if (wamidPresent && started && !completed) {
      return { ok: true, reason: 'coherent' };
    }
    return { ok: false, reason: 'graph_accepted_requires_wamid_and_started_at' };
  }

  if (wamidPresent && s3Present && started && completed) {
    return { ok: true, reason: 'coherent' };
  }
  return { ok: false, reason: 'completed_requires_wamid_s3_key_and_completed_at' };
}

/**
 * Allowlist + CHECK. Não autoriza Graph nem prova a causa da transição.
 */
export function isSchemaCompatibleTransition(from, to, nextFields) {
  if (!isAllowedTransition(from, to)) return false;
  return evaluateStatusCoherence(to, nextFields).ok;
}

/**
 * Pós-claim nunca vira failed automaticamente. Pré-claim também exige
 * evidência externa do orquestrador — este módulo não a infere.
 */
export function canAutomaticallyClassifyAsFailed(_graphOutcomeKind) {
  return false;
}

/**
 * Após o claim, timeout/rede/4xx/5xx/ambiguidade → unknown.
 * Não decide failed. Outcomes fora da lista exigem o classificador Graph.
 */
export function conservativeStatusAfterStartedGraph(graphOutcomeKind) {
  if (!NON_DEFINITIVE_GRAPH_OUTCOMES.includes(graphOutcomeKind)) return null;
  return OUTBOUND_AUDIO_STATUS.UNKNOWN;
}

/**
 * Decide o replay HTTP de uma operação já persistida.
 * completed + identidade igual → 200 idempotente (sem escrita).
 * Identidade divergente, inclusive completed → 409 operation_conflict.
 */
export function resolveExistingOperationDecision(stored, incomingIdentity) {
  const identity = compareOperationIdentity(stored, incomingIdentity);
  if (!identity.ok || identity.equal !== true) {
    return {
      mayClaim: false,
      mayCallGraph: false,
      mayResumeLocal: false,
      httpStatus: 409,
      body: { ok: false, error: 'operation_conflict' },
    };
  }

  const classified = classifyOperationStatus(stored?.status);

  if (classified.status === OUTBOUND_AUDIO_STATUS.CREATED) {
    return {
      mayClaim: true,
      mayCallGraph: false,
      mayResumeLocal: false,
      httpStatus: null,
      body: null,
    };
  }

  if (classified.status === OUTBOUND_AUDIO_STATUS.GRAPH_IN_FLIGHT) {
    return {
      mayClaim: false,
      mayCallGraph: false,
      mayResumeLocal: false,
      httpStatus: 409,
      body: { ok: false, error: 'operation_in_progress' },
    };
  }

  if (classified.status === OUTBOUND_AUDIO_STATUS.GRAPH_ACCEPTED) {
    return {
      mayClaim: false,
      mayCallGraph: false,
      mayResumeLocal: true,
      httpStatus: null,
      body: null,
    };
  }

  if (classified.status === OUTBOUND_AUDIO_STATUS.COMPLETED) {
    return {
      mayClaim: false,
      mayCallGraph: false,
      mayResumeLocal: false,
      httpStatus: 200,
      body: { ok: true },
    };
  }

  if (classified.status === OUTBOUND_AUDIO_STATUS.FAILED) {
    return {
      mayClaim: false,
      mayCallGraph: false,
      mayResumeLocal: false,
      httpStatus: 409,
      body: { ok: false, error: 'operation_failed' },
    };
  }

  if (classified.status === OUTBOUND_AUDIO_STATUS.UNKNOWN) {
    return {
      mayClaim: false,
      mayCallGraph: false,
      mayResumeLocal: false,
      httpStatus: 409,
      body: { ok: false, error: 'operation_unknown' },
    };
  }

  return {
    mayClaim: false,
    mayCallGraph: false,
    mayResumeLocal: false,
    httpStatus: 409,
    body: { ok: false, error: 'operation_conflict' },
  };
}

export const INVALID_OPERATION_ID_RESPONSE = Object.freeze({
  httpStatus: 400,
  body: Object.freeze({ ok: false, error: 'invalid_operation_id' }),
});
