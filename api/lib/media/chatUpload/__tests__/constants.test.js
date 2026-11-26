import { describe, expect, it } from 'vitest'
import { CONFIRM_SECRET_ENV as CATALOG_SECRET_ENV } from '../../catalogUpload/constants.js'
import { CONFIRM_SECRET_ENV as LIBRARY_SECRET_ENV } from '../../libraryUpload/constants.js'
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_OTHER_MAX_BYTES,
  CHAT_UPLOAD_CONTEXT,
  CONFIRM_SECRET_ENV,
  CONFIRM_TTL_SECONDS,
  PUT_TTL_SECONDS,
} from '../constants.js'

describe('constantes do upload do chat', () => {
  it('fixa o contexto, as finalidades e o segredo exclusivo', () => {
    expect(CHAT_UPLOAD_CONTEXT).toBe('chat')
    expect(CONFIRM_SECRET_ENV).toBe('MEDIA_CHAT_UPLOAD_TOKEN_SECRET')
    expect(CONFIRM_SECRET_ENV).not.toBe(CATALOG_SECRET_ENV)
    expect(CONFIRM_SECRET_ENV).not.toBe(LIBRARY_SECRET_ENV)
    expect(PUT_TTL_SECONDS).toBe(300)
    expect(CONFIRM_TTL_SECONDS).toBe(900)
    expect(CHAT_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024)
    expect(CHAT_OTHER_MAX_BYTES).toBe(25 * 1024 * 1024)
  })
})
