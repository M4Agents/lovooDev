import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'
import { headCatalogObject } from '../headCatalogObject.js'
import {
  AWS_KEY,
  AWS_SECRET,
  BUCKET,
  COMPANY_ID,
  PARENT_ID,
  REGION,
  makeChain,
  makeSvc,
} from './fixtures.js'
import { confirmParts, keyFor } from './confirmHarness.js'

function awsError(status, name, message) {
  const error = new Error(message)
  error.name = name
  error.$metadata = { httpStatusCode: status }
  return error
}

function withSend(send) {
  const client = { send, destroy: vi.fn() }
  return confirmParts({
    headObject: (input) => headCatalogObject({ ...input, client }),
  })
}

describe('HeadObject da confirmação', () => {
  it('confirma o objeto no bucket e na chave do token', async () => {
    const send = vi.fn().mockResolvedValue({ ContentLength: 1024, ContentType: 'image/png' })
    const parts = withSend(send)
    const result = await parts.run()
    const command = send.mock.calls[0][0]
    expect(result.status).toBe(200)
    expect(command).toBeInstanceOf(HeadObjectCommand)
    expect(command.input).toEqual({ Bucket: BUCKET, Key: keyFor() })
    expect(parts.media.calls[0].values.company_id).toBe(COMPANY_ID)
  })

  it.each([
    ['404', awsError(404, 'NotFound', 'NoSuchKey secret')],
    ['NoSuchKey', awsError(undefined, 'NoSuchKey', 'missing secret')],
  ])('objeto comprovadamente inexistente (%s) não persiste', async (_label, error) => {
    const parts = withSend(vi.fn().mockRejectedValue(error))
    const result = await parts.run()
    expect(result).toEqual({ status: 404, body: { error: 'Objeto não encontrado' } })
    expect(parts.media.calls).toEqual([])
    expect(JSON.stringify(result.body)).not.toContain('secret')
  })

  it.each([
    ['403 ambíguo', awsError(403, 'AccessDenied', 'AccessDenied secret')],
    ['403 + NotFound', awsError(403, 'NotFound', 'NotFound secret')],
    ['403 + NoSuchKey', awsError(403, 'NoSuchKey', 'NoSuchKey secret')],
    ['500', awsError(500, 'InternalError', 'internal secret')],
    ['500 + NotFound', awsError(500, 'NotFound', 'NotFound secret')],
    ['timeout', Object.assign(new Error('socket timeout secret'), { name: 'TimeoutError' })],
  ])('%s não é tratado como ausência', async (_label, error) => {
    const send = vi.fn().mockRejectedValue(error)
    const parts = withSend(send)
    const result = await parts.run()
    expect(result).toEqual({ status: 503, body: { error: 'Confirmação temporariamente indisponível' } })
    expect(parts.media.calls).toEqual([])
    expect(send.mock.calls.map((call) => call[0].constructor.name)).toEqual(['HeadObjectCommand'])
    expect(JSON.stringify(result.body)).not.toContain('secret')
  })

  it.each([
    ['tamanho ausente', { ContentType: 'image/png' }],
    ['MIME ausente', { ContentLength: 1024 }],
    ['tamanho divergente', { ContentLength: 1025, ContentType: 'image/png' }],
    ['MIME divergente', { ContentLength: 1024, ContentType: 'image/jpeg' }],
  ])('%s gera 409 sem persistir', async (_label, payload) => {
    const parts = withSend(vi.fn().mockResolvedValue(payload))
    const result = await parts.run()
    expect(result).toEqual({ status: 409, body: { error: 'Confirmação divergente' } })
    expect(parts.media.calls).toEqual([])
  })

  it.each([
    ['bucket', { bucket: 'other-bucket', region: REGION }],
    ['região', { bucket: BUCKET, region: 'sa-east-1' }],
  ])('%s divergente não consulta o objeto', async (_label, storage) => {
    const headObject = vi.fn()
    const parts = confirmParts({
      headObject,
      svc: makeSvc({
        tables: { company_users: makeChain({ role: 'admin' }) },
        rpcData: [{
          access_key_id: AWS_KEY,
          secret_access_key: AWS_SECRET,
          bucket: storage.bucket,
          region: storage.region,
        }],
      }),
    })
    const result = await parts.run()
    expect(result).toEqual({ status: 409, body: { error: 'Confirmação divergente' } })
    expect(headObject).not.toHaveBeenCalled()
    expect(parts.media.calls).toEqual([])
  })

  it('credencial herdada não troca a empresa autorizada', async () => {
    const send = vi.fn().mockResolvedValue({ ContentLength: 1024, ContentType: 'image/png' })
    const parts = confirmParts({
      headObject: (input) => headCatalogObject({
        ...input,
        client: { send, destroy: vi.fn() },
      }),
      svc: makeSvc({
        tables: { company_users: makeChain({ role: 'admin' }) },
        rpcData: [{
          company_id: PARENT_ID,
          access_key_id: AWS_KEY,
          secret_access_key: AWS_SECRET,
          bucket: BUCKET,
          region: REGION,
        }],
      }),
    })
    const result = await parts.run()
    expect(result.status).toBe(200)
    expect(send.mock.calls[0][0].input.Key.split('/')[1]).toBe(COMPANY_ID)
    expect(parts.media.calls[0].values.company_id).toBe(COMPANY_ID)
    expect(parts.media.rows[0].company_id).not.toBe(PARENT_ID)
  })
})
