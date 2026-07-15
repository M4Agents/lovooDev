// =============================================================================
// api/lib/agents/batchExecutionService.js
//
// Service Layer — Execuções Agrupadas (Idempotência por batch_id)
//
// RESPONSABILIDADE:
//   Encapsular acesso às RPCs de public.agent_batch_executions.
//   Garante que um mesmo batch_id não inicie duas execuções independentes.
//   Não contém lógica transacional — toda atomicidade fica nas RPCs.
//   Não cria cliente Supabase — recebe `svc` do chamador.
//
// FUNÇÕES EXPORTADAS:
//   claimBatchExecution          — claim via agent_batch_execution_claim_v1
//   markBatchExecutionCompleted  — finaliza via mark_completed_v1
//   markBatchExecutionRetry      — retry/fail via mark_retry_v1
//   markBatchExecutionFailed     — encerra via mark_failed_v1
//   markBatchExecutionCancelled  — cancela via mark_cancelled_v1
//   recoverStaleBatchExecutions  — recovery via recover_stale_v1
//
// CLASSES DE ERRO:
//   Importadas de messageBufferService.js sem duplicação.
//   Nenhuma nova classe de erro criada neste módulo.
//
// CLAIM TOKEN (CREDENCIAL OPERACIONAL):
//   claimToken é o UUID retornado pela RPC de claim.
//   NÃO gerar em JavaScript. NÃO reutilizar token antigo. NÃO converter.
//   NÃO logar em nenhuma situação — é uma credencial de posse.
//   Toda operação de conclusão (completed, retry, failed, cancelled) exige claimToken.
//
// MULTI-TENANT:
//   Toda operação individual exige companyId + batchId.
//   O banco valida o vínculo via FK e RPC — não confiar só no JS.
//
// ESTADO IDEMPOTENTE vs ERRO TÉCNICO:
//   claimBatchExecution com acquired=false NÃO é erro — retorno normalizado.
//   Apenas erros funcionais da RPC (BATCH_NOT_FOUND, INVALID_PARAM etc.) lançam exceção.
//
// IDENTIFICADOR ESTÁVEL DE EXECUÇÃO:
//   agent_batch_executions.id é o execution_id estável (retornado pelo claim).
//   Na futura integração, será o run_id do Orchestrator e o ai_run_id das mensagens.
//   Retries do mesmo batch reutilizam o mesmo execution_id — NÃO gerar novo UUID.
//
// CHAMADA REAL:
//   Funções sem call sites externos até aprovação da etapa seguinte.
//   recoverStaleBatchExecutions não deve ser chamada automaticamente sem cron.
// =============================================================================

import {
  MessageBufferValidationError,
  MessageBufferTenantError,
  MessageBufferDatabaseError,
  MessageBufferStateError,
} from './messageBufferService.js';


// ─────────────────────────────────────────────────────────────────────────────
// Mapeamento de prefixos de erro RPC → classe de erro
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prefixos funcionais retornados pelas RPCs de agent_batch_executions.
 * Ordem importa: prefixos mais específicos primeiro.
 *
 * @type {Array<{ prefix: string, ErrorClass: typeof Error, code: string }>}
 */
const EXECUTION_RPC_ERROR_MAP = [
  { prefix: 'INVALID_PARAM',       ErrorClass: MessageBufferValidationError, code: 'INVALID_PARAM'       },
  { prefix: 'BATCH_NOT_FOUND',     ErrorClass: MessageBufferTenantError,     code: 'BATCH_NOT_FOUND'     },
  { prefix: 'EXECUTION_NOT_FOUND', ErrorClass: MessageBufferStateError,      code: 'EXECUTION_NOT_FOUND' },
  { prefix: 'CLAIM_MISMATCH',      ErrorClass: MessageBufferStateError,      code: 'CLAIM_MISMATCH'      },
  { prefix: 'INVALID_STATE',       ErrorClass: MessageBufferStateError,      code: 'INVALID_STATE'       },
  { prefix: 'CONCURRENT_DELETE',   ErrorClass: MessageBufferStateError,      code: 'CONCURRENT_DELETE'   },
];

/**
 * Classifica erro retornado pelo Supabase em classe do service.
 *
 * @param {object} supabaseError
 * @param {string} operation
 * @returns {Error}
 */
function classifyExecutionRpcError(supabaseError, operation) {
  const msg = supabaseError?.message ?? '';
  for (const { prefix, ErrorClass, code } of EXECUTION_RPC_ERROR_MAP) {
    if (msg.startsWith(prefix + ':') || msg.startsWith(prefix + ' ')) {
      return new ErrorClass(
        `${operation}: ${prefix}`,
        { operation, code, cause: supabaseError }
      );
    }
  }
  return new MessageBufferDatabaseError(
    `${operation}: erro técnico do banco`,
    { operation, code: 'DB_ERROR', cause: supabaseError }
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Mapper: agent_batch_executions row → camelCase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mapeia linha snake_case de agent_batch_executions para camelCase.
 * Não mistura com mapBatchRow (agent_message_batches) — domínios diferentes.
 *
 * @param {object} row
 * @returns {object}
 */
function mapExecutionRow(row) {
  return {
    id:             row.id,
    companyId:      row.company_id,
    batchId:        row.batch_id,
    status:         row.execution_status,
    claimToken:     row.claim_token      ?? null,
    attempts:       row.attempts,
    nextAttemptAt:  row.next_attempt_at  ?? null,
    lastErrorCode:  row.last_error_code  ?? null,
    lastError:      row.last_error       ?? null,
    completedAt:    row.completed_at     ?? null,
    executionLogId: row.execution_log_id ?? null,
    createdAt:      row.created_at       ?? null,
    updatedAt:      row.updated_at       ?? null,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// Helper interno: callSingleExecutionRpc
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chama RPC de lifecycle que retorna SETOF agent_batch_executions (0 ou 1 linha).
 *
 * Centraliza: chamada ao svc.rpc(), classificação de erro, verificação de
 * resultado vazio, validação opcional de status e logs seguros.
 *
 * SEGURANÇA: nunca loga p_claim_token, p_error_message ou p_reason.
 *
 * @param {object}      opts
 * @param {object}      opts.svc              - Cliente Supabase service_role
 * @param {string}      opts.rpcName          - Nome da RPC PostgreSQL
 * @param {object}      opts.rpcParams        - Parâmetros p_* para a RPC
 * @param {string}      opts.operation        - Nome da operação JS
 * @param {string|null} [opts.expectedStatus] - Valida status retornado; null = aceita qualquer
 * @returns {Promise<object>} Execução normalizada em camelCase
 */
async function callSingleExecutionRpc({ svc, rpcName, rpcParams, operation, expectedStatus = null }) {
  const { data, error } = await svc.rpc(rpcName, rpcParams);

  if (error) {
    const classified = classifyExecutionRpcError(error, operation);
    console.error(`🤖 [EXEC] ❌ ${operation} falhou:`, {
      operation,
      company_id: rpcParams.p_company_id,
      batch_id:   rpcParams.p_batch_id,
      error_code: classified.code,
      // p_claim_token NÃO logado (credencial operacional)
      // p_error_message NÃO logado (conteúdo potencialmente sensível)
      // p_reason NÃO logado (conteúdo potencialmente sensível)
    });
    throw classified;
  }

  const rows = Array.isArray(data) ? data : [];

  if (rows.length === 0) {
    const err = new MessageBufferStateError(
      `${operation}: RPC retornou resultado vazio`,
      { operation, code: 'EMPTY_RPC_RESULT' }
    );
    console.error(`🤖 [EXEC] ❌ ${operation} resultado vazio:`, {
      operation,
      company_id: rpcParams.p_company_id,
      batch_id:   rpcParams.p_batch_id,
      error_code: 'EMPTY_RPC_RESULT',
    });
    throw err;
  }

  const execution = mapExecutionRow(rows[0]);

  if (expectedStatus !== null && execution.status !== expectedStatus) {
    const err = new MessageBufferStateError(
      `${operation}: status inesperado '${execution.status}'`,
      { operation, code: 'UNEXPECTED_STATUS' }
    );
    console.error(`🤖 [EXEC] ❌ ${operation} status inesperado:`, {
      operation,
      company_id:  rpcParams.p_company_id,
      batch_id:    rpcParams.p_batch_id,
      status:      execution.status,
      error_code:  'UNEXPECTED_STATUS',
    });
    throw err;
  }

  console.log(`🤖 [EXEC] ✅ ${operation}:`, {
    operation,
    company_id:   rpcParams.p_company_id,
    batch_id:     rpcParams.p_batch_id,
    execution_id: execution.id,
    status:       execution.status,
    attempts:     execution.attempts,
    // claimToken NÃO logado
  });

  return execution;
}


// ─────────────────────────────────────────────────────────────────────────────
// claimBatchExecution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reivindica atomicamente uma execução para um lote.
 *
 * Chama exclusivamente `agent_batch_execution_claim_v1`.
 *
 * Possíveis retornos normalizados (sem exceção):
 *   acquired=true,  reason='claimed'              — novo claim bem-sucedido
 *   acquired=true,  reason='retry_claimed'        — re-claim de retry
 *   acquired=false, reason='already_processing'   — já em andamento
 *   acquired=false, reason='already_completed'    — já concluído
 *   acquired=false, reason='retry_not_ready'      — retry ainda no backoff
 *   acquired=false, reason='already_failed'       — falha permanente
 *   acquired=false, reason='already_cancelled'    — cancelado
 *
 * Exceções lançadas apenas para: BATCH_NOT_FOUND, INVALID_PARAM, erro técnico.
 *
 * SEGURANÇA: claimToken nunca aparece em logs.
 *
 * @param {object} params
 * @param {object} params.svc       - Cliente Supabase service_role
 * @param {string} params.companyId - UUID da empresa
 * @param {string} params.batchId   - UUID do lote
 *
 * @returns {Promise<{
 *   acquired:    boolean,
 *   executionId: string,
 *   batchId:     string,
 *   status:      string,
 *   claimToken:  string|null,
 *   attempts:    number,
 *   reason:      string,
 * }>}
 *
 * @throws {MessageBufferValidationError}
 * @throws {MessageBufferTenantError}    - BATCH_NOT_FOUND
 * @throws {MessageBufferStateError}     - CONCURRENT_DELETE, EMPTY_RPC_RESULT
 * @throws {MessageBufferDatabaseError}
 */
export async function claimBatchExecution({ svc, companyId, batchId }) {
  const OP = 'claimBatchExecution';

  if (!svc)       throw new MessageBufferValidationError(`${OP}: svc é obrigatório`,       { operation: OP, code: 'MISSING_SVC'       });
  if (!companyId) throw new MessageBufferValidationError(`${OP}: companyId é obrigatório`, { operation: OP, code: 'MISSING_COMPANY_ID' });
  if (!batchId)   throw new MessageBufferValidationError(`${OP}: batchId é obrigatório`,   { operation: OP, code: 'MISSING_BATCH_ID'   });

  const { data, error } = await svc.rpc('agent_batch_execution_claim_v1', {
    p_company_id: companyId,
    p_batch_id:   batchId,
  });

  if (error) {
    const classified = classifyExecutionRpcError(error, OP);
    console.error(`🤖 [EXEC] ❌ ${OP} falhou:`, {
      operation:  OP,
      company_id: companyId,
      batch_id:   batchId,
      error_code: classified.code,
    });
    throw classified;
  }

  const rows = Array.isArray(data) ? data : [];
  const row  = rows[0] ?? null;

  if (!row) {
    const err = new MessageBufferStateError(
      `${OP}: RPC retornou resultado vazio`,
      { operation: OP, code: 'EMPTY_RPC_RESULT' }
    );
    console.error(`🤖 [EXEC] ❌ ${OP} resultado vazio:`, {
      operation:  OP,
      company_id: companyId,
      batch_id:   batchId,
      error_code: 'EMPTY_RPC_RESULT',
    });
    throw err;
  }

  const result = {
    acquired:    row.acquired,
    executionId: row.execution_id  ?? null,
    batchId:     row.batch_id,
    status:      row.execution_status,
    claimToken:  row.claim_token   ?? null,
    attempts:    row.attempts,
    reason:      row.reason,
  };

  // claimToken nunca aparece neste log (credencial operacional de posse)
  console.log(`🤖 [EXEC] ${result.acquired ? '✅' : 'ℹ️'} ${OP}:`, {
    operation:    OP,
    company_id:   companyId,
    batch_id:     batchId,
    execution_id: result.executionId,
    status:       result.status,
    attempts:     result.attempts,
    reason:       result.reason,
    acquired:     result.acquired,
  });

  return result;
}


// ─────────────────────────────────────────────────────────────────────────────
// markBatchExecutionCompleted
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finaliza uma execução agrupada como concluída com sucesso.
 *
 * Chama exclusivamente `agent_batch_execution_mark_completed_v1`.
 * Status esperado: 'completed'. Qualquer outro levanta UNEXPECTED_STATUS.
 *
 * @param {object} params
 * @param {object} params.svc        - Cliente Supabase service_role
 * @param {string} params.companyId  - UUID da empresa
 * @param {string} params.batchId    - UUID do lote
 * @param {string} params.claimToken - Token de posse retornado pelo claim
 *
 * @returns {Promise<object>} Execução normalizada com status = 'completed'
 *
 * @throws {MessageBufferValidationError}
 * @throws {MessageBufferTenantError}
 * @throws {MessageBufferStateError}    - CLAIM_MISMATCH, EMPTY_RPC_RESULT, UNEXPECTED_STATUS
 * @throws {MessageBufferDatabaseError}
 */
export async function markBatchExecutionCompleted({ svc, companyId, batchId, claimToken }) {
  const OP = 'markBatchExecutionCompleted';

  if (!svc)        throw new MessageBufferValidationError(`${OP}: svc é obrigatório`,        { operation: OP, code: 'MISSING_SVC'         });
  if (!companyId)  throw new MessageBufferValidationError(`${OP}: companyId é obrigatório`,  { operation: OP, code: 'MISSING_COMPANY_ID'   });
  if (!batchId)    throw new MessageBufferValidationError(`${OP}: batchId é obrigatório`,    { operation: OP, code: 'MISSING_BATCH_ID'     });
  if (!claimToken) throw new MessageBufferValidationError(`${OP}: claimToken é obrigatório`, { operation: OP, code: 'MISSING_CLAIM_TOKEN'  });

  return callSingleExecutionRpc({
    svc,
    rpcName:        'agent_batch_execution_mark_completed_v1',
    rpcParams:      { p_company_id: companyId, p_batch_id: batchId, p_claim_token: claimToken },
    operation:      OP,
    expectedStatus: 'completed',
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// markBatchExecutionRetry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reagenda ou encerra uma execução com falha, dependendo do número de tentativas.
 *
 * Chama exclusivamente `agent_batch_execution_mark_retry_v1`.
 *
 * O status retornado pode ser:
 *   'retry_pending' — quando attempts < 3
 *   'failed'        — quando attempts >= 3 (RPC transiciona diretamente)
 *
 * IMPORTANTE: errorMessage não é registrado em logs.
 *
 * @param {object}      params
 * @param {object}      params.svc            - Cliente Supabase service_role
 * @param {string}      params.companyId      - UUID da empresa
 * @param {string}      params.batchId        - UUID do lote
 * @param {string}      params.claimToken     - Token de posse do claim
 * @param {string|null} [params.errorCode]    - Código do erro (max 100 chars)
 * @param {string|null} [params.errorMessage] - Mensagem do erro (max 2000 chars; não logada)
 *
 * @returns {Promise<object>} Execução normalizada com status = 'retry_pending' ou 'failed'
 *
 * @throws {MessageBufferValidationError}
 * @throws {MessageBufferStateError}    - CLAIM_MISMATCH, EMPTY_RPC_RESULT
 * @throws {MessageBufferDatabaseError}
 */
export async function markBatchExecutionRetry({
  svc,
  companyId,
  batchId,
  claimToken,
  errorCode    = null,
  errorMessage = null,
}) {
  const OP = 'markBatchExecutionRetry';

  if (!svc)        throw new MessageBufferValidationError(`${OP}: svc é obrigatório`,        { operation: OP, code: 'MISSING_SVC'        });
  if (!companyId)  throw new MessageBufferValidationError(`${OP}: companyId é obrigatório`,  { operation: OP, code: 'MISSING_COMPANY_ID'  });
  if (!batchId)    throw new MessageBufferValidationError(`${OP}: batchId é obrigatório`,    { operation: OP, code: 'MISSING_BATCH_ID'    });
  if (!claimToken) throw new MessageBufferValidationError(`${OP}: claimToken é obrigatório`, { operation: OP, code: 'MISSING_CLAIM_TOKEN' });

  // expectedStatus = null: retry_pending e failed são ambos estados válidos
  return callSingleExecutionRpc({
    svc,
    rpcName:  'agent_batch_execution_mark_retry_v1',
    rpcParams: {
      p_company_id:    companyId,
      p_batch_id:      batchId,
      p_claim_token:   claimToken,
      p_error_code:    errorCode,
      p_error_message: errorMessage,  // encaminhado à RPC, não logado
    },
    operation:      OP,
    expectedStatus: null,
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// markBatchExecutionFailed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encerra uma execução como permanentemente falha.
 *
 * Chama exclusivamente `agent_batch_execution_mark_failed_v1`.
 * Status esperado: 'failed'. Qualquer outro levanta UNEXPECTED_STATUS.
 *
 * IMPORTANTE: errorMessage não é registrado em logs.
 *
 * @param {object}      params
 * @param {object}      params.svc            - Cliente Supabase service_role
 * @param {string}      params.companyId      - UUID da empresa
 * @param {string}      params.batchId        - UUID do lote
 * @param {string}      params.claimToken     - Token de posse do claim
 * @param {string|null} [params.errorCode]    - Código do erro
 * @param {string|null} [params.errorMessage] - Mensagem do erro (não logada)
 *
 * @returns {Promise<object>} Execução normalizada com status = 'failed'
 *
 * @throws {MessageBufferValidationError}
 * @throws {MessageBufferStateError}    - CLAIM_MISMATCH, EMPTY_RPC_RESULT, UNEXPECTED_STATUS
 * @throws {MessageBufferDatabaseError}
 */
export async function markBatchExecutionFailed({
  svc,
  companyId,
  batchId,
  claimToken,
  errorCode    = null,
  errorMessage = null,
}) {
  const OP = 'markBatchExecutionFailed';

  if (!svc)        throw new MessageBufferValidationError(`${OP}: svc é obrigatório`,        { operation: OP, code: 'MISSING_SVC'        });
  if (!companyId)  throw new MessageBufferValidationError(`${OP}: companyId é obrigatório`,  { operation: OP, code: 'MISSING_COMPANY_ID'  });
  if (!batchId)    throw new MessageBufferValidationError(`${OP}: batchId é obrigatório`,    { operation: OP, code: 'MISSING_BATCH_ID'    });
  if (!claimToken) throw new MessageBufferValidationError(`${OP}: claimToken é obrigatório`, { operation: OP, code: 'MISSING_CLAIM_TOKEN' });

  return callSingleExecutionRpc({
    svc,
    rpcName:  'agent_batch_execution_mark_failed_v1',
    rpcParams: {
      p_company_id:    companyId,
      p_batch_id:      batchId,
      p_claim_token:   claimToken,
      p_error_code:    errorCode,
      p_error_message: errorMessage,  // encaminhado à RPC, não logado
    },
    operation:      OP,
    expectedStatus: 'failed',
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// markBatchExecutionCancelled
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cancela uma execução em andamento.
 *
 * Chama exclusivamente `agent_batch_execution_mark_cancelled_v1`.
 * Status esperado: 'cancelled'. Qualquer outro levanta UNEXPECTED_STATUS.
 *
 * IMPORTANTE: reason não é registrado em logs.
 *
 * @param {object}      params
 * @param {object}      params.svc        - Cliente Supabase service_role
 * @param {string}      params.companyId  - UUID da empresa
 * @param {string}      params.batchId    - UUID do lote
 * @param {string}      params.claimToken - Token de posse do claim
 * @param {string|null} [params.reason]   - Motivo (não logado)
 *
 * @returns {Promise<object>} Execução normalizada com status = 'cancelled'
 *
 * @throws {MessageBufferValidationError}
 * @throws {MessageBufferStateError}    - CLAIM_MISMATCH, EMPTY_RPC_RESULT, UNEXPECTED_STATUS
 * @throws {MessageBufferDatabaseError}
 */
export async function markBatchExecutionCancelled({ svc, companyId, batchId, claimToken, reason = null }) {
  const OP = 'markBatchExecutionCancelled';

  if (!svc)        throw new MessageBufferValidationError(`${OP}: svc é obrigatório`,        { operation: OP, code: 'MISSING_SVC'        });
  if (!companyId)  throw new MessageBufferValidationError(`${OP}: companyId é obrigatório`,  { operation: OP, code: 'MISSING_COMPANY_ID'  });
  if (!batchId)    throw new MessageBufferValidationError(`${OP}: batchId é obrigatório`,    { operation: OP, code: 'MISSING_BATCH_ID'    });
  if (!claimToken) throw new MessageBufferValidationError(`${OP}: claimToken é obrigatório`, { operation: OP, code: 'MISSING_CLAIM_TOKEN' });

  return callSingleExecutionRpc({
    svc,
    rpcName:  'agent_batch_execution_mark_cancelled_v1',
    rpcParams: {
      p_company_id:  companyId,
      p_batch_id:    batchId,
      p_claim_token: claimToken,
      p_reason:      reason,  // encaminhado à RPC, não logado
    },
    operation:      OP,
    expectedStatus: 'cancelled',
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// recoverStaleBatchExecutions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recupera execuções presas em 'processing' por timeout ou interrupção do worker.
 *
 * Chama exclusivamente `agent_batch_executions_recover_stale_v1`.
 * Retorno vazio (array vazio) é comportamento normal — não é erro.
 * Execuções recuperadas podem ter status 'retry_pending' ou 'failed'.
 *
 * NÃO chamar automaticamente — sem integração com cron nesta etapa.
 * PREREQUISITO PARA CRON: esta função deve existir e ser testada antes da ativação.
 *
 * @param {object}  params
 * @param {object}  params.svc                        - Cliente Supabase service_role
 * @param {number}  [params.staleAfterSeconds=300]    - Segundos para considerar processing expirado (60–3600)
 * @param {number}  [params.limit=20]                 - Máximo de execuções a recuperar por chamada (1–100)
 *
 * @returns {Promise<Array<object>>} Array normalizado; pode ser vazio.
 *
 * @throws {MessageBufferValidationError}
 * @throws {MessageBufferDatabaseError}
 */
export async function recoverStaleBatchExecutions({ svc, staleAfterSeconds = 300, limit = 20 }) {
  const OP = 'recoverStaleBatchExecutions';

  if (!svc) {
    throw new MessageBufferValidationError(
      `${OP}: svc é obrigatório`,
      { operation: OP, code: 'MISSING_SVC' }
    );
  }
  if (!Number.isInteger(staleAfterSeconds) || staleAfterSeconds < 60 || staleAfterSeconds > 3600) {
    throw new MessageBufferValidationError(
      `${OP}: staleAfterSeconds deve ser inteiro entre 60 e 3600, recebido: ${staleAfterSeconds}`,
      { operation: OP, code: 'INVALID_STALE_AFTER_SECONDS' }
    );
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new MessageBufferValidationError(
      `${OP}: limit deve ser inteiro entre 1 e 100, recebido: ${limit}`,
      { operation: OP, code: 'INVALID_LIMIT' }
    );
  }

  const { data, error } = await svc.rpc('agent_batch_executions_recover_stale_v1', {
    p_stale_after_seconds: staleAfterSeconds,
    p_limit:               limit,
  });

  if (error) {
    const classified = classifyExecutionRpcError(error, OP);
    console.error(`🤖 [EXEC] ❌ ${OP} falhou:`, {
      operation:  OP,
      error_code: classified.code,
    });
    throw classified;
  }

  const rows = Array.isArray(data) ? data : [];

  console.log(`🤖 [EXEC] ✅ ${OP}:`, {
    operation:       OP,
    recovered_count: rows.length,
  });

  return rows.map(mapExecutionRow);
}
