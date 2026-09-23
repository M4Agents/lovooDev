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

// Mensagens fictícias — DB retorna DESC (mais recente primeiro).
// Não incluem media_asset_id → handler trata como null → media:null no DTO.
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

// Shape esperado no DTO final — media:null para mensagens sem media_asset_id.
const FAKE_MSG_NEWEST_DTO = { ...FAKE_MSG_NEWEST, media: null };
const FAKE_MSG_MIDDLE_DTO = { ...FAKE_MSG_MIDDLE, media: null };
const FAKE_MSG_OLDEST_DTO = { ...FAKE_MSG_OLDEST, media: null };
const FAKE_MSGS_DESC_DTO  = [FAKE_MSG_NEWEST_DTO, FAKE_MSG_MIDDLE_DTO, FAKE_MSG_OLDEST_DTO];
const FAKE_MSGS_ASC_DTO   = [FAKE_MSG_OLDEST_DTO, FAKE_MSG_MIDDLE_DTO, FAKE_MSG_NEWEST_DTO];

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

/**
 * Chain para company_media_library (resolução de assets de mídia):
 * select().eq().in()
 */
function makeAssetChain(data, error = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    in:     vi.fn().mockResolvedValue({ data, error }),
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
  it('MSG-01: happy path — retorna mensagens em ordem cronológica (oldest→newest) com media:null', async () => {
    setupHappyPath();
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // Deve estar invertido: DB retorna DESC, handler retorna ASC
    // media:null adicionado a todas mensagens sem media_asset_id
    expect(res._body.messages).toEqual(FAKE_MSGS_ASC_DTO);
    expect(res._body.messages[0].body).toBe('Mensagem mais antiga');
    expect(res._body.messages[2].body).toBe('Mensagem mais recente');
    expect(res._body.messages[0].media).toBeNull();
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

    // Campos esperados (inclui template metadata — MVP4A.4 e media_asset_id — MVP4B.6C)
    const EXPECTED = ['id', 'conversation_id', 'instance_id', 'direction',
                      'message_type', 'body', 'provider_timestamp', 'created_at',
                      'template_name', 'template_language',
                      'media_asset_id']; // MVP4B.6C — interno; não exposto no DTO final
    for (const field of EXPECTED) {
      expect(selectArg).toContain(field);
    }

    // Campos proibidos no SELECT (confidenciais / nunca expostos)
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
  it('MSG-21: DB retorna DESC (newest→oldest), API retorna ASC (oldest→newest) — media:null preservado', async () => {
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

    // media:null em todas as mensagens (sem media_asset_id no DB mock)
    for (const msg of msgs) {
      expect(msg.media).toBeNull();
      expect(msg).not.toHaveProperty('media_asset_id');
    }
  });
});

// =============================================================================
// MSG-22 — Template metadata: template_name e template_language no SELECT
// =============================================================================

describe('GET messages — template metadata (MVP4A.4)', () => {
  /** Mensagem de texto: template_name/language são null — campo presente no shape.
   *  Sem media_asset_id → media:null no DTO. */
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

  /** Mensagem de template textual: ambos os campos preenchidos; sem mídia. */
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

// =============================================================================
// B-01..12 — MVP4B.6C: Media resolution (batched, tenant-safe)
// =============================================================================

const FAKE_ASSET_ID_1    = 'aaaa1111-0000-0000-0000-000000000001';
const FAKE_ASSET_ID_2    = 'aaaa2222-0000-0000-0000-000000000002';
const FAKE_ASSET_ID_3    = 'aaaa3333-0000-0000-0000-000000000003';
const OTHER_COMPANY_ID   = 'zzzz0000-0000-0000-0000-000000000099';

/** Mensagem de template com media_asset_id */
function makeMsgWithAsset(id, assetId, overrides = {}) {
  return {
    id,
    conversation_id:    FAKE_CONV_ID,
    instance_id:        FAKE_INSTANCE_ID,
    direction:          'outbound',
    message_type:       'template',
    body:               'Corpo do template',
    provider_timestamp: '2026-09-23T18:00:00.000Z',
    created_at:         '2026-09-23T18:00:00.000Z',
    template_name:      'lovoo_e2e_image',
    template_language:  'en',
    media_asset_id:     assetId,
    ...overrides,
  };
}

/** Asset fictício da company_media_library */
function makeAsset(id, fileType = 'image', overrides = {}) {
  return {
    id,
    preview_url:       `https://storage.example.com/${id}.jpg`,
    original_filename: `arquivo-${id}.jpg`,
    mime_type:         fileType === 'image' ? 'image/jpeg'
                     : fileType === 'video' ? 'video/mp4'
                     : 'application/pdf',
    file_type:         fileType,
    file_size:         134750,
    ...overrides,
  };
}

describe('GET messages — MVP4B.6C media resolution (batched, tenant-safe)', () => {

  it('B-01: mensagens sem media_asset_id → nenhuma query company_media_library; media:null', async () => {
    // DB retorna mensagens sem media_asset_id
    setupHappyPath(FAKE_MSGS_DESC);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // Apenas 2 chamadas: meta_conversations + meta_messages
    // Nenhuma chamada para company_media_library
    expect(mockSvc.from).toHaveBeenCalledTimes(2);
    for (const msg of res._body.messages) {
      expect(msg.media).toBeNull();
    }
  });

  it('B-02: template IMAGE same-company → media{type,url,filename,mime_type,file_size}', async () => {
    const dbMsg  = makeMsgWithAsset('msg-img-001', FAKE_ASSET_ID_1);
    const asset  = makeAsset(FAKE_ASSET_ID_1, 'image');

    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(makeMsgChain([dbMsg]))
      .mockReturnValueOnce(makeAssetChain([asset]));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.messages).toHaveLength(1);

    const media = res._body.messages[0].media;
    expect(media).not.toBeNull();
    expect(media.type).toBe('image');
    expect(media.url).toBe(asset.preview_url);
    expect(media.filename).toBe(asset.original_filename);
    expect(media.mime_type).toBe('image/jpeg');
    expect(media.file_size).toBe(134750);
  });

  it('B-03: template VIDEO same-company → media.type=video', async () => {
    const dbMsg = makeMsgWithAsset('msg-vid-001', FAKE_ASSET_ID_1);
    const asset = makeAsset(FAKE_ASSET_ID_1, 'video', { mime_type: 'video/mp4' });

    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(makeMsgChain([dbMsg]))
      .mockReturnValueOnce(makeAssetChain([asset]));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const media = res._body.messages[0].media;
    expect(media.type).toBe('video');
    expect(media.mime_type).toBe('video/mp4');
  });

  it('B-04: template DOCUMENT same-company → media.type=document', async () => {
    const dbMsg = makeMsgWithAsset('msg-doc-001', FAKE_ASSET_ID_1);
    const asset = makeAsset(FAKE_ASSET_ID_1, 'document', { mime_type: 'application/pdf' });

    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(makeMsgChain([dbMsg]))
      .mockReturnValueOnce(makeAssetChain([asset]));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const media = res._body.messages[0].media;
    expect(media.type).toBe('document');
  });

  it('B-05: múltiplas mensagens com mesmo asset → deduplicação; asset query batched', async () => {
    // 2 mensagens apontando para o mesmo asset
    const msg1  = makeMsgWithAsset('msg-dup-001', FAKE_ASSET_ID_1);
    const msg2  = makeMsgWithAsset('msg-dup-002', FAKE_ASSET_ID_1);
    const asset = makeAsset(FAKE_ASSET_ID_1, 'image');

    const assetChain = makeAssetChain([asset]);
    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(makeMsgChain([msg1, msg2]))
      .mockReturnValueOnce(assetChain);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // Apenas 1 chamada para company_media_library (deduplicado)
    expect(mockSvc.from).toHaveBeenCalledTimes(3);
    expect(assetChain.in).toHaveBeenCalledTimes(1);

    const ids = assetChain.in.mock.calls[0][1];
    // Deduplicado: somente 1 ID único
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe(FAKE_ASSET_ID_1);

    // Ambas mensagens recebem a mídia
    expect(res._body.messages[0].media.type).toBe('image');
    expect(res._body.messages[1].media.type).toBe('image');
  });

  it('B-06: múltiplos assets distintos → UMA query de assets (não N+1)', async () => {
    const msg1   = makeMsgWithAsset('msg-multi-001', FAKE_ASSET_ID_1);
    const msg2   = makeMsgWithAsset('msg-multi-002', FAKE_ASSET_ID_2);
    const msg3   = makeMsgWithAsset('msg-multi-003', FAKE_ASSET_ID_3);
    const asset1 = makeAsset(FAKE_ASSET_ID_1, 'image');
    const asset2 = makeAsset(FAKE_ASSET_ID_2, 'video', { mime_type: 'video/mp4' });
    const asset3 = makeAsset(FAKE_ASSET_ID_3, 'document', { mime_type: 'application/pdf' });

    const assetChain = makeAssetChain([asset1, asset2, asset3]);
    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(makeMsgChain([msg1, msg2, msg3]))
      .mockReturnValueOnce(assetChain);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // UMA única chamada para company_media_library — não N+1
    expect(mockSvc.from).toHaveBeenCalledTimes(3);
    expect(assetChain.in).toHaveBeenCalledTimes(1);

    const ids = assetChain.in.mock.calls[0][1];
    expect(ids).toHaveLength(3);

    // Cada mensagem recebe mídia (independente da ordem após reverse)
    const msgs = res._body.messages;
    const mediaTypes = msgs.map(m => m.media?.type).sort();
    expect(mediaTypes).toEqual(['document', 'image', 'video']);
  });

  it('B-07: asset ID inexistente → media:null (fail-closed)', async () => {
    const dbMsg = makeMsgWithAsset('msg-missing-001', FAKE_ASSET_ID_1);

    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(makeMsgChain([dbMsg]))
      .mockReturnValueOnce(makeAssetChain([])); // asset não encontrado

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.messages[0].media).toBeNull();
  });

  it('B-08: asset de outro company nunca resolvido → media:null; boundary tenant explícita', async () => {
    const dbMsg = makeMsgWithAsset('msg-xten-001', FAKE_ASSET_ID_1);
    const assetChain = makeAssetChain([]); // DB retorna vazio porque company_id não bate

    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(makeMsgChain([dbMsg]))
      .mockReturnValueOnce(assetChain);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.messages[0].media).toBeNull();

    // Confirmar que o filtro de company_id foi aplicado na query de assets
    const eqCalls = assetChain.eq.mock.calls;
    const companyCall = eqCalls.find(c => c[0] === 'company_id');
    expect(companyCall).toBeDefined();
    expect(companyCall[1]).toBe(FAKE_COMPANY_ID); // auth.companyId, não do caller
  });

  it('B-09: asset file_type=audio → media:null (tipo não aceito)', async () => {
    const dbMsg = makeMsgWithAsset('msg-audio-001', FAKE_ASSET_ID_1);
    const asset = makeAsset(FAKE_ASSET_ID_1, 'audio', { mime_type: 'audio/mp3', file_type: 'audio' });

    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(makeMsgChain([dbMsg]))
      .mockReturnValueOnce(makeAssetChain([asset]));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // audio não é aceito → media:null
    expect(res._body.messages[0].media).toBeNull();
  });

  it('B-10: asset query error → 500 internal_error (consistente com padrão do endpoint)', async () => {
    const dbMsg = makeMsgWithAsset('msg-err-001', FAKE_ASSET_ID_1);

    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(makeMsgChain([dbMsg]))
      .mockReturnValueOnce(makeAssetChain(null, { message: 'db timeout on assets' }));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body).toMatchObject({ error: 'internal_error' });
    // Erro real nunca exposto
    expect(JSON.stringify(res._body)).not.toContain('db timeout on assets');
  });

  it('B-11: response não contém campos proibidos (s3_key, company_id do asset, media_asset_id)', async () => {
    const dbMsg  = makeMsgWithAsset('msg-sec-001', FAKE_ASSET_ID_1);
    const assetWithS3Key = {
      ...makeAsset(FAKE_ASSET_ID_1, 'image'),
      s3_key:     'private/bucket/key.jpg', // campo confidencial — nunca deve chegar ao DTO
      company_id: FAKE_COMPANY_ID,           // nunca exposto ao frontend
    };

    mockSvc.from
      .mockReturnValueOnce(makeConvChain(FAKE_CONV_DB))
      .mockReturnValueOnce(makeMsgChain([dbMsg]))
      .mockReturnValueOnce(makeAssetChain([assetWithS3Key]));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const responseBody = JSON.stringify(res._body);

    // media_asset_id não deve aparecer no DTO público
    expect(responseBody).not.toContain('media_asset_id');
    // s3_key não deve aparecer (somente preview_url é mapeado)
    expect(responseBody).not.toContain('s3_key');
    expect(responseBody).not.toContain('private/bucket/key.jpg');
    // company_id do asset nunca no DTO
    // (FAKE_COMPANY_ID pode aparecer em outros contextos, mas media não expõe)
    const msg = res._body.messages[0];
    expect(msg.media).not.toHaveProperty('company_id');
    expect(msg.media).not.toHaveProperty('s3_key');
    expect(msg.media).not.toHaveProperty('id'); // ID do asset não exposto
  });

  it('B-12: filtros originais de conversation/company/instance preservados com media resolution', async () => {
    const dbMsg     = makeMsgWithAsset('msg-filt-001', FAKE_ASSET_ID_1);
    const asset     = makeAsset(FAKE_ASSET_ID_1, 'image');
    const convChain = makeConvChain(FAKE_CONV_DB);
    const msgChain  = makeMsgChain([dbMsg]);
    const assetChain = makeAssetChain([asset]);

    mockSvc.from
      .mockReturnValueOnce(convChain)
      .mockReturnValueOnce(msgChain)
      .mockReturnValueOnce(assetChain);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);

    // Confirmar filtros da messages query preservados
    const msgEqCalls = msgChain.eq.mock.calls;
    expect(msgEqCalls.find(c => c[0] === 'company_id'   && c[1] === FAKE_COMPANY_ID)).toBeDefined();
    expect(msgEqCalls.find(c => c[0] === 'conversation_id')).toBeDefined();
    expect(msgEqCalls.find(c => c[0] === 'instance_id')).toBeDefined();

    // Ordenação preservada
    expect(msgChain.order).toHaveBeenCalledTimes(2);
    expect(msgChain.limit).toHaveBeenCalledWith(50); // LIMIT_DEFAULT=50

    // Asset query tem boundary correta
    const assetEqCalls = assetChain.eq.mock.calls;
    expect(assetEqCalls.find(c => c[0] === 'company_id' && c[1] === FAKE_COMPANY_ID)).toBeDefined();
  });
});
