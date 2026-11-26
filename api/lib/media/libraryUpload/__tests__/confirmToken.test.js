import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CONFIRM_TTL_SECONDS as CATALOG_TTL } from '../../catalogUpload/constants.js'
import { issueConfirmToken, verifyConfirmToken } from '../../catalogUpload/confirmToken.js'
import {
  CONFIRM_TTL_SECONDS,
  LIBRARY_IMAGE_MAX_BYTES,
  LIBRARY_OTHER_MAX_BYTES,
} from '../constants.js'
import { issueLibraryConfirmToken, verifyLibraryConfirmToken } from '../confirmToken.js'
import { LibraryUploadError } from '../errors.js'

const SECRET = 'l'.repeat(32)
const CATALOG_SECRET = 'c'.repeat(32)
const ISSUED_AT = 1_763_000_000
const COMPANY_ID = 'bbbb0000-0000-4000-8000-000000000002'
const FOLDER_ID = 'cccc0000-0000-4000-8000-000000000003'
const USER_ID = 'aaaa0000-0000-4000-8000-000000000001'
const OPERATION_ID = '11111111-1111-4111-8111-111111111111'

function keyDate(unixSeconds) {
  const date = new Date(unixSeconds * 1000)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}/${month}/${day}`
}

function libraryKey(fileName = 'foto.png', operationId = OPERATION_ID) {
  return `clientes/${COMPANY_ID}/library/${keyDate(ISSUED_AT)}/${operationId}/${fileName}`
}

function claims(overrides = {}) {
  return {
    operationId: OPERATION_ID,
    userId: USER_ID,
    companyId: COMPANY_ID,
    folderId: FOLDER_ID,
    s3Key: libraryKey(),
    originalFileName: 'foto.png',
    sizeBytes: 2048,
    mimeType: 'image/jpeg',
    fileType: 'image',
    bucket: 'example-bucket',
    region: 'sa-east-1',
    issuedAt: ISSUED_AT,
    expiresAt: ISSUED_AT + CONFIRM_TTL_SECONDS,
    ...overrides,
  }
}

function catalogClaims() {
  return {
    operationId: OPERATION_ID,
    userId: USER_ID,
    companyId: COMPANY_ID,
    sourceType: 'product',
    s3Key: `clientes/${COMPANY_ID}/whatsapp/${keyDate(ISSUED_AT)}/${OPERATION_ID}/foto.png`,
    originalFileName: 'foto.png',
    sizeBytes: 2048,
    mimeType: 'image/jpeg',
    bucket: 'example-bucket',
    region: 'sa-east-1',
    issuedAt: ISSUED_AT,
    expiresAt: ISSUED_AT + CATALOG_TTL,
  }
}

describe('token HMAC da biblioteca', () => {
  it('vincula usuário, empresa, pasta, operação, chave, nome, MIME, tipo, tamanho, bucket e região', () => {
    const token = issueLibraryConfirmToken(SECRET, claims())
    const verified = verifyLibraryConfirmToken(SECRET, token, ISSUED_AT + 10)
    expect(verified.ok).toBe(true)
    expect(verified.claims).toMatchObject({
      context: 'library',
      userId: USER_ID,
      companyId: COMPANY_ID,
      folderId: FOLDER_ID,
      operationId: OPERATION_ID,
      s3Key: libraryKey(),
      originalFileName: 'foto.png',
      mimeType: 'image/jpeg',
      fileType: 'image',
      sizeBytes: 2048,
      bucket: 'example-bucket',
      region: 'sa-east-1',
    })
    expect(token).not.toContain(SECRET)
    expect(verified.claims.s3Key).not.toContain(FOLDER_ID)
  })

  it('preserva aliases literais e os limites de imagem e demais tipos', () => {
    const alias = issueLibraryConfirmToken(SECRET, claims({
      mimeType: 'image/jpg',
      fileType: 'image',
      originalFileName: 'foto.jpg',
      s3Key: libraryKey('foto.jpg'),
      sizeBytes: LIBRARY_IMAGE_MAX_BYTES,
    }))
    const video = issueLibraryConfirmToken(SECRET, claims({
      mimeType: 'video/quicktime',
      fileType: 'video',
      originalFileName: 'clip.mov',
      s3Key: libraryKey('clip.mov'),
      sizeBytes: LIBRARY_OTHER_MAX_BYTES,
    }))
    expect(verifyLibraryConfirmToken(SECRET, alias, ISSUED_AT).claims.mimeType).toBe('image/jpg')
    expect(verifyLibraryConfirmToken(SECRET, video, ISSUED_AT).claims.mimeType).toBe('video/quicktime')
    expect(() => issueLibraryConfirmToken(SECRET, claims({
      sizeBytes: LIBRARY_IMAGE_MAX_BYTES + 1,
    }))).toThrow(LibraryUploadError)
    expect(() => issueLibraryConfirmToken(SECRET, claims({
      mimeType: 'audio/mpeg',
      fileType: 'audio',
      originalFileName: 'audio.mp3',
      s3Key: libraryKey('audio.mp3'),
      sizeBytes: LIBRARY_OTHER_MAX_BYTES + 1,
    }))).toThrow(LibraryUploadError)
  })

  it('rejeita adulteração, expiração e segredo divergente', () => {
    const token = issueLibraryConfirmToken(SECRET, claims())
    const [version, payload, signature] = token.split('.')
    const input = `${version}.${payload}`
    const expected = createHmac('sha256', SECRET).update(input).digest('base64url')
    const wrong = `${expected.slice(0, -2)}aa`
    expect(verifyLibraryConfirmToken(SECRET, `${input}.${wrong}`, ISSUED_AT).ok).toBe(false)
    expect(verifyLibraryConfirmToken(SECRET, `${token}x`, ISSUED_AT).ok).toBe(false)
    expect(verifyLibraryConfirmToken(CATALOG_SECRET, token, ISSUED_AT).ok).toBe(false)
    expect(verifyLibraryConfirmToken(SECRET, token, ISSUED_AT).ok).toBe(true)
    expect(verifyLibraryConfirmToken(SECRET, token, ISSUED_AT + CONFIRM_TTL_SECONDS - 1).ok).toBe(true)
    expect(verifyLibraryConfirmToken(SECRET, token, ISSUED_AT + CONFIRM_TTL_SECONDS).reason).toBe('expired')
    expect(verifyLibraryConfirmToken(SECRET, token, ISSUED_AT - 1).reason).toBe('expired')
    expect(signature).toBe(expected)
  })

  it('rejeita claim inconsistente, SVG e contexto forçado', () => {
    const inconsistent = [
      claims({ folderId: 'pasta' }),
      claims({ companyId: 'dddd0000-0000-4000-8000-000000000004' }),
      claims({ fileType: 'document' }),
      claims({ mimeType: 'image/svg+xml', originalFileName: 'icon.svg', s3Key: libraryKey('icon.svg') }),
      claims({ mimeType: 'application/octet-stream', fileType: 'document', originalFileName: 'a.bin', s3Key: libraryKey('a.bin') }),
      claims({ s3Key: libraryKey().replace('/library/', '/whatsapp/') }),
      claims({ context: 'catalog' }),
    ]
    for (const value of inconsistent) {
      if (value.context === 'catalog') {
        const token = issueLibraryConfirmToken(SECRET, value)
        expect(verifyLibraryConfirmToken(SECRET, token, ISSUED_AT).claims.context).toBe('library')
        continue
      }
      expect(() => issueLibraryConfirmToken(SECRET, value)).toThrow(LibraryUploadError)
    }
  })

  it('isola tokens library e catalog mesmo com o mesmo segredo', () => {
    const libraryToken = issueLibraryConfirmToken(SECRET, claims())
    const catalogToken = issueConfirmToken(SECRET, catalogClaims())
    expect(verifyLibraryConfirmToken(SECRET, catalogToken, ISSUED_AT).ok).toBe(false)
    expect(verifyConfirmToken(SECRET, libraryToken, ISSUED_AT).ok).toBe(false)
    expect(verifyConfirmToken(SECRET, catalogToken, ISSUED_AT).ok).toBe(true)
    expect(verifyLibraryConfirmToken(SECRET, libraryToken, ISSUED_AT).ok).toBe(true)
  })
})
