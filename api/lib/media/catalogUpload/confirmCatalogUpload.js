import { validateCompanyCaller } from '../../auth/validateCompanyCaller.js'
import { catalogFolderPath, persistCatalogMetadata, sameCatalogFileSize } from './catalogMetadata.js'
import {
  CATALOG_UPLOAD_ROLES,
  CONFIRM_SECRET_ENV,
} from './constants.js'
import { resolveBackendAwsCredentials } from './credentials.js'
import { assertConfirmSecret, verifyConfirmToken } from './confirmToken.js'
import { CatalogUploadError } from './errors.js'
import { headCatalogObject } from './headCatalogObject.js'
import { derivePublicObjectUrl } from './objectKey.js'
import { resolveCatalogMime } from './validation.js'

function invalid(status, error) {
  throw new CatalogUploadError(status, error)
}

function parseConfirmToken(body) {
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
    invalid(503, 'Confirmação temporariamente indisponível')
  }
  const user = authResult?.data?.user
  if (authResult?.error || !user?.id) invalid(401, 'Sessão inválida ou expirada')
  return user.id
}

function assertHeadAgrees(head, claims) {
  if (!sameCatalogFileSize(head?.contentLength, claims.sizeBytes) || head?.contentType !== claims.mimeType) {
    invalid(409, 'Confirmação divergente')
  }
}

async function runConfirm({ req, body, svc, env, now, headObject }) {
  const confirmToken = parseConfirmToken(body)
  const sessionUserId = await readSession(req, svc)
  let secret
  try {
    secret = assertConfirmSecret(env?.[CONFIRM_SECRET_ENV])
  } catch {
    invalid(500, 'Falha ao confirmar upload')
  }

  const nowSeconds = Math.floor(now().getTime() / 1000)
  const verified = verifyConfirmToken(secret, confirmToken, nowSeconds)
  if (!verified.ok) {
    invalid(verified.reason === 'expired' ? 410 : 400, verified.reason === 'expired' ? 'Token expirado' : 'Token inválido')
  }

  const claims = verified.claims
  if (claims.userId !== sessionUserId) invalid(403, 'Acesso negado')

  const auth = await validateCompanyCaller(req, svc, claims.companyId, { roles: CATALOG_UPLOAD_ROLES })
  if (!auth.ok) return { status: auth.status, body: { error: auth.error } }
  if (!CATALOG_UPLOAD_ROLES.includes(auth.role) || auth.userId !== claims.userId || auth.companyId !== claims.companyId) {
    invalid(403, 'Acesso negado')
  }

  const mime = resolveCatalogMime(claims.mimeType)
  const folderPath = catalogFolderPath(claims.sourceType)
  if (!mime || !folderPath) invalid(500, 'Falha ao confirmar upload')

  const credentials = await resolveBackendAwsCredentials(svc, auth.companyId)
  if (credentials.bucket !== claims.bucket || credentials.region !== claims.region) {
    invalid(409, 'Confirmação divergente')
  }

  const head = await headObject({ credentials, key: claims.s3Key })
  assertHeadAgrees(head, claims)

  const asset = await persistCatalogMetadata(svc, {
    company_id: auth.companyId,
    s3_key: claims.s3Key,
    original_filename: claims.originalFileName,
    file_type: mime.kind,
    mime_type: claims.mimeType,
    file_size: claims.sizeBytes,
    folder_path: folderPath,
    preview_url: derivePublicObjectUrl(credentials.bucket, credentials.region, claims.s3Key),
    created_by: auth.userId,
    source_ref: null,
  })

  return { status: 200, body: asset }
}

export async function confirmCatalogUpload(deps) {
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
    if (error instanceof CatalogUploadError) {
      return { status: error.status, body: { error: error.publicError } }
    }
    throw error
  }
}
