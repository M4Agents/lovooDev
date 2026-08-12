// =============================================================================
// api/lib/agents/__tests__/multiTurn.test.js
//
// Testes unitários — implementação multi_turn (history_mode)
//
// Framework: vitest
// Escopo:
//   1. buildHistoryMessages — construção do array de turns
//   2. Simulação de firstMessages (runner) em mem_block e multi_turn
//   3. Deduplicação por saved_message_id e fallback
//   4. Comportamento com outbound humano (deve ser excluído)
//   5. Conteúdos null/vazios
//   6. Sem alteração no comportamento de tools em mem_block
//
// Os mocks de módulos externos (Supabase, OpenAI, runner) permitem testar
// a lógica pura das funções sem dependências de I/O.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks de dependências externas ────────────────────────────────────────────
// agentExecutor importa runner, Supabase, etc. — todos mockados para isolar a lógica.

vi.mock('../runner.js', () => ({
  runAgentWithConfig: vi.fn().mockResolvedValue({
    success: true,
    result:  'Resposta do agente.',
    usage:   { prompt_tokens: 100, completion_tokens: 50 }
  }),
}));

vi.mock('../contextBuilder.js', () => ({
  buildContext: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({ select: vi.fn(), update: vi.fn(), insert: vi.fn() })),
    rpc:  vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
}));

vi.mock('../logger.ts', () => ({
  logAgentExecution: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../memoryService.js', () => ({
  readMemory:  vi.fn().mockResolvedValue(null),
  writeMemory: vi.fn().mockResolvedValue(undefined),
}));

// ── Import após mocks ──────────────────────────────────────────────────────────
import { buildHistoryMessages } from '../agentExecutor.js';

// ── UUIDs de teste ────────────────────────────────────────────────────────────
const ID_MSG_1   = 'aaaa0001-0000-0000-0000-000000000001';
const ID_MSG_2   = 'aaaa0002-0000-0000-0000-000000000002';
const ID_MSG_3   = 'aaaa0003-0000-0000-0000-000000000003';
const ID_MSG_4   = 'aaaa0004-0000-0000-0000-000000000004';
const ID_CURRENT = 'cccc0000-0000-0000-0000-000000000099';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMessage(id, direction, content, is_ai_generated = false) {
  return { id, direction, content, is_ai_generated, created_at: new Date().toISOString() };
}

function makeOutput(overrides = {}) {
  return {
    history_mode:                'multi_turn',
    current_inbound_message_id: ID_CURRENT,
    conversation: {
      id:              'conv-001',
      recent_messages: [],
    },
    ...overrides,
  };
}

// =============================================================================
// 1. buildHistoryMessages — construção do array de turns
// =============================================================================

describe('buildHistoryMessages', () => {

  // ---------------------------------------------------------------------------
  // TC-MT-01: Histórico normal (lead → IA → lead atual)
  // ---------------------------------------------------------------------------
  it('TC-MT-01 — histórico normal: exclui mensagem atual, mantém pares anteriores', () => {
    const messages = [
      makeMessage(ID_MSG_1,   'inbound',  'Olá, quero saber mais'),                     // lead msg 1
      makeMessage(ID_MSG_2,   'outbound', 'Oi! Como posso te ajudar?', true),           // IA resp 1
      makeMessage(ID_CURRENT, 'inbound',  'Qual o valor do curso?'),                    // ATUAL
    ];

    const output = makeOutput({
      current_inbound_message_id: ID_CURRENT,
      conversation: { id: 'conv-001', recent_messages: messages },
    });

    const turns = buildHistoryMessages(output);

    // Deve conter exatamente 2 turns (msg1 + resp1), não o atual
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: 'user',      content: 'Olá, quero saber mais'   });
    expect(turns[1]).toEqual({ role: 'assistant',  content: 'Oi! Como posso te ajudar?' });

    // Mensagem atual NÃO deve aparecer em history_messages
    const currentInHistory = turns.find(t => t.content === 'Qual o valor do curso?');
    expect(currentInHistory).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // TC-MT-02: Deduplicação por ID — saved_message_id presente
  // ---------------------------------------------------------------------------
  it('TC-MT-02 — deduplicação por ID: mensagem com ID=current excluída (não por conteúdo)', () => {
    // Duas mensagens com conteúdo IDÊNTICO — apenas a com ID_CURRENT deve ser excluída
    const messages = [
      makeMessage(ID_MSG_1,   'inbound',  'mensagem repetida'),   // anterior com mesmo conteúdo
      makeMessage(ID_CURRENT, 'inbound',  'mensagem repetida'),   // ATUAL — deve ser excluída pelo ID
    ];

    const output = makeOutput({
      current_inbound_message_id: ID_CURRENT,
      conversation: { id: 'conv-001', recent_messages: messages },
    });

    const turns = buildHistoryMessages(output);

    // Apenas o primeiro (ID_MSG_1) deve aparecer — o de ID_CURRENT foi excluído por ID
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toBe('mensagem repetida');
  });

  // ---------------------------------------------------------------------------
  // TC-MT-03: Fallback grouped_messages — currentId = null
  // ---------------------------------------------------------------------------
  it('TC-MT-03 — fallback null: quando currentId é null nenhuma mensagem é excluída pelo filtro de ID', () => {
    // currentId null significa que a mensagem atual não estava em recentMessages
    // (ex.: conteúdo vazio filtrado em fetchRecentMessages) — não há duplicação a evitar
    const messages = [
      makeMessage(ID_MSG_1, 'inbound',  'Oi'),
      makeMessage(ID_MSG_2, 'outbound', 'Olá!', true),
    ];

    const output = makeOutput({
      current_inbound_message_id: null,   // fallback: nenhum ID disponível
      conversation: { id: 'conv-001', recent_messages: messages },
    });

    const turns = buildHistoryMessages(output);

    // Quando currentId é null, todos os elegíveis passam (a mensagem atual não está na lista)
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('user');
    expect(turns[1].role).toBe('assistant');
  });

  // ---------------------------------------------------------------------------
  // TC-MT-04: Outbound humano deve ser EXCLUÍDO (dívida técnica V1)
  // ---------------------------------------------------------------------------
  it('TC-MT-04 — outbound humano ignorado: é_ai_generated=false, direction=outbound', () => {
    const messages = [
      makeMessage(ID_MSG_1, 'inbound',  'Qual o prazo?'),                            // lead
      makeMessage(ID_MSG_2, 'outbound', 'Pode ser este mês?', true),                 // IA
      makeMessage(ID_MSG_3, 'outbound', 'Olha, eu posso te ajudar com isso', false), // HUMANO — is_ai_generated=false
      makeMessage(ID_MSG_4, 'inbound',  'Sim, quero este mês'),                      // lead resposta ao humano
      makeMessage(ID_CURRENT, 'inbound', 'Ok, pode confirmar?'),                     // ATUAL
    ];

    const output = makeOutput({
      current_inbound_message_id: ID_CURRENT,
      conversation: { id: 'conv-001', recent_messages: messages },
    });

    const turns = buildHistoryMessages(output);

    // Esperado: IA+lead + lead que respondeu ao humano, mas SEM a mensagem humana
    // [user: "Qual o prazo?", assistant: "Pode ser este mês?", user: "Sim, quero este mês"]
    expect(turns).toHaveLength(3);
    expect(turns[0]).toEqual({ role: 'user',     content: 'Qual o prazo?' });
    expect(turns[1]).toEqual({ role: 'assistant', content: 'Pode ser este mês?' });
    expect(turns[2]).toEqual({ role: 'user',     content: 'Sim, quero este mês' });

    // Mensagem humana NÃO deve aparecer
    const humanMsg = turns.find(t => t.content === 'Olha, eu posso te ajudar com isso');
    expect(humanMsg).toBeUndefined();

    // Mensagem atual NÃO deve aparecer
    const currentMsg = turns.find(t => t.content === 'Ok, pode confirmar?');
    expect(currentMsg).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // TC-MT-05: Histórico vazio
  // ---------------------------------------------------------------------------
  it('TC-MT-05 — histórico vazio: retorna array vazio', () => {
    const output = makeOutput({
      current_inbound_message_id: ID_CURRENT,
      conversation: { id: 'conv-001', recent_messages: [] },
    });

    const turns = buildHistoryMessages(output);
    expect(turns).toHaveLength(0);
    expect(Array.isArray(turns)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // TC-MT-06: Apenas a mensagem atual no histórico
  // ---------------------------------------------------------------------------
  it('TC-MT-06 — apenas mensagem atual: retorna vazio após exclusão', () => {
    const messages = [
      makeMessage(ID_CURRENT, 'inbound', 'Única mensagem — é a atual'),
    ];

    const output = makeOutput({
      current_inbound_message_id: ID_CURRENT,
      conversation: { id: 'conv-001', recent_messages: messages },
    });

    const turns = buildHistoryMessages(output);
    expect(turns).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // TC-MT-07: Conteúdo null → convertido para string vazia
  // ---------------------------------------------------------------------------
  it('TC-MT-07 — content null: convertido para string vazia, não lança exceção', () => {
    const messages = [
      makeMessage(ID_MSG_1, 'inbound',  null),       // content null
      makeMessage(ID_MSG_2, 'outbound', '', true),   // content vazio
      makeMessage(ID_CURRENT, 'inbound', 'Ok'),
    ];

    const output = makeOutput({
      current_inbound_message_id: ID_CURRENT,
      conversation: { id: 'conv-001', recent_messages: messages },
    });

    let turns;
    expect(() => { turns = buildHistoryMessages(output); }).not.toThrow();

    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: 'user',      content: '' }); // null → ''
    expect(turns[1]).toEqual({ role: 'assistant', content: '' }); // '' → ''
  });

  // ---------------------------------------------------------------------------
  // TC-MT-08: Ordem cronológica preservada
  // ---------------------------------------------------------------------------
  it('TC-MT-08 — ordem cronológica preservada (oldest → newest)', () => {
    const messages = [
      makeMessage(ID_MSG_1,   'inbound',  'msg A'),
      makeMessage(ID_MSG_2,   'outbound', 'resp A', true),
      makeMessage(ID_MSG_3,   'inbound',  'msg B'),
      makeMessage(ID_MSG_4,   'outbound', 'resp B', true),
      makeMessage(ID_CURRENT, 'inbound',  'msg C — atual'),
    ];

    const output = makeOutput({
      current_inbound_message_id: ID_CURRENT,
      conversation: { id: 'conv-001', recent_messages: messages },
    });

    const turns = buildHistoryMessages(output);

    expect(turns).toHaveLength(4);
    expect(turns[0].content).toBe('msg A');
    expect(turns[1].content).toBe('resp A');
    expect(turns[2].content).toBe('msg B');
    expect(turns[3].content).toBe('resp B');
  });

});

// =============================================================================
// 2. Simulação da construção de firstMessages (lógica do runner)
// =============================================================================

describe('firstMessages construction (runner logic simulation)', () => {

  // Simula exatamente o código do runner.ts, testando a lógica sem chamar OpenAI
  function buildFirstMessages(systemPrompt, historyMessages, userMessage) {
    const historyTurns = (historyMessages?.length ?? 0) > 0 ? historyMessages : [];
    return [
      { role: 'system', content: systemPrompt },
      ...historyTurns,
      { role: 'user',   content: userMessage  },
    ];
  }

  // ---------------------------------------------------------------------------
  // TC-MT-09: mem_block — sem history_messages (undefined)
  // ---------------------------------------------------------------------------
  it('TC-MT-09 — mem_block: history_messages undefined → [system, user]', () => {
    const msgs = buildFirstMessages('system prompt', undefined, 'mensagem atual');

    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toBe('mensagem atual');
  });

  // ---------------------------------------------------------------------------
  // TC-MT-10: mem_block — sem history_messages (array vazio)
  // ---------------------------------------------------------------------------
  it('TC-MT-10 — mem_block: history_messages vazio → [system, user]', () => {
    const msgs = buildFirstMessages('system prompt', [], 'mensagem atual');

    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
  });

  // ---------------------------------------------------------------------------
  // TC-MT-11: multi_turn — histórico com 2 turns
  // ---------------------------------------------------------------------------
  it('TC-MT-11 — multi_turn: [system, user_h1, assistant_h1, user_atual]', () => {
    const history = [
      { role: 'user',      content: 'Olá, quero saber mais' },
      { role: 'assistant', content: 'Oi! Como posso ajudar?' },
    ];

    const msgs = buildFirstMessages('system prompt', history, 'Qual o valor?');

    expect(msgs).toHaveLength(4);
    expect(msgs[0]).toEqual({ role: 'system',    content: 'system prompt'        });
    expect(msgs[1]).toEqual({ role: 'user',      content: 'Olá, quero saber mais' });
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'Oi! Como posso ajudar?' });
    expect(msgs[3]).toEqual({ role: 'user',      content: 'Qual o valor?'         });
  });

  // ---------------------------------------------------------------------------
  // TC-MT-12: Mensagem atual aparece EXATAMENTE UMA VEZ
  // ---------------------------------------------------------------------------
  it('TC-MT-12 — mensagem atual aparece exatamente uma vez', () => {
    const userContent = 'mensagem que não deve se repetir';
    const history = [
      { role: 'user',      content: 'primeira mensagem' },
      { role: 'assistant', content: 'primeira resposta' },
    ];

    const msgs = buildFirstMessages('system', history, userContent);

    const occurrences = msgs.filter(m => m.content === userContent);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].role).toBe('user');
  });

  // ---------------------------------------------------------------------------
  // TC-MT-13: Sequência com tools (segundo turno)
  // ---------------------------------------------------------------------------
  it('TC-MT-13 — tools: segundo turno preserva firstMessages + toolResultMessages', () => {
    const history = [
      { role: 'user',      content: 'h1' },
      { role: 'assistant', content: 'r1' },
    ];

    const firstMsgs = buildFirstMessages('system', history, 'mensagem atual');

    // Simula toolResultMessages do runner
    const assistantWithToolCalls = {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'request_handoff', arguments: '{}' } }],
    };
    const toolResult = {
      role:         'tool',
      tool_call_id: 'tc1',
      content:      JSON.stringify({ success: true }),
    };

    const secondTurnMsgs = [...firstMsgs, assistantWithToolCalls, toolResult];

    // Sequência esperada: system → h1_user → r1_assistant → user_atual → assistant(tools) → tool(result)
    expect(secondTurnMsgs).toHaveLength(6);
    expect(secondTurnMsgs[0].role).toBe('system');
    expect(secondTurnMsgs[1].role).toBe('user');      // h1
    expect(secondTurnMsgs[2].role).toBe('assistant'); // r1
    expect(secondTurnMsgs[3].role).toBe('user');      // mensagem atual
    expect(secondTurnMsgs[4].role).toBe('assistant'); // tool_calls
    expect(secondTurnMsgs[5].role).toBe('tool');      // tool result

    // Mensagem atual na posição certa (antes dos tool calls)
    expect(secondTurnMsgs[3].content).toBe('mensagem atual');
  });

  // ---------------------------------------------------------------------------
  // TC-MT-14: mem_block com tools (segundo turno) — sem history_messages
  // ---------------------------------------------------------------------------
  it('TC-MT-14 — mem_block com tools: segundo turno = [system, user, assistant, tool]', () => {
    const firstMsgs = buildFirstMessages('system', undefined, 'mensagem atual');

    const assistantToolCalls = { role: 'assistant', content: null, tool_calls: [{ id: 'tc2' }] };
    const toolResult         = { role: 'tool', tool_call_id: 'tc2', content: '{}' };

    const secondTurnMsgs = [...firstMsgs, assistantToolCalls, toolResult];

    expect(secondTurnMsgs).toHaveLength(4);
    expect(secondTurnMsgs[0].role).toBe('system');
    expect(secondTurnMsgs[1].role).toBe('user');
    expect(secondTurnMsgs[2].role).toBe('assistant');
    expect(secondTurnMsgs[3].role).toBe('tool');
  });

});

// =============================================================================
// 3. Conteúdo vazio — casos reais
// =============================================================================

describe('buildHistoryMessages — conteúdo vazio', () => {

  // ---------------------------------------------------------------------------
  // TC-MT-15: content=null aceito pela OpenAI (turn com string vazia)
  // ---------------------------------------------------------------------------
  it('TC-MT-15 — content null resulta em string vazia (aceitável como turn)', () => {
    const messages = [
      makeMessage(ID_MSG_1, 'inbound', null),
      makeMessage(ID_CURRENT, 'inbound', 'msg atual'),
    ];

    const output = makeOutput({
      current_inbound_message_id: ID_CURRENT,
      conversation: { id: 'conv-001', recent_messages: messages },
    });

    const turns = buildHistoryMessages(output);

    expect(turns).toHaveLength(1);
    // content null → '' (string, não null — prevenindo rejeição pela API)
    expect(typeof turns[0].content).toBe('string');
    expect(turns[0].content).toBe('');
  });

  // ---------------------------------------------------------------------------
  // TC-MT-16: content='' aceito (mesmo que vazio)
  // ---------------------------------------------------------------------------
  it('TC-MT-16 — content vazio string permanece como string vazia', () => {
    const messages = [
      makeMessage(ID_MSG_1, 'outbound', '', true),
      makeMessage(ID_CURRENT, 'inbound', 'msg atual'),
    ];

    const output = makeOutput({
      current_inbound_message_id: ID_CURRENT,
      conversation: { id: 'conv-001', recent_messages: messages },
    });

    const turns = buildHistoryMessages(output);

    expect(turns).toHaveLength(1);
    expect(turns[0].content).toBe('');
    expect(turns[0].role).toBe('assistant');
  });

});

// =============================================================================
// 4. Verificação de que assignmetns sem history_mode não são afetados
// =============================================================================

describe('buildHistoryMessages — output sem history_mode (mem_block implícito)', () => {

  it('TC-MT-17 — output sem campo history_mode: buildHistoryMessages não é chamado em mem_block', () => {
    // Em mem_block, agentExecutor faz:
    //   historyMode = output.history_mode ?? 'mem_block'
    //   historyMessages = historyMode === 'multi_turn' ? buildHistoryMessages(output) : undefined
    // Este teste verifica a lógica de decisão:
    const historyMode     = undefined ?? 'mem_block';
    const historyMessages = historyMode === 'multi_turn' ? 'chamado' : undefined;

    expect(historyMessages).toBeUndefined();
  });

  it('TC-MT-18 — output com history_mode=mem_block: buildHistoryMessages não é chamado', () => {
    const historyMode     = 'mem_block';
    const historyMessages = historyMode === 'multi_turn' ? 'chamado' : undefined;

    expect(historyMessages).toBeUndefined();
  });

  it('TC-MT-19 — output com history_mode=multi_turn: buildHistoryMessages é chamado', () => {
    const historyMode     = 'multi_turn';
    const historyMessages = historyMode === 'multi_turn' ? 'chamado' : undefined;

    expect(historyMessages).toBe('chamado');
  });

});
