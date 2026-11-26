import {
  LIBRARY_AUDIO_MIME_TYPES,
  LIBRARY_DOCUMENT_MIME_TYPES,
  LIBRARY_IMAGE_MAX_BYTES,
  LIBRARY_IMAGE_MIME_TYPES,
  LIBRARY_OTHER_MAX_BYTES,
  LIBRARY_VIDEO_MIME_TYPES,
  MAX_FILENAME_LENGTH,
  REQUEST_FIELDS,
} from './constants.js'
import { LibraryUploadError } from './errors.js'

const CONTROL_RE = /[\u0000-\u001f\u007f]/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAFE_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

const MIME_FILE_TYPE = new Map([
  ...LIBRARY_IMAGE_MIME_TYPES.map((mimeType) => [mimeType, 'image']),
  ...LIBRARY_VIDEO_MIME_TYPES.map((mimeType) => [mimeType, 'video']),
  ...LIBRARY_AUDIO_MIME_TYPES.map((mimeType) => [mimeType, 'audio']),
  ...LIBRARY_DOCUMENT_MIME_TYPES.map((mimeType) => [mimeType, 'document']),
])

function invalid(status, error) {
  throw new LibraryUploadError(status, error)
}

export function parseLibraryUploadRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid(400, 'Pedido inválido')
  }

  const keys = Object.keys(body)
  if (keys.length !== REQUEST_FIELDS.length || REQUEST_FIELDS.some((field) => !Object.hasOwn(body, field))) {
    invalid(400, 'Pedido inválido')
  }

  if (
    typeof body.companyId !== 'string'
    || typeof body.folderId !== 'string'
    || typeof body.fileName !== 'string'
    || typeof body.mimeType !== 'string'
    || typeof body.sizeBytes !== 'number'
  ) {
    invalid(400, 'Pedido inválido')
  }

  return {
    companyId: body.companyId,
    folderId: body.folderId,
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

export function resolveLibraryMime(mimeType) {
  if (typeof mimeType !== 'string' || mimeType.length === 0 || mimeType.length > 127) return null
  if (CONTROL_RE.test(mimeType) || mimeType !== mimeType.trim() || mimeType.includes(';')) return null
  const fileType = MIME_FILE_TYPE.get(mimeType)
  if (!fileType) return null
  return { fileType, mimeType }
}

export function librarySizeWithinLimit(sizeBytes, fileType) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return false
  if (fileType === 'image') return sizeBytes <= LIBRARY_IMAGE_MAX_BYTES
  if (fileType === 'video' || fileType === 'audio' || fileType === 'document') {
    return sizeBytes <= LIBRARY_OTHER_MAX_BYTES
  }
  return false
}

export function assertUuid(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    invalid(400, 'Pedido inválido')
  }
  return value
}

export function assertSizeForFileType(sizeBytes, fileType) {
  if (!librarySizeWithinLimit(sizeBytes, fileType)) {
    const overLimit = Number.isSafeInteger(sizeBytes) && sizeBytes > 0
    invalid(overLimit ? 413 : 400, overLimit ? 'Arquivo acima do limite' : 'Pedido inválido')
  }
  return sizeBytes
}

export function sanitizeLibraryFileName(fileName) {
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
    || !SAFE_FILE_RE.test(sanitized)
  ) {
    invalid(400, 'Pedido inválido')
  }

  return sanitized
}

export function validateLibraryUploadRequest(request) {
  const parsed = parseLibraryUploadRequest(request)
  const companyId = assertUuid(parsed.companyId)
  const folderId = assertUuid(parsed.folderId)
  const sizeBytes = parseSizeBytes(parsed.sizeBytes)
  const mime = resolveLibraryMime(parsed.mimeType)
  if (!mime) invalid(415, 'Tipo de arquivo não permitido')
  assertSizeForFileType(sizeBytes, mime.fileType)
  const safeFileName = sanitizeLibraryFileName(parsed.fileName)

  return {
    companyId,
    folderId,
    sizeBytes,
    mimeType: mime.mimeType,
    fileType: mime.fileType,
    originalFileName: parsed.fileName,
    safeFileName,
  }
}
