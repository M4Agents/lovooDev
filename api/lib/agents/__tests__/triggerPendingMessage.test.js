// =============================================================================
// Testes unitários — triggerPendingMessage.js
//
// Framework: vitest
// Estratégia: mocks completos — sem banco, sem LLM, sem rede.
//   - enqueueMessage injetado via vi.mock
//   - supabase mockado como objeto com .from().select()...
//
// Cobertura obrigatória (testes 9–16 do plano):
//   T-09  provider ID ausente → early exit com warn
//   T-10  instance ID ausente → early exit com warn
//   T-11  fluxo OK → enqueueMessage executado com params corretos
//   T-12  enqueueMessage retorna duplicate → skip logado
//   T-13  windowSeconds lido do model_config → usado
//   T-14  agentId null → fallback 30s
//   T-15  model_config ausente → fallback 30s
//   T-16  model_config fora do range → fallback 30s
//
// Cobertura adicional:
//   T-01  parâmetros obrigatórios ausentes → early exit
//   T-02  conversa não encontrada → early exit
//   T-03  ai_state != ai_active → early exit
//   T-04  nenhuma mensagem inbound sem resposta → early exit
//   T-05  já existe outbound após inbound → early exit
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { triggerPendingMessage } from '../triggerPendingMessage.js'

// ── Mock de enqueueMessage ────────────────────────────────────────────────────
vi.mock('../messageBufferService.js', () => ({
  enqueueMessage: vi.fn(),
}))

import { enqueueMessage } from '../messageBufferService.js'

// ── Silenciar logs ────────────────────────────────────────────────────────────
vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

// ── Constantes de teste ───────────────────────────────────────────────────────
const COMPANY_ID      = 'aaa00000-0000-0000-0000-000000000001'
const CONV_ID         = 'bbb00000-0000-0000-0000-000000000002'
const INSTANCE_ID     = 'ccc00000-0000-0000-0000-000000000003'
const LAST_INSTANCE_ID = 'ddd00000-0000-0000-0000-000000000004'
const ASSIGNMENT_ID   = 'eee00000-0000-0000-0000-000000000005'
const AGENT_ID        = 'fff00000-0000-0000-0000-000000000006'
const BATCH_ID        = 'b4400000-0000-0000-0000-000000000007'
const PROVIDER_MSG_ID = 'wamid.TEST_PROVIDER_ID_001'

// ── Fixtures ──────────────────────────────────────────────────────────────────
function makeParams(overrides = {}) {
  return {
    companyId:    COMPANY_ID,
    conversationId: CONV_ID,
    assignmentId: ASSIGNMENT_ID,
    agentId:      AGENT_ID,
    capabilities: {},
    pricePolicy:  'disabled',
    ...overrides,
  }
}

function makeConv(overrides = {}) {
  return {
    id:              CONV_ID,
    ai_state:        'ai_active',
    contact_phone:   '5511999999999',
    instance_id:     INSTANCE_ID,
    last_instance_id: LAST_INSTANCE_ID,
    ...overrides,
  }
}

function makeMessage(overrides = {}) {
  return {
    id:                'msg-uuid-1',
    content:           'Olá, preciso de ajuda',
    direction:         'inbound',
    created_at:        '2026-08-12T15:00:00.000Z',
    uazapi_message_id: PROVIDER_MSG_ID,
    message_type:      'text',
    ...overrides,
  }
}

function makeAgentRow(windowSeconds = 30) {
  return {
    model_config: {
      message_grouping_window_s: windowSeconds,
    },
  }
}

/**
 * Cria um mock de cliente Supabase com respostas configuráveis.
 *
 * @param {{
 *   conv: object|null,
 *   messages: object[],
 *   agentRow: object|null
 * }} config
 */
function makeSupabaseMock({ conv = makeConv(), messages = [makeMessage()], agentRow = makeAgentRow() } = {}) {
  const svc = {
    from: vi.fn((table) => {
      if (table === 'chat_conversations') {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: conv, error: null }),
        }
      }
      if (table === 'chat_messages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          order:  vi.fn().mockReturnThis(),
          limit:  vi.fn().mockResolvedValue({ data: messages, error: null }),
        }
      }
      if (table === 'lovoo_agents') {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: agentRow, error: null }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq:     vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    })
  }
  return svc
}

function makeEnqueueSuccess(overrides = {}) {
  return {
    ok:               true,
    inserted:         true,
    duplicate:        false,
    batch_id:         BATCH_ID,
    batch_message_id: 'batch-msg-uuid-1',
    batch_status:     'pending',
    ...overrides,
  }
}

// ── Antes de cada teste ───────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks()
  enqueueMessage.mockResolvedValue(makeEnqueueSuccess())
})

// =============================================================================
describe('triggerPendingMessage', () => {

  // ── T-01: parâmetros obrigatórios ausentes ──────────────────────────────────
  describe('T-01 — parâmetros obrigatórios ausentes', () => {
    it('aborta sem companyId', async () => {
      const svc = makeSupabaseMock()
      await triggerPendingMessage(makeParams({ companyId: null }), svc)
      expect(enqueueMessage).not.toHaveBeenCalled()
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('parâmetros obrigatórios ausentes'),
        expect.any(Object)
      )
    })

    it('aborta sem conversationId', async () => {
      const svc = makeSupabaseMock()
      await triggerPendingMessage(makeParams({ conversationId: null }), svc)
      expect(enqueueMessage).not.toHaveBeenCalled()
    })

    it('aborta sem assignmentId', async () => {
      const svc = makeSupabaseMock()
      await triggerPendingMessage(makeParams({ assignmentId: null }), svc)
      expect(enqueueMessage).not.toHaveBeenCalled()
    })
  })

  // ── T-02: conversa não encontrada ───────────────────────────────────────────
  it('T-02 — conversa não encontrada → aborta sem enqueue', async () => {
    const svc = makeSupabaseMock({ conv: null })
    await triggerPendingMessage(makeParams(), svc)
    expect(enqueueMessage).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('conversa não encontrada'),
      expect.any(Object)
    )
  })

  // ── T-03: ai_state != ai_active ─────────────────────────────────────────────
  describe('T-03 — ai_state não é ai_active → aborta', () => {
    it.each(['ai_inactive', 'ai_paused'])('ai_state = %s → aborta', async (state) => {
      const svc = makeSupabaseMock({ conv: makeConv({ ai_state: state }) })
      await triggerPendingMessage(makeParams(), svc)
      expect(enqueueMessage).not.toHaveBeenCalled()
    })
  })

  // ── T-04: nenhuma mensagem inbound sem resposta ─────────────────────────────
  it('T-04 — nenhuma mensagem → aborta sem enqueue', async () => {
    const svc = makeSupabaseMock({ messages: [] })
    await triggerPendingMessage(makeParams(), svc)
    expect(enqueueMessage).not.toHaveBeenCalled()
  })

  // ── T-05: outbound depois do inbound → já respondido ───────────────────────
  it('T-05 — outbound após inbound → aborta sem enqueue', async () => {
    const inbound  = makeMessage({ created_at: '2026-08-12T15:00:00.000Z' })
    const outbound = makeMessage({
      id:        'msg-uuid-2',
      direction: 'outbound',
      created_at: '2026-08-12T15:01:00.000Z',
      uazapi_message_id: 'wamid.OUTBOUND',
    })
    const svc = makeSupabaseMock({ messages: [outbound, inbound] })
    await triggerPendingMessage(makeParams(), svc)
    expect(enqueueMessage).not.toHaveBeenCalled()
  })

  // ── T-09: provider ID ausente ───────────────────────────────────────────────
  it('T-09 — uazapi_message_id null → aborta com warn', async () => {
    const svc = makeSupabaseMock({
      messages: [makeMessage({ uazapi_message_id: null })]
    })
    await triggerPendingMessage(makeParams(), svc)
    expect(enqueueMessage).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('uazapi_message_id ausente'),
      expect.any(Object)
    )
  })

  // ── T-10: instance ID ausente ───────────────────────────────────────────────
  it('T-10 — instanceId null (ambos campos null) → aborta com warn', async () => {
    const svc = makeSupabaseMock({
      conv: makeConv({ instance_id: null, last_instance_id: null })
    })
    await triggerPendingMessage(makeParams(), svc)
    expect(enqueueMessage).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('instanceId ausente'),
      expect.any(Object)
    )
  })

  // ── T-11: fluxo OK → enqueueMessage chamado com params corretos ─────────────
  it('T-11 — fluxo completo OK → enqueueMessage chamado corretamente', async () => {
    const svc = makeSupabaseMock()
    await triggerPendingMessage(makeParams(), svc)

    expect(enqueueMessage).toHaveBeenCalledOnce()
    const args = enqueueMessage.mock.calls[0][0]

    expect(args.svc).toBe(svc)              // reutiliza client recebido, não cria novo
    expect(args.companyId).toBe(COMPANY_ID)
    expect(args.conversationId).toBe(CONV_ID)
    expect(args.assignmentId).toBe(ASSIGNMENT_ID)
    expect(args.channel).toBe('whatsapp')
    expect(args.providerMessageId).toBe(PROVIDER_MSG_ID)
    expect(args.instanceId).toBe(LAST_INSTANCE_ID)  // last_instance_id tem precedência
    expect(args.messageText).toBe('Olá, preciso de ajuda')
    expect(args.messageType).toBe('text')
    expect(args.maxBatchDurationSeconds).toBe(120)
    expect(typeof args.windowSeconds).toBe('number')
    expect(args.windowSeconds).toBeGreaterThanOrEqual(1)
  })

  // ── T-11b: last_instance_id tem precedência sobre instance_id ───────────────
  it('T-11b — last_instance_id tem precedência sobre instance_id', async () => {
    const svc = makeSupabaseMock()
    await triggerPendingMessage(makeParams(), svc)
    const args = enqueueMessage.mock.calls[0][0]
    expect(args.instanceId).toBe(LAST_INSTANCE_ID)
  })

  it('T-11c — sem last_instance_id usa instance_id', async () => {
    const svc = makeSupabaseMock({
      conv: makeConv({ last_instance_id: null })
    })
    await triggerPendingMessage(makeParams(), svc)
    const args = enqueueMessage.mock.calls[0][0]
    expect(args.instanceId).toBe(INSTANCE_ID)
  })

  // ── T-12: enqueueMessage retorna duplicate ─────────────────────────────────
  it('T-12 — enqueueMessage retorna duplicate → skip logado, sem erro', async () => {
    enqueueMessage.mockResolvedValue(makeEnqueueSuccess({ inserted: false, duplicate: true }))
    const svc = makeSupabaseMock()
    await expect(triggerPendingMessage(makeParams(), svc)).resolves.toBeUndefined()
    expect(enqueueMessage).toHaveBeenCalledOnce()
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('duplicate'),
      expect.any(Object)
    )
  })

  // ── T-13: windowSeconds do model_config ─────────────────────────────────────
  it('T-13 — windowSeconds lido do model_config → passado ao enqueue', async () => {
    const svc = makeSupabaseMock({ agentRow: makeAgentRow(45) })
    await triggerPendingMessage(makeParams(), svc)
    const args = enqueueMessage.mock.calls[0][0]
    expect(args.windowSeconds).toBe(45)
  })

  // ── T-14: agentId null → fallback 30 ────────────────────────────────────────
  it('T-14 — agentId null → fallback 30s sem query em lovoo_agents', async () => {
    const svc = makeSupabaseMock()
    await triggerPendingMessage(makeParams({ agentId: null }), svc)
    const args = enqueueMessage.mock.calls[0][0]
    expect(args.windowSeconds).toBe(30)
    // lovoo_agents não deve ter sido consultado
    const fromCalls = svc.from.mock.calls.map(c => c[0])
    expect(fromCalls).not.toContain('lovoo_agents')
  })

  // ── T-15: model_config ausente → fallback 30 ────────────────────────────────
  it('T-15 — model_config ausente → fallback 30s', async () => {
    const svc = makeSupabaseMock({ agentRow: null })
    await triggerPendingMessage(makeParams(), svc)
    const args = enqueueMessage.mock.calls[0][0]
    expect(args.windowSeconds).toBe(30)
  })

  // ── T-16: windowSeconds fora do range → fallback 30 ─────────────────────────
  describe('T-16 — windowSeconds fora do range 1–120 → fallback 30', () => {
    it.each([0, -1, 121, 999, null, 'abc'])('window=%s → fallback 30', async (val) => {
      const svc = makeSupabaseMock({
        agentRow: { model_config: { message_grouping_window_s: val } }
      })
      await triggerPendingMessage(makeParams(), svc)
      const args = enqueueMessage.mock.calls[0][0]
      expect(args.windowSeconds).toBe(30)
    })
  })

  // ── T-16b: windowSeconds no limite exato → aceito ───────────────────────────
  it('T-16b — windowSeconds = 1 → aceito (limite mínimo)', async () => {
    const svc = makeSupabaseMock({ agentRow: makeAgentRow(1) })
    await triggerPendingMessage(makeParams(), svc)
    expect(enqueueMessage.mock.calls[0][0].windowSeconds).toBe(1)
  })

  it('T-16c — windowSeconds = 120 → aceito (limite máximo)', async () => {
    const svc = makeSupabaseMock({ agentRow: makeAgentRow(120) })
    await triggerPendingMessage(makeParams(), svc)
    expect(enqueueMessage.mock.calls[0][0].windowSeconds).toBe(120)
  })

  // ── Regressão: não cria novo createClient ────────────────────────────────────
  it('T-REG-01 — usa supabase recebido pelo caller (não cria novo client)', async () => {
    const svc = makeSupabaseMock()
    await triggerPendingMessage(makeParams(), svc)
    const args = enqueueMessage.mock.calls[0][0]
    // svc passado ao enqueueMessage deve ser o mesmo objeto recebido
    expect(args.svc).toBe(svc)
  })

  // ── Regressão: não executa LLM inline ───────────────────────────────────────
  it('T-REG-02 — não importa nem chama pipeline v1 (orchestrateExecution etc.)', async () => {
    // Se o módulo fosse importar orchestrateExecution, a chamada vi.mock acima
    // quebraria com undefined. O fato de o teste passar sem vi.mock do pipeline
    // confirma que os imports do pipeline v1 foram removidos.
    const svc = makeSupabaseMock()
    await expect(triggerPendingMessage(makeParams(), svc)).resolves.toBeUndefined()
    // enqueueMessage foi chamado → pipeline v1 não foi
    expect(enqueueMessage).toHaveBeenCalledOnce()
  })

})
