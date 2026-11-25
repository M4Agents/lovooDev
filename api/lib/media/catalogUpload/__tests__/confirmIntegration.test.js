import { describe, expect, it } from 'vitest'
import { presignCatalogUpload } from '../presignCatalogUpload.js'
import {
  COMPANY_ID,
  FIXED_NOW,
  OPERATION_A,
  acceptedPut,
  authorizedEnv,
  makeChain,
  makeReq,
  makeSvc,
  validBody,
} from './fixtures.js'
import { confirmParts, keyFor } from './confirmHarness.js'

describe('presign integrado à confirmação', () => {
  it('confirma o token emitido pelo presign e repete o mesmo id', async () => {
    const svc = makeSvc({ tables: { company_users: makeChain({ role: 'admin' }) } })
    const body = validBody()
    const presign = await presignCatalogUpload({
      req: makeReq(body),
      body,
      svc,
      env: authorizedEnv(),
      now: () => FIXED_NOW,
      createOperationId: () => OPERATION_A,
      signPut: acceptedPut,
    })
    expect(presign.status).toBe(200)

    const first = confirmParts({ svc, token: presign.body.confirmToken })
    const created = await first.run()
    const repeated = await confirmParts({ svc, media: first.media, token: presign.body.confirmToken }).run()
    expect(created.status).toBe(200)
    expect(created.body).toMatchObject({
      s3_key: keyFor(),
      file_type: 'image',
      original_filename: 'foto.png',
      company_id: COMPANY_ID,
      folder_path: '/produtos',
    })
    expect(created.body.preview_url).toBe(`https://example-bucket.s3.us-east-1.amazonaws.com/${created.body.s3_key}`)
    expect(repeated.status).toBe(200)
    expect(repeated.body.id).toBe(created.body.id)
    expect(first.media.rows).toHaveLength(1)
  })
})
