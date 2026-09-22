// =============================================================================
// index.test.js
//
// Testes unitários para GET /api/whatsapp/meta/conversations
// Todos os testes usam mocks — sem banco, rede ou valores reais.
//
// COBERTURA:
//   CONV-01 … CONV-02  Happy path / lista vazia
//   CONV-03 … CONV-04  Erros de params obrigatórios
//   CONV-05 … CONV-08  Validação filter/limit
//   CONV-09 … CONV-11  Validação instance_id
//   CONV-12 … CONV-14  Auth / RBAC
//   CONV-15 … CONV-16  Erros de DB
//   CONV-17 … CONV-18  Segurança: SELECT sem company_id, query usa auth.companyId
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks (devem preceder os imports do handler)
// =============================================================================

// vi.hoisted() garante que estas variáveis existam antes do hoist de vi.mock()
const { mockValidateMetaCaller, mockSvc } = vi.hoisted(() => ({
  mockValidateMetaCaller: vi.fn(),
  mockSvc:                { from: vi.fn() },
}));

vi.mock('../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
  META_VIEW_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
}));

vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

import handler from '../index.js';

// =============================================================================
// Fixtures — todos fictícios, nunca reais
// =============================================================================

const FAKE_COMPANY_ID  = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_INSTANCE_ID = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_CONV_ID_A   = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_CONV_ID_B   = 'dddd0000-0000-0000-0000-000000000004';

const FAKE_AUTH_OK = {
  ok:         true,
  companyId:  FAKE_COMPANY_ID,
  userId:     'eeee0000-0000-0000-0000-000000000005',
  role:       'admin',
  accessPath: 'direct',
};

// wa_id usa placeholder ofuscado — nunca número real.
const FAKE_WA_ID       = '5511000000001';
const FAKE_PHOTO_URL   = 'https://fake-storage.example/avatars/company/contact.jpg';

const FAKE_CONV = {
  id:                   FAKE_CONV_ID_A,
  instance_id:          FAKE_INSTANCE_ID,
  wa_id:                FAKE_WA_ID,
  contact_name:         'Teste',
  status:               'active',
  unread_count:         1,
  last_message_at:      '2026-09-21T13:40:49.000Z',
  last_message_preview: '...',
  created_at:           '2026-09-21T13:40:49.000Z',
  updated_at:           '2026-09-21T13:40:52.000Z',
};

// FAKE_CONV enriquecido (com foto) — resultado esperado após enrichment.
const FAKE_CONV_WITH_PHOTO = { ...FAKE_CONV, profile_picture_url: FAKE_PHOTO_URL };
// FAKE_CONV sem foto — resultado esperado quando chat_contacts não tem match.
const FAKE_CONV_NO_PHOTO   = { ...FAKE_CONV, profile_picture_url: null };

// Contato correspondente em chat_contacts (mesmo phone_number que wa_id).
const FAKE_CONTACT = {
  phone_number:        FAKE_WA_ID,
  profile_picture_url: FAKE_PHOTO_URL,
};

// =============================================================================
// Factories / helpers
// =============================================================================

/** Request GET mínimo. */
function makeReq({
  method     = 'GET',
  company_id = FAKE_COMPANY_ID,
  instance_id,
  filter,
  limit,
  headers    = { authorization: 'Bearer fake_token_for_tests' },
} = {}) {
  const query = { company_id };
  if (instance_id !== undefined) query.instance_id = instance_id;
  if (filter      !== undefined) query.filter       = filter;
  if (limit       !== undefined) query.limit        = limit;
  return { method, headers, query };
}

/** Res mock com captura de status e body. */
function makeRes() {
  const res = {
    _status: null,
    _body:   null,
    status(code)  { this._status = code; return this; },
    json(body)    { this._body = body;   return this; },
    send(body)    { this._body = body;   return this; },
  };
  return res;
}

/** Chain para meta_whatsapp_instances: select().eq().eq().is().maybeSingle() */
function makeInstChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    is:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

/** Chain para meta_conversations: select().eq().eq().order().limit() */
function makeConvChain(data, error = null) {
  const chain = {
    select:  vi.fn().mockReturnThis(),
    eq:      vi.fn().mockReturnThis(),
    order:   vi.fn().mockReturnThis(),
    limit:   vi.fn().mockResolvedValue({ data, error }),
    gt:      vi.fn().mockReturnThis(),
  };
  // gt() e eq() chamados adicionalmente devem retornar o mesmo chain
  chain.gt.mockReturnThis();
  return chain;
}

/** Chain para chat_contacts: select().eq().in() */
function makeContactsChain(data, error = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    in:     vi.fn().mockResolvedValue({ data, error }),
  };
  return chain;
}

// =============================================================================
// Setup padrão
// =============================================================================

beforeEach(() => {
  vi.resetAllMocks();
  // Default: auth bem-sucedida
  mockValidateMetaCaller.mockResolvedValue(FAKE_AUTH_OK);
});

/**
 * Configura mockSvc.from para o caminho feliz:
 * 1ª call = instance lookup (se instance_id presente)
 * 2ª call (ou 1ª sem instance) = conversations query
 * 3ª call = chat_contacts enrichment (se conversations não vazia)
 *
 * contacts: dados retornados por chat_contacts (default: [FAKE_CONTACT]).
 *           Passar [] para simular sem match.
 *           Passar null para simular erro (contactsError = true).
 */
function setupHappyPath({
  withInstance   = false,
  conversations  = [FAKE_CONV],
  contacts       = [FAKE_CONTACT],
  contactsError  = false,
} = {}) {
  const contactsChain = contactsError
    ? makeContactsChain(null, { message: 'db_error' })
    : makeContactsChain(contacts);

  if (withInstance) {
    mockSvc.from
      .mockReturnValueOnce(makeInstChain({ id: FAKE_INSTANCE_ID }))
      .mockReturnValueOnce(makeConvChain(conversations))
      .mockReturnValueOnce(contactsChain);
  } else {
    mockSvc.from
      .mockReturnValueOnce(makeConvChain(conversations))
      .mockReturnValueOnce(contactsChain);
  }
}

// =============================================================================
// CONV-01 … CONV-02 — Happy path
// =============================================================================

describe('GET /api/whatsapp/meta/conversations — happy path', () => {
  it('CONV-01: retorna lista com 1 conversa → 200 (com foto enriquecida)', async () => {
    setupHappyPath();
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ conversations: [FAKE_CONV_WITH_PHOTO] });
  });

  it('CONV-02: lista vazia → 200 com conversations: []', async () => {
    // conversations [] → chat_contacts NÃO deve ser consultada.
    mockSvc.from.mockReturnValueOnce(makeConvChain([]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ conversations: [] });
  });
});

// =============================================================================
// CONV-03 … CONV-04 — Params obrigatórios
// =============================================================================

describe('GET /api/whatsapp/meta/conversations — params obrigatórios', () => {
  it('CONV-03: company_id ausente → 400', async () => {
    const req = makeReq({ company_id: undefined });
    delete req.query.company_id;
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: expect.stringContaining('company_id') });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('CONV-04: método != GET → 405', async () => {
    const req = makeReq({ method: 'POST' });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(405);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });
});

// =============================================================================
// CONV-05 … CONV-08 — Validação filter / limit
// =============================================================================

describe('GET /api/whatsapp/meta/conversations — filter e limit', () => {
  it('CONV-05: filter inválido → 400', async () => {
    const req = makeReq({ filter: 'invalid_filter' });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: expect.stringContaining('filter') });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('CONV-06: filter=unread (válido) → 200', async () => {
    setupHappyPath({ conversations: [FAKE_CONV] });
    const req = makeReq({ filter: 'unread' });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
  });

  // CONV-07 — limit adversarial: table-driven
  // Cobre: não-inteiro, zero, negativo, decimal, whitespace, vazio.
  // Em todos os casos: 400 e nenhuma leitura tenant.
  const INVALID_LIMIT_CASES = [
    { label: "não-inteiro 'abc'",           value: 'abc'  },
    { label: 'zero',                         value: '0'    },
    { label: 'negativo',                     value: '-1'   },
    { label: 'decimal 1.5',                  value: '1.5'  },
    { label: 'whitespace " 50"',             value: ' 50'  },
    { label: 'string vazia',                 value: ''     },
  ];

  it.each(INVALID_LIMIT_CASES)(
    'CONV-07 limit inválido ($label) → 400 sem DB',
    async ({ value }) => {
      const req = makeReq({ limit: value });
      const res = makeRes();
      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._body).toMatchObject({ error: expect.stringContaining('limit') });
      expect(mockSvc.from).not.toHaveBeenCalled();
    },
  );

  it('CONV-08: limit > 100 → clampado para 100, HTTP 200', async () => {
    const convChain = makeConvChain([]);
    mockSvc.from.mockReturnValueOnce(convChain);

    const req = makeReq({ limit: '999' });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // Confirmar que limit() foi chamado com 100 (clampado — não 999)
    expect(convChain.limit).toHaveBeenCalledWith(100);
  });
});

// =============================================================================
// CONV-09 … CONV-11 — instance_id
// =============================================================================

describe('GET /api/whatsapp/meta/conversations — instance_id', () => {
  it('CONV-09: instance_id UUID inválido → 400 sem DB', async () => {
    const req = makeReq({ instance_id: 'not-a-uuid' });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: expect.stringContaining('instance_id') });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('CONV-10: instance_id válida do tenant → 200', async () => {
    setupHappyPath({ withInstance: true, conversations: [FAKE_CONV] });
    const req = makeReq({ instance_id: FAKE_INSTANCE_ID });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.conversations).toHaveLength(1);
    // Instance lookup usou auth.companyId (não req.query.company_id)
    const instChainCall = mockSvc.from.mock.calls[0];
    expect(instChainCall[0]).toBe('meta_whatsapp_instances');
  });

  it('CONV-11: instance inexistente/de outro tenant → 404', async () => {
    // instance lookup retorna null
    mockSvc.from.mockReturnValueOnce(makeInstChain(null));

    const req = makeReq({ instance_id: FAKE_INSTANCE_ID });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(404);
    // Não deve chegar a fazer query em meta_conversations
    expect(mockSvc.from).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// CONV-12 … CONV-14 — Auth / RBAC (delegado ao guard)
// =============================================================================

describe('GET /api/whatsapp/meta/conversations — auth e RBAC', () => {
  it('CONV-12: sem Bearer → guard retorna 401 → handler retorna 401', async () => {
    mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 401, error: 'Autenticação necessária' });

    const req = makeReq({ headers: {} }); // sem Authorization
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: 'Autenticação necessária' });
    // Nenhuma query após auth falha
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('CONV-13: role sem permissão → guard retorna 403', async () => {
    mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'Permissão insuficiente para esta operação' });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(403);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('CONV-14: feature flag off → guard retorna 403', async () => {
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
// CONV-15 … CONV-16 — Erros de DB
// =============================================================================

describe('GET /api/whatsapp/meta/conversations — erros de DB', () => {
  it('CONV-15: DB error na query conversations → 500', async () => {
    mockSvc.from.mockReturnValueOnce(makeConvChain(null, { message: 'connection error' }));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body).toMatchObject({ error: 'internal_error' });
  });

  it('CONV-16: getSupabaseAdmin() lança exceção → 500', async () => {
    const { getSupabaseAdmin } = await import('../../../../lib/automation/supabaseAdmin.js');
    vi.mocked(getSupabaseAdmin).mockImplementationOnce(() => {
      throw new Error('env missing');
    });

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
  });
});

// =============================================================================
// CONV-17 … CONV-18 — Segurança: SELECT e uso de auth.companyId
// =============================================================================

describe('GET /api/whatsapp/meta/conversations — segurança de resposta e query', () => {
  it('CONV-17: SELECT explícito — contém campos públicos, exclui company_id, sem *', async () => {
    const convChain = makeConvChain([FAKE_CONV]);
    mockSvc.from
      .mockReturnValueOnce(convChain)
      .mockReturnValueOnce(makeContactsChain([FAKE_CONTACT]));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);

    // Verificar diretamente a string passada a .select() — proteção real no DB.
    expect(convChain.select).toHaveBeenCalledTimes(1);
    const selectArg = convChain.select.mock.calls[0][0];

    // Deve conter todos os campos públicos esperados.
    const EXPECTED_PUBLIC_FIELDS = [
      'id', 'instance_id', 'wa_id', 'contact_name', 'status',
      'unread_count', 'last_message_at', 'last_message_preview',
      'created_at', 'updated_at',
    ];
    for (const field of EXPECTED_PUBLIC_FIELDS) {
      expect(selectArg).toContain(field);
    }

    // NÃO deve conter company_id nem usar SELECT *.
    expect(selectArg).not.toContain('company_id');
    expect(selectArg).not.toBe('*');
    expect(selectArg).not.toContain('*');
  });

  it('CONV-18: query usa auth.companyId — nunca req.query.company_id direto', async () => {
    // Guard retorna um companyId DIFERENTE do que foi enviado na query
    // (simulando Trilha 2 parent → child onde auth.companyId = child)
    const CHILD_COMPANY_ID = 'ffff0000-0000-0000-0000-000000000009';
    mockValidateMetaCaller.mockResolvedValue({
      ok:         true,
      companyId:  CHILD_COMPANY_ID,   // companyId autorizado (child)
      userId:     'user-1',
      role:       'super_admin',
      accessPath: 'parent',
    });

    const convChain = makeConvChain([]);
    // conversations vazia → chat_contacts NÃO é consultada (sem 3ª call)
    mockSvc.from.mockReturnValueOnce(convChain);

    // req.query.company_id aponta para a empresa pai — diferente do auth.companyId
    const req = makeReq({ company_id: FAKE_COMPANY_ID });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);

    // Verificar que .eq('company_id', CHILD_COMPANY_ID) foi chamado
    // (não FAKE_COMPANY_ID que veio da query string)
    const eqCalls = convChain.eq.mock.calls;
    const companyIdCall = eqCalls.find(c => c[0] === 'company_id');
    expect(companyIdCall).toBeDefined();
    expect(companyIdCall[1]).toBe(CHILD_COMPANY_ID);
    // Garantir que o companyId da query string NÃO foi usado
    const wrongCall = eqCalls.find(c => c[0] === 'company_id' && c[1] === FAKE_COMPANY_ID);
    expect(wrongCall).toBeUndefined();
  });
});

// =============================================================================
// CONV-19 … CONV-24 — Enriquecimento com foto do contato (MVP3F)
// =============================================================================

describe('GET /api/whatsapp/meta/conversations — enriquecimento de foto (MVP3F)', () => {
  it('CONV-19: foto encontrada na mesma company → URL retornada na conversation', async () => {
    setupHappyPath({ contacts: [FAKE_CONTACT] });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.conversations[0].profile_picture_url).toBe(FAKE_PHOTO_URL);
  });

  it('CONV-20: sem match em chat_contacts → profile_picture_url null', async () => {
    setupHappyPath({ contacts: [] });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.conversations[0].profile_picture_url).toBeNull();
  });

  it('CONV-21: lookup chat_contacts usa auth.companyId — nunca lookup global', async () => {
    const CHILD_ID = 'c0c00000-0000-0000-0000-000000000099';
    mockValidateMetaCaller.mockResolvedValue({
      ok:         true,
      companyId:  CHILD_ID,
      userId:     'user-1',
      role:       'super_admin',
      accessPath: 'parent',
    });

    const convChain     = makeConvChain([FAKE_CONV]);
    const contactsChain = makeContactsChain([FAKE_CONTACT]);
    mockSvc.from
      .mockReturnValueOnce(convChain)
      .mockReturnValueOnce(contactsChain);

    const req = makeReq({ company_id: FAKE_COMPANY_ID });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // chat_contacts deve ter sido filtrado pelo CHILD_ID (auth.companyId)
    const eqCalls = contactsChain.eq.mock.calls;
    const companyCall = eqCalls.find(c => c[0] === 'company_id');
    expect(companyCall).toBeDefined();
    expect(companyCall[1]).toBe(CHILD_ID);
    // Garantir que FAKE_COMPANY_ID (req.query) não foi usado
    expect(eqCalls.find(c => c[0] === 'company_id' && c[1] === FAKE_COMPANY_ID)).toBeUndefined();
  });

  it('CONV-22: conversations [] → chat_contacts NÃO consultada', async () => {
    // Apenas 1 call mockada — se handler tentar 2ª call, mockReturnValueOnce seguinte é undefined.
    mockSvc.from.mockReturnValueOnce(makeConvChain([]));

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ conversations: [] });
    // from() só deve ter sido chamado 1 vez (meta_conversations), nunca chat_contacts.
    expect(mockSvc.from).toHaveBeenCalledTimes(1);
  });

  it('CONV-23: erro em chat_contacts → HTTP 200, conversations preservadas, profile_picture_url null', async () => {
    setupHappyPath({ contactsError: true });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.conversations).toHaveLength(1);
    expect(res._body.conversations[0].profile_picture_url).toBeNull();
    // Campos originais da conversation preservados.
    expect(res._body.conversations[0].wa_id).toBe(FAKE_WA_ID);
  });

  it('CONV-24: múltiplas conversations → UMA única query chat_contacts com batch deduplicado', async () => {
    const FAKE_CONV_B = { ...FAKE_CONV, id: FAKE_CONV_ID_B, wa_id: FAKE_WA_ID };
    // FAKE_CONV e FAKE_CONV_B têm o MESMO wa_id — deduplicação deve ocorrer.
    const convChain     = makeConvChain([FAKE_CONV, FAKE_CONV_B]);
    const contactsChain = makeContactsChain([FAKE_CONTACT]);
    mockSvc.from
      .mockReturnValueOnce(convChain)
      .mockReturnValueOnce(contactsChain);

    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    // chat_contacts foi chamada exatamente UMA vez (batch, não N+1).
    const contactsCalls = mockSvc.from.mock.calls.filter(c => c[0] === 'chat_contacts');
    expect(contactsCalls).toHaveLength(1);
    // .in() recebe array deduplicado — [FAKE_WA_ID] (não duplicado).
    const inArgs = contactsChain.in.mock.calls[0][1];
    expect(inArgs).toEqual([FAKE_WA_ID]);
    expect(inArgs).toHaveLength(1);
  });
});
