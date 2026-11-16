// =============================================================================
// awsUpload.js — Helper backend AWS S3 para áudio inbound Meta (MVP5.B3.2.AWS-1)
//
// Responsabilidade:
//   1. Upload de bytes já validados (PutObject).
//   2. Signed URL verdadeira de GetObject (TTL 3600s).
//   3. DeleteObject de UMA key autorizada (cleanup).
//
// NÃO faz: download Graph, INSERT em banco, HTTP 200/500, skip permanente,
//          DTO público, allowlist Storage, integração com processor/GET.
//
// Credenciais: mesmo padrão de awsDownload.js —
//   RPC webhook_resolve_aws_credentials(p_company_id) por request.
//   Sem singleton, sem IAM global de env, sem src/services/aws, sem Vite.
//
// SEGURANÇA:
//   - companyId UUID validado (nunca payload Meta).
//   - Object key gerada/autorizada somente em
//     clientes/{companyId}/meta-inbound/{uuid}/{filename}
//   - Rejeita prefixo Uazapi (whatsapp/), outro tenant, traversal, URL.
//   - Sem ACL pública. Sem URL pública. Sem signed URL persistida.
//   - Credenciais, signed URLs e keys NUNCA em logs nem em mensagens de erro.
// =============================================================================

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UUID_RE, MIME_TO_MEDIA_TYPE } from './mediaConstants.js';

// =============================================================================
// Constantes públicas
// =============================================================================

/** TTL explícito da signed URL GetObject. Consumido pelo GET na etapa AWS-2. */
export const SIGNED_URL_TTL_SECONDS = 3600;

const KEY_INFIX = 'meta-inbound';
const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,198}$/;
const MAX_FILENAME_LEN = 200;
/** Teto defensivo local — não altera MEDIA_SIZE_LIMITS do processor. */
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

const ERR_INVALID    = 'aws_upload_invalid_input';
const ERR_CREDS      = 'aws_credentials_unavailable';
const ERR_CONFLICT   = 'aws_upload_conflict';
const ERR_UP_TRANS   = 'aws_upload_transient';
const ERR_UP_FAIL    = 'aws_upload_failed';
const ERR_SIGN_TRANS = 'aws_sign_transient';
const ERR_SIGN_FAIL  = 'aws_sign_failed';
const ERR_DEL_TRANS  = 'aws_delete_transient';
const ERR_DEL_FAIL   = 'aws_delete_failed';

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

// =============================================================================
// Helpers privados
// =============================================================================

/**
 * Error com `code` determinístico. Mensagem NUNCA inclui secrets, keys ou URLs.
 * @param {string} code
 * @param {string} message
 * @returns {Error & { code: string }}
 */
function makeError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isTransientAwsError(err) {
  const status = err?.$metadata?.httpStatusCode;
  if (typeof status === 'number' && TRANSIENT_STATUS.has(status)) return true;

  const name = String(err?.name ?? err?.Code ?? err?.code ?? '');
  if (TRANSIENT_NAMES.has(name)) return true;

  const msg = String(err?.message ?? '');
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(msg);
}

/**
 * PutObject condicional (IfNoneMatch: '*') — objeto já existe.
 * 412 PreconditionFailed e 409 ConditionalRequestConflict NÃO são sucesso
 * e NÃO autorizam DeleteObject.
 * @param {unknown} err
 * @returns {boolean}
 */
function isConditionalWriteConflict(err) {
  const status = err?.$metadata?.httpStatusCode;
  const name = String(err?.name ?? err?.Code ?? err?.code ?? '');
  if (status === 412 || name === 'PreconditionFailed') return true;
  if (status === 409 || name === 'ConditionalRequestConflict') return true;
  return false;
}

function assertCompanyId(companyId) {
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) {
    throw makeError(ERR_INVALID, 'awsUpload: companyId inválido');
  }
}

function assertObjectId(objectId) {
  if (typeof objectId !== 'string' || !UUID_RE.test(objectId)) {
    throw makeError(ERR_INVALID, 'awsUpload: objectId inválido');
  }
}

/**
 * Filename de um único segmento — sem path, traversal ou caracteres inesperados.
 * @param {unknown} filename
 * @returns {string}
 */
function assertSafeFilename(filename) {
  if (typeof filename !== 'string') {
    throw makeError(ERR_INVALID, 'awsUpload: filename inválido');
  }
  const name = filename.trim();
  if (
    name.length === 0 ||
    name.length > MAX_FILENAME_LEN ||
    name === '.' ||
    name === '..' ||
    name.includes('..') ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    !FILENAME_RE.test(name)
  ) {
    throw makeError(ERR_INVALID, 'awsUpload: filename inválido');
  }
  return name;
}

/**
 * MIME detectado pelos bytes. Aceita parâmetros (ex.: codecs=opus).
 * Autoridade de tipo: MIME_TO_MEDIA_TYPE → AUDIO.
 * @param {unknown} mimeType
 * @returns {string} valor original (preserva parâmetros)
 */
function assertAudioMime(mimeType) {
  if (typeof mimeType !== 'string' || mimeType.trim().length === 0) {
    throw makeError(ERR_INVALID, 'awsUpload: mimeType inválido');
  }
  if (/[\r\n]/.test(mimeType)) {
    throw makeError(ERR_INVALID, 'awsUpload: mimeType inválido');
  }
  const raw = mimeType.trim();
  const base = raw.split(';')[0].trim().toLowerCase();
  const mapped = MIME_TO_MEDIA_TYPE.get(raw) ?? MIME_TO_MEDIA_TYPE.get(base);
  if (mapped !== 'AUDIO') {
    throw makeError(ERR_INVALID, 'awsUpload: mimeType inválido');
  }
  return raw;
}

function assertByteLength(length) {
  if (length === 0) {
    throw makeError(ERR_INVALID, 'awsUpload: bytes vazios');
  }
  if (length > MAX_AUDIO_BYTES) {
    throw makeError(ERR_INVALID, 'awsUpload: bytes excedem o limite');
  }
}

/**
 * @param {unknown} bytes
 * @returns {Buffer}
 */
function assertBytes(bytes) {
  if (Buffer.isBuffer(bytes)) {
    assertByteLength(bytes.length);
    return bytes;
  }
  if (bytes instanceof Uint8Array) {
    assertByteLength(bytes.byteLength);
    return Buffer.from(bytes);
  }
  if (bytes instanceof ArrayBuffer) {
    assertByteLength(bytes.byteLength);
    return Buffer.from(bytes);
  }
  throw makeError(ERR_INVALID, 'awsUpload: bytes inválidos');
}

function authorizedPrefix(companyId) {
  return `clientes/${companyId}/${KEY_INFIX}/`;
}

function buildObjectKey(companyId, objectId, filename) {
  return `${authorizedPrefix(companyId)}${objectId}/${filename}`;
}

/**
 * Autoriza UMA key de áudio inbound Meta deste tenant.
 * Rejeita: outro tenant, prefixo Uazapi, URL, traversal, listagem, key incompleta.
 * @param {string} companyId
 * @param {unknown} objectKey
 * @returns {string}
 */
function assertAuthorizedObjectKey(companyId, objectKey) {
  if (typeof objectKey !== 'string' || objectKey.trim().length === 0) {
    throw makeError(ERR_INVALID, 'awsUpload: objectKey inválida');
  }
  const key = objectKey.trim();
  if (
    key.startsWith('http://') ||
    key.startsWith('https://') ||
    key.includes('\\') ||
    key.includes('\0') ||
    key.includes('..') ||
    key.includes('//') ||
    /%2e%2e/i.test(key)
  ) {
    throw makeError(ERR_INVALID, 'awsUpload: objectKey inválida');
  }

  const prefix = authorizedPrefix(companyId);
  if (!key.startsWith(prefix)) {
    throw makeError(ERR_INVALID, 'awsUpload: objectKey inválida');
  }

  const rest = key.slice(prefix.length);
  const parts = rest.split('/');
  if (parts.length !== 2) {
    throw makeError(ERR_INVALID, 'awsUpload: objectKey inválida');
  }

  const [objectId, filename] = parts;
  assertObjectId(objectId);
  assertSafeFilename(filename);
  return key;
}

/**
 * Resolve credenciais por-tenant. Sem fallback IAM de env.
 * Parent/child: somente o que a RPC já implementa.
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @param {string} companyId
 */
async function resolveAwsCredentials(svc, companyId) {
  if (!svc || typeof svc.rpc !== 'function') {
    throw makeError(ERR_INVALID, 'awsUpload: svc inválido');
  }

  const { data: credsRows, error: credsErr } = await svc.rpc(
    'webhook_resolve_aws_credentials',
    { p_company_id: companyId },
  );

  if (credsErr || !credsRows || credsRows.length === 0) {
    throw makeError(ERR_CREDS, 'AWS credentials unavailable for tenant');
  }

  const creds = credsRows[0];
  if (
    typeof creds?.access_key_id !== 'string' ||
    creds.access_key_id.length === 0 ||
    typeof creds?.secret_access_key !== 'string' ||
    creds.secret_access_key.length === 0 ||
    typeof creds?.bucket !== 'string' ||
    creds.bucket.length === 0 ||
    typeof creds?.region !== 'string' ||
    creds.region.length === 0
  ) {
    throw makeError(ERR_CREDS, 'AWS credentials unavailable for tenant');
  }

  return creds;
}

/**
 * S3Client por request — sem cache, sem process.env IAM.
 * @param {{ region: string, access_key_id: string, secret_access_key: string }} creds
 */
function createS3Client(creds) {
  return new S3Client({
    region: creds.region,
    credentials: {
      accessKeyId:     creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    },
    requestChecksumCalculation:  'WHEN_REQUIRED',
    responseChecksumValidation:  'WHEN_REQUIRED',
  });
}

function throwClassified(err, transientCode, failedCode) {
  if (isTransientAwsError(err)) {
    throw makeError(transientCode, 'AWS request transient failure');
  }
  throw makeError(failedCode, 'AWS request failed');
}

// =============================================================================
// API pública
// =============================================================================

/**
 * Envia bytes de áudio inbound Meta para o S3 do tenant.
 * Gera a object key no servidor. Não devolve URL.
 *
 * @param {object} params
 * @param {import('@supabase/supabase-js').SupabaseClient} params.svc
 * @param {string} params.companyId  UUID validado pelo caller (nunca do payload Meta)
 * @param {string} params.objectId   UUID gerado pelo caller server-side
 * @param {Buffer|Uint8Array|ArrayBuffer} params.bytes
 * @param {string} params.mimeType   MIME detectado pelos bytes
 * @param {string} params.filename   um segmento seguro (ex.: inbound.ogg)
 *
 * @returns {Promise<{ objectKey: string, contentType: string, sizeBytes: number }>}
 */
export async function uploadMetaInboundAudio({
  svc,
  companyId,
  objectId,
  bytes,
  mimeType,
  filename,
}) {
  assertCompanyId(companyId);
  assertObjectId(objectId);
  const safeFilename = assertSafeFilename(filename);
  const contentType  = assertAudioMime(mimeType);
  const body         = assertBytes(bytes);

  const objectKey = buildObjectKey(companyId, objectId, safeFilename);
  const creds     = await resolveAwsCredentials(svc, companyId);
  const client    = createS3Client(creds);

  const command = new PutObjectCommand({
    Bucket:       creds.bucket,
    Key:          objectKey,
    Body:         body,
    ContentType:  contentType,
    IfNoneMatch:  '*',
    Metadata: {
      'company-id': companyId,
      'source':     'meta-inbound',
    },
  });

  try {
    await client.send(command);
  } catch (err) {
    if (isConditionalWriteConflict(err)) {
      throw makeError(ERR_CONFLICT, 'AWS object already exists');
    }
    throwClassified(err, ERR_UP_TRANS, ERR_UP_FAIL);
  }

  return {
    objectKey,
    contentType,
    sizeBytes: body.length,
  };
}

/**
 * Signed URL GetObject verdadeira. Não monta URL pública.
 * Key deve pertencer a clientes/{companyId}/meta-inbound/.
 *
 * @param {object} params
 * @param {import('@supabase/supabase-js').SupabaseClient} params.svc
 * @param {string} params.companyId
 * @param {string} params.objectKey
 *
 * @returns {Promise<{ url: string, expiresIn: number }>}
 */
export async function signMetaInboundAudioGetUrl({ svc, companyId, objectKey }) {
  assertCompanyId(companyId);
  const key    = assertAuthorizedObjectKey(companyId, objectKey);
  const creds  = await resolveAwsCredentials(svc, companyId);
  const client = createS3Client(creds);

  const command = new GetObjectCommand({
    Bucket: creds.bucket,
    Key:    key,
  });

  let url;
  try {
    url = await getSignedUrl(client, command, { expiresIn: SIGNED_URL_TTL_SECONDS });
  } catch (err) {
    throwClassified(err, ERR_SIGN_TRANS, ERR_SIGN_FAIL);
  }

  if (typeof url !== 'string' || url.length === 0) {
    throw makeError(ERR_SIGN_FAIL, 'AWS request failed');
  }

  return {
    url,
    expiresIn: SIGNED_URL_TTL_SECONDS,
  };
}

/**
 * Remove UM objeto autorizado. Sem listagem, sem DeleteObjects, sem prefixo.
 *
 * @param {object} params
 * @param {import('@supabase/supabase-js').SupabaseClient} params.svc
 * @param {string} params.companyId
 * @param {string} params.objectKey
 *
 * @returns {Promise<{ objectKey: string }>}
 */
export async function deleteMetaInboundAudioObject({ svc, companyId, objectKey }) {
  assertCompanyId(companyId);
  const key    = assertAuthorizedObjectKey(companyId, objectKey);
  const creds  = await resolveAwsCredentials(svc, companyId);
  const client = createS3Client(creds);

  const command = new DeleteObjectCommand({
    Bucket: creds.bucket,
    Key:    key,
  });

  try {
    await client.send(command);
  } catch (err) {
    throwClassified(err, ERR_DEL_TRANS, ERR_DEL_FAIL);
  }

  return { objectKey: key };
}
