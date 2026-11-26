import { vi } from 'vitest'

export const USER_ID = 'aaaa0000-0000-4000-8000-000000000001'
export const COMPANY_ID = 'bbbb0000-0000-4000-8000-000000000002'
export const OTHER_ID = 'ffff0000-0000-4000-8000-000000000006'
export const CONVERSATION_ID = 'cccc0000-0000-4000-8000-000000000003'
export const INSTANCE_ID = 'dddd0000-0000-4000-8000-000000000004'
export const FLOW_ID = 'eeee0000-0000-4000-8000-000000000005'
export const OPERATION_A = '11111111-1111-4111-8111-111111111111'
export const HMAC_SECRET = 'a'.repeat(32)
export const AWS_KEY = 'AKIATESTFAKE000000'
export const AWS_SECRET = 'aws-secret-test-fixture-value'
export const BUCKET = 'example-bucket'
export const REGION = 'us-east-1'
export const FIXED_NOW = new Date('2026-11-26T15:04:05.000Z')

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
  rpcData = [{
    access_key_id: AWS_KEY,
    secret_access_key: AWS_SECRET,
    bucket: BUCKET,
    region: REGION,
  }],
  rpcError = null,
} = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: authError ? null : user },
        error: authError ?? null,
      }),
    },
    from: vi.fn((table) => tables[table] ?? makeChain(null)),
    rpc: vi.fn().mockResolvedValue({ data: rpcData, error: rpcError }),
  }
}

export function readyTables(role = 'admin') {
  return {
    company_users: makeChain({ role }),
    companies: makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: false }),
    chat_conversations: makeChain({
      id: CONVERSATION_ID,
      company_id: COMPANY_ID,
      instance_id: INSTANCE_ID,
      last_instance_id: null,
      assigned_to: null,
    }),
    whatsapp_life_instances: makeChain({
      id: INSTANCE_ID,
      company_id: COMPANY_ID,
      deleted_at: null,
      assigned_user_id: null,
      available_to_all: false,
    }),
    automation_flows: makeChain({ id: FLOW_ID, company_id: COMPANY_ID }),
  }
}

export function readySvc(role = 'admin', overrides = {}) {
  return makeSvc({
    tables: readyTables(role),
    ...overrides,
  })
}

export function makeReq(body, authorization = 'Bearer session-token') {
  return { method: 'POST', headers: { authorization }, body }
}

export function authorizedEnv(extra = {}) {
  return { MEDIA_CHAT_UPLOAD_TOKEN_SECRET: HMAC_SECRET, ...extra }
}

export function manualBody(overrides = {}) {
  return {
    companyId: COMPANY_ID,
    purpose: 'chat_manual',
    conversationId: CONVERSATION_ID,
    messageType: 'image',
    fileName: 'foto.png',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    ...overrides,
  }
}

export function scheduleBody(overrides = {}) {
  return {
    companyId: COMPANY_ID,
    purpose: 'chat_schedule',
    conversationId: CONVERSATION_ID,
    instanceId: INSTANCE_ID,
    messageType: 'document',
    fileName: 'contrato.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    ...overrides,
  }
}

export function automationBody(overrides = {}) {
  return {
    companyId: COMPANY_ID,
    purpose: 'automation_audio',
    flowId: FLOW_ID,
    messageType: 'audio',
    fileName: 'gravacao.webm',
    mimeType: 'audio/webm',
    sizeBytes: 4096,
    ...overrides,
  }
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
