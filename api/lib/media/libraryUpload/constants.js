export const LIBRARY_UPLOAD_CONTEXT = 'library'

export const LIBRARY_UPLOAD_ROLES = Object.freeze([
  'super_admin',
  'system_admin',
  'admin',
  'manager',
  'seller',
  'partner',
])

export const LIBRARY_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const LIBRARY_OTHER_MAX_BYTES = 25 * 1024 * 1024

export const PUT_TTL_SECONDS = 300
export const CONFIRM_TTL_SECONDS = 900
export const MAX_FILENAME_LENGTH = 200
export const MAX_TOKEN_LENGTH = 4096
export const MIN_SECRET_BYTES = 32
export const CONFIRM_SECRET_ENV = 'MEDIA_LIBRARY_UPLOAD_TOKEN_SECRET'
export const TOKEN_VERSION = 'v1'

/** Comparação literal. image/jpg não é reescrito para image/jpeg. */
export const LIBRARY_IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
])

export const LIBRARY_VIDEO_MIME_TYPES = Object.freeze([
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/avi',
])

export const LIBRARY_AUDIO_MIME_TYPES = Object.freeze([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
])

export const LIBRARY_DOCUMENT_MIME_TYPES = Object.freeze([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export const LIBRARY_MIME_TYPES = Object.freeze([
  ...LIBRARY_IMAGE_MIME_TYPES,
  ...LIBRARY_VIDEO_MIME_TYPES,
  ...LIBRARY_AUDIO_MIME_TYPES,
  ...LIBRARY_DOCUMENT_MIME_TYPES,
])

export const REQUEST_FIELDS = Object.freeze([
  'companyId',
  'folderId',
  'fileName',
  'mimeType',
  'sizeBytes',
])
