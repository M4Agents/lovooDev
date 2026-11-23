// Contrato HTTP do vínculo e da busca. Não chama o Supabase real.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: 'session-token' } },
      })),
    },
  },
}))

import { metaWhatsAppApi } from './metaWhatsAppApi'

const COMPANY_ID = 'company-test-001'
const CONV_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('metaWhatsAppApi lead link', () => {
  it('busca no endpoint Meta com company_id e q', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        leads: [{ id: 7, name: 'Lead Busca', phone: null, email: null }],
      }),
    } as Response)

    const leads = await metaWhatsAppApi.searchConversationLeads(COMPANY_ID, CONV_ID, 'ana')
    const url = String(vi.mocked(fetch).mock.calls[0][0])

    expect(url).toContain(`/api/whatsapp/meta/conversations/${CONV_ID}/leads/search?`)
    expect(url).toContain(`company_id=${COMPANY_ID}`)
    expect(url).toContain('q=ana')
    expect(leads).toEqual([{ id: 7, name: 'Lead Busca', phone: null, email: null }])
  })

  it('POST envia company_id, lead_id e expected_lead_id e omite actor_user_id', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: 'linked', conversation_id: CONV_ID, lead_id: 7 }),
    } as Response)

    const result = await metaWhatsAppApi.linkConversationLead(COMPANY_ID, CONV_ID, 7, null)
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body))

    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(`/leads/link`)
    expect(init.method).toBe('POST')
    expect(body).toEqual({
      company_id: COMPANY_ID,
      lead_id: 7,
      expected_lead_id: null,
    })
    expect(body).not.toHaveProperty('actor_user_id')
    expect(result).toEqual({ status: 'linked', leadId: 7 })
  })

  it('409, 403, 404 e 500 não viram sucesso e não disparam outro POST', async () => {
    const statuses = [409, 403, 404, 500] as const
    const expected = ['conflict', 'forbidden', 'not_found', 'error'] as const

    for (let index = 0; index < statuses.length; index += 1) {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: statuses[index],
        json: async () => ({ error: 'opaco' }),
      } as Response)
      const result = await metaWhatsAppApi.linkConversationLead(COMPANY_ID, CONV_ID, 7, null)
      expect(result.status).toBe(expected[index])
    }

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(statuses.length)
  })
})
