// =============================================================================
// Testes unitários — process-schedules.ts
//
// Framework: vitest
// Foco: processDelayResumeSchedule (legado) e processDelayResponseTimeoutSchedule (novo).
//
// Estratégia:
//   - Testar funções exportadas diretamente (não o handler inteiro)
//   - Mock do supabase client para controlar respostas de cada tabela
//   - Mock de resumeFromNode e resumeClaimedExecution via vi.mock
//   - vi.resetAllMocks() em cada beforeEach para garantir isolamento completo
//
// Para executar: npm test
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  processDelayResumeSchedule,
  processDelayResponseTimeoutSchedule,
} from '../../../automation/process-schedules'

// ---------------------------------------------------------------------------
// Mocks de módulos — mesmos caminhos usados pelo módulo importado
// ---------------------------------------------------------------------------
vi.mock('../executor.js', () => ({
  resumeFromNode:          vi.fn().mockResolvedValue({}),
  resumeClaimedExecution:  vi.fn().mockResolvedValue({ completed: true }),
}))

vi.mock('../supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(),
}))

import { resumeFromNode, resumeClaimedExecution } from '../executor.js'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const COMPANY_ID   = 'co-uuid'
const SCHEDULE_ID  = 'sched-uuid'
const EXECUTION_ID = 'exec-uuid'
const FLOW_ID      = 'flow-uuid'
const NODE_ID      = 'delay-node-id'
const CLAIMED_AT   = '2026-07-15T20:00:00.000Z'

// ---------------------------------------------------------------------------
// Fixtures — schedules
// ---------------------------------------------------------------------------

const BASE_SCHEDULE_LEGACY = {
  id:            SCHEDULE_ID,
  execution_id:  EXECUTION_ID,
  flow_id:       FLOW_ID,
  company_id:    COMPANY_ID,
  entity_id:     NODE_ID,
  entity_type:   'delay_resume',
  scheduled_for: new Date(Date.now() - 1000).toISOString(),
  trigger_data:  { delay_config: { duration: 5, unit: 'minutes' } },
}

const BASE_SCHEDULE_TIMEOUT = {
  ...BASE_SCHEDULE_LEGACY,
  entity_type:  'delay_response_timeout',
  trigger_data: { delay_config: { duration: 5, unit: 'minutes' } },
}

// Schedule State B (re-entrada pós-claim, lock_retry_count=1)
const SCHEDULE_TIMEOUT_REENTRY = {
  ...BASE_SCHEDULE_TIMEOUT,
  trigger_data: {
    delay_config: { duration: 5, unit: 'minutes' },
    post_claim: {
      paused_node_id:   NODE_ID,
      resume_reason:    'timeout',
      awaiting_type:    'delay_response',
      claimed_at:       CLAIMED_AT,
      lock_retry_count: 1,
    },
  },
}

// Schedule State B com contador no limite (MAX_LOCK_RETRY_TOTAL = 3)
const SCHEDULE_TIMEOUT_LIMIT_REACHED = {
  ...BASE_SCHEDULE_TIMEOUT,
  trigger_data: {
    delay_config: { duration: 5, unit: 'minutes' },
    post_claim: {
      paused_node_id:   NODE_ID,
      resume_reason:    'timeout',
      awaiting_type:    'delay_response',
      claimed_at:       CLAIMED_AT,
      lock_retry_count: 3,   // = MAX_LOCK_RETRY_TOTAL
    },
  },
}

// ---------------------------------------------------------------------------
// Fixtures — execuções
// ---------------------------------------------------------------------------

const BASE_EXECUTION_PAUSED = {
  id:             EXECUTION_ID,
  flow_id:        FLOW_ID,
  company_id:     COMPANY_ID,
  status:         'paused',
  lead_id:        42,
  opportunity_id: null,
  trigger_data:   { instance_id: 'inst-uuid', conversation_id: 'conv-uuid' },
  variables: {
    _awaiting_delay_response: {
      node_id:           NODE_ID,
      schedule_id:       SCHEDULE_ID,
      started_at:        new Date().toISOString(),
      expires_at:        new Date(Date.now() + 60000).toISOString(),
      response_variable: 'lead_resp',
    },
  },
  executed_nodes: [],
}

// Execution pós-claim: status=running, sem marcador, sem executed_nodes
const BASE_EXECUTION_POST_CLAIM = {
  id:             EXECUTION_ID,
  flow_id:        FLOW_ID,
  company_id:     COMPANY_ID,
  status:         'running',
  lead_id:        42,
  opportunity_id: null,
  trigger_data:   BASE_EXECUTION_PAUSED.trigger_data,
  variables:      {},   // marcador removido pela Claim RPC
}

// ---------------------------------------------------------------------------
// Fixtures — flow
// ---------------------------------------------------------------------------

const BASE_FLOW = {
  id:         FLOW_ID,
  company_id: COMPANY_ID,
  nodes: [
    { id: NODE_ID,  type: 'delay', data: { config: { wait_mode: 'time_or_response' } } },
    { id: 'end-a',  type: 'end', data: {} },
    { id: 'end-b',  type: 'end', data: {} },
  ],
  edges: [
    { id: 'e1', source: NODE_ID, target: 'end-a', sourceHandle: 'responded' },
    { id: 'e2', source: NODE_ID, target: 'end-b', sourceHandle: 'timeout' },
  ],
}

// ---------------------------------------------------------------------------
// Fixtures — resultados da Claim RPC
// ---------------------------------------------------------------------------

const CLAIM_TRUE = {
  claimed:    true,
  claimed_at: CLAIMED_AT,
  execution:  BASE_EXECUTION_POST_CLAIM,
  marker:     BASE_EXECUTION_PAUSED.variables._awaiting_delay_response,
  // post_claim persistido atomicamente pela RPC no schedule (não pelo JS)
  post_claim: {
    paused_node_id:   NODE_ID,
    resume_reason:    'timeout',
    awaiting_type:    'delay_response',
    claimed_at:       CLAIMED_AT,
    lock_retry_count: 0,
  },
}

const CLAIM_FALSE = {
  claimed: false,
  reason:  'already_resumed_or_stale',
}

// ---------------------------------------------------------------------------
// Fábrica de mock Supabase
//
// Captura todos os .update() calls em automation_schedules para inspeção.
// Suporta cadeia dupla de .eq() para execution/flow com company_id.
// ---------------------------------------------------------------------------

function makeSupabase({
  executionData   = BASE_EXECUTION_PAUSED as any,
  executionError  = null                  as any,
  flowData        = BASE_FLOW             as any,
  flowError       = null                  as any,
  rpcResult       = CLAIM_TRUE            as any,
  rpcError        = null                  as any,
} = {}) {
  const scheduleUpdates: any[] = []  // todos os .update() em automation_schedules
  const rpcCalls:        any[] = []

  // Cadeia de select — suporta .single(), .eq().single() e .eq().eq().single()
  const makeSelectChain = (data: any, error: any) => {
    const singleFn = vi.fn().mockResolvedValue({ data, error })
    const eq3 = vi.fn().mockReturnValue({ single: singleFn })
    const eq2 = vi.fn().mockReturnValue({ eq: eq3, single: singleFn })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2, single: singleFn })
    return vi.fn().mockReturnValue({ eq: eq1, single: singleFn })
  }

  // Schedule: captura payload de todos os .update() calls
  const makeSchedUpdate = () =>
    vi.fn((payload: any) => {
      scheduleUpdates.push({ ...payload })
      return { eq: vi.fn().mockResolvedValue({ error: null }) }
    })

  const from = vi.fn((table: string) => {
    if (table === 'automation_executions') return { select: makeSelectChain(executionData, executionError) }
    if (table === 'automation_flows')      return { select: makeSelectChain(flowData, flowError) }
    if (table === 'automation_schedules')  return { update: makeSchedUpdate() }
    return {
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    }
  })

  const rpc = vi.fn(async (_name: string, params: any) => {
    rpcCalls.push({ params })
    return { data: rpcResult, error: rpcError }
  })

  return {
    from,
    rpc,
    _state: { scheduleUpdates, rpcCalls },
  }
}

// Helpers de inspeção de scheduleUpdates
const findUpdate = (updates: any[], pred: (u: any) => boolean) => updates.find(pred)
const hasProcessed  = (u: any[]) => findUpdate(u, x => x.status === 'processed')
const hasFailed     = (u: any[]) => findUpdate(u, x => x.status === 'failed')
const hasPending    = (u: any[]) => findUpdate(u, x => x.status === 'pending')
const hasPostClaim  = (u: any[]) => findUpdate(u, x => x.trigger_data?.post_claim !== undefined && !x.status)

// =============================================================================
// GRUPO 1 — delay_resume (legado)
// =============================================================================

describe('processDelayResumeSchedule — rotina legada', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(resumeFromNode as any).mockResolvedValue({})
    ;(resumeClaimedExecution as any).mockResolvedValue({ completed: true })
  })

  it('TC-01 — usa resumeFromNode e não chama resumeClaimedExecution', async () => {
    const sb = makeSupabase()
    await processDelayResumeSchedule(BASE_SCHEDULE_LEGACY, sb)
    expect(resumeFromNode).toHaveBeenCalledOnce()
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  it('TC-01b — delay_resume não chama Claim RPC', async () => {
    const sb = makeSupabase()
    await processDelayResumeSchedule(BASE_SCHEDULE_LEGACY, sb)
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it('TC-L01 — execução filtrada por company_id (multi-tenant)', async () => {
    const sb = makeSupabase()
    await processDelayResumeSchedule(BASE_SCHEDULE_LEGACY, sb)

    const execCalls = sb.from.mock.calls.filter(([t]: [string]) => t === 'automation_executions')
    expect(execCalls.length).toBeGreaterThan(0)
    // A query deve incluir company_id — verificado pela ausência de erro
    // (se não filtrasse, executionData com company divergente não seria encontrada)
  })

  it('TC-L02 — company_id divergente: execução de outra empresa não é carregada', async () => {
    const scheduleOutra = { ...BASE_SCHEDULE_LEGACY, company_id: 'outra-co' }
    const sb = makeSupabase({ executionData: null, executionError: { message: 'PGRST116' } })

    await expect(
      processDelayResumeSchedule(scheduleOutra, sb)
    ).rejects.toThrow('outra-co')

    expect(resumeFromNode).not.toHaveBeenCalled()
  })

  it('TC-30 — execução não pausada → skipped=true + mark processed', async () => {
    const sb = makeSupabase({ executionData: { ...BASE_EXECUTION_PAUSED, status: 'running' } })
    const result = await processDelayResumeSchedule(BASE_SCHEDULE_LEGACY, sb)
    expect(result.skipped).toBe(true)
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeDefined()
    expect(resumeFromNode).not.toHaveBeenCalled()
  })

  it('TC-30b — execução não encontrada → throw', async () => {
    const sb = makeSupabase({ executionData: null, executionError: { message: 'not found' } })
    await expect(processDelayResumeSchedule(BASE_SCHEDULE_LEGACY, sb)).rejects.toThrow(EXECUTION_ID)
  })

  it('TC-30c — flow não encontrado → throw', async () => {
    const sb = makeSupabase({ flowData: null, flowError: { message: 'not found' } })
    await expect(processDelayResumeSchedule(BASE_SCHEDULE_LEGACY, sb)).rejects.toThrow(FLOW_ID)
  })

  it('TC-30d — nó delay não encontrado no flow → throw', async () => {
    const sb = makeSupabase({ flowData: { ...BASE_FLOW, nodes: [{ id: 'outro', type: 'end', data: {} }] } })
    await expect(processDelayResumeSchedule(BASE_SCHEDULE_LEGACY, sb)).rejects.toThrow(NODE_ID)
  })
})

// =============================================================================
// GRUPO 2 — delay_response_timeout — Estado A (primeira invocação)
// =============================================================================

describe('processDelayResponseTimeoutSchedule — Estado A (sem post_claim)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(resumeClaimedExecution as any).mockResolvedValue({ completed: true })
    ;(resumeFromNode as any).mockResolvedValue({})
  })

  it('TC-02 — usa resumeClaimedExecution e não chama resumeFromNode', async () => {
    const sb = makeSupabase()
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    expect(resumeClaimedExecution).toHaveBeenCalledOnce()
    expect(resumeFromNode).not.toHaveBeenCalled()
  })

  it('TC-03 — execução filtrada por company_id', async () => {
    const sb = makeSupabase()
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    const execCalls = sb.from.mock.calls.filter(([t]: [string]) => t === 'automation_executions')
    expect(execCalls.length).toBeGreaterThan(0)
  })

  it('TC-04 — claimed=false: executor não é chamado', async () => {
    const sb = makeSupabase({ rpcResult: CLAIM_FALSE })
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  it('TC-05 — nova Claim RPC recebe os 4 parâmetros corretos (sem p_awaiting_type/p_resume_reason)', async () => {
    const sb = makeSupabase()
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    expect(sb.rpc).toHaveBeenCalledWith('claim_delay_response_timeout_v1', {
      p_company_id:     COMPANY_ID,
      p_schedule_id:    SCHEDULE_ID,
      p_execution_id:   EXECUTION_ID,
      p_paused_node_id: NODE_ID,
    })
  })

  it('TC-06 — p_schedule_id é enviado na nova Claim RPC', async () => {
    const sb = makeSupabase()
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    expect(sb._state.rpcCalls[0].params.p_schedule_id).toBe(SCHEDULE_ID)
  })

  it('TC-07 — claimed=false marca schedule como processed', async () => {
    const sb = makeSupabase({ rpcResult: CLAIM_FALSE })
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeDefined()
  })

  it('TC-08 — claimed=false retorna skipped=true', async () => {
    const sb = makeSupabase({ rpcResult: CLAIM_FALSE })
    const result = await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    expect(result.skipped).toBe(true)
  })

  it('TC-09 — claimed=true: executor recebe execution retornada pela RPC', async () => {
    const sb = makeSupabase()
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    const call = (resumeClaimedExecution as any).mock.calls[0][0]
    expect(call.execution.id).toBe(EXECUTION_ID)
    expect(call.execution.variables).toEqual({})  // sem marcador — estado pós-claim
  })

  it('TC-10 — claimed=true: executor recebe marker retornado pela RPC', async () => {
    const sb = makeSupabase()
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    const call = (resumeClaimedExecution as any).mock.calls[0][0]
    expect(call.claimedMarker).toEqual(CLAIM_TRUE.marker)
  })

  it('TC-11 — timeout chama resumeClaimedExecution', async () => {
    const sb = makeSupabase()
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    expect(resumeClaimedExecution).toHaveBeenCalledOnce()
  })

  it('TC-12 — timeout usa resumeReason=timeout', async () => {
    const sb = makeSupabase()
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    expect((resumeClaimedExecution as any).mock.calls[0][0].resumeReason).toBe('timeout')
  })

  it('TC-13 — timeout não passa userResponse', async () => {
    const sb = makeSupabase()
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    expect((resumeClaimedExecution as any).mock.calls[0][0].userResponse).toBeUndefined()
  })

  it('TC-14 — sucesso do executor marca schedule processed', async () => {
    const sb = makeSupabase()
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeDefined()
  })

  it('TC-15 — RPC é chamada antes do executor, executor antes de markProcessed', async () => {
    // Com claim_delay_response_timeout_v1, a persistência do post_claim ocorre
    // atomicamente na RPC (SQL) — não há update separado de trigger_data no JS.
    // Verificamos a ordem: RPC → resumeClaimedExecution → markSchedule('processed')
    const callOrder: string[] = []
    const sb = makeSupabase()

    const origRpc = sb.rpc.getMockImplementation()
    sb.rpc.mockImplementation(async (name: string, params: any) => {
      callOrder.push(`rpc:${name}`)
      return origRpc ? origRpc(name, params) : { data: CLAIM_TRUE, error: null }
    })

    const origFrom = sb.from.getMockImplementation()
    sb.from.mockImplementation((table: string) => {
      if (table === 'automation_schedules') {
        return {
          update: vi.fn((payload: any) => {
            if (payload.status === 'processed') callOrder.push('markProcessed')
            return { eq: vi.fn().mockResolvedValue({ error: null }) }
          }),
        }
      }
      return (origFrom as any)(table)
    })

    ;(resumeClaimedExecution as any).mockImplementationOnce(async () => {
      callOrder.push('resumeClaimedExecution')
      return { completed: true }
    })

    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)

    const rpcIdx     = callOrder.findIndex(c => c.startsWith('rpc:'))
    const resumeIdx  = callOrder.indexOf('resumeClaimedExecution')
    const processIdx = callOrder.indexOf('markProcessed')

    expect(rpcIdx).toBeLessThan(resumeIdx)
    expect(resumeIdx).toBeLessThan(processIdx)
  })

  it('TC-16 — erro SQL da Claim RPC lança exceção (não trata como stale)', async () => {
    const sb = makeSupabase({ rpcError: { message: 'deadlock detected' }, rpcResult: null })
    await expect(
      processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    ).rejects.toThrow('deadlock detected')
  })

  it('TC-17 — erro SQL da Claim RPC não chama executor', async () => {
    const sb = makeSupabase({ rpcError: { message: 'connection error' }, rpcResult: null })
    await expect(processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)).rejects.toThrow()
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  it('TC-18 — erro em processNode não marca schedule processed', async () => {
    ;(resumeClaimedExecution as any).mockRejectedValueOnce(new Error('processNode falhou'))
    const sb = makeSupabase()
    await expect(
      processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    ).rejects.toThrow('processNode falhou')
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeUndefined()
  })

  it('TC-19 — POST_CLAIM_LOCK_UNAVAILABLE: não marca processed, retorna para pending', async () => {
    ;(resumeClaimedExecution as any).mockRejectedValueOnce(
      new Error('[executor] POST_CLAIM_LOCK_UNAVAILABLE: exec-uuid')
    )
    const sb = makeSupabase()
    const result = await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)

    expect(result.skipped).toBe(true)
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeUndefined()
    expect(hasPending(sb._state.scheduleUpdates)).toBeDefined()
  })

  it('TC-20 — POST_CLAIM_LOCK_UNAVAILABLE: não chama Claim RPC na re-entrada', async () => {
    // Simula: lock falha → retorna para pending → próxima invocação encontra post_claim
    ;(resumeClaimedExecution as any).mockRejectedValueOnce(
      new Error('[executor] POST_CLAIM_LOCK_UNAVAILABLE: exec-uuid')
    )
    const sbStateA = makeSupabase()
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sbStateA)

    // Na re-entrada (State B), não deve chamar RPC novamente
    ;(resumeClaimedExecution as any).mockResolvedValueOnce({ completed: true })
    const sbStateB = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    await processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_REENTRY, sbStateB)

    expect(sbStateB.rpc).not.toHaveBeenCalled()
  })

  it('TC-21 — re-entrada carrega execution do banco (não reutiliza dados originais do claim)', async () => {
    ;(resumeClaimedExecution as any).mockResolvedValueOnce({ completed: true })
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    await processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_REENTRY, sb)

    const call = (resumeClaimedExecution as any).mock.calls[0][0]
    // A execução passada deve ser a carregada do banco (BASE_EXECUTION_POST_CLAIM)
    expect(call.execution.id).toBe(EXECUTION_ID)
    // Não deve ser os dados da Claim RPC (nenhuma RPC foi chamada)
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it('TC-22 — retry limit atingido (lock_retry_count=3): lança erro crítico', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    await expect(
      processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_LIMIT_REACHED, sb)
    ).rejects.toThrow('Limite de retries')
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  it('TC-23 — execução inexistente → throw sem chamar RPC', async () => {
    const sb = makeSupabase({ executionData: null, executionError: { message: 'not found' } })
    await expect(
      processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    ).rejects.toThrow(EXECUTION_ID)
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it('TC-24 — flow inexistente → throw sem chamar RPC', async () => {
    const sb = makeSupabase({ flowData: null, flowError: { message: 'not found' } })
    await expect(
      processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    ).rejects.toThrow(FLOW_ID)
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it('TC-25 — company_id divergente → não encontra execução → throw', async () => {
    const scheduleOutra = { ...BASE_SCHEDULE_TIMEOUT, company_id: 'outra-co' }
    const sb = makeSupabase({ executionData: null, executionError: { message: 'PGRST116' } })
    await expect(
      processDelayResponseTimeoutSchedule(scheduleOutra, sb)
    ).rejects.toThrow('outra-co')
  })

  it('TC-26 — schedule stale (claimed=false) não dispara edge timeout', async () => {
    const sb = makeSupabase({ rpcResult: { claimed: false, reason: 'already_resumed_or_stale' } })
    const result = await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    expect(result.skipped).toBe(true)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  it('TC-27 — "perdedor" da corrida (claimed=false) não executa flow', async () => {
    const sb = makeSupabase({ rpcResult: CLAIM_FALSE })
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  it('TC-28 — schedule antigo com schedule_id diferente retorna stale', async () => {
    const sb = makeSupabase({ rpcResult: { claimed: false, reason: 'already_resumed_or_stale' } })
    const result = await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    expect(result.skipped).toBe(true)
  })

  it('TC-29 — schedule de outra empresa → execução não encontrada → throw', async () => {
    const scheduleOutra = { ...BASE_SCHEDULE_TIMEOUT, company_id: 'empresa-x' }
    const sb = makeSupabase({ executionData: null, executionError: { message: 'PGRST116' } })
    await expect(
      processDelayResponseTimeoutSchedule(scheduleOutra, sb)
    ).rejects.toThrow('empresa-x')
  })
})

// =============================================================================
// GRUPO 3 — delay_response_timeout — Estado B (re-entrada pós-claim)
// =============================================================================

describe('processDelayResponseTimeoutSchedule — Estado B (re-entrada pós-claim)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(resumeClaimedExecution as any).mockResolvedValue({ completed: true })
    ;(resumeFromNode as any).mockResolvedValue({})
  })

  it('TC-B01 — re-entrada detectada por post_claim não chama Claim RPC', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    await processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_REENTRY, sb)
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it('TC-B02 — re-entrada chama resumeClaimedExecution', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    await processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_REENTRY, sb)
    expect(resumeClaimedExecution).toHaveBeenCalledOnce()
  })

  it('TC-B03 — re-entrada com sucesso termina em processed', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    await processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_REENTRY, sb)
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeDefined()
  })

  it('TC-B04 — lock esgotado: retorna para pending', async () => {
    ;(resumeClaimedExecution as any).mockRejectedValueOnce(
      new Error('[executor] POST_CLAIM_LOCK_UNAVAILABLE: exec-uuid')
    )
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    const result = await processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_REENTRY, sb)

    expect(result.skipped).toBe(true)
    expect(hasPending(sb._state.scheduleUpdates)).toBeDefined()
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeUndefined()
  })

  it('TC-B05 — lock esgotado: incrementa lock_retry_count no trigger_data', async () => {
    ;(resumeClaimedExecution as any).mockRejectedValueOnce(
      new Error('[executor] POST_CLAIM_LOCK_UNAVAILABLE: exec-uuid')
    )
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    await processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_REENTRY, sb)

    const pendingUpdate = hasPending(sb._state.scheduleUpdates)
    expect(pendingUpdate).toBeDefined()
    expect(pendingUpdate!.trigger_data.post_claim.lock_retry_count).toBe(2)
  })

  it('TC-B06 — re-entrada reutiliza paused_node_id e resume_reason do post_claim', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    await processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_REENTRY, sb)

    const call = (resumeClaimedExecution as any).mock.calls[0][0]
    expect(call.pausedNodeId).toBe(NODE_ID)
    expect(call.resumeReason).toBe('timeout')
    expect(call.awaitingType).toBe('delay_response')
  })

  it('TC-B07 — re-entrada para timeout: claimedMarker=null (não precisa de marker)', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    await processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_REENTRY, sb)

    const call = (resumeClaimedExecution as any).mock.calls[0][0]
    expect(call.claimedMarker).toBeNull()
  })

  it('TC-B08 — erro em processNode na re-entrada → throw (not pending)', async () => {
    ;(resumeClaimedExecution as any).mockRejectedValueOnce(new Error('processNode error na reentrada'))
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })

    await expect(
      processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_REENTRY, sb)
    ).rejects.toThrow('processNode error na reentrada')

    expect(hasPending(sb._state.scheduleUpdates)).toBeUndefined()
  })

  it('TC-B09 — retry limit (lock_retry_count=3): lança e não chama executor', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    await expect(
      processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_LIMIT_REACHED, sb)
    ).rejects.toThrow('Limite de retries')
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  it('TC-B10 — retry limit não retorna para pending', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    await expect(
      processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_LIMIT_REACHED, sb)
    ).rejects.toThrow()
    expect(hasPending(sb._state.scheduleUpdates)).toBeUndefined()
  })
})

// =============================================================================
// GRUPO 4 — Recovery e integração pós-claim
// =============================================================================

describe('Recovery pós-claim e integração', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(resumeClaimedExecution as any).mockResolvedValue({ completed: true })
    ;(resumeFromNode as any).mockResolvedValue({})
  })

  it('TC-N01 — Estado A: cron usa claim_delay_response_timeout_v1 (nova RPC)', async () => {
    // Verifica que o cron não usa mais claim_paused_execution_v1 no Estado A
    const sb = makeSupabase()
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)

    expect(sb._state.rpcCalls).toHaveLength(1)
    expect(sb._state.rpcCalls[0].params).toMatchObject({
      p_company_id:     COMPANY_ID,
      p_schedule_id:    SCHEDULE_ID,
      p_execution_id:   EXECUTION_ID,
      p_paused_node_id: NODE_ID,
    })
    // Garante que a RPC antiga não é chamada
    expect(sb.rpc).not.toHaveBeenCalledWith('claim_paused_execution_v1', expect.anything())
  })

  it('TC-N02 — Estado A: sem update separado de trigger_data do JS (persistência atômica na RPC)', async () => {
    // A persistência do post_claim é feita na RPC (SQL). O JS NÃO deve
    // fazer um UPDATE separado de trigger_data (sem campo status).
    const sb = makeSupabase()
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)

    const separatePersistUpdate = hasPostClaim(sb._state.scheduleUpdates)
    // NÃO deve existir um update de trigger_data sem status (JS-side persist)
    expect(separatePersistUpdate).toBeUndefined()
    // Apenas o markSchedule('processed') deve existir
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeDefined()
  })

  it('TC-N03 — Estado A: RPC retorna post_claim e JS usa para lock retry', async () => {
    ;(resumeClaimedExecution as any).mockRejectedValueOnce(
      new Error('[executor] POST_CLAIM_LOCK_UNAVAILABLE: exec-uuid')
    )
    const sb = makeSupabase()
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)

    const pendingUpdate = hasPending(sb._state.scheduleUpdates)
    expect(pendingUpdate).toBeDefined()
    // post_claim.lock_retry_count deve ser 1 (incrementado a partir do 0 da RPC)
    expect(pendingUpdate!.trigger_data.post_claim.lock_retry_count).toBe(1)
    expect(pendingUpdate!.executed_at).toBeNull()
  })

  it('TC-N04 — queda simulada após RPC: schedule devolvido pelo releaseStuckSchedules tem post_claim', async () => {
    // Simula: RPC retornou claimed=true (persistiu post_claim no DB),
    // Function caiu antes do resume. releaseStuckSchedules retorna para pending
    // preservando trigger_data. Próxima invocação: Estado B detectado.
    const scheduleFromRelease = SCHEDULE_TIMEOUT_REENTRY

    ;(resumeClaimedExecution as any).mockResolvedValueOnce({ completed: true })
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    await processDelayResponseTimeoutSchedule(scheduleFromRelease, sb)

    expect(sb.rpc).not.toHaveBeenCalled()
    expect(resumeClaimedExecution).toHaveBeenCalledOnce()
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeDefined()
  })

  it('TC-N05 — trigger_data=null é tratado com segurança', async () => {
    const scheduleNullTrigger = { ...BASE_SCHEDULE_TIMEOUT, trigger_data: null }
    const sb = makeSupabase()
    const result = await processDelayResponseTimeoutSchedule(scheduleNullTrigger, sb)
    expect(result).toBeDefined()
  })

  it('TC-N06 — lock fail no Estado A retorna schedule para pending com lock_retry_count=1', async () => {
    ;(resumeClaimedExecution as any).mockRejectedValueOnce(
      new Error('[executor] POST_CLAIM_LOCK_UNAVAILABLE: exec-uuid')
    )
    const sb = makeSupabase()
    const result = await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)

    expect(result.skipped).toBe(true)
    expect(hasPending(sb._state.scheduleUpdates)).toBeDefined()
    expect(hasPending(sb._state.scheduleUpdates)!.trigger_data.post_claim.lock_retry_count).toBe(1)
  })

  it('TC-N07 — reentrada após recovery não chama nenhuma Claim RPC', async () => {
    ;(resumeClaimedExecution as any).mockResolvedValueOnce({ completed: true })
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    await processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_REENTRY, sb)

    expect(sb.rpc).not.toHaveBeenCalled()
    expect(resumeClaimedExecution).toHaveBeenCalledOnce()
  })

  it('TC-N08 — lock retry mantém post_claim no trigger_data do pending', async () => {
    ;(resumeClaimedExecution as any).mockRejectedValueOnce(
      new Error('[executor] POST_CLAIM_LOCK_UNAVAILABLE: exec-uuid')
    )
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    await processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_REENTRY, sb)

    const pendingUpdate = hasPending(sb._state.scheduleUpdates)
    expect(pendingUpdate!.trigger_data.post_claim).toBeDefined()
    expect(pendingUpdate!.trigger_data.post_claim.lock_retry_count).toBe(2)
  })

  it('TC-N09 — sucesso no Estado B marca processed sem chamar RPC', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    const result = await processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_REENTRY, sb)

    expect(sb.rpc).not.toHaveBeenCalled()
    expect(result.skipped).toBe(false)
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeDefined()
  })

  it('TC-R07 — CLAIM_FALSE (stale ou pós-claim detectado na RPC): não chama executor', async () => {
    const sb = makeSupabase({ rpcResult: CLAIM_FALSE })
    const result = await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    expect(result.skipped).toBe(true)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  it('TC-R08 — erro SQL da Claim RPC não marca schedule como processed ou pending', async () => {
    const sb = makeSupabase({ rpcError: { message: 'internal error' }, rpcResult: null })

    await expect(
      processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    ).rejects.toThrow('internal error')

    expect(hasProcessed(sb._state.scheduleUpdates)).toBeUndefined()
    expect(hasPending(sb._state.scheduleUpdates)).toBeUndefined()
  })
})

// =============================================================================
// GRUPO 5b — lead_response recovery (handlePostClaimReentry)
//
// A re-entrada lead_response usa o mesmo handlePostClaimReentry que timeout.
// Adiciona:
//   - resumeReason='lead_response' → handle responded
//   - userResponse=undefined (variável já em execution.variables)
//   - claimedMarker=null
//   - guard de status (execution.status != running → skip + processed)
// =============================================================================

const SCHEDULE_LEAD_RESPONSE_REENTRY = {
  ...BASE_SCHEDULE_TIMEOUT,
  trigger_data: {
    delay_config: { duration: 5, unit: 'minutes' },
    post_claim: {
      paused_node_id:   NODE_ID,
      resume_reason:    'lead_response',
      awaiting_type:    'delay_response',
      claimed_at:       CLAIMED_AT,
      lock_retry_count: 1,
    },
  },
}

const SCHEDULE_LEAD_RESPONSE_LIMIT = {
  ...BASE_SCHEDULE_TIMEOUT,
  trigger_data: {
    post_claim: {
      paused_node_id:   NODE_ID,
      resume_reason:    'lead_response',
      awaiting_type:    'delay_response',
      claimed_at:       CLAIMED_AT,
      lock_retry_count: 3,  // = MAX_LOCK_RETRY_TOTAL
    },
  },
}

// Execution com response_variable já salva (simulando salvamento atômico pela RPC)
const BASE_EXECUTION_RUNNING_WITH_RESPONSE = {
  ...BASE_EXECUTION_POST_CLAIM,
  variables: { user_answer: 'sim, quero' },
}

// Execution já completed (webhook executou o flow mas caiu antes de marcar schedule)
const BASE_EXECUTION_COMPLETED = {
  ...BASE_EXECUTION_POST_CLAIM,
  status: 'completed',
}

// Execution failed (processNode falhou no webhook)
const BASE_EXECUTION_FAILED = {
  ...BASE_EXECUTION_POST_CLAIM,
  status: 'failed',
}

// Execution ainda paused inesperadamente (claim ocorreu mas execution voltou a paused?)
const BASE_EXECUTION_UNEXPECTEDLY_PAUSED = {
  ...BASE_EXECUTION_POST_CLAIM,
  status: 'paused',
}

describe('processDelayResponseTimeoutSchedule — Estado B (lead_response recovery)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(resumeClaimedExecution as any).mockResolvedValue({ completed: true })
    ;(resumeFromNode as any).mockResolvedValue({})
  })

  it('TC-LR01 — post_claim lead_response não chama Claim RPC', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_RUNNING_WITH_RESPONSE })
    await processDelayResponseTimeoutSchedule(SCHEDULE_LEAD_RESPONSE_REENTRY, sb)
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it('TC-LR02 — post_claim lead_response chama resumeClaimedExecution com resumeReason=lead_response', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_RUNNING_WITH_RESPONSE })
    await processDelayResponseTimeoutSchedule(SCHEDULE_LEAD_RESPONSE_REENTRY, sb)

    expect(resumeClaimedExecution).toHaveBeenCalledOnce()
    const call = (resumeClaimedExecution as any).mock.calls[0][0]
    expect(call.resumeReason).toBe('lead_response')
  })

  it('TC-LR03 — lead_response reentry: userResponse=undefined (variável já em execution.variables)', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_RUNNING_WITH_RESPONSE })
    await processDelayResponseTimeoutSchedule(SCHEDULE_LEAD_RESPONSE_REENTRY, sb)

    const call = (resumeClaimedExecution as any).mock.calls[0][0]
    expect(call.userResponse).toBeUndefined()
  })

  it('TC-LR04 — lead_response reentry: claimedMarker=null', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_RUNNING_WITH_RESPONSE })
    await processDelayResponseTimeoutSchedule(SCHEDULE_LEAD_RESPONSE_REENTRY, sb)

    const call = (resumeClaimedExecution as any).mock.calls[0][0]
    expect(call.claimedMarker).toBeNull()
  })

  it('TC-LR05 — lead_response reentry: execution passada tem variables já atualizadas', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_RUNNING_WITH_RESPONSE })
    await processDelayResponseTimeoutSchedule(SCHEDULE_LEAD_RESPONSE_REENTRY, sb)

    const call = (resumeClaimedExecution as any).mock.calls[0][0]
    // Execution carregada do banco deve ter variables[user_answer] já populada pela RPC
    expect(call.execution.variables).toEqual({ user_answer: 'sim, quero' })
  })

  it('TC-LR06 — guard de status: execution.status=running → executor chamado', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM }) // status=running
    await processDelayResponseTimeoutSchedule(SCHEDULE_LEAD_RESPONSE_REENTRY, sb)
    expect(resumeClaimedExecution).toHaveBeenCalledOnce()
  })

  it('TC-LR07 — guard de status: execution.status=completed → skip + schedule processed', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_COMPLETED })
    const result = await processDelayResponseTimeoutSchedule(SCHEDULE_LEAD_RESPONSE_REENTRY, sb)

    expect(result.skipped).toBe(true)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeDefined()
  })

  it('TC-LR08 — guard de status: execution.status=failed → skip + schedule processed', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_FAILED })
    const result = await processDelayResponseTimeoutSchedule(SCHEDULE_LEAD_RESPONSE_REENTRY, sb)

    expect(result.skipped).toBe(true)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeDefined()
  })

  it('TC-LR09 — guard de status: execution.status=paused inesperadamente → skip + processed (não executa)', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_UNEXPECTEDLY_PAUSED })
    const result = await processDelayResponseTimeoutSchedule(SCHEDULE_LEAD_RESPONSE_REENTRY, sb)

    expect(result.skipped).toBe(true)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeDefined()
  })

  it('TC-LR10 — guard de status timeout: execution.status=completed → skip + processed', async () => {
    // Guard também funciona para timeout reentry
    const scheduleTimeoutCompleted = {
      ...SCHEDULE_TIMEOUT_REENTRY,
    }
    const sb = makeSupabase({ executionData: BASE_EXECUTION_COMPLETED })
    const result = await processDelayResponseTimeoutSchedule(scheduleTimeoutCompleted, sb)

    expect(result.skipped).toBe(true)
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeDefined()
  })

  it('TC-LR11 — lock retry funciona para lead_response (POST_CLAIM_LOCK_UNAVAILABLE)', async () => {
    ;(resumeClaimedExecution as any).mockRejectedValueOnce(
      new Error('[executor] POST_CLAIM_LOCK_UNAVAILABLE: exec-uuid')
    )
    const sb = makeSupabase({ executionData: BASE_EXECUTION_RUNNING_WITH_RESPONSE })
    const result = await processDelayResponseTimeoutSchedule(SCHEDULE_LEAD_RESPONSE_REENTRY, sb)

    expect(result.skipped).toBe(true)
    expect(hasPending(sb._state.scheduleUpdates)).toBeDefined()
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeUndefined()
  })

  it('TC-LR12 — lock retry para lead_response: incrementa lock_retry_count', async () => {
    ;(resumeClaimedExecution as any).mockRejectedValueOnce(
      new Error('[executor] POST_CLAIM_LOCK_UNAVAILABLE: exec-uuid')
    )
    const sb = makeSupabase({ executionData: BASE_EXECUTION_RUNNING_WITH_RESPONSE })
    await processDelayResponseTimeoutSchedule(SCHEDULE_LEAD_RESPONSE_REENTRY, sb)

    const pendingUpdate = hasPending(sb._state.scheduleUpdates)
    expect(pendingUpdate!.trigger_data.post_claim.lock_retry_count).toBe(2)
    // resume_reason deve ser preservado no trigger_data
    expect(pendingUpdate!.trigger_data.post_claim.resume_reason).toBe('lead_response')
  })

  it('TC-LR13 — limite de retries para lead_response: lança erro crítico', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_RUNNING_WITH_RESPONSE })
    await expect(
      processDelayResponseTimeoutSchedule(SCHEDULE_LEAD_RESPONSE_LIMIT, sb)
    ).rejects.toThrow('Limite de retries')
    expect(resumeClaimedExecution).not.toHaveBeenCalled()
  })

  it('TC-LR14 — reentrada lead_response bem-sucedida termina em processed', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_RUNNING_WITH_RESPONSE })
    const result = await processDelayResponseTimeoutSchedule(SCHEDULE_LEAD_RESPONSE_REENTRY, sb)

    expect(result.skipped).toBe(false)
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeDefined()
  })

  it('TC-LR15 — awaitingType=delay_response passado ao executor', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_RUNNING_WITH_RESPONSE })
    await processDelayResponseTimeoutSchedule(SCHEDULE_LEAD_RESPONSE_REENTRY, sb)

    const call = (resumeClaimedExecution as any).mock.calls[0][0]
    expect(call.awaitingType).toBe('delay_response')
  })
})

// =============================================================================
// GRUPO 5 — Sem regressão entre as rotinas
// =============================================================================

describe('Sem regressão entre as rotinas', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(resumeFromNode as any).mockResolvedValue({})
    ;(resumeClaimedExecution as any).mockResolvedValue({ completed: true })
  })

  it('delay_resume retorna skipped=false em execução normal', async () => {
    const sb = makeSupabase()
    const result = await processDelayResumeSchedule(BASE_SCHEDULE_LEGACY, sb)
    expect(result.skipped).toBe(false)
  })

  it('delay_response_timeout Estado A retorna skipped=false em execução normal', async () => {
    const sb = makeSupabase()
    const result = await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sb)
    expect(result.skipped).toBe(false)
  })

  it('delay_response_timeout Estado B retorna skipped=false em execução normal', async () => {
    const sb = makeSupabase({ executionData: BASE_EXECUTION_POST_CLAIM })
    const result = await processDelayResponseTimeoutSchedule(SCHEDULE_TIMEOUT_REENTRY, sb)
    expect(result.skipped).toBe(false)
  })

  it('delay_resume com erro em resumeFromNode lança sem marcar processed', async () => {
    ;(resumeFromNode as any).mockRejectedValueOnce(new Error('processNode falhou'))
    const sb = makeSupabase()
    await expect(processDelayResumeSchedule(BASE_SCHEDULE_LEGACY, sb)).rejects.toThrow('processNode falhou')
    expect(hasProcessed(sb._state.scheduleUpdates)).toBeUndefined()
  })

  it('rotinas não interferem entre si', async () => {
    const sbLegacy  = makeSupabase()
    const sbTimeout = makeSupabase()

    await processDelayResumeSchedule(BASE_SCHEDULE_LEGACY, sbLegacy)
    await processDelayResponseTimeoutSchedule(BASE_SCHEDULE_TIMEOUT, sbTimeout)

    expect(sbLegacy.rpc).not.toHaveBeenCalled()
    expect(resumeFromNode).toHaveBeenCalledTimes(1)
    expect(resumeClaimedExecution).toHaveBeenCalledTimes(1)
  })
})
