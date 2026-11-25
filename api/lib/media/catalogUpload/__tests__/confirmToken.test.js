import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { CONFIRM_TTL_SECONDS } from '../constants.js'
import { issueConfirmToken, verifyConfirmToken } from '../confirmToken.js'
import { CatalogUploadError } from '../errors.js'

const SECRET = 'c'.repeat(32)
const ISSUED_AT = 1_700_000_000

function keyDate(unixSeconds) {
  const date = new Date(unixSeconds * 1000)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}/${month}/${day}`
}

function claims(overrides = {}) {
  return {
    operationId: '11111111-1111-4111-8111-111111111111',
    userId: 'aaaa0000-0000-4000-8000-000000000001',
    companyId: 'bbbb0000-0000-4000-8000-000000000002',
    sourceType: 'service',
    s3Key: `clientes/bbbb0000-0000-4000-8000-000000000002/whatsapp/${keyDate(ISSUED_AT)}/11111111-1111-4111-8111-111111111111/foto.png`,
    originalFileName: 'foto.png',
    sizeBytes: 2048,
    mimeType: 'image/jpeg',
    bucket: 'example-bucket',
    region: 'sa-east-1',
    issuedAt: ISSUED_AT,
    expiresAt: ISSUED_AT + CONFIRM_TTL_SECONDS,
    ...overrides,
  }
}

describe('token de confirmação', () => {
  it('vincula usuário, empresa, contexto, origem, chave, tamanho, MIME, bucket e região', () => {
    const token = issueConfirmToken(SECRET, claims())
    const verified = verifyConfirmToken(SECRET, token, ISSUED_AT + 10)
    expect(verified.ok).toBe(true)
    expect(verified.claims.userId).toBe(claims().userId)
    expect(verified.claims.companyId).toBe(claims().companyId)
    expect(verified.claims.context).toBe('catalog')
    expect(verified.claims.sourceType).toBe('service')
    expect(verified.claims.s3Key).toContain('/whatsapp/')
    expect(verified.claims.sizeBytes).toBe(2048)
    expect(verified.claims.mimeType).toBe('image/jpeg')
    expect(verified.claims.bucket).toBe('example-bucket')
    expect(verified.claims.region).toBe('sa-east-1')
    expect(token).not.toContain(SECRET)

    const otherUser = issueConfirmToken(SECRET, claims({
      userId: 'ffff0000-0000-4000-8000-000000000006',
    }))
    expect(verifyConfirmToken(SECRET, otherUser, ISSUED_AT).claims.userId).not.toBe(claims().userId)
  })

  it('rejeita assinatura inválida e token maior que o limite', () => {
    const token = issueConfirmToken(SECRET, claims())
    expect(verifyConfirmToken(SECRET, `${token}x`, ISSUED_AT).ok).toBe(false)
    expect(verifyConfirmToken(SECRET, 'v1', ISSUED_AT).ok).toBe(false)
    expect(verifyConfirmToken(SECRET, 'x'.repeat(4097), ISSUED_AT).ok).toBe(false)
    expect(verifyConfirmToken('curto', token, ISSUED_AT).ok).toBe(false)
    expect(verifyConfirmToken(SECRET, token, ISSUED_AT + CONFIRM_TTL_SECONDS).ok).toBe(false)
  })

  it('usa comparação de tamanho constante para assinatura divergente', () => {
    const token = issueConfirmToken(SECRET, claims())
    const [version, payload] = token.split('.')
    const input = `${version}.${payload}`
    const expected = createHmac('sha256', SECRET).update(input).digest('base64url')
    const wrong = `${expected.slice(0, -2)}aa`
    expect(verifyConfirmToken(SECRET, `${input}.${wrong}`, ISSUED_AT).ok).toBe(false)
    expect(verifyConfirmToken(SECRET, `${input}.${expected}`, ISSUED_AT).ok).toBe(true)
  })

  it('rejeita token assinado quando a estrutura diverge do contrato', () => {
    const base = claims()
    const otherCompany = 'dddd0000-0000-4000-8000-000000000004'
    const otherOperation = '22222222-2222-4222-8222-222222222222'
    const inconsistent = [
      claims({ companyId: otherCompany }),
      claims({ operationId: otherOperation }),
      claims({ originalFileName: 'outro.png' }),
      claims({
        companyId: otherCompany,
        originalFileName: `${otherCompany}.png`,
        s3Key: base.s3Key.replace('foto.png', `${otherCompany}.png`),
      }),
      claims({
        originalFileName: `${base.operationId}.png`,
        s3Key: base.s3Key
          .replace(base.operationId, otherOperation)
          .replace('foto.png', `${base.operationId}.png`),
      }),
      claims({ s3Key: base.s3Key.replace(keyDate(ISSUED_AT), '1999/01/01') }),
      claims({ sourceType: 'unknown' }),
      claims({ sizeBytes: (5 * 1024 * 1024) + 1 }),
      claims({ mimeType: 'image/svg+xml', originalFileName: 'icon.svg', s3Key: base.s3Key.replace('foto.png', 'icon.svg') }),
      claims({ bucket: 'Bad_Bucket' }),
      claims({ region: 'US-EAST-1' }),
      claims({ s3Key: `${base.s3Key}/extra` }),
      claims({ s3Key: base.s3Key.replace('/foto.png', '/../foto.png') }),
    ]

    for (const value of inconsistent) {
      expect(() => issueConfirmToken(SECRET, value)).toThrow(CatalogUploadError)
      expect(verifyConfirmToken(SECRET, manualToken(value), ISSUED_AT).ok).toBe(false)
    }

    const otherContext = encodeToken({ ...signedPayload(base), context: 'library' })
    expect(verifyConfirmToken(SECRET, otherContext, ISSUED_AT).ok).toBe(false)
    const forced = issueConfirmToken(SECRET, { ...base, context: 'library' })
    expect(verifyConfirmToken(SECRET, forced, ISSUED_AT).claims.context).toBe('catalog')
  })
})

function signedPayload(value) {
  return {
    v: 1,
    operationId: value.operationId,
    userId: value.userId,
    companyId: value.companyId,
    context: 'catalog',
    sourceType: value.sourceType,
    s3Key: value.s3Key,
    originalFileName: value.originalFileName,
    sizeBytes: value.sizeBytes,
    mimeType: value.mimeType,
    bucket: value.bucket,
    region: value.region,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  }
}

function encodeToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const input = `v1.${encoded}`
  const signature = createHmac('sha256', SECRET).update(input).digest('base64url')
  return `${input}.${signature}`
}

function manualToken(value) {
  return encodeToken(signedPayload(value))
}
