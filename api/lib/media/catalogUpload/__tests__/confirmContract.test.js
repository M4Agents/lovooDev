import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { CATALOG_MEDIA_UPSERT_OPTIONS } from '../catalogMetadata.js'
import { handleCatalogConfirm } from '../../../../media/uploads/catalog/confirm.js'
import {
  AWS_SECRET,
  COMPANY_ID,
  HMAC_SECRET,
  USER_ID,
  authorizedEnv,
  makeReq,
  mockRes,
} from './fixtures.js'
import { confirmParts, issueToken, keyFor } from './confirmHarness.js'

describe('contrato da confirmação', () => {
  it('rejeita campos extras e metadados controlados pelo cliente', async () => {
    const extra = confirmParts({ body: { confirmToken: issueToken(), impersonating: true, role: 'super_admin' } })
    const controlled = confirmParts({
      body: {
        confirmToken: issueToken(),
        company_id: 'dddd0000-0000-4000-8000-000000000004',
        s3_key: 'clientes/outra',
        folder_path: '/segredo',
      },
    })
    for (const parts of [extra, controlled]) {
      const result = await parts.run()
      expect(result).toEqual({ status: 400, body: { error: 'Pedido inválido' } })
      expect(parts.svc.auth.getUser).not.toHaveBeenCalled()
      expect(parts.headObject).not.toHaveBeenCalled()
      expect(parts.media.calls).toEqual([])
    }
  })

  it('responde no-store e não vaza segredo, stack ou detalhe interno', async () => {
    const parts = confirmParts()
    parts.svc.auth.getUser.mockRejectedValue(new Error('stack secret db down'))
    const res = mockRes()
    await handleCatalogConfirm(makeReq({ confirmToken: parts.token }), res, {
      svc: parts.svc,
      env: authorizedEnv(),
      now: () => new Date('2026-11-25T15:04:05.000Z'),
      headObject: parts.headObject,
    })
    expect(res.headers['Cache-Control']).toBe('no-store')
    expect(res.statusCode).toBe(503)
    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain(AWS_SECRET)
    expect(serialized).not.toContain(HMAC_SECRET)
    expect(serialized).not.toContain(parts.token)
    expect(serialized).not.toContain('stack')
    expect(serialized).not.toContain('db down')
  })

  it('o sucesso tem o envelope legado e não inclui credencial', async () => {
    const parts = confirmParts()
    const res = mockRes()
    await handleCatalogConfirm(makeReq({ confirmToken: parts.token }), res, {
      svc: parts.svc,
      env: authorizedEnv(),
      now: () => new Date('2026-11-25T15:04:05.000Z'),
      headObject: parts.headObject,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['Cache-Control']).toBe('no-store')
    expect(Object.keys(res.body).sort()).toEqual([
      'company_id',
      'file_type',
      'folder_path',
      'id',
      'original_filename',
      'preview_url',
      's3_key',
    ])
    expect(res.body).toMatchObject({
      id: expect.any(String),
      s3_key: keyFor(),
      file_type: 'image',
      original_filename: 'foto.png',
      company_id: COMPANY_ID,
      folder_path: '/produtos',
    })
    expect(JSON.stringify(res.body)).not.toContain(AWS_SECRET)
    expect(res.body.created_by).toBeUndefined()
    expect(parts.media.calls[0].values.created_by).toBe(USER_ID)
    expect(parts.media.calls[0].values.source_ref).toBeNull()
    expect(parts.media.calls[0].values.tags).toBeUndefined()
    expect(parts.media.calls[0].values.description).toBeUndefined()
    expect(parts.media.calls[0].values.thumbnail_s3_key).toBeUndefined()
  })

  it('rejeita método diferente de POST', async () => {
    const res = mockRes()
    await handleCatalogConfirm({ method: 'DELETE', headers: {}, body: { confirmToken: 'x' } }, res, {})
    expect(res.statusCode).toBe(405)
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('não contém operação destrutiva nem merge de duplicidade', () => {
    const confirm = readFileSync(new URL('../confirmCatalogUpload.js', import.meta.url), 'utf8')
    const head = readFileSync(new URL('../headCatalogObject.js', import.meta.url), 'utf8')
    const metadata = readFileSync(new URL('../catalogMetadata.js', import.meta.url), 'utf8')
    const combined = `${confirm}\n${head}\n${metadata}`
    expect(combined).not.toContain('DeleteObject')
    expect(combined).not.toContain('GetObject')
    expect(combined).not.toContain('merge-duplicates')
    expect(combined).not.toContain('AWS_ACCESS_KEY_ID')
    expect(combined).not.toContain('AWS_SECRET_ACCESS_KEY')
    expect(head).toContain('HeadObjectCommand')
    expect(metadata).toContain('ignoreDuplicates: true')
  })

  it('o cliente instalado envia resolution=ignore-duplicates e on_conflict', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([]), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }))
    const client = createClient('https://example.supabase.co', 'sb_publishable_test_fixture_key', {
      global: { fetch: fetchImpl },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const s3Key = keyFor()
    await client.from('company_media_library').upsert({
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
    }, CATALOG_MEDIA_UPSERT_OPTIONS).select('id')

    const [url, init] = fetchImpl.mock.calls[0]
    const headers = new Headers(init.headers)
    const prefer = headers.get('prefer') ?? ''
    expect(prefer).toContain('resolution=ignore-duplicates')
    expect(prefer).not.toContain('merge-duplicates')
    expect(new URL(url).searchParams.get('on_conflict')).toBe('company_id,s3_key')
  })
})
