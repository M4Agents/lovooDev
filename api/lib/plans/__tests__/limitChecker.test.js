import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertPlanLimit,
  assertStorageLimit,
  assertStorageLimitStrict,
  getPlanLimits,
} from '../limitChecker.js'

const COMPANY_ID = 'bbbb0000-0000-4000-8000-000000000002'
const MB = 1048576

function confirmed(storageMb, planExtras = {}) {
  return {
    plan_id: 'plan-1',
    plans: {
      id: 'plan-1',
      name: 'Pro',
      slug: 'pro',
      max_leads: 10,
      storage_mb: storageMb,
      features: { multiple_agents_enabled: true },
      ...planExtras,
    },
  }
}

function mockSvc({ result = { data: confirmed(null), error: null }, rpcData = 0, rpcError = null, from } = {}) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => result),
  }
  return {
    from: from ?? vi.fn(() => chain),
    rpc: vi.fn(async () => ({ data: rpcData, error: rpcError })),
  }
}

async function expectFailed(run, code) {
  await expect(run).rejects.toMatchObject({
    isPlanError: true,
    httpStatus: 403,
    data: { error: 'plan_validation_failed' },
  })
  expect(console.error).toHaveBeenCalledWith('[assertStorageLimitStrict] plan_validation_failed', code)
}

describe('helpers legados de plano', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preserva plano confirmado, plano ausente e erro como limites vazios', async () => {
    const confirmedSvc = mockSvc()
    const missingPlan = mockSvc({ result: { data: { plan_id: null, plans: null }, error: null } })
    const missingCompany = mockSvc({ result: { data: null, error: null } })
    const failed = mockSvc({
      result: { data: null, error: { message: 'falha aberta legada', code: 'XX000' } },
    })

    await expect(getPlanLimits(confirmedSvc, COMPANY_ID)).resolves.toMatchObject({
      has_plan: true,
      plan_id: 'plan-1',
      max_leads: 10,
      storage_mb: null,
      features: { multiple_agents_enabled: true },
    })
    for (const svc of [missingPlan, missingCompany, failed]) {
      await expect(getPlanLimits(svc, COMPANY_ID)).resolves.toMatchObject({
        has_plan: false,
        storage_mb: null,
        max_leads: null,
      })
    }
    expect(failed.rpc).not.toHaveBeenCalled()
  })

  it('propaga timeout para os consumidores legados tratarem', async () => {
    const svc = mockSvc({
      from: vi.fn(() => {
        throw new Error('timeout legado')
      }),
    })
    await expect(getPlanLimits(svc, COMPANY_ID)).rejects.toThrow('timeout legado')
  })

  it('mantém o fail-open e o parsing legado de assertStorageLimit', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const open = mockSvc({ result: { data: null, error: { message: 'plano indisponivel' } } })
    const unlimited = mockSvc()
    const partial = mockSvc({ result: { data: confirmed(100), error: null }, rpcData: '12abc' })
    const blocked = mockSvc({
      result: { data: confirmed(1), error: null },
      rpcError: { message: 'mensagem legada de storage' },
    })

    await expect(assertStorageLimit(open, COMPANY_ID, MB)).resolves.toBeUndefined()
    await expect(assertStorageLimit(unlimited, COMPANY_ID, MB)).resolves.toBeUndefined()
    await expect(assertStorageLimit(partial, COMPANY_ID, 1024)).resolves.toBeUndefined()
    expect(open.rpc).not.toHaveBeenCalled()
    expect(unlimited.rpc).not.toHaveBeenCalled()
    await expect(assertStorageLimit(blocked, COMPANY_ID, 1024)).rejects.toMatchObject({
      httpStatus: 403,
      data: { error: 'plan_validation_failed' },
    })
    expect(errorSpy).toHaveBeenCalledWith(
      '[assertStorageLimit] Erro ao calcular storage usado — bloqueando upload:',
      'mensagem legada de storage',
    )
  })

  it('não consulta contagem quando o limite legado é nulo', async () => {
    const count = vi.fn()
    await expect(assertPlanLimit(mockSvc(), COMPANY_ID, 'storage_mb', count)).resolves.toBeUndefined()
    expect(count).not.toHaveBeenCalled()
  })
})

describe('assertStorageLimitStrict', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('aceita plano ilimitado, zero e o limite exato', async () => {
    const unlimited = mockSvc()
    const zero = mockSvc({ result: { data: confirmed(0), error: null }, rpcData: 0 })
    const exact = mockSvc({ result: { data: confirmed(5), error: null }, rpcData: '4.50' })
    const numeric = mockSvc({ result: { data: confirmed(5), error: null }, rpcData: 4 })

    await expect(assertStorageLimitStrict(unlimited, COMPANY_ID, MB)).resolves.toBeUndefined()
    await expect(assertStorageLimitStrict(zero, COMPANY_ID, 0)).resolves.toBeUndefined()
    await expect(assertStorageLimitStrict(exact, COMPANY_ID, Math.round(0.5 * MB))).resolves.toBeUndefined()
    await expect(assertStorageLimitStrict(numeric, COMPANY_ID, MB)).resolves.toBeUndefined()
    expect(unlimited.rpc).not.toHaveBeenCalled()
  })

  it('bloqueia o byte acima do limite e o limite zero', async () => {
    const exact = mockSvc({ result: { data: confirmed(5), error: null }, rpcData: 4 })
    const zero = mockSvc({ result: { data: confirmed(0), error: null }, rpcData: 0 })
    await expect(assertStorageLimitStrict(exact, COMPANY_ID, MB + 1)).rejects.toMatchObject({
      httpStatus: 403,
      data: expect.objectContaining({ error: 'plan_storage_limit_exceeded', max_allowed_mb: 5 }),
    })
    await expect(assertStorageLimitStrict(zero, COMPANY_ID, 1)).rejects.toMatchObject({
      data: { error: 'plan_storage_limit_exceeded', max_allowed_mb: 0 },
    })
  })

  it.each([
    ['empresa ausente', { data: null, error: null }, 'missing_company'],
    ['plano ausente', { data: { plan_id: null, plans: null }, error: null }, 'missing_plan'],
    ['erro da consulta', { data: null, error: { message: 'segredo-plano', code: '57014' } }, '57014'],
    ['código inseguro', { data: confirmed(5), error: { message: 'vazou', code: 'segredo plano' } }, 'unavailable'],
    ['resposta inválida', null, 'invalid_response'],
  ])('bloqueia %s', async (_label, result, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const svc = mockSvc({ result })
    await expectFailed(assertStorageLimitStrict(svc, COMPANY_ID, MB), code)
    expect(JSON.stringify(console.error.mock.calls)).not.toMatch(/segredo|vazou/)
    expect(svc.rpc).not.toHaveBeenCalled()
  })

  it('converte timeout em plan_validation_failed sem a mensagem interna', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const svc = mockSvc({
      from: vi.fn(() => {
        throw new Error('timeout secreto')
      }),
    })
    await expectFailed(assertStorageLimitStrict(svc, COMPANY_ID, MB), 'unavailable')
    expect(JSON.stringify(console.error.mock.calls)).not.toContain('timeout secreto')
    expect(svc.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['limite textual', confirmed(5, { storage_mb: '5' }), 0],
    ['limite negativo', confirmed(-1), 0],
    ['limite ausente', { plan_id: 'plan-1', plans: { id: 'plan-1' } }, 0],
    ['limite não finito', confirmed(Number.POSITIVE_INFINITY), 0],
  ])('rejeita %s', async (_label, data, rpcData) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const svc = mockSvc({ result: { data, error: null }, rpcData })
    await expectFailed(assertStorageLimitStrict(svc, COMPANY_ID, MB), 'invalid_plan')
    expect(svc.rpc).not.toHaveBeenCalled()
  })

  it.each([
    null,
    '',
    ' 1',
    '1e2',
    '4abc',
    true,
    false,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    [],
  ])('rejeita uso inválido %j', async (rpcData) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const svc = mockSvc({ result: { data: confirmed(10), error: null }, rpcData })
    await expectFailed(assertStorageLimitStrict(svc, COMPANY_ID, MB), 'invalid_usage')
  })

  it('rejeita erro, timeout e tamanho inválido antes da assinatura', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const rpcError = mockSvc({
      result: { data: confirmed(10), error: null },
      rpcError: { message: 'uso secreto', code: 'PGRST000' },
    })
    const rpcThrow = mockSvc({ result: { data: confirmed(10), error: null } })
    rpcThrow.rpc.mockRejectedValue(new Error('timeout de uso'))
    const badSize = mockSvc({ result: { data: confirmed(10), error: null } })

    await expectFailed(assertStorageLimitStrict(rpcError, COMPANY_ID, MB), 'PGRST000')
    await expectFailed(assertStorageLimitStrict(rpcThrow, COMPANY_ID, MB), 'unavailable')
    await expectFailed(assertStorageLimitStrict(badSize, COMPANY_ID, Number.NaN), 'invalid_size')
    expect(badSize.from).not.toHaveBeenCalled()
    expect(JSON.stringify(console.error.mock.calls)).not.toMatch(/uso secreto|timeout de uso/)
  })
})
