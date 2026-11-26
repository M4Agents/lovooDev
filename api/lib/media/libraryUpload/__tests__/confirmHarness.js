import { createHmac } from 'node:crypto'
import { vi } from 'vitest'
import { issueConfirmToken } from '../../catalogUpload/confirmToken.js'
import {
  AWS_KEY,
  AWS_SECRET,
  ASSIGNMENT_ID,
  BUCKET,
  COMPANY_ID,
  FIXED_NOW,
  HMAC_SECRET,
  OPERATION_A,
  PARENT_ID,
  REGION,
  USER_ID,
  makeChain,
  makeReq,
  makeSvc,
} from '../../catalogUpload/__tests__/fixtures.js'
import { confirmLibraryUpload } from '../confirmLibraryUpload.js'
import { issueLibraryConfirmToken } from '../confirmToken.js'
import { LIBRARY_MEDIA_UPSERT_OPTIONS } from '../libraryMetadata.js'
import { FOLDER_ID, companyPlan, directSvc, libraryEnv } from './presignFixtures.js'

export const MEDIA_ID = 'ffff0000-0000-4000-8000-000000000009'
export const LIBRARY_SECRET = 'l'.repeat(32)
export const ISSUED_AT = Math.floor(FIXED_NOW.getTime() / 1000)

export function libraryKey(companyId = COMPANY_ID, operationId = OPERATION_A, fileName = 'foto.png', issuedAt = ISSUED_AT) {
  const date = new Date(issuedAt * 1000)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `clientes/${companyId}/library/${date.getUTCFullYear()}/${month}/${day}/${operationId}/${fileName}`
}

export function issueLibraryToken(overrides = {}) {
  const issuedAt = overrides.issuedAt ?? ISSUED_AT
  const companyId = overrides.companyId ?? COMPANY_ID
  const operationId = overrides.operationId ?? OPERATION_A
  const originalFileName = overrides.originalFileName ?? 'foto.png'
  return issueLibraryConfirmToken(overrides.secret ?? LIBRARY_SECRET, {
    operationId,
    userId: overrides.userId ?? USER_ID,
    companyId,
    folderId: overrides.folderId ?? FOLDER_ID,
    s3Key: overrides.s3Key ?? libraryKey(companyId, operationId, originalFileName, issuedAt),
    originalFileName,
    sizeBytes: overrides.sizeBytes ?? 1024,
    mimeType: overrides.mimeType ?? 'image/png',
    fileType: overrides.fileType ?? 'image',
    bucket: overrides.bucket ?? BUCKET,
    region: overrides.region ?? REGION,
    issuedAt,
    expiresAt: overrides.expiresAt ?? issuedAt + 900,
  })
}

export function resignLibraryToken(token, mutate, secret = LIBRARY_SECRET) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  mutate(payload)
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const input = `v1.${encoded}`
  const signature = createHmac('sha256', secret).update(input).digest('base64url')
  return `${input}.${signature}`
}

export function storedLibraryRow(overrides = {}) {
  const s3Key = overrides.s3_key ?? libraryKey()
  return {
    id: MEDIA_ID,
    company_id: COMPANY_ID,
    folder_id: FOLDER_ID,
    operation_id: OPERATION_A,
    s3_key: s3Key,
    file_type: 'image',
    mime_type: 'image/png',
    file_size: 1024,
    original_filename: 'foto.png',
    preview_url: `https://${BUCKET}.s3.${REGION}.amazonaws.com/${s3Key}`,
    ...overrides,
  }
}

export function memoryLibrary(initial = []) {
  const rows = initial.map((row) => ({ ...row }))
  const calls = []
  const api = {
    upsert(values, options) {
      calls.push({ type: 'upsert', values: { ...values }, options })
      return {
        select: async () => {
          if (api.upsertError) return { data: null, error: api.upsertError }
          if (api.failUpsert) throw api.failUpsert
          const existing = rows.find((row) => row.company_id === values.company_id && row.operation_id === values.operation_id)
          if (existing || api.conflictOnUpsert) {
            if (!existing && api.conflictOnUpsert) rows.push({ id: MEDIA_ID, ...values, ...api.conflictRow })
            return { data: [], error: null }
          }
          const row = { id: MEDIA_ID, ...values }
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
          const result = api.selectError
            ? { data: null, error: api.selectError }
            : {
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

function attachMedia(svc, media) {
  const original = svc.from
  svc.from = vi.fn((table) => (table === 'lead_media_unified' ? media.api : original(table)))
  return svc
}

export function confirmParts(options = {}) {
  const media = options.media ?? memoryLibrary(options.rows ?? [])
  const svc = attachMedia(options.svc ?? directSvc(options.role ?? 'admin', options.folder), media)
  if (options.secondUserId || options.sessionUserId) {
    let calls = 0
    svc.auth.getUser.mockImplementation(async () => {
      calls += 1
      const id = calls === 1
        ? (options.sessionUserId ?? USER_ID)
        : (options.secondUserId ?? options.sessionUserId ?? USER_ID)
      return { data: { user: id ? { id } : null }, error: options.authError ?? null }
    })
  }
  const headObject = options.headObject ?? vi.fn(async () => options.head ?? {
    contentLength: options.sizeBytes ?? 1024,
    contentType: options.mimeType ?? 'image/png',
  })
  const token = options.token ?? issueLibraryToken(options.tokenOverrides ?? {})
  const body = options.body === undefined ? { confirmToken: token } : options.body
  const run = () => confirmLibraryUpload({
    req: options.req ?? makeReq(body, options.authorization),
    body,
    svc,
    env: options.env === undefined ? libraryEnv(LIBRARY_SECRET) : options.env,
    now: () => options.now ?? FIXED_NOW,
    headObject,
  })
  return { run, svc, media, headObject, token }
}

export function parentConfirmSvc(role, withPlan = false) {
  const userPass = [
    makeChain(null),
    makeChain({ role, company_id: PARENT_ID, companies: { company_type: 'parent' } }),
    makeChain({ role, company_id: PARENT_ID, companies: { company_type: 'parent' } }),
  ]
  const companyPass = [
    makeChain({ parent_company_id: PARENT_ID }),
    makeChain({ id: COMPANY_ID }),
  ]
  return makeSvc({
    tableSeq: {
      company_users: [...userPass, ...userPass],
      companies: withPlan
        ? [...companyPass, companyPlan(null), ...companyPass]
        : [...companyPass, ...companyPass],
    },
    tables: {
      company_folders: makeChain({ id: FOLDER_ID, is_system_folder: false }),
    },
  })
}

export function inheritedPartnerSvc(withPlan = false) {
  const partner = makeChain({
    role: 'partner',
    company_id: PARENT_ID,
    companies: { company_type: 'parent' },
  })
  const companies = [
    makeChain({ parent_company_id: PARENT_ID }),
    makeChain({ parent_company_id: PARENT_ID }),
  ]
  if (withPlan) companies.splice(1, 0, companyPlan(null))
  return makeSvc({
    tableSeq: {
      company_users: [makeChain(null), partner, makeChain(null), partner],
      companies,
    },
    tables: {
      partner_company_assignments: makeChain({ id: ASSIGNMENT_ID }),
      company_folders: makeChain({ id: FOLDER_ID, is_system_folder: true }),
    },
  })
}

export function catalogToken() {
  return issueConfirmToken(HMAC_SECRET, {
    operationId: OPERATION_A,
    userId: USER_ID,
    companyId: COMPANY_ID,
    sourceType: 'product',
    s3Key: `clientes/${COMPANY_ID}/whatsapp/2026/11/25/${OPERATION_A}/foto.png`,
    originalFileName: 'foto.png',
    sizeBytes: 1024,
    mimeType: 'image/png',
    bucket: BUCKET,
    region: REGION,
    issuedAt: ISSUED_AT,
    expiresAt: ISSUED_AT + 900,
  })
}

export { AWS_KEY, AWS_SECRET, LIBRARY_MEDIA_UPSERT_OPTIONS, companyPlan }
