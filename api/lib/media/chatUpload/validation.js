import { sanitizeCatalogFileName } from '../catalogUpload/validation.js'
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_MESSAGE_TYPES,
  CHAT_OTHER_MAX_BYTES,
  CHAT_PURPOSES,
  MAX_FILENAME_LENGTH,
} from './constants.js'
import { ChatUploadError } from './errors.js'

const CONTROL_RE = /[\u0000-\u001f\u007f]/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MIME_RE = /^[a-z0-9][a-z0-9.+-]{0,80}\/[a-z0-9][a-z0-9.+-]{0,120}$/
const PARAM_RE = /^[a-z0-9][a-z0-9.+-]{0,40}=(?:[a-z0-9][a-z0-9.+\-_]{0,80}|"[a-z0-9][a-z0-9.+\-_]{0,80}")$/
const ACTIVE_STORAGE_MIME_TYPES = new Set([
  'image/svg+xml',
  'text/html',
  'application/xhtml+xml',
])
const SAFE_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const EXT_RE = /^[a-z0-9]{1,10}$/
const COMMON_FIELDS = Object.freeze([
  'companyId',
  'purpose',
  'messageType',
  'fileName',
  'mimeType',
  'sizeBytes',
])
const PURPOSE_FIELDS = Object.freeze({
  chat_manual: Object.freeze(['conversationId']),
  chat_schedule: Object.freeze(['conversationId', 'instanceId']),
  automation_audio: Object.freeze(['flowId']),
})

function invalid(status, error) {
  throw new ChatUploadError(status, error)
}

function assertUuid(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    invalid(400, 'Pedido inválido')
  }
  return value
}

function exactFields(body, fields) {
  const keys = Object.keys(body)
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(body, field))
}

export function parseChatUploadRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid(400, 'Pedido inválido')
  }
  if (!CHAT_PURPOSES.includes(body.purpose)) {
    invalid(400, 'Pedido inválido')
  }

  const fields = [...COMMON_FIELDS, ...PURPOSE_FIELDS[body.purpose]]
  if (!exactFields(body, fields)) {
    invalid(400, 'Pedido inválido')
  }
  if (
    typeof body.companyId !== 'string'
    || typeof body.messageType !== 'string'
    || typeof body.fileName !== 'string'
    || typeof body.mimeType !== 'string'
    || typeof body.sizeBytes !== 'number'
  ) {
    invalid(400, 'Pedido inválido')
  }
  if (!CHAT_MESSAGE_TYPES.includes(body.messageType)) {
    invalid(400, 'Pedido inválido')
  }

  const companyId = assertUuid(body.companyId)
  const conversationId = Object.hasOwn(body, 'conversationId') ? assertUuid(body.conversationId) : null
  const instanceId = Object.hasOwn(body, 'instanceId') ? assertUuid(body.instanceId) : null
  const flowId = Object.hasOwn(body, 'flowId') ? assertUuid(body.flowId) : null

  return {
    companyId,
    purpose: body.purpose,
    messageType: body.messageType,
    fileName: body.fileName,
    mimeType: body.mimeType,
    sizeBytes: body.sizeBytes,
    conversationId,
    instanceId,
    flowId,
  }
}

function canonicalMime(mimeType) {
  if (mimeType.length === 0 || mimeType.length > 127) return null
  if (mimeType !== mimeType.trim() || CONTROL_RE.test(mimeType) || /\s/.test(mimeType)) return null
  const parts = mimeType.split(';')
  if (!MIME_RE.test(parts[0])) return null
  for (let index = 1; index < parts.length; index += 1) {
    if (!PARAM_RE.test(parts[index])) return null
  }
  return parts[0]
}

function storageContentType(mimeType) {
  return ACTIVE_STORAGE_MIME_TYPES.has(mimeType) ? 'application/octet-stream' : mimeType
}

function messageTypeMatchesMime(messageType, mimeType) {
  if (messageType === 'image') return mimeType.startsWith('image/')
  if (messageType === 'video') return mimeType.startsWith('video/')
  if (messageType === 'audio') return mimeType.startsWith('audio/')
  return !mimeType.startsWith('image/')
    && !mimeType.startsWith('video/')
    && !mimeType.startsWith('audio/')
}

export function resolveChatMime(messageType, mimeType) {
  if (!CHAT_MESSAGE_TYPES.includes(messageType) || typeof mimeType !== 'string') return null
  if (messageType === 'document' && mimeType === '') {
    return {
      messageType,
      mimeType: 'application/octet-stream',
      contentType: 'application/octet-stream',
    }
  }
  const canonical = canonicalMime(mimeType)
  if (!canonical || !messageTypeMatchesMime(messageType, canonical)) return null
  return {
    messageType,
    mimeType: canonical,
    contentType: storageContentType(canonical),
  }
}

export function chatSizeWithinLimit(sizeBytes, messageType) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return false
  if (messageType === 'image') return sizeBytes <= CHAT_IMAGE_MAX_BYTES
  if (messageType === 'video' || messageType === 'audio' || messageType === 'document') {
    return sizeBytes <= CHAT_OTHER_MAX_BYTES
  }
  return false
}

function assertSize(sizeBytes, messageType) {
  if (!chatSizeWithinLimit(sizeBytes, messageType)) {
    const overLimit = Number.isSafeInteger(sizeBytes) && sizeBytes > 0
    invalid(overLimit ? 413 : 400, overLimit ? 'Arquivo acima do limite' : 'Pedido inválido')
  }
  return sizeBytes
}

function extensionOf(fileName) {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0 || dot === fileName.length - 1) return ''
  const ext = fileName.slice(dot + 1)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase()
  return EXT_RE.test(ext) ? ext : ''
}

export function sanitizeChatFileName(fileName) {
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

  try {
    return sanitizeCatalogFileName(fileName)
  } catch {
    const ext = extensionOf(fileName)
    const fallback = ext ? `arquivo.${ext}` : 'arquivo'
    if (!SAFE_FILE_RE.test(fallback)) invalid(400, 'Pedido inválido')
    return fallback
  }
}

export function validateChatUploadRequest(body) {
  const request = parseChatUploadRequest(body)
  if (request.purpose === 'automation_audio' && request.messageType !== 'audio') {
    invalid(415, 'Tipo de arquivo não permitido')
  }

  const mime = resolveChatMime(request.messageType, request.mimeType)
  if (!mime) invalid(415, 'Tipo de arquivo não permitido')
  assertSize(request.sizeBytes, mime.messageType)
  const safeFileName = sanitizeChatFileName(request.fileName)

  return {
    companyId: request.companyId,
    purpose: request.purpose,
    messageType: mime.messageType,
    mimeType: mime.mimeType,
    contentType: mime.contentType,
    sizeBytes: request.sizeBytes,
    originalFileName: request.fileName,
    safeFileName,
    conversationId: request.conversationId,
    instanceId: request.instanceId,
    flowId: request.flowId,
  }
}
