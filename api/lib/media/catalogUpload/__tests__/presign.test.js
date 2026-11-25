import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { CONFIRM_TTL_SECONDS, PUT_TTL_SECONDS } from '../constants.js'
import { verifyConfirmToken } from '../confirmToken.js'
import { derivePublicObjectUrl } from '../objectKey.js'
import { presignCatalogUpload } from '../presignCatalogUpload.js'
import { handleCatalogPresign } from '../../../../media/uploads/catalog/presign.js'
import { signCatalogPut } from '../presignPut.js'
import {
  AWS_KEY,
  AWS_SECRET,
  BUCKET,
  COMPANY_ID,
  FIXED_NOW,
  HMAC_SECRET,
  OPERATION_A,
  OPERATION_B,
  REGION,
  USER_ID,
  authorizedEnv,
  makeChain,
  makeReq,
  makeSvc,
  mockRes,
  validBody,
} from './fixtures.js'

function adminSvc() {
  return makeSvc({ tables: { company_users: makeChain({ role: 'admin' }) } })
}

async function issue(overrides = {}) {
  const svc = adminSvc()
  const body = validBody(overrides.body)
  const result = await presignCatalogUpload({
    req: makeReq(body),
    body,
    svc,
    env: overrides.env ?? authorizedEnv(),
    now: () => overrides.now ?? FIXED_NOW,
    createOperationId: overrides.createOperationId ?? (() => OPERATION_A),
  })
  return { result, svc }
}

describe('assinatura, token e resposta do presign', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('assina os cabeçalhos obrigatórios, o tamanho, o tipo e o TTL de 300s', async () => {
    const { result } = await issue()
    expect(result.status).toBe(200)
    const url = new URL(result.body.putUrl)
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host;if-none-match')
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(PUT_TTL_SECONDS))
    expect(result.body.expiresIn).toBe(300)
    expect(result.body.putHeaders).toEqual({
      'Content-Type': 'image/png',
      'If-None-Match': '*',
    })
    expect(result.body.putHeaders['Content-Length']).toBeUndefined()
  })

  it('gera chave no servidor e UUID distinto entre operações', async () => {
    const first = await issue({ createOperationId: () => OPERATION_A })
    const second = await issue({ createOperationId: () => OPERATION_B })
    expect(first.result.body.operationId).toBe(OPERATION_A)
    expect(second.result.body.operationId).toBe(OPERATION_B)
    expect(first.result.body.s3_key).not.toBe(second.result.body.s3_key)
    expect(first.result.body.s3_key).toContain(`/whatsapp/2026/11/25/${OPERATION_A}/foto.png`)
    expect(second.result.body.s3_key).toContain(`/${OPERATION_B}/foto.png`)
  })

  it('muda a assinatura quando o tamanho autorizado muda', async () => {
    const credentials = {
      accessKeyId: AWS_KEY,
      secretAccessKey: AWS_SECRET,
      bucket: BUCKET,
      region: REGION,
    }
    const key = `clientes/${COMPANY_ID}/whatsapp/2026/11/25/${OPERATION_A}/foto.png`
    const smaller = await signCatalogPut({
      credentials,
      key,
      contentLength: 1024,
      contentType: 'image/png',
    })
    const larger = await signCatalogPut({
      credentials,
      key,
      contentLength: 1025,
      contentType: 'image/png',
    })
    const left = new URL(smaller.putUrl).searchParams.get('X-Amz-Signature')
    const right = new URL(larger.putUrl).searchParams.get('X-Amz-Signature')
    expect(left).not.toBe(right)
  })

  it('falha fechado quando a assinatura não contém um cabeçalho obrigatório', async () => {
    const svc = adminSvc()
    const body = validBody()
    const result = await presignCatalogUpload({
      req: makeReq(body),
      body,
      svc,
      env: authorizedEnv(),
      createOperationId: () => OPERATION_A,
      signPut: async () => ({
        putUrl: 'https://example-bucket.s3.us-east-1.amazonaws.com/k?X-Amz-SignedHeaders=content-length;host&X-Amz-Expires=300',
        putHeaders: { 'Content-Type': 'image/png', 'If-None-Match': '*' },
      }),
    })
    expect(result).toEqual({ status: 500, body: { error: 'Falha ao preparar upload' } })
  })

  it('emite e verifica token por 900s, vinculado à operação autorizada', async () => {
    const { result } = await issue()
    const issuedAt = Math.floor(FIXED_NOW.getTime() / 1000)
    const verified = verifyConfirmToken(HMAC_SECRET, result.body.confirmToken, issuedAt)
    expect(result.body.confirmExpiresIn).toBe(CONFIRM_TTL_SECONDS)
    expect(verified.ok).toBe(true)
    expect(verified.claims).toMatchObject({
      v: 1,
      operationId: OPERATION_A,
      userId: USER_ID,
      companyId: COMPANY_ID,
      context: 'catalog',
      sourceType: 'product',
      s3Key: result.body.s3_key,
      originalFileName: 'foto.png',
      sizeBytes: 1024,
      mimeType: 'image/png',
      bucket: BUCKET,
      region: REGION,
      issuedAt,
      expiresAt: issuedAt + 900,
    })
    expect(verifyConfirmToken(HMAC_SECRET, result.body.confirmToken, issuedAt + 900).ok).toBe(false)
    expect(verifyConfirmToken('b'.repeat(32), result.body.confirmToken, issuedAt).ok).toBe(false)
  })

  it('rejeita segredo ausente ou curto sem resolver credenciais', async () => {
    const missing = await issue({ env: {} })
    const short = await issue({ env: { MEDIA_CATALOG_UPLOAD_TOKEN_SECRET: 'curto' } })
    expect(missing.result.status).toBe(500)
    expect(short.result.status).toBe(500)
    expect(missing.svc.rpc).not.toHaveBeenCalled()
    expect(short.svc.rpc).not.toHaveBeenCalled()
  })

  it('rejeita token adulterado, versão inválida, expirado e campos extras', async () => {
    const { result } = await issue()
    const issuedAt = Math.floor(FIXED_NOW.getTime() / 1000)
    const [version, payload, signature] = result.body.confirmToken.split('.')
    const flipped = `${version}.${payload}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`
    const otherVersion = `v2.${payload}.${signature}`
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    parsed.extra = true
    const extra = `${version}.${Buffer.from(JSON.stringify(parsed)).toString('base64url')}.${signature}`
    expect(verifyConfirmToken(HMAC_SECRET, flipped, issuedAt).ok).toBe(false)
    expect(verifyConfirmToken(HMAC_SECRET, otherVersion, issuedAt).ok).toBe(false)
    expect(verifyConfirmToken(HMAC_SECRET, extra, issuedAt).ok).toBe(false)
    expect(verifyConfirmToken(HMAC_SECRET, result.body.confirmToken, issuedAt - 1).ok).toBe(false)
    expect(result.body.confirmToken.length).toBeLessThanOrEqual(4096)
  })

  it('não devolve credencial permanente, não grava metadado e não registra segredo', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const svc = adminSvc()
    const previousKey = process.env.AWS_ACCESS_KEY_ID
    const previousSecret = process.env.AWS_SECRET_ACCESS_KEY
    process.env.AWS_ACCESS_KEY_ID = 'AKIABADENVKEY00000'
    process.env.AWS_SECRET_ACCESS_KEY = 'env-secret-must-not-be-used'
    const body = validBody()
    const res = mockRes()
    try {
      await handleCatalogPresign(makeReq(body), res, {
        svc,
        env: authorizedEnv(),
        now: () => FIXED_NOW,
        createOperationId: () => OPERATION_A,
      })
    } finally {
      if (previousKey === undefined) delete process.env.AWS_ACCESS_KEY_ID
      else process.env.AWS_ACCESS_KEY_ID = previousKey
      if (previousSecret === undefined) delete process.env.AWS_SECRET_ACCESS_KEY
      else process.env.AWS_SECRET_ACCESS_KEY = previousSecret
    }

    expect(res.statusCode).toBe(200)
    expect(res.headers['Cache-Control']).toBe('no-store')
    expect(res.body.access_key_id).toBeUndefined()
    expect(res.body.secret_access_key).toBeUndefined()
    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain(AWS_SECRET)
    expect(serialized).not.toContain(HMAC_SECRET)
    expect(serialized).not.toContain('env-secret-must-not-be-used')
    expect(res.body.putUrl).toContain('X-Amz-Credential=')
    expect(svc.from).not.toHaveBeenCalledWith('company_media_library')
    expect(svc.rpc).toHaveBeenCalledTimes(1)
    const logged = [...log.mock.calls, ...error.mock.calls].flat().join(' ')
    expect(logged).not.toContain(AWS_SECRET)
    expect(logged).not.toContain(res.body.confirmToken)
    expect(logged).not.toContain(res.body.putUrl)
  })

  it('responde 405 para método diferente de POST', async () => {
    const res = mockRes()
    await handleCatalogPresign({ method: 'GET', headers: {}, body: validBody() }, res, {
      svc: adminSvc(),
      env: authorizedEnv(),
    })
    expect(res.statusCode).toBe(405)
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('deriva a URL pública no padrão atual e mantém o segredo fora do token', async () => {
    const { result } = await issue()
    const url = derivePublicObjectUrl(BUCKET, REGION, result.body.s3_key)
    expect(url).toBe(`https://${BUCKET}.s3.${REGION}.amazonaws.com/${result.body.s3_key}`)
    expect(result.body.confirmToken).not.toContain(AWS_SECRET)
    expect(result.body.confirmToken).not.toContain(AWS_KEY)
  })

  it('não consulta a RPC quando as credenciais de ambiente estão presentes e o pedido é negado', async () => {
    const svc = makeSvc({ authError: new Error('invalid') })
    process.env.AWS_SECRET_ACCESS_KEY = 'env-secret-must-not-be-used'
    const result = await presignCatalogUpload({
      req: makeReq(validBody()),
      body: validBody(),
      svc,
      env: { ...authorizedEnv(), AWS_SECRET_ACCESS_KEY: 'env-secret-must-not-be-used' },
    })
    delete process.env.AWS_SECRET_ACCESS_KEY
    expect(result.status).toBe(401)
    expect(svc.rpc).not.toHaveBeenCalled()
  })
})

describe('limites estáticos da infraestrutura', () => {
  it('não usa chave anon, fallback AWS nem persistência', () => {
    const credentials = readFileSync(new URL('../credentials.js', import.meta.url), 'utf8')
    const presign = readFileSync(new URL('../presignCatalogUpload.js', import.meta.url), 'utf8')
    expect(credentials).not.toContain('ANON')
    expect(credentials).not.toContain('AWS_ACCESS_KEY_ID')
    expect(credentials).not.toContain('AWS_SECRET_ACCESS_KEY')
    expect(presign).not.toContain('company_media_library')
    expect(presign).not.toContain('console.')
  })
})
