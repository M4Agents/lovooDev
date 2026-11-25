import { randomUUID } from 'node:crypto'
import { validateCompanyCaller } from '../../auth/validateCompanyCaller.js'
import {
  CATALOG_UPLOAD_ROLES,
  CONFIRM_SECRET_ENV,
  CONFIRM_TTL_SECONDS,
  PUT_TTL_SECONDS,
} from './constants.js'
import { issueConfirmToken, assertConfirmSecret } from './confirmToken.js'
import { resolveBackendAwsCredentials } from './credentials.js'
import { CatalogUploadError } from './errors.js'
import { buildCatalogObjectKey } from './objectKey.js'
import { assertPresignedPut, signCatalogPut } from './presignPut.js'
import { parseBasicRequest, validateCatalogUploadRequest } from './validation.js'

function assertCatalogRole(role) {
  if (!CATALOG_UPLOAD_ROLES.includes(role)) {
    throw new CatalogUploadError(403, 'Permissão insuficiente para esta operação')
  }
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
  const request = parseBasicRequest(body)
  const auth = await validateCompanyCaller(req, svc, request.companyId, {
    roles: CATALOG_UPLOAD_ROLES,
  })
  if (!auth.ok) {
    return { status: auth.status, body: { error: auth.error } }
  }

  assertCatalogRole(auth.role)
  const media = validateCatalogUploadRequest(request)
  const secret = assertConfirmSecret(env?.[CONFIRM_SECRET_ENV])
  const credentials = await resolveBackendAwsCredentials(svc, auth.companyId)
  const issuedAtDate = now()
  const issuedAt = Math.floor(issuedAtDate.getTime() / 1000)
  const operationId = createOperationId()
  const objectKey = buildCatalogObjectKey({
    companyId: auth.companyId,
    operationId,
    safeFileName: media.safeFileName,
    now: issuedAtDate,
  })
  const signed = await signPut({
    credentials,
    key: objectKey.s3Key,
    contentLength: media.sizeBytes,
    contentType: media.mimeType,
  })
  assertPresignedPut(signed.putUrl, {
    bucket: credentials.bucket,
    region: credentials.region,
    key: objectKey.s3Key,
  })
  const headerNames = Object.keys(signed.putHeaders ?? {})
  if (
    headerNames.length !== 2
    || signed.putHeaders['Content-Type'] !== media.mimeType
    || signed.putHeaders['If-None-Match'] !== '*'
  ) {
    throw new CatalogUploadError(500, 'Falha ao preparar upload')
  }
  const confirmToken = issueConfirmToken(secret, {
    operationId,
    userId: auth.userId,
    companyId: auth.companyId,
    sourceType: media.sourceType,
    s3Key: objectKey.s3Key,
    originalFileName: media.originalFileName,
    sizeBytes: media.sizeBytes,
    mimeType: media.mimeType,
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

export async function presignCatalogUpload(deps) {
  const resolved = {
    now: () => new Date(),
    createOperationId: () => randomUUID(),
    signPut: signCatalogPut,
  }
  for (const [key, value] of Object.entries(deps)) {
    if (value !== undefined) resolved[key] = value
  }

  try {
    return await runPresign(resolved)
  } catch (error) {
    if (error instanceof CatalogUploadError) {
      return { status: error.status, body: { error: error.publicError } }
    }
    throw error
  }
}
