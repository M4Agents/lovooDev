import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_OTHER_MAX_BYTES,
  CHAT_PUT_TIMEOUT_MS,
  uploadChatMedia,
} from '../chatMediaUpload'

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
const CONVERSATION = 'cccc0000-0000-4000-8000-000000000003'
const INSTANCE = 'eeee0000-0000-4000-8000-000000000005'
const FLOW = 'ffff0000-0000-4000-8000-000000000006'
const OPERATION = '11111111-1111-4111-8111-111111111111'

class FakeXhr {
  static instances: FakeXhr[] = []
  status = 200
  withCredentials = true
  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: unknown = null
  aborted = false
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  ontimeout: (() => void) | null = null

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  send(body: unknown) {
    this.body = body
    FakeXhr.instances.push(this)
    queueMicrotask(() => {
      if (this.aborted) return
      this.upload.onprogress?.({ lengthComputable: true, loaded: 16, total: 32 } as ProgressEvent)
      this.onload?.()
    })
  }

  abort() {
    this.aborted = true
    this.onabort?.()
  }
}

function session(userId: string, token = 'session-token') {
  return { data: { session: { access_token: token, user: { id: userId } } }, error: null }
}

function objectKey(fileName = 'foto.png') {
  return `clientes/${COMPANY}/whatsapp/2026/11/26/${OPERATION}/${fileName}`
}

function putUrl(fileName = 'foto.png') {
  return `https://example-bucket.s3.us-east-1.amazonaws.com/${encodeURI(objectKey(fileName))}?X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bif-none-match&X-Amz-Expires=300`
}

function presignBody(contentType = 'image/jpeg', fileName = 'foto.png') {
  return {
    operationId: OPERATION,
    putUrl: putUrl(fileName),
    putHeaders: { 'Content-Type': contentType, 'If-None-Match': '*' },
    expiresIn: 300,
    s3_key: objectKey(fileName),
    confirmToken: 'confirm-token-fixture',
    confirmExpiresIn: 900,
  }
}

function confirmBody(fileName = 'foto.png') {
  return { media_url: `https://example-bucket.s3.us-east-1.amazonaws.com/${objectKey(fileName)}` }
}

function fileOf(type: string, name = 'foto.png', bytes = 32) {
  return new File([new Uint8Array(bytes)], name, { type })
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function calls(part: string) {
  return vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).includes(part))
}

function lastInit(part: string): RequestInit | undefined {
  const found = calls(part)
  return found[found.length - 1]?.[1]
}

function manual() {
  return { purpose: 'chat_manual' as const, companyId: COMPANY, conversationId: CONVERSATION }
}

function schedule(onProgress?: (loaded: number, total: number) => void) {
  return {
    purpose: 'chat_schedule' as const,
    companyId: COMPANY,
    conversationId: CONVERSATION,
    instanceId: INSTANCE,
    onProgress,
  }
}

function automation() {
  return { purpose: 'automation_audio' as const, companyId: COMPANY, flowId: FLOW }
}

describe('upload do chat Uazapi', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getSession.mockReset()
    refreshSession.mockReset()
    FakeXhr.instances = []
    getSession.mockResolvedValue(session(USER))
    refreshSession.mockResolvedValue({ data: { session: null }, error: null })
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input)
      if (href.includes('/presign')) {
        const body = JSON.parse(String(init?.body)) as { fileName?: string; mimeType?: string }
        const declared = body.mimeType ?? ''
        const effective = declared.startsWith('image/svg') ? 'application/octet-stream' : (declared.split(';')[0] || 'application/octet-stream')
        return json(200, presignBody(effective, body.fileName || 'foto.png'))
      }
      if (href.includes('/confirm')) {
        const presign = JSON.parse(String(lastInit('/presign')?.body)) as { fileName?: string }
        return json(200, confirmBody(presign.fileName || 'foto.png'))
      }
      return new Response(null, { status: 200 })
    }))
  })

  it('envia as três finalidades sem campos extras e devolve a URL estável', async () => {
    const image = await uploadChatMedia(fileOf('image/jpeg'), manual())
    const scheduled = await uploadChatMedia(fileOf('application/pdf', 'contrato.pdf'), schedule())
    const audio = await uploadChatMedia(fileOf('audio/webm;codecs=opus', 'gravacao.webm'), automation())

    expect(image).toEqual({ ok: true, media_url: confirmBody().media_url })
    expect(scheduled).toEqual({ ok: true, media_url: confirmBody('contrato.pdf').media_url })
    expect(audio).toEqual({ ok: true, media_url: confirmBody('gravacao.webm').media_url })
    expect(JSON.parse(String((calls('/presign')[0][1] as RequestInit).body))).toEqual({
      companyId: COMPANY,
      purpose: 'chat_manual',
      conversationId: CONVERSATION,
      messageType: 'image',
      fileName: 'foto.png',
      mimeType: 'image/jpeg',
      sizeBytes: 32,
    })
    const scheduleBody = JSON.parse(String((calls('/presign')[1][1] as RequestInit).body))
    expect(scheduleBody).toEqual({
      companyId: COMPANY,
      purpose: 'chat_schedule',
      conversationId: CONVERSATION,
      instanceId: INSTANCE,
      messageType: 'document',
      fileName: 'contrato.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 32,
    })
    expect(scheduleBody.onProgress).toBeUndefined()
    const audioBody = JSON.parse(String(lastInit('/presign')?.body))
    expect(audioBody).toEqual({
      companyId: COMPANY,
      purpose: 'automation_audio',
      flowId: FLOW,
      messageType: 'audio',
      fileName: 'gravacao.webm',
      mimeType: 'audio/webm;codecs=opus',
      sizeBytes: 32,
    })
    expect(audioBody.conversationId).toBeUndefined()
    expect(FakeXhr.instances).toHaveLength(1)
    expect(calls('example-bucket')).toHaveLength(2)
  })

  it('faz PUT com o contentType efetivo, sem Bearer, cookies ou Content-Length', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const href = String(input)
      if (href.includes('/presign')) return json(200, presignBody('application/octet-stream', 'icone.svg'))
      if (href.includes('/confirm')) return json(200, confirmBody('icone.svg'))
      return new Response(null, { status: 200 })
    })
    const file = fileOf('image/svg+xml', 'icone.svg')
    const result = await uploadChatMedia(file, manual())
    const init = calls('example-bucket')[0][1] as RequestInit
    const headers = new Headers(init.headers)
    expect(result.ok).toBe(true)
    expect(init.method).toBe('PUT')
    expect(init.credentials).toBe('omit')
    expect(init.body).toBe(file)
    expect(headers.get('Authorization')).toBeNull()
    expect(headers.get('Content-Length')).toBeNull()
    expect(headers.get('Content-Type')).toBe('application/octet-stream')
    expect(headers.get('If-None-Match')).toBe('*')
    expect([...headers.keys()]).toEqual(['content-type', 'if-none-match'])
    const presignInit = calls('/presign')[0][1] as RequestInit
    expect(presignInit.credentials).toBe('omit')
    expect(new Headers(presignInit.headers).get('Authorization')).toBe('Bearer session-token')
  })

  it('reporta progresso real do agendamento e aborta o XHR', async () => {
    const progress: Array<[number, number]> = []
    const uploaded = await uploadChatMedia(fileOf('application/pdf', 'contrato.pdf'), schedule((loaded, total) => {
      progress.push([loaded, total])
    }))
    expect(uploaded.ok).toBe(true)
    expect(progress).toEqual([[16, 32]])
    const xhr = FakeXhr.instances[0]
    expect(xhr.withCredentials).toBe(false)
    expect(xhr.headers.Authorization).toBeUndefined()
    expect(xhr.headers['Content-Length']).toBeUndefined()
    expect(xhr.headers['Content-Type']).toBe('application/pdf')
    expect(xhr.body).toBeInstanceOf(File)

    const controller = new AbortController()
    FakeXhr.instances = []
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(200, presignBody('application/pdf', 'contrato.pdf'))
      return json(500, { error: 'não confirmar' })
    })
    vi.mocked(fetch).mockClear()
    const originalSend = FakeXhr.prototype.send
    FakeXhr.prototype.send = function send(this: FakeXhr, body: unknown) {
      this.body = body
      FakeXhr.instances.push(this)
      controller.abort()
    }
    const cancelled = await uploadChatMedia(fileOf('application/pdf', 'contrato.pdf'), schedule(), controller.signal)
    FakeXhr.prototype.send = originalSend
    expect(cancelled).toMatchObject({ ok: false, cancelled: true })
    expect(FakeXhr.instances[0].aborted).toBe(true)
    expect(calls('/confirm')).toHaveLength(0)
  })

  it('aceita refresh do mesmo usuário e interrompe troca ou logout', async () => {
    getSession.mockResolvedValueOnce(session(USER, 'old-token')).mockResolvedValue(session(USER, 'old-token'))
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input)
      const authorization = new Headers(init?.headers).get('Authorization')
      if (href.includes('/presign') && authorization === 'Bearer old-token') return json(401, { error: 'Sessão inválida ou expirada' })
      if (href.includes('/presign')) return json(200, presignBody())
      if (href.includes('/confirm')) return json(200, confirmBody())
      return new Response(null, { status: 200 })
    })
    refreshSession.mockResolvedValueOnce(session(USER, 'renewed-token'))
    const renewed = await uploadChatMedia(fileOf('image/jpeg'), manual())
    expect(renewed.ok).toBe(true)
    expect(new Headers((calls('/presign')[1][1] as RequestInit).headers).get('Authorization')).toBe('Bearer renewed-token')

    getSession.mockReset()
    refreshSession.mockReset()
    getSession.mockResolvedValueOnce(session(USER)).mockResolvedValueOnce(session(OTHER))
    refreshSession.mockResolvedValue({ data: { session: null }, error: null })
    vi.mocked(fetch).mockClear()
    const changed = await uploadChatMedia(fileOf('image/jpeg'), manual())
    expect(changed).toMatchObject({ ok: false, error: 'A sessão mudou durante o envio.' })
    expect(changed.ok === true ? changed.media_url : '').toBe('')
    expect(calls('/confirm')).toHaveLength(0)

    getSession.mockReset()
    getSession
      .mockResolvedValueOnce(session(USER))
      .mockResolvedValueOnce(session(USER))
      .mockResolvedValueOnce({ data: { session: null }, error: null })
    refreshSession.mockResolvedValue({ data: { session: null }, error: null })
    const loggedOut = await uploadChatMedia(fileOf('image/jpeg'), manual())
    expect(loggedOut).toMatchObject({ ok: false, error: 'Sessão inválida ou expirada.' })
    expect(calls('/confirm').length).toBeGreaterThan(0)
    expect(JSON.stringify(loggedOut)).not.toContain('media_url')

    getSession.mockReset()
    vi.mocked(fetch).mockClear()
    getSession
      .mockResolvedValueOnce(session(USER))
      .mockResolvedValueOnce(session(USER))
      .mockResolvedValueOnce(session(OTHER))
    const switchedAfter = await uploadChatMedia(fileOf('image/jpeg'), manual())
    expect(switchedAfter).toMatchObject({ ok: false, error: 'A sessão mudou durante o envio.' })
    expect(JSON.stringify(switchedAfter)).not.toContain('media_url')
    expect(calls('/confirm')).toHaveLength(1)
  })

  it('rejeita presign e confirm inválidos e não repete o PUT', async () => {
    vi.mocked(fetch).mockResolvedValue(json(200, { ...presignBody(), role: 'admin' }))
    const extra = await uploadChatMedia(fileOf('image/jpeg'), manual())
    expect(extra).toMatchObject({ ok: false, error: 'Falha ao preparar upload.' })
    expect(calls('example-bucket')).toHaveLength(0)

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(200, presignBody())
      if (String(input).includes('/confirm')) return json(200, { media_url: 'https://evil.example/file', extra: true })
      return new Response(null, { status: 200 })
    })
    const badUrl = await uploadChatMedia(fileOf('image/jpeg'), manual())
    expect(badUrl).toMatchObject({ ok: false, error: 'Falha ao confirmar upload.' })
    expect(calls('example-bucket')).toHaveLength(1)
    expect(calls('/confirm')).toHaveLength(1)
  })

  it('recupera PUT ambíguo e limita a confirmação a duas tentativas', async () => {
    for (const status of [409, 412, 400, 403]) {
      vi.mocked(fetch).mockClear()
      vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
        const href = String(input)
        if (href.includes('/presign')) return json(200, presignBody())
        if (href.includes('/confirm')) return json(200, confirmBody())
        return new Response(null, { status })
      })
      const result = await uploadChatMedia(fileOf('image/jpeg'), manual())
      expect(calls('example-bucket')).toHaveLength(1)
      if (status === 400 || status === 403) {
        expect(result).toMatchObject({ ok: false, error: 'Falha ao enviar o arquivo.' })
        expect(calls('/confirm')).toHaveLength(0)
      } else {
        expect(result.ok).toBe(true)
        expect(calls('/confirm')).toHaveLength(1)
      }
    }

    vi.useFakeTimers()
    vi.mocked(fetch).mockClear()
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input)
      if (href.includes('/presign')) return Promise.resolve(json(200, presignBody()))
      if (href.includes('/confirm')) return Promise.resolve(json(200, confirmBody()))
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('timeout')
          error.name = 'AbortError'
          reject(error)
        })
      })
    })
    const pending = uploadChatMedia(fileOf('image/jpeg'), manual())
    await vi.advanceTimersByTimeAsync(CHAT_PUT_TIMEOUT_MS)
    await expect(pending).resolves.toMatchObject({ ok: true })
    expect(calls('example-bucket')).toHaveLength(1)
    expect(calls('/confirm')).toHaveLength(1)
    vi.useRealTimers()

    let confirms = 0
    vi.mocked(fetch).mockClear()
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(200, presignBody())
      if (String(input).includes('/confirm')) {
        confirms += 1
        return confirms === 1 ? json(503, { error: 'db secret' }) : json(200, confirmBody())
      }
      throw new TypeError('network down')
    })
    const recovered = await uploadChatMedia(fileOf('image/jpeg'), manual())
    expect(recovered.ok).toBe(true)
    expect(confirms).toBe(2)
    expect(JSON.stringify(recovered)).not.toContain('secret')
    expect(calls('example-bucket')).toHaveLength(1)

    confirms = 0
    vi.mocked(fetch).mockClear()
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(200, presignBody())
      if (String(input).includes('/confirm')) {
        confirms += 1
        return json(503, { error: 'ainda indisponível' })
      }
      return new Response(null, { status: 200 })
    })
    const exhausted = await uploadChatMedia(fileOf('image/jpeg'), manual())
    expect(exhausted.ok).toBe(false)
    expect(confirms).toBe(2)

    confirms = 0
    vi.mocked(fetch).mockClear()
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(200, presignBody())
      if (String(input).includes('/confirm')) {
        confirms += 1
        throw new TypeError('network down')
      }
      return new Response(null, { status: 200 })
    })
    const network = await uploadChatMedia(fileOf('image/jpeg'), manual())
    expect(network.ok).toBe(false)
    expect(confirms).toBe(2)
    expect(calls('example-bucket')).toHaveLength(1)

    confirms = 0
    vi.mocked(fetch).mockClear()
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/presign')) return json(200, presignBody())
      if (String(input).includes('/confirm')) {
        confirms += 1
        return json(410, { error: 'Token expirado' })
      }
      return new Response(null, { status: 200 })
    })
    const expired = await uploadChatMedia(fileOf('image/jpeg'), manual())
    expect(expired).toMatchObject({ ok: false, error: 'Token expirado. Selecione o arquivo novamente.' })
    expect(confirms).toBe(1)
    expect(calls('example-bucket')).toHaveLength(1)
  })

  it('cancela sem recuperação e não chama o uploader legado', async () => {
    const early = new AbortController()
    early.abort()
    const before = await uploadChatMedia(fileOf('image/jpeg'), manual(), early.signal)
    expect(before).toMatchObject({ cancelled: true })
    expect(fetch).not.toHaveBeenCalled()

    const overImage = fileOf('image/jpeg')
    Object.defineProperty(overImage, 'size', { value: CHAT_IMAGE_MAX_BYTES + 1 })
    const overAudio = fileOf('audio/ogg', 'audio.ogg')
    Object.defineProperty(overAudio, 'size', { value: CHAT_OTHER_MAX_BYTES + 1 })
    expect((await uploadChatMedia(overImage, manual())).ok).toBe(false)
    expect((await uploadChatMedia(fileOf('image/png'), automation())).ok).toBe(false)
    expect((await uploadChatMedia(overAudio, automation())).ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()

    const source = readFileSync(new URL('../chatMediaUpload.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('uploadMedia')
    expect(source).not.toContain('S3Storage')
    expect(source).not.toContain('ChatApi')
    expect(source).not.toContain('detectContentType')
    expect(source).not.toContain('console.')
  })
})
