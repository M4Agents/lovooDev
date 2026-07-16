// =============================================================================
// Testes unitários — delayHandler.js
//
// Framework: vitest
// Estratégia: mock completo do cliente supabase.
//   - Sem conexão com banco real
//   - Sem chamadas de rede
//   - Testa exclusivamente a lógica do handler
//
// Para executar: npm test
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pauseAtDelay } from '../delayHandler.js'

// ---------------------------------------------------------------------------
// Fábrica de mock Supabase
//
// scheduleResult → { data, error } retornado pelo .single() do insert de schedule
// execResult     → { error } retornado pelo .update() da execução
// deleteResult   → { error } retornado pelo .delete() do rollback
// ---------------------------------------------------------------------------
function makeSupabase({
  scheduleResult = { data: { id: 'sched-uuid' }, error: null },
  execResult     = { error: null },
  deleteResult   = { error: null },
} = {}) {
  // --- schedules insert chain ---
  const single       = vi.fn().mockResolvedValue(scheduleResult)
  const selectInsert = vi.fn().mockReturnValue({ single })
  const insert       = vi.fn().mockReturnValue({ select: selectInsert })

  // --- schedules delete chain ---
  const eqDeleteCompany = vi.fn().mockResolvedValue(deleteResult)
  const eqDeleteId      = vi.fn().mockReturnValue({ eq: eqDeleteCompany })
  const deleteFn        = vi.fn().mockReturnValue({ eq: eqDeleteId })

  // --- executions update chain ---
  const eqExec  = vi.fn().mockResolvedValue(execResult)
  const update  = vi.fn().mockReturnValue({ eq: eqExec })

  const from = vi.fn((table) => {
    if (table === 'automation_schedules') return { insert, delete: deleteFn }
    if (table === 'automation_executions') return { update }
    return {}
  })

  return {
    from,
    _mocks: { from, insert, single, selectInsert, deleteFn, eqDeleteId, eqDeleteCompany, update, eqExec },
  }
}

// ---------------------------------------------------------------------------
// Contexto e nó base
// ---------------------------------------------------------------------------
const BASE_CONTEXT = {
  executionId: 'exec-uuid',
  flowId:      'flow-uuid',
  companyId:   'company-uuid',
  variables:   { existingVar: 'preserved' },
}

function makeNode(configOverride = {}) {
  return {
    id:   'node-delay-uuid',
    data: {
      config: {
        duration: 5,
        unit:     'minutes',
        ...configOverride,
      },
    },
  }
}

// =============================================================================
// GRUPO 1 — Modo legado (wait_mode ausente ou "time")
// =============================================================================
describe('pauseAtDelay — modo legado', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC01 — wait_mode ausente: usa entity_type delay_resume', async () => {
    const supabase = makeSupabase()
    const node     = makeNode()

    await pauseAtDelay(node, BASE_CONTEXT, supabase)

    const insertCall = supabase._mocks.insert.mock.calls[0][0]
    expect(insertCall.entity_type).toBe('delay_resume')
  })

  it('TC02 — wait_mode = "time": usa entity_type delay_resume', async () => {
    const supabase = makeSupabase()
    const node     = makeNode({ wait_mode: 'time' })

    await pauseAtDelay(node, BASE_CONTEXT, supabase)

    const insertCall = supabase._mocks.insert.mock.calls[0][0]
    expect(insertCall.entity_type).toBe('delay_resume')
  })

  it('TC15 — legado não cria _awaiting_delay_response nas variables', async () => {
    const supabase = makeSupabase()
    const node     = makeNode()

    await pauseAtDelay(node, BASE_CONTEXT, supabase)

    // O update da execução não deve conter _awaiting_delay_response
    const updateCall = supabase._mocks.update.mock.calls[0][0]
    expect(updateCall.variables).toBeUndefined()
  })

  it('TC10 — duração inválida (legado) retorna skipped, não cria schedule', async () => {
    const supabase = makeSupabase()
    const node     = makeNode({ duration: -1 })

    const result = await pauseAtDelay(node, BASE_CONTEXT, supabase)

    expect(result.skipped).toBe(true)
    expect(supabase._mocks.insert).not.toHaveBeenCalled()
    expect(supabase._mocks.update).not.toHaveBeenCalled()
  })
})

// =============================================================================
// GRUPO 2 — Modo time_or_response
// =============================================================================
describe('pauseAtDelay — modo time_or_response', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC03 — cria schedule com entity_type delay_response_timeout', async () => {
    const supabase = makeSupabase()
    const node     = makeNode({ wait_mode: 'time_or_response' })

    await pauseAtDelay(node, BASE_CONTEXT, supabase)

    const insertCall = supabase._mocks.insert.mock.calls[0][0]
    expect(insertCall.entity_type).toBe('delay_response_timeout')
  })

  it('TC04 — marcador contém node_id correto', async () => {
    const supabase = makeSupabase()
    const node     = makeNode({ wait_mode: 'time_or_response' })

    await pauseAtDelay(node, BASE_CONTEXT, supabase)

    const updateCall = supabase._mocks.update.mock.calls[0][0]
    expect(updateCall.variables._awaiting_delay_response.node_id).toBe('node-delay-uuid')
  })

  it('TC05 — marcador contém schedule_id correto', async () => {
    const supabase = makeSupabase({ scheduleResult: { data: { id: 'sched-xyz' }, error: null } })
    const node     = makeNode({ wait_mode: 'time_or_response' })

    await pauseAtDelay(node, BASE_CONTEXT, supabase)

    const updateCall = supabase._mocks.update.mock.calls[0][0]
    expect(updateCall.variables._awaiting_delay_response.schedule_id).toBe('sched-xyz')
  })

  it('TC06 — scheduled_for do schedule corresponde a expires_at do marcador', async () => {
    const supabase = makeSupabase()
    const node     = makeNode({ wait_mode: 'time_or_response' })

    await pauseAtDelay(node, BASE_CONTEXT, supabase)

    const insertCall = supabase._mocks.insert.mock.calls[0][0]
    const updateCall = supabase._mocks.update.mock.calls[0][0]

    expect(insertCall.scheduled_for).toBe(updateCall.variables._awaiting_delay_response.expires_at)
  })

  it('TC07 — variáveis existentes são preservadas no merge', async () => {
    const supabase = makeSupabase()
    const node     = makeNode({ wait_mode: 'time_or_response' })

    await pauseAtDelay(node, BASE_CONTEXT, supabase)

    const updateCall = supabase._mocks.update.mock.calls[0][0]
    expect(updateCall.variables.existingVar).toBe('preserved')
  })

  it('TC08 — response_variable configurada é salva no marcador', async () => {
    const supabase = makeSupabase()
    const node     = makeNode({ wait_mode: 'time_or_response', response_variable: 'resposta_lead' })

    await pauseAtDelay(node, BASE_CONTEXT, supabase)

    const updateCall = supabase._mocks.update.mock.calls[0][0]
    expect(updateCall.variables._awaiting_delay_response.response_variable).toBe('resposta_lead')
  })

  it('TC09 — response_variable ausente salva null no marcador', async () => {
    const supabase = makeSupabase()
    const node     = makeNode({ wait_mode: 'time_or_response' })

    await pauseAtDelay(node, BASE_CONTEXT, supabase)

    const updateCall = supabase._mocks.update.mock.calls[0][0]
    expect(updateCall.variables._awaiting_delay_response.response_variable).toBeNull()
  })

  it('TC10b — duração inválida não cria schedule', async () => {
    const supabase = makeSupabase()
    const node     = makeNode({ wait_mode: 'time_or_response', duration: 0 })

    const result = await pauseAtDelay(node, BASE_CONTEXT, supabase)

    expect(result.skipped).toBe(true)
    expect(supabase._mocks.insert).not.toHaveBeenCalled()
    expect(supabase._mocks.update).not.toHaveBeenCalled()
  })

  it('TC11 — falha ao criar schedule não pausa execução', async () => {
    const supabase = makeSupabase({
      scheduleResult: { data: null, error: { message: 'DB unavailable' } },
    })
    const node = makeNode({ wait_mode: 'time_or_response' })

    await expect(pauseAtDelay(node, BASE_CONTEXT, supabase)).rejects.toThrow('delay_response_timeout')
    expect(supabase._mocks.update).not.toHaveBeenCalled()
  })

  it('TC12 — falha ao pausar execução tenta rollback do schedule', async () => {
    const supabase = makeSupabase({
      execResult: { error: { message: 'update failed' } },
    })
    const node = makeNode({ wait_mode: 'time_or_response' })

    await expect(pauseAtDelay(node, BASE_CONTEXT, supabase)).rejects.toThrow()
    expect(supabase._mocks.deleteFn).toHaveBeenCalled()
  })

  it('TC13 — rollback usa schedule_id e company_id corretos', async () => {
    const supabase = makeSupabase({
      scheduleResult: { data: { id: 'sched-rollback' }, error: null },
      execResult:     { error: { message: 'pause failed' } },
    })
    const node = makeNode({ wait_mode: 'time_or_response' })

    await expect(pauseAtDelay(node, BASE_CONTEXT, supabase)).rejects.toThrow()

    expect(supabase._mocks.eqDeleteId.mock.calls[0][0]).toBe('id')
    expect(supabase._mocks.eqDeleteId.mock.calls[0][1]).toBe('sched-rollback')
    expect(supabase._mocks.eqDeleteCompany.mock.calls[0][0]).toBe('company_id')
    expect(supabase._mocks.eqDeleteCompany.mock.calls[0][1]).toBe('company-uuid')
  })

  it('TC14 — falha no rollback registra erro e propaga erro original', async () => {
    const supabase = makeSupabase({
      execResult:   { error: { message: 'pause failed' } },
      deleteResult: { error: { message: 'rollback also failed' } },
    })
    const node = makeNode({ wait_mode: 'time_or_response' })

    await expect(pauseAtDelay(node, BASE_CONTEXT, supabase)).rejects.toThrow('pause failed')
  })

  it('node_id no marcador === entity_id no schedule', async () => {
    const supabase = makeSupabase()
    const node     = makeNode({ wait_mode: 'time_or_response' })

    await pauseAtDelay(node, BASE_CONTEXT, supabase)

    const insertCall = supabase._mocks.insert.mock.calls[0][0]
    const updateCall = supabase._mocks.update.mock.calls[0][0]

    expect(insertCall.entity_id).toBe(updateCall.variables._awaiting_delay_response.node_id)
  })

  it('schedule usa company_id do context', async () => {
    const supabase = makeSupabase()
    const node     = makeNode({ wait_mode: 'time_or_response' })

    await pauseAtDelay(node, BASE_CONTEXT, supabase)

    const insertCall = supabase._mocks.insert.mock.calls[0][0]
    expect(insertCall.company_id).toBe('company-uuid')
  })

  it('marcador contém started_at e expires_at como strings ISO', async () => {
    const supabase = makeSupabase()
    const node     = makeNode({ wait_mode: 'time_or_response' })

    await pauseAtDelay(node, BASE_CONTEXT, supabase)

    const marker = supabase._mocks.update.mock.calls[0][0].variables._awaiting_delay_response
    expect(typeof marker.started_at).toBe('string')
    expect(typeof marker.expires_at).toBe('string')
    expect(() => new Date(marker.started_at)).not.toThrow()
    expect(() => new Date(marker.expires_at)).not.toThrow()
  })

  it('retorno tem paused=true e scheduleId correto', async () => {
    const supabase = makeSupabase({ scheduleResult: { data: { id: 'sched-ret' }, error: null } })
    const node     = makeNode({ wait_mode: 'time_or_response' })

    const result = await pauseAtDelay(node, BASE_CONTEXT, supabase)

    expect(result.paused).toBe(true)
    expect(result.scheduleId).toBe('sched-ret')
  })
})
