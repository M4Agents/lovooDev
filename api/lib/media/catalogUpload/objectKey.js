import { CatalogUploadError } from './errors.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

function invalid() {
  throw new CatalogUploadError(500, 'Falha ao preparar upload')
}

export function buildCatalogObjectKey({ companyId, operationId, safeFileName, now }) {
  if (!UUID_RE.test(companyId) || !UUID_RE.test(operationId) || !FILE_RE.test(safeFileName)) {
    invalid()
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    invalid()
  }

  const year = String(now.getUTCFullYear())
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  const s3Key = `clientes/${companyId}/whatsapp/${year}/${month}/${day}/${operationId}/${safeFileName}`

  if (s3Key.split('/').some((segment) => segment.length === 0) || s3Key.includes('..')) {
    invalid()
  }

  return { operationId, s3Key }
}

export function derivePublicObjectUrl(bucket, region, s3Key) {
  return `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`
}

export function parseCatalogObjectKey(s3Key) {
  if (typeof s3Key !== 'string' || /[\\%?#\s]/.test(s3Key) || s3Key.includes('..')) return null
  const parts = s3Key.split('/')
  if (parts.length !== 8) return null
  const [root, companyId, channel, year, month, day, operationId, fileName] = parts
  if (root !== 'clientes' || channel !== 'whatsapp') return null
  if (!UUID_RE.test(companyId) || !UUID_RE.test(operationId) || !FILE_RE.test(fileName)) return null
  if (!/^\d{4}$/.test(year) || !/^(0[1-9]|1[0-2])$/.test(month) || !/^(0[1-9]|[12]\d|3[01])$/.test(day)) {
    return null
  }
  return { companyId, year, month, day, operationId, fileName }
}

export function utcKeyDate(unixSeconds) {
  const date = new Date(unixSeconds * 1000)
  if (Number.isNaN(date.getTime())) return null
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, '0'),
    day: String(date.getUTCDate()).padStart(2, '0'),
  }
}
