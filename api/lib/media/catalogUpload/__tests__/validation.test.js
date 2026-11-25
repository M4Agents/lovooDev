import { describe, expect, it } from 'vitest'
import {
  CATALOG_IMAGE_MAX_BYTES,
  CATALOG_IMAGE_MIME_TYPES,
  CATALOG_VIDEO_MAX_BYTES,
  CATALOG_VIDEO_MIME_TYPES,
  REJECTED_ACTIVE_MIME_TYPES,
} from '../constants.js'
import { presignCatalogUpload } from '../presignCatalogUpload.js'
import {
  authorizedEnv,
  makeChain,
  acceptedPut,
  makeReq,
  makeSvc,
  validBody,
} from './fixtures.js'

function adminSvc() {
  return makeSvc({ tables: { company_users: makeChain({ role: 'admin' }) } })
}

async function presign(body) {
  const svc = adminSvc()
  const result = await presignCatalogUpload({
    req: makeReq(body),
    body,
    svc,
    env: authorizedEnv(),
    createOperationId: () => '11111111-1111-4111-8111-111111111111',
    signPut: async (input) => acceptedPut(input),
  })
  return { result, svc }
}

describe('validação do upload de catálogo', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejeita tamanho %s', async (sizeBytes) => {
    const { result, svc } = await presign(validBody({ sizeBytes }))
    expect(result.status).toBe(400)
    expect(svc.rpc).not.toHaveBeenCalled()
  })

  it('rejeita tamanho fracionário em string e acima do limite', async () => {
    const textual = await presign(validBody({ sizeBytes: '1024' }))
    const image = await presign(validBody({ sizeBytes: CATALOG_IMAGE_MAX_BYTES + 1 }))
    const video = await presign(validBody({
      mimeType: 'video/mp4',
      fileName: 'clip.mp4',
      sizeBytes: CATALOG_VIDEO_MAX_BYTES + 1,
    }))
    expect(textual.result.status).toBe(400)
    expect(image.result.status).toBe(413)
    expect(video.result.status).toBe(413)
    expect(image.svc.rpc).not.toHaveBeenCalled()
  })

  it('aceita os limites exatos de imagem e vídeo', async () => {
    const image = await presign(validBody({ sizeBytes: CATALOG_IMAGE_MAX_BYTES }))
    const video = await presign(validBody({
      sourceType: 'service',
      mimeType: 'video/mp4',
      fileName: 'clip.mp4',
      sizeBytes: CATALOG_VIDEO_MAX_BYTES,
    }))
    expect(image.result.status).toBe(200)
    expect(video.result.status).toBe(200)
    expect(video.result.body.putHeaders['Content-Type']).toBe('video/mp4')
  })

  it('rejeita MIME inválido, SVG e sourceType inválido', async () => {
    const svg = await presign(validBody({ mimeType: 'image/svg+xml', fileName: 'icon.svg' }))
    const svgAlias = await presign(validBody({ mimeType: 'image/svg', fileName: 'icon.svg' }))
    const pdf = await presign(validBody({ mimeType: 'application/pdf', fileName: 'a.pdf' }))
    const upper = await presign(validBody({ mimeType: 'image/PNG' }))
    const parameter = await presign(validBody({ mimeType: 'image/png; charset=utf-8' }))
    const source = await presign(validBody({ sourceType: 'products' }))
    expect(svg.result.status).toBe(415)
    expect(svgAlias.result.status).toBe(415)
    expect(pdf.result.status).toBe(415)
    expect(upper.result.status).toBe(415)
    expect(parameter.result.status).toBe(415)
    expect(source.result.status).toBe(400)
    expect(svg.svc.rpc).not.toHaveBeenCalled()
  })

  it('rejeita nome inválido, traversal e chave ou bucket arbitrários', async () => {
    const traversal = await presign(validBody({ fileName: '../segredo.png' }))
    const slash = await presign(validBody({ fileName: 'pasta/foto.png' }))
    const control = await presign(validBody({ fileName: 'foto\u0000.png' }))
    const empty = await presign(validBody({ fileName: '' }))
    const longName = await presign(validBody({ fileName: `${'a'.repeat(201)}.png` }))
    const arbitraryKey = await presign({ ...validBody(), s3_key: 'clientes/outra/chave' })
    const arbitraryBucket = await presign({ ...validBody(), bucket: 'bucket-alheio', region: 'eu-west-1' })
    expect(traversal.result.status).toBe(400)
    expect(slash.result.status).toBe(400)
    expect(control.result.status).toBe(400)
    expect(empty.result.status).toBe(400)
    expect(longName.result.status).toBe(400)
    expect(arbitraryKey.result.status).toBe(400)
    expect(arbitraryBucket.result.status).toBe(400)
    expect(arbitraryKey.svc.rpc).not.toHaveBeenCalled()
    expect(arbitraryBucket.svc.rpc).not.toHaveBeenCalled()
  })

  it.each(REJECTED_ACTIVE_MIME_TYPES)('rejeita MIME ativo %s', async (mimeType) => {
    const { result, svc } = await presign(validBody({ mimeType, fileName: 'ativo.bin' }))
    expect(result.status).toBe(415)
    expect(result.body).toEqual({ error: 'Tipo de arquivo não permitido' })
    expect(svc.rpc).not.toHaveBeenCalled()
  })

  it.each(['image/heic', 'image/jpg', 'image/avif', 'video/ogg', 'video/3gpp'])(
    'rejeita MIME fora da lista explícita %s',
    async (mimeType) => {
      const { result, svc } = await presign(validBody({ mimeType, fileName: 'fora.bin' }))
      expect(result.status).toBe(415)
      expect(svc.rpc).not.toHaveBeenCalled()
    },
  )

  it.each([...CATALOG_IMAGE_MIME_TYPES, ...CATALOG_VIDEO_MIME_TYPES])(
    'aceita MIME explícito %s',
    async (mimeType) => {
      const video = mimeType.startsWith('video/')
      const { result } = await presign(validBody({
        mimeType,
        fileName: video ? 'clip.mp4' : 'foto.png',
        sizeBytes: video ? CATALOG_VIDEO_MAX_BYTES : CATALOG_IMAGE_MAX_BYTES,
      }))
      expect(result.status).toBe(200)
      expect(result.body.putHeaders['Content-Type']).toBe(mimeType)
    },
  )

  it('rejeita nome que desaparece na sanitização', async () => {
    const emoji = await presign(validBody({ fileName: '😀' }))
    const symbols = await presign(validBody({ fileName: '___' }))
    expect(emoji.result.status).toBe(400)
    expect(symbols.result.status).toBe(400)
    expect(emoji.svc.rpc).not.toHaveBeenCalled()
    expect(symbols.svc.rpc).not.toHaveBeenCalled()
  })

  it('sanitiza o nome em um único segmento e preserva o padrão da chave', async () => {
    const { result } = await presign(validBody({ fileName: 'Relatório final.png' }))
    expect(result.status).toBe(200)
    expect(result.body.s3_key).toMatch(
      /^clientes\/bbbb0000-0000-4000-8000-000000000002\/whatsapp\/\d{4}\/\d{2}\/\d{2}\/11111111-1111-4111-8111-111111111111\/Relatorio_final\.png$/,
    )
    expect(result.body.s3_key.split('/').filter(Boolean)).toHaveLength(8)
  })
})
