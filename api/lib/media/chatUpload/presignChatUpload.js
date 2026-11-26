import { authorizeChatUpload } from './authorization.js'
import {
  CONFIRM_TTL_SECONDS,
  PUT_TTL_SECONDS,
} from './constants.js'
import { issueChatConfirmToken, readChatConfirmSecret } from './confirmToken.js'
import { ChatUploadError } from './errors.js'
import { buildChatObjectKey, createChatOperationId } from './objectKey.js'
import { parseChatUploadRequest, validateChatUploadRequest } from './validation.js'
import { CatalogUploadError } from '../catalogUpload/errors.js'
import { resolveBackendAwsCredentials } from '../catalogUpload/credentials.js'
import { assertPresignedPut, signCatalogPut } from '../catalogUpload/presignPut.js'

function failed() {
  throw new ChatUploadError(500, 'Falha ao preparar upload')
}

async function runPresign({
  req,
  body,
  svc,
  env,
  now,
  createOperationId,
  signPut,
}) {
  const parsed = parseChatUploadRequest(body)
  const auth = await authorizeChatUpload(req, svc, parsed)
  if (!auth.ok) {
    return { status: auth.status, body: { error: auth.error } }
  }

  const media = validateChatUploadRequest(body)
  if (media.companyId !== auth.companyId || media.purpose !== parsed.purpose) failed()
  const secret = readChatConfirmSecret(env)
  const credentials = await resolveBackendAwsCredentials(svc, auth.companyId)
  const issuedAtDate = now()
  const issuedAt = Math.floor(issuedAtDate.getTime() / 1000)
  const operationId = createOperationId()
  const objectKey = buildChatObjectKey({
    companyId: auth.companyId,
    operationId,
    safeFileName: media.safeFileName,
    now: issuedAtDate,
  })
  const signed = await signPut({
    credentials,
    key: objectKey.s3Key,
    contentLength: media.sizeBytes,
    contentType: media.contentType,
  })
  assertPresignedPut(signed.putUrl, {
    bucket: credentials.bucket,
    region: credentials.region,
    key: objectKey.s3Key,
  })
  const headerNames = Object.keys(signed.putHeaders ?? {})
  if (
    headerNames.length !== 2
    || signed.putHeaders['Content-Type'] !== media.contentType
    || signed.putHeaders['If-None-Match'] !== '*'
  ) {
    failed()
  }

  const confirmToken = issueChatConfirmToken(secret, {
    operationId,
    userId: auth.userId,
    companyId: auth.companyId,
    purpose: media.purpose,
    conversationId: media.conversationId,
    instanceId: media.instanceId,
    flowId: media.flowId,
    messageType: media.messageType,
    s3Key: objectKey.s3Key,
    originalFileName: media.originalFileName,
    safeFileName: media.safeFileName,
    sizeBytes: media.sizeBytes,
    mimeType: media.mimeType,
    contentType: media.contentType,
    bucket: credentials.bucket,
    region: credentials.region,
    issuedAt,
    expiresAt: issuedAt + CONFIRM_TTL_SECONDS,
  })

  return {
    status: 200,
    body: {
      operationId,
      putUrl: signed.putUrl,
      putHeaders: signed.putHeaders,
      expiresIn: PUT_TTL_SECONDS,
      s3_key: objectKey.s3Key,
      confirmToken,
      confirmExpiresIn: CONFIRM_TTL_SECONDS,
    },
  }
}

export async function presignChatUpload(deps) {
  const resolved = {
    now: () => new Date(),
    createOperationId: createChatOperationId,
    signPut: signCatalogPut,
  }
  for (const [key, value] of Object.entries(deps)) {
    if (value !== undefined) resolved[key] = value
  }

  try {
    return await runPresign(resolved)
  } catch (error) {
    if (error instanceof ChatUploadError || error instanceof CatalogUploadError) {
      return { status: error.status, body: { error: error.publicError } }
    }
    throw error
  }
}
