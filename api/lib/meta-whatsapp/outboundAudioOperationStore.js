// =============================================================================
// outboundAudioOperationStore.js — Acesso a meta_outbound_audio_operations
// (B3.2-C.3-C.2 / C.3-D.2)
//
// Sem Graph, S3, filesystem ou mint de operation_id.
// Toda leitura/escrita filtra company_id. Nunca SELECT só por operation_id.
// Transições: UPDATE condicional por status de origem. Sem upsert.
// HTTP send-audio NÃO chama as transições desta etapa.
// =============================================================================

import { isValidGraphWamid } from './graphAudioOutcome.js';
import {
  OUTBOUND_AUDIO_STATUS,
  compareOperationIdentity,
  isAllowedTransition,
  isUuid,
  parseOperationId,
} from './outboundAudioOperation.js';

export const META_OUTBOUND_AUDIO_OPERATIONS_TABLE = 'meta_outbound_audio_operations';

const OPERATION_COLUMNS = [
  'company_id',
  'operation_id',
  'user_id',
  'instance_id',
  'conversation_id',
  'audio_sha256',
  'status',
  'wamid',
  's3_key',
  'graph_started_at',
  'completed_at',
  'error_code',
].join(', ');

const IMMUTABLE_IDENTITY_KEYS = Object.freeze([
  'company_id',
  'operation_id',
  'user_id',
  'instance_id',
  'conversation_id',
  'audio_sha256',
]);

const ISO_TZ_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (!ISO_TZ_RE.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function canonicalOperationId(value) {
  const parsed = parseOperationId(value);
  return parsed.ok ? parsed.operationId : null;
}

function readAuthorizedPair(companyId, operationId) {
  if (!isUuid(companyId)) return null;
  const canonical = canonicalOperationId(operationId);
  if (!canonical) return null;
  return { companyId, operationId: canonical };
}

function readInsertIdentity(input) {
  const compared = compareOperationIdentity(input, input);
  if (!compared.ok || compared.equal !== true) return null;
  const operationId = canonicalOperationId(input.operation_id);
  if (!operationId) return null;
  return {
    company_id: input.company_id,
    operation_id: operationId,
    user_id: input.user_id,
    instance_id: input.instance_id,
    conversation_id: input.conversation_id,
    audio_sha256: input.audio_sha256,
  };
}

export async function selectByCompanyOperation(svc, { companyId, operationId } = {}) {
  const pair = readAuthorizedPair(companyId, operationId);
  if (!pair || !svc || typeof svc.from !== 'function') {
    return { ok: false, reason: 'invalid_identity' };
  }

  const { data, error } = await svc
    .from(META_OUTBOUND_AUDIO_OPERATIONS_TABLE)
    .select(OPERATION_COLUMNS)
    .eq('company_id', pair.companyId)
    .eq('operation_id', pair.operationId)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: 'db_error' };
  }
  if (!data) {
    return { ok: false, reason: 'not_found' };
  }
  return { ok: true, row: data };
}

export async function insertCreated(svc, identity) {
  const row = readInsertIdentity(identity);
  if (!row || !svc || typeof svc.from !== 'function') {
    return { ok: false, reason: 'invalid_identity' };
  }

  const { data, error } = await svc
    .from(META_OUTBOUND_AUDIO_OPERATIONS_TABLE)
    .insert({ ...row, status: 'created' })
    .select(OPERATION_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return { ok: false, reason: 'unique_violation' };
    }
    return { ok: false, reason: 'db_error' };
  }
  if (!data) {
    return { ok: false, reason: 'db_error' };
  }
  return { ok: true, row: data };
}

export async function claimCreatedToGraphInFlight(
  svc,
  { companyId, operationId, graphStartedAt } = {},
) {
  const pair = readAuthorizedPair(companyId, operationId);
  if (!pair || !svc || typeof svc.from !== 'function') {
    return { ok: false, reason: 'invalid_identity' };
  }
  if (!isIsoTimestamp(graphStartedAt)) {
    return { ok: false, reason: 'invalid_started_at' };
  }

  const { data, error } = await svc
    .from(META_OUTBOUND_AUDIO_OPERATIONS_TABLE)
    .update({
      status: 'graph_in_flight',
      graph_started_at: graphStartedAt,
    })
    .eq('company_id', pair.companyId)
    .eq('operation_id', pair.operationId)
    .eq('status', 'created')
    .select(OPERATION_COLUMNS)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: 'db_error' };
  }
  if (!data) {
    return { ok: false, reason: 'not_claimed' };
  }
  return { ok: true, row: data };
}

function isNonBlankText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isSafeErrorCode(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

function patchTouchesIdentity(patch) {
  return IMMUTABLE_IDENTITY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(patch, key));
}

async function updateIfCurrentStatus(svc, { companyId, operationId }, fromStatus, patch) {
  const pair = readAuthorizedPair(companyId, operationId);
  if (!pair || !svc || typeof svc.from !== 'function') {
    return { ok: false, reason: 'invalid_input' };
  }
  if (!isAllowedTransition(fromStatus, patch.status) || patchTouchesIdentity(patch)) {
    return { ok: false, reason: 'invalid_input' };
  }

  const { data, error } = await svc
    .from(META_OUTBOUND_AUDIO_OPERATIONS_TABLE)
    .update(patch)
    .eq('company_id', pair.companyId)
    .eq('operation_id', pair.operationId)
    .eq('status', fromStatus)
    .select(OPERATION_COLUMNS)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: 'db_error' };
  }
  if (!data) {
    return { ok: false, reason: 'not_transitioned' };
  }
  return { ok: true, row: data };
}

/**
 * graph_in_flight → unknown.
 * Preserva graph_started_at. Não grava wamid. Zero linhas ≠ unknown.
 */
export async function markUnknown(svc, { companyId, operationId } = {}) {
  return updateIfCurrentStatus(
    svc,
    { companyId, operationId },
    OUTBOUND_AUDIO_STATUS.GRAPH_IN_FLIGHT,
    { status: OUTBOUND_AUDIO_STATUS.UNKNOWN },
  );
}

/**
 * graph_in_flight → graph_accepted.
 * wamid vem do resultado validado da primitiva de envio, nunca do formulário HTTP.
 * Preserva graph_started_at. Falha de UPDATE não afirma aceite persistido.
 */
export async function markGraphAccepted(svc, { companyId, operationId, wamid } = {}) {
  if (!isValidGraphWamid(wamid)) {
    return { ok: false, reason: 'invalid_input' };
  }
  return updateIfCurrentStatus(
    svc,
    { companyId, operationId },
    OUTBOUND_AUDIO_STATUS.GRAPH_IN_FLIGHT,
    {
      status: OUTBOUND_AUDIO_STATUS.GRAPH_ACCEPTED,
      wamid,
    },
  );
}

/**
 * graph_accepted → completed.
 * O orquestrador futuro deve comprovar S3, company_media_library,
 * meta_whatsapp_messages e meta_messages ANTES desta chamada.
 * Esta função não consulta essas dependências.
 * Preserva wamid e graph_started_at.
 */
export async function markCompleted(
  svc,
  { companyId, operationId, s3Key, completedAt } = {},
) {
  if (!isNonBlankText(s3Key) || !isIsoTimestamp(completedAt)) {
    return { ok: false, reason: 'invalid_input' };
  }
  return updateIfCurrentStatus(
    svc,
    { companyId, operationId },
    OUTBOUND_AUDIO_STATUS.GRAPH_ACCEPTED,
    {
      status: OUTBOUND_AUDIO_STATUS.COMPLETED,
      s3_key: s3Key,
      completed_at: completedAt,
    },
  );
}

/**
 * created → failed. Somente pré-claim.
 * Não usar para erros Graph. Exige evidência definitiva do orquestrador;
 * este store não a infere (canAutomaticallyClassifyAsFailed é sempre false).
 */
export async function markFailedBeforeClaim(
  svc,
  { companyId, operationId, definitiveFailureEvidence, errorCode } = {},
) {
  if (definitiveFailureEvidence !== true) {
    return { ok: false, reason: 'invalid_input' };
  }
  const patch = { status: OUTBOUND_AUDIO_STATUS.FAILED };
  if (errorCode !== undefined) {
    if (!isSafeErrorCode(errorCode)) {
      return { ok: false, reason: 'invalid_input' };
    }
    patch.error_code = errorCode;
  }
  return updateIfCurrentStatus(
    svc,
    { companyId, operationId },
    OUTBOUND_AUDIO_STATUS.CREATED,
    patch,
  );
}
