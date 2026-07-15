// =============================================================================
// api/lib/agents/groupedAgentAdapter.js
//
// GroupedAgentAdapter — Adaptador de Execução Interna para Lotes Agrupados
//
// RESPONSABILIDADE ÚNICA:
//   Executar o pipeline completo do agente (contextBuilder → agentExecutor →
//   responseComposer → whatsappGateway) para um lote de mensagens agrupadas,
//   sem passar pelo endpoint HTTP /api/agents/execute-agent.
//
// FLUXO (Etapa 13 — ordem atualizada):
//   1. Validar parâmetros obrigatórios
//   2. Criar ou encontrar sessão (agent_conversation_sessions) via findOrCreateSession
//   3. Adquirir lock de conversação (agent_processing_locks) — Etapa 13 Parte A
//   4. Verificar mensagens outbound já persistidas para o runId — Etapa 13 Parte D
//   5. Montar OrchestratorContext sintético com grouped_messages
//   6. Chamar buildContext → ContextBuilderOutput
//   7. Chamar executeAgent → AgentExecutorOutput
//   8. Chamar compose → ResponseComposerOutput
//   9. Chamar sendBlocks → resultado de envio
//  10. Liberar lock (finally — garantido mesmo em exceção)
//  11. Retornar contrato normalizado
//
// IDENTIFICADOR ESTÁVEL:
//   runId = executionId (recebido externamente — nunca gerado aqui)
//   Esse ID flui até chat_messages.ai_run_id via whatsappGateway → chat_create_message
//
// LOCK POR CONVERSA (Etapa 13):
//   Usa acquireConversationLock/releaseConversationLock de conversationLock.js.
//   Garante no máximo uma execução ativa por (company_id + conversation_id).
//   Lote que não adquire lock retorna retryable=true sem chamar LLM.
//   Lock é liberado no bloco finally — nunca deixado preso por exceção.
//
// RECONCILIAÇÃO OUTBOUND (Etapa 13):
//   Antes do LLM, verifica chat_messages para o runId.
//   - Nenhuma mensagem  → executar LLM normalmente
//   - Todas confirmadas → retorna sucesso reconciliado sem LLM (reconciled=true)
//   - Alguma pendente/falha → retorna OUTBOUND_RETRY_ONLY sem LLM
//   - Estado desconhecido → retorna OUTBOUND_UNKNOWN sem reenviar
//
// PENDÊNCIA DOCUMENTADA:
//   - execution_log_id: após buildContext + executeAgent retornar o ID do log em
//     ai_agent_execution_logs, o campo agent_batch_executions.execution_log_id deve
//     ser atualizado. Requer RPC segura de UPDATE. Não implementado em V1.
//   - outboundMessageIds: gateway não rastreia IDs individuais das mensagens enviadas;
//     apenas successCount e abortReason estão disponíveis.
//   - Janela residual de outbound: se a mensagem foi persistida e o envio foi iniciado
//     mas o timeout ocorreu antes da confirmação, o retry da execução pode persistir
//     o mesmo ai_run_id sem duplicação, mas o envio pode ou não ter chegado ao provider.
//
// LOGS PERMITIDOS:
//   operation, company_id, conversation_id, batch_id, execution_id,
//   run_id, session_id, stage, status, success_count, abort_reason, duration_ms
//   PROIBIDO: claimToken, errorMessage bruto, conteúdo de mensagens, payload,
//   prompt, resposta LLM, credenciais, secrets.
// =============================================================================

import { findOrCreateSession }             from './conversationOrchestrator.js';
import { buildContext }                    from './contextBuilder.js';
import { executeAgent }                    from './agentExecutor.js';
import { compose }                         from './responseComposer.js';
import { sendBlocks }                      from './whatsappGateway.js';
import { acquireConversationLock,
         releaseConversationLock }         from './conversationLock.js';
import { loadExistingOutboundForRun }      from './outboundReconciliation.js';

// ── Contrato de retorno ───────────────────────────────────────────────────────

/**
 * @typedef {Object} AdapterSuccess
 * @property {true} ok
 * @property {string} runId
 * @property {null} executionLogId       - Pendência V1: não wired ainda
 * @property {string[]} outboundMessageIds - Vazio: gateway não rastreia IDs individuais
 * @property {number} successCount
 * @property {string|null} abortReason
 */

/**
 * @typedef {Object} AdapterFailure
 * @property {false} ok
 * @property {boolean} retryable
 * @property {string} category
 * @property {string} errorCode
 * @property {string} errorMessage        - Sanitizado: não inclui conteúdo do usuário
 */

// ── Classificação de erros ────────────────────────────────────────────────────

const RETRYABLE_STAGES = new Set(['context', 'execute']);

/**
 * Classifica um erro de execução em retryable ou terminal.
 * Retryable: falhas transitórias de infra (DB, LLM indisponível).
 * Terminal:  erros de configuração, agente inativo, etc.
 */
function classifyAdapterError(error, stage) {
  if (!error) return { retryable: false, category: 'terminal' };
  // Sinalização explícita do erro
  if (error.retryable === true)  return { retryable: true,  category: 'retryable' };
  if (error.retryable === false) return { retryable: false, category: 'terminal' };
  // Inferência por estágio
  if (RETRYABLE_STAGES.has(stage)) return { retryable: true, category: 'retryable' };
  return { retryable: false, category: 'terminal' };
}

/** Limita código a 100 chars */
function sanitizeCode(code) {
  return String(code ?? 'ADAPTER_ERROR').slice(0, 100);
}

/** Limita mensagem a 200 chars; nunca inclui conteúdo do usuário */
function sanitizeMsg(msg) {
  return String(msg ?? 'Falha no adaptador de execução agrupada').slice(0, 200);
}

// ── executeGroupedAgentInternal ───────────────────────────────────────────────

/**
 * Executa o pipeline completo do agente para um lote de mensagens agrupadas.
 *
 * @param {object} params
 * @param {object}   params.svc               - Cliente Supabase service_role (para sessão)
 * @param {string}   params.companyId
 * @param {string}   params.conversationId
 * @param {string}   params.assignmentId      - effectiveAssignmentId da revalidação
 * @param {string}   params.agentId           - agentId validado pela revalidação
 * @param {string}   [params.instanceId]      - instanceId validado pela revalidação (Etapa 13)
 * @param {string}   params.runId             - = executionId (estável, nunca regenerado)
 * @param {string}   params.executionId       - agent_batch_executions.id
 * @param {string}   params.batchId           - agent_message_batches.id
 * @param {Array}    params.groupedMessages   - Mensagens formatadas do lote
 * @param {object}   [params.dependencies={}] - Overrides para teste
 *
 * @returns {Promise<AdapterSuccess|AdapterFailure>}
 */
export async function executeGroupedAgentInternal({
  svc,
  companyId,
  conversationId,
  assignmentId,
  agentId,
  instanceId  = null,  // validado pela revalidação (Etapa 13)
  runId,
  executionId,
  batchId,
  groupedMessages,
  dependencies = {},
}) {
  const OP = 'executeGroupedAgentInternal';
  const startMs = Date.now();

  const deps = {
    findOrCreateSession:      dependencies.findOrCreateSession      ?? findOrCreateSession,
    acquireConversationLock:  dependencies.acquireConversationLock  ?? acquireConversationLock,
    releaseConversationLock:  dependencies.releaseConversationLock  ?? releaseConversationLock,
    loadExistingOutboundForRun: dependencies.loadExistingOutboundForRun ?? loadExistingOutboundForRun,
    buildContext:             dependencies.buildContext             ?? buildContext,
    executeAgent:             dependencies.executeAgent             ?? executeAgent,
    compose:                  dependencies.compose                  ?? compose,
    sendBlocks:               dependencies.sendBlocks               ?? sendBlocks,
  };

  // ── Validação de parâmetros ───────────────────────────────────────────────
  if (!companyId)       return _fail('INVALID_PARAM', 'companyId obrigatório', false);
  if (!conversationId)  return _fail('INVALID_PARAM', 'conversationId obrigatório', false);
  if (!assignmentId)    return _fail('INVALID_PARAM', 'assignmentId obrigatório', false);
  if (!agentId)         return _fail('INVALID_PARAM', 'agentId obrigatório', false);
  if (!runId)           return _fail('INVALID_PARAM', 'runId obrigatório', false);
  if (!executionId)     return _fail('INVALID_PARAM', 'executionId obrigatório', false);
  if (!batchId)         return _fail('INVALID_PARAM', 'batchId obrigatório', false);
  if (!Array.isArray(groupedMessages) || groupedMessages.length === 0) {
    return _fail('INVALID_PARAM', 'groupedMessages deve ser array não vazio', false);
  }

  console.log(`🤖 [ADAPTER] 🚀 ${OP}:`, {
    operation:       OP,
    company_id:      companyId,
    conversation_id: conversationId,
    batch_id:        batchId,
    execution_id:    executionId,
    run_id:          runId,
    message_count:   groupedMessages.length,
  });

  // ── PASSO 1: Criar/encontrar sessão ──────────────────────────────────────
  let sessionId;
  try {
    const sessionResult = await deps.findOrCreateSession(svc, {
      companyId,
      conversationId,
      assignmentId,
      ruleId: null,
    });
    sessionId = sessionResult.sessionId;
  } catch (err) {
    console.error(`🤖 [ADAPTER] ❌ ${OP}: falha ao criar sessão`, {
      operation:       OP,
      company_id:      companyId,
      conversation_id: conversationId,
      stage:           'session',
    });
    return _fail('SESSION_ERROR', err.message, true);
  }

  console.log(`🤖 [ADAPTER] 📋 ${OP}: sessão`, {
    operation:   OP,
    company_id:  companyId,
    session_id:  sessionId,
  });

  // ── PASSO 2: Adquirir lock de conversação (Etapa 13 — Parte A) ───────────
  // Garante no máximo uma execução ativa por (company_id + conversation_id).
  // Lock SEMPRE liberado no bloco finally — nunca deixado preso por exceção.
  let lockResult;
  try {
    lockResult = await deps.acquireConversationLock(svc, {
      companyId,       // Etapa 13.1: obrigatório para multi-tenant
      conversationId,
      runId,           // runId = executionId — identificador estável
    });
  } catch (lockErr) {
    console.error(`🤖 [ADAPTER] ❌ ${OP}: erro ao adquirir lock`, {
      operation:       OP,
      company_id:      companyId,
      conversation_id: conversationId,
      stage:           'lock',
    });
    return _fail('LOCK_ERROR', lockErr.message, true);
  }

  if (!lockResult.acquired) {
    console.log(`🤖 [ADAPTER] ⏭️  ${OP}: lock ocupado — outra execução ativa na mesma conversa`, {
      operation:       OP,
      company_id:      companyId,
      conversation_id: conversationId,
      batch_id:        batchId,
      execution_id:    executionId,
    });
    // Lock_busy é retryable: o lote deve aguardar a execução atual terminar
    return _fail('LOCK_BUSY', 'Conversa já está sendo processada', true);
  }

  // Lock adquirido — garantir liberação no finally independente do caminho de saída
  let lockReleased = false;
    const ensureLockReleased = async () => {
    if (!lockReleased) {
      lockReleased = true;
      await deps.releaseConversationLock(svc, { companyId, conversationId, runId });
    }
  };

  try {
    // ── PASSO 3: Verificar outbound existente para o runId (Etapa 13 — Parte D) ───
    // Antes de executar o LLM, verifica se já existem blocos persistidos para este runId.
    // Evita re-execução do LLM e reenvio cego em caso de retry da mesma execução.

    // ── Parte D — Reconciliação outbound FAIL-CLOSED (Etapa 13.1) ──────────────
    // Se a consulta falhar, NÃO chamar LLM. Não é possível confirmar se já houve
    // persistência — executar poderia duplicar blocos enviados ao cliente.
    let existingOutbound;
    try {
      existingOutbound = await deps.loadExistingOutboundForRun({
        svc, companyId, conversationId, runId,
      });
    } catch (reconcileErr) {
      console.error(`🤖 [ADAPTER] ❌ ${OP}: falha ao verificar outbound — bloqueando execução (fail-closed)`, {
        operation:       OP,
        company_id:      companyId,
        conversation_id: conversationId,
        execution_id:    executionId,
        stage:           'reconciliation_check',
      });
      // FAIL-CLOSED: incerteza no estado outbound = não pode avançar
      return _fail(
        'OUTBOUND_RECONCILIATION_UNAVAILABLE',
        'Não foi possível confirmar o estado outbound da execução.',
        true,  // retryable: nova tentativa pode ter o banco disponível
      );
    }

    if (existingOutbound.hasExisting) {
      // Mensagens já persistidas para este runId

      if (existingOutbound.allConfirmed) {
        // Todos os blocos confirmados (status='sent') → sucesso reconciliado sem LLM
        console.log(`🤖 [ADAPTER] ✅ ${OP}: sucesso reconciliado — outbound já confirmado`, {
          operation:       OP,
          company_id:      companyId,
          conversation_id: conversationId,
          execution_id:    executionId,
          run_id:          runId,
          message_count:   existingOutbound.messages.length,
          stage:           'reconciliation',
        });
        return {
          ok:                 true,
          runId,
          executionLogId:     null,
          outboundMessageIds: [],
          successCount:       existingOutbound.messages.length,
          abortReason:        null,
          reconciled:         true, // indica que não re-executou o LLM
        };
      }

      if (existingOutbound.hasPending || existingOutbound.hasFailed) {
        // Blocos persistidos com envio pendente ou falho — retry somente do outbound
        // NÃO re-executar LLM. Reenvio automático não implementado — aguardar análise do gateway.
        console.log(`🤖 [ADAPTER] ⏭️  ${OP}: outbound pendente/falho — retry somente do outbound`, {
          operation:       OP,
          company_id:      companyId,
          conversation_id: conversationId,
          execution_id:    executionId,
          run_id:          runId,
          outbound_status: existingOutbound.status,
          stage:           'reconciliation',
        });
        return _fail('OUTBOUND_RETRY_ONLY', 'Retry somente do outbound — não re-executar LLM', true);
      }

      // Estado desconhecido — não reenviar automaticamente
      console.warn(`🤖 [ADAPTER] ⚠️  ${OP}: estado outbound desconhecido — aguardar investigação`, {
        operation:       OP,
        company_id:      companyId,
        conversation_id: conversationId,
        execution_id:    executionId,
        run_id:          runId,
        outbound_status: existingOutbound.status,
        stage:           'reconciliation',
      });
      return _fail('OUTBOUND_UNKNOWN', 'Estado de outbound desconhecido — não reenviar automaticamente', false);
    }

    // ── PASSO 4: Montar OrchestratorContext sintético ─────────────────────────
    // grouped_messages é o campo que contextBuilder usa para formatar user_message.
    // contact_phone: null — whatsappGateway re-fetches from DB.

    const orchestratorContext = {
      run_id:               runId,        // = executionId — nunca regenerado
      session_id:           sessionId,
      is_new_session:       false,

      assignment_id:        assignmentId,
      agent_id:             agentId,
      rule_id:              null,
      capabilities:         { can_auto_reply: true }, // validado em revalidateBatchState
      price_display_policy: null,
      flow_state_id:        null,
      locked_opportunity_id: null,

      conversation: {
        id:            conversationId,
        contact_phone: null,              // gateway refetches from chat_conversations
        ai_state:      'ai_active',       // revalidado antes de chegar aqui
      },

      event: {
        company_id:      companyId,
        conversation_id: conversationId,
        message_text:    null,            // ignorado quando grouped_messages presente
        channel:         'whatsapp',
      },

      // Campo exclusivo do fluxo agrupado — não existe em execuções individuais.
      // contextBuilder usa este campo para formatar user_message quando presente.
      grouped_messages: groupedMessages,
    };

    // ── PASSO 5: Construir contexto ───────────────────────────────────────────
    let contextOutput;
    try {
      const ctxResult = await deps.buildContext(orchestratorContext);

      if (!ctxResult.success) {
        const skipReason = ctxResult.skip_reason ?? 'context_build_failed';
        const isRetryable = skipReason === 'error' || skipReason === 'agent_fetch_failed';
        console.error(`🤖 [ADAPTER] ❌ ${OP}: buildContext falhou`, {
          operation:       OP,
          company_id:      companyId,
          conversation_id: conversationId,
          batch_id:        batchId,
          stage:           'context',
          skip_reason:     skipReason,
        });
        return _fail('CONTEXT_BUILD_FAILED', skipReason, isRetryable);
      }

      contextOutput = ctxResult.output;
    } catch (err) {
      console.error(`🤖 [ADAPTER] ❌ ${OP}: buildContext exception`, {
        operation:  OP,
        company_id: companyId,
        stage:      'context',
      });
      return _fail('CONTEXT_BUILD_ERROR', err.message, true);
    }

    // ── PASSO 6: Executar agente (LLM) ───────────────────────────────────────
    let executorOutput;
    try {
      const execResult = await deps.executeAgent(contextOutput);

      if (!execResult.success) {
        const skipReason = execResult.skip_reason ?? 'agent_execution_failed';
        const isRetryable = skipReason === 'error';
        console.error(`🤖 [ADAPTER] ❌ ${OP}: executeAgent falhou`, {
          operation:       OP,
          company_id:      companyId,
          conversation_id: conversationId,
          batch_id:        batchId,
          execution_id:    executionId,
          stage:           'execute',
          skip_reason:     skipReason,
        });
        return _fail('AGENT_EXECUTION_FAILED', skipReason, isRetryable);
      }

      executorOutput = execResult.output;
    } catch (err) {
      console.error(`🤖 [ADAPTER] ❌ ${OP}: executeAgent exception`, {
        operation:    OP,
        company_id:   companyId,
        execution_id: executionId,
        stage:        'execute',
      });
      return _fail('AGENT_EXECUTION_ERROR', err.message, true);
    }

    // ── PASSO 7: Compor resposta em blocos ───────────────────────────────────
    let composerOutput;
    try {
      const composeResult = deps.compose(executorOutput);

      if (!composeResult.success) {
        const skipReason = composeResult.skip_reason ?? 'compose_failed';
        console.warn(`🤖 [ADAPTER] ⚠️  ${OP}: compose falhou (não retryable)`, {
          operation:    OP,
          company_id:   companyId,
          execution_id: executionId,
          stage:        'compose',
          skip_reason:  skipReason,
        });
        return _fail('COMPOSE_FAILED', skipReason, false);
      }

      composerOutput = composeResult.output;
    } catch (err) {
      console.error(`🤖 [ADAPTER] ❌ ${OP}: compose exception`, {
        operation:  OP,
        company_id: companyId,
        stage:      'compose',
      });
      return _fail('COMPOSE_ERROR', err.message, false);
    }

    // ── PASSO 8: Enviar blocos via WhatsApp ──────────────────────────────────
    let gatewayResult;
    try {
      gatewayResult = await deps.sendBlocks(composerOutput);
    } catch (err) {
      console.error(`🤖 [ADAPTER] ❌ ${OP}: sendBlocks exception`, {
        operation:    OP,
        company_id:   companyId,
        execution_id: executionId,
        stage:        'send',
      });
      return _fail('SEND_ERROR', err.message, true);
    }

    const durationMs = Date.now() - startMs;

    console.log(`🤖 [ADAPTER] ✅ ${OP}: concluído`, {
      operation:       OP,
      company_id:      companyId,
      conversation_id: conversationId,
      batch_id:        batchId,
      execution_id:    executionId,
      run_id:          runId,
      session_id:      sessionId,
      status:          'completed',
      success_count:   gatewayResult.successCount ?? 0,
      abort_reason:    gatewayResult.abortReason  ?? null,
      duration_ms:     durationMs,
    });

    return {
      ok:               true,
      runId,
      executionLogId:   null,
      outboundMessageIds: [],
      successCount:     gatewayResult.successCount ?? 0,
      abortReason:      gatewayResult.abortReason  ?? null,
    };

  } finally {
    // Lock liberado SEMPRE — sucesso, abort ou exceção não capturada
    await ensureLockReleased();
  }
}

// ── Helper interno ────────────────────────────────────────────────────────────

function _fail(code, rawMsg, retryable) {
  return {
    ok:           false,
    retryable:    Boolean(retryable),
    category:     retryable ? 'retryable' : 'terminal',
    errorCode:    sanitizeCode(code),
    errorMessage: sanitizeMsg(rawMsg),
  };
}
