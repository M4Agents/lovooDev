/**
 * Upload do catálogo para a biblioteca, sem credencial AWS no navegador.
 * O navegador só recebe uma URL já assinada e confirma o objeto com a sessão do CRM.
 */

import { supabase } from '../lib/supabase'

export const CATALOG_MEDIA_MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const CATALOG_MEDIA_MAX_VIDEO_BYTES = 30 * 1024 * 1024
export const CATALOG_MEDIA_MAX_FILES_PER_BATCH = 10

/** JSON pequeno: autenticação, RPC e emissão do token. 20s cobre cold start sem consumir a janela do PUT. */
export const CATALOG_PRESIGN_TIMEOUT_MS = 20_000
/** 30 MiB a cerca de 1 Mbit/s leva 240s. A assinatura do PUT expira em 300s, então sobra margem para confirmar. */
export const CATALOG_PUT_TIMEOUT_MS = 240_000
/** HeadObject e a gravação. 30s é folga para indisponibilidade curta e continua dentro dos 900s do token. */
export const CATALOG_CONFIRM_TIMEOUT_MS = 30_000

const PUT_EXPIRES_SECONDS = 300
const CONFIRM_EXPIRES_SECONDS = 900
const MAX_TOKEN_LENGTH = 4096
const SIGNED_HEADERS = 'content-length;content-type;host;if-none-match'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEY_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const BUCKET_RE = /^(?=.{3,63}$)(?!.*\.\.)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])$/
const REGION_RE = /^[a-z]{2}(?:-[a-z0-9]+)+$/

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
const VIDEO_MIME = ['video/mp4', 'video/webm', 'video/quicktime'] as const
const FORMAT_HINT = 'Use JPEG, PNG, GIF, WebP, MP4, WebM ou MOV.'

export const CATALOG_IMAGE_ACCEPT = IMAGE_MIME.join(',')
export const CATALOG_MEDIA_ACCEPT = [...IMAGE_MIME, ...VIDEO_MIME].join(',')

export type CatalogLibrarySavedAsset = {
  id: string
  s3_key?: string
  file_type?: string
  original_filename?: string
  [key: string]: unknown
}

type SourceType = 'product' | 'service'
type UploadResult =
  | { ok: true; data: CatalogLibrarySavedAsset }
  | { ok: false; error: string; cancelled?: boolean }

type Identity = { token: string; userId: string }
type Deadline = {
  signal: AbortSignal
  timedOut: () => boolean
  cancelled: () => boolean
  clear: () => void
}

const MIME_KIND = new Map<string, 'image' | 'video'>([
  ...IMAGE_MIME.map((mime) => [mime, 'image'] as const),
  ...VIDEO_MIME.map((mime) => [mime, 'video'] as const),
])

function fail(error: string, cancelled = false): UploadResult {
  return cancelled ? { ok: false, error, cancelled: true } : { ok: false, error }
}

export function catalogFolderPath(sourceType: SourceType): '/produtos' | '/servicos' {
  return sourceType === 'product' ? '/produtos' : '/servicos'
}

export function validateCatalogMediaFile(
  file: File,
  options?: { imagesOnly?: boolean }
): { ok: true; mimeType: string; kind: 'image' | 'video' } | { ok: false; message: string } {
  if (!file || file.size === 0) return { ok: false, message: 'O arquivo está vazio.' }
  const mimeType = file.type
  if (!mimeType) return { ok: false, message: `Formato não informado. ${FORMAT_HINT}` }
  const kind = MIME_KIND.get(mimeType)
  if (!kind) return { ok: false, message: `Formato não permitido. ${FORMAT_HINT}` }
  if (options?.imagesOnly && kind !== 'image') {
    return { ok: false, message: 'A imagem principal aceita JPEG, PNG, GIF ou WebP.' }
  }
  const limit = kind === 'image' ? CATALOG_MEDIA_MAX_IMAGE_BYTES : CATALOG_MEDIA_MAX_VIDEO_BYTES
  if (file.size > limit) {
    const megabytes = limit / (1024 * 1024)
    const label = kind === 'image' ? 'Imagem' : 'Vídeo'
    return { ok: false, message: `${label} acima de ${megabytes} MB.` }
  }
  if (!file.name || file.name.length > 200 || file.name.includes('/') || file.name.includes('\\') || file.name.includes('..')) {
    return { ok: false, message: 'Nome de arquivo inválido.' }
  }
  return { ok: true, mimeType, kind }
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

type IdentityResult = { ok: true; identity: Identity } | { ok: false; error: string }

async function establishIdentity(): Promise<IdentityResult> {
  const current = await loadIdentity()
  if (current) return { ok: true, identity: current }
  const refreshed = await refreshIdentity()
  if (!refreshed) return { ok: false, error: 'Sessão inválida ou expirada.' }
  return { ok: true, identity: refreshed }
}

async function sameIdentity(expectedUserId: string): Promise<IdentityResult> {
  const current = await loadIdentity()
  if (current?.userId === expectedUserId) return { ok: true, identity: current }
  if (current && current.userId !== expectedUserId) return { ok: false, error: 'A sessão mudou durante o envio.' }
  const refreshed = await refreshIdentity()
  if (!refreshed) return { ok: false, error: 'Sessão inválida ou expirada.' }
  if (refreshed.userId !== expectedUserId) return { ok: false, error: 'A sessão mudou durante o envio.' }
  return { ok: true, identity: refreshed }
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
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
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

function destinationMatches(putUrl: string, s3Key: string): URL | null {
  let url: URL
  try {
    url = new URL(putUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null
  if (!virtualHost(url.hostname)) return null
  let path = url.pathname
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }
  if (path !== `/${s3Key}`) return null
  if (url.searchParams.get('X-Amz-SignedHeaders') !== SIGNED_HEADERS) return null
  if (url.searchParams.get('X-Amz-Expires') !== String(PUT_EXPIRES_SECONDS)) return null
  return url
}

function previewMatches(preview: unknown, putUrl: string, s3Key: string): preview is string {
  if (typeof preview !== 'string') return false
  let previewUrl: URL
  let put: URL
  try {
    previewUrl = new URL(preview)
    put = new URL(putUrl)
  } catch {
    return false
  }
  if (previewUrl.protocol !== 'https:' || previewUrl.username || previewUrl.password || previewUrl.port || previewUrl.hash || previewUrl.search) {
    return false
  }
  let path = previewUrl.pathname
  try {
    path = decodeURIComponent(path)
  } catch {
    return false
  }
  return previewUrl.hostname === put.hostname && path === `/${s3Key}`
}

type PreparedPut = {
  operationId: string
  putUrl: string
  contentType: string
  s3Key: string
  confirmToken: string
}

function parsePresign(payload: unknown, companyId: string, mimeType: string): PreparedPut | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const body = payload as Record<string, unknown>
  const keys = Object.keys(body)
  const expected = ['operationId', 'putUrl', 'putHeaders', 'expiresIn', 's3_key', 'confirmToken', 'confirmExpiresIn']
  if (keys.length !== expected.length || expected.some((key) => !Object.prototype.hasOwnProperty.call(body, key))) return null
  if (typeof body.operationId !== 'string' || !UUID_RE.test(body.operationId)) return null
  if (typeof body.putUrl !== 'string' || !keyMatches(companyId, body.operationId, body.s3_key)) return null
  if (body.expiresIn !== PUT_EXPIRES_SECONDS || body.confirmExpiresIn !== CONFIRM_EXPIRES_SECONDS) return null
  if (typeof body.confirmToken !== 'string' || body.confirmToken.length === 0 || body.confirmToken.length > MAX_TOKEN_LENGTH) return null
  const headers = body.putHeaders
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return null
  const typed = headers as Record<string, unknown>
  if (Object.keys(typed).length !== 2 || typed['Content-Type'] !== mimeType || typed['If-None-Match'] !== '*') return null
  if (!destinationMatches(body.putUrl, body.s3_key)) return null
  return {
    operationId: body.operationId,
    putUrl: body.putUrl,
    contentType: mimeType,
    s3Key: body.s3_key as string,
    confirmToken: body.confirmToken,
  }
}

function parseAsset(
  payload: unknown,
  expected: { companyId: string; s3Key: string; fileName: string; kind: 'image' | 'video'; folder: string; putUrl: string }
): CatalogLibrarySavedAsset | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const body = payload as Record<string, unknown>
  if (typeof body.id !== 'string' || !UUID_RE.test(body.id)) return null
  if (body.company_id !== expected.companyId || body.s3_key !== expected.s3Key) return null
  if (body.file_type !== expected.kind || body.original_filename !== expected.fileName) return null
  if (body.folder_path !== expected.folder || !previewMatches(body.preview_url, expected.putUrl, expected.s3Key)) return null
  return {
    id: body.id,
    s3_key: expected.s3Key,
    file_type: expected.kind,
    original_filename: expected.fileName,
    preview_url: body.preview_url,
    company_id: expected.companyId,
    folder_path: expected.folder,
  }
}

function cancelledResult(): UploadResult {
  return fail('Upload cancelado.', true)
}

export async function uploadCatalogMediaToLibrary(
  file: File,
  companyId: string,
  sourceType: SourceType = 'product',
  signal?: AbortSignal
): Promise<UploadResult> {
  if (signal?.aborted) return cancelledResult()
  const media = validateCatalogMediaFile(file)
  if (!media.ok) return fail(media.message)
  if (!UUID_RE.test(companyId)) return fail('Empresa inválida.')
  if (sourceType !== 'product' && sourceType !== 'service') return fail('Tipo de item inválido.')

  const established = await establishIdentity()
  if (!established.ok) return fail(established.error)
  let identity = established.identity
  if (signal?.aborted) return cancelledResult()

  const presignBody = {
    companyId,
    sourceType,
    fileName: file.name,
    mimeType: media.mimeType,
    sizeBytes: file.size,
  }
  let presign = await crmFetch('/api/media/uploads/catalog/presign', identity.token, presignBody, CATALOG_PRESIGN_TIMEOUT_MS, signal)
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
    presign = await crmFetch('/api/media/uploads/catalog/presign', identity.token, presignBody, CATALOG_PRESIGN_TIMEOUT_MS, signal)
  }
  if (!('response' in presign) || !presign.response) {
    presign.deadline?.clear()
    if (presign.deadline?.cancelled()) return cancelledResult()
    return fail(presign.deadline?.timedOut() ? 'O envio excedeu o tempo limite.' : 'Falha ao preparar upload.')
  }
  const presignResponse = presign.response
  presign.deadline.clear()
  if (presignResponse.status !== 200) {
    return fail(publicError(await readBody(presignResponse), 'Falha ao preparar upload.'))
  }
  const prepared = parsePresign(await readBody(presignResponse), companyId, media.mimeType)
  if (!prepared) return fail('Falha ao preparar upload.')
  if (signal?.aborted) return cancelledResult()

  const putWatch = watch(signal, CATALOG_PUT_TIMEOUT_MS)
  let putStatus: number | null = null
  let putFailed = false
  try {
    const putResponse = await fetch(prepared.putUrl, {
      method: 'PUT',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        'Content-Type': prepared.contentType,
        'If-None-Match': '*',
      },
      body: file,
      signal: putWatch.signal,
    })
    putStatus = putResponse.status
  } catch {
    putFailed = true
  } finally {
    putWatch.clear()
  }

  if (putWatch.cancelled()) return cancelledResult()
  const ambiguous = putFailed || putWatch.timedOut() || putStatus === 409 || putStatus === 412
  const accepted = putStatus !== null && putStatus >= 200 && putStatus < 300
  if (!accepted && !ambiguous) return fail('Falha ao enviar o arquivo.')
  if (signal?.aborted) return cancelledResult()

  const folder = catalogFolderPath(sourceType)
  let confirms = 0
  while (confirms < 2) {
    if (signal?.aborted) return cancelledResult()
    const current = await sameIdentity(identity.userId)
    if (!current.ok) return fail(current.error)
    identity = current.identity
    confirms += 1
    const confirmed = await crmFetch(
      '/api/media/uploads/catalog/confirm',
      identity.token,
      { confirmToken: prepared.confirmToken },
      CATALOG_CONFIRM_TIMEOUT_MS,
      signal
    )
    if (!('response' in confirmed) || !confirmed.response) {
      confirmed.deadline?.clear()
      if (confirmed.deadline?.cancelled()) return cancelledResult()
      if (confirms < 2) continue
      return fail('Falha ao confirmar upload.')
    }
    const confirmResponse = confirmed.response
    confirmed.deadline.clear()
    if (confirmResponse.status === 410) return fail('Token expirado. Selecione o arquivo novamente.')
    if (confirmResponse.status === 503) {
      if (confirms < 2) continue
      return fail(publicError(await readBody(confirmResponse), 'Falha ao confirmar upload.'))
    }
    if (confirmResponse.status === 401 && confirms < 2) {
      const refreshed = await refreshIdentity()
      if (!refreshed || refreshed.userId !== identity.userId) {
        return fail(refreshed ? 'A sessão mudou durante o envio.' : 'Sessão inválida ou expirada.')
      }
      identity = refreshed
      continue
    }
    if (confirmResponse.status !== 200) {
      return fail(publicError(await readBody(confirmResponse), 'Falha ao confirmar upload.'))
    }
    const asset = parseAsset(await readBody(confirmResponse), {
      companyId,
      s3Key: prepared.s3Key,
      fileName: file.name,
      kind: media.kind,
      folder,
      putUrl: prepared.putUrl,
    })
    if (!asset) return fail('Falha ao confirmar upload.')
    return { ok: true, data: asset }
  }
  return fail('Falha ao confirmar upload.')
}
