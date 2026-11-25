import { describe, expect, it } from 'vitest'
import { CATALOG_MEDIA_UPSERT_OPTIONS, sameCatalogFileSize } from '../catalogMetadata.js'
import { COMPANY_ID, OTHER_ID, USER_ID } from './fixtures.js'
import {
  MEDIA_ID,
  confirmParts,
  issueToken,
  keyFor,
  memoryMedia,
} from './confirmHarness.js'

function storedRow(overrides = {}) {
  const s3Key = keyFor()
  return {
    id: MEDIA_ID,
    company_id: COMPANY_ID,
    s3_key: s3Key,
    original_filename: 'foto.png',
    file_type: 'image',
    mime_type: 'image/png',
    file_size: 1024,
    folder_path: '/produtos',
    preview_url: `https://example-bucket.s3.us-east-1.amazonaws.com/${s3Key}`,
    created_by: USER_ID,
    source_ref: null,
    ...overrides,
  }
}

describe('idempotência simulada da confirmação', () => {
  it('insere na primeira confirmação e repete o mesmo id sem merge', async () => {
    const media = memoryMedia()
    const first = confirmParts({ media, token: issueToken() })
    const created = await first.run()
    const repeated = confirmParts({ media, token: first.token, svc: first.svc })
    const again = await repeated.run()
    expect(created.status).toBe(200)
    expect(again.status).toBe(200)
    expect(again.body.id).toBe(created.body.id)
    expect(media.rows).toHaveLength(1)
    expect(media.calls.filter((call) => call.type === 'upsert').every((call) => call.options === CATALOG_MEDIA_UPSERT_OPTIONS)).toBe(true)
    expect(media.calls.some((call) => call.type === 'eq' && call.column === 'company_id' && call.value === COMPANY_ID)).toBe(true)
    expect(media.calls.some((call) => call.type === 'eq' && call.column === 's3_key')).toBe(true)
  })

  it('concorrência simulada no double, sem banco real, devolve o mesmo id', async () => {
    const media = memoryMedia()
    const token = issueToken()
    const winner = await confirmParts({ media, token }).run()
    media.api.upsertResult = { data: [], error: null }
    const loser = await confirmParts({ media, token }).run()
    expect(winner.body.id).toBe(MEDIA_ID)
    expect(loser.body.id).toBe(MEDIA_ID)
    expect(media.rows).toHaveLength(1)
  })

  it('aceita file_size bigint canônico em string e rejeita coerções', () => {
    expect(sameCatalogFileSize('1024', 1024)).toBe(true)
    expect(sameCatalogFileSize(1024n, 1024)).toBe(true)
    expect(sameCatalogFileSize('01024', 1024)).toBe(false)
    expect(sameCatalogFileSize('1024.0', 1024)).toBe(false)
    expect(sameCatalogFileSize(1024.5, 1024)).toBe(false)
    expect(sameCatalogFileSize(true, 1024)).toBe(false)
  })

  it('aceita a representação string do bigint gravado', async () => {
    const media = memoryMedia()
    media.api.sizeAsString = true
    const result = await confirmParts({ media }).run()
    expect(result.status).toBe(200)
    expect(result.body.id).toBe(MEDIA_ID)
  })

  it.each([
    ['company_id', { company_id: OTHER_ID }],
    ['s3_key', { s3_key: `${keyFor()}-outra` }],
    ['original_filename', { original_filename: 'outra.png' }],
    ['file_type', { file_type: 'video' }],
    ['mime_type', { mime_type: 'image/jpeg' }],
    ['file_size', { file_size: 1025 }],
    ['folder_path', { folder_path: '/servicos' }],
    ['preview_url', { preview_url: 'https://example-bucket.s3.us-east-1.amazonaws.com/outra' }],
    ['created_by', { created_by: OTHER_ID }],
  ])('divergência de %s retorna 409 sem alterar o registro', async (field, patch) => {
    const media = memoryMedia()
    const token = issueToken()
    if (field === 'company_id' || field === 's3_key') {
      media.api.upsertResult = { data: [{ ...storedRow(), ...patch }], error: null }
    } else {
      media.rows.push(storedRow(patch))
    }
    const before = JSON.stringify(media.rows)
    const result = await confirmParts({ media, token }).run()
    expect(result).toEqual({ status: 409, body: { error: 'Confirmação divergente' } })
    expect(JSON.stringify(media.rows)).toBe(before)
    expect(result.body.id).toBeUndefined()
  })

  it.each([
    ['source_ref preenchido', { source_ref: 'catalog' }],
    ['created_by nulo', { created_by: null }],
  ])('%s é incompatível', async (_label, patch) => {
    const media = memoryMedia()
    media.rows.push(storedRow(patch))
    const result = await confirmParts({ media }).run()
    expect(result.status).toBe(409)
    expect(media.rows[0].source_ref).toBe(patch.source_ref ?? null)
  })

  it('não devolve registro de outro tenant quando a releitura é filtrada', async () => {
    const media = memoryMedia()
    media.rows.push(storedRow({ company_id: OTHER_ID, id: 'abab0000-0000-4000-8000-000000000010' }))
    media.api.upsertResult = { data: [], error: null }
    const result = await confirmParts({ media }).run()
    expect(result.status).toBe(500)
    expect(JSON.stringify(result.body)).not.toContain(OTHER_ID)
    expect(media.calls.some((call) => call.column === 'company_id' && call.value === COMPANY_ID)).toBe(true)
  })

  it('falha de releitura, constraint diferente e resposta perdida permanecem indeterminadas', async () => {
    const reread = memoryMedia()
    reread.rows.push(storedRow())
    reread.api.upsertResult = { data: [], error: null }
    reread.api.selectResult = { data: null, error: { message: 'read timeout secret' } }
    const constraint = memoryMedia()
    constraint.api.upsertResult = {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "company_media_library_pkey"' },
    }
    const lost = memoryMedia()
    lost.api.failAfterInsert = true
    const unexpected = memoryMedia()
    unexpected.api.upsertResult = { data: { id: MEDIA_ID }, error: null }

    const rereadResult = await confirmParts({ media: reread }).run()
    const constraintResult = await confirmParts({ media: constraint }).run()
    const lostResult = await confirmParts({ media: lost }).run()
    const unexpectedResult = await confirmParts({ media: unexpected }).run()
    for (const result of [rereadResult, constraintResult, lostResult, unexpectedResult]) {
      expect(result).toEqual({ status: 500, body: { error: 'Falha ao confirmar upload' } })
      expect(JSON.stringify(result.body)).not.toMatch(/secret|pkey|response lost/i)
    }

    lost.api.failAfterInsert = false
    lost.api.upsertResult = { data: [], error: null }
    const retried = await confirmParts({ media: lost }).run()
    expect(retried.status).toBe(200)
    expect(retried.body.id).toBe(MEDIA_ID)
  })

  it('serviço usa a pasta /servicos', async () => {
    const parts = confirmParts({ token: issueToken({ sourceType: 'service' }) })
    const result = await parts.run()
    expect(result.status).toBe(200)
    expect(result.body.folder_path).toBe('/servicos')
  })
})
