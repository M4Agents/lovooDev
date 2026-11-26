/**
 * Upload do chat Uazapi sem credencial AWS no navegador.
 * Presign e confirm usam a sessão do CRM. O PUT usa só os headers assinados.
 * Os bytes do arquivo seguem intactos. O sucesso é a media_url pública estável.
 */

import { supabase } from '../lib/supabase'

export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const CHAT_OTHER_MAX_BYTES = 25 * 1024 * 1024
export const CHAT_PRESIGN_TIMEOUT_MS = 20_000
export const CHAT_PUT_TIMEOUT_MS = 240_000
export const CHAT_CONFIRM_TIMEOUT_MS = 30_000

const PUT_EXPIRES_SECONDS = 300
const CONFIRM_EXPIRES_SECONDS = 900
const MAX_TOKEN_LENGTH = 4096
const SIGNED_HEADERS = 'content-length;content-type;host;if-none-match'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEY_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const BUCKET_RE = /^(?=.{3,63}$)(?!.*\.\.)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])$/
const REGION_RE = /^[a-z]{2}(?:-[a-z0-9]+)+$/

export type ChatUploadProgress = (loaded: number, total: number) => void

export type ChatMediaUploadRequest =
  | { purpose: 'chat_manual'; companyId: string; conversationId: string }
  | {
      purpose: 'chat_schedule'
      companyId: string
      conversationId: string
      instanceId: string
      onProgress?: ChatUploadProgress
    }
  | { purpose: 'automation_audio'; companyId: string; flowId: string }

export type ChatMediaUploadResult =
  | { ok: true; media_url: string }
  | { ok: false; error: string; cancelled?: boolean }

type MessageType = 'image' | 'video' | 'audio' | 'document'
type Identity = { token: string; userId: string }
type Deadline = { signal: AbortSignal; timedOut: () => boolean; cancelled: () => boolean; clear: () => void }
type PreparedPut = { operationId: string; putUrl: string; contentType: string; s3Key: string; confirmToken: string }
type PutOutcome = { status: number | null; failed: boolean }

function fail(error: string, cancelled = false): ChatMediaUploadResult {
  return cancelled ? { ok: false, error, cancelled: true } : { ok: false, error }
}

function cancelledResult(): ChatMediaUploadResult {
  return fail('Upload cancelado.', true)
}

function messageTypeOf(mimeType: string): MessageType {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (base.startsWith('image/')) return 'image'
  if (base.startsWith('video/')) return 'video'
  if (base.startsWith('audio/')) return 'audio'
  return 'document'
}

function validateFile(file: File, purpose: ChatMediaUploadRequest['purpose']): { ok: true; messageType: MessageType } | { ok: false; error: string } {
  if (!file || file.size <= 0) return { ok: false, error: 'O arquivo está vazio.' }
  if (!file.name || file.name.length > 200 || file.name.includes('/') || file.name.includes('\\') || file.name.includes('..')) {
    return { ok: false, error: 'Nome de arquivo inválido.' }
  }
  const messageType = messageTypeOf(file.type)
  if (purpose === 'automation_audio' && messageType !== 'audio') {
    return { ok: false, error: 'Tipo de arquivo não permitido.' }
  }
  const limit = messageType === 'image' ? CHAT_IMAGE_MAX_BYTES : CHAT_OTHER_MAX_BYTES
  if (file.size > limit) return { ok: false, error: `Arquivo acima de ${limit / (1024 * 1024)} MB.` }
  return { ok: true, messageType }
}

function targetIds(request: ChatMediaUploadRequest): boolean {
  if (!UUID_RE.test(request.companyId)) return false
  if (request.purpose === 'automation_audio') return UUID_RE.test(request.flowId)
  if (!UUID_RE.test(request.conversationId)) return false
  return request.purpose === 'chat_manual' || UUID_RE.test(request.instanceId)
}

function presignPayload(file: File, request: ChatMediaUploadRequest, messageType: MessageType) {
  const common = {
    companyId: request.companyId,
    purpose: request.purpose,
    messageType,
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  }
  if (request.purpose === 'chat_manual') return { ...common, conversationId: request.conversationId }
  if (request.purpose === 'chat_schedule') {
    return { ...common, conversationId: request.conversationId, instanceId: request.instanceId }
  }
  return { ...common, flowId: request.flowId }
}

function readIdentity(session: { access_token?: string; user?: { id?: string } } | null): Identity | null {
  const token = session?.access_token
  const userId = session?.user?.id
  if (!token || !userId) return null
  return { token, userId }
}

async function loadIdentity(): Promise<Identity | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) return null
  return readIdentity(data.session)
}

async function refreshIdentity(): Promise<Identity | null> {
  const { data, error } = await supabase.auth.refreshSession()
  if (error) return null
  return readIdentity(data.session)
}

async function establishIdentity(): Promise<{ ok: true; identity: Identity } | { ok: false; error: string }> {
  const current = await loadIdentity()
  if (current) return { ok: true, identity: current }
  const refreshed = await refreshIdentity()
  if (!refreshed) return { ok: false, error: 'Sessão inválida ou expirada.' }
  return { ok: true, identity: refreshed }
}

async function sameIdentity(expectedUserId: string) {
  const current = await loadIdentity()
  if (current?.userId === expectedUserId) return { ok: true as const, identity: current }
  if (current && current.userId !== expectedUserId) return { ok: false as const, error: 'A sessão mudou durante o envio.' }
  const refreshed = await refreshIdentity()
  if (!refreshed) return { ok: false as const, error: 'Sessão inválida ou expirada.' }
  if (refreshed.userId !== expectedUserId) return { ok: false as const, error: 'A sessão mudou durante o envio.' }
  return { ok: true as const, identity: refreshed }
}

function watch(signal: AbortSignal | undefined, timeoutMs: number): Deadline {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    timedOut: () => timedOut && !signal?.aborted,
    cancelled: () => Boolean(signal?.aborted),
    clear: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

function publicError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const error = (payload as { error?: unknown }).error
  if (typeof error !== 'string' || error.length === 0 || error.length > 180) return fallback
  if (/eyJ|AKIA|https?:|secret|token|stack/i.test(error)) return fallback
  return error
}

async function readBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

async function crmFetch(path: string, token: string, body: unknown, timeoutMs: number, signal?: AbortSignal) {
  const deadline = watch(signal, timeoutMs)
  try {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: deadline.signal,
    })
    return { response, deadline }
  } catch (error) {
    return { error, deadline }
  }
}

function keyMatches(companyId: string, operationId: string, s3Key: unknown): s3Key is string {
  if (typeof s3Key !== 'string' || /[\\%?#\s]/.test(s3Key) || s3Key.includes('..')) return false
  const parts = s3Key.split('/')
  if (parts.length !== 8) return false
  const [root, keyCompany, channel, year, month, day, keyOperation, fileName] = parts
  return root === 'clientes'
    && keyCompany === companyId
    && channel === 'whatsapp'
    && /^\d{4}$/.test(year)
    && /^(0[1-9]|1[0-2])$/.test(month)
    && /^(0[1-9]|[12]\d|3[01])$/.test(day)
    && keyOperation === operationId
    && KEY_FILE_RE.test(fileName)
}

function virtualHost(hostname: string): boolean {
  const regional = hostname.match(/^(.+)\.s3\.([a-z0-9-]+)\.amazonaws\.com$/)
  if (regional) return BUCKET_RE.test(regional[1]) && REGION_RE.test(regional[2])
  const legacy = hostname.match(/^(.+)\.s3\.amazonaws\.com$/)
  return Boolean(legacy && BUCKET_RE.test(legacy[1]))
}

function destinationMatches(putUrl: string, s3Key: string): boolean {
  let url: URL
  try {
    url = new URL(putUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false
  if (!virtualHost(url.hostname)) return false
  let path = url.pathname
  try {
    path = decodeURIComponent(path)
  } catch {
    return false
  }
  return path === `/${s3Key}`
    && url.searchParams.get('X-Amz-SignedHeaders') === SIGNED_HEADERS
    && url.searchParams.get('X-Amz-Expires') === String(PUT_EXPIRES_SECONDS)
}

function mediaUrlMatches(mediaUrl: unknown, putUrl: string, s3Key: string): mediaUrl is string {
  if (typeof mediaUrl !== 'string') return false
  let stable: URL
  let put: URL
  try {
    stable = new URL(mediaUrl)
    put = new URL(putUrl)
  } catch {
    return false
  }
  if (stable.protocol !== 'https:' || stable.username || stable.password || stable.port || stable.hash || stable.search) {
    return false
  }
  let path = stable.pathname
  try {
    path = decodeURIComponent(path)
  } catch {
    return false
  }
  return stable.hostname === put.hostname && path === `/${s3Key}`
}

function parsePresign(payload: unknown, companyId: string): PreparedPut | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const body = payload as Record<string, unknown>
  const expected = ['operationId', 'putUrl', 'putHeaders', 'expiresIn', 's3_key', 'confirmToken', 'confirmExpiresIn']
  if (Object.keys(body).length !== expected.length || expected.some((key) => !Object.prototype.hasOwnProperty.call(body, key))) return null
  if (typeof body.operationId !== 'string' || !UUID_RE.test(body.operationId)) return null
  if (typeof body.putUrl !== 'string' || !keyMatches(companyId, body.operationId, body.s3_key)) return null
  if (body.expiresIn !== PUT_EXPIRES_SECONDS || body.confirmExpiresIn !== CONFIRM_EXPIRES_SECONDS) return null
  if (typeof body.confirmToken !== 'string' || body.confirmToken.length === 0 || body.confirmToken.length > MAX_TOKEN_LENGTH) return null
  const headers = body.putHeaders
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return null
  const typed = headers as Record<string, unknown>
  const names = Object.keys(typed)
  if (names.length !== 2 || names.some((name) => /authorization|cookie|content-length/i.test(name))) return null
  if (typeof typed['Content-Type'] !== 'string' || typed['Content-Type'].length === 0 || /[\r\n]/.test(typed['Content-Type'])) return null
  if (typed['If-None-Match'] !== '*') return null
  if (!destinationMatches(body.putUrl, body.s3_key as string)) return null
  return {
    operationId: body.operationId,
    putUrl: body.putUrl,
    contentType: typed['Content-Type'],
    s3Key: body.s3_key as string,
    confirmToken: body.confirmToken,
  }
}

function parseConfirm(payload: unknown, putUrl: string, s3Key: string): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const body = payload as Record<string, unknown>
  if (Object.keys(body).length !== 1 || !Object.prototype.hasOwnProperty.call(body, 'media_url')) return null
  return mediaUrlMatches(body.media_url, putUrl, s3Key) ? body.media_url : null
}

function putWithFetch(prepared: PreparedPut, file: File, signal: AbortSignal): Promise<PutOutcome> {
  return fetch(prepared.putUrl, {
    method: 'PUT',
    credentials: 'omit',
    cache: 'no-store',
    headers: { 'Content-Type': prepared.contentType, 'If-None-Match': '*' },
    body: file,
    signal,
  }).then(
    (response) => ({ status: response.status, failed: false }),
    () => ({ status: null, failed: true }),
  )
}

function putWithXhr(prepared: PreparedPut, file: File, signal: AbortSignal, onProgress?: ChatUploadProgress): Promise<PutOutcome> {
  return new Promise((resolve) => {
    if (typeof XMLHttpRequest === 'undefined') {
      resolve({ status: null, failed: true })
      return
    }
    const xhr = new XMLHttpRequest()
    let settled = false
    const finish = (status: number | null, failed: boolean) => {
      if (settled) return
      settled = true
      resolve({ status, failed })
    }
    xhr.open('PUT', prepared.putUrl)
    xhr.withCredentials = false
    xhr.setRequestHeader('Content-Type', prepared.contentType)
    xhr.setRequestHeader('If-None-Match', '*')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    }
    xhr.onload = () => finish(xhr.status, false)
    xhr.onerror = () => finish(null, true)
    xhr.ontimeout = () => finish(null, true)
    xhr.onabort = () => finish(null, true)
    if (signal.aborted) {
      xhr.abort()
      finish(null, true)
      return
    }
    signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(file)
  })
}

async function confirmUpload(
  prepared: PreparedPut,
  identity: Identity,
  signal: AbortSignal | undefined,
): Promise<ChatMediaUploadResult> {
  let current = identity
  let confirms = 0
  while (confirms < 2) {
    if (signal?.aborted) return cancelledResult()
    const session = await sameIdentity(current.userId)
    if (!session.ok) return fail(session.error)
    current = session.identity
    confirms += 1
    const confirmed = await crmFetch(
      '/api/media/uploads/chat/confirm',
      current.token,
      { confirmToken: prepared.confirmToken },
      CHAT_CONFIRM_TIMEOUT_MS,
      signal,
    )
    if (!('response' in confirmed) || !confirmed.response) {
      confirmed.deadline?.clear()
      if (confirmed.deadline?.cancelled()) return cancelledResult()
      if (confirms < 2) continue
      return fail('Falha ao confirmar upload.')
    }
    const response = confirmed.response
    confirmed.deadline.clear()
    if (response.status === 410) return fail('Token expirado. Selecione o arquivo novamente.')
    if (response.status === 503) {
      if (confirms < 2) continue
      return fail(publicError(await readBody(response), 'Falha ao confirmar upload.'))
    }
    if (response.status === 401 && confirms < 2) {
      const refreshed = await refreshIdentity()
      if (!refreshed || refreshed.userId !== current.userId) {
        return fail(refreshed ? 'A sessão mudou durante o envio.' : 'Sessão inválida ou expirada.')
      }
      current = refreshed
      continue
    }
    if (response.status !== 200) return fail(publicError(await readBody(response), 'Falha ao confirmar upload.'))
    const mediaUrl = parseConfirm(await readBody(response), prepared.putUrl, prepared.s3Key)
    if (!mediaUrl) return fail('Falha ao confirmar upload.')
    if (signal?.aborted) return cancelledResult()
    const after = await sameIdentity(current.userId)
    if (!after.ok) return fail(after.error)
    if (signal?.aborted) return cancelledResult()
    return { ok: true, media_url: mediaUrl }
  }
  return fail('Falha ao confirmar upload.')
}

export async function uploadChatMedia(
  file: File,
  request: ChatMediaUploadRequest,
  signal?: AbortSignal,
): Promise<ChatMediaUploadResult> {
  if (signal?.aborted) return cancelledResult()
  const media = validateFile(file, request.purpose)
  if (!media.ok) return fail(media.error)
  if (!targetIds(request)) return fail('Identificador inválido.')

  const established = await establishIdentity()
  if (!established.ok) return fail(established.error)
  let identity = established.identity
  if (signal?.aborted) return cancelledResult()

  const body = presignPayload(file, request, media.messageType)
  let presign = await crmFetch('/api/media/uploads/chat/presign', identity.token, body, CHAT_PRESIGN_TIMEOUT_MS, signal)
  if (!('response' in presign) || !presign.response) {
    presign.deadline?.clear()
    if (presign.deadline?.cancelled()) return cancelledResult()
    return fail(presign.deadline?.timedOut() ? 'O envio excedeu o tempo limite.' : 'Falha ao preparar upload.')
  }
  if (presign.response.status === 401) {
    presign.deadline.clear()
    const refreshed = await refreshIdentity()
    if (signal?.aborted) return cancelledResult()
    if (!refreshed || refreshed.userId !== identity.userId) {
      return fail(refreshed ? 'A sessão mudou durante o envio.' : 'Sessão inválida ou expirada.')
    }
    identity = refreshed
    presign = await crmFetch('/api/media/uploads/chat/presign', identity.token, body, CHAT_PRESIGN_TIMEOUT_MS, signal)
  }
  if (!('response' in presign) || !presign.response) {
    presign.deadline?.clear()
    if (presign.deadline?.cancelled()) return cancelledResult()
    return fail(presign.deadline?.timedOut() ? 'O envio excedeu o tempo limite.' : 'Falha ao preparar upload.')
  }
  const presignResponse = presign.response
  presign.deadline.clear()
  if (presignResponse.status !== 200) return fail(publicError(await readBody(presignResponse), 'Falha ao preparar upload.'))
  const prepared = parsePresign(await readBody(presignResponse), request.companyId)
  if (!prepared) return fail('Falha ao preparar upload.')
  if (signal?.aborted) return cancelledResult()

  const putWatch = watch(signal, CHAT_PUT_TIMEOUT_MS)
  const put = request.purpose === 'chat_schedule'
    ? await putWithXhr(prepared, file, putWatch.signal, request.onProgress)
    : await putWithFetch(prepared, file, putWatch.signal)
  putWatch.clear()
  if (putWatch.cancelled()) return cancelledResult()
  const ambiguous = put.failed || putWatch.timedOut() || put.status === 409 || put.status === 412
  const accepted = put.status !== null && put.status >= 200 && put.status < 300
  if (!accepted && !ambiguous) return fail('Falha ao enviar o arquivo.')
  if (signal?.aborted) return cancelledResult()
  return confirmUpload(prepared, identity, signal)
}
