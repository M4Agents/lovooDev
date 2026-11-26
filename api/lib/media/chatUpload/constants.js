export const CHAT_UPLOAD_CONTEXT = 'chat'

export const CHAT_PURPOSES = Object.freeze([
  'chat_manual',
  'chat_schedule',
  'automation_audio',
])

export const CHAT_MESSAGE_TYPES = Object.freeze([
  'image',
  'video',
  'audio',
  'document',
])

/** Mesma unidade do chat atual: bytes, com teto inclusivo de 10 MiB e 25 MiB. */
export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const CHAT_OTHER_MAX_BYTES = 25 * 1024 * 1024

export const PUT_TTL_SECONDS = 300
export const CONFIRM_TTL_SECONDS = 900
export const MAX_FILENAME_LENGTH = 200
export const MAX_TOKEN_LENGTH = 4096
export const MIN_SECRET_BYTES = 32
export const CONFIRM_SECRET_ENV = 'MEDIA_CHAT_UPLOAD_TOKEN_SECRET'
export const TOKEN_VERSION = 'v1'
