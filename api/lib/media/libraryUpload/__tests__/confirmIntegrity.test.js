import { describe, expect, it, vi } from 'vitest'
import {
  AWS_KEY,
  AWS_SECRET,
  BUCKET,
  COMPANY_ID,
  REGION,
  makeChain,
  makeSvc,
} from '../../catalogUpload/__tests__/fixtures.js'
import { derivePublicObjectUrl } from '../../catalogUpload/objectKey.js'
import { FOLDER_ID, companyPlan, directSvc } from './presignFixtures.js'
import {
  LIBRARY_MEDIA_UPSERT_OPTIONS,
  MEDIA_ID,
  confirmParts,
  issueLibraryToken,
  libraryKey,
  memoryLibrary,
  storedLibraryRow,
} from './confirmHarness.js'

function credentialRpc(usage) {
  return async (name) => {
    if (name === 'get_company_storage_used_mb') return usage
    if (name === 'webhook_resolve_aws_credentials') {
      return {
        data: [{ access_key_id: AWS_KEY, secret_access_key: AWS_SECRET, bucket: BUCKET, region: REGION }],
        error: null,
      }
    }
    return { data: null, error: { code: 'unexpected' } }
  }
}

describe('integridade do confirm da biblioteca', () => {
  it('persiste a primeira confirmação e repete sem quota nem sobrescrita', async () => {
    const media = memoryLibrary()
    const first = confirmParts({ media })
    const created = await first.run()
    const repeated = confirmParts({
      media,
      token: first.token,
      svc: directSvc('admin', undefined, { companies: companyPlan(0) }),
    })
    repeated.svc.rpc.mockImplementation(credentialRpc({ data: 0, error: null }))
    const again = await repeated.run()
    expect(created.status).toBe(200)
    expect(again.status).toBe(200)
    expect(again.body).toEqual(created.body)
    expect(Object.keys(again.body)).toEqual([
      'id', 'company_id', 'folder_id', 'operation_id', 's3_key',
      'file_type', 'mime_type', 'file_size', 'original_filename', 'preview_url',
    ])
    expect(again.body.preview_url).toBe(derivePublicObjectUrl(BUCKET, REGION, libraryKey()))
    expect(media.rows).toHaveLength(1)
    expect(media.calls.filter((call) => call.type === 'upsert')).toHaveLength(1)
    expect(media.calls.find((call) => call.type === 'upsert').options).toBe(LIBRARY_MEDIA_UPSERT_OPTIONS)
    expect(repeated.svc.rpc.mock.calls.map((call) => call[0])).not.toContain('get_company_storage_used_mb')
  })

  it('preserva pasta e nome já gravados quando a operação compatível é repetida', async () => {
    const row = storedLibraryRow({
      folder_id: '88888888-8888-4888-8888-888888888888',
      original_filename: 'nome-historico.png',
    })
    const { run, media } = confirmParts({ rows: [row] })
    const result = await run()
    expect(result.status).toBe(200)
    expect(result.body.folder_id).toBe(row.folder_id)
    expect(result.body.original_filename).toBe('nome-historico.png')
    expect(result.body.s3_key).toBe(row.s3_key)
    expect(media.calls.some((call) => call.type === 'upsert')).toBe(false)
  })

  it('não cobra quota de operação compatível que estouraria o plano', async () => {
    const { run, svc, media } = confirmParts({
      rows: [storedLibraryRow()],
      svc: directSvc('admin', undefined, { companies: companyPlan(0) }),
    })
    svc.rpc.mockImplementation(credentialRpc({ data: 0, error: null }))
    expect((await run()).status).toBe(200)
    expect(svc.rpc.mock.calls.map((call) => call[0])).not.toContain('get_company_storage_used_mb')
    expect(media.calls.some((call) => call.type === 'upsert')).toBe(false)
  })

  it('bloqueia quota estrita antes da persistência', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exceeded = confirmParts({
      svc: directSvc('admin', undefined, { companies: companyPlan(0) }),
    })
    exceeded.svc.rpc.mockImplementation(credentialRpc({ data: 0, error: null }))
    const failed = confirmParts({
      svc: makeSvc({
        tables: {
          company_users: makeChain({ role: 'admin' }),
          company_folders: makeChain({ id: FOLDER_ID }),
          companies: makeChain(null, { message: 'segredo-plano', code: '57014' }),
        },
      }),
    })
    const exceededResult = await exceeded.run()
    const failedResult = await failed.run()
    expect(exceededResult.status).toBe(403)
    expect(exceededResult.body.error).toBe('plan_storage_limit_exceeded')
    expect(failedResult.body.error).toBe('plan_validation_failed')
    expect(JSON.stringify([failedResult.body, errorSpy.mock.calls])).not.toContain('segredo-plano')
    expect(exceeded.media.calls.some((call) => call.type === 'upsert')).toBe(false)
    expect(failed.media.calls.some((call) => call.type === 'upsert')).toBe(false)
    errorSpy.mockRestore()
  })

  it('diverge bucket, região, tamanho e MIME sem persistir', async () => {
    const bucket = confirmParts()
    bucket.svc.rpc.mockResolvedValue({
      data: [{ access_key_id: AWS_KEY, secret_access_key: AWS_SECRET, bucket: 'other-bucket', region: REGION }],
      error: null,
    })
    const region = confirmParts()
    region.svc.rpc.mockResolvedValue({
      data: [{ access_key_id: AWS_KEY, secret_access_key: AWS_SECRET, bucket: BUCKET, region: 'sa-east-1' }],
      error: null,
    })
    const size = confirmParts({ head: { contentLength: 1025, contentType: 'image/png' } })
    const mime = confirmParts({ head: { contentLength: 1024, contentType: 'image/jpeg' } })
    for (const run of [bucket, region, size, mime]) {
      expect((await run.run())).toEqual({ status: 409, body: { error: 'Confirmação divergente' } })
      expect(run.media.calls.some((call) => call.type === 'upsert')).toBe(false)
    }
    expect(bucket.headObject).not.toHaveBeenCalled()
  })

  it('simula concorrência e conflito dos campos protegidos', async () => {
    const race = memoryLibrary()
    race.api.conflictOnUpsert = true
    const raced = await confirmParts({ media: race }).run()
    expect(raced.status).toBe(200)
    expect(raced.body.id).toBe(MEDIA_ID)
    expect(race.rows).toHaveLength(1)

    const conflict = memoryLibrary()
    conflict.api.conflictOnUpsert = true
    conflict.api.conflictRow = { s3_key: `${libraryKey()}-outra` }
    const divergent = await confirmParts({ media: conflict }).run()
    expect(divergent).toEqual({ status: 409, body: { error: 'Confirmação divergente' } })
    expect(JSON.stringify(conflict.calls)).not.toContain('DeleteObject')
  })

  it('mapeia FK e falha técnica sem vazar o banco nem apagar o objeto', async () => {
    const fk = memoryLibrary()
    fk.api.upsertError = { code: '23503', message: 'lead_media_unified_company_folder_fkey' }
    const technical = memoryLibrary()
    technical.api.failUpsert = new Error('segredo-insert')
    const fkResult = await confirmParts({ media: fk }).run()
    const technicalResult = await confirmParts({ media: technical }).run()
    expect(fkResult).toEqual({ status: 409, body: { error: 'Confirmação divergente' } })
    expect(technicalResult).toEqual({ status: 503, body: { error: 'Confirmação temporariamente indisponível' } })
    expect(JSON.stringify([fkResult, technicalResult])).not.toMatch(/fkey|segredo-insert/)
    expect(fk.rows).toHaveLength(0)
  })

  it('rejeita corpo estrito e consulta técnica da operação', async () => {
    const extra = confirmParts({ body: { confirmToken: issueLibraryToken(), folderId: FOLDER_ID } })
    const query = confirmParts()
    query.media.api.selectError = { message: 'segredo-select', code: '57014' }
    expect((await extra.run()).status).toBe(400)
    expect(extra.svc.auth.getUser).not.toHaveBeenCalled()
    const queryResult = await query.run()
    expect(queryResult).toEqual({ status: 503, body: { error: 'Confirmação temporariamente indisponível' } })
    expect(JSON.stringify(queryResult)).not.toContain('segredo-select')
    expect(query.media.calls.some((call) => call.type === 'upsert')).toBe(false)
  })

  it('reconsulta a operação pelo escopo da empresa', async () => {
    const removed = confirmParts({
      svc: makeSvc({
        tableSeq: {
          company_folders: [
            makeChain({ id: FOLDER_ID }),
            makeChain(null),
          ],
        },
        tables: {
          company_users: makeChain({ role: 'admin' }),
          companies: companyPlan(null),
        },
      }),
      rows: [storedLibraryRow()],
    })
    expect((await removed.run())).toEqual({ status: 404, body: { error: 'Pasta não encontrada' } })
    expect(removed.media.calls.some((call) => call.type === 'upsert')).toBe(false)
    expect(removed.media.calls.some((call) => call.column === 'company_id' && call.value === COMPANY_ID)).toBe(true)
    expect(removed.media.calls.some((call) => call.column === 'operation_id')).toBe(true)
  })
})
