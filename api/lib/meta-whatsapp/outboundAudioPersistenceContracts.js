// =============================================================================
// outboundAudioPersistenceContracts.js — Contratos puros de persistência
// outbound Meta (B3.2-C.3-D.3-E.2-B.3)
//
// Constrói e compara registros de company_media_library,
// meta_whatsapp_messages e meta_messages após graph_accepted.
// Sem Supabase, AWS SDK, Graph Client, process.env, rede, relógio implícito
// (Date.now) ou mutação dos objetos recebidos.
// =============================================================================

import { META_OUTBOUND_AUDIO_MAX_BYTES } from './audioBytes.js';
import { isValidGraphWamid } from './graphAudioOutcome.js';
import {
  isAudioSha256,
  isUuid,
  parseOperationId,
} from './outboundAudioOperation.js';

export const OUTBOUND_AUDIO_SOURCE_REF_PREFIX = 'meta-outbound:';
export const OUTBOUND_AUDIO_CML_FOLDER_PATH = '/';
export const OUTBOUND_AUDIO_CML_FILENAME = 'audio.m4a';
export const OUTBOUND_AUDIO_CML_FILE_TYPE = 'audio';
export const OUTBOUND_AUDIO_CML_MIME_TYPE = 'audio/mp4';
export const OUTBOUND_AUDIO_S3_KEY_INFIX = 'meta-outbound';
export const OUTBOUND_AUDIO_TRACKING_STATUS = 'accepted';
export const OUTBOUND_AUDIO_CHAT_DIRECTION = 'outbound';
export const OUTBOUND_AUDIO_CHAT_MESSAGE_TYPE = 'audio';

export const PERSIST_COMPARE = Object.freeze({
  MATCH: 'match',
  CONFLICT: 'conflict',
  INDETERMINATE: 'indeterminate',
});

const ISO_TZ_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(reason) {
  return { ok: false, error: 'invalid_input', reason };
}

function compared(result, reason) {
  return { result, reason };
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (!ISO_TZ_RE.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function isPositiveAudioSize(value) {
  return (
    typeof value === 'number'
    && Number.isInteger(value)
    && Number.isFinite(value)
    && value > 0
    && value <= META_OUTBOUND_AUDIO_MAX_BYTES
  );
}

function expectedS3Key(companyId, operationId) {
  if (typeof companyId !== 'string' || !isUuid(companyId)) return null;
  const parsed = parseOperationId(operationId);
  if (!parsed.ok) return null;
  return (
    `clientes/${companyId.toLowerCase()}/${OUTBOUND_AUDIO_S3_KEY_INFIX}`
    + `/${parsed.operationId}/${OUTBOUND_AUDIO_CML_FILENAME}`
  );
}

function missingAny(source, keys) {
  if (!isPlainObject(source)) return true;
  for (const key of keys) {
    if (!(key in source) || source[key] === undefined) return true;
  }
  return false;
}

/**
 * @param {unknown} operationId
 * @returns {{ ok: true, sourceRef: string, operationId: string } | { ok: false, error: string, reason: string }}
 */
export function buildMetaOutboundAudioSourceRef(operationId) {
  const parsed = parseOperationId(operationId);
  if (!parsed.ok) return invalid('invalid_operation_id');
  return {
    ok: true,
    sourceRef: `${OUTBOUND_AUDIO_SOURCE_REF_PREFIX}${parsed.operationId}`,
    operationId: parsed.operationId,
  };
}

function readCmlContext(input) {
  if (!isPlainObject(input)) return invalid('missing_required_field');
  const { companyId, operationId, audioSha256, s3Key, audioSizeBytes } = input;
  if (typeof companyId !== 'string' || !isUuid(companyId)) {
    return invalid('invalid_company_id');
  }
  const parsed = parseOperationId(operationId);
  if (!parsed.ok) return invalid('invalid_operation_id');
  if (!isAudioSha256(audioSha256)) return invalid('invalid_audio_sha256');
  if (!isPositiveAudioSize(audioSizeBytes)) return invalid('invalid_audio_size');
  const objectKey = expectedS3Key(companyId, parsed.operationId);
  if (typeof s3Key !== 'string' || s3Key !== objectKey) {
    return invalid('invalid_s3_key');
  }
  const source = buildMetaOutboundAudioSourceRef(parsed.operationId);
  if (!source.ok) return source;
  return {
    ok: true,
    companyId,
    operationId: parsed.operationId,
    s3Key: objectKey,
    audioSizeBytes,
    sourceRef: source.sourceRef,
  };
}

/**
 * @returns {{ ok: true, row: object } | { ok: false, error: string, reason: string }}
 */
export function buildOutboundAudioMediaLibraryInsert(context) {
  const read = readCmlContext(context);
  if (!read.ok) return read;
  return {
    ok: true,
    row: Object.freeze({
      company_id: read.companyId,
      folder_path: OUTBOUND_AUDIO_CML_FOLDER_PATH,
      original_filename: OUTBOUND_AUDIO_CML_FILENAME,
      s3_key: read.s3Key,
      file_type: OUTBOUND_AUDIO_CML_FILE_TYPE,
      mime_type: OUTBOUND_AUDIO_CML_MIME_TYPE,
      file_size: read.audioSizeBytes,
      preview_url: null,
      created_by: null,
      source_ref: read.sourceRef,
    }),
  };
}

export function compareOutboundAudioMediaLibrary(existing, expected) {
  if (!isPlainObject(existing) || !isPlainObject(expected)) {
    return compared(PERSIST_COMPARE.INDETERMINATE, 'missing_required_field');
  }
  const required = [
    'company_id',
    'source_ref',
    's3_key',
    'file_type',
    'mime_type',
    'file_size',
  ];
  if (missingAny(existing, required) || missingAny(expected, required)) {
    return compared(PERSIST_COMPARE.INDETERMINATE, 'missing_required_field');
  }
  if (existing.company_id !== expected.company_id) {
    return compared(PERSIST_COMPARE.CONFLICT, 'company_mismatch');
  }
  if (existing.source_ref !== expected.source_ref) {
    return compared(PERSIST_COMPARE.CONFLICT, 'source_ref_mismatch');
  }
  if (existing.s3_key !== expected.s3_key) {
    return compared(PERSIST_COMPARE.CONFLICT, 's3_key_mismatch');
  }
  if (
    existing.file_type !== expected.file_type
    || existing.mime_type !== expected.mime_type
    || existing.file_size !== expected.file_size
  ) {
    return compared(PERSIST_COMPARE.CONFLICT, 'media_metadata_mismatch');
  }
  return compared(PERSIST_COMPARE.MATCH, 'identity_match');
}

function readTrackingContext(input) {
  if (!isPlainObject(input)) return invalid('missing_required_field');
  const { companyId, instanceId, wamid } = input;
  if (typeof companyId !== 'string' || !isUuid(companyId)) {
    return invalid('invalid_company_id');
  }
  if (typeof instanceId !== 'string' || !isUuid(instanceId)) {
    return invalid('invalid_instance_id');
  }
  if (!isValidGraphWamid(wamid)) return invalid('invalid_wamid');
  return { ok: true, companyId, instanceId, wamid };
}

export function buildOutboundAudioTrackingInsert(context) {
  const read = readTrackingContext(context);
  if (!read.ok) return read;
  return {
    ok: true,
    row: Object.freeze({
      company_id: read.companyId,
      instance_id: read.instanceId,
      meta_message_id: read.wamid,
      status: OUTBOUND_AUDIO_TRACKING_STATUS,
    }),
  };
}

export function compareOutboundAudioTracking(existing, expected) {
  if (!isPlainObject(existing) || !isPlainObject(expected)) {
    return compared(PERSIST_COMPARE.INDETERMINATE, 'missing_required_field');
  }
  const required = ['company_id', 'instance_id', 'meta_message_id'];
  if (missingAny(existing, required) || missingAny(expected, required)) {
    return compared(PERSIST_COMPARE.INDETERMINATE, 'missing_required_field');
  }
  if (existing.company_id !== expected.company_id) {
    return compared(PERSIST_COMPARE.CONFLICT, 'company_mismatch');
  }
  if (existing.instance_id !== expected.instance_id) {
    return compared(PERSIST_COMPARE.CONFLICT, 'instance_mismatch');
  }
  if (existing.meta_message_id !== expected.meta_message_id) {
    return compared(PERSIST_COMPARE.CONFLICT, 'wamid_mismatch');
  }
  return compared(PERSIST_COMPARE.MATCH, 'identity_match');
}

function readChatContext(input) {
  if (!isPlainObject(input)) return invalid('missing_required_field');
  const {
    companyId,
    instanceId,
    conversationId,
    wamid,
    mediaAssetId,
    providerTimestamp,
  } = input;
  if (typeof companyId !== 'string' || !isUuid(companyId)) {
    return invalid('invalid_company_id');
  }
  if (typeof instanceId !== 'string' || !isUuid(instanceId)) {
    return invalid('invalid_instance_id');
  }
  if (typeof conversationId !== 'string' || !isUuid(conversationId)) {
    return invalid('invalid_conversation_id');
  }
  if (!isValidGraphWamid(wamid)) return invalid('invalid_wamid');
  if (typeof mediaAssetId !== 'string' || !isUuid(mediaAssetId)) {
    return invalid('invalid_media_asset_id');
  }
  if (!isIsoTimestamp(providerTimestamp)) {
    return invalid('invalid_provider_timestamp');
  }
  return {
    ok: true,
    companyId,
    instanceId,
    conversationId,
    wamid,
    mediaAssetId,
    providerTimestamp,
  };
}

export function buildOutboundAudioChatInsert(context) {
  const read = readChatContext(context);
  if (!read.ok) return read;
  return {
    ok: true,
    row: Object.freeze({
      company_id: read.companyId,
      instance_id: read.instanceId,
      conversation_id: read.conversationId,
      meta_message_id: read.wamid,
      direction: OUTBOUND_AUDIO_CHAT_DIRECTION,
      message_type: OUTBOUND_AUDIO_CHAT_MESSAGE_TYPE,
      body: null,
      media_asset_id: read.mediaAssetId,
      provider_timestamp: read.providerTimestamp,
    }),
  };
}

function isCompatibleOutboundAudioBody(value) {
  return value == null;
}

export function compareOutboundAudioChat(existing, expected) {
  if (!isPlainObject(existing) || !isPlainObject(expected)) {
    return compared(PERSIST_COMPARE.INDETERMINATE, 'missing_required_field');
  }
  const required = [
    'company_id',
    'instance_id',
    'conversation_id',
    'meta_message_id',
    'direction',
    'message_type',
    'media_asset_id',
  ];
  if (missingAny(existing, required) || missingAny(expected, required)) {
    return compared(PERSIST_COMPARE.INDETERMINATE, 'missing_required_field');
  }
  if (existing.company_id !== expected.company_id) {
    return compared(PERSIST_COMPARE.CONFLICT, 'company_mismatch');
  }
  if (existing.instance_id !== expected.instance_id) {
    return compared(PERSIST_COMPARE.CONFLICT, 'instance_mismatch');
  }
  if (existing.conversation_id !== expected.conversation_id) {
    return compared(PERSIST_COMPARE.CONFLICT, 'conversation_mismatch');
  }
  if (existing.meta_message_id !== expected.meta_message_id) {
    return compared(PERSIST_COMPARE.CONFLICT, 'wamid_mismatch');
  }
  if (existing.direction !== expected.direction) {
    return compared(PERSIST_COMPARE.CONFLICT, 'direction_mismatch');
  }
  if (existing.message_type !== expected.message_type) {
    return compared(PERSIST_COMPARE.CONFLICT, 'message_type_mismatch');
  }
  if (existing.media_asset_id !== expected.media_asset_id) {
    return compared(PERSIST_COMPARE.CONFLICT, 'asset_mismatch');
  }
  if (!isCompatibleOutboundAudioBody(existing.body)) {
    return compared(PERSIST_COMPARE.CONFLICT, 'media_metadata_mismatch');
  }
  return compared(PERSIST_COMPARE.MATCH, 'identity_match');
}
