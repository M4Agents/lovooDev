import { sameCatalogFileSize } from '../catalogUpload/catalogMetadata.js'
import { LibraryUploadError } from './errors.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const LIBRARY_MEDIA_UPSERT_OPTIONS = Object.freeze({
  onConflict: 'company_id,operation_id',
  ignoreDuplicates: true,
})

export const LIBRARY_MEDIA_COLUMNS = [
  'id',
  'company_id',
  'folder_id',
  'operation_id',
  's3_key',
  'file_type',
  'mime_type',
  'file_size',
  'original_filename',
  'preview_url',
].join(',')

function unavailable() {
  throw new LibraryUploadError(503, 'Confirmação temporariamente indisponível')
}

function divergent() {
  throw new LibraryUploadError(409, 'Confirmação divergente')
}

export function libraryProtectedMatch(row, expected) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false
  if (typeof row.id !== 'string' || !UUID_RE.test(row.id)) return false
  return row.company_id === expected.company_id
    && row.operation_id === expected.operation_id
    && row.s3_key === expected.s3_key
    && row.mime_type === expected.mime_type
    && row.file_type === expected.file_type
    && sameCatalogFileSize(row.file_size, expected.file_size)
}

export function publicLibraryAsset(row) {
  return {
    id: row.id,
    company_id: row.company_id,
    folder_id: row.folder_id,
    operation_id: row.operation_id,
    s3_key: row.s3_key,
    file_type: row.file_type,
    mime_type: row.mime_type,
    file_size: row.file_size,
    original_filename: row.original_filename,
    preview_url: row.preview_url,
  }
}

export async function readLibraryOperation(svc, companyId, operationId) {
  let result
  try {
    result = await svc
      .from('lead_media_unified')
      .select(LIBRARY_MEDIA_COLUMNS)
      .eq('company_id', companyId)
      .eq('operation_id', operationId)
  } catch {
    unavailable()
  }
  if (!result || typeof result !== 'object' || result.error) unavailable()
  if (!Array.isArray(result.data)) {
    throw new LibraryUploadError(500, 'Falha ao confirmar upload')
  }
  if (result.data.length > 1) {
    throw new LibraryUploadError(500, 'Falha ao confirmar upload')
  }
  return result.data[0] ?? null
}

export async function persistLibraryMetadata(svc, metadata) {
  let result
  try {
    result = await svc
      .from('lead_media_unified')
      .upsert(metadata, LIBRARY_MEDIA_UPSERT_OPTIONS)
      .select(LIBRARY_MEDIA_COLUMNS)
  } catch {
    unavailable()
  }
  if (result?.error?.code === '23503') divergent()
  if (!result || typeof result !== 'object' || result.error) unavailable()
  if (!Array.isArray(result.data) || result.data.length > 1) {
    throw new LibraryUploadError(500, 'Falha ao confirmar upload')
  }

  const row = result.data.length === 1
    ? result.data[0]
    : await readLibraryOperation(svc, metadata.company_id, metadata.operation_id)
  if (!libraryProtectedMatch(row, metadata)) divergent()
  return publicLibraryAsset(row)
}
