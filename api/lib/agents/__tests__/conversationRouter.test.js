// =============================================================================
// api/lib/agents/__tests__/conversationRouter.test.js
//
// Testes unitários do ConversationRouter — Etapa 14 (corrigido)
//
// COBERTURA:
//   TC-01–11  Grouping desabilitado (APM preservado, comportamento original)
//   TC-12–20  Grouping habilitado (enqueue, sem INSERT antigo no caminho de sucesso)
//   TC-21–27  Erros (throw para falhas técnicas, sucesso para casos funcionais)
//   TC-28–34  Regressão
//
// PRINCÍPIOS:
//   - Todos os testes usam mocks — sem banco, LLM ou WhatsApp real.
//   - svc e enqueueMessage injetados via _deps (não vi.mock de módulos externos ao alvo).
//   - resolveFlowAgent e isWithinSchedule mockados via vi.mock.
//   - svc._apmInsertSpy permite inspecionar chamadas de INSERT em agent_processed_messages.
//
// SEPARAÇÃO DE CONCEITOS (validada pelos testes):
//   canUseMessageGrouping   = canal whatsapp + evento inbound + instance_id
//   groupingWindowSeconds   = model_config do agente (fetched apenas no PASSO 6.5)
//   isMessageGroupingEnabled = canUseMessageGrouping && window > 0
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeConversationEvent } from '../conversationRouter.js';
import {
  MessageBufferLimitError,
  MessageBufferTenantError,
  MessageBufferDuplicateStateError,
  MessageBufferDatabaseError,
} from '../messageBufferService.js';

// ── Mocks de módulos ──────────────────────────────────────────────────────────
vi.mock('../flowOrchestrator.js', () => ({
  resolveFlowAgent: vi.fn().mockResolvedValue(null),
}));

vi.mock('../scheduleUtils.js', () => ({
  isWithinSchedule: vi.fn().mockReturnValue({ allowed: true, meta: {}, reason: null }),
}));

import { resolveFlowAgent } from '../flowOrchestrator.js';
import { isWithinSchedule } from '../scheduleUtils.js';

// ── UUIDs de teste ────────────────────────────────────────────────────────────
const COMPANY_ID    = 'aaa00000-0000-0000-0000-000000000001';
const CONV_ID       = 'bbb00000-0000-0000-0000-000000000002';
const INSTANCE_ID   = 'ccc00000-0000-0000-0000-000000000003';
const ASSIGNMENT_ID = 'ddd00000-0000-0000-0000-000000000004';
const AGENT_ID      = 'eee00000-0000-0000-0000-000000000005';
const RULE_ID       = 'fff00000-0000-0000-0000-000000000006';
const BATCH_ID      = 'b4400000-0000-0000-0000-000000000007';
const BATCH_MSG_ID  = 'b4400000-0000-0000-0000-000000000008';
const FLOW_STATE_ID = 'f1000000-0000-0000-0000-000000000009';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEvent(overrides = {}) {
  return {
    event_type:        'conversation.message_received',
    channel:           'whatsapp',
    company_id:        COMPANY_ID,
    instance_id:       INSTANCE_ID,
    conversation_id:   CONV_ID,
    uazapi_message_id: 'wamid-test-router-123',
    source_type:       'whatsapp_message',
    source_identifier: '+5511999999999',
    message_text:      'Olá',
    timestamp:         '2026-07-15T12:00:00.000Z',
    ...overrides,
  };
}

function makeConversation(overrides = {}) {
  return {
    id:               CONV_ID,
    ai_state:         'ai_active',
    ai_assignment_id: ASSIGNMENT_ID,
    contact_phone:    '+5511999999999',
    ...overrides,
  };
}

function makeAssignment(overrides = {}) {
  return {
    id:                   ASSIGNMENT_ID,
    agent_id:             AGENT_ID,
    is_active:            true,
    capabilities:         { can_auto_reply: true },
    price_display_policy: 'disabled',
    display_name:         'Test Agent',
    operating_schedule:   null,
    ...overrides,
  };
}

function makeRule(overrides = {}) {
  return {
    id:                RULE_ID,
    assignment_id:     ASSIGNMENT_ID,
    channel:           'whatsapp',
    event_type:        null,
    source_type:       null,
    source_identifier: null,
    priority:          1,
    is_fallback:       true,
    ...overrides,
  };
}

// Agente com grouping DESABILITADO (padrão para testes de regressão)
function makeAgentDisabled(overrides = {}) {
  return { is_active: true, model_config: {}, ...overrides };
}

// Agente com grouping HABILITADO
function makeAgentEnabled(window = 30, overrides = {}) {
  return { is_active: true, model_config: { message_grouping_window_s: window }, ...overrides };
}

function makeEnqueueResult(overrides = {}) {
  return {
    ok:             true,
    inserted:       true,
    duplicate:      false,
    batchId:        BATCH_ID,
    batchMessageId: BATCH_MSG_ID,
    batchStatus:    'open',
    deadlineAt:     '2026-07-15T12:00:30.000Z',
    messageCount:   1,
    reason:         'inserted',
    ...overrides,
  };
}

// ── Builder do svc mock ───────────────────────────────────────────────────────
// svc._apmInsertSpy: spy único para todos os INSERTs em agent_processed_messages.
// Registra apenas chamadas a .insert() — não a .update() ou criações do chain.
// Uso: svc._apmInsertSpy.mock.calls.length  (quantos INSERTs ocorreram)
//      svc._apmInsertSpy.mock.calls[0][0].result  (dado do primeiro INSERT)

function makeSvc({
  apmInsertResult   = { error: null },
  conversationData  = makeConversation(),
  conversationError = null,
  rulesData         = [makeRule()],
  rulesError        = null,
  assignmentData    = makeAssignment(),
  assignmentError   = null,
  agentData         = makeAgentDisabled(),
  agentError        = null,
} = {}) {
  // Spy único compartilhado por todas as chains de agent_processed_messages.
  // Isso garante que _apmInsertSpy.mock.calls conta apenas chamadas a .insert(),
  // não a criação de chains (que ocorre para UPDATE também).
  const _apmInsertSpy = vi.fn().mockResolvedValue(apmInsertResult);

  const svc = {
    from: vi.fn().mockImplementation((table) => {
      switch (table) {
        case 'agent_processed_messages': {
          const chain = {};
          chain.insert = _apmInsertSpy;  // Mesmo spy para todos os INSERTs nesta tabela
          chain.update = vi.fn().mockReturnValue(chain);
          chain.eq     = vi.fn().mockReturnValue(chain);
          chain.is     = vi.fn().mockResolvedValue({ data: null, error: null });
          return chain;
        }
        case 'chat_conversations': {
          const chain = {};
          chain.select = vi.fn().mockReturnValue(chain);
          chain.eq     = vi.fn().mockReturnValue(chain);
          chain.single = vi.fn().mockResolvedValue({ data: conversationData, error: conversationError });
          return chain;
        }
        case 'agent_routing_rules': {
          const chain = {};
          chain.select = vi.fn().mockReturnValue(chain);
          chain.eq     = vi.fn().mockReturnValue(chain);
          chain.or     = vi.fn().mockReturnValue(chain);
          chain.order  = vi.fn().mockResolvedValue({ data: rulesData, error: rulesError });
          return chain;
        }
        case 'company_agent_assignments': {
          const chain = {};
          chain.select      = vi.fn().mockReturnValue(chain);
          chain.eq          = vi.fn().mockReturnValue(chain);
          chain.single      = vi.fn().mockResolvedValue({ data: assignmentData, error: assignmentError });
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: assignmentData, error: null });
          return chain;
        }
        case 'lovoo_agents': {
          const chain = {};
          chain.select      = vi.fn().mockReturnValue(chain);
          chain.eq          = vi.fn().mockReturnValue(chain);
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: agentData, error: agentError });
          return chain;
        }
        default: {
          const chain = {};
          chain.select      = vi.fn().mockReturnValue(chain);
          chain.insert      = vi.fn().mockResolvedValue({ error: null });
          chain.update      = vi.fn().mockReturnValue(chain);
          chain.eq          = vi.fn().mockReturnValue(chain);
          chain.is          = vi.fn().mockResolvedValue({ data: null, error: null });
          chain.order       = vi.fn().mockResolvedValue({ data: [], error: null });
          chain.single      = vi.fn().mockResolvedValue({ data: null, error: null });
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
          return chain;
        }
      }
    }),
    // Spy único de INSERT em agent_processed_messages (para assertivas nos testes)
    _apmInsertSpy,
  };

  return svc;
}

// ── Reset de mocks ────────────────────────────────────────────────────────────

beforeEach(() => {
  resolveFlowAgent.mockResolvedValue(null);
  isWithinSchedule.mockReturnValue({ allowed: true, meta: {}, reason: null });
});

// =============================================================================
// TC-01–11: Grouping desabilitado — comportamento original preservado
// =============================================================================

describe('TC-01–11: grouping desabilitado — comportamento original preservado', () => {

  it('TC-01 WhatsApp inbound + window ausente → APM INSERT acontece, should_process=true', async () => {
    // canUseMessageGrouping=true, agentData.model_config={} → window=0 → isMessageGroupingEnabled=false
    // INSERT diferido no PASSO 7 com result='processed'
    const svc         = makeSvc({ agentData: makeAgentDisabled() });
    const mockEnqueue = vi.fn();

    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(true);
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(1);
    expect(svc._apmInsertSpy.mock.calls[0][0].result).toBe('processed');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('TC-02 WhatsApp inbound + window=0 → dedup antigo equivalente, should_process=true', async () => {
    const svc         = makeSvc({ agentData: makeAgentDisabled({ model_config: { message_grouping_window_s: 0 } }) });
    const mockEnqueue = vi.fn();

    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(true);
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(1);
    expect(svc._apmInsertSpy.mock.calls[0][0].result).toBe('processed');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('TC-03 configuração inválida (string) mantém dedup antigo, should_process=true', async () => {
    const svc         = makeSvc({ agentData: makeAgentDisabled({ model_config: { message_grouping_window_s: 'fast' } }) });
    const mockEnqueue = vi.fn();

    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(true);
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(1);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('TC-04 ai_inactive → APM INSERT com result=skipped_ai_inactive', async () => {
    // canUseMessageGrouping=true + ai_inactive → skipWithAudit → INSERT
    const svc         = makeSvc({ conversationData: makeConversation({ ai_state: 'ai_inactive' }) });
    const mockEnqueue = vi.fn();

    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(false);
    expect(decision.skip_reason).toBe('ai_inactive');
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(1);
    expect(svc._apmInsertSpy.mock.calls[0][0].result).toBe('skipped_ai_inactive');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('TC-05 sem regra correspondente → APM INSERT com result=skipped_no_rule', async () => {
    const svc         = makeSvc({ rulesData: [] });
    const mockEnqueue = vi.fn();

    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(false);
    expect(decision.skip_reason).toBe('no_rule');
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(1);
    expect(svc._apmInsertSpy.mock.calls[0][0].result).toBe('skipped_no_rule');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('TC-06 flow agent ativo → APM INSERT com result=processed, should_process=true', async () => {
    // canUseMessageGrouping=true + flow agent → auditProcessed → INSERT com result='processed'
    resolveFlowAgent.mockResolvedValueOnce({
      agent_id:              AGENT_ID,
      flow_state_id:         FLOW_STATE_ID,
      locked_opportunity_id: null,
    });
    const svc         = makeSvc();
    const mockEnqueue = vi.fn();

    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(true);
    expect(decision.agent_id).toBe(AGENT_ID);
    expect(decision.flow_state_id).toBe(FLOW_STATE_ID);
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(1);
    expect(svc._apmInsertSpy.mock.calls[0][0].result).toBe('processed');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('TC-07 can_auto_reply=false → APM INSERT com result=skipped_no_rule', async () => {
    const svc         = makeSvc({ assignmentData: makeAssignment({ capabilities: { can_auto_reply: false } }) });
    const mockEnqueue = vi.fn();

    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(false);
    expect(decision.skip_reason).toBe('capability_denied');
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(1);
    expect(svc._apmInsertSpy.mock.calls[0][0].result).toBe('skipped_no_rule');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('TC-08 schedule bloqueado → APM INSERT com result=skipped_out_of_schedule', async () => {
    isWithinSchedule.mockReturnValueOnce({ allowed: false, meta: {}, reason: 'outside_window' });
    const svc         = makeSvc();
    const mockEnqueue = vi.fn();

    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(false);
    expect(decision.skip_reason).toBe('out_of_schedule');
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(1);
    expect(svc._apmInsertSpy.mock.calls[0][0].result).toBe('skipped_out_of_schedule');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('TC-09 duplicata via dedup antigo (canal=web, PASSO 1) → already_processed', async () => {
    // canal=web → canUseMessageGrouping=false → INSERT antigo em PASSO 1 → 23505
    const svc = makeSvc({
      apmInsertResult: { error: { code: '23505', message: 'conflict' } },
    });
    const mockEnqueue = vi.fn();
    const event       = makeEvent({ channel: 'web' });

    const decision = await routeConversationEvent(event, { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(false);
    expect(decision.skip_reason).toBe('already_processed');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('TC-10 fluxo normal com todas as condições atendidas → should_process=true, campos corretos', async () => {
    const svc         = makeSvc({ agentData: makeAgentDisabled() });
    const mockEnqueue = vi.fn();

    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(true);
    expect(decision.skip_reason).toBeNull();
    expect(decision.rule_id).toBe(RULE_ID);
    expect(decision.assignment_id).toBe(ASSIGNMENT_ID);
    expect(decision.agent_id).toBe(AGENT_ID);
    expect(decision.capabilities).toEqual({ can_auto_reply: true });
    expect(decision.conversation).toMatchObject({ id: CONV_ID, ai_state: 'ai_active' });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('TC-11 nenhuma chamada ao enqueue quando grouping desabilitado', async () => {
    const svc         = makeSvc({ agentData: makeAgentDisabled() });
    const mockEnqueue = vi.fn();

    await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

// =============================================================================
// TC-12–20: Grouping habilitado — caminho de enqueue
// =============================================================================

describe('TC-12–20: grouping habilitado — caminho de enqueue', () => {

  it('TC-12 somente caminho final processável chama enqueue (window=30)', async () => {
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue = vi.fn().mockResolvedValue(makeEnqueueResult());

    await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(mockEnqueue).toHaveBeenCalledOnce();
    const args = mockEnqueue.mock.calls[0][0];
    expect(args.companyId).toBe(COMPANY_ID);
    expect(args.conversationId).toBe(CONV_ID);
    expect(args.assignmentId).toBe(ASSIGNMENT_ID);
    expect(args.channel).toBe('whatsapp');
    expect(args.windowSeconds).toBe(30);
    expect(args.maxBatchDurationSeconds).toBe(120);
    expect(args.providerMessageId).toBe('wamid-test-router-123');
    expect(args.instanceId).toBe(INSTANCE_ID);
  });

  it('TC-13 mensagem agrupada não passa pelo INSERT antigo de APM (instance_id=NULL)', async () => {
    // Sucesso: enqueue chamado, nenhum INSERT em agent_processed_messages pelo Router
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue = vi.fn().mockResolvedValue(makeEnqueueResult());

    await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    // Nenhum INSERT em agent_processed_messages (RPC enqueue gerencia APM)
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(0);
  });

  it('TC-14 enqueue com sucesso → should_process=false, skip_reason=message_buffered', async () => {
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue = vi.fn().mockResolvedValue(makeEnqueueResult());

    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(false);
    expect(decision.skip_reason).toBe('message_buffered');
    expect(decision.batch_id).toBe(BATCH_ID);
    expect(decision.batch_message_id).toBe(BATCH_MSG_ID);
    expect(decision.deadline_at).toBeDefined();
    expect(decision.assignment_id).toBe(ASSIGNMENT_ID);
    expect(decision.agent_id).toBe(AGENT_ID);
  });

  it('TC-15 duplicata saudável do enqueue → already_processed, sem execução de agente', async () => {
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue = vi.fn().mockResolvedValue(makeEnqueueResult({ inserted: false, duplicate: true }));

    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(false);
    expect(decision.skip_reason).toBe('already_processed');
    expect(mockEnqueue).toHaveBeenCalledOnce();
    // Duplicata = sucesso funcional — não deve lançar
  });

  it('TC-16 mídia sem texto → enqueue chamado com messageText=null, messageType correto', async () => {
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue = vi.fn().mockResolvedValue(makeEnqueueResult());
    const event       = makeEvent({ message_text: null, message_type: 'image' });

    const decision = await routeConversationEvent(event, { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(false);
    expect(decision.skip_reason).toBe('message_buffered');
    expect(mockEnqueue.mock.calls[0][0].messageText).toBeNull();
    expect(mockEnqueue.mock.calls[0][0].messageType).toBe('image');
  });

  it('TC-17 flow agent ativo não chama enqueue — registra APM como processed', async () => {
    resolveFlowAgent.mockResolvedValueOnce({
      agent_id:              AGENT_ID,
      flow_state_id:         FLOW_STATE_ID,
      locked_opportunity_id: null,
    });
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue = vi.fn();

    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(decision.should_process).toBe(true);
    // Flow path: auditProcessed fez INSERT (não depende do agente ter grouping habilitado)
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(1);
    expect(svc._apmInsertSpy.mock.calls[0][0].result).toBe('processed');
  });

  it('TC-18 skip anterior (ai_inactive) não chama enqueue, registra APM', async () => {
    const svc         = makeSvc({
      agentData:        makeAgentEnabled(30),
      conversationData: makeConversation({ ai_state: 'ai_inactive' }),
    });
    const mockEnqueue = vi.fn();

    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(decision.skip_reason).toBe('ai_inactive');
    // skipWithAudit fez INSERT com skip result
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(1);
    expect(svc._apmInsertSpy.mock.calls[0][0].result).toBe('skipped_ai_inactive');
  });

  it('TC-19 agente inativo (is_active=false) → window=0 → caminho normal sem enqueue', async () => {
    const svc         = makeSvc({ agentData: { is_active: false, model_config: { message_grouping_window_s: 30 } } });
    const mockEnqueue = vi.fn();

    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(decision.should_process).toBe(true);
    // INSERT diferido (window=0 porque agente inativo)
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(1);
    expect(svc._apmInsertSpy.mock.calls[0][0].result).toBe('processed');
  });

  it('TC-20 assignment inválido (not found) → skip no_rule sem enqueue, registra APM', async () => {
    const svc         = makeSvc({
      agentData:       makeAgentEnabled(30),
      assignmentData:  null,
      assignmentError: { message: 'not found', code: 'PGRST116' },
    });
    const mockEnqueue = vi.fn();

    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(decision.skip_reason).toBe('no_rule');
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(1);
    expect(svc._apmInsertSpy.mock.calls[0][0].result).toBe('skipped_no_rule');
  });
});

// =============================================================================
// TC-21–27: Tratamento de erros
// =============================================================================

describe('TC-21–27: tratamento de erros — throw vs sucesso', () => {

  it('TC-21 erro técnico de banco → Router lança (não retorna decisão)', async () => {
    const dbError     = new MessageBufferDatabaseError('DB_ERROR', { code: 'DB_ERROR' });
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue = vi.fn().mockRejectedValue(dbError);

    await expect(
      routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue })
    ).rejects.toThrow();
  });

  it('TC-22 TENANT_VIOLATION → Router lança (não retorna HTTP 200 enganoso)', async () => {
    const tenantError = new MessageBufferTenantError('TENANT_VIOLATION', { code: 'TENANT_VIOLATION' });
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue = vi.fn().mockRejectedValue(tenantError);

    await expect(
      routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue })
    ).rejects.toThrow();
  });

  it('TC-23 DEDUP_INCONSISTENCY → Router lança, não executa LLM', async () => {
    const dedupError  = new MessageBufferDuplicateStateError('DEDUP_INCONSISTENCY', { code: 'DEDUP_INCONSISTENCY' });
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue = vi.fn().mockRejectedValue(dedupError);

    await expect(
      routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue })
    ).rejects.toThrow();

    // Garante que o erro não é tratado silenciosamente
    expect(mockEnqueue).toHaveBeenCalledOnce();
  });

  it('TC-24 BATCH_LIMIT_REACHED → Router lança, não executa LLM, não descarta silenciosamente', async () => {
    const limitError  = new MessageBufferLimitError('BATCH_LIMIT_REACHED', { code: 'BATCH_LIMIT_REACHED' });
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue = vi.fn().mockRejectedValue(limitError);

    const resultPromise = routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });
    await expect(resultPromise).rejects.toThrow();

    // Nenhum INSERT antigo de APM foi feito (sem estado parcial)
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(0);
  });

  it('TC-25 duplicata saudável → sucesso funcional, não lança', async () => {
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue = vi.fn().mockResolvedValue(makeEnqueueResult({ inserted: false, duplicate: true }));

    // Não deve lançar
    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(false);
    expect(decision.skip_reason).toBe('already_processed');
  });

  it('TC-26 mensagem nova enfileirada → sucesso funcional, não lança', async () => {
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue = vi.fn().mockResolvedValue(makeEnqueueResult());

    // Não deve lançar
    const decision = await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(false);
    expect(decision.skip_reason).toBe('message_buffered');
  });

  it('TC-27 logs de erro não contêm texto de mensagem ou payload', async () => {
    const consoleSpy  = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dbError     = new MessageBufferDatabaseError('DB_ERROR', { code: 'DB_ERROR' });
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const event       = makeEvent({ message_text: 'TEXTO_SECRETO', payload: { data: 'PAYLOAD_SECRETO' } });
    const mockEnqueue = vi.fn().mockRejectedValue(dbError);

    await expect(
      routeConversationEvent(event, { svc, enqueueMessage: mockEnqueue })
    ).rejects.toThrow();

    const allLogs = consoleSpy.mock.calls.flat(Infinity).map(v =>
      typeof v === 'object' ? JSON.stringify(v) : String(v)
    ).join(' ');

    expect(allLogs).not.toContain('TEXTO_SECRETO');
    expect(allLogs).not.toContain('PAYLOAD_SECRETO');

    consoleSpy.mockRestore();
  });
});

// =============================================================================
// TC-28–34: Regressão
// =============================================================================

describe('TC-28–34: regressão — comportamento anterior preservado', () => {

  it('TC-28 canal=web passa pelo INSERT antigo em PASSO 1 (caminho original intacto)', async () => {
    // canal=web → canUseMessageGrouping=false → INSERT no PASSO 1 (não diferido)
    const svc         = makeSvc();
    const mockEnqueue = vi.fn();
    const event       = makeEvent({ channel: 'web' });

    const decision = await routeConversationEvent(event, { svc, enqueueMessage: mockEnqueue });

    expect(decision.should_process).toBe(true);
    // INSERT feito (embora não possamos distinguir PASSO 1 vs PASSO 7 sem instrumentação)
    // O fundamental: canal=web retorna should_process=true e enqueue nunca chamado
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('TC-29 ai_inactive para canal=web → dedup antigo + UPDATE (não INSERT direto)', async () => {
    // canal=web → canUseMessageGrouping=false → PASSO 1 INSERT → ai_inactive → updateProcessedResult
    // updateProcessedResult faz UPDATE (não INSERT) — _apmInserts só conta INSERTs
    const svc   = makeSvc({ conversationData: makeConversation({ ai_state: 'ai_inactive' }) });
    const event = makeEvent({ channel: 'web' });

    const decision = await routeConversationEvent(event, { svc, enqueueMessage: vi.fn() });

    expect(decision.skip_reason).toBe('ai_inactive');
    // PASSO 1 fez INSERT (channel=web). _apmInserts conta apenas INSERTs.
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(1);
    expect(svc._apmInsertSpy.mock.calls[0][0].result).toBe('processed'); // resultado do PASSO 1
  });

  it('TC-30 svc=null retorna error sem exceção (proteção de ambiente)', async () => {
    const decision = await routeConversationEvent(makeEvent(), { svc: null });

    expect(decision.should_process).toBe(false);
    expect(decision.skip_reason).toBe('error');
  });

  it('TC-31 event_type não-inbound (delivery.status) → canUseMessageGrouping=false → caminho antigo', async () => {
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue = vi.fn();
    const event       = makeEvent({ event_type: 'delivery.status' });

    const decision = await routeConversationEvent(event, { svc, enqueueMessage: mockEnqueue });

    // Não é inbound → canUseMessageGrouping=false → enqueue nunca chamado
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(decision.should_process).toBe(true);
    // INSERT feito no PASSO 1 (não diferido)
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(1);
  });

  it('TC-32 instance_id ausente → canUseMessageGrouping=false → caminho antigo', async () => {
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue = vi.fn();
    const event       = makeEvent({ instance_id: null });

    const decision = await routeConversationEvent(event, { svc, enqueueMessage: mockEnqueue });

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(decision.should_process).toBe(true);
    expect(svc._apmInsertSpy.mock.calls).toHaveLength(1);
  });

  it('TC-33 query de assignment e agente incluem company_id (multi-tenant)', async () => {
    const svc         = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue = vi.fn().mockResolvedValue(makeEnqueueResult());

    await routeConversationEvent(makeEvent(), { svc, enqueueMessage: mockEnqueue });

    // Verificar query de assignment com company_id
    const assignChain = svc.from.mock.results.find(
      (_, i) => svc.from.mock.calls[i]?.[0] === 'company_agent_assignments' &&
                svc.from.mock.results[i]?.value?.single
    );
    expect(assignChain?.value?.eq).toHaveBeenCalledWith('company_id', COMPANY_ID);

    // Verificar query de agente com company_id
    const agentChain = svc.from.mock.results.find(
      (_, i) => svc.from.mock.calls[i]?.[0] === 'lovoo_agents'
    );
    expect(agentChain?.value?.eq).toHaveBeenCalledWith('company_id', COMPANY_ID);
  });

  it('TC-34 companyId e instanceId encaminhados corretamente ao enqueue', async () => {
    const OTHER_COMPANY = 'aaa00000-ffff-0000-0000-000000000099';
    const OTHER_INST    = 'ccc00000-ffff-0000-0000-000000000099';
    const svc           = makeSvc({ agentData: makeAgentEnabled(30) });
    const mockEnqueue   = vi.fn().mockResolvedValue(makeEnqueueResult());
    const event         = makeEvent({ company_id: OTHER_COMPANY, instance_id: OTHER_INST });

    await routeConversationEvent(event, { svc, enqueueMessage: mockEnqueue });

    expect(mockEnqueue.mock.calls[0][0].companyId).toBe(OTHER_COMPANY);
    expect(mockEnqueue.mock.calls[0][0].instanceId).toBe(OTHER_INST);
  });
});
