// =============================================================================
// messages.test.js
//
// Testes unitários para GET /api/whatsapp/meta/conversations/:conversationId/messages
// Todos os testes usam mocks — sem banco, rede ou valores reais.
//
// COBERTURA:
//   MSG-01 … MSG-02  Happy path / lista vazia
//   MSG-03 … MSG-05  Erros de params obrigatórios
//   MSG-06          Limit adversarial (table-driven)
//   MSG-07          Limit clamp > 100
//   MSG-08 … MSG-10 Auth / RBAC
//   MSG-11 … MSG-13 Conversation lookup (inexistente / cross-tenant / archived)
//   MSG-14 … MSG-15 Erros de DB
//   MSG-16          SELECT público (campos esperados, campos proibidos, sem *)
//   MSG-17          Query usa auth.companyId (não req.query.company_id)
//   MSG-18          conversation_id vem do DB (não do caller)
//   MSG-19          instance_id vem do DB (não do caller)
//   MSG-20          Ordenação DESC + limit corretos
//   MSG-21          Resposta invertida: DB newest→oldest → API oldest→newest
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks (vi.hoisted garante disponibilidade antes do hoist de vi.mock)
// =============================================================================

const { mockValidateMetaCaller, mockSvc } = vi.hoisted(() => ({
  mockValidateMetaCaller: vi.fn(),
  mockSvc:                { from: vi.fn() },
}));

vi.mock('../../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
  META_VIEW_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
}));

vi.mock('../../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

import handler from '../messages.js';

// =============================================================================
// Fixtures — todos fictícios, nunca reais
// =============================================================================

const FAKE_COMPANY_ID      = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_CONV_ID         = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_INSTANCE_ID     = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_MSG_ID_A        = 'dddd0000-0000-0000-0000-000000000004';
const FAKE_MSG_ID_B        = 'eeee0000-0000-0000-0000-000000000005';
const FAKE_MSG_ID_C        = 'ffff0000-0000-0000-0000-000000000006';

const FAKE_AUTH_OK = {
  ok:         true,
  companyId:  FAKE_COMPANY_ID,
  userId:     'user0000-0000-0000-0000-000000000007',
  role:       'admin',
  accessPath: 'direct',
};

// Conversa retornada pelo DB (apenas campos do SELECT: id, instance_id)
const FAKE_CONV_DB = {
  id:          FAKE_CONV_ID,
  instance_id: FAKE_INSTANCE_ID,
};

// Mensagens fictícias — DB retorna DESC (mais recente primeiro)
const FAKE_MSG_NEWEST = {
  id:                 FAKE_MSG_ID_C,
  conversation_id:    FAKE_CONV_ID,
  instance_id:        FAKE_INSTANCE_ID,
  direction:          'inbound',
  message_type:       'text',
  body:               'Mensagem mais recente',
  provider_timestamp: '2026-09-21T14:00:00.000Z',
  created_at:         '2026-09-21T14:00:00.000Z',
};

const FAKE_MSG_MIDDLE = {
  id:                 FAKE_MSG_ID_B,
  conversation_id:    FAKE_CONV_ID,
  instance_id:        FAKE_INSTANCE_ID,
  direction:          'inbound',
  message_type:       'text',
  body:               'Mensagem do meio',
  provider_timestamp: '2026-09-21T13:30:00.000Z',
  created_at:         '2026-09-21T13:30:00.000Z',
};

const FAKE_MSG_OLDEST = {
  id:                 FAKE_MSG_ID_A,
  conversation_id:    FAKE_CONV_ID,
  instance_id:        FAKE_INSTANCE_ID,
  direction:          'inbound',
  message_type:       'text',
  body:               'Mensagem mais antiga',
  provider_timestamp: '2026-09-21T13:00:00.000Z',
  created_at:         '2026-09-21T13:00:00.000Z',
};

// Ordem que o DB retorna (DESC): newest → oldest
const FAKE_MSGS_DESC = [FAKE_MSG_NEWEST, FAKE_MSG_MIDDLE, FAKE_MSG_OLDEST];
// Ordem que o handler deve retornar (após reverse): oldest → newest
const FAKE_MSGS_ASC  = [FAKE_MSG_OLDEST, FAKE_MSG_MIDDLE, FAKE_MSG_NEWEST];

// =============================================================================
// Factories / helpers
// =============================================================================

/** Request GET mínimo. */
function makeReq({
  method         = 'GET',
  company_id     = FAKE_COMPANY_ID,
  conversationId = FAKE_CONV_ID,
  limit,
  headers        = { authorization: 'Bearer fake_token_for_tests' },
} = {}) {
  const query = { company_id, conversationId };
  if (limit !== undefined) query.limit = limit;
  return { method, headers, query };
}

/** Res mock com captura de status e body. */
function makeRes() {
  return {
    _status: null,
    _body:   null,
    status(code)  { this._status = code; return this; },
    json(body)    { this._body = body;   return this; },
  };
}

/** Chain para meta_conversations: select().eq().eq().eq().maybeSingle() */
function makeConvChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

/**
 * Chain para meta_messages:
 * select().eq().eq().eq().order().order().limit()
 */
function makeMsgChain(data, error = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    order:  vi.fn().mockReturnThis(),
    limit:  vi.fn().mockResolvedValue({ data, error }),
  };
}

// =============================================================================
// Setup padrão
// =============================================================================

beforeEach(() => {
  vi.resetAllMocks();
  mockValidateMetaCaller.mockResolvedValue(FAKE_AUTH_OK);
});

/** Configura happy path: conv lookup OK + messages query OK. */
function setupHappyPath(messages = FAKE_MSGS_DESC) {
  mockSvc.from
    .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
    .mockReturnValueOnce(makeMsgChain(messages));
}

// =============================================================================
// MSG-01 … MSG-02 — Happy path
// =============================================================================

describe('GET messages — happy path', () => {
  it('MSG-01: happy path — retorna mensagens em ordem cronológica (oldest→newest)', async () => {
    setupHappyPath();
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // Deve estar invertido: DB retorna DESC, handler retorna ASC
    expect(res._body.messages).toEqual(FAKE_MSGS_ASC);
    expect(res._body.messages[0].body).toBe('Mensagem mais antiga');
    expect(res._body.messages[2].body).toBe('Mensagem mais recente');
  });

  it('MSG-02: conversa existe sem mensagens → 200 { messages: [] }', async () => {
    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(makeMsgChain([]));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ messages: [] });
  });
});

// =============================================================================
// MSG-03 … MSG-05 — Params obrigatórios
// =============================================================================

describe('GET messages — params obrigatórios', () => {
  it('MSG-03: método != GET → 405 sem DB', async () => {
    const req = makeReq({ method: 'POST' });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(405);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('MSG-04: company_id ausente → 400 sem DB', async () => {
    const req = makeReq();
    delete req.query.company_id;
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: expect.stringContaining('company_id') });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('MSG-05: conversationId UUID inválido → 400 sem DB', async () => {
    const req = makeReq({ conversationId: 'not-a-valid-uuid' });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: expect.stringContaining('conversationId') });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });
});

// =============================================================================
// MSG-06 — Limit adversarial (table-driven)
// =============================================================================

describe('GET messages — limit adversarial', () => {
  const INVALID_LIMIT_CASES = [
    { label: 'zero',             value: '0'   },
    { label: 'negativo',         value: '-1'  },
    { label: 'decimal 1.5',      value: '1.5' },
    { label: "não-inteiro 'abc'", value: 'abc' },
    { label: 'whitespace " 50"', value: ' 50' },
    { label: 'string vazia',     value: ''    },
  ];

  it.each(INVALID_LIMIT_CASES)(
    'MSG-06 limit inválido ($label) → 400 sem DB',
    async ({ value }) => {
      const req = makeReq({ limit: value });
      const res = makeRes();
      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._body).toMatchObject({ error: expect.stringContaining('limit') });
      expect(mockSvc.from).not.toHaveBeenCalled();
    },
  );
});

// =============================================================================
// MSG-07 — Limit clamp
// =============================================================================

describe('GET messages — limit clamp', () => {
  it('MSG-07: limit > 100 → clampado para 100, 200', async () => {
    const convChain = makeConvChain(FAKE_CONV_DB);
    const msgChain  = makeMsgChain([]);
    mockSvc.from
      .mockReturnValueOnce(convChain)
      .mockReturnValueOnce(msgChain);

    const req = makeReq({ limit: '999' });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // Confirmar que limit() foi chamado com 100 (clampado — não 999)
    expect(msgChain.limit).toHaveBeenCalledWith(100);
  });
});

// =============================================================================
// MSG-08 … MSG-10 — Auth / RBAC
// =============================================================================

describe('GET messages — auth e RBAC', () => {
  it('MSG-08: sem Bearer → 401, nenhuma query tenant', async () => {
    mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 401, error: 'Autenticação necessária' });

    const req = makeReq({ headers: {} });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: 'Autenticação necessária' });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('MSG-09: role insuficiente → 403, sem conversation lookup', async () => {
    mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'Permissão insuficiente para esta operação' });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(403);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('MSG-10: feature flag off → 403, sem conversation lookup', async () => {
    mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'Meta WhatsApp não habilitado para esta empresa' });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(403);
    expect(res._body).toMatchObject({ error: expect.stringContaining('Meta WhatsApp') });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });
});

// =============================================================================
// MSG-11 … MSG-13 — Conversation lookup
// =============================================================================

describe('GET messages — conversation lookup', () => {
  it('MSG-11: conversation inexistente → 404, sem messages query', async () => {
    mockSvc.from.mockReturnValueOnce(makeConvChain(null));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(404);
    // Apenas 1 chamada a from() — a de meta_conversations
    expect(mockSvc.from).toHaveBeenCalledTimes(1);
    expect(mockSvc.from.mock.calls[0][0]).toBe('meta_conversations');
  });

  it('MSG-12: conversation cross-tenant → 404 idêntico', async () => {
    // Auth retorna companyId diferente do que teria a conversa
    mockValidateMetaCaller.mockResolvedValue({
      ok:         true,
      companyId:  'zzzz0000-0000-0000-0000-000000000099', // outro tenant
      userId:     'user-1',
      role:       'admin',
      accessPath: 'direct',
    });
    // DB retorna null porque company_id = auth.companyId não bate
    mockSvc.from.mockReturnValueOnce(makeConvChain(null));

    const req = makeReq(); // req.query.company_id = FAKE_COMPANY_ID (diferente)
    const res = makeRes();
    await handler(req, res);

    // Resposta 404 — idêntica à conversa inexistente
    expect(res._status).toBe(404);
    expect(mockSvc.from).toHaveBeenCalledTimes(1);
  });

  it('MSG-13: conversation archived → 404 idêntico', async () => {
    // A query filtra status='active', então archived retorna null
    mockSvc.from.mockReturnValueOnce(makeConvChain(null));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(404);
    // Verificar que o filtro status='active' foi aplicado
    const convChainEqCalls = mockSvc.from.mock.results[0]?.value?.eq?.mock?.calls ?? [];
    const statusCall = convChainEqCalls.find(c => c[0] === 'status');
    expect(statusCall).toBeDefined();
    expect(statusCall[1]).toBe('active');
  });
});

// =============================================================================
// MSG-14 … MSG-15 — Erros de DB
// =============================================================================

describe('GET messages — erros de DB', () => {
  it('MSG-14: DB error no conversation lookup → 500 internal_error', async () => {
    mockSvc.from.mockReturnValueOnce(makeConvChain(null, { message: 'db connection error' }));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body).toMatchObject({ error: 'internal_error' });
    // Erro bruto do Supabase não deve estar na resposta
    expect(JSON.stringify(res._body)).not.toContain('db connection error');
  });

  it('MSG-15: DB error na messages query → 500 internal_error', async () => {
    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(makeMsgChain(null, { message: 'query timeout' }));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body).toMatchObject({ error: 'internal_error' });
    expect(JSON.stringify(res._body)).not.toContain('query timeout');
  });
});

// =============================================================================
// MSG-16 — SELECT público
// =============================================================================

describe('GET messages — SELECT público', () => {
  it('MSG-16: select de messages — campos esperados presentes, proibidos ausentes, sem *', async () => {
    const msgChain = makeMsgChain([FAKE_MSG_OLDEST]);
    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(msgChain);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);

    // Verificar diretamente a string passada a .select() na messages query
    expect(msgChain.select).toHaveBeenCalledTimes(1);
    const selectArg = msgChain.select.mock.calls[0][0];

    // Campos públicos esperados (inclui template metadata — MVP4A.4)
    const EXPECTED = ['id', 'conversation_id', 'instance_id', 'direction',
                      'message_type', 'body', 'provider_timestamp', 'created_at',
                      'template_name', 'template_language'];
    for (const field of EXPECTED) {
      expect(selectArg).toContain(field);
    }

    // Campos proibidos
    expect(selectArg).not.toContain('company_id');
    expect(selectArg).not.toContain('meta_message_id');
    expect(selectArg).not.toContain('updated_at');
    // Sem SELECT *
    expect(selectArg).not.toBe('*');
    expect(selectArg).not.toContain('*');
  });
});

// =============================================================================
// MSG-17 — Query usa auth.companyId (não req.query.company_id)
// =============================================================================

describe('GET messages — auth.companyId na query', () => {
  it('MSG-17: messages query usa auth.companyId — nunca req.query.company_id', async () => {
    const CHILD_COMPANY_ID = 'child000-0000-0000-0000-000000000099';
    // Guard retorna companyId diferente do que veio na query string (Trilha 2)
    mockValidateMetaCaller.mockResolvedValue({
      ok:         true,
      companyId:  CHILD_COMPANY_ID,
      userId:     'user-1',
      role:       'super_admin',
      accessPath: 'parent',
    });

    const convChain = makeConvChain({ id: FAKE_CONV_ID, instance_id: FAKE_INSTANCE_ID });
    const msgChain  = makeMsgChain([]);
    mockSvc.from
      .mockReturnValueOnce(convChain)
      .mockReturnValueOnce(msgChain);

    // req.query.company_id = FAKE_COMPANY_ID (diferente de CHILD_COMPANY_ID)
    const req = makeReq({ company_id: FAKE_COMPANY_ID });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);

    // Confirmar que eq('company_id', CHILD_COMPANY_ID) foi chamado na messages query
    const msgEqCalls = msgChain.eq.mock.calls;
    const companyCall = msgEqCalls.find(c => c[0] === 'company_id');
    expect(companyCall).toBeDefined();
    expect(companyCall[1]).toBe(CHILD_COMPANY_ID);

    // Garantir que req.query.company_id (FAKE_COMPANY_ID) NÃO foi usado
    const wrongCall = msgEqCalls.find(c => c[0] === 'company_id' && c[1] === FAKE_COMPANY_ID);
    expect(wrongCall).toBeUndefined();
  });
});

// =============================================================================
// MSG-18 … MSG-19 — conversation_id e instance_id vêm do DB
// =============================================================================

describe('GET messages — IDs vêm do DB, não do caller', () => {
  it('MSG-18: conversation_id na query de messages vem do objeto DB', async () => {
    // O DB retorna um conversation_id específico
    const DB_CONV_ID = 'db-conv00-0000-0000-0000-000000000001';
    const convChain  = makeConvChain({ id: DB_CONV_ID, instance_id: FAKE_INSTANCE_ID });
    const msgChain   = makeMsgChain([]);
    mockSvc.from
      .mockReturnValueOnce(convChain)
      .mockReturnValueOnce(msgChain);

    // req.query.conversationId é diferente do que o DB retorna como 'id'
    // (em cenário real seriam iguais, mas testamos que o código usa conversation.id)
    const req = makeReq({ conversationId: FAKE_CONV_ID });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);

    // Confirmar que eq('conversation_id', DB_CONV_ID) foi chamado na messages query
    const eqCalls = msgChain.eq.mock.calls;
    const convIdCall = eqCalls.find(c => c[0] === 'conversation_id');
    expect(convIdCall).toBeDefined();
    expect(convIdCall[1]).toBe(DB_CONV_ID);
  });

  it('MSG-19: instance_id na query de messages vem do objeto DB', async () => {
    // O DB retorna um instance_id específico
    const DB_INST_ID = 'db-inst00-0000-0000-0000-000000000002';
    const convChain  = makeConvChain({ id: FAKE_CONV_ID, instance_id: DB_INST_ID });
    const msgChain   = makeMsgChain([]);
    mockSvc.from
      .mockReturnValueOnce(convChain)
      .mockReturnValueOnce(msgChain);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);

    // Confirmar que eq('instance_id', DB_INST_ID) foi chamado na messages query
    const eqCalls = msgChain.eq.mock.calls;
    const instIdCall = eqCalls.find(c => c[0] === 'instance_id');
    expect(instIdCall).toBeDefined();
    expect(instIdCall[1]).toBe(DB_INST_ID);
  });
});

// =============================================================================
// MSG-20 — Ordenação correta
// =============================================================================

describe('GET messages — ordenação', () => {
  it('MSG-20: order() chamado com provider_timestamp DESC, created_at DESC e limit correto', async () => {
    const msgChain = makeMsgChain([]);
    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(msgChain);

    const req = makeReq({ limit: '25' });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);

    // Verificar as duas chamadas a .order()
    const orderCalls = msgChain.order.mock.calls;
    expect(orderCalls).toHaveLength(2);

    // 1ª chamada: provider_timestamp DESC NULLS LAST
    expect(orderCalls[0][0]).toBe('provider_timestamp');
    expect(orderCalls[0][1]).toMatchObject({ ascending: false, nullsFirst: false });

    // 2ª chamada: created_at DESC (tiebreaker)
    expect(orderCalls[1][0]).toBe('created_at');
    expect(orderCalls[1][1]).toMatchObject({ ascending: false });

    // limit com valor fornecido (25, dentro do máximo)
    expect(msgChain.limit).toHaveBeenCalledWith(25);
  });
});

// =============================================================================
// MSG-21 — Resposta invertida
// =============================================================================

describe('GET messages — reverse', () => {
  it('MSG-21: DB retorna DESC (newest→oldest), API retorna ASC (oldest→newest)', async () => {
    // Mock retorna as mensagens como o DB faria: newest primeiro
    setupHappyPath(FAKE_MSGS_DESC);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);

    const msgs = res._body.messages;
    expect(msgs).toHaveLength(3);

    // Deve estar em ordem cronológica após reverse
    expect(msgs[0].id).toBe(FAKE_MSG_ID_A); // mais antiga
    expect(msgs[1].id).toBe(FAKE_MSG_ID_B); // meio
    expect(msgs[2].id).toBe(FAKE_MSG_ID_C); // mais recente

    // Confirmar timestamps crescentes
    expect(msgs[0].provider_timestamp < msgs[1].provider_timestamp).toBe(true);
    expect(msgs[1].provider_timestamp < msgs[2].provider_timestamp).toBe(true);
  });
});

// =============================================================================
// MSG-22 — Template metadata: template_name e template_language no SELECT
// =============================================================================

describe('GET messages — template metadata (MVP4A.4)', () => {
  /** Mensagem de texto: template_name/language são null — campo presente no shape. */
  const FAKE_MSG_TEXT = {
    id:                 'msg-text-0001-0000-0000-000000000001',
    conversation_id:    FAKE_CONV_ID,
    instance_id:        FAKE_INSTANCE_ID,
    direction:          'inbound',
    message_type:       'text',
    body:               'Olá, mundo',
    provider_timestamp: '2026-09-22T10:00:00.000Z',
    created_at:         '2026-09-22T10:00:00.000Z',
    template_name:      null,
    template_language:  null,
  };

  /** Mensagem de template: ambos os campos preenchidos. */
  const FAKE_MSG_TEMPLATE = {
    id:                 'msg-tmpl-0001-0000-0000-000000000002',
    conversation_id:    FAKE_CONV_ID,
    instance_id:        FAKE_INSTANCE_ID,
    direction:          'outbound',
    message_type:       'template',
    body:               'Olá, João! Seu código é 12345.',
    provider_timestamp: '2026-09-22T10:01:00.000Z',
    created_at:         '2026-09-22T10:01:00.000Z',
    template_name:      'hello_world',
    template_language:  'pt_BR',
  };

  it('MSG-22a: SELECT inclui template_name e template_language na query de messages', async () => {
    const msgChain = makeMsgChain([FAKE_MSG_TEXT]);
    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(msgChain);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);

    const selectArg = msgChain.select.mock.calls[0][0];
    expect(selectArg).toContain('template_name');
    expect(selectArg).toContain('template_language');
  });

  it('MSG-22b: mensagem de texto — template_name e template_language preservados como null', async () => {
    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(makeMsgChain([FAKE_MSG_TEXT]));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const msg = res._body.messages[0];
    expect(msg.message_type).toBe('text');
    expect(msg.template_name).toBeNull();
    expect(msg.template_language).toBeNull();
  });

  it('MSG-22c: mensagem template — retorna message_type=template, body, template_name e template_language preenchidos', async () => {
    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(makeMsgChain([FAKE_MSG_TEMPLATE]));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const msgs = res._body.messages;
    expect(msgs).toHaveLength(1);

    const msg = msgs[0];
    expect(msg.message_type).toBe('template');
    expect(msg.body).toBe('Olá, João! Seu código é 12345.');
    expect(msg.template_name).toBe('hello_world');
    expect(msg.template_language).toBe('pt_BR');
  });

  it('MSG-22d: template message NÃO expõe company_id mesmo com campos de template presentes', async () => {
    const msgChain = makeMsgChain([FAKE_MSG_TEMPLATE]);
    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(msgChain);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const selectArg = msgChain.select.mock.calls[0][0];
    // template_name/language presentes, mas company_id continua ausente do SELECT
    expect(selectArg).toContain('template_name');
    expect(selectArg).not.toContain('company_id');
    expect(selectArg).not.toContain('meta_message_id');
  });
});
