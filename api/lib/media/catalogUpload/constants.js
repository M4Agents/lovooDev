export const CATALOG_UPLOAD_CONTEXT = 'catalog'

export const CATALOG_UPLOAD_ROLES = Object.freeze([
  'super_admin',
  'system_admin',
  'admin',
  'manager',
])

export const CATALOG_SOURCE_TYPES = Object.freeze(['product', 'service'])

/** Mesma unidade do catálogo atual: bytes, com teto de 5 MiB e 30 MiB. */
export const CATALOG_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const CATALOG_VIDEO_MAX_BYTES = 30 * 1024 * 1024

export const PUT_TTL_SECONDS = 300
export const CONFIRM_TTL_SECONDS = 900
export const MAX_FILENAME_LENGTH = 200
export const MAX_TOKEN_LENGTH = 4096
export const MIN_SECRET_BYTES = 32
export const CONFIRM_SECRET_ENV = 'MEDIA_CATALOG_UPLOAD_TOKEN_SECRET'
export const TOKEN_VERSION = 'v1'

/** Lista fechada. O prefixo image/* e video/* do catálogo atual não é reutilizado. */
export const CATALOG_IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

export const CATALOG_VIDEO_MIME_TYPES = Object.freeze([
  'video/mp4',
  'video/webm',
  'video/quicktime',
])

export const REJECTED_ACTIVE_MIME_TYPES = Object.freeze([
  'image/svg+xml',
  'image/svg',
  'image/xhtml+xml',
  'image/xml',
  'image/html',
  'video/html',
  'video/xml',
])

export const REQUEST_FIELDS = Object.freeze([
  'companyId',
  'sourceType',
  'fileName',
  'mimeType',
  'sizeBytes',
])
