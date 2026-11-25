import { CatalogUploadError } from './errors.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CANONICAL_INT_RE = /^(0|[1-9]\d*)$/

export const CATALOG_MEDIA_UPSERT_OPTIONS = Object.freeze({
  onConflict: 'company_id,s3_key',
  ignoreDuplicates: true,
})

export const CATALOG_MEDIA_COMPARE_COLUMNS = [
  'id',
  'company_id',
  's3_key',
  'original_filename',
  'file_type',
  'mime_type',
  'file_size',
  'folder_path',
  'preview_url',
  'created_by',
  'source_ref',
].join(',')

function failure() {
  return new CatalogUploadError(500, 'Falha ao confirmar upload')
}

export function catalogFolderPath(sourceType) {
  if (sourceType === 'product') return '/produtos'
  if (sourceType === 'service') return '/servicos'
  return null
}

export function sameCatalogFileSize(actual, expected) {
  if (!Number.isSafeInteger(expected) || expected <= 0) return false
  if (typeof actual === 'bigint') return actual === BigInt(expected)
  if (typeof actual === 'number') return Number.isSafeInteger(actual) && actual === expected
  if (typeof actual === 'string' && CANONICAL_INT_RE.test(actual)) return actual === String(expected)
  return false
}

export function catalogRecordMatches(row, expected) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false
  if (typeof row.id !== 'string' || !UUID_RE.test(row.id)) return false
  return row.company_id === expected.company_id
    && row.s3_key === expected.s3_key
    && row.original_filename === expected.original_filename
    && row.file_type === expected.file_type
    && row.mime_type === expected.mime_type
    && sameCatalogFileSize(row.file_size, expected.file_size)
    && row.folder_path === expected.folder_path
    && row.preview_url === expected.preview_url
    && row.created_by === expected.created_by
    && row.source_ref === null
}

export function publicCatalogAsset(row) {
  return {
    id: row.id,
    s3_key: row.s3_key,
    file_type: row.file_type,
    original_filename: row.original_filename,
    preview_url: row.preview_url,
    company_id: row.company_id,
    folder_path: row.folder_path,
  }
}

export async function persistCatalogMetadata(svc, metadata) {
  const rows = await readUpsert(svc, metadata)
  const row = rows.length === 1
    ? rows[0]
    : await rereadCatalogMetadata(svc, metadata.company_id, metadata.s3_key)
  if (!catalogRecordMatches(row, metadata)) {
    throw new CatalogUploadError(409, 'Confirmação divergente')
  }
  return publicCatalogAsset(row)
}

async function readUpsert(svc, metadata) {
  let result
  try {
    result = await svc
      .from('company_media_library')
      .upsert(metadata, CATALOG_MEDIA_UPSERT_OPTIONS)
      .select(CATALOG_MEDIA_COMPARE_COLUMNS)
  } catch {
    throw failure()
  }
  if (result?.error || !Array.isArray(result?.data) || result.data.length > 1) {
    throw failure()
  }
  return result.data
}

async function rereadCatalogMetadata(svc, companyId, s3Key) {
  let result
  try {
    result = await svc
      .from('company_media_library')
      .select(CATALOG_MEDIA_COMPARE_COLUMNS)
      .eq('company_id', companyId)
      .eq('s3_key', s3Key)
  } catch {
    throw failure()
  }
  if (result?.error || !Array.isArray(result?.data) || result.data.length !== 1) {
    throw failure()
  }
  return result.data[0]
}
