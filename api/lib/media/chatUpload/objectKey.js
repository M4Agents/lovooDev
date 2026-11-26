import { randomUUID } from 'node:crypto'
import { CatalogUploadError } from '../catalogUpload/errors.js'
import {
  buildCatalogObjectKey,
  derivePublicObjectUrl,
  parseCatalogObjectKey,
  utcKeyDate,
} from '../catalogUpload/objectKey.js'
import { ChatUploadError } from './errors.js'

export { derivePublicObjectUrl, utcKeyDate }

export function createChatOperationId() {
  return randomUUID()
}

export function buildChatObjectKey({ companyId, operationId, safeFileName, now }) {
  try {
    return buildCatalogObjectKey({ companyId, operationId, safeFileName, now })
  } catch (error) {
    if (error instanceof CatalogUploadError) {
      throw new ChatUploadError(500, 'Falha ao preparar upload')
    }
    throw error
  }
}

export function parseChatObjectKey(s3Key) {
  return parseCatalogObjectKey(s3Key)
}
