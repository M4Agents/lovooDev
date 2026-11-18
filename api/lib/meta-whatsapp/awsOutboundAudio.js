// =============================================================================
// awsOutboundAudio.js — Helper isolado S3 para áudio outbound Meta
// (B3.2-C.3-D.3-E.2-B.1)
//
// Gera key determinística e faz PutObject condicional (IfNoneMatch: '*').
// Cliente S3 e bucket são injetados. Sem Graph, SQL, HTTP, credenciais Meta,
// process.env, S3Client global ou atualização de operação.
// 412/409 → HeadObject para confirmar idempotência. Sem retry de PutObject.
// =============================================================================

import { createHash } from 'node:crypto';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  META_OUTBOUND_AUDIO_MAX_BYTES,
  validateMetaOutboundAudioBytes,
} from './audioBytes.js';
import {
  isAudioSha256,
  isUuid,
  parseOperationId,
} from './outboundAudioOperation.js';

export const META_OUTBOUND_AUDIO_S3_CONTENT_TYPE = 'audio/mp4';
export const META_OUTBOUND_AUDIO_S3_FILENAME = 'audio.m4a';
export const META_OUTBOUND_AUDIO_S3_KEY_INFIX = 'meta-outbound';

const ERR_INVALID = 'invalid_input';
const ERR_TOO_LARGE = 'audio_too_large';
const ERR_AUDIO = 'invalid_audio';
const ERR_CONFLICT = 'aws_upload_conflict';
const ERR_INDETERMINATE = 'aws_upload_indeterminate';
const ERR_TRANSIENT = 'aws_upload_transient';
const ERR_FAILED = 'aws_upload_failed';

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_NAMES = new Set([
  'TimeoutError',
  'Throttling',
  'ThrottlingException',
  'SlowDown',
  'ServiceUnavailable',
  'InternalError',
  'RequestTimeout',
  'ProvisionedThroughputExceededException',
  'NetworkingError',
]);

function failed(error, extra) {
  return extra ? { ok: false, error, ...extra } : { ok: false, error };
}

function isUnsafePathPart(value) {
  return (
    value.includes('..')
    || value.includes('/')
    || value.includes('\\')
    || value.includes('\0')
    || value.includes('//')
    || /%2e%2e/i.test(value)
  );
}

function isTransientAwsError(err) {
  const status = err?.$metadata?.httpStatusCode;
  if (typeof status === 'number' && TRANSIENT_STATUS.has(status)) return true;
  const name = String(err?.name ?? err?.Code ?? err?.code ?? '');
  if (TRANSIENT_NAMES.has(name)) return true;
  const msg = String(err?.message ?? '');
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(msg);
}

function isConditionalWriteConflict(err) {
  const status = err?.$metadata?.httpStatusCode;
  const name = String(err?.name ?? err?.Code ?? err?.code ?? '');
  if (status === 412 || name === 'PreconditionFailed') return true;
  if (status === 409 || name === 'ConditionalRequestConflict') return true;
  return false;
}

function readMetadata(head) {
  const meta = head?.Metadata;
  if (meta == null || typeof meta !== 'object' || Array.isArray(meta)) return null;
  return meta;
}

function metadataValue(meta, key) {
  if (typeof meta[key] === 'string') return meta[key];
  const found = Object.keys(meta).find((name) => name.toLowerCase() === key);
  return typeof found === 'string' ? meta[found] : null;
}

function classifyExistingObject({ head, companyId, operationId, audioSha256, sizeBytes }) {
  if (head == null || typeof head !== 'object') {
    return { confirmed: false, reason: 'missing_head' };
  }
  const meta = readMetadata(head);
  if (!meta) return { confirmed: false, reason: 'missing_metadata' };

  const sha = metadataValue(meta, 'audio-sha256');
  const storedOperationId = metadataValue(meta, 'operation-id');
  const storedCompanyId = metadataValue(meta, 'company-id');
  if (!isAudioSha256(sha) || typeof storedOperationId !== 'string' || typeof storedCompanyId !== 'string') {
    return { confirmed: false, reason: 'missing_metadata' };
  }

  if (sha !== audioSha256) return { confirmed: false, reason: 'hash_mismatch' };
  const parsedStoredOp = parseOperationId(storedOperationId);
  if (!parsedStoredOp.ok || parsedStoredOp.operationId !== operationId) {
    return { confirmed: false, reason: 'identity_mismatch' };
  }
  if (!isUuid(storedCompanyId) || storedCompanyId.toLowerCase() !== companyId) {
    return { confirmed: false, reason: 'identity_mismatch' };
  }
  if (Number(head.ContentLength) !== sizeBytes) {
    return { confirmed: false, reason: 'size_mismatch' };
  }
  if (head.ContentType !== META_OUTBOUND_AUDIO_S3_CONTENT_TYPE) {
    return { confirmed: false, reason: 'content_type_mismatch' };
  }
  return { confirmed: true };
}

function isAacLc(validation) {
  return (
    validation?.ok === true
    && validation.audioCodec === 'aac'
    && validation.aacProfile === 'lc'
  );
}

/**
 * @param {{ companyId: unknown, operationId: unknown }} input
 * @returns {{ ok: true, objectKey: string, companyId: string, operationId: string } | { ok: false, error: 'invalid_input' }}
 */
export function buildMetaOutboundAudioS3Key({ companyId, operationId } = {}) {
  if (typeof companyId !== 'string' || !isUuid(companyId) || isUnsafePathPart(companyId)) {
    return failed(ERR_INVALID);
  }
  if (typeof operationId !== 'string' || isUnsafePathPart(operationId)) {
    return failed(ERR_INVALID);
  }
  const parsed = parseOperationId(operationId);
  if (!parsed.ok) return failed(ERR_INVALID);

  const canonicalCompanyId = companyId.toLowerCase();
  const objectKey =
    `clientes/${canonicalCompanyId}/${META_OUTBOUND_AUDIO_S3_KEY_INFIX}`
    + `/${parsed.operationId}/${META_OUTBOUND_AUDIO_S3_FILENAME}`;

  if (
    objectKey.includes('..')
    || objectKey.includes('\\')
    || objectKey.includes('\0')
    || objectKey.includes('//')
  ) {
    return failed(ERR_INVALID);
  }

  return {
    ok: true,
    objectKey,
    companyId: canonicalCompanyId,
    operationId: parsed.operationId,
  };
}

function validateUploadInput({
  companyId,
  operationId,
  audioBytes,
  audioSha256,
  s3Client,
  bucket,
}) {
  if (s3Client == null || typeof s3Client.send !== 'function') return failed(ERR_INVALID);
  if (typeof bucket !== 'string' || bucket.trim().length === 0) return failed(ERR_INVALID);

  const key = buildMetaOutboundAudioS3Key({ companyId, operationId });
  if (!key.ok) return key;

  if (!Buffer.isBuffer(audioBytes)) return failed(ERR_INVALID);
  if (audioBytes.length === 0) return failed(ERR_INVALID);
  if (audioBytes.length > META_OUTBOUND_AUDIO_MAX_BYTES) return failed(ERR_TOO_LARGE);

  if (!isAudioSha256(audioSha256)) return failed(ERR_INVALID);
  const digest = createHash('sha256').update(audioBytes).digest('hex');
  if (digest !== audioSha256) return failed(ERR_INVALID);

  const validation = validateMetaOutboundAudioBytes(audioBytes);
  if (validation.ok !== true) {
    if (validation.code === 'audio_too_large') return failed(ERR_TOO_LARGE);
    return failed(ERR_AUDIO);
  }
  if (!isAacLc(validation)) return failed(ERR_AUDIO);

  return {
    ok: true,
    companyId: key.companyId,
    operationId: key.operationId,
    objectKey: key.objectKey,
    audioBytes,
    audioSha256,
    bucket: bucket.trim(),
    s3Client,
  };
}

async function confirmExistingObject(input) {
  const command = new HeadObjectCommand({
    Bucket: input.bucket,
    Key: input.objectKey,
  });

  let head;
  try {
    head = await input.s3Client.send(command);
  } catch {
    return failed(ERR_INDETERMINATE, { objectKey: input.objectKey });
  }

  const classified = classifyExistingObject({
    head,
    companyId: input.companyId,
    operationId: input.operationId,
    audioSha256: input.audioSha256,
    sizeBytes: input.audioBytes.length,
  });
  if (classified.confirmed) {
    return {
      ok: true,
      idempotent: true,
      objectKey: input.objectKey,
      contentType: META_OUTBOUND_AUDIO_S3_CONTENT_TYPE,
      sizeBytes: input.audioBytes.length,
    };
  }
  if (
    classified.reason === 'hash_mismatch'
    || classified.reason === 'size_mismatch'
    || classified.reason === 'content_type_mismatch'
    || classified.reason === 'identity_mismatch'
  ) {
    return failed(ERR_CONFLICT, { objectKey: input.objectKey });
  }
  return failed(ERR_INDETERMINATE, { objectKey: input.objectKey });
}

/**
 * Upload condicional de áudio outbound Meta.
 * Não consulta banco, Graph, HTTP ou credenciais. Sem retry automático.
 *
 * @param {object} params
 * @param {string} params.companyId
 * @param {string} params.operationId
 * @param {Buffer} params.audioBytes
 * @param {string} params.audioSha256
 * @param {{ send: Function }} params.s3Client
 * @param {string} params.bucket
 */
export async function uploadMetaOutboundAudio(params = {}) {
  const input = validateUploadInput(params);
  if (!input.ok) return input;

  const command = new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.objectKey,
    Body: input.audioBytes,
    ContentType: META_OUTBOUND_AUDIO_S3_CONTENT_TYPE,
    IfNoneMatch: '*',
    Metadata: {
      'audio-sha256': input.audioSha256,
      'operation-id': input.operationId,
      'company-id': input.companyId,
    },
  });

  try {
    await input.s3Client.send(command);
  } catch (err) {
    if (isConditionalWriteConflict(err)) {
      return confirmExistingObject(input);
    }
    if (isTransientAwsError(err)) {
      return failed(ERR_TRANSIENT, { objectKey: input.objectKey });
    }
    return failed(ERR_FAILED, { objectKey: input.objectKey });
  }

  return {
    ok: true,
    idempotent: false,
    objectKey: input.objectKey,
    contentType: META_OUTBOUND_AUDIO_S3_CONTENT_TYPE,
    sizeBytes: input.audioBytes.length,
  };
}
