import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { headCatalogObject } from '../../catalogUpload/headCatalogObject.js'
import {
  ASSIGNMENT_ID,
  COMPANY_ID,
  FIXED_NOW,
  OTHER_ID,
  makeChain,
  makeSvc,
  mockRes,
} from '../../catalogUpload/__tests__/fixtures.js'
import { handleLibraryConfirm } from '../../../../media/uploads/library/confirm.js'
import { FOLDER_ID, companyPlan, directSvc } from './presignFixtures.js'
import {
  ISSUED_AT,
  catalogToken,
  confirmParts,
  inheritedPartnerSvc,
  issueLibraryToken,
  parentConfirmSvc,
  resignLibraryToken,
} from './confirmHarness.js'

describe('autorização do confirm da biblioteca', () => {
  it.each(['super_admin', 'system_admin', 'admin', 'manager', 'seller'])(
    'autoriza %s com membership direta',
    async (role) => {
      const { run } = confirmParts({ role })
      expect((await run()).status).toBe(200)
    },
  )

  it('autoriza partner direto com assignment e nega sem assignment', async () => {
    const allowed = confirmParts({
      svc: directSvc('partner', undefined, {
        partner_company_assignments: makeChain({ id: ASSIGNMENT_ID }),
      }),
    })
    const denied = confirmParts({ role: 'partner' })
    expect((await allowed.run()).status).toBe(200)
    expect((await denied.run()).status).toBe(403)
    expect(denied.headObject).not.toHaveBeenCalled()
    expect(denied.svc.rpc).not.toHaveBeenCalled()
  })

  it.each(['super_admin', 'system_admin'])('herda %s da empresa pai', async (role) => {
    const { run } = confirmParts({ svc: parentConfirmSvc(role, true) })
    expect((await run()).status).toBe(200)
  })

  it.each(['admin', 'manager', 'seller'])('nega %s da empresa pai', async (role) => {
    const { run, headObject, svc } = confirmParts({ svc: parentConfirmSvc(role) })
    expect((await run()).status).toBe(403)
    expect(headObject).not.toHaveBeenCalled()
    expect(svc.rpc).not.toHaveBeenCalled()
  })

  it('autoriza partner herdado com assignment', async () => {
    const { run } = confirmParts({ svc: inheritedPartnerSvc(true) })
    expect((await run()).status).toBe(200)
  })

  it('nega identidade trocada antes e depois das operações externas', async () => {
    const first = confirmParts({ sessionUserId: OTHER_ID })
    const later = confirmParts({ secondUserId: OTHER_ID })
    expect((await first.run()).status).toBe(403)
    expect(first.headObject).not.toHaveBeenCalled()
    const laterResult = await later.run()
    expect(laterResult).toEqual({ status: 403, body: { error: 'Acesso negado' } })
    expect(later.media.calls.some((call) => call.type === 'upsert')).toBe(false)
  })

  it('nega revogação depois do HeadObject', async () => {
    const svc = makeSvc({
      tableSeq: {
        company_users: [makeChain({ role: 'admin' }), makeChain(null)],
      },
      tables: {
        company_folders: makeChain({ id: FOLDER_ID }),
        companies: companyPlan(null),
      },
    })
    const { run, media, headObject } = confirmParts({ svc })
    expect((await run()).status).toBe(403)
    expect(headObject).toHaveBeenCalledOnce()
    expect(media.calls.some((call) => call.type === 'upsert')).toBe(false)
  })

  it('rejeita token adulterado, expirado e de outro contexto', async () => {
    const tampered = confirmParts({
      token: `${issueLibraryToken().slice(0, -1)}${issueLibraryToken().endsWith('a') ? 'b' : 'a'}`,
    })
    const expired = confirmParts({
      token: issueLibraryToken(),
      now: new Date((ISSUED_AT + 900) * 1000),
    })
    const foreign = confirmParts({ token: catalogToken() })
    const rebound = confirmParts({
      token: resignLibraryToken(issueLibraryToken(), (payload) => {
        payload.context = 'catalog'
      }),
    })
    expect((await tampered.run()).status).toBe(400)
    expect((await expired.run())).toEqual({ status: 410, body: { error: 'Token expirado' } })
    expect((await foreign.run()).status).toBe(400)
    expect((await rebound.run()).status).toBe(400)
    expect(tampered.svc.rpc).not.toHaveBeenCalled()
    expect(expired.headObject).not.toHaveBeenCalled()
  })

  it('nega pasta de outra empresa e segue em pasta de sistema', async () => {
    const missing = confirmParts({
      svc: makeSvc({
        tables: {
          company_users: makeChain({ role: 'admin' }),
          company_folders: makeChain(null),
          companies: companyPlan(null),
        },
      }),
    })
    const systemFolder = makeChain({ id: FOLDER_ID, is_system_folder: true })
    const system = confirmParts({
      svc: makeSvc({
        tables: {
          company_users: makeChain({ role: 'seller' }),
          company_folders: systemFolder,
          companies: companyPlan(null),
        },
      }),
    })
    expect((await missing.run())).toEqual({ status: 404, body: { error: 'Pasta não encontrada' } })
    expect(missing.svc.rpc).not.toHaveBeenCalled()
    expect((await system.run()).status).toBe(200)
    expect(systemFolder.eq.mock.calls.map((call) => call[0])).not.toContain('is_system_folder')
    expect(COMPANY_ID).toBeTruthy()
  })

  it('não chama DeleteObject nem registra segredo', () => {
    const source = [
      new URL('../confirmLibraryUpload.js', import.meta.url),
      new URL('../libraryMetadata.js', import.meta.url),
      new URL('../../../../media/uploads/library/confirm.js', import.meta.url),
    ].map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(source).not.toContain('DeleteObject')
    expect(source).not.toMatch(/console\.(log|info|debug|warn|error)/)
    expect(source).not.toContain('secretAccessKey')
  })

  it('preserva 405, no-store e erro sanitizado no handler', async () => {
    const res = mockRes()
    await handleLibraryConfirm({ method: 'GET', headers: {}, body: {} }, res)
    expect(res.statusCode).toBe(405)
    expect(res.headers['Cache-Control']).toBe('no-store')
    const broken = mockRes()
    const parts = confirmParts({
      headObject: () => {
        throw new Error('segredo-interno')
      },
    })
    await handleLibraryConfirm(
      { method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: { confirmToken: parts.token } },
      broken,
      {
        svc: parts.svc,
        env: { MEDIA_LIBRARY_UPLOAD_TOKEN_SECRET: 'l'.repeat(32) },
        now: () => FIXED_NOW,
        headObject: parts.headObject,
      },
    )
    expect(broken.statusCode).toBe(503)
    expect(JSON.stringify(broken.body)).not.toContain('segredo-interno')
  })

  it('classifica falha técnica do S3 sem tratá-la como objeto ausente', async () => {
    const technical = confirmParts({
      headObject: ({ credentials, key }) => headCatalogObject({
        credentials,
        key,
        client: {
          send: async () => {
            throw Object.assign(new Error('segredo-s3'), { name: 'InternalError', $metadata: { httpStatusCode: 500 } })
          },
          destroy() {},
        },
      }),
    })
    const missing = confirmParts({
      headObject: ({ credentials, key }) => headCatalogObject({
        credentials,
        key,
        client: {
          send: async () => {
            throw Object.assign(new Error('missing'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } })
          },
          destroy() {},
        },
      }),
    })
    const technicalResult = await technical.run()
    const missingResult = await missing.run()
    expect(technicalResult).toEqual({ status: 503, body: { error: 'Confirmação temporariamente indisponível' } })
    expect(missingResult).toEqual({ status: 404, body: { error: 'Objeto não encontrado' } })
    expect(JSON.stringify(technicalResult)).not.toContain('segredo-s3')
    expect(technical.media.calls.some((call) => call.type === 'upsert')).toBe(false)
  })
})
