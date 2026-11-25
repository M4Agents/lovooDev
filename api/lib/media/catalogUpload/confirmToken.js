import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  CATALOG_SOURCE_TYPES,
  CATALOG_UPLOAD_CONTEXT,
  CONFIRM_TTL_SECONDS,
  MAX_TOKEN_LENGTH,
  MIN_SECRET_BYTES,
  TOKEN_VERSION,
} from './constants.js'
import { isValidStorageBucket, isValidStorageRegion } from './credentials.js'
import { CatalogUploadError } from './errors.js'
import { parseCatalogObjectKey, utcKeyDate } from './objectKey.js'
import {
  catalogSizeWithinLimit,
  resolveCatalogMime,
  sanitizeCatalogFileName,
} from './validation.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLAIM_KEYS = Object.freeze([
  'v',
  'operationId',
  'userId',
  'companyId',
  'context',
  'sourceType',
  's3Key',
  'originalFileName',
  'sizeBytes',
  'mimeType',
  'bucket',
  'region',
  'issuedAt',
  'expiresAt',
])

function tokenError() {
  throw new CatalogUploadError(500, 'Falha ao preparar upload')
}

export function assertConfirmSecret(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < MIN_SECRET_BYTES) {
    tokenError()
  }
  return secret
}

function encode(buffer) {
  return Buffer.from(buffer).toString('base64url')
}

function decode(segment) {
  if (typeof segment !== 'string' || segment.length === 0 || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    return null
  }
  const buffer = Buffer.from(segment, 'base64url')
  if (buffer.length === 0 || encode(buffer) !== segment) {
    return null
  }
  return buffer
}

function signInput(secret, input) {
  return createHmac('sha256', secret).update(input).digest()
}

function signaturesMatch(expected, provided) {
  const actual = decode(provided)
  if (!actual || actual.length !== expected.length) {
    timingSafeEqual(expected, expected)
    return false
  }
  return timingSafeEqual(expected, actual)
}

function canonicalClaims(claims) {
  return {
    v: 1,
    operationId: claims.operationId,
    userId: claims.userId,
    companyId: claims.companyId,
    context: CATALOG_UPLOAD_CONTEXT,
    sourceType: claims.sourceType,
    s3Key: claims.s3Key,
    originalFileName: claims.originalFileName,
    sizeBytes: claims.sizeBytes,
    mimeType: claims.mimeType,
    bucket: claims.bucket,
    region: claims.region,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  }
}

export function issueConfirmToken(secret, claims) {
  const key = assertConfirmSecret(secret)
  const payload = canonicalClaims(claims)
  if (!claimsAreStrict(payload)) {
    tokenError()
  }
  const encoded = encode(Buffer.from(JSON.stringify(payload)))
  const input = `${TOKEN_VERSION}.${encoded}`
  const token = `${input}.${encode(signInput(key, input))}`
  if (token.length > MAX_TOKEN_LENGTH) {
    tokenError()
  }
  return token
}

function reject() {
  return { ok: false }
}

function claimsAreStrict(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== CLAIM_KEYS.length || CLAIM_KEYS.some((key) => !Object.hasOwn(value, key))) {
    return false
  }
  if (value.v !== 1 || value.context !== CATALOG_UPLOAD_CONTEXT) return false
  if (!UUID_RE.test(value.operationId) || !UUID_RE.test(value.userId) || !UUID_RE.test(value.companyId)) {
    return false
  }
  if (!CATALOG_SOURCE_TYPES.includes(value.sourceType)) return false
  if (typeof value.s3Key !== 'string' || value.s3Key.length === 0 || value.s3Key.length > 1024) return false
  if (typeof value.originalFileName !== 'string' || value.originalFileName.length === 0 || value.originalFileName.length > 200) {
    return false
  }
  if (typeof value.mimeType !== 'string' || typeof value.bucket !== 'string' || typeof value.region !== 'string') {
    return false
  }
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0) return false
  if (!Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt)) return false
  if (value.expiresAt !== value.issuedAt + CONFIRM_TTL_SECONDS) return false
  return claimsMatchObject(value)
}

function claimsMatchObject(value) {
  const mime = resolveCatalogMime(value.mimeType)
  if (!mime || !catalogSizeWithinLimit(value.sizeBytes, mime.kind)) return false
  if (!isValidStorageBucket(value.bucket) || !isValidStorageRegion(value.region)) return false

  const key = parseCatalogObjectKey(value.s3Key)
  const issued = utcKeyDate(value.issuedAt)
  if (!key || !issued) return false
  if (key.companyId !== value.companyId || key.operationId !== value.operationId) return false
  if (key.year !== issued.year || key.month !== issued.month || key.day !== issued.day) return false
  return sanitizedOriginalName(value.originalFileName) === key.fileName
}

function sanitizedOriginalName(fileName) {
  try {
    return sanitizeCatalogFileName(fileName)
  } catch {
    return null
  }
}

export function verifyConfirmToken(secret, token, nowSeconds) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return reject()
  }
  let key
  try {
    key = assertConfirmSecret(secret)
  } catch {
    return reject()
  }
  if (!Number.isSafeInteger(nowSeconds)) return reject()

  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return reject()

  const payloadBuffer = decode(parts[1])
  if (!payloadBuffer) return reject()

  const expected = signInput(key, `${parts[0]}.${parts[1]}`)
  if (!signaturesMatch(expected, parts[2])) return reject()

  let parsed
  try {
    parsed = JSON.parse(payloadBuffer.toString('utf8'))
  } catch {
    return reject()
  }
  if (!claimsAreStrict(parsed)) return reject()
  if (nowSeconds < parsed.issuedAt || nowSeconds >= parsed.expiresAt) return reject()

  return { ok: true, claims: canonicalClaims(parsed) }
}
