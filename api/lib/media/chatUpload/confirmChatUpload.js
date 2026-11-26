import { sameCatalogFileSize } from '../catalogUpload/catalogMetadata.js'
import { resolveBackendAwsCredentials } from '../catalogUpload/credentials.js'
import { CatalogUploadError } from '../catalogUpload/errors.js'
import { headCatalogObject } from '../catalogUpload/headCatalogObject.js'
import { derivePublicObjectUrl } from '../catalogUpload/objectKey.js'
import { authorizeChatUpload } from './authorization.js'
import { readChatConfirmSecret, verifyChatConfirmToken } from './confirmToken.js'
import { ChatUploadError } from './errors.js'

function invalid(status, error) {
  throw new ChatUploadError(status, error)
}

function unavailable() {
  invalid(503, 'Confirmação temporariamente indisponível')
}

function parseConfirmBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid(400, 'Pedido inválido')
  const keys = Object.keys(body)
  if (
    keys.length !== 1
    || !Object.hasOwn(body, 'confirmToken')
    || typeof body.confirmToken !== 'string'
    || body.confirmToken.length === 0
  ) {
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

function requestFromClaims(claims) {
  return {
    companyId: claims.companyId,
    purpose: claims.purpose,
    conversationId: claims.conversationId,
    instanceId: claims.instanceId,
    flowId: claims.flowId,
    messageType: claims.messageType,
  }
}

async function authorizeClaims(req, svc, claims) {
  const auth = await authorizeChatUpload(req, svc, requestFromClaims(claims))
  if (!auth.ok) return auth
  if (auth.userId !== claims.userId || auth.companyId !== claims.companyId) {
    invalid(403, 'Acesso negado')
  }
  return auth
}

function assertHeadAgrees(head, claims) {
  if (
    !sameCatalogFileSize(head?.contentLength, claims.sizeBytes)
    || head?.contentType !== claims.contentType
  ) {
    invalid(409, 'Confirmação divergente')
  }
}

async function runConfirm({ req, body, svc, env, now, headObject }) {
  const confirmToken = parseConfirmBody(body)
  const sessionUserId = await readSession(req, svc)
  let secret
  try {
    secret = readChatConfirmSecret(env)
  } catch {
    unavailable()
  }

  const verified = verifyChatConfirmToken(secret, confirmToken, Math.floor(now().getTime() / 1000))
  if (!verified.ok) {
    invalid(
      verified.reason === 'expired' ? 410 : 400,
      verified.reason === 'expired' ? 'Token expirado' : 'Token inválido',
    )
  }

  const claims = verified.claims
  if (claims.userId !== sessionUserId) invalid(403, 'Acesso negado')
  const auth = await authorizeClaims(req, svc, claims)
  if (!auth.ok) return { status: auth.status, body: { error: auth.error } }

  let credentials
  try {
    credentials = await resolveBackendAwsCredentials(svc, auth.companyId)
  } catch (error) {
    if (error instanceof CatalogUploadError) unavailable()
    throw error
  }
  if (credentials.bucket !== claims.bucket || credentials.region !== claims.region) {
    invalid(409, 'Confirmação divergente')
  }

  let head
  try {
    head = await headObject({ credentials, key: claims.s3Key })
  } catch (error) {
    if (error instanceof CatalogUploadError || error instanceof ChatUploadError) throw error
    unavailable()
  }
  assertHeadAgrees(head, claims)

  const replay = await authorizeClaims(req, svc, claims)
  if (!replay.ok) return { status: replay.status, body: { error: replay.error } }

  return {
    status: 200,
    body: {
      media_url: derivePublicObjectUrl(credentials.bucket, credentials.region, claims.s3Key),
    },
  }
}

export async function confirmChatUpload(deps) {
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
    if (error instanceof ChatUploadError) {
      return { status: error.status, body: { error: error.publicError } }
    }
    if (error instanceof CatalogUploadError) {
      if (error.status === 404 || error.status === 409 || error.status === 410) {
        return { status: error.status, body: { error: error.publicError } }
      }
      return { status: 503, body: { error: 'Confirmação temporariamente indisponível' } }
    }
    throw error
  }
}
