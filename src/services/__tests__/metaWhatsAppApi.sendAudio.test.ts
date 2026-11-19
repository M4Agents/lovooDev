import { describe, it, expect, vi, beforeEach } from 'vitest'
import { metaWhatsAppApi, MetaOutboundAudioSendError } from '../metaWhatsAppApi'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'fake-access-token-audio' } },
      }),
    },
  },
}))

const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const INSTANCE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CONV_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OPERATION_ID = 'a0b1c2d3-e4f5-4a67-8b90-123456789abc'

function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('metaWhatsAppApi.sendAudio', () => {
  it('POST multipart no endpoint correto com Bearer e sem Content-Type JSON', async () => {
    const spy = mockFetch({ ok: true })
    const file = new File([new Uint8Array([1, 2, 3])], 'audio.m4a', { type: 'audio/mp4' })
    await metaWhatsAppApi.sendAudio({
      companyId: COMPANY_ID,
      instanceId: INSTANCE_ID,
      conversationId: CONV_ID,
      operationId: OPERATION_ID,
      audio: file,
    })
    expect(spy).toHaveBeenCalledTimes(1)
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('/api/whatsapp/meta/messages/send-audio')
    expect((init as RequestInit).method).toBe('POST')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer fake-access-token-audio')
    expect(headers['Content-Type']).toBeUndefined()
    expect((init as RequestInit).body).toBeInstanceOf(FormData)
    const form = (init as RequestInit).body as FormData
    expect(form.get('company_id')).toBe(COMPANY_ID)
    expect(form.get('instance_id')).toBe(INSTANCE_ID)
    expect(form.get('conversation_id')).toBe(CONV_ID)
    expect(form.get('operation_id')).toBe(OPERATION_ID)
    expect(form.get('to')).toBeNull()
    expect(form.get('access_token')).toBeNull()
    expect(form.get('phone_number_id')).toBeNull()
    expect(form.get('wamid')).toBeNull()
  })

  it('200 exige ok true', async () => {
    mockFetch({ ok: true })
    const result = await metaWhatsAppApi.sendAudio({
      companyId: COMPANY_ID,
      instanceId: INSTANCE_ID,
      conversationId: CONV_ID,
      operationId: OPERATION_ID,
      audio: new File([new Uint8Array([1])], 'audio.m4a', { type: 'audio/mp4' }),
    })
    expect(result).toEqual({ ok: true })
  })

  it('200 malformado não é sucesso', async () => {
    mockFetch({ ok: false })
    await expect(metaWhatsAppApi.sendAudio({
      companyId: COMPANY_ID,
      instanceId: INSTANCE_ID,
      conversationId: CONV_ID,
      operationId: OPERATION_ID,
      audio: new File([new Uint8Array([1])], 'audio.m4a', { type: 'audio/mp4' }),
    })).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('propaga 501, 503, 409 e persistência', async () => {
    mockFetch({ ok: false, error: 'audio_send_not_enabled' }, 501)
    await expect(metaWhatsAppApi.sendAudio({
      companyId: COMPANY_ID,
      instanceId: INSTANCE_ID,
      conversationId: CONV_ID,
      operationId: OPERATION_ID,
      audio: new File([new Uint8Array([1])], 'audio.m4a', { type: 'audio/mp4' }),
    })).rejects.toBeInstanceOf(MetaOutboundAudioSendError)

    mockFetch({ error: 'persist_deadline_insufficient' }, 503)
    await expect(metaWhatsAppApi.sendAudio({
      companyId: COMPANY_ID,
      instanceId: INSTANCE_ID,
      conversationId: CONV_ID,
      operationId: OPERATION_ID,
      audio: new File([new Uint8Array([1])], 'audio.m4a', { type: 'audio/mp4' }),
    })).rejects.toMatchObject({ status: 503, code: 'persist_deadline_insufficient' })

    mockFetch({ ok: false, error: 'operation_unknown' }, 409)
    await expect(metaWhatsAppApi.sendAudio({
      companyId: COMPANY_ID,
      instanceId: INSTANCE_ID,
      conversationId: CONV_ID,
      operationId: OPERATION_ID,
      audio: new File([new Uint8Array([1])], 'audio.m4a', { type: 'audio/mp4' }),
    })).rejects.toMatchObject({ status: 409, code: 'operation_unknown' })

    mockFetch({ error: 'send_persistence_failed' }, 500)
    await expect(metaWhatsAppApi.sendAudio({
      companyId: COMPANY_ID,
      instanceId: INSTANCE_ID,
      conversationId: CONV_ID,
      operationId: OPERATION_ID,
      audio: new File([new Uint8Array([1])], 'audio.m4a', { type: 'audio/mp4' }),
    })).rejects.toMatchObject({ code: 'send_persistence_failed' })
  })

  it('falha de rede vira network_error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('offline'))
    await expect(metaWhatsAppApi.sendAudio({
      companyId: COMPANY_ID,
      instanceId: INSTANCE_ID,
      conversationId: CONV_ID,
      operationId: OPERATION_ID,
      audio: new File([new Uint8Array([1])], 'audio.m4a', { type: 'audio/mp4' }),
    })).rejects.toMatchObject({ status: 0, code: 'network_error' })
  })

  it('operation_id inválido não chama fetch', async () => {
    const spy = vi.spyOn(global, 'fetch')
    await expect(metaWhatsAppApi.sendAudio({
      companyId: COMPANY_ID,
      instanceId: INSTANCE_ID,
      conversationId: CONV_ID,
      operationId: 'not-a-uuid',
      audio: new File([new Uint8Array([1])], 'audio.m4a', { type: 'audio/mp4' }),
    })).rejects.toMatchObject({ code: 'invalid_operation_id' })
    expect(spy).not.toHaveBeenCalled()
  })
})
