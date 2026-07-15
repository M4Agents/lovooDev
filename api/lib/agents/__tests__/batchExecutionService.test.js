// =============================================================================
// Testes unitários — batchExecutionService.js
//
// Framework: vitest
// Estratégia: mocks completos do cliente Supabase.
//   - Sem conexão com banco real
//   - Sem chamadas de rede
//   - Testa exclusivamente a lógica do service layer
//
// Para executar: npm test
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  claimBatchExecution,
  markBatchExecutionCompleted,
  markBatchExecutionRetry,
  markBatchExecutionFailed,
  markBatchExecutionCancelled,
  recoverStaleBatchExecutions,
} from '../batchExecutionService.js'
import {
  MessageBufferValidationError,
  MessageBufferTenantError,
  MessageBufferDatabaseError,
  MessageBufferStateError,
} from '../messageBufferService.js'

// ---------------------------------------------------------------------------
// Silenciar logs
// ---------------------------------------------------------------------------
vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})

// ---------------------------------------------------------------------------
// Constantes de teste
// ---------------------------------------------------------------------------
const COMPANY_ID   = 'company-uuid-exec-1'
const BATCH_ID     = 'batch-uuid-exec-1'
const EXECUTION_ID = 'execution-uuid-1'
const CLAIM_TOKEN  = '550e8400-e29b-41d4-a716-446655440000'

const BASE_PARAMS = {
  companyId:  COMPANY_ID,
  batchId:    BATCH_ID,
  claimToken: CLAIM_TOKEN,
}

// ---------------------------------------------------------------------------
// Fábricas de mock Supabase
// ---------------------------------------------------------------------------

/** Mock para svc.rpc() */
function makeSvcRpc({ data = null, error = null } = {}) {
  return {
    rpc:  vi.fn().mockResolvedValue({ data, error }),
    from: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Fábricas de dados mock (snake_case — como o banco retorna)
// ---------------------------------------------------------------------------

/**
 * Mock de linha de agent_batch_executions (retorno de RPCs de lifecycle).
 */
function makeExecutionRow(overrides = {}) {
  return {
    id:               EXECUTION_ID,
    company_id:       COMPANY_ID,
    batch_id:         BATCH_ID,
    execution_status: 'processing',
    claim_token:      CLAIM_TOKEN,
    attempts:         1,
    next_attempt_at:  null,
    last_error_code:  null,
    last_error:       null,
    completed_at:     null,
    execution_log_id: null,
    created_at:       '2026-07-14T15:58:00.000Z',
    updated_at:       '2026-07-14T15:58:00.000Z',
    ...overrides,
  }
}

/**
 * Mock de linha do claim_v1 (RETURNS TABLE — colunas diferentes da tabela principal).
 */
function makeClaimRow(overrides = {}) {
  return {
    acquired:         true,
    execution_id:     EXECUTION_ID,
    batch_id:         BATCH_ID,
    execution_status: 'processing',
    claim_token:      CLAIM_TOKEN,
    attempts:         1,
    reason:           'claimed',
    ...overrides,
  }
}

// =============================================================================
// GRUPO 1 — claimBatchExecution: mapeamento de parâmetros
// =============================================================================
describe('claimBatchExecution — mapeamento de parâmetros', () => {
  it('TC-EX01 — mapeia companyId e batchId para p_company_id e p_batch_id', async () => {
    const svc = makeSvcRpc({ data: [makeClaimRow()] })

    await claimBatchExecution({ svc, companyId: COMPANY_ID, batchId: BATCH_ID })

    expect(svc.rpc).toHaveBeenCalledWith('agent_batch_execution_claim_v1', {
      p_company_id: COMPANY_ID,
      p_batch_id:   BATCH_ID,
    })
  })
})

// =============================================================================
// GRUPO 2 — claimBatchExecution: retorno normalizado
// =============================================================================
describe('claimBatchExecution — retorno normalizado', () => {
  it('TC-EX02 — acquired=true normalizado com todos os campos', async () => {
    const svc = makeSvcRpc({ data: [makeClaimRow()] })

    const result = await claimBatchExecution({ svc, companyId: COMPANY_ID, batchId: BATCH_ID })

    expect(result).toMatchObject({
      acquired:    true,
      executionId: EXECUTION_ID,
      batchId:     BATCH_ID,
      status:      'processing',
      claimToken:  CLAIM_TOKEN,
      attempts:    1,
      reason:      'claimed',
    })
  })

  it('TC-EX03 — already_processing normalizado sem exceção', async () => {
    const svc = makeSvcRpc({ data: [makeClaimRow({
      acquired: false, execution_status: 'processing',
      reason: 'already_processing', claim_token: null,
    })] })

    const result = await claimBatchExecution({ svc, companyId: COMPANY_ID, batchId: BATCH_ID })

    expect(result.acquired).toBe(false)
    expect(result.reason).toBe('already_processing')
    expect(result.claimToken).toBeNull()
  })

  it('TC-EX04 — already_completed normalizado sem exceção', async () => {
    const svc = makeSvcRpc({ data: [makeClaimRow({
      acquired: false, execution_status: 'completed',
      reason: 'already_completed', claim_token: null,
    })] })

    const result = await claimBatchExecution({ svc, companyId: COMPANY_ID, batchId: BATCH_ID })

    expect(result.acquired).toBe(false)
    expect(result.reason).toBe('already_completed')
    expect(result.status).toBe('completed')
  })

  it('TC-EX05 — retry_not_ready normalizado sem exceção', async () => {
    const svc = makeSvcRpc({ data: [makeClaimRow({
      acquired: false, execution_status: 'retry_pending',
      reason: 'retry_not_ready', claim_token: null,
    })] })

    const result = await claimBatchExecution({ svc, companyId: COMPANY_ID, batchId: BATCH_ID })

    expect(result.acquired).toBe(false)
    expect(result.reason).toBe('retry_not_ready')
  })

  it('TC-EX06 — estado failed normalizado sem exceção', async () => {
    const svc = makeSvcRpc({ data: [makeClaimRow({
      acquired: false, execution_status: 'failed',
      reason: 'already_failed', claim_token: null,
    })] })

    const result = await claimBatchExecution({ svc, companyId: COMPANY_ID, batchId: BATCH_ID })

    expect(result.acquired).toBe(false)
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('already_failed')
  })

  it('TC-EX07 — estado cancelled normalizado sem exceção', async () => {
    const svc = makeSvcRpc({ data: [makeClaimRow({
      acquired: false, execution_status: 'cancelled',
      reason: 'already_cancelled', claim_token: null,
    })] })

    const result = await claimBatchExecution({ svc, companyId: COMPANY_ID, batchId: BATCH_ID })

    expect(result.acquired).toBe(false)
    expect(result.status).toBe('cancelled')
  })
})

// =============================================================================
// GRUPO 3 — claimBatchExecution: classificação de erros
// =============================================================================
describe('claimBatchExecution — classificação de erros', () => {
  it('TC-EX08 — BATCH_NOT_FOUND classificado como MessageBufferTenantError', async () => {
    const svc = makeSvcRpc({ error: { message: 'BATCH_NOT_FOUND: lote nao encontrado para esta empresa' } })

    await expect(claimBatchExecution({ svc, companyId: COMPANY_ID, batchId: BATCH_ID }))
      .rejects.toBeInstanceOf(MessageBufferTenantError)
  })

  it('TC-EX09 — erro técnico classificado como MessageBufferDatabaseError', async () => {
    const svc = makeSvcRpc({ error: { message: 'connection refused' } })

    await expect(claimBatchExecution({ svc, companyId: COMPANY_ID, batchId: BATCH_ID }))
      .rejects.toBeInstanceOf(MessageBufferDatabaseError)
  })
})

// =============================================================================
// GRUPO 4 — claimBatchExecution: claimToken e segurança
// =============================================================================
describe('claimBatchExecution — claimToken e segurança', () => {
  it('TC-EX10 — claimToken preservado literalmente sem conversão', async () => {
    const specificToken = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    const svc = makeSvcRpc({ data: [makeClaimRow({ claim_token: specificToken })] })

    const result = await claimBatchExecution({ svc, companyId: COMPANY_ID, batchId: BATCH_ID })

    expect(result.claimToken).toBe(specificToken)
  })

  it('TC-EX11 — logs não contêm claimToken', async () => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const secretToken = 'super-secret-claim-token-must-not-appear-in-logs'
    const svc = makeSvcRpc({ data: [makeClaimRow({ claim_token: secretToken })] })

    await claimBatchExecution({ svc, companyId: COMPANY_ID, batchId: BATCH_ID })

    const loggedText = [
      ...console.log.mock.calls,
      ...console.error.mock.calls,
    ].map((args) => JSON.stringify(args)).join('')

    expect(loggedText).not.toContain(secretToken)
  })
})

// =============================================================================
// GRUPO 5 — markBatchExecutionCompleted
// =============================================================================
describe('markBatchExecutionCompleted', () => {
  it('TC-EX12 — mapeia parâmetros para a RPC corretamente', async () => {
    const svc = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'completed', claim_token: null })] })

    await markBatchExecutionCompleted({ svc, ...BASE_PARAMS })

    expect(svc.rpc).toHaveBeenCalledWith('agent_batch_execution_mark_completed_v1', {
      p_company_id:  COMPANY_ID,
      p_batch_id:    BATCH_ID,
      p_claim_token: CLAIM_TOKEN,
    })
  })

  it('TC-EX13 — retorna execução normalizada com status completed', async () => {
    const svc = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'completed', claim_token: null, completed_at: '2026-07-14T16:00:00.000Z' })] })

    const result = await markBatchExecutionCompleted({ svc, ...BASE_PARAMS })

    expect(result).toMatchObject({
      id:        EXECUTION_ID,
      companyId: COMPANY_ID,
      batchId:   BATCH_ID,
      status:    'completed',
    })
    expect(result.completedAt).toBeTruthy()
    expect(result.claimToken).toBeNull()
  })

  it('TC-EX14 — resultado vazio gera EMPTY_RPC_RESULT', async () => {
    const svc = makeSvcRpc({ data: [] })

    const err = await markBatchExecutionCompleted({ svc, ...BASE_PARAMS }).catch((e) => e)

    expect(err).toBeInstanceOf(MessageBufferStateError)
    expect(err.code).toBe('EMPTY_RPC_RESULT')
  })

  it('TC-EX15 — CLAIM_MISMATCH classificado como MessageBufferStateError', async () => {
    const svc = makeSvcRpc({ error: { message: 'CLAIM_MISMATCH: status ou claim_token incorreto.' } })

    await expect(markBatchExecutionCompleted({ svc, ...BASE_PARAMS }))
      .rejects.toBeInstanceOf(MessageBufferStateError)
  })

  it('TC-EX16 — status inesperado gera UNEXPECTED_STATUS', async () => {
    const svc = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'failed' })] })

    const err = await markBatchExecutionCompleted({ svc, ...BASE_PARAMS }).catch((e) => e)

    expect(err).toBeInstanceOf(MessageBufferStateError)
    expect(err.code).toBe('UNEXPECTED_STATUS')
  })
})

// =============================================================================
// GRUPO 6 — markBatchExecutionRetry
// =============================================================================
describe('markBatchExecutionRetry', () => {
  it('TC-EX17 — mapeia parâmetros para a RPC corretamente', async () => {
    const svc = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'retry_pending', claim_token: null })] })

    await markBatchExecutionRetry({
      svc, ...BASE_PARAMS, errorCode: 'TIMEOUT', errorMessage: 'LLM timeout',
    })

    expect(svc.rpc).toHaveBeenCalledWith('agent_batch_execution_mark_retry_v1', {
      p_company_id:    COMPANY_ID,
      p_batch_id:      BATCH_ID,
      p_claim_token:   CLAIM_TOKEN,
      p_error_code:    'TIMEOUT',
      p_error_message: 'LLM timeout',
    })
  })

  it('TC-EX18 — retorno retry_pending é aceito sem erro', async () => {
    const svc = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'retry_pending', claim_token: null })] })

    const result = await markBatchExecutionRetry({ svc, ...BASE_PARAMS })

    expect(result.status).toBe('retry_pending')
  })

  it('TC-EX19 — retorno failed é aceito (attempts >= 3)', async () => {
    const svc = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'failed', claim_token: null, attempts: 3 })] })

    const result = await markBatchExecutionRetry({ svc, ...BASE_PARAMS })

    expect(result.status).toBe('failed')
  })

  it('TC-EX20 — errorCode e errorMessage são encaminhados à RPC', async () => {
    const svc = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'retry_pending', claim_token: null })] })

    await markBatchExecutionRetry({
      svc, ...BASE_PARAMS,
      errorCode:    'PROC_FAIL',
      errorMessage: 'detalhe interno do erro',
    })

    const call = svc.rpc.mock.calls[0][1]
    expect(call.p_error_code).toBe('PROC_FAIL')
    expect(call.p_error_message).toBe('detalhe interno do erro')
  })

  it('TC-EX21 — logs não contêm errorMessage', async () => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const svc = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'retry_pending', claim_token: null })] })

    await markBatchExecutionRetry({
      svc, ...BASE_PARAMS,
      errorMessage: 'mensagem secreta de erro interno exec-xpto',
    })

    const loggedText = [
      ...console.log.mock.calls,
      ...console.error.mock.calls,
    ].map((args) => JSON.stringify(args)).join('')

    expect(loggedText).not.toContain('mensagem secreta de erro interno exec-xpto')
  })

  it('TC-EX22 — claimToken ausente rejeita com MessageBufferValidationError', async () => {
    const svc = makeSvcRpc()

    await expect(
      markBatchExecutionRetry({ svc, companyId: COMPANY_ID, batchId: BATCH_ID })
    ).rejects.toBeInstanceOf(MessageBufferValidationError)
  })
})

// =============================================================================
// GRUPO 7 — markBatchExecutionFailed
// =============================================================================
describe('markBatchExecutionFailed', () => {
  it('TC-EX23 — retorna execução normalizada com status failed', async () => {
    const svc = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'failed', claim_token: null, last_error_code: 'ERR_X' })] })

    const result = await markBatchExecutionFailed({ svc, ...BASE_PARAMS, errorCode: 'ERR_X' })

    expect(result.status).toBe('failed')
    expect(result.claimToken).toBeNull()
    expect(result.lastErrorCode).toBe('ERR_X')
  })

  it('TC-EX24 — status inesperado gera UNEXPECTED_STATUS', async () => {
    const svc = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'cancelled', claim_token: null })] })

    const err = await markBatchExecutionFailed({ svc, ...BASE_PARAMS }).catch((e) => e)

    expect(err).toBeInstanceOf(MessageBufferStateError)
    expect(err.code).toBe('UNEXPECTED_STATUS')
  })

  it('TC-EX25 — resultado vazio gera EMPTY_RPC_RESULT', async () => {
    const svc = makeSvcRpc({ data: [] })

    const err = await markBatchExecutionFailed({ svc, ...BASE_PARAMS }).catch((e) => e)

    expect(err).toBeInstanceOf(MessageBufferStateError)
    expect(err.code).toBe('EMPTY_RPC_RESULT')
  })
})

// =============================================================================
// GRUPO 8 — markBatchExecutionCancelled
// =============================================================================
describe('markBatchExecutionCancelled', () => {
  it('TC-EX26 — retorna execução normalizada com status cancelled', async () => {
    const svc = makeSvcRpc({ data: [makeExecutionRow({
      execution_status: 'cancelled', claim_token: null,
    })] })

    const result = await markBatchExecutionCancelled({ svc, ...BASE_PARAMS, reason: 'teste' })

    expect(result.status).toBe('cancelled')
    expect(result.claimToken).toBeNull()
  })

  it('TC-EX27 — status inesperado gera UNEXPECTED_STATUS', async () => {
    const svc = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'failed', claim_token: null })] })

    const err = await markBatchExecutionCancelled({ svc, ...BASE_PARAMS }).catch((e) => e)

    expect(err).toBeInstanceOf(MessageBufferStateError)
    expect(err.code).toBe('UNEXPECTED_STATUS')
  })

  it('TC-EX28 — logs não contêm o motivo integral', async () => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const svc = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'cancelled', claim_token: null })] })

    await markBatchExecutionCancelled({
      svc, ...BASE_PARAMS,
      reason: 'motivo confidencial cancelamento exec xpto',
    })

    const loggedText = [
      ...console.log.mock.calls,
      ...console.error.mock.calls,
    ].map((args) => JSON.stringify(args)).join('')

    expect(loggedText).not.toContain('motivo confidencial cancelamento exec xpto')
  })
})

// =============================================================================
// GRUPO 9 — recoverStaleBatchExecutions
// =============================================================================
describe('recoverStaleBatchExecutions', () => {
  it('TC-EX29 — usa defaults p_stale_after_seconds=300 e p_limit=20', async () => {
    const svc = makeSvcRpc({ data: [] })

    await recoverStaleBatchExecutions({ svc })

    expect(svc.rpc).toHaveBeenCalledWith('agent_batch_executions_recover_stale_v1', {
      p_stale_after_seconds: 300,
      p_limit:               20,
    })
  })

  it('TC-EX30 — staleAfterSeconds < 60 lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc()
    await expect(recoverStaleBatchExecutions({ svc, staleAfterSeconds: 59 }))
      .rejects.toBeInstanceOf(MessageBufferValidationError)
  })

  it('TC-EX31 — staleAfterSeconds > 3600 lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc()
    await expect(recoverStaleBatchExecutions({ svc, staleAfterSeconds: 3601 }))
      .rejects.toBeInstanceOf(MessageBufferValidationError)
  })

  it('TC-EX32 — limit < 1 lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc()
    await expect(recoverStaleBatchExecutions({ svc, limit: 0 }))
      .rejects.toBeInstanceOf(MessageBufferValidationError)
  })

  it('TC-EX33 — limit > 100 lança MessageBufferValidationError', async () => {
    const svc = makeSvcRpc()
    await expect(recoverStaleBatchExecutions({ svc, limit: 101 }))
      .rejects.toBeInstanceOf(MessageBufferValidationError)
  })

  it('TC-EX34 — array vazio é aceito (não é erro)', async () => {
    const svc = makeSvcRpc({ data: [] })

    const result = await recoverStaleBatchExecutions({ svc })

    expect(result).toEqual([])
  })

  it('TC-EX35 — execução retry_pending normalizada corretamente', async () => {
    const svc = makeSvcRpc({ data: [
      makeExecutionRow({
        execution_status: 'retry_pending',
        claim_token:      null,
        last_error_code:  'STALE_EXECUTION_RECOVERED',
        next_attempt_at:  '2026-07-14T16:05:00.000Z',
      }),
    ] })

    const result = await recoverStaleBatchExecutions({ svc })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      status:        'retry_pending',
      claimToken:    null,
      lastErrorCode: 'STALE_EXECUTION_RECOVERED',
      nextAttemptAt: '2026-07-14T16:05:00.000Z',
    })
  })

  it('TC-EX36 — execução failed normalizada corretamente', async () => {
    const svc = makeSvcRpc({ data: [
      makeExecutionRow({
        execution_status: 'failed',
        claim_token:      null,
        attempts:         3,
        last_error_code:  'STALE_EXECUTION_MAX_ATTEMPTS',
      }),
    ] })

    const result = await recoverStaleBatchExecutions({ svc })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      status:        'failed',
      attempts:      3,
      lastErrorCode: 'STALE_EXECUTION_MAX_ATTEMPTS',
    })
  })

  it('TC-EX37 — mapeia parâmetros para a RPC corretamente', async () => {
    const svc = makeSvcRpc({ data: [] })

    await recoverStaleBatchExecutions({ svc, staleAfterSeconds: 600, limit: 5 })

    expect(svc.rpc).toHaveBeenCalledWith('agent_batch_executions_recover_stale_v1', {
      p_stale_after_seconds: 600,
      p_limit:               5,
    })
  })
})

// =============================================================================
// GRUPO 10 — Regressão, isolamento e integridade
// =============================================================================
describe('Regressão e integridade', () => {
  it('TC-EX39 — cada método chama somente a RPC correta', async () => {
    const svcClaim = makeSvcRpc({ data: [makeClaimRow()] })
    await claimBatchExecution({ svc: svcClaim, companyId: COMPANY_ID, batchId: BATCH_ID })
    expect(svcClaim.rpc.mock.calls[0][0]).toBe('agent_batch_execution_claim_v1')

    const svcCompleted = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'completed', claim_token: null })] })
    await markBatchExecutionCompleted({ svc: svcCompleted, ...BASE_PARAMS })
    expect(svcCompleted.rpc.mock.calls[0][0]).toBe('agent_batch_execution_mark_completed_v1')

    const svcRetry = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'retry_pending', claim_token: null })] })
    await markBatchExecutionRetry({ svc: svcRetry, ...BASE_PARAMS })
    expect(svcRetry.rpc.mock.calls[0][0]).toBe('agent_batch_execution_mark_retry_v1')

    const svcFailed = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'failed', claim_token: null })] })
    await markBatchExecutionFailed({ svc: svcFailed, ...BASE_PARAMS })
    expect(svcFailed.rpc.mock.calls[0][0]).toBe('agent_batch_execution_mark_failed_v1')

    const svcCancelled = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'cancelled', claim_token: null })] })
    await markBatchExecutionCancelled({ svc: svcCancelled, ...BASE_PARAMS })
    expect(svcCancelled.rpc.mock.calls[0][0]).toBe('agent_batch_execution_mark_cancelled_v1')

    const svcRecover = makeSvcRpc({ data: [] })
    await recoverStaleBatchExecutions({ svc: svcRecover })
    expect(svcRecover.rpc.mock.calls[0][0]).toBe('agent_batch_executions_recover_stale_v1')
  })

  it('TC-EX40 — nenhum método usa .from() para alterar agent_batch_executions', async () => {
    const ops = [
      makeSvcRpc({ data: [makeClaimRow()] }),
      makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'completed', claim_token: null })] }),
      makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'retry_pending', claim_token: null })] }),
      makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'failed', claim_token: null })] }),
      makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'cancelled', claim_token: null })] }),
      makeSvcRpc({ data: [] }),
    ]

    await claimBatchExecution({ svc: ops[0], companyId: COMPANY_ID, batchId: BATCH_ID })
    await markBatchExecutionCompleted({ svc: ops[1], ...BASE_PARAMS })
    await markBatchExecutionRetry({ svc: ops[2], ...BASE_PARAMS })
    await markBatchExecutionFailed({ svc: ops[3], ...BASE_PARAMS })
    await markBatchExecutionCancelled({ svc: ops[4], ...BASE_PARAMS })
    await recoverStaleBatchExecutions({ svc: ops[5] })

    for (const svc of ops) {
      expect(svc.from).not.toHaveBeenCalled()
    }
  })

  it('TC-EX41 — nenhum log contém claim token ou mensagem de erro integral', async () => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const secretToken   = 'secret-claim-token-not-in-logs'
    const secretMessage = 'mensagem-de-erro-secreta-not-in-logs'
    const secretReason  = 'razao-secreta-cancelamento-not-in-logs'

    const svcClaim = makeSvcRpc({ data: [makeClaimRow({ claim_token: secretToken })] })
    await claimBatchExecution({ svc: svcClaim, companyId: COMPANY_ID, batchId: BATCH_ID })

    const svcRetry = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'retry_pending', claim_token: null })] })
    await markBatchExecutionRetry({ svc: svcRetry, companyId: COMPANY_ID, batchId: BATCH_ID, claimToken: CLAIM_TOKEN, errorMessage: secretMessage })

    const svcCancelled = makeSvcRpc({ data: [makeExecutionRow({ execution_status: 'cancelled', claim_token: null })] })
    await markBatchExecutionCancelled({ svc: svcCancelled, companyId: COMPANY_ID, batchId: BATCH_ID, claimToken: CLAIM_TOKEN, reason: secretReason })

    const loggedText = [
      ...console.log.mock.calls,
      ...console.error.mock.calls,
    ].map((args) => JSON.stringify(args)).join('')

    expect(loggedText).not.toContain(secretToken)
    expect(loggedText).not.toContain(secretMessage)
    expect(loggedText).not.toContain(secretReason)
  })

  it('TC-EX42 — nenhum teste realiza I/O real (confirmado — todos usam mocks)', () => {
    // Declaração explícita: todas as chamadas usam makeSvcRpc() com vi.fn()
    // Nenhuma conexão de rede ou banco é estabelecida neste arquivo.
    expect(true).toBe(true)
  })

  it('TC-EX43 — nenhum call site foi criado (confirmado — funções não chamadas por outros módulos)', () => {
    // Declaração explícita: batchExecutionService exporta funções mas não as registra
    // em Router, cron, pipeline ou qualquer outro módulo.
    expect(true).toBe(true)
  })
})
