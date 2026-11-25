import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadRawBody = vi.fn()
const mockVerifyMetaWebhookSignature = vi.fn()
vi.mock('../../../lib/meta-whatsapp/verifyWebhookSignature.js', () => ({
  readRawBody: (...args) => mockReadRawBody(...args),
  verifyMetaWebhookSignature: (...args) => mockVerifyMetaWebhookSignature(...args),
}))

const mockGetMetaServerConfig = vi.fn()
const mockGetMetaWebhookConfig = vi.fn()
vi.mock('../../../lib/meta-whatsapp/config.js', () => ({
  getMetaServerConfig: (...args) => mockGetMetaServerConfig(...args),
  getMetaWebhookConfig: (...args) => mockGetMetaWebhookConfig(...args),
}))

const mockSvc = { from: vi.fn(), rpc: vi.fn() }
vi.mock('../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}))

const mockDecryptMetaToken = vi.fn()
vi.mock('../../../lib/meta-whatsapp/tokenCrypto.js', () => ({
  decryptMetaToken: (...args) => mockDecryptMetaToken(...args),
}))

const mockDownloadAndStoreInboundMedia = vi.fn()
vi.mock('../../../lib/meta-whatsapp/inboundMediaProcessor.js', () => ({
  downloadAndStoreInboundMedia: (...args) => mockDownloadAndStoreInboundMedia(...args),
}))

import handler from '../webhook.js'

const COMPANY_ID = 'bbbb0000-0000-0000-0000-000000000002'
const INSTANCE_ID = 'aaaa0000-0000-0000-0000-000000000001'
const CONVERSATION_ID = 'dddd0000-0000-0000-0000-000000000004'
const WA_ID = '5511900000011'
const WAMID = 'wamid.MEDIA_RETRY_FAKE_FOR_TESTS_ONLY'
const PHONE_NUMBER_ID = '106540352242922'

function chain(data, error = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }
}

function maintenanceChain() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    update: vi.fn().mockReturnThis(),
    then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
  }
}

function installFrom() {
  const queued = []
  const from = vi.fn((table) => {
    if (table === 'meta_whatsapp_messages' || table === 'meta_early_status_pendings') {
      return maintenanceChain()
    }
    if (queued.length > 0) return queued.shift()
    throw new Error(`from(${table}) sem chain programada`)
  })
  from.mockReturnValueOnce = (value) => {
    queued.push(value)
    return from
  }
  mockSvc.from = from
}

function payload() {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ wa_id: WA_ID, profile: { name: 'Contato Teste' } }],
          messages: [{
            id: WAMID,
            from: WA_ID,
            type: 'document',
            timestamp: '1739321024',
            document: { id: '123456789012345', filename: 'a.pdf', mime_type: 'application/pdf' },
          }],
        },
      }],
    }],
  }
}

function response() {
  return {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this },
    json(body) { this._body = body; return this },
    send(body) { this._body = body; return this },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockGetMetaServerConfig.mockReturnValue({ appSecret: 'meta_app_secret_fake_for_tests_only' })
  mockGetMetaWebhookConfig.mockReturnValue({ verifyToken: 'meta_webhook_verify_token_fake' })
  mockVerifyMetaWebhookSignature.mockReturnValue(true)
  mockDecryptMetaToken.mockReturnValue('plain_token_fake')
  mockDownloadAndStoreInboundMedia.mockResolvedValue({ assetId: 'eeee0000-0000-0000-0000-000000000005' })
  installFrom()
})

describe('retry de mídia já persistida', () => {
  it('resolve o lead pendente sem baixar a mídia outra vez', async () => {
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload())))
    mockSvc.from
      .mockReturnValueOnce(chain({ id: INSTANCE_ID, company_id: COMPANY_ID }))
      .mockReturnValueOnce(chain({ id: 'msg-1', conversation_id: CONVERSATION_ID }))
    mockSvc.rpc.mockResolvedValueOnce({ data: 'linked_existing', error: null })

    const res = response()
    await handler({ method: 'POST', headers: {}, query: {} }, res)

    expect(res._status).toBe(200)
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled()
    expect(mockDecryptMetaToken).not.toHaveBeenCalled()
    expect(mockSvc.rpc.mock.calls.map((call) => call[0])).toEqual([
      'resolve_meta_conversation_lead',
      'list_meta_early_status_pendings',
      'delete_expired_meta_early_status_pendings',
    ])
    expect(mockSvc.rpc).toHaveBeenCalledWith('resolve_meta_conversation_lead', {
      p_company_id: COMPANY_ID,
      p_instance_id: INSTANCE_ID,
      p_conversation_id: CONVERSATION_ID,
      p_wa_id: WA_ID,
      p_contact_name: 'Contato Teste',
    })
  })

  it('falha da resolução pede retry e não baixa a mídia', async () => {
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload())))
    mockSvc.from
      .mockReturnValueOnce(chain({ id: INSTANCE_ID, company_id: COMPANY_ID }))
      .mockReturnValueOnce(chain({ id: 'msg-1', conversation_id: CONVERSATION_ID }))
    mockSvc.rpc.mockResolvedValueOnce({ data: null, error: { code: '40P01' } })

    const res = response()
    await handler({ method: 'POST', headers: {}, query: {} }, res)

    expect(res._status).toBe(500)
    expect(mockDownloadAndStoreInboundMedia).not.toHaveBeenCalled()
    expect(JSON.stringify(res._body)).not.toContain(WA_ID)
  })

  it('mídia nova continua no fluxo de download e na RPC de mensagem', async () => {
    mockReadRawBody.mockResolvedValue(Buffer.from(JSON.stringify(payload())))
    mockSvc.from
      .mockReturnValueOnce(chain({ id: INSTANCE_ID, company_id: COMPANY_ID }))
      .mockReturnValueOnce(chain(null))
      .mockReturnValueOnce(chain({ access_token_enc: 'encrypted_token_fake' }))
    mockSvc.rpc.mockResolvedValueOnce({
      data: { created: true, conversation_id: CONVERSATION_ID, message_id: 'msg-1' },
      error: null,
    })

    const res = response()
    await handler({ method: 'POST', headers: {}, query: {} }, res)

    expect(res._status).toBe(200)
    expect(mockDownloadAndStoreInboundMedia).toHaveBeenCalledOnce()
    expect(mockSvc.rpc.mock.calls.map((call) => call[0])).toEqual([
      'process_meta_inbound_media_message',
      'list_meta_early_status_pendings',
      'delete_expired_meta_early_status_pendings',
    ])
  })
})
