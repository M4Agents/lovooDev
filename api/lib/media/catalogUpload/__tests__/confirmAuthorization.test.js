import { describe, expect, it } from 'vitest'
import { CONFIRM_TTL_SECONDS } from '../constants.js'
import {
  COMPANY_ID,
  PARENT_ID,
  USER_ID,
  makeChain,
  makeReq,
  makeSvc,
  parentSvc,
} from './fixtures.js'
import {
  ISSUED_AT,
  confirmParts,
  issueToken,
  resignToken,
} from './confirmHarness.js'

function expectClosed(result, status) {
  expect(result.status).toBe(status)
  expect(result.body.confirmToken).toBeUndefined()
  expect(result.body.putUrl).toBeUndefined()
}

async function expectNoSideEffects(parts, status) {
  const result = await parts.run()
  expectClosed(result, status)
  expect(parts.headObject).not.toHaveBeenCalled()
  expect(parts.svc.rpc).not.toHaveBeenCalled()
  expect(parts.media.calls).toEqual([])
  expect(JSON.stringify(result.body)).not.toMatch(/db down|secret|PGRST|timeout/i)
  return result
}

describe('autorização da confirmação', () => {
  it('nega JWT ausente e JWT inválido antes do banco e da AWS', async () => {
    const missing = confirmParts({ authorization: '' })
    const invalid = confirmParts({
      svc: makeSvc({ authError: new Error('jwt invalid secret'), tables: { company_users: makeChain({ role: 'admin' }) } }),
    })
    expect((await expectNoSideEffects(missing, 401)).body.error).toBe('Autenticação necessária')
    expect(missing.svc.auth.getUser).not.toHaveBeenCalled()
    expect((await expectNoSideEffects(invalid, 401)).body.error).toBe('Sessão inválida ou expirada')
  })

  it('falha de sessão consulta vira 503 sanitizado', async () => {
    const parts = confirmParts()
    parts.svc.auth.getUser.mockRejectedValue(new Error('timeout acquiring connection secret'))
    const result = await expectNoSideEffects(parts, 503)
    expect(result.body).toEqual({ error: 'Confirmação temporariamente indisponível' })
  })

  it('rejeita token adulterado como inválido mesmo depois do TTL', async () => {
    const token = `${issueToken()}x`
    const parts = confirmParts({
      token,
      now: new Date((ISSUED_AT + CONFIRM_TTL_SECONDS) * 1000),
    })
    const result = await expectNoSideEffects(parts, 400)
    expect(result.body.error).toBe('Token inválido')
  })

  it('rejeita estrutura inconsistente sem classificá-la como expiração', async () => {
    const token = resignToken(issueToken(), (payload) => {
      payload.companyId = PARENT_ID
    })
    const parts = confirmParts({
      token,
      now: new Date((ISSUED_AT + CONFIRM_TTL_SECONDS) * 1000),
    })
    const result = await expectNoSideEffects(parts, 400)
    expect(result.body.error).toBe('Token inválido')
  })

  it('rejeita contexto diferente de catalog', async () => {
    const token = resignToken(issueToken(), (payload) => {
      payload.context = 'library'
    })
    const result = await expectNoSideEffects(confirmParts({ token }), 400)
    expect(result.body.error).toBe('Token inválido')
  })

  it('retorna 410 somente para token assinado e expirado', async () => {
    const parts = confirmParts({ now: new Date((ISSUED_AT + CONFIRM_TTL_SECONDS) * 1000) })
    const result = await expectNoSideEffects(parts, 410)
    expect(result.body).toEqual({ error: 'Token expirado' })
  })

  it('nega token de outro usuário', async () => {
    const parts = confirmParts({ tokenOverrides: { userId: PARENT_ID } })
    const result = await expectNoSideEffects(parts, 403)
    expect(result.body.error).toBe('Acesso negado')
  })

  it.each(['seller', 'partner', 'auditor'])('nega role %s', async (role) => {
    const parts = confirmParts({ role })
    const result = await expectNoSideEffects(parts, 403)
    expect(result.body.error).toBe('Permissão insuficiente para esta operação')
  })

  it('membership revogado ou inativo não confirma', async () => {
    const parts = confirmParts({
      svc: makeSvc({ tables: { company_users: makeChain(null), companies: makeChain(null) } }),
    })
    await expectNoSideEffects(parts, 403)
  })

  it('role alterado para seller depois da emissão não recebe fallback', async () => {
    const calls = []
    const svc = makeSvc()
    svc.from.mockImplementation((table) => {
      calls.push(table)
      if (table === 'company_users' && calls.filter((item) => item === 'company_users').length === 1) {
        return makeChain({ role: 'seller' })
      }
      return makeChain({
        role: 'super_admin',
        company_id: PARENT_ID,
        companies: { company_type: 'parent' },
        parent_company_id: PARENT_ID,
        id: COMPANY_ID,
      })
    })
    const parts = confirmParts({ svc })
    await expectNoSideEffects(parts, 403)
    expect(calls).toEqual(['company_users'])
  })

  it('erro de consulta não resolve credenciais', async () => {
    const parts = confirmParts({
      svc: makeSvc({
        tables: { company_users: makeChain(null, { message: 'db down secret' }) },
      }),
    })
    const result = await expectNoSideEffects(parts, 503)
    expect(result.body.error).toBe('Autorização temporariamente indisponível')
  })

  it('nega parent de outra empresa e admin da pai', async () => {
    const foreign = makeSvc({
      tableSeq: {
        company_users: [
          makeChain(null),
          makeChain({
            role: 'system_admin',
            company_id: PARENT_ID,
            companies: { company_type: 'parent' },
          }),
        ],
        companies: [makeChain({ parent_company_id: 'dddd0000-0000-4000-8000-000000000004' })],
      },
    })
    const parentAdmin = parentSvc('admin')
    await expectNoSideEffects(confirmParts({ svc: foreign }), 403)
    await expectNoSideEffects(confirmParts({ svc: parentAdmin }), 403)
  })

  it.each(['admin', 'manager', 'super_admin', 'system_admin'])('autoriza %s direto', async (role) => {
    const parts = confirmParts({ role })
    const result = await parts.run()
    expect(result.status).toBe(200)
    expect(result.body.company_id).toBe(COMPANY_ID)
    expect(result.body.created_by).toBeUndefined()
    expect(parts.headObject).toHaveBeenCalledTimes(1)
    expect(parts.svc.rpc).toHaveBeenCalledWith('webhook_resolve_aws_credentials', { p_company_id: COMPANY_ID })
  })

  it('autoriza super_admin da pai e mantém a empresa do token', async () => {
    const parts = confirmParts({ svc: parentSvc('super_admin') })
    const result = await parts.run()
    expect(result.status).toBe(200)
    expect(result.body.company_id).toBe(COMPANY_ID)
    expect(parts.media.calls[0].values.company_id).toBe(COMPANY_ID)
    expect(parts.media.calls[0].values.created_by).toBe(USER_ID)
    expect(parts.media.calls[0].values.s3_key).not.toContain(PARENT_ID)
  })
})
