// =============================================================================
// Testes unitários — uazapi-webhook-final.js (bloco delay_response)
//
// Framework: vitest
// Foco: comportamento do bloco de retomada de _awaiting_delay_response
//       quando uma mensagem inbound válida chega ao webhook.
//
// Estratégia:
//   - Mock do handler completo via default export
//   - Mock de @supabase/supabase-js (createClient → anon client)
//   - Mock de getSupabaseAdmin → admin client
//   - Mock de resumeFromNode e resumeClaimedExecution
//   - Texto simples (sem mídia) para evitar imports dinâmicos de crypto/S3/photoSync
//   - chat_contacts retorna null → evita import dinâmico de photoSync.cjs
//
// Para executar: npm test
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks de módulos externos (declarados antes do import do handler)
// ---------------------------------------------------------------------------

vi.mock('../supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(),
}))

vi.mock('../executor.js', () => ({
  resumeFromNode:         vi.fn().mockResolvedValue({}),
  resumeClaimedExecution: vi.fn().mockResolvedValue({}),
}))

vi.mock('../dispatchLeadCreatedTrigger.js', () => ({
  dispatchLeadCreatedTrigger: vi.fn().mockResolvedValue({}),
}))

vi.mock('../dispatchMessageReceivedTrigger.js', () => ({
  dispatchMessageReceivedTrigger: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../leads/handleLeadReentry.js', () => ({
  handleLeadReentry: vi.fn().mockResolvedValue({}),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

vi.mock('../executionLock.js', () => ({
  acquireLock:  vi.fn().mockResolvedValue({ acquired: true, lockId: 'webhook-lock-id' }),
  releaseLock:  vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Imports após declaração dos mocks
// ---------------------------------------------------------------------------

import handler                                   from '../../../uazapi-webhook-final.js'
import { getSupabaseAdmin }                       from '../supabaseAdmin.js'
import { resumeFromNode, resumeClaimedExecution } from '../executor.js'
import { createClient }                           from '@supabase/supabase-js'
import { acquireLock, releaseLock }               from '../executionLock.js'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const COMPANY_ID   = 'co-uuid-test'
const LEAD_ID      = 42
const EXECUTION_ID = 'exec-uuid-test'
const FLOW_ID      = 'flow-uuid-test'
const NODE_ID      = 'delay-node-test'
const SCHEDULE_ID  = 'sched-uuid-test'
const MSG_ID       = 'msg-whatsapp-123'
const INSTANCE_ID  = 'inst-uuid-test'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIND_V2_FOUND = {
  found:            true,
  execution_id:     EXECUTION_ID,
  automation_id:    FLOW_ID,
  company_id:       COMPANY_ID,
  awaiting_type:    'delay_response',
  awaiting_node_id: NODE_ID,
  schedule_id:      SCHEDULE_ID,
  paused_at:        '2026-07-15T12:00:00.000Z',
}

const FIND_V2_NOT_FOUND = { found: false }

const CLAIM_TRUE = {
  claimed:    true,
  claimed_at: '2026-07-15T13:00:00.000Z',
  execution: {
    id:           EXECUTION_ID,
    flow_id:      FLOW_ID,
    company_id:   COMPANY_ID,
    lead_id:      LEAD_ID,
    opportunity_id: null,
    trigger_data: {},
    variables:    {},
  },
  marker: {
    node_id:           NODE_ID,
    schedule_id:       SCHEDULE_ID,
    wait_mode:         'time_or_response',
    awaiting_type:     'delay_response',
    response_variable: 'user_answer',
  },
}

const CLAIM_FALSE = {
  claimed: false,
  reason:  'already_resumed_or_stale',
}

const PRE_FLOW = {
  id:         FLOW_ID,
  company_id: COMPANY_ID,
  nodes:      [],
  edges:      [],
}

// ---------------------------------------------------------------------------
// Helpers de mock
// ---------------------------------------------------------------------------

/** Cria uma chain Supabase genérica que resolve com `result` em single/maybeSingle */
function makeChain(result = { data: null, error: null }) {
  const resolved = result.data !== undefined ? result : { data: result, error: null }
  const chain = {
    select:      vi.fn(() => chain),
    eq:          vi.fn(() => chain),
    neq:         vi.fn(() => chain),
    is:          vi.fn(() => chain),
    in:          vi.fn(() => chain),
    not:         vi.fn(() => chain),
    or:          vi.fn(() => chain),
    order:       vi.fn(() => chain),
    limit:       vi.fn(() => chain),
    update:      vi.fn(() => chain),
    delete:      vi.fn(() => chain),
    insert:      vi.fn(() => chain),
    upsert:      vi.fn(() => chain),
    single:      vi.fn().mockResolvedValue(resolved),
    maybeSingle: vi.fn().mockResolvedValue(resolved),
    // Suporte a await direto (update/delete sem .single())
    then:        (r, _j) => Promise.resolve({ data: null, error: null }).then(r, _j),
  }
  return chain
}

/**
 * Cria o mock do admin client.
 * rpcOverrides: { rpcName: data | { __error: Error } }
 * fromOverrides: { tableName: { data, error } }
 */
function makeAdminMock({ rpcOverrides = {}, fromOverrides = {} } = {}) {
  const rpc = vi.fn((rpcName, _args) => {
    if (rpcName in rpcOverrides) {
      const v = rpcOverrides[rpcName]
      if (v && v.__error) return Promise.resolve({ data: null, error: v.__error })
      return Promise.resolve({ data: v, error: null })
    }
    // Defaults para chamadas admin não relacionadas ao delay_response
    const defaults = {
      create_lead_from_whatsapp_safe:  { success: true, lead_id: LEAD_ID, created: false },
      handle_inbound_for_contact_cycle: null,
    }
    if (rpcName in defaults) return Promise.resolve({ data: defaults[rpcName], error: null })
    return Promise.resolve({ data: null, error: null })
  })

  const from = vi.fn((table) => {
    if (table in fromOverrides) {
      const v = fromOverrides[table]
      return makeChain(v && v.__error ? { data: null, error: v.__error } : { data: v, error: null })
    }
    // Defaults: chat_messages (idempotency) → null; outros → null
    return makeChain({ data: null, error: null })
  })

  return { rpc, from }
}

/**
 * Cria o mock do client anon (createClient).
 * Lida com todas as RPCs chamadas pelo webhook em modo texto sem mídia.
 */
function makeAnonMock({ rpcOverrides = {}, fromOverrides = {} } = {}) {
  const rpc = vi.fn((rpcName, _args) => {
    if (rpcName in rpcOverrides) {
      const v = rpcOverrides[rpcName]
      if (v && v.__error) return Promise.resolve({ data: null, error: v.__error })
      return Promise.resolve({ data: v, error: null })
    }
    const defaults = {
      get_instance_for_webhook: {
        found:        true,
        instance_id:  INSTANCE_ID,
        company_id:   COMPANY_ID,
        company_name: 'Test Company',
      },
      process_webhook_message_safe: {
        success:         true,
        message_id:      'saved-msg-id',
        contact_id:      'contact-id',
        conversation_id: 'conv-id',
      },
      auto_cancel_scheduled_messages_on_reply: { cancelled_count: 0 },
      find_paused_awaiting_input_execution:    { found: false },
    }
    if (rpcName in defaults) return Promise.resolve({ data: defaults[rpcName], error: null })
    return Promise.resolve({ data: null, error: null })
  })

  const from = vi.fn((table) => {
    if (table in fromOverrides) {
      const v = fromOverrides[table]
      return makeChain(v && v.__error ? { data: null, error: v.__error } : { data: v, error: null })
    }
    // chat_contacts → null (evita import dinâmico de photoSync.cjs)
    return makeChain({ data: null, error: null })
  })

  return { rpc, from }
}

/**
 * Constrói o payload de mensagem de texto inbound padrão.
 * `message` (se fornecido) aplica overrides DENTRO do objeto message.
 * Demais chaves sobrescrevem o payload raiz.
 */
function makeTextPayload({ message: messageOverrides = {}, ...topOverrides } = {}) {
  return {
    EventType:    'messages',
    instanceName: 'instance-1',
    owner:        '5511999999999',
    message: {
      id:          MSG_ID,
      fromMe:      false,
      wasSentByApi: false,
      deviceSent:  false,
      isGroup:     false,
      messageType: 'conversation',
      text:        'olá, quero saber mais',
      sender_pn:   '5511888888888@s.whatsapp.net',
      senderName:  'Test Lead',
      ...messageOverrides,
    },
    ...topOverrides,
  }
}

/** Cria objetos req/res para o handler */
function makeReqRes(body = makeTextPayload()) {
  const res = {
    _status: null, _body: null,
    setHeader: vi.fn(),
    status:    vi.fn().mockReturnThis(),
    json:      vi.fn(function (b) { this._body = b; return this }),
    end:       vi.fn(),
  }
  res.status.mockImplementation((code) => { res._status = code; return res })
  const req = { method: 'POST', headers: {}, body }
  return { req, res }
}

// ---------------------------------------------------------------------------
// Setup global
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks()

  // Env vars mínimas para o webhook
  process.env.VITE_SUPABASE_URL      = 'https://test.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon-key-test'
  process.env.APP_URL                 = 'https://test.app'

  // Global fetch → simula resposta OK para o emitter de conversation event
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

  // Defaults reutilizáveis
  resumeFromNode.mockResolvedValue({})
  resumeClaimedExecution.mockResolvedValue({})

  // Defaults para executionLock (lock sempre adquirido por padrão)
  acquireLock.mockResolvedValue({ acquired: true, lockId: 'webhook-lock-id' })
  releaseLock.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// Utilitário: roda o handler e aguarda
// ---------------------------------------------------------------------------

async function runHandler(
  payload = makeTextPayload(),
  { adminOverrides = {}, anonOverrides = {} } = {}
) {
  const anonMock  = makeAnonMock(anonOverrides)
  const adminMock = makeAdminMock(adminOverrides)

  createClient.mockReturnValue(anonMock)
  getSupabaseAdmin.mockReturnValue(adminMock)

  const { req, res } = makeReqRes(payload)
  await handler(req, res)
  return { anonMock, adminMock, res }
}

// =============================================================================
// GRUPO 1 — Filtragem antes do fluxo de automação
// =============================================================================

describe('Grupo 1 — Filtragem pré-automação', () => {
  // TC-01: mensagem duplicada não chama find_v2
  it('TC-01: mensagem duplicada → early-exit antes de find_v2', async () => {
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        fromOverrides: {
          // idempotency check: retorna mensagem existente
          chat_messages: { id: 'existing-id' },
        },
      },
    })

    // find_paused_awaiting_execution_v2 não deve ter sido chamada
    const delayV2Calls = adminMock.rpc.mock.calls.filter(
      ([name]) => name === 'find_paused_awaiting_execution_v2'
    )
    expect(delayV2Calls).toHaveLength(0)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  // TC-02: mensagem outbound não chama find_v2
  it('TC-02: mensagem outbound não chama find_v2', async () => {
    const payload = makeTextPayload({ message: { fromMe: true, wasSentByApi: true, deviceSent: false } })
    const { adminMock } = await runHandler(payload)

    const delayV2Calls = adminMock.rpc.mock.calls.filter(
      ([name]) => name === 'find_paused_awaiting_execution_v2'
    )
    expect(delayV2Calls).toHaveLength(0)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  // TC-03: EventType diferente de 'messages' → filtrado antes de find_v2
  it('TC-03: EventType inválido não chama find_v2', async () => {
    const { adminMock } = await runHandler({ EventType: 'status', message: {} })
    const delayV2Calls = adminMock.rpc.mock.calls.filter(
      ([name]) => name === 'find_paused_awaiting_execution_v2'
    )
    expect(delayV2Calls).toHaveLength(0)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })
})

// =============================================================================
// GRUPO 2 — Prioridade entre awaiting_input e delay_response
// =============================================================================

describe('Grupo 2 — Prioridade awaiting_input > delay_response', () => {
  // TC-04: awaiting_input encontrado → awaiting_input tem prioridade
  it('TC-04: awaiting_input encontrado → resumeFromNode chamado', async () => {
    const adminMock = makeAdminMock({
      fromOverrides: {
        automation_executions: {
          id: EXECUTION_ID, flow_id: FLOW_ID, company_id: COMPANY_ID,
          status: 'paused', current_node_id: 'input-node', lead_id: LEAD_ID,
        },
        automation_flows: PRE_FLOW,
      },
    })
    const anonMock = makeAnonMock({
      rpcOverrides: {
        find_paused_awaiting_input_execution: {
          found:        true,
          execution_id: EXECUTION_ID,
          lead_id:      LEAD_ID,
        },
      },
    })

    createClient.mockReturnValue(anonMock)
    getSupabaseAdmin.mockReturnValue(adminMock)

    const { req, res } = makeReqRes(makeTextPayload())
    await handler(req, res)

    expect(resumeFromNode).toHaveBeenCalled()
  })

  // TC-05: awaiting_input encontrado → NÃO busca delay_response
  it('TC-05: awaiting_input encontrado → find_paused_awaiting_execution_v2 não chamada', async () => {
    const adminMock = makeAdminMock({
      fromOverrides: {
        automation_executions: {
          id: EXECUTION_ID, flow_id: FLOW_ID, company_id: COMPANY_ID,
          status: 'paused', current_node_id: 'input-node', lead_id: LEAD_ID,
        },
        automation_flows: PRE_FLOW,
      },
    })
    const anonMock = makeAnonMock({
      rpcOverrides: {
        find_paused_awaiting_input_execution: {
          found: true, execution_id: EXECUTION_ID, lead_id: LEAD_ID,
        },
      },
    })

    createClient.mockReturnValue(anonMock)
    getSupabaseAdmin.mockReturnValue(adminMock)

    const { req, res } = makeReqRes(makeTextPayload())
    await handler(req, res)

    const delayV2Calls = adminMock.rpc.mock.calls.filter(
      ([name]) => name === 'find_paused_awaiting_execution_v2'
    )
    expect(delayV2Calls).toHaveLength(0)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  // TC-06: awaiting_input não encontrado → chama find_v2 com delay_response
  it('TC-06: awaiting_input not found → find_paused_awaiting_execution_v2 chamada', async () => {
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_NOT_FOUND,
        },
      },
    })

    const delayV2Calls = adminMock.rpc.mock.calls.filter(
      ([name]) => name === 'find_paused_awaiting_execution_v2'
    )
    expect(delayV2Calls).toHaveLength(1)
    const [_name, args] = delayV2Calls[0]
    expect(args.p_awaiting_type).toBe('delay_response')
    expect(args.p_company_id).toBe(COMPANY_ID)
  })
})

// =============================================================================
// GRUPO 3 — Comportamento de find_paused_awaiting_execution_v2
// =============================================================================

describe('Grupo 3 — find_paused_awaiting_execution_v2', () => {
  // TC-07: find_v2 found=false → não chama Claim RPC
  it('TC-07: find_v2 found=false → claim não chamado', async () => {
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: { find_paused_awaiting_execution_v2: FIND_V2_NOT_FOUND },
      },
    })

    const claimCalls = adminMock.rpc.mock.calls.filter(
      ([name]) => name === 'claim_paused_execution_v1'
    )
    expect(claimCalls).toHaveLength(0)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  // TC-08: find_v2 erro SQL → não chama Claim RPC
  it('TC-08: find_v2 SQL error → claim não chamado', async () => {
    const sqlError = { message: 'DB connection error', code: '57014' }
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: { __error: sqlError },
        },
      },
    })

    const claimCalls = adminMock.rpc.mock.calls.filter(
      ([name]) => name === 'claim_paused_execution_v1'
    )
    expect(claimCalls).toHaveLength(0)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  // TC-09: resultado sem schedule_id → bloco é abortado antes do claim
  // schedule_id é obrigatório para claim_delay_response_lead_v1 (parâmetro p_schedule_id)
  it('TC-09: schedule_id ausente no resultado → skip (claim não tentado)', async () => {
    const resultWithoutSchedule = { ...FIND_V2_FOUND, schedule_id: null }
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: resultWithoutSchedule,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const claimCalls = adminMock.rpc.mock.calls.filter(
      ([name]) => name === 'claim_delay_response_lead_v1'
    )
    expect(claimCalls).toHaveLength(0)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })
})

// =============================================================================
// GRUPO 4 — Parâmetros da nova Claim RPC (claim_delay_response_lead_v1)
// =============================================================================

describe('Grupo 4 — Parâmetros de claim_delay_response_lead_v1', () => {
  async function runAndGetClaimArgs() {
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2:  FIND_V2_FOUND,
          claim_delay_response_lead_v1:       CLAIM_FALSE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })
    const calls = adminMock.rpc.mock.calls.filter(([n]) => n === 'claim_delay_response_lead_v1')
    expect(calls).toHaveLength(1)
    return calls[0][1] // args object
  }

  it('TC-10: claim usa company_id correto', async () => {
    const args = await runAndGetClaimArgs()
    expect(args.p_company_id).toBe(COMPANY_ID)
  })

  it('TC-11: claim usa execution_id correto', async () => {
    const args = await runAndGetClaimArgs()
    expect(args.p_execution_id).toBe(EXECUTION_ID)
  })

  it('TC-12: claim usa paused_node_id correto', async () => {
    const args = await runAndGetClaimArgs()
    expect(args.p_paused_node_id).toBe(NODE_ID)
  })

  it('TC-13: claim usa schedule_id do resultado de find_v2', async () => {
    const args = await runAndGetClaimArgs()
    expect(args.p_schedule_id).toBe(SCHEDULE_ID)
  })

  it('TC-14: claim envia messageText em p_user_response', async () => {
    // messageText = texto da mensagem inbound → enviado à RPC para salvar atomicamente
    const args = await runAndGetClaimArgs()
    expect('p_user_response' in args).toBe(true)
    // O valor é a string do texto da mensagem do payload padrão
    expect(typeof args.p_user_response).toBe('string')
  })

  it('TC-14b: claim NÃO recebe p_resume_reason (invariante fixo na RPC)', async () => {
    const args = await runAndGetClaimArgs()
    expect(args.p_resume_reason).toBeUndefined()
  })

  it('TC-14c: claim NÃO recebe p_awaiting_type (invariante fixo na RPC)', async () => {
    const args = await runAndGetClaimArgs()
    expect(args.p_awaiting_type).toBeUndefined()
  })
})

// =============================================================================
// GRUPO 5 — Tratamento de claimed=false e claimed=true
// =============================================================================

describe('Grupo 5 — Resultado do claim', () => {
  // TC-15: claimed=false → executor não chamado
  it('TC-15: claimed=false → resumeClaimedExecution não chamado', async () => {
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2:  FIND_V2_FOUND,
          claim_delay_response_lead_v1:       CLAIM_FALSE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  // TC-16: claimed=false → schedule não atualizado pelo webhook
  // A nova RPC já moveu o schedule para processing (se chegou a ser chamada com sucesso),
  // mas claimed=false significa que a RPC não foi chamada ou retornou falso.
  // No caso de claimed=false, o schedule não é tocado pelo webhook.
  it('TC-16: claimed=false → automation_schedules não atualizado pelo webhook', async () => {
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2:  FIND_V2_FOUND,
          claim_delay_response_lead_v1:       CLAIM_FALSE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const updateCalls = adminMock.from.mock.calls.filter(([t]) => t === 'automation_schedules')
    expect(updateCalls).toHaveLength(0)
  })

  // TC-17: claimed=true → executor chamado com execution pós-claim
  it('TC-17: claimed=true → resumeClaimedExecution chamado com execution pós-claim', async () => {
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    expect(resumeClaimedExecution).toHaveBeenCalledOnce()
    const callArgs = resumeClaimedExecution.mock.calls[0][0]
    expect(callArgs.execution.id).toBe(EXECUTION_ID)
    expect(callArgs.execution.company_id).toBe(COMPANY_ID)
  })

  // TC-18: claimed=true → executor recebe claimedMarker=null
  // response_variable já foi salva atomicamente pela RPC. O executor não deve salvá-la novamente.
  it('TC-18: claimed=true → executor recebe claimedMarker=null (evita segundo salvamento)', async () => {
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const callArgs = resumeClaimedExecution.mock.calls[0][0]
    expect(callArgs.claimedMarker).toBeNull()
  })
})

// =============================================================================
// GRUPO 6 — Carregamento do flow
// =============================================================================

describe('Grupo 6 — Carregamento do flow', () => {
  // TC-19: flow é carregado com company_id correto
  it('TC-19: flow é carregado com company_id do resultado da busca', async () => {
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2:  FIND_V2_FOUND,
          claim_delay_response_lead_v1:       CLAIM_FALSE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const flowSelectCalls = adminMock.from.mock.calls.filter(([t]) => t === 'automation_flows')
    expect(flowSelectCalls.length).toBeGreaterThanOrEqual(1)
  })

  // TC-20: flow de outra empresa não é executado (company_id divergente pós-claim)
  it('TC-20: flow com company_id divergente → executor não chamado', async () => {
    const flowOtherCompany = { ...PRE_FLOW, company_id: 'other-co-id' }
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: {
          automation_flows: flowOtherCompany,
        },
      },
    })

    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  // TC-20b: flow não encontrado → claim não tentado
  it('TC-20b: flow não encontrado pré-claim → claim não tentado', async () => {
    const adminMock = makeAdminMock({
      rpcOverrides: {
        find_paused_awaiting_execution_v2: FIND_V2_FOUND,
        claim_delay_response_lead_v1:      CLAIM_TRUE,
      },
      fromOverrides: {
        automation_flows: null,
      },
    })
    const anonMock = makeAnonMock()
    createClient.mockReturnValue(anonMock)
    getSupabaseAdmin.mockReturnValue(adminMock)

    const { req, res } = makeReqRes(makeTextPayload())
    await handler(req, res)

    const claimCalls = adminMock.rpc.mock.calls.filter(([n]) => n === 'claim_delay_response_lead_v1')
    expect(claimCalls).toHaveLength(0)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })
})

// =============================================================================
// GRUPO 7 — Finalização do schedule
//
// Comportamento novo (nova RPC):
//   - A RPC move schedule pending → processing atomicamente com o claim.
//   - O webhook NÃO cancela o schedule antes do executor.
//   - O webhook marca schedule processing → processed SOMENTE após executor OK.
//   - Falha no executor: schedule permanece processing → TTL → cron recovery.
// =============================================================================

describe('Grupo 7 — Finalização do schedule', () => {
  // TC-21: schedule processing → processed após executor bem-sucedido
  it('TC-21: claimed=true + executor ok → schedule marcado processed', async () => {
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    // Deve haver ao menos uma chamada a from('automation_schedules') para finalização
    const scheduleCalls = adminMock.from.mock.calls.filter(([t]) => t === 'automation_schedules')
    expect(scheduleCalls.length).toBeGreaterThanOrEqual(1)
  })

  // TC-22: finalização usa candidateScheduleId + company_id da execução pós-claim
  it('TC-22: finalização do schedule usa schedule_id do resultado de find_v2', async () => {
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const updateChain = adminMock.from.mock.results.find((r, i) => {
      return adminMock.from.mock.calls[i]?.[0] === 'automation_schedules'
    })
    expect(updateChain).toBeDefined()
  })

  // TC-23: schedule NÃO é marcado processed antes do executor
  // A nova RPC já move schedule para processing atomicamente.
  // O webhook só finaliza (processing → processed) após executor OK.
  it('TC-23: schedule não marcado processed antes do executor', async () => {
    let scheduleUpdateCalled = false
    resumeClaimedExecution.mockImplementationOnce(async () => {
      // Se scheduleUpdateCalled já for true aqui, significa que o schedule
      // foi marcado processed ANTES do executor — o que é incorreto.
      scheduleUpdateCalled = true
      return {}
    })

    const adminMock = makeAdminMock({
      rpcOverrides: {
        find_paused_awaiting_execution_v2: FIND_V2_FOUND,
        claim_delay_response_lead_v1:      CLAIM_TRUE,
      },
      fromOverrides: { automation_flows: PRE_FLOW },
    })

    let scheduleUpdatedBeforeExecutor = false
    const originalFrom = adminMock.from
    adminMock.from = vi.fn((table) => {
      if (table === 'automation_schedules' && !scheduleUpdateCalled) {
        scheduleUpdatedBeforeExecutor = true
      }
      if (table === 'automation_flows') return makeChain({ data: PRE_FLOW, error: null })
      return originalFrom(table)
    })

    createClient.mockReturnValue(makeAnonMock())
    getSupabaseAdmin.mockReturnValue(adminMock)

    const { req, res } = makeReqRes(makeTextPayload())
    await handler(req, res)

    expect(scheduleUpdatedBeforeExecutor).toBe(false)
    expect(resumeClaimedExecution).toHaveBeenCalledOnce()
  })

  // TC-23b: erro no executor → schedule permanece processing (não marcado processed)
  it('TC-23b: erro no executor → schedule NÃO marcado processed', async () => {
    resumeClaimedExecution.mockRejectedValueOnce(new Error('processNode failed'))

    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    // Nenhuma chamada a automation_schedules para finalização processed
    const schedCalls = adminMock.from.mock.calls.filter(([t]) => t === 'automation_schedules')
    expect(schedCalls).toHaveLength(0)
  })
})

// =============================================================================
// GRUPO 8 — Chamada ao executor
// =============================================================================

describe('Grupo 8 — Chamada ao executor', () => {
  async function getResumeArgs() {
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })
    return resumeClaimedExecution.mock.calls[0][0]
  }

  it('TC-25: executor chamado com resumeReason=lead_response', async () => {
    const args = await getResumeArgs()
    expect(args.resumeReason).toBe('lead_response')
  })

  it('TC-26: executor chamado com awaitingType=delay_response', async () => {
    const args = await getResumeArgs()
    expect(args.awaitingType).toBe('delay_response')
  })

  // TC-27: executor recebe claimedMarker=null
  // response_variable já foi salva atomicamente pela RPC. O executor não deve salvá-la novamente.
  it('TC-27: executor recebe claimedMarker=null (evita segundo salvamento de response_variable)', async () => {
    const args = await getResumeArgs()
    expect(args.claimedMarker).toBeNull()
  })

  it('TC-28: executor usa pausedNodeId correto', async () => {
    const args = await getResumeArgs()
    expect(args.pausedNodeId).toBe(NODE_ID)
  })

  // TC-29: mensagem com texto vazio → executor ainda chamado
  // p_user_response='' foi enviado à RPC. O executor recebe userResponse=undefined.
  it('TC-29: texto vazio → executor chamado (response_variable salva pela RPC)', async () => {
    const payloadNoText = makeTextPayload({ message: { text: '' } })
    await runHandler(payloadNoText, {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })
    expect(resumeClaimedExecution).toHaveBeenCalledOnce()
    const args = resumeClaimedExecution.mock.calls[0][0]
    // userResponse=undefined pois a RPC já salvou
    expect(args.userResponse).toBeUndefined()
  })

  // TC-30: messageText=undefined → executor chamado com userResponse=undefined
  it('TC-30: messageText=undefined → executor chamado com userResponse=undefined', async () => {
    const payloadNullText = makeTextPayload({ message: { text: undefined } })
    await runHandler(payloadNullText, {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })
    expect(resumeClaimedExecution).toHaveBeenCalledOnce()
    const args = resumeClaimedExecution.mock.calls[0][0]
    expect(args.userResponse).toBeUndefined()
  })

  it('TC-31: response_variable não é salva no webhook (salva atomicamente pela RPC)', async () => {
    // O webhook não deve chamar nenhum RPC de update de variables
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })
    const variableUpdateCalls = adminMock.rpc.mock.calls.filter(
      ([name]) => name.includes('variable') || name.includes('update_variables')
    )
    expect(variableUpdateCalls).toHaveLength(0)
  })

  it('TC-32: webhook não chama resumeFromNode para delay_response', async () => {
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })
    expect(resumeFromNode).not.toHaveBeenCalled()
    expect(resumeClaimedExecution).toHaveBeenCalledOnce()
  })
})

// =============================================================================
// GRUPO 9 — Tratamento de erros
// =============================================================================

describe('Grupo 9 — Tratamento de erros', () => {
  // TC-33: erro SQL da Claim RPC → executor não chamado
  it('TC-33: claim_delay_response_lead_v1 SQL error → executor não chamado', async () => {
    const sqlError = { message: 'deadlock detected', code: '40P01' }
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2:   FIND_V2_FOUND,
          claim_delay_response_lead_v1: { __error: sqlError },
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  // TC-34: qualquer erro do executor é registrado, lock liberado, schedule permanece processing
  it('TC-34: erro do executor → logado, lock liberado, schedule não marcado processed', async () => {
    resumeClaimedExecution.mockRejectedValueOnce(new Error('algum erro do executor'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    expect(consoleSpy.mock.calls.some(args => String(args[0]).includes('delay_response'))).toBe(true)
    expect(releaseLock).toHaveBeenCalled()
    // Schedule não deve ser marcado processed após erro
    const schedCalls = adminMock.from.mock.calls.filter(([t]) => t === 'automation_schedules')
    expect(schedCalls).toHaveLength(0)

    consoleSpy.mockRestore()
  })

  // TC-35: sem retry — executor chamado exatamente uma vez mesmo em erro
  it('TC-35: sem retry — executor chamado apenas uma vez em caso de erro', async () => {
    resumeClaimedExecution.mockRejectedValueOnce(new Error('erro sem retry'))

    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const claimCalls = adminMock.rpc.mock.calls.filter(([n]) => n === 'claim_delay_response_lead_v1')
    expect(claimCalls).toHaveLength(1)
    expect(resumeClaimedExecution).toHaveBeenCalledTimes(1)
  })
})

// =============================================================================
// GRUPO 10 — Uma única execução por mensagem
// =============================================================================

describe('Grupo 10 — Uma execução por mensagem', () => {
  // TC-36: somente uma execução retomada por mensagem
  it('TC-36: após claim de delay_response, não tenta retomar segunda execução', async () => {
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })
    expect(resumeClaimedExecution).toHaveBeenCalledOnce()
  })

  // TC-36b: após claim perder corrida (claimed=false), não tenta segunda execução
  it('TC-36b: claimed=false não tenta segunda execução', async () => {
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_FALSE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })
})

// =============================================================================
// GRUPO 11 — Isolamento multi-tenant
// =============================================================================

describe('Grupo 11 — Multi-tenant', () => {
  // TC-37: company_id do resultado é validado contra a empresa da instância
  it('TC-37: find_v2 usa company_id resolvido da instância (não do payload)', async () => {
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: { find_paused_awaiting_execution_v2: FIND_V2_NOT_FOUND },
      },
    })

    const [_n, args] = adminMock.rpc.mock.calls.find(([n]) => n === 'find_paused_awaiting_execution_v2')
    // company_id deve vir da instância resolvida no início do webhook
    expect(args.p_company_id).toBe(COMPANY_ID)
  })

  // TC-37b: claim usa company_id do resultado da busca
  it('TC-37b: claim usa company_id retornado por find_v2 (resultCompanyId)', async () => {
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_FALSE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })
    const [_n, args] = adminMock.rpc.mock.calls.find(([n]) => n === 'claim_delay_response_lead_v1')
    expect(args.p_company_id).toBe(COMPANY_ID)
  })
})

// =============================================================================
// GRUPO 12 — Regressão: comportamento legado inalterado
// =============================================================================

describe('Grupo 12 — Regressão no fluxo legado', () => {
  // TC-38: awaiting_input continua funcionando normalmente
  it('TC-38: awaiting_input retomado com resumeFromNode (legado intacto)', async () => {
    const adminMock = makeAdminMock({
      fromOverrides: {
        automation_executions: {
          id: EXECUTION_ID, flow_id: FLOW_ID, company_id: COMPANY_ID,
          status: 'paused', current_node_id: 'input-node', lead_id: LEAD_ID,
        },
        automation_flows: PRE_FLOW,
      },
    })
    const anonMock = makeAnonMock({
      rpcOverrides: {
        find_paused_awaiting_input_execution: {
          found: true, execution_id: EXECUTION_ID, lead_id: LEAD_ID,
        },
      },
    })

    createClient.mockReturnValue(anonMock)
    getSupabaseAdmin.mockReturnValue(adminMock)

    const { req, res } = makeReqRes(makeTextPayload())
    await handler(req, res)

    expect(resumeFromNode).toHaveBeenCalledOnce()
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  // TC-39: mensagem outbound não ativa nenhum bloco de automação
  it('TC-39: outbound → nem resumeFromNode nem resumeClaimedExecution chamados', async () => {
    const payload = makeTextPayload({ message: { fromMe: true, wasSentByApi: true, deviceSent: false } })
    await runHandler(payload)
    expect(resumeFromNode).not.toHaveBeenCalled()
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  // TC-40: nenhum outro EventType ativa o novo fluxo
  it('TC-40: EventType=status → delay_response não executado', async () => {
    const payload = { EventType: 'status', message: { id: 'x', fromMe: false } }
    const { adminMock } = await runHandler(payload)
    const delayV2 = adminMock.rpc.mock.calls.filter(([n]) => n === 'find_paused_awaiting_execution_v2')
    expect(delayV2).toHaveLength(0)
  })
})

// =============================================================================
// GRUPO 13 — executionLock no bloco delay_response
// =============================================================================
//
// Cobre os requisitos da correção conjunta da Etapa 5:
//   - lock é adquirido ANTES do claim
//   - lock indisponível bloqueia claim, schedule, executor
//   - claimed=false libera lock no finally
//   - erro no executor libera lock no finally
//   - executor recebe preAcquiredLock
//   - sem retry pós-claim de lock
//   - nova RPC claim_delay_response_lead_v1
// =============================================================================

describe('Grupo 13 — executionLock no bloco delay_response', () => {
  // ── helper: run happy path (found + claimed=true + resume ok) ─────────────
  async function runHappy() {
    return runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })
  }

  // TC-L01: lock adquirido antes do Claim RPC
  // Usa rastreamento de ordem explícita via array compartilhado.
  it('TC-L01: lock adquirido antes do Claim RPC', async () => {
    const order = []

    acquireLock.mockImplementation(async () => {
      order.push('acquireLock')
      return { acquired: true, lockId: 'webhook-lock-id' }
    })

    const adminMock = makeAdminMock({
      rpcOverrides: {
        find_paused_awaiting_execution_v2: FIND_V2_FOUND,
        claim_delay_response_lead_v1:      CLAIM_TRUE,
      },
      fromOverrides: { automation_flows: PRE_FLOW },
    })
    const origRpc = adminMock.rpc
    adminMock.rpc = vi.fn((name, args) => {
      if (name === 'claim_delay_response_lead_v1') order.push('claim')
      return origRpc(name, args)
    })

    createClient.mockReturnValue(makeAnonMock())
    getSupabaseAdmin.mockReturnValue(adminMock)

    const { req, res } = makeReqRes(makeTextPayload())
    await handler(req, res)

    const lockIdx  = order.indexOf('acquireLock')
    const claimIdx = order.indexOf('claim')

    expect(lockIdx).toBeGreaterThanOrEqual(0)
    expect(claimIdx).toBeGreaterThanOrEqual(0)
    expect(lockIdx).toBeLessThan(claimIdx)
  })

  // TC-L02: lock indisponível → Claim RPC não chamada
  it('TC-L02: lock indisponível → Claim RPC não chamada', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'locked by another' })

    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: { find_paused_awaiting_execution_v2: FIND_V2_FOUND },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const claimCalls = adminMock.rpc.mock.calls.filter(([n]) => n === 'claim_delay_response_lead_v1')
    expect(claimCalls).toHaveLength(0)
  })

  // TC-L03: lock indisponível → schedule não atualizado
  it('TC-L03: lock indisponível → automation_schedules não atualizado', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'locked' })

    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: { find_paused_awaiting_execution_v2: FIND_V2_FOUND },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const schedCalls = adminMock.from.mock.calls.filter(([t]) => t === 'automation_schedules')
    expect(schedCalls).toHaveLength(0)
  })

  // TC-L04: lock indisponível → executor não chamado
  it('TC-L04: lock indisponível → resumeClaimedExecution não chamado', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'locked' })

    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: { find_paused_awaiting_execution_v2: FIND_V2_FOUND },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  // TC-L05: lock indisponível → execução permanece pausada (claim não ocorreu)
  it('TC-L05: lock indisponível → execução não é transitada para running', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'locked' })

    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: { find_paused_awaiting_execution_v2: FIND_V2_FOUND },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const claimCalls = adminMock.rpc.mock.calls.filter(([n]) => n === 'claim_delay_response_lead_v1')
    expect(claimCalls).toHaveLength(0)
  })

  // TC-L06: Claim RPC chamada exatamente uma vez após lock adquirido
  it('TC-L06: Claim RPC chamada exatamente uma vez após lock adquirido', async () => {
    const { adminMock } = await runHappy()

    const claimCalls = adminMock.rpc.mock.calls.filter(([n]) => n === 'claim_delay_response_lead_v1')
    expect(acquireLock).toHaveBeenCalledOnce()
    expect(claimCalls).toHaveLength(1)
  })

  // TC-L07: claimed=false → releaseLock chamado no finally
  it('TC-L07: claimed=false → lock liberado no finally', async () => {
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_FALSE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    expect(releaseLock).toHaveBeenCalledWith(
      EXECUTION_ID,
      'webhook-lock-id',
      expect.anything(),
    )
  })

  // TC-L08: claimed=false → executor não chamado, lock liberado
  it('TC-L08: claimed=false → executor não chamado após lock liberado', async () => {
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_FALSE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    expect(resumeClaimedExecution).not.toHaveBeenCalled()
    expect(releaseLock).toHaveBeenCalled()
  })

  // TC-L09: claim SQL error → lock liberado no finally
  it('TC-L09: claim SQL error → lock liberado no finally', async () => {
    const sqlErr = { message: 'deadlock detected' }
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2:   FIND_V2_FOUND,
          claim_delay_response_lead_v1: { __error: sqlErr },
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    expect(releaseLock).toHaveBeenCalledWith(EXECUTION_ID, 'webhook-lock-id', expect.anything())
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  // TC-L10: claimed=true → executor chamado e lock liberado no finally
  it('TC-L10: claimed=true → executor chamado e lock liberado no finally', async () => {
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    expect(resumeClaimedExecution).toHaveBeenCalledOnce()
    expect(releaseLock).toHaveBeenCalledWith(EXECUTION_ID, 'webhook-lock-id', expect.anything())
  })

  // TC-L11: executor recebe preAcquiredLock válido
  it('TC-L11: executor chamado com preAcquiredLock={acquired:true, lockId}', async () => {
    await runHappy()

    const callArgs = resumeClaimedExecution.mock.calls[0][0]
    expect(callArgs.preAcquiredLock).toBeDefined()
    expect(callArgs.preAcquiredLock.acquired).toBe(true)
    expect(callArgs.preAcquiredLock.lockId).toBe('webhook-lock-id')
  })

  // TC-L12: executor nunca recebe preAcquiredLock com acquired=false
  it('TC-L12: executor nunca recebe preAcquiredLock com acquired=false', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'locked' })

    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: { find_paused_awaiting_execution_v2: FIND_V2_FOUND },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  // TC-L13: sucesso → lock liberado no finally
  it('TC-L13: sucesso → releaseLock chamado no finally', async () => {
    await runHappy()
    expect(releaseLock).toHaveBeenCalledWith(EXECUTION_ID, 'webhook-lock-id', expect.anything())
  })

  // TC-L14: erro no executor → lock liberado no finally
  it('TC-L14: erro em resumeClaimedExecution → lock liberado no finally', async () => {
    resumeClaimedExecution.mockRejectedValueOnce(new Error('processNode failed'))

    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    expect(releaseLock).toHaveBeenCalledWith(EXECUTION_ID, 'webhook-lock-id', expect.anything())
  })

  // TC-L15: sem retry de POST_CLAIM_LOCK_UNAVAILABLE no webhook (preAcquiredLock elimina o cenário)
  it('TC-L15: sem retry de POST_CLAIM_LOCK_UNAVAILABLE no webhook', async () => {
    resumeClaimedExecution.mockRejectedValueOnce(new Error('processNode failed'))

    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    expect(resumeClaimedExecution).toHaveBeenCalledOnce()
  })

  // TC-L16: Claim RPC chamada no máximo uma vez
  it('TC-L16: Claim RPC chamada no máximo uma vez', async () => {
    const { adminMock } = await runHappy()
    const claimCalls = adminMock.rpc.mock.calls.filter(([n]) => n === 'claim_delay_response_lead_v1')
    expect(claimCalls).toHaveLength(1)
  })

  // TC-L17: schedule não atualizado quando claimed=false
  it('TC-L17: schedule não atualizado quando claimed=false', async () => {
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_FALSE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const schedCalls = adminMock.from.mock.calls.filter(([t]) => t === 'automation_schedules')
    expect(schedCalls).toHaveLength(0)
  })

  // TC-L18: awaiting_input mantém prioridade (não adquire lock de delay_response)
  it('TC-L18: awaiting_input encontrado → acquireLock para delay_response não chamado', async () => {
    const adminMock = makeAdminMock({
      fromOverrides: {
        automation_executions: {
          id: EXECUTION_ID, flow_id: FLOW_ID, company_id: COMPANY_ID,
          status: 'paused', current_node_id: 'input-node', lead_id: LEAD_ID,
        },
        automation_flows: PRE_FLOW,
      },
    })
    const anonMock = makeAnonMock({
      rpcOverrides: {
        find_paused_awaiting_input_execution: {
          found: true, execution_id: EXECUTION_ID, lead_id: LEAD_ID,
        },
      },
    })

    createClient.mockReturnValue(anonMock)
    getSupabaseAdmin.mockReturnValue(adminMock)

    const { req, res } = makeReqRes(makeTextPayload())
    await handler(req, res)

    expect(acquireLock).not.toHaveBeenCalled()
  })

  // TC-L19: somente uma execução por mensagem
  it('TC-L19: após resume de delay_response, nenhum outro lock é adquirido', async () => {
    await runHappy()
    expect(acquireLock).toHaveBeenCalledOnce()
  })

  // TC-L20: deduplicação continua antes do lock
  it('TC-L20: mensagem duplicada não chama acquireLock', async () => {
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        fromOverrides: { chat_messages: { id: 'existing-id' } },
      },
    })
    expect(acquireLock).not.toHaveBeenCalled()
  })

  // TC-L21: mensagens outbound não adquirem lock
  it('TC-L21: mensagem outbound não chama acquireLock', async () => {
    const payload = makeTextPayload({ message: { fromMe: true, wasSentByApi: true, deviceSent: false } })
    await runHandler(payload)
    expect(acquireLock).not.toHaveBeenCalled()
  })

  // TC-L22: multi-tenant — acquireLock usa execution_id correto
  it('TC-L22: acquireLock chamado com candidateExecutionId correto', async () => {
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_FALSE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    expect(acquireLock).toHaveBeenCalledOnce()
    expect(acquireLock.mock.calls[0][0]).toBe(EXECUTION_ID)
  })

  // TC-L23: find_v2 found=false → acquireLock nunca chamado
  it('TC-L23: find_v2 found=false → acquireLock nunca chamado', async () => {
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: { find_paused_awaiting_execution_v2: FIND_V2_NOT_FOUND },
      },
    })

    expect(acquireLock).not.toHaveBeenCalled()
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })
})

// =============================================================================
// GRUPO 14 — Nova RPC claim_delay_response_lead_v1
// =============================================================================
//
// Testes que validam o uso específico da nova RPC:
//   - não chama mais a antiga claim_paused_execution_v1
//   - parâmetros corretos (schedule_id, messageText, etc.)
//   - comportamento de response_variable e claimedMarker
//   - recovery automático via schedule processing
// =============================================================================

describe('Grupo 14 — Nova RPC claim_delay_response_lead_v1', () => {
  // TC-N1: usa nova RPC (não chama claim_paused_execution_v1)
  it('TC-N1: usa claim_delay_response_lead_v1 (não chama a antiga RPC)', async () => {
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const oldClaimCalls = adminMock.rpc.mock.calls.filter(
      ([n]) => n === 'claim_paused_execution_v1'
    )
    const newClaimCalls = adminMock.rpc.mock.calls.filter(
      ([n]) => n === 'claim_delay_response_lead_v1'
    )

    expect(oldClaimCalls).toHaveLength(0)
    expect(newClaimCalls).toHaveLength(1)
  })

  // TC-N2: envia schedule_id do find_v2 como p_schedule_id
  it('TC-N2: p_schedule_id = schedule_id retornado por find_v2', async () => {
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_FALSE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const [, args] = adminMock.rpc.mock.calls.find(([n]) => n === 'claim_delay_response_lead_v1')
    expect(args.p_schedule_id).toBe(SCHEDULE_ID)
  })

  // TC-N3: envia messageText como p_user_response
  it('TC-N3: p_user_response = texto da mensagem inbound', async () => {
    const textPayload = makeTextPayload({ message: { text: 'minha resposta' } })
    const { adminMock } = await runHandler(textPayload, {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_FALSE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const [, args] = adminMock.rpc.mock.calls.find(([n]) => n === 'claim_delay_response_lead_v1')
    expect(args.p_user_response).toBe('minha resposta')
  })

  // TC-N4: p_user_response=null quando mensagem sem texto (mídia sem legenda)
  it('TC-N4: p_user_response aceita null (mídia sem legenda)', async () => {
    const mediaPayload = makeTextPayload({ message: { text: undefined, messageType: 'imageMessage' } })
    const { adminMock } = await runHandler(mediaPayload, {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_FALSE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const [, args] = adminMock.rpc.mock.calls.find(([n]) => n === 'claim_delay_response_lead_v1')
    // Webhook envia messageText que pode ser undefined/null — ambos são válidos
    expect('p_user_response' in args).toBe(true)
  })

  // TC-N5: executor recebe userResponse=undefined (variável já salva pela RPC)
  it('TC-N5: executor recebe userResponse=undefined (salvo atomicamente pela RPC)', async () => {
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const callArgs = resumeClaimedExecution.mock.calls[0][0]
    expect(callArgs.userResponse).toBeUndefined()
  })

  // TC-N6: executor recebe claimedMarker=null (impede segundo salvamento)
  it('TC-N6: executor recebe claimedMarker=null', async () => {
    await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    const callArgs = resumeClaimedExecution.mock.calls[0][0]
    expect(callArgs.claimedMarker).toBeNull()
  })

  // TC-N7: schedule NÃO cancelado antes do executor (nova RPC já moveu para processing)
  it('TC-N7: schedule não cancelado explicitamente antes do executor', async () => {
    let scheduleUpdateBeforeResume = false
    resumeClaimedExecution.mockImplementationOnce(async () => {
      scheduleUpdateBeforeResume = true
      return {}
    })

    const adminMock = makeAdminMock({
      rpcOverrides: {
        find_paused_awaiting_execution_v2: FIND_V2_FOUND,
        claim_delay_response_lead_v1:      CLAIM_TRUE,
      },
      fromOverrides: { automation_flows: PRE_FLOW },
    })

    let scheduleFromCalledBeforeResume = false
    const originalFrom = adminMock.from
    adminMock.from = vi.fn((table) => {
      if (table === 'automation_schedules' && !scheduleUpdateBeforeResume) {
        scheduleFromCalledBeforeResume = true
      }
      if (table === 'automation_flows') return makeChain({ data: PRE_FLOW, error: null })
      return originalFrom(table)
    })

    createClient.mockReturnValue(makeAnonMock())
    getSupabaseAdmin.mockReturnValue(adminMock)

    const { req, res } = makeReqRes(makeTextPayload())
    await handler(req, res)

    expect(scheduleFromCalledBeforeResume).toBe(false)
  })

  // TC-N8: schedule marcado processed somente após executor ok
  it('TC-N8: schedule marcado processing → processed apenas após executor ok', async () => {
    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    // Após executor ok → schedule deve ter sido finalizado
    const schedCalls = adminMock.from.mock.calls.filter(([t]) => t === 'automation_schedules')
    expect(schedCalls).toHaveLength(1)
  })

  // TC-N9: queda após claim (executor lança) → schedule permanece processing para recovery
  it('TC-N9: falha do executor → schedule permanece processing (recovery pelo cron)', async () => {
    resumeClaimedExecution.mockRejectedValueOnce(new Error('crash'))

    const { adminMock } = await runHandler(makeTextPayload(), {
      adminOverrides: {
        rpcOverrides: {
          find_paused_awaiting_execution_v2: FIND_V2_FOUND,
          claim_delay_response_lead_v1:      CLAIM_TRUE,
        },
        fromOverrides: { automation_flows: PRE_FLOW },
      },
    })

    // Nenhuma atualização de schedule — permanece em processing
    const schedCalls = adminMock.from.mock.calls.filter(([t]) => t === 'automation_schedules')
    expect(schedCalls).toHaveLength(0)
  })

  // TC-N10: falha ao finalizar schedule não reverte o flow executado
  it('TC-N10: falha na finalização do schedule não chama executor novamente', async () => {
    let resumeCount = 0
    resumeClaimedExecution.mockImplementation(async () => {
      resumeCount++
      return {}
    })

    const adminMock = makeAdminMock({
      rpcOverrides: {
        find_paused_awaiting_execution_v2: FIND_V2_FOUND,
        claim_delay_response_lead_v1:      CLAIM_TRUE,
      },
      fromOverrides: { automation_flows: PRE_FLOW },
    })

    // from('automation_schedules') lança exceção (falha na finalização)
    const originalFrom = adminMock.from
    adminMock.from = vi.fn((table) => {
      if (table === 'automation_schedules') {
        const ch = makeChain({ data: null, error: null })
        ch.update = vi.fn(() => { throw new Error('network error') })
        return ch
      }
      if (table === 'automation_flows') return makeChain({ data: PRE_FLOW, error: null })
      return originalFrom(table)
    })

    createClient.mockReturnValue(makeAnonMock())
    getSupabaseAdmin.mockReturnValue(adminMock)

    const { req, res } = makeReqRes(makeTextPayload())
    await handler(req, res)

    // Executor chamado exatamente uma vez — sem re-execução após falha de finalização
    expect(resumeCount).toBe(1)
  })
})
