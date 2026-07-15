// =============================================================================
// Testes unitários — messageBufferService.js
//
// Framework: vitest
// Estratégia: mocks completos do cliente Supabase via fábricas.
//   - Sem conexão com banco real
//   - Sem chamadas de rede
//   - Testa exclusivamente a lógica do service layer
//
// Para executar: npm test
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  enqueueMessage,
  claimDueBatches,
  loadBatchMessages,
  markBatchProcessed,
  markBatchRetry,
  markBatchFailed,
  markBatchCancelled,
  recoverStaleBatches,
  rescheduleBatch,
  MessageBufferValidationError,
  MessageBufferTenantError,
  MessageBufferDuplicateStateError,
  MessageBufferLimitError,
  MessageBufferDatabaseError,
  MessageBufferStateError,
} from '../messageBufferService.js'

// ---------------------------------------------------------------------------
// Silenciar logs durante os testes
// ---------------------------------------------------------------------------
vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})

// ---------------------------------------------------------------------------
// Constantes de teste
// ---------------------------------------------------------------------------
const COMPANY_ID      = 'company-uuid-1'
const CONVERSATION_ID = 'conv-uuid-1'
const BATCH_ID        = 'batch-uuid-1'
const BATCH_MSG_ID    = 'batch-msg-uuid-1'
const INSTANCE_ID     = 'instance-uuid-1'
const PROVIDER_MSG_ID = 'wamid.abc123'
const LOCKED_AT       = '2026-07-14T15:59:00.123456+00:00'

const BASE_ENQUEUE_PARAMS = {
  companyId:       COMPANY_ID,
  conversationId:  CONVERSATION_ID,
  windowSeconds:   5,
  providerMessageId: PROVIDER_MSG_ID,
  instanceId:      INSTANCE_ID,
}

const BASE_LIFECYCLE_PARAMS = {
  companyId: COMPANY_ID,
  batchId:   BATCH_ID,
  lockedAt:  LOCKED_AT,
}

// ---------------------------------------------------------------------------
// Fábrica de mock RPC — agent_message_enqueue_v1
// ---------------------------------------------------------------------------
function makeRpcEnqueueSuccess(overrides = {}) {
  return {
    ok:              true,
    inserted:        true,
    duplicate:       false,
    batch_id:        BATCH_ID,
    batch_message_id: BATCH_MSG_ID,
    batch_status:    'pending',
    deadline_at:     '2026-07-14T16:00:00.000Z',
    max_deadline_at: '2026-07-14T16:02:00.000Z',
    message_count:   1,
    total_text_length: 0,
    reason:          'buffered',
    ...overrides,
  }
}

function makeRpcEnqueueDuplicate() {
  return {
    ok:              true,
    inserted:        false,
    duplicate:       true,
    batch_id:        BATCH_ID,
    batch_message_id: BATCH_MSG_ID,
    reason:          'already_buffered',
  }
}

// ---------------------------------------------------------------------------
// Fábricas de mock Supabase
// ---------------------------------------------------------------------------

/** Mock para rpc() do Supabase */
function makeSvcRpc({ data = null, error = null } = {}) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
    from: vi.fn(),
  }
}

/** Mock para from().select().eq().eq().eq().order().order().order() */
function makeSvcFrom({ data = null, error = null } = {}) {
  const orderFn3  = vi.fn().mockResolvedValue({ data, error })
  const orderFn2  = vi.fn().mockReturnValue({ order: orderFn3 })
  const orderFn1  = vi.fn().mockReturnValue({ order: orderFn2 })
  const eqBatch   = vi.fn().mockReturnValue({ order: orderFn1 })
  const eqConv    = vi.fn().mockReturnValue({ eq: eqBatch })
  const eqCompany = vi.fn().mockReturnValue({ eq: eqConv })
  const selectFn  = vi.fn().mockReturnValue({ eq: eqCompany })
  const fromFn    = vi.fn().mockReturnValue({ select: selectFn })

  return {
    rpc: vi.fn(),
    from: fromFn,
    _mocks: { fromFn, selectFn, eqCompany, eqConv, eqBatch, orderFn1, orderFn2, orderFn3 },
  }
}

/**
 * Mock de lote retornado pela RPC (snake_case, como o banco).
 * Inclui todos os campos, incluindo lifecycle fields.
 */
function makeBatchRow(overrides = {}) {
  return {
    id:                    BATCH_ID,
    company_id:            COMPANY_ID,
    conversation_id:       CONVERSATION_ID,
    enqueue_assignment_id: null,
    channel:               'whatsapp',
    status:                'processing',
    deadline_at:           '2026-07-14T16:00:00.000Z',
    next_attempt_at:       null,
    locked_at:             LOCKED_AT,
    attempts:              1,
    message_count:         2,
    total_text_length:     25,
    // Lifecycle fields
    last_error:            null,
    last_error_code:       null,
    processed_at:          null,
    cancelled_at:          null,
    cancellation_reason:   null,
    first_message_at:      '2026-07-14T15:58:00.000Z',
    last_message_at:       '2026-07-14T15:59:00.000Z',
    max_deadline_at:       '2026-07-14T16:02:00.000Z',
    created_at:            '2026-07-14T15:58:00.000Z',
    updated_at:            '2026-07-14T15:59:00.000Z',
    ...overrides,
  }
}

// =============================================================================
// GRUPO 1 — enqueueMessage: mapeamento de parâmetros
// =============================================================================
describe('enqueueMessage — mapeamento de parâmetros', () => {
  it('TC01 — mapeia todos os parâmetros para p_* corretamente', async () => {
    const svc = makeSvcRpc({ data: makeRpcEnqueueSuccess() })

    await enqueueMessage({
      svc,
      companyId:              COMPANY_ID,
      conversationId:         CONVERSATION_ID,
      assignmentId:           'assign-uuid',
      channel:                'whatsapp',
      windowSeconds:          5,
      maxBatchDurationSeconds: 120,
      providerMessageId:      PROVIDER_MSG_ID,
      instanceId:             INSTANCE_ID,
      messageText:            'Olá',
      messageType:            'text',
      providerTimestamp:      '2026-07-14T15:59:00.000Z',
      receivedAt:             '2026-07-14T15:59:01.000Z',
      payload:                { foo: 'bar' },
    })

    expect(svc.rpc).toHaveBeenCalledWith('agent_message_enqueue_v1', {
      p_company_id:                 COMPANY_ID,
      p_conversation_id:            CONVERSATION_ID,
      p_window_seconds:             5,
      p_provider_message_id:        PROVIDER_MSG_ID,
      p_instance_id:                INSTANCE_ID,
      p_assignment_id:              'assign-uuid',
      p_channel:                    'whatsapp',
      p_max_batch_duration_seconds: 120,
      p_message_text:               'Olá',
      p_message_type:               'text',
      p_provider_timestamp:         '2026-07-14T15:59:00.000Z',
      p_received_at:                '2026-07-14T15:59:01.000Z',
      p_payload:                    { foo: 'bar' },
    })
  })
})

// =============================================================================
// GRUPO 2 — enqueueMessage: resposta normalizada (mensagem nova)
// =============================================================================
describe('enqueueMessage — mensagem nova normalizada', () => {
  it('TC02 — retorna objeto normalizado com inserted=true', async () => {
    const svc = makeSvcRpc({ data: makeRpcEnqueueSuccess() })

    const result = await enqueueMessage({ svc, ...BASE_ENQUEUE_PARAMS })

    expect(result).toMatchObject({
      ok:              true,
      inserted:        true,
      duplicate:       false,
      batchId:         BATCH_ID,
      batchMessageId:  BATCH_MSG_ID,
      batchStatus:     'pending',
      deadlineAt:      expect.any(String),
      maxDeadlineAt:   expect.any(String),
      messageCount:    1,
      totalTextLength: 0,
      reason:          'buffered',
    })
  })
})

// =============================================================================
// GRUPO 3 — enqueueMessage: duplicata normalizada
// =============================================================================
describe('enqueueMessage — duplicata normalizada', () => {
  it('TC03 — retorna objeto normalizado com duplicate=true', async () => {
    const svc = makeSvcRpc({ data: makeRpcEnqueueDuplicate() })

    const result = await enqueueMessage({ svc, ...BASE_ENQUEUE_PARAMS })

    expect(result).toMatchObject({
      ok:             true,
      inserted:       false,
      duplicate:      true,
      batchId:        BATCH_ID,
      batchMessageId: BATCH_MSG_ID,
      reason:         'already_buffered',
    })
  })
})

// =============================================================================
// GRUPO 4 — enqueueMessage: classificação de erros da RPC
// =============================================================================
describe('enqueueMessage — classificação de erros da RPC', () => {
  it('TC04 — INVALID_PARAM lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc({ error: { message: 'INVALID_PARAM: p_window_seconds deve ser inteiro entre 1 e 120' } })

    await expect(enqueueMessage({ svc, ...BASE_ENQUEUE_PARAMS }))
      .rejects.toBeInstanceOf(MessageBufferValidationError)
  })

  it('TC05 — TENANT_VIOLATION lança MessageBufferTenantError', async () => {
    const svc = makeSvcRpc({ error: { message: 'TENANT_VIOLATION: conversa nao encontrada ou nao pertence a empresa' } })

    await expect(enqueueMessage({ svc, ...BASE_ENQUEUE_PARAMS }))
      .rejects.toBeInstanceOf(MessageBufferTenantError)
  })

  it('TC06 — INCOMPATIBLE_STATE lança MessageBufferDuplicateStateError', async () => {
    const svc = makeSvcRpc({ error: { message: 'INCOMPATIBLE_STATE: mensagem ja registrada com result=skipped_no_rule' } })

    await expect(enqueueMessage({ svc, ...BASE_ENQUEUE_PARAMS }))
      .rejects.toBeInstanceOf(MessageBufferDuplicateStateError)
  })

  it('TC07 — DEDUP_INCONSISTENCY lança MessageBufferDuplicateStateError', async () => {
    const svc = makeSvcRpc({ error: { message: 'DEDUP_INCONSISTENCY: registro buffered sem batch_id' } })

    await expect(enqueueMessage({ svc, ...BASE_ENQUEUE_PARAMS }))
      .rejects.toBeInstanceOf(MessageBufferDuplicateStateError)
  })

  it('TC08 — BATCH_LIMIT_REACHED lança MessageBufferLimitError', async () => {
    const svc = makeSvcRpc({ error: { message: 'BATCH_LIMIT_REACHED: limite de mensagens por lote atingido' } })

    await expect(enqueueMessage({ svc, ...BASE_ENQUEUE_PARAMS }))
      .rejects.toBeInstanceOf(MessageBufferLimitError)
  })

  it('TC09 — erro técnico lança MessageBufferDatabaseError', async () => {
    const svc = makeSvcRpc({ error: { message: 'connection refused' } })

    await expect(enqueueMessage({ svc, ...BASE_ENQUEUE_PARAMS }))
      .rejects.toBeInstanceOf(MessageBufferDatabaseError)
  })

  it('TC09b — erro preserva cause original no campo cause', async () => {
    const originalError = { message: 'BATCH_LIMIT_REACHED: limite atingido' }
    const svc = makeSvcRpc({ error: originalError })

    try {
      await enqueueMessage({ svc, ...BASE_ENQUEUE_PARAMS })
    } catch (err) {
      expect(err.cause).toBe(originalError)
    }
  })
})

// =============================================================================
// GRUPO 5 — claimDueBatches: validação de limit
// =============================================================================
describe('claimDueBatches — validação de limit', () => {
  it('TC10 — limit = 0 lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc()
    await expect(claimDueBatches({ svc, limit: 0 }))
      .rejects.toBeInstanceOf(MessageBufferValidationError)
  })

  it('TC10b — limit = -1 lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc()
    await expect(claimDueBatches({ svc, limit: -1 }))
      .rejects.toBeInstanceOf(MessageBufferValidationError)
  })

  it('TC10c — limit = 101 lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc()
    await expect(claimDueBatches({ svc, limit: 101 }))
      .rejects.toBeInstanceOf(MessageBufferValidationError)
  })

  it('TC10d — limit = 1 é aceito', async () => {
    const svc = makeSvcRpc({ data: [] })
    await expect(claimDueBatches({ svc, limit: 1 })).resolves.toBeInstanceOf(Array)
  })

  it('TC10e — limit = 100 é aceito', async () => {
    const svc = makeSvcRpc({ data: [] })
    await expect(claimDueBatches({ svc, limit: 100 })).resolves.toBeInstanceOf(Array)
  })
})

// =============================================================================
// GRUPO 6 — claimDueBatches: mapeamento de resposta
// =============================================================================
describe('claimDueBatches — mapeamento de resposta', () => {
  it('TC11 — mapeia campos snake_case para camelCase corretamente', async () => {
    const row = makeBatchRow()
    const svc = makeSvcRpc({ data: [row] })

    const result = await claimDueBatches({ svc, limit: 20 })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id:                  BATCH_ID,
      companyId:           COMPANY_ID,
      conversationId:      CONVERSATION_ID,
      enqueueAssignmentId: null,
      channel:             'whatsapp',
      status:              'processing',
      deadlineAt:          expect.any(String),
      nextAttemptAt:       null,
      lockedAt:            expect.any(String),
      attempts:            1,
      messageCount:        2,
      totalTextLength:     25,
    })
  })

  it('TC11b — chama a RPC com p_limit correto', async () => {
    const svc = makeSvcRpc({ data: [] })
    await claimDueBatches({ svc, limit: 5 })
    expect(svc.rpc).toHaveBeenCalledWith('agent_message_batches_claim_v1', { p_limit: 5 })
  })

  it('TC12 — retorno vazio da RPC resulta em array vazio (não é erro)', async () => {
    const svc = makeSvcRpc({ data: [] })
    const result = await claimDueBatches({ svc })
    expect(result).toEqual([])
  })

  it('TC12b — data = null da RPC resulta em array vazio', async () => {
    const svc = makeSvcRpc({ data: null })
    const result = await claimDueBatches({ svc })
    expect(result).toEqual([])
  })
})

// =============================================================================
// GRUPO 7 — loadBatchMessages: filtros multi-tenant
// =============================================================================
describe('loadBatchMessages — filtros multi-tenant', () => {
  it('TC13 — aplica filtro company_id', async () => {
    const svc = makeSvcFrom({ data: [] })

    await loadBatchMessages({ svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID, batchId: BATCH_ID })

    expect(svc._mocks.eqCompany).toHaveBeenCalledWith('company_id', COMPANY_ID)
  })

  it('TC14 — aplica filtro conversation_id', async () => {
    const svc = makeSvcFrom({ data: [] })

    await loadBatchMessages({ svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID, batchId: BATCH_ID })

    expect(svc._mocks.eqConv).toHaveBeenCalledWith('conversation_id', CONVERSATION_ID)
  })

  it('TC15 — aplica filtro batch_id', async () => {
    const svc = makeSvcFrom({ data: [] })

    await loadBatchMessages({ svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID, batchId: BATCH_ID })

    expect(svc._mocks.eqBatch).toHaveBeenCalledWith('batch_id', BATCH_ID)
  })

  it('TC13b — companyId ausente lança MessageBufferValidationError', async () => {
    const svc = makeSvcFrom()
    await expect(loadBatchMessages({ svc, conversationId: CONVERSATION_ID, batchId: BATCH_ID }))
      .rejects.toBeInstanceOf(MessageBufferValidationError)
  })

  it('TC14b — conversationId ausente lança MessageBufferValidationError', async () => {
    const svc = makeSvcFrom()
    await expect(loadBatchMessages({ svc, companyId: COMPANY_ID, batchId: BATCH_ID }))
      .rejects.toBeInstanceOf(MessageBufferValidationError)
  })

  it('TC15b — batchId ausente lança MessageBufferValidationError', async () => {
    const svc = makeSvcFrom()
    await expect(loadBatchMessages({ svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID }))
      .rejects.toBeInstanceOf(MessageBufferValidationError)
  })
})

// =============================================================================
// GRUPO 8 — loadBatchMessages: ordenação determinística
// =============================================================================
describe('loadBatchMessages — ordenação determinística', () => {
  it('TC16 — aplica orderBy provider_timestamp ASC NULLS LAST como primeira ordenação', async () => {
    const svc = makeSvcFrom({ data: [] })

    await loadBatchMessages({ svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID, batchId: BATCH_ID })

    expect(svc._mocks.orderFn1).toHaveBeenCalledWith('provider_timestamp', { ascending: true, nullsFirst: false })
  })

  it('TC16b — aplica received_at ASC como segunda ordenação', async () => {
    const svc = makeSvcFrom({ data: [] })

    await loadBatchMessages({ svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID, batchId: BATCH_ID })

    expect(svc._mocks.orderFn2).toHaveBeenCalledWith('received_at', { ascending: true })
  })

  it('TC16c — aplica id ASC como terceira ordenação (tiebreaker)', async () => {
    const svc = makeSvcFrom({ data: [] })

    await loadBatchMessages({ svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID, batchId: BATCH_ID })

    expect(svc._mocks.orderFn3).toHaveBeenCalledWith('id', { ascending: true })
  })
})

// =============================================================================
// GRUPO 9 — loadBatchMessages: propagação de erro
// =============================================================================
describe('loadBatchMessages — propagação de erro', () => {
  it('TC17 — erro do Supabase lança MessageBufferDatabaseError', async () => {
    const svc = makeSvcFrom({ error: { message: 'connection refused' } })

    await expect(
      loadBatchMessages({ svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID, batchId: BATCH_ID })
    ).rejects.toBeInstanceOf(MessageBufferDatabaseError)
  })

  it('TC17b — erro preserva cause original', async () => {
    const originalError = { message: 'timeout' }
    const svc = makeSvcFrom({ error: originalError })

    try {
      await loadBatchMessages({ svc, companyId: COMPANY_ID, conversationId: CONVERSATION_ID, batchId: BATCH_ID })
    } catch (err) {
      expect(err.cause).toBe(originalError)
    }
  })
})

// =============================================================================
// GRUPO 10 — Logs: ausência de dados sensíveis (enqueue)
// =============================================================================
describe('Logs — campos proibidos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('TC18 — logs de enqueueMessage não contêm message_text', async () => {
    const svc = makeSvcRpc({ data: makeRpcEnqueueSuccess() })

    await enqueueMessage({
      svc,
      ...BASE_ENQUEUE_PARAMS,
      messageText: 'conteudo secreto da mensagem',
    })

    const allCalls = [
      ...console.log.mock.calls,
      ...console.error.mock.calls,
    ]

    const loggedText = allCalls
      .map((args) => JSON.stringify(args))
      .join('')

    expect(loggedText).not.toContain('conteudo secreto da mensagem')
  })

  it('TC18b — logs de enqueueMessage não contêm payload integral', async () => {
    const svc = makeSvcRpc({ data: makeRpcEnqueueSuccess() })

    await enqueueMessage({
      svc,
      ...BASE_ENQUEUE_PARAMS,
      payload: { secret_token: 'tok_abc123', data: 'dados sensiveis' },
    })

    const allCalls = [
      ...console.log.mock.calls,
      ...console.error.mock.calls,
    ]

    const loggedText = allCalls
      .map((args) => JSON.stringify(args))
      .join('')

    expect(loggedText).not.toContain('secret_token')
    expect(loggedText).not.toContain('tok_abc123')
  })
})

// =============================================================================
// GRUPO 11 — markBatchProcessed
// =============================================================================
describe('markBatchProcessed', () => {
  it('TC19 — mapeia parâmetros para a RPC corretamente', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'processed', locked_at: null, processed_at: '2026-07-14T16:00:00.000Z' })] })

    await markBatchProcessed({ svc, ...BASE_LIFECYCLE_PARAMS })

    expect(svc.rpc).toHaveBeenCalledWith('agent_message_batch_mark_processed_v1', {
      p_company_id: COMPANY_ID,
      p_batch_id:   BATCH_ID,
      p_locked_at:  LOCKED_AT,
    })
  })

  it('TC20 — retorna lote normalizado com status processed', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'processed', locked_at: null, processed_at: '2026-07-14T16:00:00.000Z' })] })

    const result = await markBatchProcessed({ svc, ...BASE_LIFECYCLE_PARAMS })

    expect(result).toMatchObject({
      id:        BATCH_ID,
      companyId: COMPANY_ID,
      status:    'processed',
    })
    expect(result.processedAt).toBeTruthy()
    expect(result.lockedAt).toBeNull()
  })

  it('TC21 — resultado vazio lança MessageBufferStateError (EMPTY_RPC_RESULT)', async () => {
    const svc = makeSvcRpc({ data: [] })

    const err = await markBatchProcessed({ svc, ...BASE_LIFECYCLE_PARAMS }).catch((e) => e)

    expect(err).toBeInstanceOf(MessageBufferStateError)
    expect(err.code).toBe('EMPTY_RPC_RESULT')
  })

  it('TC22 — CLAIM_MISMATCH é classificado como MessageBufferStateError', async () => {
    const svc = makeSvcRpc({ error: { message: 'CLAIM_MISMATCH: status ou locked_at incorreto.' } })

    const err = await markBatchProcessed({ svc, ...BASE_LIFECYCLE_PARAMS }).catch((e) => e)

    expect(err).toBeInstanceOf(MessageBufferStateError)
    expect(err.code).toBe('CLAIM_MISMATCH')
  })

  it('TC23 — BATCH_NOT_FOUND é classificado como MessageBufferTenantError', async () => {
    const svc = makeSvcRpc({ error: { message: 'BATCH_NOT_FOUND: lote nao encontrado para esta empresa' } })

    const err = await markBatchProcessed({ svc, ...BASE_LIFECYCLE_PARAMS }).catch((e) => e)

    expect(err).toBeInstanceOf(MessageBufferTenantError)
    expect(err.code).toBe('BATCH_NOT_FOUND')
  })

  it('TC24 — lockedAt ausente lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc()

    await expect(
      markBatchProcessed({ svc, companyId: COMPANY_ID, batchId: BATCH_ID, lockedAt: '' })
    ).rejects.toBeInstanceOf(MessageBufferValidationError)

    await expect(
      markBatchProcessed({ svc, companyId: COMPANY_ID, batchId: BATCH_ID })
    ).rejects.toBeInstanceOf(MessageBufferValidationError)
  })

  it('TC25 — preserva string literal de lockedAt sem conversão', async () => {
    const lockedAtPrecise = '2026-07-14T15:59:00.123456+00:00'
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'processed', locked_at: null })] })

    await markBatchProcessed({ svc, companyId: COMPANY_ID, batchId: BATCH_ID, lockedAt: lockedAtPrecise })

    expect(svc.rpc).toHaveBeenCalledWith('agent_message_batch_mark_processed_v1', {
      p_company_id: COMPANY_ID,
      p_batch_id:   BATCH_ID,
      p_locked_at:  lockedAtPrecise,
    })
  })
})

// =============================================================================
// GRUPO 12 — markBatchRetry
// =============================================================================
describe('markBatchRetry', () => {
  it('TC26 — mapeia parâmetros para a RPC corretamente', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'retry_pending', locked_at: null })] })

    await markBatchRetry({ svc, ...BASE_LIFECYCLE_PARAMS, errorCode: 'ERR_X', errorMessage: 'detalhe interno' })

    expect(svc.rpc).toHaveBeenCalledWith('agent_message_batch_mark_retry_v1', {
      p_company_id:    COMPANY_ID,
      p_batch_id:      BATCH_ID,
      p_locked_at:     LOCKED_AT,
      p_error_code:    'ERR_X',
      p_error_message: 'detalhe interno',
    })
  })

  it('TC27 — retorno retry_pending é aceito sem erro', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'retry_pending', locked_at: null })] })

    const result = await markBatchRetry({ svc, ...BASE_LIFECYCLE_PARAMS })

    expect(result.status).toBe('retry_pending')
  })

  it('TC28 — retorno failed é aceito (attempts >= 3)', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'failed', locked_at: null, attempts: 3 })] })

    const result = await markBatchRetry({ svc, ...BASE_LIFECYCLE_PARAMS })

    expect(result.status).toBe('failed')
  })

  it('TC29 — errorCode e errorMessage são encaminhados à RPC', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'retry_pending', locked_at: null })] })

    await markBatchRetry({
      svc,
      ...BASE_LIFECYCLE_PARAMS,
      errorCode:    'TIMEOUT',
      errorMessage: 'LLM nao respondeu em 30s',
    })

    const call = svc.rpc.mock.calls[0][1]
    expect(call.p_error_code).toBe('TIMEOUT')
    expect(call.p_error_message).toBe('LLM nao respondeu em 30s')
  })

  it('TC30 — logs não contêm errorMessage', async () => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'retry_pending', locked_at: null })] })

    await markBatchRetry({
      svc,
      ...BASE_LIFECYCLE_PARAMS,
      errorMessage: 'mensagem secreta de erro interno xpto',
    })

    const loggedText = [
      ...console.log.mock.calls,
      ...console.error.mock.calls,
    ].map((args) => JSON.stringify(args)).join('')

    expect(loggedText).not.toContain('mensagem secreta de erro interno xpto')
  })

  it('TC31 — erro funcional CLAIM_MISMATCH é classificado como MessageBufferStateError', async () => {
    const svc = makeSvcRpc({ error: { message: 'CLAIM_MISMATCH: status ou locked_at incorreto.' } })

    await expect(markBatchRetry({ svc, ...BASE_LIFECYCLE_PARAMS }))
      .rejects.toBeInstanceOf(MessageBufferStateError)
  })
})

// =============================================================================
// GRUPO 13 — markBatchFailed
// =============================================================================
describe('markBatchFailed', () => {
  it('TC32 — retorno failed é normalizado corretamente', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'failed', locked_at: null, last_error_code: 'PROC_ERR' })] })

    const result = await markBatchFailed({ svc, ...BASE_LIFECYCLE_PARAMS, errorCode: 'PROC_ERR' })

    expect(result.status).toBe('failed')
    expect(result.lockedAt).toBeNull()
    expect(result.lastErrorCode).toBe('PROC_ERR')
  })

  it('TC33 — estado inesperado lança MessageBufferStateError (UNEXPECTED_STATUS)', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'cancelled', locked_at: null })] })

    const err = await markBatchFailed({ svc, ...BASE_LIFECYCLE_PARAMS }).catch((e) => e)

    expect(err).toBeInstanceOf(MessageBufferStateError)
    expect(err.code).toBe('UNEXPECTED_STATUS')
  })

  it('TC34 — resultado vazio lança MessageBufferStateError (EMPTY_RPC_RESULT)', async () => {
    const svc = makeSvcRpc({ data: [] })

    const err = await markBatchFailed({ svc, ...BASE_LIFECYCLE_PARAMS }).catch((e) => e)

    expect(err).toBeInstanceOf(MessageBufferStateError)
    expect(err.code).toBe('EMPTY_RPC_RESULT')
  })
})

// =============================================================================
// GRUPO 14 — markBatchCancelled
// =============================================================================
describe('markBatchCancelled', () => {
  it('TC35 — retorno cancelled é normalizado corretamente', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({
      status:               'cancelled',
      locked_at:            null,
      cancelled_at:         '2026-07-14T16:00:00.000Z',
      cancellation_reason:  'teste',
    })] })

    const result = await markBatchCancelled({ svc, ...BASE_LIFECYCLE_PARAMS, reason: 'teste' })

    expect(result.status).toBe('cancelled')
    expect(result.cancelledAt).toBeTruthy()
    expect(result.cancellationReason).toBe('teste')
  })

  it('TC36 — estado inesperado lança MessageBufferStateError (UNEXPECTED_STATUS)', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'failed', locked_at: null })] })

    const err = await markBatchCancelled({ svc, ...BASE_LIFECYCLE_PARAMS }).catch((e) => e)

    expect(err).toBeInstanceOf(MessageBufferStateError)
    expect(err.code).toBe('UNEXPECTED_STATUS')
  })

  it('TC37 — logs não contêm o motivo integral', async () => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'cancelled', locked_at: null })] })

    await markBatchCancelled({
      svc,
      ...BASE_LIFECYCLE_PARAMS,
      reason: 'motivo confidencial de cancelamento xpto',
    })

    const loggedText = [
      ...console.log.mock.calls,
      ...console.error.mock.calls,
    ].map((args) => JSON.stringify(args)).join('')

    expect(loggedText).not.toContain('motivo confidencial de cancelamento xpto')
  })
})

// =============================================================================
// GRUPO 15 — recoverStaleBatches
// =============================================================================
describe('recoverStaleBatches', () => {
  it('TC38 — usa defaults p_stale_after_seconds=300 e p_limit=20', async () => {
    const svc = makeSvcRpc({ data: [] })

    await recoverStaleBatches({ svc })

    expect(svc.rpc).toHaveBeenCalledWith('agent_message_batches_recover_stale_v1', {
      p_stale_after_seconds: 300,
      p_limit:               20,
    })
  })

  it('TC39 — staleAfterSeconds < 60 lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc()
    await expect(recoverStaleBatches({ svc, staleAfterSeconds: 59 }))
      .rejects.toBeInstanceOf(MessageBufferValidationError)
  })

  it('TC40 — staleAfterSeconds > 3600 lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc()
    await expect(recoverStaleBatches({ svc, staleAfterSeconds: 3601 }))
      .rejects.toBeInstanceOf(MessageBufferValidationError)
  })

  it('TC41 — limit < 1 lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc()
    await expect(recoverStaleBatches({ svc, limit: 0 }))
      .rejects.toBeInstanceOf(MessageBufferValidationError)
  })

  it('TC42 — limit > 100 lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc()
    await expect(recoverStaleBatches({ svc, limit: 101 }))
      .rejects.toBeInstanceOf(MessageBufferValidationError)
  })

  it('TC43 — retorno vazio é array vazio (não é erro)', async () => {
    const svc = makeSvcRpc({ data: [] })

    const result = await recoverStaleBatches({ svc })

    expect(result).toEqual([])
  })

  it('TC44 — normaliza lotes com status retry_pending', async () => {
    const svc = makeSvcRpc({ data: [
      makeBatchRow({ status: 'retry_pending', locked_at: null, last_error_code: 'STALE_LOCK_RECOVERED' }),
    ] })

    const result = await recoverStaleBatches({ svc })

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('retry_pending')
    expect(result[0].lockedAt).toBeNull()
    expect(result[0].lastErrorCode).toBe('STALE_LOCK_RECOVERED')
  })

  it('TC45 — normaliza lotes com status failed', async () => {
    const svc = makeSvcRpc({ data: [
      makeBatchRow({ status: 'failed', locked_at: null, attempts: 3, last_error_code: 'STALE_LOCK_MAX_ATTEMPTS' }),
    ] })

    const result = await recoverStaleBatches({ svc })

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('failed')
    expect(result[0].lastErrorCode).toBe('STALE_LOCK_MAX_ATTEMPTS')
  })

  it('TC46 — mapeia parâmetros para a RPC corretamente', async () => {
    const svc = makeSvcRpc({ data: [] })

    await recoverStaleBatches({ svc, staleAfterSeconds: 600, limit: 5 })

    expect(svc.rpc).toHaveBeenCalledWith('agent_message_batches_recover_stale_v1', {
      p_stale_after_seconds: 600,
      p_limit:               5,
    })
  })
})

// =============================================================================
// GRUPO 16 — rescheduleBatch (Etapa 13.1 — Parte C)
// =============================================================================

const NEXT_ATTEMPT_AT_STR  = '2026-07-15T13:00:00.000Z';
const NEXT_ATTEMPT_AT_DATE = new Date(NEXT_ATTEMPT_AT_STR);

describe('rescheduleBatch', () => {
  it('TC-RS01 — parâmetros corretos enviados à RPC agent_message_batch_reschedule_v1', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'retry_pending', locked_at: null })] })

    await rescheduleBatch({
      svc,
      companyId:     COMPANY_ID,
      batchId:       BATCH_ID,
      lockedAt:      LOCKED_AT,
      nextAttemptAt: NEXT_ATTEMPT_AT_STR,
      reason:        'OUT_OF_SCHEDULE',
    })

    expect(svc.rpc).toHaveBeenCalledWith('agent_message_batch_reschedule_v1', {
      p_company_id:      COMPANY_ID,
      p_batch_id:        BATCH_ID,
      p_locked_at:       LOCKED_AT,
      p_next_attempt_at: NEXT_ATTEMPT_AT_STR,
      p_reason:          'OUT_OF_SCHEDULE',
    })
  })

  it('TC-RS02 — lockedAt preservado literalmente (sem conversão de tipo)', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'retry_pending', locked_at: null })] })
    const literalLockedAt = '2026-07-14T15:59:00.123456+00:00'

    await rescheduleBatch({ svc, companyId: COMPANY_ID, batchId: BATCH_ID, lockedAt: literalLockedAt, nextAttemptAt: NEXT_ATTEMPT_AT_STR })

    const call = svc.rpc.mock.calls[0][1]
    expect(call.p_locked_at).toBe(literalLockedAt)
    expect(call.p_locked_at).not.toBe(new Date(literalLockedAt).toISOString())
  })

  it('TC-RS03 — nextAttemptAt como string preservado literalmente', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'retry_pending', locked_at: null })] })

    await rescheduleBatch({ svc, companyId: COMPANY_ID, batchId: BATCH_ID, lockedAt: LOCKED_AT, nextAttemptAt: NEXT_ATTEMPT_AT_STR })

    const call = svc.rpc.mock.calls[0][1]
    expect(call.p_next_attempt_at).toBe(NEXT_ATTEMPT_AT_STR)
  })

  it('TC-RS04 — nextAttemptAt como Date é convertido para ISO string', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'retry_pending', locked_at: null })] })

    await rescheduleBatch({ svc, companyId: COMPANY_ID, batchId: BATCH_ID, lockedAt: LOCKED_AT, nextAttemptAt: NEXT_ATTEMPT_AT_DATE })

    const call = svc.rpc.mock.calls[0][1]
    expect(call.p_next_attempt_at).toBe(NEXT_ATTEMPT_AT_DATE.toISOString())
  })

  it('TC-RS05 — retorna lote normalizado com status retry_pending', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'retry_pending', locked_at: null, next_attempt_at: NEXT_ATTEMPT_AT_STR })] })

    const result = await rescheduleBatch({ svc, companyId: COMPANY_ID, batchId: BATCH_ID, lockedAt: LOCKED_AT, nextAttemptAt: NEXT_ATTEMPT_AT_STR })

    expect(result.status).toBe('retry_pending')
    expect(result.nextAttemptAt).toBe(NEXT_ATTEMPT_AT_STR)
  })

  it('TC-RS06 — resultado vazio lança MessageBufferStateError (EMPTY_RPC_RESULT)', async () => {
    const svc = makeSvcRpc({ data: [] })

    await expect(
      rescheduleBatch({ svc, companyId: COMPANY_ID, batchId: BATCH_ID, lockedAt: LOCKED_AT, nextAttemptAt: NEXT_ATTEMPT_AT_STR })
    ).rejects.toThrow(MessageBufferStateError)
  })

  it('TC-RS07 — status inesperado (ex: processing) lança UNEXPECTED_STATUS', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'processing' })] })

    await expect(
      rescheduleBatch({ svc, companyId: COMPANY_ID, batchId: BATCH_ID, lockedAt: LOCKED_AT, nextAttemptAt: NEXT_ATTEMPT_AT_STR })
    ).rejects.toThrow(MessageBufferStateError)
  })

  it('TC-RS08 — CLAIM_MISMATCH da RPC é classificado como MessageBufferStateError', async () => {
    const svc = makeSvcRpc({ error: { message: 'CLAIM_MISMATCH: locked_at divergiu' } })

    await expect(
      rescheduleBatch({ svc, companyId: COMPANY_ID, batchId: BATCH_ID, lockedAt: LOCKED_AT, nextAttemptAt: NEXT_ATTEMPT_AT_STR })
    ).rejects.toThrow(MessageBufferStateError)
  })

  it('TC-RS09 — motivo (reason) não aparece integralmente em logs de erro', async () => {
    const sensitiveReason = 'MOTIVO_SECRETO_QUE_NAO_DEVE_APARECER_EM_LOG'
    const svc = makeSvcRpc({ error: { message: 'CLAIM_MISMATCH: teste' } })

    try {
      await rescheduleBatch({ svc, companyId: COMPANY_ID, batchId: BATCH_ID, lockedAt: LOCKED_AT, nextAttemptAt: NEXT_ATTEMPT_AT_STR, reason: sensitiveReason })
    } catch { /* esperado */ }

    const errorArgs = console.error.mock.calls.map(c => JSON.stringify(c)).join('')
    expect(errorArgs).not.toContain(sensitiveReason)
  })

  it('TC-RS10 — svc ausente lança MessageBufferValidationError', async () => {
    await expect(
      rescheduleBatch({ svc: null, companyId: COMPANY_ID, batchId: BATCH_ID, lockedAt: LOCKED_AT, nextAttemptAt: NEXT_ATTEMPT_AT_STR })
    ).rejects.toThrow(MessageBufferValidationError)
  })

  it('TC-RS11 — companyId ausente lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc({ data: [] })
    await expect(
      rescheduleBatch({ svc, companyId: null, batchId: BATCH_ID, lockedAt: LOCKED_AT, nextAttemptAt: NEXT_ATTEMPT_AT_STR })
    ).rejects.toThrow(MessageBufferValidationError)
  })

  it('TC-RS12 — batchId ausente lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc({ data: [] })
    await expect(
      rescheduleBatch({ svc, companyId: COMPANY_ID, batchId: null, lockedAt: LOCKED_AT, nextAttemptAt: NEXT_ATTEMPT_AT_STR })
    ).rejects.toThrow(MessageBufferValidationError)
  })

  it('TC-RS13 — lockedAt ausente lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc({ data: [] })
    await expect(
      rescheduleBatch({ svc, companyId: COMPANY_ID, batchId: BATCH_ID, lockedAt: null, nextAttemptAt: NEXT_ATTEMPT_AT_STR })
    ).rejects.toThrow(MessageBufferValidationError)
  })

  it('TC-RS14 — nextAttemptAt ausente lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc({ data: [] })
    await expect(
      rescheduleBatch({ svc, companyId: COMPANY_ID, batchId: BATCH_ID, lockedAt: LOCKED_AT, nextAttemptAt: null })
    ).rejects.toThrow(MessageBufferValidationError)
  })

  it('TC-RS15 — rescheduleBatch usa exclusivamente agent_message_batch_reschedule_v1', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'retry_pending', locked_at: null })] })
    await rescheduleBatch({ svc, companyId: COMPANY_ID, batchId: BATCH_ID, lockedAt: LOCKED_AT, nextAttemptAt: NEXT_ATTEMPT_AT_STR })
    expect(svc.rpc.mock.calls[0][0]).toBe('agent_message_batch_reschedule_v1')
    expect(svc.rpc).toHaveBeenCalledTimes(1)
  })
})

// =============================================================================
// GRUPO 17 — Regressão e integridade (atualizado: inclui rescheduleBatch)
// =============================================================================
describe('Regressão e integridade', () => {
  it('TC47 — markBatchProcessed não chama RPC diferente', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'processed', locked_at: null })] })
    await markBatchProcessed({ svc, ...BASE_LIFECYCLE_PARAMS })
    expect(svc.rpc.mock.calls[0][0]).toBe('agent_message_batch_mark_processed_v1')
  })

  it('TC48 — markBatchRetry não chama RPC diferente', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'retry_pending', locked_at: null })] })
    await markBatchRetry({ svc, ...BASE_LIFECYCLE_PARAMS })
    expect(svc.rpc.mock.calls[0][0]).toBe('agent_message_batch_mark_retry_v1')
  })

  it('TC49 — markBatchFailed não chama RPC diferente', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'failed', locked_at: null })] })
    await markBatchFailed({ svc, ...BASE_LIFECYCLE_PARAMS })
    expect(svc.rpc.mock.calls[0][0]).toBe('agent_message_batch_mark_failed_v1')
  })

  it('TC50 — markBatchCancelled não chama RPC diferente', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'cancelled', locked_at: null })] })
    await markBatchCancelled({ svc, ...BASE_LIFECYCLE_PARAMS })
    expect(svc.rpc.mock.calls[0][0]).toBe('agent_message_batch_mark_cancelled_v1')
  })

  it('TC51 — recoverStaleBatches não chama RPC diferente', async () => {
    const svc = makeSvcRpc({ data: [] })
    await recoverStaleBatches({ svc })
    expect(svc.rpc.mock.calls[0][0]).toBe('agent_message_batches_recover_stale_v1')
  })

  it('TC52 — nenhuma função usa from() diretamente nos lifecycle RPCs', async () => {
    const svc = makeSvcRpc({ data: [makeBatchRow({ status: 'processed', locked_at: null })] })
    await markBatchProcessed({ svc, ...BASE_LIFECYCLE_PARAMS })
    expect(svc.from).not.toHaveBeenCalled()
  })
})
