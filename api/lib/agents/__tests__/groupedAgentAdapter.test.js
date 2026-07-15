// =============================================================================
// Testes unitários — groupedAgentAdapter.js
//
// Framework: vitest
// Estratégia: mocks completos de todas as dependências de I/O.
//   - Sem conexão com banco real
//   - Sem chamadas de rede, LLM ou WhatsApp
//   - Testa exclusivamente a lógica do adaptador
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeGroupedAgentInternal } from '../groupedAgentAdapter.js';

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const COMPANY_ID      = 'company-uuid-adapter-1';
const CONV_ID         = 'conv-uuid-adapter-1';
const ASSIGN_ID       = 'assign-uuid-adapter-1';
const AGENT_ID        = 'agent-uuid-adapter-1';
const RUN_ID          = 'exec-uuid-adapter-1'; // runId = executionId
const EXECUTION_ID    = 'exec-uuid-adapter-1';
const BATCH_ID        = 'batch-uuid-adapter-1';
const SESSION_ID      = 'session-uuid-adapter-1';

function makeMessages(count = 2) {
  return Array.from({ length: count }, (_, i) => ({
    messageId:         `msg-${i + 1}`,
    providerMessageId: `wamid-${i + 1}`,
    text:              `Mensagem ${i + 1}`,
    type:              'text',
    receivedAt:        '2026-07-15T10:00:00.000Z',
    providerTimestamp: null,
    payload:           {},
  }));
}

function makeSvc() {
  return { rpc: vi.fn(), from: vi.fn() };
}

const NO_EXISTING_OUTBOUND = { hasExisting: false, status: 'none', messages: [], allConfirmed: false, hasPending: false, hasFailed: false, hasUnknown: false };

function makeDefaultDeps(overrides = {}) {
  return {
    findOrCreateSession:      vi.fn().mockResolvedValue({ sessionId: SESSION_ID, isNewSession: false }),
    // Etapa 13 — Parte A: lock por conversa
    acquireConversationLock:  vi.fn().mockResolvedValue({ acquired: true }),
    releaseConversationLock:  vi.fn().mockResolvedValue(undefined),
    // Etapa 13 — Parte D: outbound reconciliation
    loadExistingOutboundForRun: vi.fn().mockResolvedValue(NO_EXISTING_OUTBOUND),
    buildContext: vi.fn().mockResolvedValue({
      success: true,
      output: {
        run_id:      RUN_ID,
        session_id:  SESSION_ID,
        agent:       { id: AGENT_ID, prompt: 'test', model: 'gpt-4o', knowledge_mode: 'none', knowledge_base: null, allowed_tools: [] },
        conversation: { id: CONV_ID, contact_phone: null, recent_messages: [] },
        contact:     { lead_id: null, name: null, phone: null },
        catalog:     { products: [], services: [] },
        item_of_interest: null,
        ambiguous_candidates: [],
        is_comparison: false,
        user_message: '[Mensagem 1 — 10:00]\nMensagem 1',
        capabilities: { can_auto_reply: true },
        price_display_policy: null,
        system_policy: null,
        locked_opportunity_id: null,
        conversation_memory: null,
        company_data: null,
        metadata: { company_id: COMPANY_ID, assignment_id: ASSIGN_ID, rule_id: null, flow_state_id: null },
      },
    }),
    executeAgent: vi.fn().mockResolvedValue({
      success: true,
      output:  { raw_response: 'Resposta do agente', run_id: RUN_ID, session_id: SESSION_ID, metadata: { company_id: COMPANY_ID } },
    }),
    compose: vi.fn().mockReturnValue({
      success: true,
      output:  { run_id: RUN_ID, session_id: SESSION_ID, blocks: [{ index: 0, type: 'text', content: 'Resposta' }], metadata: { company_id: COMPANY_ID, conversation_id: CONV_ID, assignment_id: ASSIGN_ID } },
    }),
    sendBlocks: vi.fn().mockResolvedValue({ success: true, successCount: 1, abortReason: null }),
    ...overrides,
  };
}

function makeBaseParams(overrides = {}) {
  return {
    svc:             makeSvc(),
    companyId:       COMPANY_ID,
    conversationId:  CONV_ID,
    assignmentId:    ASSIGN_ID,
    agentId:         AGENT_ID,
    runId:           RUN_ID,
    executionId:     EXECUTION_ID,
    batchId:         BATCH_ID,
    groupedMessages: makeMessages(),
    dependencies:    makeDefaultDeps(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TC-AD26 — Sucesso retorna contrato normalizado
// ---------------------------------------------------------------------------

describe('executeGroupedAgentInternal — sucesso', () => {
  it('TC-AD26 — sucesso retorna contrato normalizado com ok=true e runId', async () => {
    const result = await executeGroupedAgentInternal(makeBaseParams());

    expect(result.ok).toBe(true);
    expect(result.runId).toBe(RUN_ID);
    expect(result.executionLogId).toBeNull();
    expect(Array.isArray(result.outboundMessageIds)).toBe(true);
    expect(typeof result.successCount).toBe('number');
  });

  it('TC-RI22 — runId no retorno é exatamente o executionId recebido', async () => {
    const CUSTOM_RUN_ID = 'custom-run-id-fixed';
    const result = await executeGroupedAgentInternal(makeBaseParams({
      runId:       CUSTOM_RUN_ID,
      executionId: CUSTOM_RUN_ID,
    }));

    expect(result.ok).toBe(true);
    expect(result.runId).toBe(CUSTOM_RUN_ID);
  });

  it('TC-RI23 — adaptador nunca gera novo UUID: runId é o recebido', async () => {
    // runId vem de fora — adaptador nunca chama randomUUID()
    const params = makeBaseParams();
    const result = await executeGroupedAgentInternal(params);

    expect(result.runId).toBe(params.runId);
    expect(result.runId).toBe(params.executionId);
  });

  it('TC-RI24 — runId chega ao buildContext via run_id no OrchestratorContext', async () => {
    const deps = makeDefaultDeps();
    await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    const ctxArg = deps.buildContext.mock.calls[0][0];
    expect(ctxArg.run_id).toBe(RUN_ID);
  });

  it('TC-RI25 — run_id no composerOutput passado para sendBlocks corresponde ao executionId', async () => {
    const deps = makeDefaultDeps();
    await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    const blocksArg = deps.sendBlocks.mock.calls[0][0];
    expect(blocksArg.run_id).toBe(RUN_ID);
  });
});

// ---------------------------------------------------------------------------
// TC-AD27 — Falha retryable normalizada
// ---------------------------------------------------------------------------

describe('executeGroupedAgentInternal — falhas retryable', () => {
  it('TC-AD27 — buildContext falha com skip_reason=error → retryable', async () => {
    const deps = makeDefaultDeps({
      buildContext: vi.fn().mockResolvedValue({ success: false, skip_reason: 'error', error: 'db_error' }),
    });
    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.errorCode).toBe('CONTEXT_BUILD_FAILED');
  });

  it('TC-AD27b — findOrCreateSession lança exceção → retryable=true', async () => {
    const deps = makeDefaultDeps({
      findOrCreateSession: vi.fn().mockRejectedValue(new Error('DB connection failed')),
    });
    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.errorCode).toBe('SESSION_ERROR');
  });

  it('TC-AD27c — executeAgent lança exceção → retryable=true', async () => {
    const deps = makeDefaultDeps({
      executeAgent: vi.fn().mockRejectedValue(new Error('OpenAI timeout')),
    });
    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.errorCode).toBe('AGENT_EXECUTION_ERROR');
  });

  it('TC-AD27d — sendBlocks lança exceção → retryable=true', async () => {
    const deps = makeDefaultDeps({
      sendBlocks: vi.fn().mockRejectedValue(new Error('Network timeout')),
    });
    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.errorCode).toBe('SEND_ERROR');
  });
});

// ---------------------------------------------------------------------------
// TC-AD28 — Falha terminal normalizada
// ---------------------------------------------------------------------------

describe('executeGroupedAgentInternal — falhas terminais', () => {
  it('TC-AD28 — buildContext agent_not_found → não retryable', async () => {
    const deps = makeDefaultDeps({
      buildContext: vi.fn().mockResolvedValue({ success: false, skip_reason: 'agent_not_found' }),
    });
    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.errorCode).toBe('CONTEXT_BUILD_FAILED');
  });

  it('TC-AD28b — executeAgent empty_user_message → não retryable', async () => {
    const deps = makeDefaultDeps({
      executeAgent: vi.fn().mockResolvedValue({ success: false, skip_reason: 'empty_user_message' }),
    });
    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.errorCode).toBe('AGENT_EXECUTION_FAILED');
  });

  it('TC-AD28c — compose falha → terminal', async () => {
    const deps = makeDefaultDeps({
      compose: vi.fn().mockReturnValue({ success: false, skip_reason: 'empty_response' }),
    });
    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.errorCode).toBe('COMPOSE_FAILED');
  });
});

// ---------------------------------------------------------------------------
// TC-AD29 — Erro técnico inesperado classificado
// ---------------------------------------------------------------------------

describe('executeGroupedAgentInternal — erro técnico inesperado', () => {
  it('TC-AD29 — buildContext lança exceção inesperada → classificado como retryable', async () => {
    const deps = makeDefaultDeps({
      buildContext: vi.fn().mockRejectedValue(new Error('Unexpected internal error')),
    });
    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('CONTEXT_BUILD_ERROR');
    expect(result.errorMessage).toBeTruthy();
    // Sanitização: message limitada a 200 chars
    expect(result.errorMessage.length).toBeLessThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// TC-AD30 — Segurança nos logs
// ---------------------------------------------------------------------------

describe('executeGroupedAgentInternal — segurança', () => {
  it('TC-AD30 — logs não contêm conteúdo de mensagem, payload ou credencial', async () => {
    const logCalls = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logCalls.push(args));
    vi.spyOn(console, 'error').mockImplementation((...args) => logCalls.push(args));

    const secretMessage = 'SENHA_SECRETA_USUARIO_12345';
    const msgs = makeMessages();
    msgs[0].text = secretMessage;

    await executeGroupedAgentInternal(makeBaseParams({ groupedMessages: msgs }));

    const logStr = JSON.stringify(logCalls);
    expect(logStr).not.toContain(secretMessage);
    expect(logStr).not.toContain('claimToken');
    expect(logStr).not.toContain('errorMessage');
  });

  it('TC-AD30b — nenhum teste acessa banco real (svc.from não é chamado no caminho feliz)', async () => {
    const svc = { rpc: vi.fn(), from: vi.fn() };
    const result = await executeGroupedAgentInternal(makeBaseParams({ svc }));

    // Sessão é criada via deps.findOrCreateSession (mockado), não via svc.from
    expect(result.ok).toBe(true);
    // svc.from nunca é chamado pelo adaptador diretamente
    expect(svc.from).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Validação de parâmetros
// ---------------------------------------------------------------------------

describe('executeGroupedAgentInternal — validação de parâmetros', () => {
  const required = ['companyId', 'conversationId', 'assignmentId', 'agentId', 'runId', 'executionId', 'batchId'];

  for (const field of required) {
    it(`rejeita ${field} ausente → ok=false, errorCode=INVALID_PARAM`, async () => {
      const params = makeBaseParams({ [field]: null });
      const result = await executeGroupedAgentInternal(params);

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('INVALID_PARAM');
    });
  }

  it('rejeita groupedMessages vazio → ok=false, errorCode=INVALID_PARAM', async () => {
    const result = await executeGroupedAgentInternal(makeBaseParams({ groupedMessages: [] }));

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('INVALID_PARAM');
  });

  it('rejeita groupedMessages não-array → ok=false, errorCode=INVALID_PARAM', async () => {
    const result = await executeGroupedAgentInternal(makeBaseParams({ groupedMessages: 'texto' }));

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('INVALID_PARAM');
  });
});

// ---------------------------------------------------------------------------
// Passagem correta de parâmetros para dependências
// ---------------------------------------------------------------------------

describe('executeGroupedAgentInternal — mapeamento de parâmetros', () => {
  it('findOrCreateSession recebe companyId, conversationId, assignmentId e ruleId=null', async () => {
    const deps = makeDefaultDeps();
    await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(deps.findOrCreateSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId:      COMPANY_ID,
        conversationId: CONV_ID,
        assignmentId:   ASSIGN_ID,
        ruleId:         null,
      })
    );
  });

  it('buildContext recebe grouped_messages no OrchestratorContext', async () => {
    const msgs = makeMessages(3);
    const deps = makeDefaultDeps();
    await executeGroupedAgentInternal(makeBaseParams({ groupedMessages: msgs, dependencies: deps }));

    const ctxArg = deps.buildContext.mock.calls[0][0];
    expect(ctxArg.grouped_messages).toEqual(msgs);
    expect(ctxArg.event.message_text).toBeNull();
  });

  it('buildContext recebe agent_id correto', async () => {
    const deps = makeDefaultDeps();
    await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    const ctxArg = deps.buildContext.mock.calls[0][0];
    expect(ctxArg.agent_id).toBe(AGENT_ID);
  });

  it('executeAgent recebe output do buildContext (run_id correto)', async () => {
    const deps = makeDefaultDeps();
    await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    // Verificar que o argumento passado ao executeAgent tem run_id correto
    // (origina do output do buildContext, que tem run_id = RUN_ID)
    const execArg = deps.executeAgent.mock.calls[0][0];
    expect(execArg).toBeDefined();
    expect(execArg.run_id).toBe(RUN_ID);
    expect(execArg.metadata?.company_id).toBe(COMPANY_ID);
  });

  it('compose recebe output do executeAgent (raw_response presente)', async () => {
    const deps = makeDefaultDeps();
    await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    // Verificar que o argumento passado ao compose tem raw_response
    const composeArg = deps.compose.mock.calls[0][0];
    expect(composeArg).toBeDefined();
    expect(composeArg.raw_response).toBe('Resposta do agente');
    expect(composeArg.run_id).toBe(RUN_ID);
  });

  it('sendBlocks recebe output do compose', async () => {
    const deps = makeDefaultDeps();
    await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    const composeOutput = deps.compose.mock.results[0].value.output;
    expect(deps.sendBlocks).toHaveBeenCalledWith(composeOutput);
  });
});

// =============================================================================
// Etapa 13 — Parte A: Lock por conversa
// =============================================================================

describe('Etapa 13 — lock por conversa', () => {
  it('TC-E13-LOCK-1: lote A adquire lock e executa LLM', async () => {
    const deps = makeDefaultDeps();
    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(deps.acquireConversationLock).toHaveBeenCalledOnce();
    expect(deps.acquireConversationLock).toHaveBeenCalledWith(
      expect.anything(), // svc
      expect.objectContaining({ companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID })
    );
    expect(result.ok).toBe(true);
  });

  it('TC-E13-LOCK-2: lote B com lock ocupado não chama LLM', async () => {
    const deps = makeDefaultDeps({
      acquireConversationLock: vi.fn().mockResolvedValue({ acquired: false, reason: 'lock_busy' }),
    });

    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(deps.buildContext).not.toHaveBeenCalled();
    expect(deps.executeAgent).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('LOCK_BUSY');
    expect(result.retryable).toBe(true);
  });

  it('TC-E13-LOCK-3: conversas distintas podem executar (mocks isolados)', async () => {
    const deps1 = makeDefaultDeps();
    const deps2 = makeDefaultDeps();

    const [r1, r2] = await Promise.all([
      executeGroupedAgentInternal(makeBaseParams({ dependencies: deps1, conversationId: 'conv-A' })),
      executeGroupedAgentInternal(makeBaseParams({ dependencies: deps2, conversationId: 'conv-B' })),
    ]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it('TC-E13-LOCK-4: lock liberado em sucesso — com companyId + conversationId + runId', async () => {
    const deps = makeDefaultDeps();
    await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(deps.releaseConversationLock).toHaveBeenCalledOnce();
    expect(deps.releaseConversationLock).toHaveBeenCalledWith(
      expect.anything(), // svc
      expect.objectContaining({ companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID })
    );
  });

  it('TC-E13-LOCK-5: lock liberado mesmo quando executeAgent lança exceção', async () => {
    const deps = makeDefaultDeps({
      executeAgent: vi.fn().mockRejectedValue(new Error('LLM offline')),
    });

    await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    // Lock deve ser liberado mesmo com exceção
    expect(deps.releaseConversationLock).toHaveBeenCalledOnce();
  });

  it('TC-E13-LOCK-6: erro ao adquirir lock → retorno retryable', async () => {
    const deps = makeDefaultDeps({
      acquireConversationLock: vi.fn().mockRejectedValue(new Error('DB timeout')),
    });

    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('LOCK_ERROR');
    expect(result.retryable).toBe(true);
    // Lock não deve ser liberado (não foi adquirido)
    expect(deps.releaseConversationLock).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Etapa 13 — Parte D: Reconciliação outbound
// =============================================================================

describe('Etapa 13 — reconciliação outbound', () => {
  it('TC-E13-OUT-1: sem mensagens persistidas → executa LLM normalmente', async () => {
    const deps = makeDefaultDeps({
      loadExistingOutboundForRun: vi.fn().mockResolvedValue(NO_EXISTING_OUTBOUND),
    });

    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(deps.executeAgent).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.reconciled).toBeUndefined();
  });

  it('TC-E13-OUT-2: mensagens confirmadas → não executa LLM, retorna reconciliado', async () => {
    const deps = makeDefaultDeps({
      loadExistingOutboundForRun: vi.fn().mockResolvedValue({
        hasExisting:  true,
        messages:     [{ id: 'm1', ai_block_index: 0, status: 'sent' }],
        allConfirmed: true,
        hasPending:   false,
        hasFailed:    false,
        hasUnknown:   false,
        status:       'all_confirmed',
      }),
    });

    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(deps.buildContext).not.toHaveBeenCalled();
    expect(deps.executeAgent).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.reconciled).toBe(true);
    expect(result.runId).toBe(RUN_ID);
  });

  it('TC-E13-OUT-3: mensagens pendentes → não executa LLM, retorna retry_outbound_only', async () => {
    const deps = makeDefaultDeps({
      loadExistingOutboundForRun: vi.fn().mockResolvedValue({
        hasExisting:  true,
        messages:     [{ id: 'm1', ai_block_index: 0, status: 'pending' }],
        allConfirmed: false,
        hasPending:   true,
        hasFailed:    false,
        hasUnknown:   false,
        status:       'has_pending',
      }),
    });

    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(deps.executeAgent).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('OUTBOUND_RETRY_ONLY');
    expect(result.retryable).toBe(true);
  });

  it('TC-E13-OUT-4: estado desconhecido → não reenvia, retorna OUTBOUND_UNKNOWN', async () => {
    const deps = makeDefaultDeps({
      loadExistingOutboundForRun: vi.fn().mockResolvedValue({
        hasExisting:  true,
        messages:     [{ id: 'm1', ai_block_index: 0, status: 'delivered' }],
        allConfirmed: false,
        hasPending:   false,
        hasFailed:    false,
        hasUnknown:   true,
        status:       'unknown',
      }),
    });

    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(deps.executeAgent).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('OUTBOUND_UNKNOWN');
    expect(result.retryable).toBe(false); // não reenviar automaticamente
  });

  it('TC-E13-OUT-5: consulta inclui company_id, conversation_id e runId', async () => {
    const loadMock = vi.fn().mockResolvedValue(NO_EXISTING_OUTBOUND);
    const deps = makeDefaultDeps({ loadExistingOutboundForRun: loadMock });

    await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(loadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId:      COMPANY_ID,
        conversationId: CONV_ID,
        runId:          RUN_ID,
      })
    );
  });

  it('TC-E13-OUT-6: retry da mesma execução reutiliza runId (não gera novo UUID)', async () => {
    const FIXED_RUN_ID = 'fixed-run-id-for-retry';
    const deps = makeDefaultDeps();

    const result = await executeGroupedAgentInternal(makeBaseParams({
      dependencies: deps,
      runId:        FIXED_RUN_ID,
      executionId:  FIXED_RUN_ID,
    }));

    expect(result.runId).toBe(FIXED_RUN_ID);

    const loadCall = deps.loadExistingOutboundForRun.mock.calls[0][0];
    expect(loadCall.runId).toBe(FIXED_RUN_ID);
  });

  it('TC-E13-OUT-7: falha na verificação de outbound — FAIL-CLOSED, não chama LLM', async () => {
    const deps = makeDefaultDeps({
      loadExistingOutboundForRun: vi.fn().mockRejectedValue(new Error('DB timeout')),
    });

    // Etapa 13.1 — Parte B: falha = não pode confirmar estado = não executa LLM
    const result = await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(deps.executeAgent).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('OUTBOUND_RECONCILIATION_UNAVAILABLE');
    expect(result.retryable).toBe(true);
  });

  it('TC-E13-OUT-7b: falha de outbound não chama composer nem gateway', async () => {
    const deps = makeDefaultDeps({
      loadExistingOutboundForRun: vi.fn().mockRejectedValue(new Error('DB timeout')),
    });

    await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    expect(deps.compose).not.toHaveBeenCalled();
    expect(deps.sendBlocks).not.toHaveBeenCalled();
  });

  it('TC-E13-OUT-8: conteúdo de mensagens não aparece em logs', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const deps = makeDefaultDeps({
      loadExistingOutboundForRun: vi.fn().mockResolvedValue({
        hasExisting:  true,
        messages:     [{ id: 'm1', ai_block_index: 0, status: 'pending' }],
        allConfirmed: false,
        hasPending:   true,
        hasFailed:    false,
        hasUnknown:   false,
        status:       'has_pending',
      }),
    });

    await executeGroupedAgentInternal(makeBaseParams({ dependencies: deps }));

    const allLogs = warnSpy.mock.calls.flat();
    const logStr  = JSON.stringify(allLogs);

    expect(logStr).not.toContain('content');
    expect(logStr).not.toContain('payload');
    expect(logStr).not.toContain('claimToken');

    warnSpy.mockRestore();
  });
});
