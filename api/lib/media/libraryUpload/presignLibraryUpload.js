import { validateCompanyCaller } from '../../auth/validateCompanyCaller.js'
import { assertStorageLimitStrict } from '../../plans/limitChecker.js'
import { CatalogUploadError } from '../catalogUpload/errors.js'
import { resolveBackendAwsCredentials } from '../catalogUpload/credentials.js'
import { assertPresignedPut, signCatalogPut } from '../catalogUpload/presignPut.js'
import {
  CONFIRM_SECRET_ENV,
  CONFIRM_TTL_SECONDS,
  LIBRARY_UPLOAD_ROLES,
  PUT_TTL_SECONDS,
} from './constants.js'
import { assertLibraryConfirmSecret, issueLibraryConfirmToken } from './confirmToken.js'
import { LibraryUploadError } from './errors.js'
import { buildLibraryObjectKey, createLibraryOperationId } from './objectKey.js'
import {
  assertUuid,
  parseLibraryUploadRequest,
  validateLibraryUploadRequest,
} from './validation.js'

function unavailable() {
  throw new LibraryUploadError(503, 'Preparação temporariamente indisponível')
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
  if (!result.data?.id) {
    throw new LibraryUploadError(404, 'Pasta não encontrada')
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
  const request = parseLibraryUploadRequest(body)
  const auth = await validateCompanyCaller(req, svc, request.companyId, {
    roles: LIBRARY_UPLOAD_ROLES,
  })
  if (!auth.ok) {
    return { status: auth.status, body: { error: auth.error } }
  }
  if (!LIBRARY_UPLOAD_ROLES.includes(auth.role)) {
    throw new LibraryUploadError(403, 'Permissão insuficiente para esta operação')
  }

  await assertFolderInCompany(svc, auth.companyId, request.folderId)
  const media = validateLibraryUploadRequest(request)
  await assertStorageLimitStrict(svc, auth.companyId, media.sizeBytes)
  const secret = assertLibraryConfirmSecret(env?.[CONFIRM_SECRET_ENV])
  const credentials = await resolveBackendAwsCredentials(svc, auth.companyId)
  const issuedAtDate = now()
  const issuedAt = Math.floor(issuedAtDate.getTime() / 1000)
  const operationId = createOperationId()
  const objectKey = buildLibraryObjectKey({
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
    throw new LibraryUploadError(500, 'Falha ao preparar upload')
  }

  const confirmToken = issueLibraryConfirmToken(secret, {
    operationId,
    userId: auth.userId,
    companyId: auth.companyId,
    folderId: media.folderId,
    s3Key: objectKey.s3Key,
    originalFileName: media.originalFileName,
    sizeBytes: media.sizeBytes,
    mimeType: media.mimeType,
    fileType: media.fileType,
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

export async function presignLibraryUpload(deps) {
  const resolved = {
    now: () => new Date(),
    createOperationId: createLibraryOperationId,
    signPut: signCatalogPut,
  }
  for (const [key, value] of Object.entries(deps)) {
    if (value !== undefined) resolved[key] = value
  }

  try {
    return await runPresign(resolved)
  } catch (error) {
    if (error?.isPlanError) {
      return { status: error.httpStatus, body: error.data }
    }
    if (error instanceof LibraryUploadError || error instanceof CatalogUploadError) {
      return { status: error.status, body: { error: error.publicError } }
    }
    throw error
  }
}
