import { describe, expect, it, vi } from 'vitest'
import { AUTHORIZATION_UNAVAILABLE } from '../../../auth/validateCompanyCaller.js'
import { presignCatalogUpload } from '../presignCatalogUpload.js'
import {
  COMPANY_ID,
  PARENT_ID,
  USER_ID,
  acceptedPut,
  authorizedEnv,
  makeChain,
  makeReq,
  makeSvc,
  validBody,
} from './fixtures.js'

const parentRow = {
  role: 'super_admin',
  company_id: PARENT_ID,
  companies: { company_type: 'parent' },
}

function trackingSvc(resolveTable) {
  const calls = []
  const svc = makeSvc()
  svc.from.mockImplementation((table) => {
    calls.push(table)
    return resolveTable(table, calls)
  })
  return { svc, calls }
}

async function run(svc, body = validBody()) {
  const signPut = vi.fn(acceptedPut)
  const result = await presignCatalogUpload({
    req: makeReq(body),
    body,
    svc,
    env: authorizedEnv(),
    signPut,
  })
  return { result, signPut }
}

function expectClosed(result, signPut, svc) {
  expect(result.status).toBe(503)
  expect(result.body).toEqual({ error: AUTHORIZATION_UNAVAILABLE })
  expect(JSON.stringify(result)).not.toMatch(/db |PGRST|timeout|duplicate|segredo|XX000/i)
  expect(result.body.confirmToken).toBeUndefined()
  expect(result.body.putUrl).toBeUndefined()
  expect(svc.rpc).not.toHaveBeenCalled()
  expect(signPut).not.toHaveBeenCalled()
}

describe('falha fechada do presign', () => {
  it('não usa o privilégio da pai quando a consulta direta falha', async () => {
    const { svc, calls } = trackingSvc((table, seen) => {
      if (table === 'company_users' && seen.filter((item) => item === 'company_users').length === 1) {
        return makeChain(null, { code: 'XX000', message: 'db down' })
      }
      return makeChain(parentRow)
    })
    const { result, signPut } = await run(svc)
    expectClosed(result, signPut, svc)
    expect(calls).toEqual(['company_users'])
  })

  it('duplicidade da consulta direta não emite token nem assinatura', async () => {
    const svc = makeSvc()
    svc.from.mockReturnValue(makeChain(null, {
      code: 'PGRST116',
      message: 'JSON object requested, multiple (or no) rows returned',
    }))
    const { result, signPut } = await run(svc)
    expectClosed(result, signPut, svc)
    expect(svc.from).toHaveBeenCalledTimes(1)
  })

  it('exceção da consulta direta não resolve credenciais', async () => {
    const svc = makeSvc()
    svc.from.mockImplementation(() => {
      throw new Error('timeout acquiring connection')
    })
    const { result, signPut } = await run(svc)
    expectClosed(result, signPut, svc)
  })

  it('falha da consulta da empresa interrompe antes da trilha parent', async () => {
    const { svc, calls } = trackingSvc((table) => {
      if (table === 'company_users') return makeChain(null)
      return makeChain(null, { message: 'companies timeout' })
    })
    const { result, signPut } = await run(svc)
    expectClosed(result, signPut, svc)
    expect(calls).toEqual(['company_users', 'companies'])
  })

  it('partner fora da matriz não chega ao assignment nem às credenciais', async () => {
    const { svc, calls } = trackingSvc((table) => {
      if (table === 'partner_company_assignments') {
        throw new Error('assignment timeout')
      }
      if (table === 'company_users') return makeChain({ role: 'partner' })
      return makeChain({ parent_company_id: PARENT_ID, id: COMPANY_ID })
    })
    const signPut = vi.fn(acceptedPut)
    const result = await presignCatalogUpload({
      req: makeReq(validBody()),
      body: validBody(),
      svc,
      env: authorizedEnv(),
      signPut,
    })
    expect(result.status).toBe(403)
    expect(result.body.error).toBe('Permissão insuficiente para esta operação')
    expect(JSON.stringify(result.body)).not.toContain('assignment')
    expect(calls).toEqual(['company_users'])
    expect(svc.rpc).not.toHaveBeenCalled()
    expect(signPut).not.toHaveBeenCalled()
  })

  it('falha do vínculo parent não consulta a filha nem assina', async () => {
    const { svc, calls } = trackingSvc((table, seen) => {
      if (table === 'company_users') {
        const attempt = seen.filter((item) => item === 'company_users').length
        return attempt === 1 ? makeChain(null) : makeChain(null, { message: 'parent link down' })
      }
      return makeChain({ parent_company_id: PARENT_ID, id: COMPANY_ID })
    })
    const { result, signPut } = await run(svc)
    expectClosed(result, signPut, svc)
    expect(calls).toEqual(['company_users', 'companies', 'company_users'])
  })

  it('falha do relacionamento parent/client não autoriza', async () => {
    const { svc, calls } = trackingSvc((table, seen) => {
      if (table === 'company_users') {
        const attempt = seen.filter((item) => item === 'company_users').length
        return makeChain(attempt === 1 ? null : parentRow)
      }
      const attempt = seen.filter((item) => item === 'companies').length
      return attempt === 1
        ? makeChain({ parent_company_id: PARENT_ID })
        : makeChain(null, { message: 'child check down' })
    })
    const { result, signPut } = await run(svc)
    expectClosed(result, signPut, svc)
    expect(result.body.error).not.toContain('não encontrada')
    expect(calls).toEqual(['company_users', 'companies', 'company_users', 'companies'])
  })

  it('ausência confirmada permite super_admin da pai e mantém a empresa filha', async () => {
    const sequences = {
      company_users: [makeChain(null), makeChain(parentRow)],
      companies: [makeChain({ parent_company_id: PARENT_ID }), makeChain({ id: COMPANY_ID })],
    }
    const seen = { company_users: 0, companies: 0 }
    const svc = makeSvc()
    svc.from.mockImplementation((table) => sequences[table][seen[table]++])
    const { result, signPut } = await run(svc)
    expect(result.status).toBe(200)
    expect(result.body.s3_key.split('/')[1]).toBe(COMPANY_ID)
    expect(result.body.confirmToken.startsWith('v1.')).toBe(true)
    expect(svc.rpc).toHaveBeenCalledWith('webhook_resolve_aws_credentials', { p_company_id: COMPANY_ID })
    expect(signPut).toHaveBeenCalledTimes(1)
    expect(result.body.s3_key).not.toContain(PARENT_ID)
    expect(result.body.s3_key).not.toContain(USER_ID)
  })

  it('seller direto continua negado mesmo com parent privilegiado disponível', async () => {
    const { svc, calls } = trackingSvc((table, seen) => {
      if (table === 'company_users' && seen.filter((item) => item === 'company_users').length === 1) {
        return makeChain({ role: 'seller' })
      }
      return makeChain(parentRow)
    })
    const { result, signPut } = await run(svc)
    expect(result.status).toBe(403)
    expect(result.body).toEqual({ error: 'Permissão insuficiente para esta operação' })
    expect(calls).toEqual(['company_users'])
    expect(svc.rpc).not.toHaveBeenCalled()
    expect(signPut).not.toHaveBeenCalled()
    expect(result.body.confirmToken).toBeUndefined()
  })

  it('vínculo direto autorizado assina somente depois da autorização', async () => {
    const svc = makeSvc({ tables: { company_users: makeChain({ role: 'manager' }) } })
    const { result, signPut } = await run(svc)
    expect(result.status).toBe(200)
    expect(result.body.s3_key.split('/')[1]).toBe(COMPANY_ID)
    expect(signPut).toHaveBeenCalledTimes(1)
    expect(svc.rpc).toHaveBeenCalledTimes(1)
    expect(svc.from).toHaveBeenCalledTimes(1)
  })
})
