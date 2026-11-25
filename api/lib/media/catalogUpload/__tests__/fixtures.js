import { vi } from 'vitest'

export const USER_ID = 'aaaa0000-0000-4000-8000-000000000001'
export const COMPANY_ID = 'bbbb0000-0000-4000-8000-000000000002'
export const PARENT_ID = 'cccc0000-0000-4000-8000-000000000003'
export const OTHER_ID = 'dddd0000-0000-4000-8000-000000000004'
export const ASSIGNMENT_ID = 'eeee0000-0000-4000-8000-000000000005'
export const OPERATION_A = '11111111-1111-4111-8111-111111111111'
export const OPERATION_B = '22222222-2222-4222-8222-222222222222'

export const HMAC_SECRET = 'a'.repeat(32)
export const AWS_KEY = 'AKIATESTFAKE000000'
export const AWS_SECRET = 'aws-secret-test-fixture-value'
export const BUCKET = 'example-bucket'
export const REGION = 'us-east-1'
export const FIXED_NOW = new Date('2026-11-25T15:04:05.000Z')

export function makeChain(data, error = null) {
  const state = {}
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn((column, values) => {
      state.in = { column, values }
      return chain
    }),
    maybeSingle: vi.fn(async () => {
      if (state.in && data && !state.in.values.includes(data.role)) {
        return { data: null, error }
      }
      return { data, error }
    }),
  }
  return chain
}

export function makeSvc({
  user = { id: USER_ID },
  authError = null,
  tables = {},
  tableSeq = {},
  rpcData = [{
    access_key_id: AWS_KEY,
    secret_access_key: AWS_SECRET,
    bucket: BUCKET,
    region: REGION,
  }],
  rpcError = null,
} = {}) {
  const counters = {}
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: authError ? null : user },
        error: authError ?? null,
      }),
    },
    from: vi.fn((table) => {
      if (tableSeq[table]) {
        counters[table] = counters[table] ?? 0
        const chain = tableSeq[table][counters[table]] ?? makeChain(null)
        counters[table] += 1
        return chain
      }
      return tables[table] ?? makeChain(null)
    }),
    rpc: vi.fn().mockResolvedValue({ data: rpcData, error: rpcError }),
  }
}

export function makeReq(body, authorization = 'Bearer valid-token') {
  return { method: 'POST', headers: { authorization }, body }
}

export function validBody(overrides = {}) {
  return {
    companyId: COMPANY_ID,
    sourceType: 'product',
    fileName: 'foto.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    ...overrides,
  }
}

export function authorizedEnv() {
  return { MEDIA_CATALOG_UPLOAD_TOKEN_SECRET: HMAC_SECRET }
}

export function acceptedPut({ key, credentials, contentType }) {
  return {
    putUrl: `https://${credentials.bucket}.s3.${credentials.region}.amazonaws.com/${key}?X-Amz-SignedHeaders=content-length;content-type;host;if-none-match&X-Amz-Expires=300`,
    putHeaders: {
      'Content-Type': contentType,
      'If-None-Match': '*',
    },
  }
}

export function parentSvc(role) {
  return makeSvc({
    tableSeq: {
      company_users: [
        makeChain(null),
        makeChain({
          role,
          company_id: PARENT_ID,
          companies: { company_type: 'parent' },
        }),
      ],
      companies: [
        makeChain({ parent_company_id: PARENT_ID }),
        makeChain({ id: COMPANY_ID }),
      ],
    },
  })
}

export function mockRes() {
  const headers = {}
  return {
    headers,
    statusCode: 0,
    body: null,
    setHeader(name, value) {
      headers[name] = value
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  }
}
