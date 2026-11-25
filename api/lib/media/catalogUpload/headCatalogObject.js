import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { CatalogUploadError } from './errors.js'

export async function headCatalogObject({ credentials, key, client }) {
  const owned = !client
  const s3 = client ?? new S3Client({
    region: credentials.region,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  })

  try {
    const result = await s3.send(new HeadObjectCommand({
      Bucket: credentials.bucket,
      Key: key,
    }))
    return {
      contentLength: result?.ContentLength,
      contentType: result?.ContentType,
    }
  } catch (error) {
    if (error instanceof CatalogUploadError) throw error
    throw classifyHeadFailure(error)
  } finally {
    if (owned) s3.destroy?.()
  }
}

function classifyHeadFailure(error) {
  const status = error?.$metadata?.httpStatusCode
  if (status === 404) {
    return new CatalogUploadError(404, 'Objeto não encontrado')
  }
  if (status != null) {
    return new CatalogUploadError(503, 'Confirmação temporariamente indisponível')
  }
  const name = error?.name
  if (name === 'NotFound' || name === 'NoSuchKey') {
    return new CatalogUploadError(404, 'Objeto não encontrado')
  }
  return new CatalogUploadError(503, 'Confirmação temporariamente indisponível')
}
