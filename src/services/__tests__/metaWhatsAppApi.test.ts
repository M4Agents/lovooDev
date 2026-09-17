// =============================================================================
// src/services/__tests__/metaWhatsAppApi.test.ts
//
// Contrato do service metaWhatsAppApi — foco nos métodos S7:
//   completeOnboarding  → discriminated union CompleteResult
//   resolveWabaSelection → POST /resolve-waba
//
// Cobertura:
//   S1  connected válido
//   S2  selection_required válido
//   S3  continuation_token ausente → rejeitar
//   S4  options vazio → rejeitar
//   S5  option malformado → rejeitar
//   S6  indexes duplicados → rejeitar
//   S7  resolve body EXATO sem company_id
//   S8  resolve valida instance
//   S9  erro backend propagado com segurança
//
// Segurança: nenhum token/code/secret real nos fixtures.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { metaWhatsAppApi }                      from '../metaWhatsAppApi'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'fake-access-token' } },
      }),
    },
  },
}))

// Limpar call counts do fetch spy entre testes
beforeEach(() => {
  vi.clearAllMocks()
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_INSTANCE = {
  id:              'inst-s7-001',
  phone_number_id: '111111111111',
  waba_id:         '222222222222',
  phone_number:    '+55 11 99999-0000',
  verified_name:   'Test WABA',
  status:          'connected' as const,
}

const FAKE_CONTINUATION_TOKEN = 'eyJhbGciOiJBMjU2R0NNIn0.FAKE_TOKEN_FOR_TESTS'

const FAKE_OPTIONS = [
  { index: 0, label: '+55 11 99999-0000', name: 'Test WABA'     },
  { index: 1, label: '+55 11 99999-1111', name: null             },
]

// Helper: criar mock de fetch com body JSON e status
function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok:   status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response)
}

// =============================================================================
// completeOnboarding — discriminated union
// =============================================================================

describe('metaWhatsAppApi.completeOnboarding', () => {

  const PAYLOAD = { state: 'fake-state', code: 'fake-code' }

  // S1 — connected válido ─────────────────────────────────────────────────────
  it('S1: resposta connected → kind=connected com instance', async () => {
    mockFetch({ instance: FAKE_INSTANCE })
    const result = await metaWhatsAppApi.completeOnboarding(PAYLOAD)
    expect(result.kind).toBe('connected')
    if (result.kind === 'connected') {
      expect(result.instance.id).toBe('inst-s7-001')
    }
  })

  // S2 — selection_required válido ────────────────────────────────────────────
  it('S2: selection_required válido → kind=selection com options', async () => {
    mockFetch({
      status:             'selection_required',
      continuation_token: FAKE_CONTINUATION_TOKEN,
      options:            FAKE_OPTIONS,
    })
    const result = await metaWhatsAppApi.completeOnboarding(PAYLOAD)
    expect(result.kind).toBe('selection')
    if (result.kind === 'selection') {
      expect(result.continuation_token).toBe(FAKE_CONTINUATION_TOKEN)
      expect(result.options).toHaveLength(2)
      expect(result.options[0]).toEqual({ index: 0, label: '+55 11 99999-0000', name: 'Test WABA' })
      expect(result.options[1]).toEqual({ index: 1, label: '+55 11 99999-1111', name: null })
    }
  })

  // S3 — continuation_token ausente ───────────────────────────────────────────
  it('S3: continuation_token ausente → rejeitar com "Resposta inválida"', async () => {
    mockFetch({ status: 'selection_required', options: FAKE_OPTIONS })
    await expect(metaWhatsAppApi.completeOnboarding(PAYLOAD))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  it('S3b: continuation_token vazio → rejeitar', async () => {
    mockFetch({ status: 'selection_required', continuation_token: '   ', options: FAKE_OPTIONS })
    await expect(metaWhatsAppApi.completeOnboarding(PAYLOAD))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  // S4 — options vazio ─────────────────────────────────────────────────────────
  it('S4: options array vazio → rejeitar', async () => {
    mockFetch({ status: 'selection_required', continuation_token: FAKE_CONTINUATION_TOKEN, options: [] })
    await expect(metaWhatsAppApi.completeOnboarding(PAYLOAD))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  it('S4b: options ausente → rejeitar', async () => {
    mockFetch({ status: 'selection_required', continuation_token: FAKE_CONTINUATION_TOKEN })
    await expect(metaWhatsAppApi.completeOnboarding(PAYLOAD))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  // S5 — option malformado ─────────────────────────────────────────────────────
  it('S5a: option com index negativo → rejeitar', async () => {
    mockFetch({
      status:             'selection_required',
      continuation_token: FAKE_CONTINUATION_TOKEN,
      options:            [{ index: -1, label: '+55 11 99999-0000', name: null }],
    })
    await expect(metaWhatsAppApi.completeOnboarding(PAYLOAD))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  it('S5b: option com index float → rejeitar', async () => {
    mockFetch({
      status:             'selection_required',
      continuation_token: FAKE_CONTINUATION_TOKEN,
      options:            [{ index: 0.5, label: '+55 11 99999-0000', name: null }],
    })
    await expect(metaWhatsAppApi.completeOnboarding(PAYLOAD))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  it('S5c: option com label vazio → rejeitar', async () => {
    mockFetch({
      status:             'selection_required',
      continuation_token: FAKE_CONTINUATION_TOKEN,
      options:            [{ index: 0, label: '', name: null }],
    })
    await expect(metaWhatsAppApi.completeOnboarding(PAYLOAD))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  it('S5d: option com name não-string não-null → rejeitar', async () => {
    mockFetch({
      status:             'selection_required',
      continuation_token: FAKE_CONTINUATION_TOKEN,
      options:            [{ index: 0, label: '+55 11 99999-0000', name: 42 }],
    })
    await expect(metaWhatsAppApi.completeOnboarding(PAYLOAD))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  // S6 — indexes duplicados ────────────────────────────────────────────────────
  it('S6: indexes duplicados → rejeitar', async () => {
    mockFetch({
      status:             'selection_required',
      continuation_token: FAKE_CONTINUATION_TOKEN,
      options: [
        { index: 0, label: '+55 11 99999-0000', name: null },
        { index: 0, label: '+55 11 99999-1111', name: null },
      ],
    })
    await expect(metaWhatsAppApi.completeOnboarding(PAYLOAD))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  // status desconhecido + sem instance → rejeitar
  it('S-extra: status desconhecido sem instance → rejeitar', async () => {
    mockFetch({ status: 'unknown_status' })
    await expect(metaWhatsAppApi.completeOnboarding(PAYLOAD))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  // Erro HTTP → rejeitar com mensagem do backend
  it('S-http-err: HTTP 400 → rejeitar com erro do backend', async () => {
    mockFetch({ error: 'invalid_state' }, 400)
    await expect(metaWhatsAppApi.completeOnboarding(PAYLOAD))
      .rejects.toThrow('invalid_state')
  })
})

// =============================================================================
// resolveWabaSelection
// =============================================================================

describe('metaWhatsAppApi.resolveWabaSelection', () => {

  // S7 — body EXATO sem company_id ────────────────────────────────────────────
  it('S7: envia body EXATO { continuation_token, selected_index } sem company_id', async () => {
    const fetchSpy = mockFetch({ instance: FAKE_INSTANCE })
    await metaWhatsAppApi.resolveWabaSelection(FAKE_CONTINUATION_TOKEN, 1)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)

    expect(body).toEqual({
      continuation_token: FAKE_CONTINUATION_TOKEN,
      selected_index:     1,
    })
    // Garantir que company_id NÃO foi enviado
    expect(body).not.toHaveProperty('company_id')
  })

  // S8 — valida instance na resposta ──────────────────────────────────────────
  it('S8: resposta válida → retorna instance', async () => {
    mockFetch({ instance: FAKE_INSTANCE })
    const result = await metaWhatsAppApi.resolveWabaSelection(FAKE_CONTINUATION_TOKEN, 0)
    expect(result.id).toBe('inst-s7-001')
    expect(result.phone_number_id).toBe('111111111111')
  })

  it('S8b: resposta sem instance.id → rejeitar', async () => {
    mockFetch({ instance: { phone_number_id: '111' } })
    await expect(metaWhatsAppApi.resolveWabaSelection(FAKE_CONTINUATION_TOKEN, 0))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  it('S8c: resposta sem instance → rejeitar', async () => {
    mockFetch({})
    await expect(metaWhatsAppApi.resolveWabaSelection(FAKE_CONTINUATION_TOKEN, 0))
      .rejects.toThrow('Resposta inválida do servidor')
  })

  // S9 — erro backend propagado ────────────────────────────────────────────────
  it('S9a: HTTP 400 invalid_continuation → rejeitar com código', async () => {
    mockFetch({ error: 'invalid_continuation' }, 400)
    await expect(metaWhatsAppApi.resolveWabaSelection(FAKE_CONTINUATION_TOKEN, 0))
      .rejects.toThrow('invalid_continuation')
  })

  it('S9b: HTTP 409 phone_number_already_connected → rejeitar com código', async () => {
    mockFetch({ error: 'phone_number_already_connected' }, 409)
    await expect(metaWhatsAppApi.resolveWabaSelection(FAKE_CONTINUATION_TOKEN, 0))
      .rejects.toThrow('phone_number_already_connected')
  })

  it('S9c: HTTP 403 forbidden → rejeitar com código', async () => {
    mockFetch({ error: 'forbidden' }, 403)
    await expect(metaWhatsAppApi.resolveWabaSelection(FAKE_CONTINUATION_TOKEN, 0))
      .rejects.toThrow('forbidden')
  })

  it('S9d: HTTP 500 internal_error → rejeitar com código', async () => {
    mockFetch({ error: 'internal_error' }, 500)
    await expect(metaWhatsAppApi.resolveWabaSelection(FAKE_CONTINUATION_TOKEN, 0))
      .rejects.toThrow('internal_error')
  })

  it('S9e: erro de rede (fetch throws) → rejeitar', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Failed to fetch'))
    await expect(metaWhatsAppApi.resolveWabaSelection(FAKE_CONTINUATION_TOKEN, 0))
      .rejects.toThrow('Failed to fetch')
  })
})
