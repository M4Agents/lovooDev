import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { PUT_TTL_SECONDS } from './constants.js'
import { isValidStorageBucket, isValidStorageRegion } from './credentials.js'
import { CatalogUploadError } from './errors.js'

export const REQUIRED_SIGNED_HEADERS = Object.freeze([
  'content-length',
  'content-type',
  'host',
  'if-none-match',
])

function failed() {
  throw new CatalogUploadError(500, 'Falha ao preparar upload')
}

export function assertPresignedPut(putUrl, expected) {
  let url
  try {
    url = new URL(putUrl)
  } catch {
    failed()
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) {
    failed()
  }
  if (
    !expected
    || !isValidStorageBucket(expected.bucket)
    || !isValidStorageRegion(expected.region)
    || typeof expected.key !== 'string'
    || expected.key.length === 0
  ) {
    failed()
  }

  const regionalHost = `${expected.bucket}.s3.${expected.region}.amazonaws.com`
  const legacyUsEastHost = expected.region === 'us-east-1'
    ? `${expected.bucket}.s3.amazonaws.com`
    : null
  if (url.hostname !== regionalHost && url.hostname !== legacyUsEastHost) {
    failed()
  }

  let path = url.pathname
  try {
    path = decodeURIComponent(path)
  } catch {
    failed()
  }
  if (path !== `/${expected.key}`) {
    failed()
  }

  const signed = new Set((url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';').filter(Boolean))
  if (
    signed.size !== REQUIRED_SIGNED_HEADERS.length
    || REQUIRED_SIGNED_HEADERS.some((header) => !signed.has(header))
  ) {
    failed()
  }
  if (url.searchParams.get('X-Amz-Expires') !== String(PUT_TTL_SECONDS)) {
    failed()
  }
}

export async function signCatalogPut({ credentials, key, contentLength, contentType }) {
  const client = new S3Client({
    region: credentials.region,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  })

  try {
    const command = new PutObjectCommand({
      Bucket: credentials.bucket,
      Key: key,
      ContentLength: contentLength,
      ContentType: contentType,
      IfNoneMatch: '*',
    })
    const putUrl = await getSignedUrl(client, command, {
      expiresIn: PUT_TTL_SECONDS,
      signableHeaders: new Set(['content-type']),
    })
    assertPresignedPut(putUrl, {
      bucket: credentials.bucket,
      region: credentials.region,
      key,
    })
    return {
      putUrl,
      putHeaders: {
        'Content-Type': contentType,
        'If-None-Match': '*',
      },
    }
  } catch (error) {
    if (error instanceof CatalogUploadError) throw error
    failed()
  } finally {
    client.destroy()
  }
}
