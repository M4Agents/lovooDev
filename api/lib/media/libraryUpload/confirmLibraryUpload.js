import { validateCompanyCaller } from '../../auth/validateCompanyCaller.js'
import { assertStorageLimitStrict } from '../../plans/limitChecker.js'
import { sameCatalogFileSize } from '../catalogUpload/catalogMetadata.js'
import { resolveBackendAwsCredentials } from '../catalogUpload/credentials.js'
import { CatalogUploadError } from '../catalogUpload/errors.js'
import { headCatalogObject } from '../catalogUpload/headCatalogObject.js'
import { derivePublicObjectUrl, utcKeyDate } from '../catalogUpload/objectKey.js'
import { assertLibraryConfirmSecret, verifyLibraryConfirmToken } from './confirmToken.js'
import { CONFIRM_SECRET_ENV, LIBRARY_UPLOAD_ROLES } from './constants.js'
import { LibraryUploadError } from './errors.js'
import {
  libraryProtectedMatch,
  persistLibraryMetadata,
  publicLibraryAsset,
  readLibraryOperation,
} from './libraryMetadata.js'
import { parseLibraryObjectKey } from './objectKey.js'
import {
  assertUuid,
  librarySizeWithinLimit,
  resolveLibraryMime,
  sanitizeLibraryFileName,
} from './validation.js'

function invalid(status, error) {
  throw new LibraryUploadError(status, error)
}

function unavailable() {
  invalid(503, 'Confirmação temporariamente indisponível')
}

function parseConfirmBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid(400, 'Pedido inválido')
  const keys = Object.keys(body)
  if (keys.length !== 1 || !Object.hasOwn(body, 'confirmToken') || typeof body.confirmToken !== 'string' || body.confirmToken.length === 0) {
    invalid(400, 'Pedido inválido')
  }
  return body.confirmToken
}

async function readSession(req, svc) {
  const authHeader = req.headers?.authorization ?? ''
  if (!authHeader.startsWith('Bearer ')) invalid(401, 'Autenticação necessária')
  let authResult
  try {
    authResult = await svc.auth.getUser(authHeader.slice(7))
  } catch {
    unavailable()
  }
  const user = authResult?.data?.user
  if (authResult?.error || !user?.id) invalid(401, 'Sessão inválida ou expirada')
  return user.id
}

async function assertFolderInCompany(svc, companyId, folderId) {
  assertUuid(folderId)
  let result
  try {
    result = await svc
      .from('company_folders')
      .select('id')
      .eq('id', folderId)
      .eq('company_id', companyId)
      .maybeSingle()
  } catch {
    unavailable()
  }
  if (!result || typeof result !== 'object' || result.error) unavailable()
  if (!result.data?.id) invalid(404, 'Pasta não encontrada')
}

function assertClaimIdentity(claims) {
  const mime = resolveLibraryMime(claims.mimeType)
  const key = parseLibraryObjectKey(claims.s3Key)
  const issued = utcKeyDate(claims.issuedAt)
  let safeFileName = null
  try {
    safeFileName = sanitizeLibraryFileName(claims.originalFileName)
  } catch {
    safeFileName = null
  }
  if (
    !mime
    || mime.fileType !== claims.fileType
    || !librarySizeWithinLimit(claims.sizeBytes, claims.fileType)
    || !key
    || !issued
    || key.companyId !== claims.companyId
    || key.operationId !== claims.operationId
    || key.fileName !== safeFileName
    || key.year !== issued.year
    || key.month !== issued.month
    || key.day !== issued.day
  ) {
    invalid(500, 'Falha ao confirmar upload')
  }
}

async function authorize(req, svc, claims) {
  const sessionUserId = await readSession(req, svc)
  if (sessionUserId !== claims.userId) invalid(403, 'Acesso negado')
  const auth = await validateCompanyCaller(req, svc, claims.companyId, {
    roles: LIBRARY_UPLOAD_ROLES,
  })
  if (!auth.ok) return auth
  if (!LIBRARY_UPLOAD_ROLES.includes(auth.role) || auth.userId !== claims.userId || auth.companyId !== claims.companyId) {
    invalid(403, 'Acesso negado')
  }
  await assertFolderInCompany(svc, auth.companyId, claims.folderId)
  return auth
}

function assertHeadAgrees(head, claims) {
  if (!sameCatalogFileSize(head?.contentLength, claims.sizeBytes) || head?.contentType !== claims.mimeType) {
    invalid(409, 'Confirmação divergente')
  }
}

async function runConfirm({ req, body, svc, env, now, headObject }) {
  const confirmToken = parseConfirmBody(body)
  const sessionUserId = await readSession(req, svc)
  let secret
  try {
    secret = assertLibraryConfirmSecret(env?.[CONFIRM_SECRET_ENV])
  } catch {
    invalid(500, 'Falha ao confirmar upload')
  }
  const verified = verifyLibraryConfirmToken(secret, confirmToken, Math.floor(now().getTime() / 1000))
  if (!verified.ok) {
    invalid(verified.reason === 'expired' ? 410 : 400, verified.reason === 'expired' ? 'Token expirado' : 'Token inválido')
  }
  const claims = verified.claims
  if (claims.userId !== sessionUserId) invalid(403, 'Acesso negado')

  const auth = await validateCompanyCaller(req, svc, claims.companyId, { roles: LIBRARY_UPLOAD_ROLES })
  if (!auth.ok) return { status: auth.status, body: { error: auth.error } }
  if (!LIBRARY_UPLOAD_ROLES.includes(auth.role) || auth.userId !== claims.userId || auth.companyId !== claims.companyId) {
    invalid(403, 'Acesso negado')
  }
  await assertFolderInCompany(svc, auth.companyId, claims.folderId)
  assertClaimIdentity(claims)

  const credentials = await resolveBackendAwsCredentials(svc, auth.companyId)
  if (credentials.bucket !== claims.bucket || credentials.region !== claims.region) {
    invalid(409, 'Confirmação divergente')
  }

  let head
  try {
    head = await headObject({ credentials, key: claims.s3Key })
  } catch (error) {
    if (error instanceof CatalogUploadError || error instanceof LibraryUploadError) throw error
    unavailable()
  }
  assertHeadAgrees(head, claims)

  const existing = await readLibraryOperation(svc, auth.companyId, claims.operationId)
  const expected = {
    company_id: auth.companyId,
    operation_id: claims.operationId,
    s3_key: claims.s3Key,
    mime_type: claims.mimeType,
    file_type: claims.fileType,
    file_size: claims.sizeBytes,
  }
  if (existing) {
    if (!libraryProtectedMatch(existing, expected)) invalid(409, 'Confirmação divergente')
    const replay = await authorize(req, svc, claims)
    if (!replay.ok) return { status: replay.status, body: { error: replay.error } }
    return { status: 200, body: publicLibraryAsset(existing) }
  }

  await assertStorageLimitStrict(svc, auth.companyId, claims.sizeBytes)
  const current = await authorize(req, svc, claims)
  if (!current.ok) return { status: current.status, body: { error: current.error } }

  const asset = await persistLibraryMetadata(svc, {
    ...expected,
    folder_id: claims.folderId,
    original_filename: claims.originalFileName,
    preview_url: derivePublicObjectUrl(credentials.bucket, credentials.region, claims.s3Key),
  })
  return { status: 200, body: asset }
}

export async function confirmLibraryUpload(deps) {
  const resolved = {
    now: () => new Date(),
    headObject: headCatalogObject,
  }
  for (const [key, value] of Object.entries(deps)) {
    if (value !== undefined) resolved[key] = value
  }

  try {
    return await runConfirm(resolved)
  } catch (error) {
    if (error?.isPlanError) return { status: error.httpStatus, body: error.data }
    if (error instanceof LibraryUploadError || error instanceof CatalogUploadError) {
      return { status: error.status, body: { error: error.publicError } }
    }
    throw error
  }
}
