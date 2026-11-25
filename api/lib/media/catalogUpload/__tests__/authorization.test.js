import { describe, expect, it } from 'vitest'
import { presignCatalogUpload } from '../presignCatalogUpload.js'
import { handleCatalogPresign } from '../../../../media/uploads/catalog/presign.js'
import {
  COMPANY_ID,
  authorizedEnv,
  acceptedPut,
  makeChain,
  makeReq,
  makeSvc,
  mockRes,
  parentSvc,
  validBody,
} from './fixtures.js'

async function presign(svc, body = validBody(), env = authorizedEnv(), extra = {}) {
  return presignCatalogUpload({
    req: extra.req ?? makeReq(body),
    body,
    svc,
    env,
    now: extra.now,
    createOperationId: extra.createOperationId,
    signPut: extra.signPut,
  })
}

describe('autorização do presign de catálogo', () => {
  it('nega ausência de Bearer antes de consultar credenciais', async () => {
    const svc = makeSvc()
    const result = await presign(svc, validBody(), authorizedEnv(), {
      req: { method: 'POST', headers: {}, body: validBody() },
    })
    expect(result).toEqual({ status: 401, body: { error: 'Autenticação necessária' } })
    expect(svc.auth.getUser).not.toHaveBeenCalled()
    expect(svc.rpc).not.toHaveBeenCalled()
  })

  it('nega JWT inválido', async () => {
    const svc = makeSvc({ authError: new Error('invalid_jwt') })
    const result = await presign(svc)
    expect(result.status).toBe(401)
    expect(svc.rpc).not.toHaveBeenCalled()
  })

  it('nega membership inativa', async () => {
    const users = makeChain(null)
    const svc = makeSvc({ tables: { company_users: users, companies: makeChain(null) } })
    const result = await presign(svc)
    expect(result.status).toBe(403)
    expect(users.eq).toHaveBeenCalledWith('is_active', true)
    expect(svc.rpc).not.toHaveBeenCalled()
  })

  it('nega empresa de outro tenant', async () => {
    const svc = makeSvc({ tables: { company_users: makeChain(null), companies: makeChain(null) } })
    const result = await presign(svc)
    expect(result).toEqual({ status: 403, body: { error: 'Acesso negado a esta empresa' } })
    expect(svc.rpc).not.toHaveBeenCalled()
  })

  it('nega role desconhecido e seller', async () => {
    const unknown = await presign(makeSvc({ tables: { company_users: makeChain({ role: 'auditor' }) } }))
    const seller = await presign(makeSvc({ tables: { company_users: makeChain({ role: 'seller' }) } }))
    expect(unknown.status).toBe(403)
    expect(seller.status).toBe(403)
  })

  it('nega partner com assignment e partner sem assignment', async () => {
    const withAssignment = makeSvc({
      tables: {
        company_users: makeChain({ role: 'partner' }),
        partner_company_assignments: makeChain({ id: 'eeee0000-0000-4000-8000-000000000005' }),
      },
    })
    const withoutAssignment = makeSvc({
      tables: {
        company_users: makeChain({ role: 'partner' }),
        partner_company_assignments: makeChain(null),
      },
    })
    expect((await presign(withAssignment)).status).toBe(403)
    expect((await presign(withoutAssignment)).status).toBe(403)
    expect(withAssignment.rpc).not.toHaveBeenCalled()
    expect(withoutAssignment.rpc).not.toHaveBeenCalled()
  })

  it.each(['admin', 'manager', 'super_admin', 'system_admin'])('autoriza %s da própria empresa', async (role) => {
    const svc = makeSvc({ tables: { company_users: makeChain({ role }) } })
    const result = await presign(svc, validBody(), authorizedEnv(), {
      createOperationId: () => '11111111-1111-4111-8111-111111111111',
      signPut: acceptedPut,
    })
    expect(result.status).toBe(200)
    expect(result.body.s3_key).toContain(COMPANY_ID)
    expect(svc.rpc).toHaveBeenCalledWith('webhook_resolve_aws_credentials', { p_company_id: COMPANY_ID })
  })

  it('autoriza super_admin e system_admin da empresa pai sobre a filha', async () => {
    for (const role of ['super_admin', 'system_admin']) {
      const svc = parentSvc(role)
      const result = await presign(svc, validBody(), authorizedEnv(), {
        createOperationId: () => '11111111-1111-4111-8111-111111111111',
        signPut: acceptedPut,
      })
      expect(result.status).toBe(200)
      expect(result.body.s3_key).toContain(`/${COMPANY_ID}/`)
    }
  })

  it('nega relação parent/client inválida e admin da pai', async () => {
    const foreign = makeSvc({
      tableSeq: {
        company_users: [
          makeChain(null),
          makeChain({
            role: 'system_admin',
            company_id: 'cccc0000-0000-4000-8000-000000000003',
            companies: { company_type: 'parent' },
          }),
        ],
        companies: [makeChain({ parent_company_id: 'dddd0000-0000-4000-8000-000000000004' })],
      },
    })
    const parentAdmin = parentSvc('admin')
    expect((await presign(foreign)).status).toBe(403)
    expect((await presign(parentAdmin)).status).toBe(403)
    expect(foreign.rpc).not.toHaveBeenCalled()
    expect(parentAdmin.rpc).not.toHaveBeenCalled()
  })

  it('não trata impersonação enviada pelo cliente como autorização', async () => {
    const svc = makeSvc({ tables: { company_users: makeChain({ role: 'seller' }) } })
    const result = await presign(svc, { ...validBody(), impersonating: true })
    expect(result).toEqual({ status: 400, body: { error: 'Pedido inválido' } })
    expect(svc.auth.getUser).not.toHaveBeenCalled()
    expect(svc.rpc).not.toHaveBeenCalled()
  })

  it('falha de consulta não abre acesso nem resolve credenciais', async () => {
    const svc = makeSvc({
      tables: {
        company_users: makeChain(null, { message: 'db down' }),
        companies: makeChain(null, { message: 'db down' }),
      },
    })
    const result = await presign(svc)
    expect(result.status).toBe(503)
    expect(result.body).toEqual({ error: 'Autorização temporariamente indisponível' })
    expect(JSON.stringify(result.body)).not.toContain('db down')
    expect(svc.rpc).not.toHaveBeenCalled()
  })

  it('exceção de consulta vira erro sanitizado no handler', async () => {
    const svc = makeSvc()
    svc.from.mockImplementation(() => {
      throw new Error('segredo interno db down')
    })
    const res = mockRes()
    await handleCatalogPresign(makeReq(validBody()), res, { svc, env: authorizedEnv() })
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ error: 'Autorização temporariamente indisponível' })
    expect(JSON.stringify(res.body)).not.toContain('db down')
    expect(JSON.stringify(res.body)).not.toContain('segredo interno')
    expect(res.headers['Cache-Control']).toBe('no-store')
    expect(svc.rpc).not.toHaveBeenCalled()
  })

  it('revalida o usuário autenticado no token', async () => {
    const svc = makeSvc({ tables: { company_users: makeChain({ role: 'admin' }) } })
    const result = await presign(svc, validBody(), authorizedEnv(), {
      createOperationId: () => '11111111-1111-4111-8111-111111111111',
      signPut: acceptedPut,
    })
    expect(result.status).toBe(200)
    expect(svc.auth.getUser).toHaveBeenCalledWith('valid-token')
    expect(result.body.confirmToken.startsWith('v1.')).toBe(true)
  })
})
