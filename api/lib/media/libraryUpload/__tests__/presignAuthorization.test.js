import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { presignLibraryUpload } from '../presignLibraryUpload.js'
import { handleLibraryPresign } from '../../../../media/uploads/library/presign.js'
import {
  ASSIGNMENT_ID,
  AWS_KEY,
  AWS_SECRET,
  COMPANY_ID,
  FIXED_NOW,
  OPERATION_A,
  OTHER_ID,
  makeChain,
  makeSvc,
  mockRes,
} from '../../catalogUpload/__tests__/fixtures.js'
import {
  FOLDER_ID,
  companyPlan,
  directSvc,
  inheritedPartnerSvc,
  libraryBody,
  libraryEnv,
  libraryReq,
  parentLibrarySvc,
} from './presignFixtures.js'

function credentialCalls(svc) {
  return svc.rpc.mock.calls.filter((call) => call[0] === 'webhook_resolve_aws_credentials')
}

async function presign(svc, body = libraryBody(), extra = {}) {
  const signPut = extra.signPut ?? vi.fn(async ({ key, credentials, contentType }) => ({
    putUrl: `https://${credentials.bucket}.s3.${credentials.region}.amazonaws.com/${key}?X-Amz-SignedHeaders=content-length;content-type;host;if-none-match&X-Amz-Expires=300`,
    putHeaders: { 'Content-Type': contentType, 'If-None-Match': '*' },
  }))
  const result = await presignLibraryUpload({
    req: extra.req ?? libraryReq(body),
    body,
    svc,
    env: extra.env ?? libraryEnv(),
    now: () => FIXED_NOW,
    createOperationId: () => OPERATION_A,
    signPut,
  })
  return { result, signPut }
}

describe('autorização do presign da biblioteca', () => {
  it.each(['super_admin', 'system_admin', 'admin', 'manager', 'seller', 'partner'])(
    'autoriza %s com membership direta',
    async (role) => {
      const extra = role === 'partner'
        ? { partner_company_assignments: makeChain({ id: ASSIGNMENT_ID }) }
        : {}
      const svc = directSvc(role, { id: FOLDER_ID, is_system_folder: false }, extra)
      const { result, signPut } = await presign(svc)
      expect(result.status).toBe(200)
      expect(signPut).toHaveBeenCalledOnce()
    },
  )

  it('nega partner direto sem assignment e não resolve AWS', async () => {
    const svc = directSvc('partner')
    const { result, signPut } = await presign(svc)
    expect(result).toEqual({
      status: 403,
      body: { error: 'Partner sem assignment ativo para esta empresa' },
    })
    expect(credentialCalls(svc)).toHaveLength(0)
    expect(signPut).not.toHaveBeenCalled()
  })

  it.each(['super_admin', 'system_admin'])('herda %s da empresa pai', async (role) => {
    const { result } = await presign(parentLibrarySvc(role))
    expect(result.status).toBe(200)
  })

  it.each(['admin', 'manager', 'seller'])('nega %s da empresa pai', async (role) => {
    const svc = parentLibrarySvc(role)
    const { result, signPut } = await presign(svc)
    expect(result.status).toBe(403)
    expect(credentialCalls(svc)).toHaveLength(0)
    expect(signPut).not.toHaveBeenCalled()
  })

  it('autoriza partner herdado com assignment', async () => {
    const { result } = await presign(inheritedPartnerSvc())
    expect(result.status).toBe(200)
    expect(result.body.s3_key).toContain('/library/')
  })

  it('nega partner herdado sem assignment', async () => {
    const svc = inheritedPartnerSvc(null)
    const { result, signPut } = await presign(svc)
    expect(result.status).toBe(403)
    expect(credentialCalls(svc)).toHaveLength(0)
    expect(signPut).not.toHaveBeenCalled()
  })

  it('nega empresa sem membership', async () => {
    const svc = makeSvc({ tables: { company_users: makeChain(null) } })
    const { result, signPut } = await presign(svc, libraryBody({ companyId: OTHER_ID }))
    expect(result).toEqual({ status: 403, body: { error: 'Acesso negado a esta empresa' } })
    expect(svc.rpc).not.toHaveBeenCalled()
    expect(signPut).not.toHaveBeenCalled()
  })

  it('responde 404 para pasta ausente na empresa autorizada', async () => {
    const svc = makeSvc({
      tables: {
        company_users: makeChain({ role: 'admin' }),
        company_folders: makeChain(null),
      },
    })
    const { result, signPut } = await presign(svc)
    expect(result).toEqual({ status: 404, body: { error: 'Pasta não encontrada' } })
    expect(svc.rpc).not.toHaveBeenCalled()
    expect(signPut).not.toHaveBeenCalled()
  })

  it('permite pasta comum e pasta de sistema', async () => {
    const common = makeChain({ id: FOLDER_ID, is_system_folder: false })
    const system = makeChain({ id: FOLDER_ID, is_system_folder: true })
    const commonSvc = makeSvc({
      tables: {
        company_users: makeChain({ role: 'seller' }),
        company_folders: common,
        companies: companyPlan(null),
      },
    })
    const systemSvc = makeSvc({
      tables: {
        company_users: makeChain({ role: 'seller' }),
        company_folders: system,
        companies: companyPlan(null),
      },
    })
    expect((await presign(commonSvc)).result.status).toBe(200)
    expect((await presign(systemSvc)).result.status).toBe(200)
    expect(common.eq.mock.calls.map((call) => call[0])).not.toContain('is_system_folder')
    expect(system.eq.mock.calls.map((call) => call[0])).not.toContain('is_system_folder')
  })

  it('falha técnica de autorização não resolve AWS', async () => {
    const query = makeSvc({
      tables: { company_users: makeChain(null, { message: 'segredo-consulta' }) },
    })
    const thrown = makeSvc()
    thrown.auth.getUser.mockRejectedValue(new Error('segredo-auth'))
    const missing = makeSvc()
    const queryResult = await presign(query)
    const thrownResult = await presign(thrown)
    const missingResult = await presign(missing, libraryBody(), {
      req: libraryReq(libraryBody(), ''),
    })
    expect(queryResult.result).toEqual({
      status: 503,
      body: { error: 'Autorização temporariamente indisponível' },
    })
    expect(thrownResult.result.status).toBe(503)
    expect(missingResult.result).toEqual({ status: 401, body: { error: 'Autenticação necessária' } })
    expect(JSON.stringify([queryResult.result, thrownResult.result])).not.toContain('segredo')
    expect(query.rpc).not.toHaveBeenCalled()
    expect(thrown.rpc).not.toHaveBeenCalled()
    expect(queryResult.signPut).not.toHaveBeenCalled()
    expect(thrownResult.signPut).not.toHaveBeenCalled()
  })

  it('falha técnica da pasta responde 503 sem vazar a consulta', async () => {
    const svc = makeSvc({
      tables: {
        company_users: makeChain({ role: 'admin' }),
        company_folders: makeChain(null, { message: 'segredo-pasta' }),
      },
    })
    const thrown = makeSvc({ tables: { company_users: makeChain({ role: 'admin' }) } })
    thrown.from.mockImplementation((table) => {
      if (table === 'company_users') return makeChain({ role: 'admin' })
      throw new Error('segredo-pasta')
    })
    const query = await presign(svc)
    const exception = await presign(thrown)
    expect(query.result).toEqual({
      status: 503,
      body: { error: 'Preparação temporariamente indisponível' },
    })
    expect(exception.result.status).toBe(503)
    expect(JSON.stringify([query.result, exception.result])).not.toContain('segredo')
    expect(svc.rpc).not.toHaveBeenCalled()
    expect(thrown.rpc).not.toHaveBeenCalled()
    expect(query.signPut).not.toHaveBeenCalled()
  })

  it('o handler preserva 405, no-store e erro sanitizado', async () => {
    const res = mockRes()
    await handleLibraryPresign({ method: 'GET', headers: {}, body: libraryBody() }, res)
    expect(res.statusCode).toBe(405)
    expect(res.headers['Cache-Control']).toBe('no-store')

    const denied = mockRes()
    await handleLibraryPresign(
      { method: 'POST', headers: {}, body: null },
      denied,
      { svc: makeSvc() },
    )
    expect(denied.body).toEqual({ error: 'Pedido inválido' })

    const broken = mockRes()
    await handleLibraryPresign(
      { method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: libraryBody() },
      broken,
      { svc: directSvc('admin'), env: libraryEnv(), signPut: () => { throw new Error(AWS_SECRET) } },
    )
    expect(broken.statusCode).toBe(500)
    expect(broken.body).toEqual({ error: 'Falha ao preparar upload' })
    expect(JSON.stringify(broken.body)).not.toContain(AWS_SECRET)
    expect(JSON.stringify(broken.body)).not.toContain(AWS_KEY)
  })

  it('não registra token, segredo nem URL assinada', () => {
    const source = [
      readFileSync(new URL('../presignLibraryUpload.js', import.meta.url), 'utf8'),
      readFileSync(new URL('../../../../media/uploads/library/presign.js', import.meta.url), 'utf8'),
    ].join('\n')
    expect(source).not.toMatch(/console\.(log|info|debug|warn|error)/)
    expect(source).not.toContain('secretAccessKey')
    expect(source).not.toContain(COMPANY_ID)
  })
})
