import {
  CATALOG_IMAGE_MAX_BYTES,
  CATALOG_IMAGE_MIME_TYPES,
  CATALOG_SOURCE_TYPES,
  CATALOG_VIDEO_MAX_BYTES,
  CATALOG_VIDEO_MIME_TYPES,
  MAX_FILENAME_LENGTH,
  REQUEST_FIELDS,
} from './constants.js'
import { CatalogUploadError } from './errors.js'

const CONTROL_RE = /[\u0000-\u001f\u007f]/
const MIME_KIND = new Map([
  ...CATALOG_IMAGE_MIME_TYPES.map((mime) => [mime, 'image']),
  ...CATALOG_VIDEO_MIME_TYPES.map((mime) => [mime, 'video']),
])

function invalid(status, error) {
  throw new CatalogUploadError(status, error)
}

export function parseBasicRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid(400, 'Pedido inválido')
  }

  const keys = Object.keys(body)
  if (keys.length !== REQUEST_FIELDS.length || REQUEST_FIELDS.some((field) => !Object.hasOwn(body, field))) {
    invalid(400, 'Pedido inválido')
  }

  if (
    typeof body.companyId !== 'string'
    || typeof body.sourceType !== 'string'
    || typeof body.fileName !== 'string'
    || typeof body.mimeType !== 'string'
    || typeof body.sizeBytes !== 'number'
  ) {
    invalid(400, 'Pedido inválido')
  }

  return {
    companyId: body.companyId,
    sourceType: body.sourceType,
    fileName: body.fileName,
    mimeType: body.mimeType,
    sizeBytes: body.sizeBytes,
  }
}

export function parseSizeBytes(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    invalid(400, 'Pedido inválido')
  }
  return value
}

export function resolveCatalogMime(mimeType) {
  if (typeof mimeType !== 'string' || mimeType.length === 0 || mimeType.length > 127) return null
  if (CONTROL_RE.test(mimeType) || mimeType !== mimeType.trim() || mimeType.includes(';')) return null
  if (mimeType !== mimeType.toLowerCase()) return null
  const kind = MIME_KIND.get(mimeType)
  if (!kind) return null
  return { kind, mimeType }
}

export function catalogSizeWithinLimit(sizeBytes, kind) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return false
  const limit = kind === 'video' ? CATALOG_VIDEO_MAX_BYTES : CATALOG_IMAGE_MAX_BYTES
  return sizeBytes <= limit
}

export function classifyCatalogMime(mimeType) {
  const resolved = resolveCatalogMime(mimeType)
  if (!resolved) invalid(415, 'Tipo de arquivo não permitido')
  return resolved
}

export function assertSourceType(sourceType) {
  if (!CATALOG_SOURCE_TYPES.includes(sourceType)) {
    invalid(400, 'Pedido inválido')
  }
  return sourceType
}

export function assertSizeForKind(sizeBytes, kind) {
  if (!catalogSizeWithinLimit(sizeBytes, kind)) {
    const overLimit = Number.isSafeInteger(sizeBytes) && sizeBytes > 0
    invalid(overLimit ? 413 : 400, overLimit ? 'Arquivo acima do limite' : 'Pedido inválido')
  }
  return sizeBytes
}

export function sanitizeCatalogFileName(fileName) {
  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.length > MAX_FILENAME_LENGTH) {
    invalid(400, 'Pedido inválido')
  }
  if (
    CONTROL_RE.test(fileName)
    || fileName.includes('/')
    || fileName.includes('\\')
    || fileName.includes('..')
  ) {
    invalid(400, 'Pedido inválido')
  }

  const sanitized = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')

  if (
    sanitized.length === 0
    || sanitized.length > MAX_FILENAME_LENGTH
    || sanitized.includes('..')
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(sanitized)
  ) {
    invalid(400, 'Pedido inválido')
  }

  return sanitized
}

export function validateCatalogUploadRequest(request) {
  const sourceType = assertSourceType(request.sourceType)
  const sizeBytes = parseSizeBytes(request.sizeBytes)
  const mime = classifyCatalogMime(request.mimeType)
  assertSizeForKind(sizeBytes, mime.kind)
  const safeFileName = sanitizeCatalogFileName(request.fileName)

  return {
    sourceType,
    sizeBytes,
    mimeType: mime.mimeType,
    kind: mime.kind,
    originalFileName: request.fileName,
    safeFileName,
  }
}
