import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleCatalogPresign } from '../../../../media/uploads/catalog/presign.js'
import { assertPresignedPut, signCatalogPut } from '../presignPut.js'
import { CatalogUploadError } from '../errors.js'
import { presignCatalogUpload } from '../presignCatalogUpload.js'
import {
  AWS_KEY,
  AWS_SECRET,
  BUCKET,
  COMPANY_ID,
  PARENT_ID,
  REGION,
  acceptedPut,
  authorizedEnv,
  makeChain,
  makeReq,
  makeSvc,
  mockRes,
  validBody,
} from './fixtures.js'

const KEY = `clientes/${COMPANY_ID}/whatsapp/2026/11/25/11111111-1111-4111-8111-111111111111/foto.png`

function adminSvc(overrides = {}) {
  return makeSvc({
    tables: { company_users: makeChain({ role: 'admin' }) },
    ...overrides,
  })
}

async function presign(body, extra = {}) {
  const svc = extra.svc ?? adminSvc()
  const signPut = extra.signPut ?? vi.fn(acceptedPut)
  const result = await presignCatalogUpload({
    req: extra.req ?? makeReq(body),
    body,
    svc,
    env: authorizedEnv(),
    signPut,
  })
  return { result, svc, signPut }
}

describe('controles complementares do presign', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('JWT válido com UUID inválido não consulta empresa nem credenciais', async () => {
    const { result, svc, signPut } = await presign(validBody({ companyId: 'nao-e-uuid' }))
    expect(result.status).toBe(400)
    expect(svc.auth.getUser).toHaveBeenCalledWith('valid-token')
    expect(svc.from).not.toHaveBeenCalled()
    expect(svc.rpc).not.toHaveBeenCalled()
    expect(signPut).not.toHaveBeenCalled()
  })

  it('rejeita corpo null, array e campos extras antes da autorização', async () => {
    const nullBody = await presign(null)
    const arrayBody = await presign([])
    const extra = await presign({ ...validBody(), role: 'super_admin' })
    expect(nullBody.result.status).toBe(400)
    expect(arrayBody.result.status).toBe(400)
    expect(extra.result.status).toBe(400)
    expect(nullBody.svc.auth.getUser).not.toHaveBeenCalled()
    expect(arrayBody.svc.auth.getUser).not.toHaveBeenCalled()
    expect(extra.svc.auth.getUser).not.toHaveBeenCalled()
  })

  it('trata corpo textual malformado como pedido inválido no handler', async () => {
    const svc = adminSvc()
    const res = mockRes()
    await handleCatalogPresign(makeReq('{"companyId":'), res, { svc, env: authorizedEnv() })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Pedido inválido' })
    expect(svc.auth.getUser).not.toHaveBeenCalled()
    expect(svc.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['erro da RPC', { rpcError: { message: 'secret rpc detail', code: 'XX000' } }],
    ['retorno nulo', { rpcData: null }],
    ['lista vazia', { rpcData: [] }],
    ['mais de uma linha', { rpcData: [{ access_key_id: AWS_KEY, secret_access_key: AWS_SECRET, bucket: BUCKET, region: REGION }, { access_key_id: 'AKIAB', secret_access_key: 'second', bucket: BUCKET, region: REGION }] }],
    ['campo obrigatório ausente', { rpcData: [{ access_key_id: AWS_KEY, bucket: BUCKET, region: REGION }] }],
    ['bucket inválido', { rpcData: [{ access_key_id: AWS_KEY, secret_access_key: AWS_SECRET, bucket: '../bucket', region: REGION }] }],
    ['região inválida', { rpcData: [{ access_key_id: AWS_KEY, secret_access_key: AWS_SECRET, bucket: BUCKET, region: 'US-EAST-1' }] }],
  ])('rejeita credencial com %s', async (_label, overrides) => {
    const svc = adminSvc(overrides)
    const signPut = vi.fn(acceptedPut)
    const result = await presignCatalogUpload({
      req: makeReq(validBody()),
      body: validBody(),
      svc,
      env: authorizedEnv(),
      signPut,
    })
    expect(result).toEqual({ status: 500, body: { error: 'Upload indisponível' } })
    expect(JSON.stringify(result)).not.toContain('secret rpc detail')
    expect(JSON.stringify(result)).not.toContain(AWS_SECRET)
    expect(signPut).not.toHaveBeenCalled()
  })

  it('exceção da RPC não vaza detalhe interno', async () => {
    const svc = adminSvc()
    svc.rpc.mockRejectedValue(new Error('connection reset secret rpc detail'))
    const { result, signPut } = await presign(validBody(), { svc, signPut: vi.fn(acceptedPut) })
    expect(result).toEqual({ status: 500, body: { error: 'Upload indisponível' } })
    expect(JSON.stringify(result)).not.toContain('secret rpc detail')
    expect(signPut).not.toHaveBeenCalled()
  })

  it('credencial herdada não substitui a empresa autorizada na chave', async () => {
    const svc = adminSvc({
      rpcData: [{
        company_id: PARENT_ID,
        access_key_id: AWS_KEY,
        secret_access_key: AWS_SECRET,
        bucket: BUCKET,
        region: REGION,
      }],
    })
    const seen = []
    const { result } = await presign(validBody(), {
      svc,
      signPut: async (input) => {
        seen.push(input)
        return acceptedPut(input)
      },
    })
    expect(result.status).toBe(200)
    expect(seen[0].key.split('/')[1]).toBe(COMPANY_ID)
    expect(seen[0].key).not.toContain(PARENT_ID)
    expect(svc.rpc).toHaveBeenCalledWith('webhook_resolve_aws_credentials', { p_company_id: COMPANY_ID })
    expect(JSON.stringify(result.body)).not.toContain(AWS_SECRET)
  })

  it.each([
    ['protocolo http', ({ key, credentials }) => `http://${credentials.bucket}.s3.${credentials.region}.amazonaws.com/${key}`],
    ['host inesperado', ({ key }) => `https://evil.example/${key}`],
    ['caminho divergente', ({ credentials }) => `https://${credentials.bucket}.s3.${credentials.region}.amazonaws.com/outra-chave`],
    ['checksum inesperado', ({ key, credentials }) => `https://${credentials.bucket}.s3.${credentials.region}.amazonaws.com/${key}?X-Amz-SignedHeaders=content-length;content-type;host;if-none-match;x-amz-checksum-crc32&X-Amz-Expires=300`],
  ])('rejeita URL com %s sem emitir token', async (_label, build) => {
    const { result } = await presign(validBody(), {
      signPut: async ({ key, credentials, contentType }) => ({
        putUrl: build({ key, credentials }).includes('X-Amz-')
          ? build({ key, credentials })
          : `${build({ key, credentials })}?X-Amz-SignedHeaders=content-length;content-type;host;if-none-match&X-Amz-Expires=300`,
        putHeaders: { 'Content-Type': contentType, 'If-None-Match': '*' },
      }),
    })
    expect(result).toEqual({ status: 500, body: { error: 'Falha ao preparar upload' } })
    expect(result.body.confirmToken).toBeUndefined()
    expect(result.body.putUrl).toBeUndefined()
  })

  it('assinatura fictícia permanece sem checksum e sem segredo nos avisos', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const signed = await signCatalogPut({
      credentials: {
        accessKeyId: AWS_KEY,
        secretAccessKey: AWS_SECRET,
        bucket: BUCKET,
        region: REGION,
      },
      key: KEY,
      contentLength: 1024,
      contentType: 'image/png',
    })
    const regional = await signCatalogPut({
      credentials: {
        accessKeyId: AWS_KEY,
        secretAccessKey: AWS_SECRET,
        bucket: 'lovoo-media-test',
        region: 'sa-east-1',
      },
      key: KEY,
      contentLength: 1024,
      contentType: 'image/png',
    })
    const url = new URL(signed.putUrl)
    const regionalUrl = new URL(regional.putUrl)
    expect(url.protocol).toBe('https:')
    expect(url.username).toBe('')
    expect(url.password).toBe('')
    expect(url.hash).toBe('')
    expect(url.hostname).toBe(`${BUCKET}.s3.${REGION}.amazonaws.com`)
    expect(decodeURIComponent(url.pathname)).toBe(`/${KEY}`)
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host;if-none-match')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300')
    expect([...url.searchParams.keys()].some((name) => name.toLowerCase().includes('checksum'))).toBe(false)
    expect(signed.putHeaders).toEqual({
      'Content-Type': 'image/png',
      'If-None-Match': '*',
    })
    expect(regionalUrl.hostname).toBe('lovoo-media-test.s3.sa-east-1.amazonaws.com')
    expect(decodeURIComponent(regionalUrl.pathname)).toBe(`/${KEY}`)
    const legacy = `https://${BUCKET}.s3.amazonaws.com/${KEY}?X-Amz-SignedHeaders=content-length;content-type;host;if-none-match&X-Amz-Expires=300`
    expect(() => assertPresignedPut(legacy, { bucket: BUCKET, region: REGION, key: KEY })).not.toThrow()
    const pathStyle = `https://s3.sa-east-1.amazonaws.com/my.bucket/${KEY}?X-Amz-SignedHeaders=content-length;content-type;host;if-none-match&X-Amz-Expires=300`
    expect(() => assertPresignedPut(pathStyle, { bucket: 'my.bucket', region: 'sa-east-1', key: KEY })).toThrow(CatalogUploadError)
    await expect(signCatalogPut({
      credentials: {
        accessKeyId: AWS_KEY,
        secretAccessKey: AWS_SECRET,
        bucket: 'my.bucket',
        region: 'sa-east-1',
      },
      key: KEY,
      contentLength: 1024,
      contentType: 'image/png',
    })).rejects.toBeInstanceOf(CatalogUploadError)
    const emitted = [warn, log, error].flatMap((spy) => spy.mock.calls.flat()).join('\n')
    expect(emitted).not.toContain(AWS_SECRET)
    expect(emitted).not.toContain(AWS_KEY)
    expect(emitted.toLowerCase()).not.toContain('content-length')
  })
})
