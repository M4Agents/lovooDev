// =============================================================================
// Testes unitários — dispatchOpportunityTrigger.js
//
// Framework: vitest
// Estratégia: mocks completos de supabaseAdmin, triggerEvaluator e executor.
//   - Sem conexão com banco real
//   - Sem chamadas de rede
//   - Testa exclusivamente a lógica do dispatcher
//
// Para executar: npm test
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dispatchOpportunityStageChangedTrigger } from '../dispatchOpportunityTrigger.js'

// ---------------------------------------------------------------------------
// Mocks de módulos
// ---------------------------------------------------------------------------
vi.mock('../supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(),
}))

vi.mock('../triggerEvaluator.js', () => ({
  matchesTriggerConditions: vi.fn(),
}))

vi.mock('../executor.js', () => ({
  createExecution:  vi.fn(),
  processFlowAsync: vi.fn(),
}))

import { getSupabaseAdmin }           from '../supabaseAdmin.js'
import { matchesTriggerConditions }   from '../triggerEvaluator.js'
import { createExecution, processFlowAsync } from '../executor.js'

// ---------------------------------------------------------------------------
// Fábrica de mock Supabase
//
// Suporta configuração de:
//   flows         — lista de flows retornada por automation_flows
//   flowsError    — erro ao buscar flows
//   existing      — execution encontrada na dedup (ou null)
//   dedupError    — erro no dedup
// ---------------------------------------------------------------------------
function makeSupabase({
  flows       = [],
  flowsError  = null,
  existing    = null,
  dedupError  = null,
} = {}) {
  const maybeSingleDedup = vi.fn().mockResolvedValue({ data: existing, error: dedupError })
  const limitDedup       = vi.fn().mockReturnValue({ maybeSingle: maybeSingleDedup })
  const gteDedup         = vi.fn().mockReturnValue({ limit: limitDedup })
  const eqDedupOppId     = vi.fn().mockReturnValue({ gte: gteDedup })
  const eqDedupFlowId    = vi.fn().mockReturnValue({ eq: eqDedupOppId })
  const eqDedupCompany   = vi.fn().mockReturnValue({ eq: eqDedupFlowId })
  const selectDedup      = vi.fn().mockReturnValue({ eq: eqDedupCompany })

  const eqFlowsActive    = vi.fn().mockResolvedValue({ data: flows, error: flowsError })
  const eqFlowsCompany   = vi.fn().mockReturnValue({ eq: eqFlowsActive })
  const selectFlows      = vi.fn().mockReturnValue({ eq: eqFlowsCompany })

  const from = vi.fn((table) => {
    if (table === 'automation_flows')     return { select: selectFlows }
    if (table === 'automation_executions') return { select: selectDedup }
    return {}
  })

  return {
    from,
    _mocks: {
      from,
      selectFlows, eqFlowsCompany, eqFlowsActive,
      selectDedup, eqDedupCompany, eqDedupFlowId, eqDedupOppId, maybeSingleDedup,
    },
  }
}

// ---------------------------------------------------------------------------
// Flow base
// ---------------------------------------------------------------------------
const BASE_FLOW = { id: 'flow-uuid', name: 'Meu Flow', nodes: [], edges: [], trigger_operator: 'OR', is_over_plan: false }

// ---------------------------------------------------------------------------
// Parâmetros base válidos
// ---------------------------------------------------------------------------
const BASE_PARAMS = {
  companyId:    'company-uuid',
  opportunityId: 'opp-uuid',
  leadId:       42,
  oldStageId:   'stage-old-uuid',
  newStageId:   'stage-new-uuid',
  funnelId:     'funnel-uuid',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getExecution(id = 'exec-uuid') {
  return { id, company_id: 'company-uuid', trigger_data: {}, lead_id: 42, opportunity_id: 'opp-uuid' }
}

// =============================================================================
// GRUPO 1 — Validação de parâmetros obrigatórios
// =============================================================================
describe('dispatchOpportunityStageChangedTrigger — validação de parâmetros', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('TC01 — retorna sem erro quando companyId está ausente', async () => {
    await expect(
      dispatchOpportunityStageChangedTrigger({ ...BASE_PARAMS, companyId: undefined })
    ).resolves.toBeUndefined()
    expect(getSupabaseAdmin).not.toHaveBeenCalled()
  })

  it('TC01b — retorna sem erro quando opportunityId está ausente', async () => {
    await expect(
      dispatchOpportunityStageChangedTrigger({ ...BASE_PARAMS, opportunityId: undefined })
    ).resolves.toBeUndefined()
    expect(getSupabaseAdmin).not.toHaveBeenCalled()
  })
})

// =============================================================================
// GRUPO 2 — Guard de mudança real de etapa
// =============================================================================
describe('dispatchOpportunityStageChangedTrigger — guard de etapa', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSupabaseAdmin.mockReturnValue(makeSupabase({ flows: [BASE_FLOW] }))
    matchesTriggerConditions.mockReturnValue(true)
    createExecution.mockResolvedValue(getExecution())
    processFlowAsync.mockResolvedValue(undefined)
  })

  it('TC02 — não dispara quando oldStageId === newStageId', async () => {
    await dispatchOpportunityStageChangedTrigger({
      ...BASE_PARAMS,
      oldStageId: 'stage-same',
      newStageId: 'stage-same',
    })
    expect(createExecution).not.toHaveBeenCalled()
    expect(processFlowAsync).not.toHaveBeenCalled()
  })

  it('TC03 — aceita oldStageId null (cross-funnel sem posição anterior)', async () => {
    const supa = makeSupabase({ flows: [BASE_FLOW] })
    await dispatchOpportunityStageChangedTrigger(
      { ...BASE_PARAMS, oldStageId: null },
      supa
    )
    expect(createExecution).toHaveBeenCalled()
  })
})

// =============================================================================
// GRUPO 3 — Isolamento multi-tenant
// =============================================================================
describe('dispatchOpportunityStageChangedTrigger — multi-tenant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    matchesTriggerConditions.mockReturnValue(true)
    createExecution.mockResolvedValue(getExecution())
    processFlowAsync.mockResolvedValue(undefined)
  })

  it('TC04 — busca flows filtrando por company_id', async () => {
    const supa = makeSupabase({ flows: [BASE_FLOW] })
    await dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)
    const eqFlowsCompany = supa._mocks.eqFlowsCompany
    expect(eqFlowsCompany).toHaveBeenCalledWith('company_id', 'company-uuid')
  })

  it('TC05 — busca apenas flows ativos (is_active = true)', async () => {
    const supa = makeSupabase({ flows: [BASE_FLOW] })
    await dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)
    const eqFlowsActive = supa._mocks.eqFlowsActive
    expect(eqFlowsActive).toHaveBeenCalledWith('is_active', true)
  })
})

// =============================================================================
// GRUPO 4 — Deduplicação
// =============================================================================
describe('dispatchOpportunityStageChangedTrigger — deduplicação', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    matchesTriggerConditions.mockReturnValue(true)
    createExecution.mockResolvedValue(getExecution())
    processFlowAsync.mockResolvedValue(undefined)
  })

  it('TC06 — dedup filtra por company_id, flow_id e opportunity_id', async () => {
    const supa = makeSupabase({ flows: [BASE_FLOW], existing: null })
    await dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)

    const eqDedupCompany = supa._mocks.eqDedupCompany
    const eqDedupFlowId  = supa._mocks.eqDedupFlowId
    const eqDedupOppId   = supa._mocks.eqDedupOppId

    expect(eqDedupCompany).toHaveBeenCalledWith('company_id', 'company-uuid')
    expect(eqDedupFlowId).toHaveBeenCalledWith('flow_id', 'flow-uuid')
    expect(eqDedupOppId).toHaveBeenCalledWith('opportunity_id', 'opp-uuid')
  })

  it('TC07 — dedup não usa lead_id como chave principal', async () => {
    const supa = makeSupabase({ flows: [BASE_FLOW], existing: null })
    await dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)

    const eqDedupOppId = supa._mocks.eqDedupOppId
    const calls = eqDedupOppId.mock.calls
    const usesLeadId = calls.some(([field]) => field === 'lead_id')
    expect(usesLeadId).toBe(false)
  })

  it('TC08 — não executa quando dedup encontra execution recente', async () => {
    const supa = makeSupabase({ flows: [BASE_FLOW], existing: { id: 'existing-exec' } })
    await dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)
    expect(createExecution).not.toHaveBeenCalled()
    expect(processFlowAsync).not.toHaveBeenCalled()
  })
})

// =============================================================================
// GRUPO 5 — Contrato do evento e payload
// =============================================================================
describe('dispatchOpportunityStageChangedTrigger — contrato do evento', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    matchesTriggerConditions.mockReturnValue(true)
    createExecution.mockResolvedValue(getExecution())
    processFlowAsync.mockResolvedValue(undefined)
  })

  it('TC09 — envia lead_id no root de triggerData', async () => {
    const supa = makeSupabase({ flows: [BASE_FLOW] })
    await dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)

    const triggerData = createExecution.mock.calls[0][1]
    expect(triggerData.lead_id).toBe(42)
  })

  it('TC10 — envia funnel_id dentro de triggerData.opportunity', async () => {
    const supa = makeSupabase({ flows: [BASE_FLOW] })
    await dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)

    const triggerData = createExecution.mock.calls[0][1]
    expect(triggerData.opportunity?.funnel_id).toBe('funnel-uuid')
  })

  it('TC11 — envia opportunityValue em opportunity.value quando disponível', async () => {
    const supa = makeSupabase({ flows: [BASE_FLOW] })
    await dispatchOpportunityStageChangedTrigger(
      { ...BASE_PARAMS, opportunityValue: 5000 },
      supa
    )
    const triggerData = createExecution.mock.calls[0][1]
    expect(triggerData.opportunity?.value).toBe(5000)
  })

  it('TC11b — preserva opportunityValue = 0 no payload (zero não é descartado)', async () => {
    const supa = makeSupabase({ flows: [BASE_FLOW] })
    await dispatchOpportunityStageChangedTrigger(
      { ...BASE_PARAMS, opportunityValue: 0 },
      supa
    )
    const triggerData = createExecution.mock.calls[0][1]
    expect(triggerData.opportunity?.value).toBe(0)
  })

  it('TC12 — não inclui opportunity.value quando opportunityValue não é fornecido', async () => {
    const supa = makeSupabase({ flows: [BASE_FLOW] })
    await dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)

    const triggerData = createExecution.mock.calls[0][1]
    expect('value' in (triggerData.opportunity ?? {})).toBe(false)
  })

  it('TC13 — passa companyId correto para createExecution', async () => {
    const supa = makeSupabase({ flows: [BASE_FLOW] })
    await dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)

    expect(createExecution).toHaveBeenCalledWith(
      BASE_FLOW,
      expect.objectContaining({ opportunity_id: 'opp-uuid', lead_id: 42 }),
      'company-uuid',
      supa
    )
  })
})

// =============================================================================
// GRUPO 6 — Enforcement de plano
// =============================================================================
describe('dispatchOpportunityStageChangedTrigger — enforcement de plano', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    matchesTriggerConditions.mockReturnValue(true)
  })

  it('TC14 — não executa flow com is_over_plan = true', async () => {
    const overPlanFlow = { ...BASE_FLOW, is_over_plan: true }
    const supa = makeSupabase({ flows: [overPlanFlow] })
    await dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)
    expect(createExecution).not.toHaveBeenCalled()
    expect(processFlowAsync).not.toHaveBeenCalled()
  })
})

// =============================================================================
// GRUPO 7 — Matching e execução
// =============================================================================
describe('dispatchOpportunityStageChangedTrigger — matching e execução', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('TC15 — não executa flow sem correspondência de trigger', async () => {
    matchesTriggerConditions.mockReturnValue(false)
    const supa = makeSupabase({ flows: [BASE_FLOW] })
    await dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)
    expect(createExecution).not.toHaveBeenCalled()
  })

  it('TC16 — chama processFlowAsync com await quando execution existe', async () => {
    matchesTriggerConditions.mockReturnValue(true)
    createExecution.mockResolvedValue(getExecution())
    processFlowAsync.mockResolvedValue(undefined)

    const supa = makeSupabase({ flows: [BASE_FLOW] })
    await dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)
    expect(processFlowAsync).toHaveBeenCalledTimes(1)
    expect(processFlowAsync).toHaveBeenCalledWith(BASE_FLOW, getExecution(), supa)
  })

  it('TC17 — não chama processFlowAsync quando createExecution retorna null', async () => {
    matchesTriggerConditions.mockReturnValue(true)
    createExecution.mockResolvedValue(null)

    const supa = makeSupabase({ flows: [BASE_FLOW] })
    await dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)
    expect(processFlowAsync).not.toHaveBeenCalled()
  })
})

// =============================================================================
// GRUPO 8 — Isolamento de erros
// =============================================================================
describe('dispatchOpportunityStageChangedTrigger — isolamento de erros', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    matchesTriggerConditions.mockReturnValue(true)
  })

  it('TC18 — erro em um flow não impede o próximo', async () => {
    const flow2 = { ...BASE_FLOW, id: 'flow-uuid-2' }

    createExecution
      .mockRejectedValueOnce(new Error('falha no flow 1'))
      .mockResolvedValueOnce(getExecution('exec-2'))
    processFlowAsync.mockResolvedValue(undefined)

    const supa = makeSupabase({ flows: [BASE_FLOW, flow2] })
    await expect(
      dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)
    ).resolves.toBeUndefined()

    expect(processFlowAsync).toHaveBeenCalledTimes(1)
  })

  it('TC19 — erro global não propaga para o caller', async () => {
    const supa = makeSupabase({ flowsError: new Error('DB offline') })
    await expect(
      dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)
    ).resolves.toBeUndefined()
  })

  it('TC20 — erro ao buscar flows retorna sem execução', async () => {
    const supa = makeSupabase({ flowsError: { message: 'connection refused' } })
    await dispatchOpportunityStageChangedTrigger(BASE_PARAMS, supa)
    expect(createExecution).not.toHaveBeenCalled()
    expect(processFlowAsync).not.toHaveBeenCalled()
  })
})
