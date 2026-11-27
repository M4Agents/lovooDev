import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AWSCredentials } from '../types.js'

const { getCredentials, clients } = vi.hoisted(() => ({
  getCredentials: vi.fn(),
  clients: [] as Array<{ destroy: ReturnType<typeof vi.fn> }>,
}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function S3Client(this: { destroy: ReturnType<typeof vi.fn> }) {
    this.destroy = vi.fn()
    clients.push(this)
  }),
}))

vi.mock('../credentialsManager.js', () => ({
  CredentialsManager: {
    getCredentials: (...args: unknown[]) => getCredentials(...args),
  },
}))

import { S3ClientFactory } from '../s3Client.js'

const PARENT = '11111111-1111-4111-8111-111111111111'
const CHILD = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'

function cred(overrides: Partial<AWSCredentials> = {}): AWSCredentials {
  return {
    id: 'row-parent',
    company_id: PARENT,
    access_key_id: 'AKIATEST0000000001',
    secret_access_key: 'secret-v1',
    region: 'sa-east-1',
    bucket: 'bucket-test',
    is_active: true,
    created_at: '2026-11-27T00:00:00.000Z',
    updated_at: '2026-11-27T00:00:00.000Z',
    ...overrides,
  }
}

function ok(overrides: Partial<AWSCredentials> = {}) {
  return { success: true, data: cred(overrides) }
}

describe('S3ClientFactory cache', () => {
  beforeEach(() => {
    clients.length = 0
    getCredentials.mockReset()
    S3ClientFactory.clearAllCache()
  })

  it('reutiliza o cliente quando a credencial não muda', async () => {
    const logs: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
    getCredentials.mockResolvedValue(ok())

    const first = await S3ClientFactory.getClient(PARENT)
    const second = await S3ClientFactory.getClient(PARENT)

    expect(first.success).toBe(true)
    expect(second.data).toBe(first.data)
    expect(clients).toHaveLength(1)
    expect(getCredentials).toHaveBeenCalledTimes(2)
    expect(logs.join('\n')).not.toContain('AKIATEST0000000001')
    expect(logs.join('\n')).not.toContain('secret-v1')
    log.mockRestore()
  })

  it('substitui o cliente quando a credencial é rotacionada', async () => {
    getCredentials.mockResolvedValueOnce(ok())
    getCredentials.mockResolvedValueOnce(ok({
      updated_at: '2026-11-27T00:01:00.000Z',
      access_key_id: 'AKIATEST0000000002',
      secret_access_key: 'secret-v2',
    }))

    const first = await S3ClientFactory.getClient(PARENT)
    const second = await S3ClientFactory.getClient(PARENT)

    expect(second.data).not.toBe(first.data)
    expect(clients).toHaveLength(2)
    expect(clients.every((client) => client.destroy.mock.calls.length === 0)).toBe(true)
  })

  it('detecta rotação da credencial herdada pela empresa filha', async () => {
    const inherited = cred()
    getCredentials.mockResolvedValue(ok(inherited))

    const parentClient = await S3ClientFactory.getClient(PARENT)
    const childClient = await S3ClientFactory.getClient(CHILD)

    expect(getCredentials).toHaveBeenCalledWith(CHILD)
    expect(childClient.data).not.toBe(parentClient.data)

    getCredentials.mockResolvedValue(ok({
      updated_at: '2026-11-27T00:02:00.000Z',
      access_key_id: 'AKIATEST0000000003',
      secret_access_key: 'secret-v3',
    }))

    const childRotated = await S3ClientFactory.getClient(CHILD)
    const parentStillCached = parentClient.data

    expect(childRotated.data).not.toBe(childClient.data)
    expect(parentStillCached).toBe(parentClient.data)
    expect(clients.every((client) => client.destroy.mock.calls.length === 0)).toBe(true)
  })

  it('isola o cache entre empresas', async () => {
    getCredentials.mockImplementation(async (companyId: string) => ok({
      id: companyId,
      company_id: companyId,
      access_key_id: `AKIATEST${companyId.slice(0, 8)}`,
      secret_access_key: `secret-${companyId}`,
    }))

    const first = await S3ClientFactory.getClient(PARENT)
    const other = await S3ClientFactory.getClient(OTHER)

    getCredentials.mockImplementation(async (companyId: string) => ok({
      id: companyId,
      company_id: companyId,
      updated_at: companyId === PARENT ? '2026-11-27T00:03:00.000Z' : '2026-11-27T00:00:00.000Z',
      access_key_id: companyId === PARENT ? 'AKIATESTROTATED0001' : `AKIATEST${companyId.slice(0, 8)}`,
      secret_access_key: companyId === PARENT ? 'secret-rotated' : `secret-${companyId}`,
    }))

    const rotated = await S3ClientFactory.getClient(PARENT)
    const otherAgain = await S3ClientFactory.getClient(OTHER)

    expect(first.data).not.toBe(other.data)
    expect(rotated.data).not.toBe(first.data)
    expect(otherAgain.data).toBe(other.data)
  })

  it('não reutiliza cliente antigo quando a RPC falha', async () => {
    getCredentials.mockResolvedValueOnce(ok())
    const cached = await S3ClientFactory.getClient(PARENT)

    getCredentials.mockResolvedValueOnce({ success: false, error: 'rpc indisponível' })
    const failed = await S3ClientFactory.getClient(PARENT)

    getCredentials.mockRejectedValueOnce(new Error('rpc caiu'))
    const thrown = await S3ClientFactory.getClient(PARENT)

    getCredentials.mockResolvedValueOnce(ok())
    const recovered = await S3ClientFactory.getClient(PARENT)

    expect(failed.success).toBe(false)
    expect(failed.data).toBeUndefined()
    expect(thrown.success).toBe(false)
    expect(thrown.data).toBeUndefined()
    expect(recovered.data).toBe(cached.data)
    expect(clients).toHaveLength(1)
  })

  it('não deixa uma resposta antiga sobrescrever o cache rotacionado', async () => {
    let releaseOld: () => void = () => {}
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    let calls = 0
    getCredentials.mockImplementation(async () => {
      calls += 1
      if (calls === 1) {
        await oldGate
        return ok()
      }
      return ok({
        updated_at: '2026-11-27T00:04:00.000Z',
        access_key_id: 'AKIATEST0000000004',
        secret_access_key: 'secret-v4',
      })
    })

    const pendingOld = S3ClientFactory.getClient(PARENT)
    await Promise.resolve()
    const fresh = await S3ClientFactory.getClient(PARENT)
    releaseOld()
    const stale = await pendingOld
    const followUp = await S3ClientFactory.getClient(PARENT)

    expect(stale.data).toBe(fresh.data)
    expect(followUp.data).toBe(fresh.data)
    expect(clients).toHaveLength(2)
    expect(clients.every((client) => client.destroy.mock.calls.length === 0)).toBe(true)
  })
})
