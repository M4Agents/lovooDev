// =============================================================================
// api/lib/agents/messageBufferService.js
//
// Service Layer — Buffer de Mensagens (Agrupamento)
//
// RESPONSABILIDADE ÚNICA:
//   Encapsular acesso às RPCs e tabelas do mecanismo de agrupamento de mensagens.
//   Não contém lógica transacional — toda atomicidade fica nas RPCs.
//   Não cria cliente Supabase — recebe `svc` do chamador.
//
// FUNÇÕES EXPORTADAS:
//   enqueueMessage      — enfileira mensagem via agent_message_enqueue_v1
//   claimDueBatches     — reivindica lotes via agent_message_batches_claim_v1
//   loadBatchMessages   — lê mensagens de um lote com filtros multi-tenant
//   markBatchProcessed  — finaliza lote como processed via mark_processed_v1
//   markBatchRetry      — reagenda/encerra lote via mark_retry_v1 (falhas técnicas)
//   markBatchFailed     — encerra lote como failed via mark_failed_v1
//   markBatchCancelled  — cancela lote via mark_cancelled_v1
//   recoverStaleBatches — recupera lotes travados via recover_stale_v1
//   rescheduleBatch     — reagenda por schedule via reschedule_v1 (sem consumir tentativa)
//
// CLASSES DE ERRO EXPORTADAS:
//   MessageBufferValidationError     — parâmetros inválidos
//   MessageBufferTenantError         — violação multi-tenant ou lote não encontrado
//   MessageBufferDuplicateStateError — estado incompatível ou inconsistência (enqueue)
//   MessageBufferLimitError          — limite do lote atingido
//   MessageBufferDatabaseError       — erro técnico do banco/cliente
//   MessageBufferStateError          — claim mismatch, transição inválida, resultado vazio
//
// MULTI-TENANT:
//   Toda operação exige companyId explícito.
//   loadBatchMessages exige companyId + conversationId + batchId.
//   Nenhuma operação confia apenas em batchId isolado.
//
// SEGURANÇA:
//   `svc` deve ser o cliente service_role criado pelo backend.
//   Este módulo nunca deve ser importado no bundle frontend.
//   Logs não contêm message_text, payload integral, errorMessage, reason ou credenciais.
//
// CONTROLE DE CLAIM (lockedAt):
//   lockedAt funciona como token de posse do claim na V1.
//   O valor deve ser preservado literalmente conforme retornado pela RPC de claim.
//   NÃO converter via new Date(lockedAt).toISOString() — pode perder precisão microssegundos.
//
// CHAMADA REAL:
//   Funções de lifecycle não integradas ainda ao cron ou pipeline do agente.
//   O módulo pode permanecer sem uso até aprovação da etapa seguinte.
// =============================================================================


// ─────────────────────────────────────────────────────────────────────────────
// Erros
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base para todos os erros do service layer do buffer.
 * Preserva o erro original em `cause` para log backend (não expor ao caller).
 */
class MessageBufferError extends Error {
  /**
   * @param {string} message  - Mensagem segura para o caller
   * @param {object} [opts]
   * @param {string} [opts.operation]  - Nome da operação que falhou
   * @param {string} [opts.code]       - Código funcional (ex: 'INVALID_PARAM')
   * @param {Error}  [opts.cause]      - Erro original (para log backend)
   */
  constructor(message, { operation, code, cause } = {}) {
    super(message);
    this.name    = this.constructor.name;
    this.operation = operation ?? null;
    this.code      = code      ?? null;
    this.cause     = cause     ?? null;
  }
}

/** Parâmetro ausente ou inválido antes de chegar à RPC. */
export class MessageBufferValidationError extends MessageBufferError {}

/** Violação multi-tenant: empresa, conversa ou instância inconsistente. Também cobre BATCH_NOT_FOUND. */
export class MessageBufferTenantError extends MessageBufferError {}

/**
 * Estado incompatível ou inconsistência de deduplicação (enqueue).
 * Cobre: INCOMPATIBLE_STATE, DEDUP_INCONSISTENCY.
 */
export class MessageBufferDuplicateStateError extends MessageBufferError {}

/** Limite de mensagens ou texto do lote atingido. */
export class MessageBufferLimitError extends MessageBufferError {}

/** Erro técnico do cliente Supabase ou do banco de dados. */
export class MessageBufferDatabaseError extends MessageBufferError {}

/**
 * Transição de estado inválida, claim mismatch ou resultado vazio inesperado.
 * Cobre: CLAIM_MISMATCH, INVALID_STATE, EMPTY_RPC_RESULT, UNEXPECTED_STATUS.
 */
export class MessageBufferStateError extends MessageBufferError {}


// ─────────────────────────────────────────────────────────────────────────────
// Helper interno: classificar erro da RPC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prefixos funcionais retornados pelas RPCs em mensagens de exceção PostgreSQL.
 * Ordem importa: prefixos mais específicos primeiro.
 *
 * @type {Array<{ prefix: string, ErrorClass: typeof MessageBufferError, code: string }>}
 */
const RPC_ERROR_MAP = [
  { prefix: 'INVALID_PARAM',       ErrorClass: MessageBufferValidationError,     code: 'INVALID_PARAM'       },
  { prefix: 'TENANT_VIOLATION',    ErrorClass: MessageBufferTenantError,          code: 'TENANT_VIOLATION'    },
  { prefix: 'BATCH_NOT_FOUND',     ErrorClass: MessageBufferTenantError,          code: 'BATCH_NOT_FOUND'     },
  { prefix: 'CLAIM_MISMATCH',      ErrorClass: MessageBufferStateError,           code: 'CLAIM_MISMATCH'      },
  { prefix: 'INVALID_STATE',       ErrorClass: MessageBufferStateError,           code: 'INVALID_STATE'       },
  { prefix: 'INCOMPATIBLE_STATE',  ErrorClass: MessageBufferDuplicateStateError,  code: 'INCOMPATIBLE_STATE'  },
  { prefix: 'DEDUP_INCONSISTENCY', ErrorClass: MessageBufferDuplicateStateError,  code: 'DEDUP_INCONSISTENCY' },
  { prefix: 'BATCH_LIMIT_REACHED', ErrorClass: MessageBufferLimitError,           code: 'BATCH_LIMIT_REACHED' },
];

/**
 * Classifica o erro devolvido pelo Supabase em uma das classes de erro do service.
 *
 * @param {object} supabaseError - Erro retornado por `.rpc()` ou `.from()` do Supabase
 * @param {string} operation     - Nome da operação (para contexto no erro)
 * @returns {MessageBufferError}
 */
function classifyRpcError(supabaseError, operation) {
  const msg = supabaseError?.message ?? '';

  for (const { prefix, ErrorClass, code } of RPC_ERROR_MAP) {
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
// enqueueMessage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enfileira uma mensagem em um lote de agrupamento.
 *
 * Chama exclusivamente `agent_message_enqueue_v1`.
 * Toda lógica transacional (dedup, limites, criação de lote) é da RPC.
 *
 * @param {object}      params
 * @param {object}      params.svc                    - Cliente Supabase service_role
 * @param {string}      params.companyId              - UUID da empresa
 * @param {string}      params.conversationId         - UUID da conversa
 * @param {string|null} [params.assignmentId]         - UUID do assignment (opcional)
 * @param {string}      [params.channel='whatsapp']   - Canal
 * @param {number}      params.windowSeconds          - Janela de debounce em segundos
 * @param {number}      [params.maxBatchDurationSeconds=120] - Duração absoluta máxima em segundos
 * @param {string}      params.providerMessageId      - ID da mensagem no provedor
 * @param {string}      params.instanceId             - UUID da instância WhatsApp
 * @param {string|null} [params.messageText]          - Texto da mensagem (opcional)
 * @param {string}      [params.messageType='text']   - Tipo da mensagem
 * @param {Date|string|null} [params.providerTimestamp] - Timestamp do provedor
 * @param {Date|string|null} [params.receivedAt]      - Quando o backend recebeu
 * @param {object}      [params.payload={}]           - Payload bruto
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   inserted: boolean,
 *   duplicate: boolean,
 *   batchId: string,
 *   batchMessageId: string,
 *   batchStatus?: string,
 *   deadlineAt?: string,
 *   maxDeadlineAt?: string,
 *   messageCount?: number,
 *   totalTextLength?: number,
 *   reason: string,
 * }>}
 *
 * @throws {MessageBufferValidationError}
 * @throws {MessageBufferTenantError}
 * @throws {MessageBufferDuplicateStateError}
 * @throws {MessageBufferLimitError}
 * @throws {MessageBufferDatabaseError}
 */
export async function enqueueMessage({
  svc,
  companyId,
  conversationId,
  assignmentId         = null,
  channel              = 'whatsapp',
  windowSeconds,
  maxBatchDurationSeconds = 120,
  providerMessageId,
  instanceId,
  messageText          = null,
  messageType          = 'text',
  providerTimestamp    = null,
  receivedAt           = null,
  payload              = {},
}) {
  const OP = 'enqueueMessage';

  // ── Validação de presença (antes de I/O) ──────────────────────────────────
  if (!svc) {
    throw new MessageBufferValidationError(`${OP}: svc é obrigatório`, { operation: OP, code: 'MISSING_SVC' });
  }
  if (!companyId) {
    throw new MessageBufferValidationError(`${OP}: companyId é obrigatório`, { operation: OP, code: 'MISSING_COMPANY_ID' });
  }
  if (!conversationId) {
    throw new MessageBufferValidationError(`${OP}: conversationId é obrigatório`, { operation: OP, code: 'MISSING_CONVERSATION_ID' });
  }
  if (!providerMessageId) {
    throw new MessageBufferValidationError(`${OP}: providerMessageId é obrigatório`, { operation: OP, code: 'MISSING_PROVIDER_MESSAGE_ID' });
  }
  if (!instanceId) {
    throw new MessageBufferValidationError(`${OP}: instanceId é obrigatório`, { operation: OP, code: 'MISSING_INSTANCE_ID' });
  }
  if (!windowSeconds || windowSeconds <= 0) {
    throw new MessageBufferValidationError(`${OP}: windowSeconds deve ser maior que 0`, { operation: OP, code: 'INVALID_WINDOW_SECONDS' });
  }

  // ── Chamada à RPC ─────────────────────────────────────────────────────────
  const { data, error } = await svc.rpc('agent_message_enqueue_v1', {
    p_company_id:                 companyId,
    p_conversation_id:            conversationId,
    p_window_seconds:             windowSeconds,
    p_provider_message_id:        providerMessageId,
    p_instance_id:                instanceId,
    p_assignment_id:              assignmentId,
    p_channel:                    channel,
    p_max_batch_duration_seconds: maxBatchDurationSeconds,
    p_message_text:               messageText,
    p_message_type:               messageType,
    p_provider_timestamp:         providerTimestamp,
    p_received_at:                receivedAt,
    p_payload:                    payload,
  });

  // ── Tratamento de erro ────────────────────────────────────────────────────
  if (error) {
    const classified = classifyRpcError(error, OP);
    console.error('🤖 [BUFFER] ❌ enqueueMessage falhou:', {
      operation:           OP,
      company_id:          companyId,
      conversation_id:     conversationId,
      provider_message_id: providerMessageId,
      error_code:          classified.code,
    });
    throw classified;
  }

  // ── Normalizar resposta ───────────────────────────────────────────────────
  if (data.inserted) {
    console.log('🤖 [BUFFER] ✅ enqueueMessage: mensagem nova', {
      operation:       OP,
      company_id:      companyId,
      conversation_id: conversationId,
      batch_id:        data.batch_id,
      message_count:   data.message_count,
      batch_status:    data.batch_status,
    });

    return {
      ok:              true,
      inserted:        true,
      duplicate:       false,
      batchId:         data.batch_id,
      batchMessageId:  data.batch_message_id,
      batchStatus:     data.batch_status,
      deadlineAt:      data.deadline_at,
      maxDeadlineAt:   data.max_deadline_at,
      messageCount:    data.message_count,
      totalTextLength: data.total_text_length,
      reason:          data.reason,
    };
  }

  // Duplicata saudável
  console.log('🤖 [BUFFER] ⏭️  enqueueMessage: duplicata saudável', {
    operation:       OP,
    company_id:      companyId,
    conversation_id: conversationId,
    batch_id:        data.batch_id,
    reason:          data.reason,
  });

  return {
    ok:             true,
    inserted:       false,
    duplicate:      true,
    batchId:        data.batch_id,
    batchMessageId: data.batch_message_id,
    reason:         data.reason,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// claimDueBatches
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reivindica atomicamente lotes elegíveis para processamento.
 *
 * Chama exclusivamente `agent_message_batches_claim_v1`.
 * Não faz SELECT seguido de UPDATE.
 * Retorno vazio (array vazio) é comportamento normal — não é erro.
 *
 * @param {object}  params
 * @param {object}  params.svc        - Cliente Supabase service_role
 * @param {number}  [params.limit=20] - Quantidade máxima de lotes a reivindicar (1–100)
 *
 * @returns {Promise<Array<object>>}
 *
 * @throws {MessageBufferValidationError}
 * @throws {MessageBufferDatabaseError}
 */
export async function claimDueBatches({ svc, limit = 20 }) {
  const OP = 'claimDueBatches';

  if (!svc) {
    throw new MessageBufferValidationError(`${OP}: svc é obrigatório`, { operation: OP, code: 'MISSING_SVC' });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new MessageBufferValidationError(
      `${OP}: limit deve ser um inteiro entre 1 e 100, recebido: ${limit}`,
      { operation: OP, code: 'INVALID_LIMIT' }
    );
  }

  const { data, error } = await svc.rpc('agent_message_batches_claim_v1', {
    p_limit: limit,
  });

  if (error) {
    const classified = classifyRpcError(error, OP);
    console.error('🤖 [BUFFER] ❌ claimDueBatches falhou:', {
      operation:  OP,
      limit,
      error_code: classified.code,
    });
    throw classified;
  }

  const rows = data ?? [];

  if (rows.length > 0) {
    console.log('🤖 [BUFFER] ✅ claimDueBatches: lotes reivindicados', {
      operation: OP,
      claimed:   rows.length,
    });
  }

  return rows.map(mapBatchRow);
}

/**
 * Mapeia linha snake_case de agent_message_batches para camelCase.
 * Inclui todos os campos do schema, incluindo campos de lifecycle.
 *
 * @param {object} row
 * @returns {object}
 */
function mapBatchRow(row) {
  return {
    id:                  row.id,
    companyId:           row.company_id,
    conversationId:      row.conversation_id,
    enqueueAssignmentId: row.enqueue_assignment_id ?? null,
    channel:             row.channel,
    status:              row.status,
    deadlineAt:          row.deadline_at,
    nextAttemptAt:       row.next_attempt_at     ?? null,
    lockedAt:            row.locked_at           ?? null,
    attempts:            row.attempts,
    messageCount:        row.message_count,
    totalTextLength:     row.total_text_length,
    // Lifecycle fields
    lastError:           row.last_error          ?? null,
    lastErrorCode:       row.last_error_code      ?? null,
    processedAt:         row.processed_at        ?? null,
    cancelledAt:         row.cancelled_at        ?? null,
    cancellationReason:  row.cancellation_reason ?? null,
    firstMessageAt:      row.first_message_at    ?? null,
    lastMessageAt:       row.last_message_at     ?? null,
    maxDeadlineAt:       row.max_deadline_at     ?? null,
    createdAt:           row.created_at          ?? null,
    updatedAt:           row.updated_at          ?? null,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// loadBatchMessages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lê as mensagens de um lote com filtros obrigatórios multi-tenant.
 *
 * Filtra por company_id + conversation_id + batch_id.
 * Nunca confia apenas em batch_id — garantia multi-tenant explícita.
 *
 * @param {object} params
 * @param {object} params.svc            - Cliente Supabase service_role
 * @param {string} params.companyId      - UUID da empresa (obrigatório)
 * @param {string} params.conversationId - UUID da conversa (obrigatório)
 * @param {string} params.batchId        - UUID do lote (obrigatório)
 *
 * @returns {Promise<Array<object>>}
 *
 * @throws {MessageBufferValidationError}
 * @throws {MessageBufferDatabaseError}
 */
export async function loadBatchMessages({ svc, companyId, conversationId, batchId }) {
  const OP = 'loadBatchMessages';

  if (!svc) {
    throw new MessageBufferValidationError(`${OP}: svc é obrigatório`, { operation: OP, code: 'MISSING_SVC' });
  }
  if (!companyId) {
    throw new MessageBufferValidationError(`${OP}: companyId é obrigatório`, { operation: OP, code: 'MISSING_COMPANY_ID' });
  }
  if (!conversationId) {
    throw new MessageBufferValidationError(`${OP}: conversationId é obrigatório`, { operation: OP, code: 'MISSING_CONVERSATION_ID' });
  }
  if (!batchId) {
    throw new MessageBufferValidationError(`${OP}: batchId é obrigatório`, { operation: OP, code: 'MISSING_BATCH_ID' });
  }

  const { data, error } = await svc
    .from('agent_message_batch_messages')
    .select('id, provider_message_id, instance_id, provider_timestamp, received_at, message_text, message_type, payload')
    .eq('company_id',      companyId)
    .eq('conversation_id', conversationId)
    .eq('batch_id',        batchId)
    .order('provider_timestamp', { ascending: true, nullsFirst: false })
    .order('received_at',        { ascending: true })
    .order('id',                 { ascending: true });

  if (error) {
    console.error('🤖 [BUFFER] ❌ loadBatchMessages falhou:', {
      operation:       OP,
      company_id:      companyId,
      conversation_id: conversationId,
      batch_id:        batchId,
      error_code:      'DB_ERROR',
    });
    throw new MessageBufferDatabaseError(
      `${OP}: falha ao carregar mensagens do lote`,
      { operation: OP, code: 'DB_ERROR', cause: error }
    );
  }

  const rows = data ?? [];

  console.log('🤖 [BUFFER] ✅ loadBatchMessages:', {
    operation:       OP,
    company_id:      companyId,
    conversation_id: conversationId,
    batch_id:        batchId,
    message_count:   rows.length,
  });

  return rows.map((row) => ({
    id:                row.id,
    providerMessageId: row.provider_message_id,
    instanceId:        row.instance_id,
    providerTimestamp: row.provider_timestamp ?? null,
    receivedAt:        row.received_at,
    messageText:       row.message_text ?? null,
    messageType:       row.message_type ?? null,
    payload:           row.payload ?? {},
  }));
}


// ─────────────────────────────────────────────────────────────────────────────
// Helper interno: callSingleBatchRpc
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chama uma RPC de lifecycle que retorna SETOF agent_message_batches (0 ou 1 linha).
 *
 * Centraliza: chamada ao svc.rpc(), classificação de erro, verificação de
 * resultado vazio, validação opcional de status esperado e logs seguros.
 *
 * NÃO usar para RPCs que retornam múltiplas linhas (claim, recovery).
 * Logs não contêm errorMessage, reason, payload ou conteúdo de mensagens.
 *
 * @param {object}      opts
 * @param {object}      opts.svc              - Cliente Supabase service_role
 * @param {string}      opts.rpcName          - Nome da RPC PostgreSQL
 * @param {object}      opts.rpcParams        - Parâmetros p_* para a RPC
 * @param {string}      opts.operation        - Nome da operação JS (logs e erros)
 * @param {string|null} [opts.expectedStatus] - Valida status retornado; null = aceita qualquer
 * @returns {Promise<object>} Lote normalizado em camelCase
 */
async function callSingleBatchRpc({ svc, rpcName, rpcParams, operation, expectedStatus = null }) {
  const { data, error } = await svc.rpc(rpcName, rpcParams);

  if (error) {
    const classified = classifyRpcError(error, operation);
    console.error(`🤖 [BUFFER] ❌ ${operation} falhou:`, {
      operation,
      company_id:  rpcParams.p_company_id,
      batch_id:    rpcParams.p_batch_id,
      error_code:  classified.code,
    });
    throw classified;
  }

  const rows = Array.isArray(data) ? data : [];

  if (rows.length === 0) {
    const err = new MessageBufferStateError(
      `${operation}: RPC retornou resultado vazio`,
      { operation, code: 'EMPTY_RPC_RESULT' },
    );
    console.error(`🤖 [BUFFER] ❌ ${operation} resultado vazio:`, {
      operation,
      company_id:  rpcParams.p_company_id,
      batch_id:    rpcParams.p_batch_id,
      error_code:  'EMPTY_RPC_RESULT',
    });
    throw err;
  }

  const batch = mapBatchRow(rows[0]);

  if (expectedStatus !== null && batch.status !== expectedStatus) {
    const err = new MessageBufferStateError(
      `${operation}: status inesperado '${batch.status}'`,
      { operation, code: 'UNEXPECTED_STATUS' },
    );
    console.error(`🤖 [BUFFER] ❌ ${operation} status inesperado:`, {
      operation,
      company_id:  rpcParams.p_company_id,
      batch_id:    rpcParams.p_batch_id,
      status:      batch.status,
      error_code:  'UNEXPECTED_STATUS',
    });
    throw err;
  }

  console.log(`🤖 [BUFFER] ✅ ${operation}:`, {
    operation,
    company_id:  rpcParams.p_company_id,
    batch_id:    rpcParams.p_batch_id,
    status:      batch.status,
    attempts:    batch.attempts,
    locked_at:   rpcParams.p_locked_at,
  });

  return batch;
}


// ─────────────────────────────────────────────────────────────────────────────
// markBatchProcessed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finaliza um lote como processado com sucesso.
 *
 * Chama exclusivamente `agent_message_batch_mark_processed_v1`.
 *
 * lockedAt funciona como token de posse do claim (V1).
 * Deve ser a string literal retornada por claimDueBatches — não converter.
 *
 * @param {object} params
 * @param {object} params.svc       - Cliente Supabase service_role
 * @param {string} params.companyId - UUID da empresa
 * @param {string} params.batchId   - UUID do lote
 * @param {string} params.lockedAt  - Valor de locked_at retornado pelo claim (token de posse)
 *
 * @returns {Promise<object>} Lote normalizado com status = 'processed'
 *
 * @throws {MessageBufferValidationError}
 * @throws {MessageBufferTenantError}    - BATCH_NOT_FOUND
 * @throws {MessageBufferStateError}     - CLAIM_MISMATCH, EMPTY_RPC_RESULT
 * @throws {MessageBufferDatabaseError}
 */
export async function markBatchProcessed({ svc, companyId, batchId, lockedAt }) {
  const OP = 'markBatchProcessed';

  if (!svc)       throw new MessageBufferValidationError(`${OP}: svc é obrigatório`,       { operation: OP, code: 'MISSING_SVC'       });
  if (!companyId) throw new MessageBufferValidationError(`${OP}: companyId é obrigatório`, { operation: OP, code: 'MISSING_COMPANY_ID' });
  if (!batchId)   throw new MessageBufferValidationError(`${OP}: batchId é obrigatório`,   { operation: OP, code: 'MISSING_BATCH_ID'   });
  if (!lockedAt)  throw new MessageBufferValidationError(`${OP}: lockedAt é obrigatório`,  { operation: OP, code: 'MISSING_LOCKED_AT'  });

  return callSingleBatchRpc({
    svc,
    rpcName:        'agent_message_batch_mark_processed_v1',
    rpcParams:      { p_company_id: companyId, p_batch_id: batchId, p_locked_at: lockedAt },
    operation:      OP,
    expectedStatus: 'processed',
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// markBatchRetry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reagenda ou encerra um lote com falha, dependendo do número de tentativas.
 *
 * Chama exclusivamente `agent_message_batch_mark_retry_v1`.
 *
 * O status retornado pode ser 'retry_pending' (attempts < 3) ou 'failed'
 * (attempts >= 3 — a RPC transiciona diretamente, sem estado inválido).
 * O service não presume qual status será retornado.
 *
 * IMPORTANTE: errorMessage não é registrado em logs (conteúdo potencialmente sensível).
 *
 * @param {object}      params
 * @param {object}      params.svc          - Cliente Supabase service_role
 * @param {string}      params.companyId    - UUID da empresa
 * @param {string}      params.batchId      - UUID do lote
 * @param {string}      params.lockedAt     - Token de posse do claim
 * @param {string|null} [params.errorCode]  - Código do erro (max 100 chars pela RPC)
 * @param {string|null} [params.errorMessage] - Mensagem do erro (max 2000 chars; não logada)
 *
 * @returns {Promise<object>} Lote normalizado com status = 'retry_pending' ou 'failed'
 *
 * @throws {MessageBufferValidationError}
 * @throws {MessageBufferTenantError}
 * @throws {MessageBufferStateError}
 * @throws {MessageBufferDatabaseError}
 */
export async function markBatchRetry({ svc, companyId, batchId, lockedAt, errorCode = null, errorMessage = null }) {
  const OP = 'markBatchRetry';

  if (!svc)       throw new MessageBufferValidationError(`${OP}: svc é obrigatório`,       { operation: OP, code: 'MISSING_SVC'       });
  if (!companyId) throw new MessageBufferValidationError(`${OP}: companyId é obrigatório`, { operation: OP, code: 'MISSING_COMPANY_ID' });
  if (!batchId)   throw new MessageBufferValidationError(`${OP}: batchId é obrigatório`,   { operation: OP, code: 'MISSING_BATCH_ID'   });
  if (!lockedAt)  throw new MessageBufferValidationError(`${OP}: lockedAt é obrigatório`,  { operation: OP, code: 'MISSING_LOCKED_AT'  });

  // expectedStatus = null: retry_pending e failed são ambos estados válidos
  return callSingleBatchRpc({
    svc,
    rpcName:  'agent_message_batch_mark_retry_v1',
    rpcParams: {
      p_company_id:    companyId,
      p_batch_id:      batchId,
      p_locked_at:     lockedAt,
      p_error_code:    errorCode,
      p_error_message: errorMessage,
    },
    operation:      OP,
    expectedStatus: null,
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// markBatchFailed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encerra um lote como permanentemente falho.
 *
 * Chama exclusivamente `agent_message_batch_mark_failed_v1`.
 * Se a RPC retornar status diferente de 'failed', lança MessageBufferStateError.
 *
 * IMPORTANTE: errorMessage não é registrado em logs.
 *
 * @param {object}      params
 * @param {object}      params.svc          - Cliente Supabase service_role
 * @param {string}      params.companyId    - UUID da empresa
 * @param {string}      params.batchId      - UUID do lote
 * @param {string}      params.lockedAt     - Token de posse do claim
 * @param {string|null} [params.errorCode]  - Código do erro
 * @param {string|null} [params.errorMessage] - Mensagem do erro (não logada)
 *
 * @returns {Promise<object>} Lote normalizado com status = 'failed'
 *
 * @throws {MessageBufferValidationError}
 * @throws {MessageBufferTenantError}
 * @throws {MessageBufferStateError}
 * @throws {MessageBufferDatabaseError}
 */
export async function markBatchFailed({ svc, companyId, batchId, lockedAt, errorCode = null, errorMessage = null }) {
  const OP = 'markBatchFailed';

  if (!svc)       throw new MessageBufferValidationError(`${OP}: svc é obrigatório`,       { operation: OP, code: 'MISSING_SVC'       });
  if (!companyId) throw new MessageBufferValidationError(`${OP}: companyId é obrigatório`, { operation: OP, code: 'MISSING_COMPANY_ID' });
  if (!batchId)   throw new MessageBufferValidationError(`${OP}: batchId é obrigatório`,   { operation: OP, code: 'MISSING_BATCH_ID'   });
  if (!lockedAt)  throw new MessageBufferValidationError(`${OP}: lockedAt é obrigatório`,  { operation: OP, code: 'MISSING_LOCKED_AT'  });

  return callSingleBatchRpc({
    svc,
    rpcName:  'agent_message_batch_mark_failed_v1',
    rpcParams: {
      p_company_id:    companyId,
      p_batch_id:      batchId,
      p_locked_at:     lockedAt,
      p_error_code:    errorCode,
      p_error_message: errorMessage,
    },
    operation:      OP,
    expectedStatus: 'failed',
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// markBatchCancelled
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cancela um lote em processamento.
 *
 * Chama exclusivamente `agent_message_batch_mark_cancelled_v1`.
 * Se a RPC retornar status diferente de 'cancelled', lança MessageBufferStateError.
 *
 * IMPORTANTE: reason não é registrado em logs (conteúdo potencialmente sensível).
 *
 * @param {object}      params
 * @param {object}      params.svc       - Cliente Supabase service_role
 * @param {string}      params.companyId - UUID da empresa
 * @param {string}      params.batchId   - UUID do lote
 * @param {string}      params.lockedAt  - Token de posse do claim
 * @param {string|null} [params.reason]  - Motivo do cancelamento (não logado)
 *
 * @returns {Promise<object>} Lote normalizado com status = 'cancelled'
 *
 * @throws {MessageBufferValidationError}
 * @throws {MessageBufferTenantError}
 * @throws {MessageBufferStateError}
 * @throws {MessageBufferDatabaseError}
 */
export async function markBatchCancelled({ svc, companyId, batchId, lockedAt, reason = null }) {
  const OP = 'markBatchCancelled';

  if (!svc)       throw new MessageBufferValidationError(`${OP}: svc é obrigatório`,       { operation: OP, code: 'MISSING_SVC'       });
  if (!companyId) throw new MessageBufferValidationError(`${OP}: companyId é obrigatório`, { operation: OP, code: 'MISSING_COMPANY_ID' });
  if (!batchId)   throw new MessageBufferValidationError(`${OP}: batchId é obrigatório`,   { operation: OP, code: 'MISSING_BATCH_ID'   });
  if (!lockedAt)  throw new MessageBufferValidationError(`${OP}: lockedAt é obrigatório`,  { operation: OP, code: 'MISSING_LOCKED_AT'  });

  return callSingleBatchRpc({
    svc,
    rpcName:  'agent_message_batch_mark_cancelled_v1',
    rpcParams: {
      p_company_id: companyId,
      p_batch_id:   batchId,
      p_locked_at:  lockedAt,
      p_reason:     reason,
    },
    operation:      OP,
    expectedStatus: 'cancelled',
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// recoverStaleBatches
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recupera lotes em processamento cujo locked_at expirou.
 *
 * Chama exclusivamente `agent_message_batches_recover_stale_v1`.
 * Retorno vazio é comportamento normal — não é erro.
 * Lotes recuperados podem ter status 'retry_pending' ou 'failed'.
 *
 * NÃO chamar automaticamente nesta etapa — sem integração com cron.
 *
 * @param {object}  params
 * @param {object}  params.svc                     - Cliente Supabase service_role
 * @param {number}  [params.staleAfterSeconds=300] - Segundos para considerar lock expirado (60–3600)
 * @param {number}  [params.limit=20]              - Máximo de lotes a recuperar por chamada (1–100)
 *
 * @returns {Promise<Array<object>>} Array normalizado; pode ser vazio.
 *
 * @throws {MessageBufferValidationError}
 * @throws {MessageBufferDatabaseError}
 */
export async function recoverStaleBatches({ svc, staleAfterSeconds = 300, limit = 20 }) {
  const OP = 'recoverStaleBatches';

  if (!svc) {
    throw new MessageBufferValidationError(`${OP}: svc é obrigatório`, { operation: OP, code: 'MISSING_SVC' });
  }
  if (!Number.isInteger(staleAfterSeconds) || staleAfterSeconds < 60 || staleAfterSeconds > 3600) {
    throw new MessageBufferValidationError(
      `${OP}: staleAfterSeconds deve ser inteiro entre 60 e 3600, recebido: ${staleAfterSeconds}`,
      { operation: OP, code: 'INVALID_STALE_AFTER_SECONDS' },
    );
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new MessageBufferValidationError(
      `${OP}: limit deve ser inteiro entre 1 e 100, recebido: ${limit}`,
      { operation: OP, code: 'INVALID_LIMIT' },
    );
  }

  const { data, error } = await svc.rpc('agent_message_batches_recover_stale_v1', {
    p_stale_after_seconds: staleAfterSeconds,
    p_limit:               limit,
  });

  if (error) {
    const classified = classifyRpcError(error, OP);
    console.error('🤖 [BUFFER] ❌ recoverStaleBatches falhou:', {
      operation:  OP,
      error_code: classified.code,
    });
    throw classified;
  }

  const rows = Array.isArray(data) ? data : [];

  console.log('🤖 [BUFFER] ✅ recoverStaleBatches:', {
    operation:       OP,
    recovered_count: rows.length,
  });

  return rows.map(mapBatchRow);
}


// ─────────────────────────────────────────────────────────────────────────────
// rescheduleBatch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reagenda um lote para a próxima janela de schedule sem consumir tentativa técnica.
 *
 * Transição: processing → retry_pending, com next_attempt_at explícito.
 * A RPC compensa o incremento de attempts feito pelo claim:
 *   attempts = GREATEST(attempts - 1, 0)
 *
 * Diferença de markBatchRetry:
 *   - Não usa backoff fixo (30s/120s)
 *   - Recebe nextAttemptAt explícito (calculado por getNextAllowedScheduleAt)
 *   - Não incrementa attempts (schedule não é falha técnica)
 *
 * @param {{ svc, companyId, batchId, lockedAt, nextAttemptAt, reason? }} params
 * @throws {MessageBufferValidationError} Se parâmetros obrigatórios estiverem ausentes
 * @throws {MessageBufferDatabaseError}
 */
export async function rescheduleBatch({ svc, companyId, batchId, lockedAt, nextAttemptAt, reason = null }) {
  const OP = 'rescheduleBatch';

  if (!svc)           throw new MessageBufferValidationError(`${OP}: svc é obrigatório`,          { operation: OP, code: 'MISSING_SVC'       });
  if (!companyId)     throw new MessageBufferValidationError(`${OP}: companyId é obrigatório`,    { operation: OP, code: 'MISSING_COMPANY_ID' });
  if (!batchId)       throw new MessageBufferValidationError(`${OP}: batchId é obrigatório`,      { operation: OP, code: 'MISSING_BATCH_ID'   });
  if (!lockedAt)      throw new MessageBufferValidationError(`${OP}: lockedAt é obrigatório`,     { operation: OP, code: 'MISSING_LOCKED_AT'  });
  if (!nextAttemptAt) throw new MessageBufferValidationError(`${OP}: nextAttemptAt é obrigatório`,{ operation: OP, code: 'MISSING_NEXT_AT'    });

  console.log(`🤖 [BUFFER] ⏰ ${OP}: reagendando lote para próxima janela`, {
    operation:       OP,
    company_id:      companyId,
    batch_id:        batchId,
    next_attempt_at: nextAttemptAt instanceof Date
      ? nextAttemptAt.toISOString()
      : String(nextAttemptAt),
  });

  return callSingleBatchRpc({
    svc,
    rpcName:  'agent_message_batch_reschedule_v1',
    rpcParams: {
      p_company_id:      companyId,
      p_batch_id:        batchId,
      p_locked_at:       lockedAt,
      p_next_attempt_at: nextAttemptAt instanceof Date
        ? nextAttemptAt.toISOString()
        : nextAttemptAt,
      p_reason:          reason,
    },
    operation:      OP,
    expectedStatus: 'retry_pending',
  });
}
