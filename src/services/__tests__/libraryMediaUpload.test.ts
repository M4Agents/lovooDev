import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIBRARY_IMAGE_MAX_BYTES,
  LIBRARY_MEDIA_ACCEPT,
  LIBRARY_OTHER_MAX_BYTES,
  LIBRARY_PUT_TIMEOUT_MS,
  uploadLibraryMedia,
  validateLibraryMediaFile,
} from '../libraryMediaUpload'

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
const FOLDER = 'cccc0000-0000-4000-8000-000000000003'
const OPERATION = '11111111-1111-4111-8111-111111111111'
const MEDIA = 'ffff0000-0000-4000-8000-000000000009'

function session(userId: string, token = 'session-token') {
  return { data: { session: { access_token: token, user: { id: userId } } }, error: null }
}

function objectKey(fileName = 'foto.png') {
  return `clientes/${COMPANY}/library/2026/11/25/${OPERATION}/${fileName}`
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

function assetBody(fileName = 'foto.png', kind = 'image', mime = 'image/png', size = 32) {
  return {
    id: MEDIA,
    company_id: COMPANY,
    folder_id: FOLDER,
    operation_id: OPERATION,
    s3_key: objectKey(fileName),
    file_type: kind,
    mime_type: mime,
    file_size: size,
    original_filename: fileName,
    preview_url: `https://example-bucket.s3.us-east-1.amazonaws.com/${objectKey(fileName)}`,
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

describe('upload seguro da biblioteca', () => {
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

  it('conclui presign, PUT e confirm com o contrato da biblioteca', async () => {
    const result = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toMatchObject({
        id: MEDIA,
        preview_url: assetBody().preview_url,
        file_type: 'image',
        folder_id: FOLDER,
      })
    }
    const presign = calls('/api/media/uploads/library/presign')[0][1] as RequestInit
    expect(JSON.parse(String(presign.body))).toEqual({
      companyId: COMPANY,
      folderId: FOLDER,
      fileName: 'foto.png',
      mimeType: 'image/png',
      sizeBytes: 32,
    })
    expect(presign.credentials).toBe('omit')
    expect(new Headers(presign.headers).get('Authorization')).toBe('Bearer session-token')
    const put = calls('example-bucket')[0][1] as RequestInit
    const headers = new Headers(put.headers)
    expect(put.method).toBe('PUT')
    expect(put.credentials).toBe('omit')
    expect(headers.get('Authorization')).toBeNull()
    expect(headers.get('Content-Length')).toBeNull()
    expect([...headers.keys()]).toEqual(['content-type', 'if-none-match'])
    const confirm = calls('/api/media/uploads/library/confirm')[0][1] as RequestInit
    expect(JSON.parse(String(confirm.body))).toEqual({ confirmToken: 'confirm-token-fixture' })
    expect(calls('/api/media-library/save-metadata')).toHaveLength(0)
  })

  it('recusa sessão ausente, inválida, alterada e reaproveita o mesmo usuário', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    const absent = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
    expect(absent).toMatchObject({ ok: false, error: 'Sessão inválida ou expirada.' })
    expect(fetch).not.toHaveBeenCalled()

    getSession.mockResolvedValue({ data: { session: null }, error: { message: 'secret jwt' } })
    const invalid = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
    expect(JSON.stringify(invalid)).not.toContain('secret')

    getSession.mockResolvedValueOnce(session(USER)).mockResolvedValueOnce(session(OTHER))
    const changed = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
    expect(changed).toMatchObject({ ok: false, error: 'A sessão mudou durante o envio.' })
    expect(calls('/confirm')).toHaveLength(0)

    getSession.mockResolvedValue({ data: { session: null }, error: null })
    refreshSession.mockResolvedValue(session(USER, 'refreshed-token'))
    vi.mocked(fetch).mockClear()
    const renewed = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
    expect(renewed.ok).toBe(true)
    const presign = calls('/presign')[0][1] as RequestInit
    expect(new Headers(presign.headers).get('Authorization')).toBe('Bearer refreshed-token')
  })

  it('não envia o arquivo quando presign, quota ou MIME falham', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(403, { error: 'Permissão insuficiente para esta operação' })
      return new Response(null, { status: 500 })
    })
    const denied = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
    expect(denied).toMatchObject({ ok: false, error: 'Permissão insuficiente para esta operação' })
    expect(calls('example-bucket')).toHaveLength(0)

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(403, { error: 'plan_storage_limit_exceeded' })
      return new Response(null, { status: 500 })
    })
    const quota = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
    expect(quota).toMatchObject({ ok: false, error: 'O armazenamento do plano foi atingido.' })
    expect(calls('example-bucket')).toHaveLength(0)

    vi.mocked(fetch).mockImplementation(async () => json(403, { error: 'plan_validation_failed' }))
    const validation = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
    expect(validation).toMatchObject({ ok: false, error: 'Não foi possível validar o armazenamento do plano.' })

    vi.mocked(fetch).mockClear()
    for (const type of ['image/svg+xml', 'video/webm', 'video/wmv', 'audio/aac', 'application/octet-stream']) {
      expect(validateLibraryMediaFile(fileOf(type, 'arquivo.bin')).ok).toBe(false)
    }
    const unnamed = validateLibraryMediaFile(fileOf('', 'relatorio.pdf'))
    expect(unnamed).toMatchObject({ ok: false, message: 'O tipo do arquivo não foi informado.' })
    const literal = validateLibraryMediaFile(fileOf('image/jpg', 'foto.jpg'))
    expect(literal).toMatchObject({ ok: true, mimeType: 'image/jpg' })
    const huge = fileOf('image/png')
    Object.defineProperty(huge, 'size', { value: LIBRARY_IMAGE_MAX_BYTES + 1 })
    expect(validateLibraryMediaFile(huge).ok).toBe(false)
    const video = fileOf('video/mp4', 'clip.mp4')
    Object.defineProperty(video, 'size', { value: LIBRARY_OTHER_MAX_BYTES })
    expect(validateLibraryMediaFile(video).ok).toBe(true)
    const pdf = fileOf('application/pdf', 'doc.pdf')
    Object.defineProperty(pdf, 'size', { value: LIBRARY_OTHER_MAX_BYTES + 1 })
    expect(validateLibraryMediaFile(pdf).ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['campo extra', { ...presignBody(), extra: true }],
    ['chave de outro canal', { ...presignBody(), s3_key: objectKey().replace('/library/', '/whatsapp/') }],
    ['header inesperado', { ...presignBody(), putHeaders: { 'Content-Type': 'image/png', 'If-None-Match': '*', Authorization: 'Bearer x' } }],
  ])('rejeita presign com %s', async (_label, body) => {
    vi.mocked(fetch).mockResolvedValue(json(200, body))
    const result = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
    expect(result).toMatchObject({ ok: false, error: 'Falha ao preparar upload.' })
    expect(calls('example-bucket')).toHaveLength(0)
  })

  it('recusa DTO de confirm divergente', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(200, presignBody())
      return json(200, { ...assetBody(), preview_url: 'https://evil.example/arquivo' })
    })
    const result = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
    expect(result).toMatchObject({ ok: false, error: 'Falha ao confirmar upload.' })
  })

  it('recupera PUT ambíguo sem repetir o PUT', async () => {
    for (const status of [409, 412]) {
      vi.mocked(fetch).mockClear()
      vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
        const href = String(input)
        if (href.includes('/presign')) return json(200, presignBody())
        if (href.includes('/confirm')) return json(200, assetBody())
        return new Response(null, { status })
      })
      const result = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
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
    const result = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
    expect(result).toMatchObject({ ok: false, error: 'Falha ao enviar o arquivo.' })
    expect(calls('/confirm')).toHaveLength(0)
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
    const pending = uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
    await vi.advanceTimersByTimeAsync(LIBRARY_PUT_TIMEOUT_MS)
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
    const lost = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
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
    const recovered = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
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
    const exhausted = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
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
    const expired = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER)
    expect(expired).toMatchObject({ ok: false, error: 'Token expirado. Selecione o arquivo novamente.' })
    expect(confirmCalls).toBe(1)
  })

  it('cancelamento não inicia recuperação', async () => {
    const early = new AbortController()
    early.abort()
    const before = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER, early.signal)
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
    const put = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER, duringPut.signal)
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
    const confirm = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER, duringConfirm.signal)
    expect(confirm).toMatchObject({ cancelled: true })
    expect(confirmCalls).toBe(1)

    const duringRead = new AbortController()
    confirmCalls = 0
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const href = String(input)
      if (href.includes('/presign')) return json(200, presignBody())
      if (href.includes('/confirm')) {
        confirmCalls += 1
        const response = json(200, assetBody())
        const read = response.json.bind(response)
        response.json = async () => {
          duringRead.abort()
          return read()
        }
        return response
      }
      return new Response(null, { status: 200 })
    })
    const read = await uploadLibraryMedia(fileOf('image/png'), COMPANY, FOLDER, duringRead.signal)
    expect(read).toMatchObject({ cancelled: true })
    expect(confirmCalls).toBe(1)
  })

  it('não referencia credenciais AWS, s3Storage nem save-metadata', () => {
    const upload = readFileSync(new URL('../libraryMediaUpload.ts', import.meta.url), 'utf8')
    const component = readFileSync(new URL('../../components/MediaLibrary/DirectS3Upload.tsx', import.meta.url), 'utf8')
    const library = readFileSync(new URL('../../pages/MediaLibrary.tsx', import.meta.url), 'utf8')
    const biblioteca = readFileSync(new URL('../../components/WhatsAppChat/LeadPanel/BibliotecaV2.tsx', import.meta.url), 'utf8')
    const attachment = readFileSync(new URL('../../components/Automation/forms/FileAttachmentForm.tsx', import.meta.url), 'utf8')
    for (const source of [upload, component]) {
      expect(source).not.toMatch(/credentialsManager|s3Storage|S3Storage|save-metadata/)
    }
    expect(library).toContain('companyId={company.id}')
    expect(library).toContain('folderId={state.currentFolder.id}')
    expect(library).toContain('showDragDrop={true}')
    expect(biblioteca).toContain('companyId={companyId}')
    expect(biblioteca).toContain('folderId={currentFolderId}')
    expect(attachment).toContain('fileUrl: uploadedFile.preview_url')
    expect(attachment).toContain('libraryFileId: uploadedFile.id')
    expect(attachment).toContain('fileType: uploadedFile.file_type')
    expect(attachment).toContain('folderId={selectedFolderId}')
    expect(library.lastIndexOf('!state.currentFolder', library.indexOf('<DirectS3Upload'))).toBeGreaterThan(-1)
    expect(biblioteca.lastIndexOf('currentFolderId &&', biblioteca.indexOf('<DirectS3Upload'))).toBeGreaterThan(-1)
    expect(attachment.lastIndexOf('!selectedFolderId', attachment.indexOf('<DirectS3Upload'))).toBeGreaterThan(-1)
    const accepted = LIBRARY_MEDIA_ACCEPT.split(',')
    expect(accepted).toHaveLength(39)
    expect(accepted.filter((item) => item.includes('/'))).toHaveLength(22)
    expect(LIBRARY_MEDIA_ACCEPT).not.toMatch(/image\/\*|video\/\*|audio\/\*/)
    expect(LIBRARY_MEDIA_ACCEPT).not.toMatch(/\.svg|\.webm|\.aac|\.txt|\.csv/)
  })

  it('não converte image/jpg nem aceita arquivo só pela extensão', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input)
      if (href.includes('/presign')) {
        const body = JSON.parse(String(init?.body)) as { mimeType: string; fileName: string }
        return json(200, presignBody(body.mimeType, body.fileName))
      }
      if (href.includes('/confirm')) return json(200, assetBody('foto.jpg', 'image', 'image/jpg', 32))
      return new Response(null, { status: 200 })
    })
    const file = fileOf('image/jpg', 'foto.jpg')
    expect(file.type).toBe('image/jpg')
    const result = await uploadLibraryMedia(file, COMPANY, FOLDER)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.mime_type).toBe('image/jpg')
    const sent = JSON.parse(String((calls('/presign')[0][1] as RequestInit).body)) as { mimeType: string }
    expect(sent.mimeType).toBe('image/jpg')

    vi.mocked(fetch).mockClear()
    const extensionOnly = await uploadLibraryMedia(new File([new Uint8Array(8)], 'foto.jpg', { type: '' }), COMPANY, FOLDER)
    expect(extensionOnly).toMatchObject({ ok: false, error: 'O tipo do arquivo não foi informado.' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
