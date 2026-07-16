// =============================================================================
// Testes unitários — executor.js (resumeFromNode + resumeClaimedExecution)
//
// Framework: vitest
// Foco: routing por resumeReason, caminho pós-claim vs legado, getNextNodes.
//
// Estratégia:
//   - Mock completo do supabase client
//   - Mock de executionLock para controle total
//   - Nós 'end' como destinos — simples de detectar via automation_logs
//   - Não testa lógica interna de processFlowAsync (escopo separado)
//
// Para executar: npm test
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resumeFromNode, resumeClaimedExecution } from '../executor.js'

// ---------------------------------------------------------------------------
// Mocks de módulos externos
// ---------------------------------------------------------------------------
vi.mock('../executionLock.js', () => ({
  acquireLock:  vi.fn().mockResolvedValue({ acquired: true, lockId: 'lock-uuid' }),
  releaseLock:  vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../plans/limitChecker.js', () => ({
  getPlanLimits: vi.fn(),
  checkLimit:    vi.fn(),
}))

// Handlers de nós — não exercitados nestes testes
vi.mock('../whatsappSender.js',    () => ({ sendMessageNode: vi.fn().mockResolvedValue({ sent: true }) }))
vi.mock('../delayHandler.js',      () => ({ pauseAtDelay: vi.fn().mockResolvedValue({ paused: true, resumeAt: '2099-01-01T00:00:00.000Z' }) }))
vi.mock('../conditionEval.js',     () => ({ evaluateCondition: vi.fn() }))
vi.mock('../crmActions.js',        () => ({ executeCrmAction: vi.fn() }))
vi.mock('../distributionHandler.js', () => ({ executeDistribution: vi.fn() }))
vi.mock('../agentNodeHandler.js',  () => ({ executeAgentNode: vi.fn() }))
vi.mock('../keywordRouter.js',     () => ({ executeKeywordRouter: vi.fn() }))

import { acquireLock, releaseLock } from '../executionLock.js'

// ---------------------------------------------------------------------------
// Fábrica de mock Supabase
//
// Captura todas as calls de update em automation_executions para inspeção.
// Captura todos os inserts em automation_logs (node_id visitado).
// Responde a selects com dados suficientes para que o executor não trave.
// ---------------------------------------------------------------------------
function makeSupabase({
  statusAfterResume = 'completed',
  updateError       = null,
} = {}) {
  const executionUpdates = []  // payload de cada .update() em automation_executions
  const logInserts       = []  // payload de cada .insert() em automation_logs

  // --- automation_executions update chain (.update(payload).eq(col, val)) ---
  const updateExec = vi.fn((payload) => {
    executionUpdates.push(payload)
    return { eq: vi.fn().mockResolvedValue({ error: updateError }) }
  })

  // --- automation_executions select chain (.select(fields).eq(col, val).single()) ---
  // Ambos os selects usam o mesmo padrão: .select().eq().single()
  // 'executed_nodes' → retorna executed_nodes vazio
  // 'status'         → retorna statusAfterResume
  const makeSelectChain = (resolveData) => ({
    eq: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: resolveData, error: null }),
    }),
  })

  const selectExec = vi.fn().mockImplementation((fields) => {
    if (fields === 'executed_nodes') return makeSelectChain({ executed_nodes: [] })
    // 'status' ou qualquer outro campo — usado pela verificação final de status
    return makeSelectChain({ status: statusAfterResume })
  })

  // --- automation_logs insert chain ---
  const insertLogs = vi.fn((payload) => {
    const rows = Array.isArray(payload) ? payload : [payload]
    logInserts.push(...rows)
    return Promise.resolve({ error: null })
  })

  const from = vi.fn((table) => {
    if (table === 'automation_executions') {
      return { update: updateExec, select: selectExec }
    }
    if (table === 'automation_logs') return { insert: insertLogs }
    // outras tabelas (automation_schedules, etc.)
    return {
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      delete: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }),
    }
  })

  return {
    from,
    _state: { executionUpdates, logInserts },
  }
}

// ---------------------------------------------------------------------------
// Dados base
// ---------------------------------------------------------------------------
const BASE_EXECUTION_LEGACY = {
  id:             'exec-uuid',
  status:         'paused',
  company_id:     'co-uuid',
  flow_id:        'flow-uuid',
  variables:      {},
  trigger_data:   { instance_id: 'inst-uuid', conversation_id: 'conv-uuid' },
  lead_id:        42,
  opportunity_id: null,
  current_node_id: 'delay-node-id',
}

const BASE_EXECUTION_CLAIMED = {
  ...BASE_EXECUTION_LEGACY,
  status:          'running',
  current_node_id: null,   // limpo pela claim RPC
}

// Nó delay legado (sem wait_mode)
const LEGACY_DELAY_NODE = {
  id:   'delay-node-id',
  type: 'delay',
  data: { config: { duration: 5, unit: 'minutes' } },
  position: { x: 0, y: 0 },
}

// Nó delay time_or_response
const TOR_DELAY_NODE = {
  id:   'delay-node-id',
  type: 'delay',
  data: { config: { duration: 5, unit: 'minutes', wait_mode: 'time_or_response' } },
  position: { x: 0, y: 0 },
}

const END_NODE_A = { id: 'end-a', type: 'end', data: {}, position: { x: 0, y: 100 } }
const END_NODE_B = { id: 'end-b', type: 'end', data: {}, position: { x: 0, y: 200 } }

function makeTorFlow() {
  return {
    id:    'flow-uuid',
    nodes: [TOR_DELAY_NODE, END_NODE_A, END_NODE_B],
    edges: [
      { id: 'e1', source: 'delay-node-id', target: 'end-a', sourceHandle: 'responded' },
      { id: 'e2', source: 'delay-node-id', target: 'end-b', sourceHandle: 'timeout' },
    ],
  }
}

function makeLegacyFlow(node = LEGACY_DELAY_NODE) {
  return {
    id:    'flow-uuid',
    nodes: [node, END_NODE_A],
    edges: [
      { id: 'e1', source: 'delay-node-id', target: 'end-a' },
    ],
  }
}

// =============================================================================
// GRUPO 1 — Wrapper legado (resumeFromNode)
// =============================================================================
describe('resumeFromNode — wrapper legado', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC01 — mantém assinatura posicional de 5 parâmetros', () => {
    // Verifica que a exportação existe e aceita 5 args sem erro de tipo
    expect(typeof resumeFromNode).toBe('function')
    expect(resumeFromNode.length).toBe(4) // 5º é default — JS conta 4
  })

  it('TC13 — executa a transição paused → running no banco', async () => {
    const supabase = makeSupabase()
    const flow     = makeLegacyFlow()

    await resumeFromNode(BASE_EXECUTION_LEGACY, flow, 'delay-node-id', supabase)

    const runningUpdate = supabase._state.executionUpdates.find(u => u.status === 'running')
    expect(runningUpdate).toBeDefined()
    expect(runningUpdate.paused_at).toBeNull()
    expect(runningUpdate.resume_at).toBeNull()
    expect(runningUpdate.current_node_id).toBeNull()
  })

  it('TC02 — delay legado sem wait_mode: não roteia por handled especial', async () => {
    const supabase = makeSupabase()
    const flow     = makeLegacyFlow()

    const result = await resumeFromNode(BASE_EXECUTION_LEGACY, flow, 'delay-node-id', supabase)

    // Deve concluir sem erro (a edge sem sourceHandle específico é seguida)
    expect(result?.completed).toBe(true)
  })

  it('TC03 — delay com wait_mode = "time" mantém comportamento legado', async () => {
    const supabase = makeSupabase()
    const timeNode = {
      ...LEGACY_DELAY_NODE,
      data: { config: { duration: 5, unit: 'minutes', wait_mode: 'time' } },
    }
    const flow = makeLegacyFlow(timeNode)

    const result = await resumeFromNode(BASE_EXECUTION_LEGACY, flow, 'delay-node-id', supabase)

    expect(result?.completed).toBe(true)
    const runningUpdate = supabase._state.executionUpdates.find(u => u.status === 'running')
    expect(runningUpdate).toBeDefined()
  })

  it('legado pula execução quando status != paused', async () => {
    const supabase = makeSupabase()
    const exec     = { ...BASE_EXECUTION_LEGACY, status: 'running' }
    const flow     = makeLegacyFlow()

    const result = await resumeFromNode(exec, flow, 'delay-node-id', supabase)

    expect(result?.skipped).toBe(true)
    expect(acquireLock).not.toHaveBeenCalled()
  })
})

// =============================================================================
// GRUPO 2 — Caminho pós-claim (resumeClaimedExecution)
// =============================================================================
describe('resumeClaimedExecution — caminho pós-claim', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC04 — lead_response usa handle "responded"', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: { node_id: 'delay-node-id', schedule_id: 'sched-uuid' },
    })

    // end-a (responded) deve ter sido visitado
    const visitedA = supabase._state.logInserts.some(l => l.node_id === 'end-a')
    const visitedB = supabase._state.logInserts.some(l => l.node_id === 'end-b')
    expect(visitedA).toBe(true)
    expect(visitedB).toBe(false)
  })

  it('TC05 — timeout usa handle "timeout"', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'timeout',
      claimedMarker: { node_id: 'delay-node-id', schedule_id: 'sched-uuid' },
    })

    const visitedA = supabase._state.logInserts.some(l => l.node_id === 'end-a')
    const visitedB = supabase._state.logInserts.some(l => l.node_id === 'end-b')
    expect(visitedA).toBe(false)
    expect(visitedB).toBe(true)
  })

  it('TC06 — resumeReason ausente lança erro', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: undefined,
      claimedMarker: null,
    })).rejects.toThrow('resumeReason inválido')
  })

  it('TC07 — resumeReason inválido lança erro', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'unknown_reason',
      claimedMarker: null,
    })).rejects.toThrow('resumeReason inválido')
  })

  it('TC08 — userResponse="" com lead_response segue por "responded"', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      userResponse: '',
      resumeReason: 'lead_response',
      claimedMarker: { node_id: 'delay-node-id', schedule_id: 'sched-uuid' },
    })

    const visitedA = supabase._state.logInserts.some(l => l.node_id === 'end-a')
    expect(visitedA).toBe(true)
  })

  it('TC09 — userResponse=null com lead_response segue por "responded"', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      userResponse: null,
      resumeReason: 'lead_response',
      claimedMarker: { node_id: 'delay-node-id', schedule_id: 'sched-uuid' },
    })

    const visitedA = supabase._state.logInserts.some(l => l.node_id === 'end-a')
    expect(visitedA).toBe(true)
  })

  it('TC10 — caminho pós-claim NÃO executa transição paused → running', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: { node_id: 'delay-node-id', schedule_id: 'sched-uuid' },
    })

    const runningUpdate = supabase._state.executionUpdates.find(u => u.status === 'running')
    expect(runningUpdate).toBeUndefined()
  })

  it('TC11 — caminho pós-claim não remove marcador (sem update de variables com delete)', async () => {
    const execWithMarker = {
      ...BASE_EXECUTION_CLAIMED,
      // Simula situação onde claim_paused_execution_v1 JÁ removeu o marcador
      variables: { someVar: 'value' },
    }
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await resumeClaimedExecution({
      execution:    execWithMarker,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'timeout',
      claimedMarker: { node_id: 'delay-node-id', schedule_id: 'sched-uuid' },
    })

    // Nenhum update deve ter tentado remover _awaiting_delay_response
    const markerRemovalUpdate = supabase._state.executionUpdates.find(
      u => u.variables !== undefined && !Object.prototype.hasOwnProperty.call(u.variables, '_awaiting_delay_response')
        && u.status !== 'completed'
    )
    // A única atualização de variables permitida é salvar response_variable (para lead_response)
    // Para timeout, nenhum update de variables deve ocorrer
    const variablesUpdates = supabase._state.executionUpdates.filter(u => u.variables !== undefined)
    expect(variablesUpdates).toHaveLength(0)
  })

  it('TC12 — usa pausedNodeId explícito mesmo com current_node_id = null', async () => {
    const exec = { ...BASE_EXECUTION_CLAIMED, current_node_id: null }
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    const result = await resumeClaimedExecution({
      execution:    exec,
      flow,
      pausedNodeId: 'delay-node-id',  // fornecido explicitamente
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })

    expect(result?.completed).toBe(true)
  })

  it('TC14 — demais tipos de nó mantêm roteamento atual (sem regressão)', async () => {
    // Nó condition no meio do caminho — deve seguir edge sem sourceHandle específico
    const conditionNode = {
      id: 'delay-node-id',
      type: 'condition',
      data: { config: {} },
      position: { x: 0, y: 0 },
    }
    const exec = { ...BASE_EXECUTION_LEGACY, status: 'paused' }
    const flow = {
      id: 'flow-uuid',
      nodes: [conditionNode, END_NODE_A],
      edges: [{ id: 'e1', source: 'delay-node-id', target: 'end-a', sourceHandle: 'false' }],
    }

    const { evaluateCondition } = await import('../conditionEval.js')
    evaluateCondition.mockResolvedValueOnce({ result: false })

    const supabase = makeSupabase()
    const result   = await resumeFromNode(exec, flow, 'delay-node-id', supabase)

    // condition com result=false segue 'false' handle → end-a
    expect(result?.completed).toBe(true)
    const visitedA = supabase._state.logInserts.some(l => l.node_id === 'end-a')
    expect(visitedA).toBe(true)
  })

  it('TC16 — falha após claim é propagada (não swallowed)', async () => {
    const supabase = makeSupabase({ updateError: { message: 'DB error after claim' } })
    const flow     = makeTorFlow()

    // updateError fará o save de response_variable falhar
    const execWithVar = { ...BASE_EXECUTION_CLAIMED, variables: {} }

    await expect(resumeClaimedExecution({
      execution:    execWithVar,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      userResponse: 'minha resposta',
      resumeReason: 'lead_response',
      claimedMarker: { node_id: 'delay-node-id', schedule_id: 'sched-uuid', response_variable: 'resp' },
    })).rejects.toThrow()
  })

  it('TC17 — nenhuma operação de schedule ocorre no executor', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })

    // Não deve ter chamado from('automation_schedules')
    const schedulesCalls = supabase.from.mock.calls.filter(([t]) => t === 'automation_schedules')
    expect(schedulesCalls).toHaveLength(0)
  })

  it('response_variable é salva quando lead_response + claimedMarker.response_variable + userResponse', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await resumeClaimedExecution({
      execution:    { ...BASE_EXECUTION_CLAIMED, variables: { existingVar: 'ok' } },
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      userResponse: 'texto do lead',
      resumeReason: 'lead_response',
      claimedMarker: { node_id: 'delay-node-id', schedule_id: 'sched-uuid', response_variable: 'resp_lead' },
    })

    const varUpdate = supabase._state.executionUpdates.find(u => u.variables?.resp_lead !== undefined)
    expect(varUpdate).toBeDefined()
    expect(varUpdate.variables.resp_lead).toBe('texto do lead')
    expect(varUpdate.variables.existingVar).toBe('ok')  // variáveis existentes preservadas
  })

  it('response_variable NÃO é salva para timeout', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      userResponse: undefined,
      resumeReason: 'timeout',
      claimedMarker: { node_id: 'delay-node-id', schedule_id: 'sched-uuid', response_variable: 'resp_lead' },
    })

    const varUpdate = supabase._state.executionUpdates.find(u => u.variables !== undefined)
    expect(varUpdate).toBeUndefined()
  })
})

// =============================================================================
// GRUPO 3 — Comportamento do lock por caminho
// =============================================================================
describe('executionLock — caminho legado vs pós-claim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Restaurar mock padrão (lock adquirido)
    acquireLock.mockResolvedValue({ acquired: true, lockId: 'lock-uuid' })
    releaseLock.mockResolvedValue(undefined)
  })

  // -------------------------------------------------------------------------
  // TC-lock-01: caminho legado com lock ocupado → skip silencioso (sem regressão)
  // -------------------------------------------------------------------------
  it('TC-lock-01 — legado: lock ocupado retorna { skipped: true }', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'execução já está sendo processada (lock: lk_abc)' })

    const supabase = makeSupabase()
    const flow     = makeLegacyFlow()

    const result = await resumeFromNode(BASE_EXECUTION_LEGACY, flow, 'delay-node-id', supabase)

    expect(result?.skipped).toBe(true)
    expect(result?.reason).toContain('sendo processada')
  })

  // -------------------------------------------------------------------------
  // TC-lock-02: pós-claim com lock ocupado NÃO retorna sucesso
  // -------------------------------------------------------------------------
  it('TC-lock-02 — pós-claim: lock ocupado NÃO retorna sucesso', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'execução já está sendo processada (lock: lk_xyz)' })

    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })).rejects.toThrow()
  })

  // -------------------------------------------------------------------------
  // TC-lock-03: pós-claim com lock ocupado lança erro explícito com código
  // -------------------------------------------------------------------------
  it('TC-lock-03 — pós-claim: lock ocupado lança erro explícito com POST_CLAIM_LOCK_UNAVAILABLE', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'execução já está sendo processada (lock: lk_xyz)' })

    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })).rejects.toThrow('POST_CLAIM_LOCK_UNAVAILABLE')
  })

  // -------------------------------------------------------------------------
  // TC-lock-04: lock pós-claim indisponível não chama processNode
  // (verificado pela ausência de logs de nós sendo visitados)
  // -------------------------------------------------------------------------
  it('TC-lock-04 — pós-claim: lock indisponível não processa nenhum nó', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'lock em uso' })

    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })).rejects.toThrow()

    // Nenhum nó foi visitado (nenhum log inserido)
    expect(supabase._state.logInserts).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // TC-lock-05: lock pós-claim indisponível não tenta update paused → running
  // -------------------------------------------------------------------------
  it('TC-lock-05 — pós-claim: lock indisponível não executa update de status', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'lock em uso' })

    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })).rejects.toThrow()

    expect(supabase._state.executionUpdates).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // TC-lock-06: lock pós-claim indisponível não remove marcador
  // -------------------------------------------------------------------------
  it('TC-lock-06 — pós-claim: lock indisponível não remove marcador', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'lock em uso' })

    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:    { ...BASE_EXECUTION_CLAIMED, variables: { _awaiting_delay_response: { node_id: 'delay-node-id' } } },
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })).rejects.toThrow()

    // Nenhum update foi feito (marcador não foi tocado)
    expect(supabase._state.executionUpdates).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // TC-lock-07: lock pós-claim indisponível não cancela schedule
  // -------------------------------------------------------------------------
  it('TC-lock-07 — pós-claim: lock indisponível não cancela schedule', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'lock em uso' })

    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })).rejects.toThrow()

    const schedCalls = supabase.from.mock.calls.filter(([t]) => t === 'automation_schedules')
    expect(schedCalls).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // TC-lock-08: lock adquirido → continua normalmente
  // -------------------------------------------------------------------------
  it('TC-lock-08 — pós-claim: lock adquirido continua normalmente', async () => {
    // acquireLock já retorna acquired:true por padrão (beforeEach)
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    const result = await resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })

    expect(result?.completed).toBe(true)
  })

  // -------------------------------------------------------------------------
  // TC-lock-09: lock é liberado no finally após sucesso
  // -------------------------------------------------------------------------
  it('TC-lock-09 — lock é liberado no finally após sucesso', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: true, lockId: 'lock-test' })

    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'timeout',
      claimedMarker: null,
    })

    expect(releaseLock).toHaveBeenCalledWith('exec-uuid', 'lock-test', supabase)
  })

  // -------------------------------------------------------------------------
  // TC-lock-10: lock é liberado no finally após erro durante processNode
  // -------------------------------------------------------------------------
  it('TC-lock-10 — lock é liberado no finally após erro durante processNode', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: true, lockId: 'lock-err' })

    // Fazer o select de status retornar erro para simular falha após processNode
    // Mais simples: usar node que não existe para forçar throw em _resumeFromNodeInternal
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'nao-existe',  // nó não encontrado → throw
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })).rejects.toThrow('não encontrado no flow')

    // Lock deve ter sido liberado mesmo com erro
    expect(releaseLock).toHaveBeenCalledWith('exec-uuid', 'lock-err', supabase)
  })

  // -------------------------------------------------------------------------
  // TC-lock-11: erro de lock não é convertido em skip silencioso
  // -------------------------------------------------------------------------
  it('TC-lock-11 — pós-claim: falha de lock não é retorno silencioso', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'lock em uso' })

    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    let thrown = null
    try {
      await resumeClaimedExecution({
        execution:    BASE_EXECUTION_CLAIMED,
        flow,
        pausedNodeId: 'delay-node-id',
        supabase,
        resumeReason: 'lead_response',
        claimedMarker: null,
      })
    } catch (e) {
      thrown = e
    }

    // Deve ter lançado — não retornou { skipped: true } silenciosamente
    expect(thrown).not.toBeNull()
    expect(thrown instanceof Error).toBe(true)
  })

  // -------------------------------------------------------------------------
  // TC-lock-12: erro de lock contém execution_id para rastreabilidade
  // -------------------------------------------------------------------------
  it('TC-lock-12 — pós-claim: erro de lock contém execution_id', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'lock em uso' })

    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })).rejects.toThrow('exec-uuid')
  })

  // -------------------------------------------------------------------------
  // TC-lock-13: lock pós-claim indisponível não chama releaseLock
  // (não adquirimos o lock — não há o que liberar)
  // -------------------------------------------------------------------------
  it('TC-lock-13 — pós-claim: lock não adquirido, releaseLock não é chamado', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'lock em uso' })

    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })).rejects.toThrow()

    expect(releaseLock).not.toHaveBeenCalled()
  })
})

// =============================================================================
// GRUPO: preAcquiredLock — transferência de lock do webhook para o executor
// =============================================================================
//
// Cobre os requisitos da correção conjunta da Etapa 5:
//   - executor com preAcquiredLock não readquire o lock
//   - executor com preAcquiredLock não libera o lock (responsabilidade do caller)
//   - executor sem preAcquiredLock mantém comportamento atual (B) intacto
//   - lock inválido é rejeitado antes de processNode
//   - wrapper legado (resumeFromNode) não é afetado
// =============================================================================

describe('GRUPO — preAcquiredLock', () => {
  const VALID_PRE_LOCK = { acquired: true, lockId: 'pre-lock-abc' }

  beforeEach(() => {
    vi.resetAllMocks()
    acquireLock.mockResolvedValue({ acquired: true, lockId: 'lock-uuid' })
    releaseLock.mockResolvedValue(undefined)
  })

  // ---------------------------------------------------------------------------
  // TC-prelock-01: sem preAcquiredLock → acquireLock é chamado internamente
  // ---------------------------------------------------------------------------
  it('TC-prelock-01 — sem preAcquiredLock: acquireLock chamado internamente', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })

    expect(acquireLock).toHaveBeenCalledWith('exec-uuid', supabase)
  })

  // ---------------------------------------------------------------------------
  // TC-prelock-02: sem preAcquiredLock → releaseLock é chamado após sucesso
  // ---------------------------------------------------------------------------
  it('TC-prelock-02 — sem preAcquiredLock: releaseLock chamado após sucesso', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })

    expect(releaseLock).toHaveBeenCalledWith('exec-uuid', 'lock-uuid', supabase)
  })

  // ---------------------------------------------------------------------------
  // TC-prelock-03: sem preAcquiredLock → releaseLock é chamado após erro
  // ---------------------------------------------------------------------------
  it('TC-prelock-03 — sem preAcquiredLock: releaseLock chamado mesmo após erro', async () => {
    acquireLock.mockResolvedValue({ acquired: true, lockId: 'lock-err' })
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'nao-existe',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })).rejects.toThrow()

    expect(releaseLock).toHaveBeenCalledWith('exec-uuid', 'lock-err', supabase)
  })

  // ---------------------------------------------------------------------------
  // TC-prelock-04: sem preAcquiredLock → mantém POST_CLAIM_LOCK_UNAVAILABLE
  // ---------------------------------------------------------------------------
  it('TC-prelock-04 — sem preAcquiredLock: lock indisponível gera POST_CLAIM_LOCK_UNAVAILABLE', async () => {
    acquireLock.mockResolvedValueOnce({ acquired: false, reason: 'em uso' })
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'lead_response',
      claimedMarker: null,
    })).rejects.toThrow('POST_CLAIM_LOCK_UNAVAILABLE')
  })

  // ---------------------------------------------------------------------------
  // TC-prelock-05: com preAcquiredLock → acquireLock NÃO é chamado
  // ---------------------------------------------------------------------------
  it('TC-prelock-05 — com preAcquiredLock: acquireLock não é chamado', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await resumeClaimedExecution({
      execution:      BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId:   'delay-node-id',
      supabase,
      resumeReason:   'lead_response',
      claimedMarker:  null,
      preAcquiredLock: VALID_PRE_LOCK,
    })

    expect(acquireLock).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // TC-prelock-06: com preAcquiredLock → releaseLock NÃO é chamado pelo executor
  // ---------------------------------------------------------------------------
  it('TC-prelock-06 — com preAcquiredLock: releaseLock não é chamado pelo executor', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await resumeClaimedExecution({
      execution:      BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId:   'delay-node-id',
      supabase,
      resumeReason:   'lead_response',
      claimedMarker:  null,
      preAcquiredLock: VALID_PRE_LOCK,
    })

    expect(releaseLock).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // TC-prelock-07: com preAcquiredLock → flow processado normalmente
  // ---------------------------------------------------------------------------
  it('TC-prelock-07 — com preAcquiredLock: flow processado normalmente', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    const result = await resumeClaimedExecution({
      execution:      BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId:   'delay-node-id',
      supabase,
      resumeReason:   'lead_response',
      claimedMarker:  null,
      preAcquiredLock: VALID_PRE_LOCK,
    })

    // Deve retornar algo (completed/paused) — não skip
    expect(result).toBeDefined()
    expect(result?.skipped).toBeFalsy()
  })

  // ---------------------------------------------------------------------------
  // TC-prelock-08: preAcquiredLock com acquired=false é rejeitado
  // ---------------------------------------------------------------------------
  it('TC-prelock-08 — preAcquiredLock acquired=false: erro antes de processNode', async () => {
    const invalidLock = { acquired: false, lockId: 'some-id' }
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:      BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId:   'delay-node-id',
      supabase,
      resumeReason:   'lead_response',
      claimedMarker:  null,
      preAcquiredLock: invalidLock,
    })).rejects.toThrow('preAcquiredLock inválido')

    // acquireLock nunca foi chamado (falhou antes disso)
    expect(acquireLock).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // TC-prelock-09: preAcquiredLock com lockId ausente é rejeitado
  // ---------------------------------------------------------------------------
  it('TC-prelock-09 — preAcquiredLock lockId ausente: erro antes de processNode', async () => {
    const invalidLock = { acquired: true, lockId: null }
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:      BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId:   'delay-node-id',
      supabase,
      resumeReason:   'lead_response',
      claimedMarker:  null,
      preAcquiredLock: invalidLock,
    })).rejects.toThrow('preAcquiredLock inválido')
  })

  // ---------------------------------------------------------------------------
  // TC-prelock-10: wrapper legado resumeFromNode não é afetado
  // (adquire e libera seu próprio lock, nunca recebe preAcquiredLock)
  // ---------------------------------------------------------------------------
  it('TC-prelock-10 — resumeFromNode legado: adquire e libera lock próprio', async () => {
    const supabase = makeSupabase()
    const flow     = makeLegacyFlow()

    await resumeFromNode(
      BASE_EXECUTION_LEGACY,
      flow,
      'delay-node-id',
      supabase,
    )

    expect(acquireLock).toHaveBeenCalledWith('exec-uuid', supabase)
    expect(releaseLock).toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // TC-prelock-11: cron (resumeClaimedExecution sem preAcquiredLock) compatível
  // ---------------------------------------------------------------------------
  it('TC-prelock-11 — cron sem preAcquiredLock: comportamento atual preservado', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    // Simula chamada do cron sem preAcquiredLock
    const result = await resumeClaimedExecution({
      execution:    BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId: 'delay-node-id',
      supabase,
      resumeReason: 'timeout',
      claimedMarker: {
        node_id:       'delay-node-id',
        schedule_id:   'sched-uuid',
        awaiting_type: 'delay_response',
      },
    })

    // Lock adquirido e liberado internamente
    expect(acquireLock).toHaveBeenCalledWith('exec-uuid', supabase)
    expect(releaseLock).toHaveBeenCalled()
    expect(result).toBeDefined()
    expect(result?.skipped).toBeFalsy()
  })

  // ---------------------------------------------------------------------------
  // TC-prelock-12: com preAcquiredLock, erro em processNode não chama releaseLock
  // (responsabilidade do caller — o webhook libera no finally externo)
  // ---------------------------------------------------------------------------
  it('TC-prelock-12 — com preAcquiredLock: erro em processNode, releaseLock não chamado', async () => {
    const supabase = makeSupabase()
    const flow     = makeTorFlow()

    await expect(resumeClaimedExecution({
      execution:      BASE_EXECUTION_CLAIMED,
      flow,
      pausedNodeId:   'nao-existe',  // nó não encontrado → throw
      supabase,
      resumeReason:   'lead_response',
      claimedMarker:  null,
      preAcquiredLock: VALID_PRE_LOCK,
    })).rejects.toThrow()

    // O executor não deve chamar releaseLock — o webhook é o responsável
    expect(releaseLock).not.toHaveBeenCalled()
  })
})
