import { describe, expect, it } from 'vitest'
import { CATALOG_UPLOAD_ROLES } from '../../catalogUpload/constants.js'
import {
  CONFIRM_SECRET_ENV,
  CONFIRM_TTL_SECONDS,
  LIBRARY_AUDIO_MIME_TYPES,
  LIBRARY_DOCUMENT_MIME_TYPES,
  LIBRARY_IMAGE_MAX_BYTES,
  LIBRARY_IMAGE_MIME_TYPES,
  LIBRARY_MIME_TYPES,
  LIBRARY_OTHER_MAX_BYTES,
  LIBRARY_UPLOAD_CONTEXT,
  LIBRARY_UPLOAD_ROLES,
  LIBRARY_VIDEO_MIME_TYPES,
  PUT_TTL_SECONDS,
} from '../constants.js'

describe('constantes do upload da biblioteca', () => {
  it('fixa a matriz de roles e o segredo próprio', () => {
    expect(LIBRARY_UPLOAD_ROLES).toEqual([
      'super_admin',
      'system_admin',
      'admin',
      'manager',
      'seller',
      'partner',
    ])
    expect(Object.isFrozen(LIBRARY_UPLOAD_ROLES)).toBe(true)
    expect(LIBRARY_UPLOAD_ROLES).not.toEqual(CATALOG_UPLOAD_ROLES)
    expect(CONFIRM_SECRET_ENV).toBe('MEDIA_LIBRARY_UPLOAD_TOKEN_SECRET')
    expect(LIBRARY_UPLOAD_CONTEXT).toBe('library')
    expect(PUT_TTL_SECONDS).toBe(300)
    expect(CONFIRM_TTL_SECONDS).toBe(900)
  })

  it('publica os 22 MIME aprovados, sem SVG nem octet-stream', () => {
    expect(LIBRARY_IMAGE_MIME_TYPES).toHaveLength(5)
    expect(LIBRARY_VIDEO_MIME_TYPES).toHaveLength(4)
    expect(LIBRARY_AUDIO_MIME_TYPES).toHaveLength(8)
    expect(LIBRARY_DOCUMENT_MIME_TYPES).toHaveLength(5)
    expect(LIBRARY_MIME_TYPES).toHaveLength(22)
    expect(new Set(LIBRARY_MIME_TYPES).size).toBe(22)
    expect(LIBRARY_MIME_TYPES).not.toContain('image/svg+xml')
    expect(LIBRARY_MIME_TYPES).not.toContain('application/octet-stream')
    expect(LIBRARY_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024)
    expect(LIBRARY_OTHER_MAX_BYTES).toBe(25 * 1024 * 1024)
  })
})
