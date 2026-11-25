import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CATALOG_MEDIA_MAX_VIDEO_BYTES,
  CATALOG_PUT_TIMEOUT_MS,
  uploadCatalogMediaToLibrary,
  validateCatalogMediaFile,
} from '../catalogLibraryUpload'

const { getSession, refreshSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
      refreshSession: (...args: unknown[]) => refreshSession(...args),
    },
  },
}))

const USER = 'aaaa0000-0000-4000-8000-000000000001'
const OTHER = 'dddd0000-0000-4000-8000-000000000004'
const COMPANY = 'bbbb0000-0000-4000-8000-000000000002'
const OPERATION = '11111111-1111-4111-8111-111111111111'
const MEDIA = 'ffff0000-0000-4000-8000-000000000009'

function session(userId: string, token = 'session-token') {
  return { data: { session: { access_token: token, user: { id: userId } } }, error: null }
}

function objectKey(fileName = 'foto.png') {
  return `clientes/${COMPANY}/whatsapp/2026/11/25/${OPERATION}/${fileName}`
}

function putUrl(fileName = 'foto.png') {
  const key = encodeURI(objectKey(fileName))
  return `https://example-bucket.s3.us-east-1.amazonaws.com/${key}?X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bif-none-match&X-Amz-Expires=300`
}

function presignBody(mime = 'image/png', fileName = 'foto.png') {
  return {
    operationId: OPERATION,
    putUrl: putUrl(fileName),
    putHeaders: { 'Content-Type': mime, 'If-None-Match': '*' },
    expiresIn: 300,
    s3_key: objectKey(fileName),
    confirmToken: 'confirm-token-fixture',
    confirmExpiresIn: 900,
  }
}

function assetBody(folder = '/produtos', fileName = 'foto.png', kind = 'image') {
  return {
    id: MEDIA,
    s3_key: objectKey(fileName),
    file_type: kind,
    original_filename: fileName,
    preview_url: `https://example-bucket.s3.us-east-1.amazonaws.com/${objectKey(fileName)}`,
    company_id: COMPANY,
    folder_path: folder,
  }
}

function fileOf(type: string, name = 'foto.png', bytes = 32) {
  return new File([new Uint8Array(bytes)], name, { type })
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function calls(part: string) {
  return vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).includes(part))
}

describe('upload seguro do catálogo', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getSession.mockReset()
    refreshSession.mockReset()
    getSession.mockResolvedValue(session(USER))
    refreshSession.mockResolvedValue({ data: { session: null }, error: null })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input)
      if (href.includes('/presign')) return json(200, presignBody())
      if (href.includes('/confirm')) return json(200, assetBody())
      return new Response(null, { status: 200 })
    }))
  })

  it('recusa sessão ausente, inválida e alterada antes de confirmar', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    const absent = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
    expect(absent).toMatchObject({ ok: false, error: 'Sessão inválida ou expirada.' })
    expect(fetch).not.toHaveBeenCalled()

    getSession.mockResolvedValue({ data: { session: null }, error: { message: 'secret jwt' } })
    const invalid = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
    expect(invalid.ok).toBe(false)
    expect(JSON.stringify(invalid)).not.toContain('secret')

    getSession
      .mockResolvedValueOnce(session(USER))
      .mockResolvedValueOnce(session(OTHER))
    const changed = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
    expect(changed).toMatchObject({ ok: false, error: 'A sessão mudou durante o envio.' })
    expect(calls('/confirm')).toHaveLength(0)
    expect(calls('example-bucket')).toHaveLength(1)
  })

  it('reaproveita o refresh do mesmo usuário', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    refreshSession.mockResolvedValue(session(USER, 'refreshed-token'))
    const result = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
    expect(result.ok).toBe(true)
    const presign = calls('/presign')[0][1] as RequestInit
    expect(new Headers(presign.headers).get('Authorization')).toBe('Bearer refreshed-token')
  })

  it('não envia o arquivo quando o presign é negado e o corpo tem só os cinco campos', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(403, { error: 'Permissão insuficiente para esta operação' })
      return new Response(null, { status: 500 })
    })
    const result = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
    expect(result).toMatchObject({ ok: false, error: 'Permissão insuficiente para esta operação' })
    expect(calls('example-bucket')).toHaveLength(0)
    const init = calls('/presign')[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      companyId: COMPANY,
      sourceType: 'product',
      fileName: 'foto.png',
      mimeType: 'image/png',
      sizeBytes: 32,
    })
    expect(init.credentials).toBe('omit')
  })

  it.each([
    ['campo extra', { ...presignBody(), extra: true }],
    ['url http', { ...presignBody(), putUrl: presignBody().putUrl.replace('https://', 'http://') }],
    ['outra empresa', { ...presignBody(), s3_key: objectKey().replace(COMPANY, OTHER) }],
    ['header inesperado', { ...presignBody(), putHeaders: { 'Content-Type': 'image/png', 'If-None-Match': '*', Authorization: 'Bearer x' } }],
    ['destino path-style', { ...presignBody(), putUrl: `https://s3.us-east-1.amazonaws.com/example-bucket/${objectKey()}?X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bif-none-match&X-Amz-Expires=300` }],
  ])('rejeita presign com %s', async (_label, body) => {
    vi.mocked(fetch).mockResolvedValue(json(200, body))
    const result = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
    expect(result).toMatchObject({ ok: false, error: 'Falha ao preparar upload.' })
    expect(calls('example-bucket')).toHaveLength(0)
  })

  it('faz PUT sem Bearer, cookies ou Content-Length manual', async () => {
    await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
    const init = calls('example-bucket')[0][1] as RequestInit
    const headers = new Headers(init.headers)
    expect(init.method).toBe('PUT')
    expect(init.credentials).toBe('omit')
    expect(headers.get('Authorization')).toBeNull()
    expect(headers.get('Content-Length')).toBeNull()
    expect(headers.get('Content-Type')).toBe('image/png')
    expect(headers.get('If-None-Match')).toBe('*')
    expect([...headers.keys()]).toEqual(['content-type', 'if-none-match'])
  })

  it('rejeita arquivo vazio, MIME ausente e formatos fora da allowlist', () => {
    expect(validateCatalogMediaFile(new File([], 'vazio.png', { type: 'image/png' })).ok).toBe(false)
    expect(validateCatalogMediaFile(fileOf('', 'sem-tipo.png')).ok).toBe(false)
    for (const type of ['image/heic', 'image/heif', 'image/avif', 'image/svg+xml', 'video/ogg']) {
      const result = validateCatalogMediaFile(fileOf(type, 'arquivo.bin'))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.message).toContain('JPEG')
    }
    const huge = fileOf('image/png')
    Object.defineProperty(huge, 'size', { value: 5 * 1024 * 1024 + 1 })
    const over = validateCatalogMediaFile(huge)
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.message).toContain('5 MB')
    expect(validateCatalogMediaFile(fileOf('video/mp4', 'clip.mp4'), { imagesOnly: true }).ok).toBe(false)
    expect(validateCatalogMediaFile(fileOf('video/quicktime', 'clip.mov')).ok).toBe(true)
    const videoLimit = fileOf('video/mp4', 'limite.mp4')
    Object.defineProperty(videoLimit, 'size', { value: CATALOG_MEDIA_MAX_VIDEO_BYTES })
    expect(validateCatalogMediaFile(videoLimit).ok).toBe(true)
    const videoOver = fileOf('video/mp4', 'acima.mp4')
    Object.defineProperty(videoOver, 'size', { value: CATALOG_MEDIA_MAX_VIDEO_BYTES + 1 })
    const videoRejected = validateCatalogMediaFile(videoOver)
    expect(videoRejected.ok).toBe(false)
    if (!videoRejected.ok) expect(videoRejected.message).toContain('30 MB')
  })

  it('confirma só com o token e recusa DTO divergente', async () => {
    const ok = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.data.id).toBe(MEDIA)
      expect(ok.data.folder_path).toBe('/produtos')
    }
    const confirmInit = calls('/confirm')[0][1] as RequestInit
    expect(JSON.parse(String(confirmInit.body))).toEqual({ confirmToken: 'confirm-token-fixture' })
    expect(new Headers(confirmInit.headers).get('Authorization')).toBe('Bearer session-token')

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(200, presignBody())
      return json(200, { ...assetBody(), company_id: OTHER })
    })
    const bad = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
    expect(bad).toMatchObject({ ok: false, error: 'Falha ao confirmar upload.' })
  })

  it('recupera PUT ambíguo uma vez e não repete o PUT', async () => {
    for (const status of [409, 412]) {
      vi.mocked(fetch).mockClear()
      vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
        const href = String(input)
        if (href.includes('/presign')) return json(200, presignBody())
        if (href.includes('/confirm')) return json(200, assetBody())
        return new Response(null, { status })
      })
      const result = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
      expect(result.ok).toBe(true)
      expect(calls('example-bucket')).toHaveLength(1)
      expect(calls('/confirm')).toHaveLength(1)
    }
  })

  it.each([400, 403])('PUT %s não confirma', async (status) => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(200, presignBody())
      return new Response(null, { status })
    })
    const result = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
    expect(result).toMatchObject({ ok: false, error: 'Falha ao enviar o arquivo.' })
    expect(calls('/confirm')).toHaveLength(0)
    expect(calls('example-bucket')).toHaveLength(1)
  })

  it('timeout e resposta perdida confirmam sem segundo PUT', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input)
      if (href.includes('/presign')) return Promise.resolve(json(200, presignBody()))
      if (href.includes('/confirm')) return Promise.resolve(json(200, assetBody()))
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('timeout')
          error.name = 'AbortError'
          reject(error)
        })
      })
    })
    const pending = uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
    await vi.advanceTimersByTimeAsync(CATALOG_PUT_TIMEOUT_MS)
    await expect(pending).resolves.toMatchObject({ ok: true })
    expect(calls('example-bucket')).toHaveLength(1)
    expect(calls('/confirm')).toHaveLength(1)
    vi.useRealTimers()

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(200, presignBody())
      if (String(input).includes('/confirm')) return json(200, assetBody())
      throw new TypeError('network down')
    })
    vi.mocked(fetch).mockClear()
    const lost = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
    expect(lost.ok).toBe(true)
    expect(calls('example-bucket')).toHaveLength(1)
    expect(calls('/confirm').length).toBeGreaterThan(0)
    expect(calls('/confirm').length).toBeLessThanOrEqual(2)
  })

  it('repete a confirmação no máximo duas vezes e encerra token expirado', async () => {
    let confirmCalls = 0
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(200, presignBody())
      if (String(input).includes('/confirm')) {
        confirmCalls += 1
        return confirmCalls === 1 ? json(503, { error: 'db secret timeout' }) : json(200, assetBody())
      }
      return new Response(null, { status: 200 })
    })
    const recovered = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
    expect(recovered.ok).toBe(true)
    expect(confirmCalls).toBe(2)
    expect(JSON.stringify(recovered)).not.toContain('secret')

    confirmCalls = 0
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(200, presignBody())
      if (String(input).includes('/confirm')) {
        confirmCalls += 1
        return json(503, { error: 'ainda indisponível' })
      }
      return new Response(null, { status: 200 })
    })
    const exhausted = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
    expect(exhausted.ok).toBe(false)
    expect(confirmCalls).toBe(2)

    confirmCalls = 0
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(200, presignBody())
      if (String(input).includes('/confirm')) {
        confirmCalls += 1
        return json(410, { error: 'Token expirado' })
      }
      return new Response(null, { status: 200 })
    })
    vi.mocked(fetch).mockClear()
    const expired = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product')
    expect(expired).toMatchObject({ ok: false, error: 'Token expirado. Selecione o arquivo novamente.' })
    expect(confirmCalls).toBe(1)
    expect(calls('example-bucket')).toHaveLength(1)
  })

  it('cancelamento em cada fase não confirma de novo', async () => {
    const early = new AbortController()
    early.abort()
    const before = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product', early.signal)
    expect(before).toMatchObject({ cancelled: true })
    expect(fetch).not.toHaveBeenCalled()

    const duringPut = new AbortController()
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input)
      if (href.includes('/presign')) return Promise.resolve(json(200, presignBody()))
      duringPut.abort()
      const error = new Error('aborted')
      error.name = 'AbortError'
      init?.signal?.throwIfAborted?.()
      return Promise.reject(error)
    })
    const put = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product', duringPut.signal)
    expect(put).toMatchObject({ cancelled: true })
    expect(calls('/confirm')).toHaveLength(0)

    const duringConfirm = new AbortController()
    let confirmCalls = 0
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const href = String(input)
      if (href.includes('/presign')) return Promise.resolve(json(200, presignBody()))
      if (href.includes('/confirm')) {
        confirmCalls += 1
        duringConfirm.abort()
        const error = new Error('aborted')
        error.name = 'AbortError'
        return Promise.reject(error)
      }
      return Promise.resolve(new Response(null, { status: 200 }))
    })
    vi.mocked(fetch).mockClear()
    const confirmed = await uploadCatalogMediaToLibrary(fileOf('image/png'), COMPANY, 'product', duringConfirm.signal)
    expect(confirmed).toMatchObject({ ok: false, cancelled: true })
    expect(confirmCalls).toBe(1)
    expect(calls('example-bucket')).toHaveLength(1)
    expect(calls('/confirm')).toHaveLength(1)
  })

  it('grava serviço na pasta /servicos e não chama legado nem AWS do navegador', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(200, presignBody('video/mp4', 'clip.mp4'))
      if (String(input).includes('/confirm')) return json(200, assetBody('/servicos', 'clip.mp4', 'video'))
      return new Response(null, { status: 200 })
    })
    const result = await uploadCatalogMediaToLibrary(fileOf('video/mp4', 'clip.mp4'), COMPANY, 'service')
    expect(result.ok).toBe(true)
    const source = readFileSync(new URL('../catalogLibraryUpload.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('S3Storage')
    expect(source).not.toContain('credentialsManager')
    expect(source).not.toContain('s3Client')
    expect(source).not.toContain('save-catalog-metadata')
  })
})
