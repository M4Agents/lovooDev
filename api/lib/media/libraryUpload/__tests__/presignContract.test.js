import { describe, expect, it, vi } from 'vitest'
import { verifyConfirmToken } from '../../catalogUpload/confirmToken.js'
import { signCatalogPut } from '../../catalogUpload/presignPut.js'
import {
  AWS_KEY,
  AWS_SECRET,
  BUCKET,
  COMPANY_ID,
  FIXED_NOW,
  OPERATION_A,
  REGION,
  USER_ID,
  makeChain,
  makeSvc,
} from '../../catalogUpload/__tests__/fixtures.js'
import { verifyLibraryConfirmToken } from '../confirmToken.js'
import {
  LIBRARY_IMAGE_MAX_BYTES,
  LIBRARY_MIME_TYPES,
  LIBRARY_OTHER_MAX_BYTES,
} from '../constants.js'
import { presignLibraryUpload } from '../presignLibraryUpload.js'
import {
  FOLDER_ID,
  acceptedPut,
  companyPlan,
  directSvc,
  libraryBody,
  libraryEnv,
  libraryReq,
} from './presignFixtures.js'

const SECRET = 'l'.repeat(32)
const ISSUED_AT = Math.floor(FIXED_NOW.getTime() / 1000)

async function presign(body = libraryBody(), extra = {}) {
  const svc = extra.svc ?? directSvc('admin')
  const signPut = extra.signPut ?? vi.fn(acceptedPut)
  const result = await presignLibraryUpload({
    req: extra.req ?? libraryReq(body),
    body,
    svc,
    env: extra.env === undefined ? libraryEnv(SECRET) : extra.env,
    now: () => FIXED_NOW,
    createOperationId: extra.createOperationId ?? (() => OPERATION_A),
    signPut,
  })
  return { result, svc, signPut }
}

describe('contrato do presign da biblioteca', () => {
  it.each(LIBRARY_MIME_TYPES)('aceita %s no limite inclusivo', async (mimeType) => {
    const image = mimeType.startsWith('image/')
    const { result } = await presign(libraryBody({
      fileName: 'arquivo.bin',
      mimeType,
      sizeBytes: image ? LIBRARY_IMAGE_MAX_BYTES : LIBRARY_OTHER_MAX_BYTES,
    }))
    expect(result.status).toBe(200)
    expect(result.body.putHeaders['Content-Type']).toBe(mimeType)
    const verified = verifyLibraryConfirmToken(SECRET, result.body.confirmToken, ISSUED_AT)
    expect(verified.ok).toBe(true)
    expect(verified.claims.mimeType).toBe(mimeType)
  })

  it.each([
    ['image/svg+xml', 1024, 415],
    ['application/octet-stream', 1024, 415],
    ['image/*', 1024, 415],
    ['video/webm', 1024, 415],
    ['audio/aac', 1024, 415],
    ['image/png', LIBRARY_IMAGE_MAX_BYTES + 1, 413],
    ['video/mp4', LIBRARY_OTHER_MAX_BYTES + 1, 413],
    ['audio/mpeg', LIBRARY_OTHER_MAX_BYTES + 1, 413],
    ['application/pdf', LIBRARY_OTHER_MAX_BYTES + 1, 413],
  ])('rejeita %s com %d bytes em %d antes da AWS', async (mimeType, sizeBytes, status) => {
    const { result, svc, signPut } = await presign(libraryBody({
      fileName: 'arquivo.bin',
      mimeType,
      sizeBytes,
    }))
    expect(result.status).toBe(status)
    expect(svc.rpc).not.toHaveBeenCalled()
    expect(signPut).not.toHaveBeenCalled()
  })

  it('rejeita nome inseguro e corpo estrito antes da AWS', async () => {
    const unsafe = await presign(libraryBody({ fileName: '../segredo.png' }))
    const extra = await presign({ ...libraryBody(), operationId: OPERATION_A })
    expect(unsafe.result.status).toBe(400)
    expect(extra.result.status).toBe(400)
    expect(unsafe.svc.rpc).not.toHaveBeenCalled()
    expect(extra.svc.auth.getUser).not.toHaveBeenCalled()
    expect(unsafe.signPut).not.toHaveBeenCalled()
    expect(extra.signPut).not.toHaveBeenCalled()
  })

  it('bloqueia quota excedida e falha de leitura sem resolver AWS', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exceededSvc = directSvc('admin', { id: FOLDER_ID, is_system_folder: false }, {
      companies: companyPlan(1),
    })
    exceededSvc.rpc.mockResolvedValue({ data: 0, error: null })
    const exceeded = await presign(libraryBody({ sizeBytes: LIBRARY_IMAGE_MAX_BYTES }), {
      svc: exceededSvc,
    })
    const failed = await presign(libraryBody(), {
      svc: makeSvc({
        tables: {
          company_users: makeChain({ role: 'admin' }),
          company_folders: makeChain({ id: FOLDER_ID }),
          companies: companyPlan(100),
        },
        rpcError: { message: 'leitura-plano', code: 'XX000' },
      }),
    })
    const unavailable = await presign(libraryBody(), {
      svc: makeSvc({
        tables: {
          company_users: makeChain({ role: 'admin' }),
          company_folders: makeChain({ id: FOLDER_ID }),
          companies: makeChain(null, { message: 'segredo-plano', code: '57014' }),
        },
      }),
    })
    expect(exceeded.result.status).toBe(403)
    expect(exceeded.result.body.error).toBe('plan_storage_limit_exceeded')
    expect(failed.result.status).toBe(403)
    expect(failed.result.body.error).toBe('plan_validation_failed')
    expect(unavailable.result.body).toEqual({
      error: 'plan_validation_failed',
      message: 'Não foi possível validar o armazenamento do seu plano. Tente novamente em instantes.',
    })
    expect(JSON.stringify([failed.result.body, unavailable.result.body, errorSpy.mock.calls])).not.toContain('leitura-plano')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('segredo-plano')
    expect(errorSpy).toHaveBeenCalledWith('[assertStorageLimitStrict] plan_validation_failed', '57014')
    for (const run of [exceeded, failed, unavailable]) {
      expect(run.svc.rpc.mock.calls.map((call) => call[0])).not.toContain('webhook_resolve_aws_credentials')
      expect(run.signPut).not.toHaveBeenCalled()
    }
    expect(unavailable.svc.rpc).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('exige o segredo da biblioteca antes das credenciais', async () => {
    const missing = await presign(libraryBody(), { env: {} })
    const catalogOnly = await presign(libraryBody(), {
      env: { MEDIA_CATALOG_UPLOAD_TOKEN_SECRET: SECRET },
    })
    const short = await presign(libraryBody(), { env: libraryEnv('curto') })
    expect(missing.result).toEqual({ status: 500, body: { error: 'Falha ao preparar upload' } })
    expect(catalogOnly.result.status).toBe(500)
    expect(short.result.status).toBe(500)
    expect(missing.svc.rpc).not.toHaveBeenCalled()
    expect(catalogOnly.svc.rpc).not.toHaveBeenCalled()
    expect(short.svc.rpc).not.toHaveBeenCalled()
    expect(missing.signPut).not.toHaveBeenCalled()
  })

  it('falha de resolução AWS não assina o PUT', async () => {
    const rpcError = await presign(libraryBody(), {
      svc: makeSvc({
        tables: {
          company_users: makeChain({ role: 'admin' }),
          company_folders: makeChain({ id: FOLDER_ID }),
          companies: companyPlan(null),
        },
        rpcError: { message: AWS_SECRET },
      }),
    })
    const malformed = await presign(libraryBody(), {
      svc: makeSvc({
        tables: {
          company_users: makeChain({ role: 'admin' }),
          company_folders: makeChain({ id: FOLDER_ID }),
          companies: companyPlan(null),
        },
        rpcData: [{ access_key_id: AWS_KEY, secret_access_key: AWS_SECRET, bucket: 'ERR', region: REGION }],
      }),
    })
    expect(rpcError.result).toEqual({ status: 500, body: { error: 'Upload indisponível' } })
    expect(malformed.result.status).toBe(500)
    expect(JSON.stringify([rpcError.result, malformed.result])).not.toContain(AWS_SECRET)
    expect(rpcError.signPut).not.toHaveBeenCalled()
    expect(malformed.signPut).not.toHaveBeenCalled()
  })

  it('gera chave, headers, assinatura e token no servidor', async () => {
    const { result } = await presign(libraryBody(), { signPut: signCatalogPut })
    const url = new URL(result.body.putUrl)
    expect(result.body).toMatchObject({
      operationId: OPERATION_A,
      expiresIn: 300,
      confirmExpiresIn: 900,
      s3_key: `clientes/${COMPANY_ID}/library/2026/11/25/${OPERATION_A}/foto.png`,
      putHeaders: { 'Content-Type': 'image/png', 'If-None-Match': '*' },
    })
    expect(Object.keys(result.body.putHeaders)).toEqual(['Content-Type', 'If-None-Match'])
    expect([
      `${BUCKET}.s3.${REGION}.amazonaws.com`,
      `${BUCKET}.s3.amazonaws.com`,
    ]).toContain(url.hostname)
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host;if-none-match')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300')
    expect(result.body.putUrl).not.toContain(AWS_SECRET)
    expect(result.body).not.toHaveProperty('accessKeyId')
    expect(result.body).not.toHaveProperty('secretAccessKey')
    expect(JSON.stringify(result.body)).not.toContain(AWS_SECRET)

    const verified = verifyLibraryConfirmToken(SECRET, result.body.confirmToken, ISSUED_AT)
    expect(verified.ok).toBe(true)
    expect(verified.claims).toMatchObject({
      context: 'library',
      userId: USER_ID,
      companyId: COMPANY_ID,
      folderId: FOLDER_ID,
      operationId: OPERATION_A,
      mimeType: 'image/png',
      fileType: 'image',
      sizeBytes: 1024,
      bucket: BUCKET,
      region: REGION,
      expiresAt: ISSUED_AT + 900,
    })
    expect(verifyConfirmToken(SECRET, result.body.confirmToken, ISSUED_AT).ok).toBe(false)
  })
})
