import { createHmac } from 'node:crypto'
import { vi } from 'vitest'
import { CATALOG_MEDIA_UPSERT_OPTIONS } from '../catalogMetadata.js'
import { confirmCatalogUpload } from '../confirmCatalogUpload.js'
import { issueConfirmToken } from '../confirmToken.js'
import {
  BUCKET,
  COMPANY_ID,
  FIXED_NOW,
  HMAC_SECRET,
  OPERATION_A,
  REGION,
  USER_ID,
  authorizedEnv,
  makeChain,
  makeReq,
  makeSvc,
} from './fixtures.js'

export const MEDIA_ID = 'ffff0000-0000-4000-8000-000000000009'
export const ISSUED_AT = Math.floor(FIXED_NOW.getTime() / 1000)

export function keyFor(companyId = COMPANY_ID, operationId = OPERATION_A, fileName = 'foto.png', issuedAt = ISSUED_AT) {
  const date = new Date(issuedAt * 1000)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `clientes/${companyId}/whatsapp/${date.getUTCFullYear()}/${month}/${day}/${operationId}/${fileName}`
}

export function issueToken(overrides = {}) {
  const issuedAt = overrides.issuedAt ?? ISSUED_AT
  const companyId = overrides.companyId ?? COMPANY_ID
  const operationId = overrides.operationId ?? OPERATION_A
  const originalFileName = overrides.originalFileName ?? 'foto.png'
  return issueConfirmToken(HMAC_SECRET, {
    operationId,
    userId: overrides.userId ?? USER_ID,
    companyId,
    sourceType: overrides.sourceType ?? 'product',
    s3Key: overrides.s3Key ?? keyFor(companyId, operationId, originalFileName, issuedAt),
    originalFileName,
    sizeBytes: overrides.sizeBytes ?? 1024,
    mimeType: overrides.mimeType ?? 'image/png',
    bucket: overrides.bucket ?? BUCKET,
    region: overrides.region ?? REGION,
    issuedAt,
    expiresAt: issuedAt + 900,
  })
}

export function resignToken(token, mutate) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  mutate(payload)
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const input = `v1.${encoded}`
  const signature = createHmac('sha256', HMAC_SECRET).update(input).digest('base64url')
  return `${input}.${signature}`
}

export function memoryMedia() {
  const rows = []
  const calls = []
  const api = {
    upsert(values, options) {
      calls.push({ type: 'upsert', values: { ...values }, options })
      return {
        select: async () => {
          if (api.failAfterInsert) {
            rows.push({ id: MEDIA_ID, ...values })
            throw new Error('response lost after insert')
          }
          if (api.upsertResult) return api.upsertResult
          const existing = rows.find((row) => row.company_id === values.company_id && row.s3_key === values.s3_key)
          if (existing) return { data: [], error: null }
          const row = {
            id: MEDIA_ID,
            ...values,
            file_size: api.sizeAsString ? String(values.file_size) : values.file_size,
          }
          rows.push({ ...row })
          return { data: [{ ...row }], error: null }
        },
      }
    },
    select() {
      const filters = []
      const chain = {
        eq(column, value) {
          filters.push([column, value])
          calls.push({ type: 'eq', column, value })
          return chain
        },
        then(resolve, reject) {
          const result = api.selectResult ?? {
            data: rows
              .filter((row) => filters.every(([column, value]) => row[column] === value))
              .map((row) => ({ ...row })),
            error: null,
          }
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      return chain
    },
  }
  return { api, rows, calls }
}

export function confirmParts(options = {}) {
  const svc = options.svc ?? makeSvc({ tables: { company_users: makeChain({ role: options.role ?? 'admin' }) } })
  const media = options.media ?? memoryMedia()
  const originalFrom = svc.from.getMockImplementation?.() ?? svc.from
  const fromImpl = svc.from
  svc.from = vi.fn((table) => (table === 'company_media_library' ? media.api : fromImpl(table)))
  const headObject = options.headObject ?? vi.fn(async () => options.head ?? {
    contentLength: options.sizeBytes ?? 1024,
    contentType: options.mimeType ?? 'image/png',
  })
  const token = options.token ?? issueToken(options.tokenOverrides ?? {})
  const body = options.body ?? { confirmToken: token }
  const run = () => confirmCatalogUpload({
    req: options.req ?? makeReq(body, options.authorization),
    body,
    svc,
    env: options.env ?? authorizedEnv(),
    now: () => options.now ?? FIXED_NOW,
    headObject,
  })
  return { run, svc, media, headObject, token, originalFrom }
}

export { CATALOG_MEDIA_UPSERT_OPTIONS }
