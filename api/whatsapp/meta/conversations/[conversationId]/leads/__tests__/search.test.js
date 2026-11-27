// =============================================================================
// search.test.js
//
// Testes unitários para GET /api/whatsapp/meta/conversations/:conversationId/leads/search
// Todos os testes usam mocks — sem banco, rede ou valores reais.
//
// Não prova a segurança do PostgreSQL real: inspeciona filtros enviados ao cliente.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { brMobilePhoneLookupValues } from '../../../../../../lib/phone/canonicalizeBrMobile.js';

const {
  mockValidateMetaCaller,
  mockAssertMetaLeadAccess,
  mockSvc,
} = vi.hoisted(() => ({
  mockValidateMetaCaller:    vi.fn(),
  mockAssertMetaLeadAccess:  vi.fn(),
  mockSvc:                   { from: vi.fn() },
}));

vi.mock('../../../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
  META_VIEW_ROLES: ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
}));

vi.mock('../../../../../../lib/meta-whatsapp/assertMetaLeadAccess.js', () => ({
  assertMetaLeadAccess: (...args) => mockAssertMetaLeadAccess(...args),
}));

vi.mock('../../../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

const visibilityProbe = {
  flag: false,
  flagError: null,
  flagChains: [],
  conversationPasses: 0,
  lastConversationChain: null,
};

function makeVisibilityFlagChain() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: visibilityProbe.flagError
        ? null
        : { chat_visibility_by_assigned_to: visibilityProbe.flag },
      error: visibilityProbe.flagError,
    }),
  };
}

let innerFrom = vi.fn();
let companyPasses = 0;

function hideTrackedCall() {
  trackedFrom.mock.calls.pop();
  trackedFrom.mock.results.pop();
  trackedFrom.mock.invocationCallOrder.pop();
}

function routeFrom(table) {
  if (typeof innerFrom !== 'function') return undefined;
  if (table === 'companies') {
    companyPasses += 1;
    if (companyPasses % 2 === 1) {
      const chain = makeVisibilityFlagChain();
      visibilityProbe.flagChains.push(chain);
      hideTrackedCall();
      return chain;
    }
  }
  if (table === 'meta_conversations') {
    visibilityProbe.conversationPasses += 1;
    if (visibilityProbe.conversationPasses > 1) {
      hideTrackedCall();
      return visibilityProbe.lastConversationChain;
    }
    const chain = innerFrom(table);
    visibilityProbe.lastConversationChain = chain;
    return chain;
  }
  return innerFrom(table);
}

const trackedFrom = vi.fn(routeFrom);
trackedFrom.mockReturnValueOnce = (value) => {
  innerFrom.mockReturnValueOnce(value);
  return trackedFrom;
};
trackedFrom.mockReturnValue = (value) => {
  innerFrom.mockReturnValue(value);
  return trackedFrom;
};

Object.defineProperty(mockSvc, 'from', {
  configurable: true,
  enumerable: true,
  get() { return typeof innerFrom === 'function' ? trackedFrom : innerFrom; },
  set(fn) { innerFrom = fn; },
});

import handler from '../search.js';
import { META_VIEW_ROLES } from '../../../../../../lib/meta-whatsapp/validateMetaCaller.js';

const FAKE_COMPANY_ID = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_CONV_ID    = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_USER_ID    = 'cccc0000-0000-0000-0000-000000000003';
const OTHER_COMPANY   = 'dddd0000-0000-0000-0000-000000000004';

const FAKE_AUTH_OK = {
  ok:         true,
  companyId:  FAKE_COMPANY_ID,
  userId:     FAKE_USER_ID,
  role:       'admin',
  accessPath: 'direct',
};

const FAKE_CONV_DB = {
  id:         FAKE_CONV_ID,
  company_id: FAKE_COMPANY_ID,
};

const FAKE_COMPANY_DB = {
  id: FAKE_COMPANY_ID,
  restrict_leads_to_owner: false,
};

const FAKE_LEAD = {
  id: 123,
  name: 'Ana',
  phone: '+55 11 99999-0000',
  email: 'ana@example.com',
  responsible_user_id: null,
  company_id: FAKE_COMPANY_ID,
  deleted_at: null,
  phone_normalized: '5511999990000',
  metadata: { secret: true },
  custom_fields: { note: 'interno' },
};

const HANDLER_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../search.js'),
  'utf8',
);

function makeReq({
  method = 'GET',
  company_id = FAKE_COMPANY_ID,
  conversationId = FAKE_CONV_ID,
  q = 'Ana',
  limit,
  headers = { authorization: 'Bearer fake_token_for_tests' },
  extraQuery = {},
} = {}) {
  const query = { ...extraQuery };
  if (company_id !== undefined) query.company_id = company_id;
  if (conversationId !== undefined) query.conversationId = conversationId;
  if (q !== undefined) query.q = q;
  if (limit !== undefined) query.limit = limit;
  return { method, headers, query };
}

function makeRes() {
  return {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body = body; return this; },
  };
}

function makeConvChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function makeCompanyChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function makeLeadChain(data, error = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    or:     vi.fn().mockReturnThis(),
    in:     vi.fn().mockReturnThis(),
    order:  vi.fn().mockReturnThis(),
    limit:  vi.fn().mockResolvedValue({ data, error }),
  };
}

function setupReadyForLeads({
  conv = FAKE_CONV_DB,
  company = FAKE_COMPANY_DB,
  textLeads = [FAKE_LEAD],
  phoneLeads = [],
  withPhoneLookup = false,
  textError = null,
  phoneError = null,
} = {}) {
  const convChain = makeConvChain(conv);
  const companyChain = makeCompanyChain(company);
  const textChain = makeLeadChain(textLeads, textError);
  const phoneChain = makeLeadChain(phoneLeads, phoneError);

  mockSvc.from
    .mockReturnValueOnce(convChain)
    .mockReturnValueOnce(companyChain)
    .mockReturnValueOnce(textChain);

  if (withPhoneLookup) {
    mockSvc.from.mockReturnValueOnce(phoneChain);
  }

  return { convChain, companyChain, textChain, phoneChain };
}

function leadTableCalls() {
  return mockSvc.from.mock.calls.filter((call) => call[0] === 'leads');
}

function eqCalls(chain, column) {
  return (chain.eq.mock.calls ?? []).filter((call) => call[0] === column);
}

beforeEach(() => {
  vi.resetAllMocks();
  innerFrom = vi.fn();
  companyPasses = 0;
  visibilityProbe.flag = false;
  visibilityProbe.flagError = null;
  visibilityProbe.flagChains = [];
  visibilityProbe.conversationPasses = 0;
  visibilityProbe.lastConversationChain = null;
  trackedFrom.mockImplementation(routeFrom);
  mockValidateMetaCaller.mockResolvedValue(FAKE_AUTH_OK);
  mockAssertMetaLeadAccess.mockReturnValue({ ok: true, scope: 'all' });
});

describe('GET leads/search — método e parâmetros', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s → 405 sem DB',
    async (method) => {
      const res = makeRes();
      await handler(makeReq({ method }), res);
      expect(res._status).toBe(405);
      expect(mockValidateMetaCaller).not.toHaveBeenCalled();
      expect(mockSvc.from).not.toHaveBeenCalled();
    },
  );

  it('company_id ausente → 400', async () => {
    const req = makeReq({ company_id: undefined });
    delete req.query.company_id;
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: expect.stringContaining('company_id') });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('company_id array → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ company_id: [FAKE_COMPANY_ID, OTHER_COMPANY] }), res);
    expect(res._status).toBe(400);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('company_id UUID inválido → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ company_id: 'not-a-uuid' }), res);
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: expect.stringContaining('company_id') });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('conversationId inválido → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ conversationId: 'abc' }), res);
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: expect.stringContaining('conversationId') });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('conversationId array → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ conversationId: [FAKE_CONV_ID, FAKE_CONV_ID] }), res);
    expect(res._status).toBe(400);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('q ausente → 400', async () => {
    const req = makeReq({ q: undefined });
    delete req.query.q;
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: expect.stringContaining('q') });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('q array → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ q: ['Ana', 'Bruno'] }), res);
    expect(res._status).toBe(400);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('q com byte nulo → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ q: 'An\0a' }), res);
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: expect.stringContaining('q') });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('q=** → 400 sem consulta ao banco', async () => {
    const res = makeRes();
    await handler(makeReq({ q: '**' }), res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'q inválido' });
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('q vazio após trim → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ q: '   ' }), res);
    expect(res._status).toBe(400);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('q com 1 caractere → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ q: 'A' }), res);
    expect(res._status).toBe(400);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('q com 81 caracteres → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ q: 'a'.repeat(81) }), res);
    expect(res._status).toBe(400);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it.each([
    { label: "não-inteiro 'abc'", value: 'abc' },
    { label: 'zero', value: '0' },
    { label: 'negativo', value: '-1' },
    { label: 'decimal', value: '1.5' },
    { label: 'whitespace', value: ' 10' },
    { label: 'vazio', value: '' },
  ])('limit inválido ($label) → 400', async ({ value }) => {
    const res = makeRes();
    await handler(makeReq({ limit: value }), res);
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: expect.stringContaining('limit') });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('limit array → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ limit: ['10'] }), res);
    expect(res._status).toBe(400);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });
});

describe('GET leads/search — auth e RBAC do guard', () => {
  it('JWT ausente → 401, sem lookup de conversa', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ok: false, status: 401, error: 'Autenticação necessária',
    });
    const res = makeRes();
    await handler(makeReq({ headers: {} }), res);
    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Autenticação necessária' });
    expect(mockSvc.from).not.toHaveBeenCalled();
    expect(mockAssertMetaLeadAccess).not.toHaveBeenCalled();
  });

  it('JWT inválido → 401', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ok: false, status: 401, error: 'Sessão inválida ou expirada',
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(401);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('role não autorizada → 403', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ok: false, status: 403, error: 'Permissão insuficiente para esta operação',
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('partner sem assignment → 403', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ok: false, status: 403, error: 'Partner sem assignment ativo para esta empresa',
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('parent inválido → 403', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ok: false, status: 403, error: 'Acesso negado a esta empresa',
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('Meta desabilitado → 403', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ok: false, status: 403, error: 'Meta WhatsApp não habilitado para esta empresa',
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(res._body).toMatchObject({ error: expect.stringContaining('Meta WhatsApp') });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('guard é chamado com META_VIEW_ROLES e company_id da query', async () => {
    setupReadyForLeads({ textLeads: [] });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(mockValidateMetaCaller).toHaveBeenCalledWith(
      req,
      mockSvc,
      FAKE_COMPANY_ID,
      { roles: META_VIEW_ROLES },
    );
  });
});

describe('GET leads/search — conversa', () => {
  it('inexistente → 404, sem companies/leads', async () => {
    mockSvc.from.mockReturnValueOnce(makeConvChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'Conversa não encontrada' });
    expect(mockSvc.from).toHaveBeenCalledTimes(1);
    expect(mockSvc.from.mock.calls[0][0]).toBe('meta_conversations');
    expect(mockAssertMetaLeadAccess).not.toHaveBeenCalled();
  });

  it('arquivada → 404 idêntico com status=active', async () => {
    const convChain = makeConvChain(null);
    mockSvc.from.mockReturnValueOnce(convChain);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'Conversa não encontrada' });
    expect(eqCalls(convChain, 'status')[0][1]).toBe('active');
    expect(leadTableCalls()).toHaveLength(0);
  });

  it('outro tenant → 404 idêntico usando auth.companyId', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ...FAKE_AUTH_OK,
      companyId: OTHER_COMPANY,
    });
    const convChain = makeConvChain(null);
    mockSvc.from.mockReturnValueOnce(convChain);
    const res = makeRes();
    await handler(makeReq({ company_id: FAKE_COMPANY_ID }), res);
    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'Conversa não encontrada' });
    expect(eqCalls(convChain, 'company_id')[0][1]).toBe(OTHER_COMPANY);
    expect(leadTableCalls()).toHaveLength(0);
  });
});

describe('GET leads/search — helper', () => {
  it('recusa impede qualquer consulta a leads e não vaza reason', async () => {
    setupReadyForLeads();
    mockAssertMetaLeadAccess.mockReturnValue({ ok: false, reason: 'forbidden' });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(res._body)).not.toContain('forbidden');
    expect(leadTableCalls()).toHaveLength(0);
  });

  it('scope inválido impede consulta a leads', async () => {
    setupReadyForLeads();
    mockAssertMetaLeadAccess.mockReturnValue({ ok: true, scope: 'everyone' });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(leadTableCalls()).toHaveLength(0);
  });

  it('é chamado com auth do guard, company e conversation do banco, operation search', async () => {
    setupReadyForLeads({ textLeads: [] });
    const res = makeRes();
    await handler(makeReq({ extraQuery: { scope: 'all', role: 'super_admin' } }), res);
    expect(mockAssertMetaLeadAccess).toHaveBeenCalledWith({
      auth: FAKE_AUTH_OK,
      operation: 'search',
      company: {
        id: FAKE_COMPANY_ID,
        restrict_leads_to_owner: false,
      },
      conversation: {
        id: FAKE_CONV_ID,
        company_id: FAKE_COMPANY_ID,
      },
    });
    const passed = mockAssertMetaLeadAccess.mock.calls[0][0];
    expect(passed).not.toHaveProperty('lead');
    expect(passed.auth.role).toBe('admin');
  });

  it('repassa restrict_leads_to_owner=true do banco, não o valor do cliente', async () => {
    setupReadyForLeads({
      company: { id: FAKE_COMPANY_ID, restrict_leads_to_owner: true },
      textLeads: [],
    });
    const res = makeRes();
    await handler(makeReq({
      extraQuery: { restrict_leads_to_owner: 'false', scope: 'all' },
    }), res);
    expect(res._status).toBe(200);
    expect(mockAssertMetaLeadAccess).toHaveBeenCalledWith(expect.objectContaining({
      company: {
        id: FAKE_COMPANY_ID,
        restrict_leads_to_owner: true,
      },
    }));
    const passed = mockAssertMetaLeadAccess.mock.calls[0][0];
    expect(passed.company.restrict_leads_to_owner).toBe(true);
    expect(passed.auth).toEqual(FAKE_AUTH_OK);
  });
});

describe('GET leads/search — filtros de tenant e ownership', () => {
  it('scope own aplica responsible_user_id = auth.userId e não IS NULL', async () => {
    mockAssertMetaLeadAccess.mockReturnValue({ ok: true, scope: 'own' });
    const { textChain } = setupReadyForLeads({ textLeads: [] });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(eqCalls(textChain, 'company_id')[0][1]).toBe(FAKE_COMPANY_ID);
    expect(textChain.is).toHaveBeenCalledWith('deleted_at', null);
    expect(eqCalls(textChain, 'responsible_user_id')[0][1]).toBe(FAKE_USER_ID);
    expect(textChain.is.mock.calls.some((call) => call[0] === 'responsible_user_id')).toBe(false);
  });

  it('scope all não filtra por responsável', async () => {
    const { textChain } = setupReadyForLeads({ textLeads: [] });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(eqCalls(textChain, 'responsible_user_id')).toHaveLength(0);
    expect(textChain.is).toHaveBeenCalledWith('deleted_at', null);
    expect(eqCalls(textChain, 'company_id')[0][1]).toBe(FAKE_COMPANY_ID);
  });

  it('consulta de telefone normalizado herda tenant, deleted_at e ownership', async () => {
    mockAssertMetaLeadAccess.mockReturnValue({ ok: true, scope: 'own' });
    const { textChain, phoneChain } = setupReadyForLeads({
      textLeads: [],
      phoneLeads: [],
      withPhoneLookup: true,
    });
    const res = makeRes();
    await handler(makeReq({ q: '11999990000' }), res);
    expect(res._status).toBe(200);
    expect(leadTableCalls()).toHaveLength(2);
    for (const chain of [textChain, phoneChain]) {
      expect(eqCalls(chain, 'company_id')[0][1]).toBe(FAKE_COMPANY_ID);
      expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
      expect(eqCalls(chain, 'responsible_user_id')[0][1]).toBe(FAKE_USER_ID);
    }
  });

  it('queries usam auth.companyId, nunca o company_id cru da query', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ...FAKE_AUTH_OK,
      companyId: OTHER_COMPANY,
      role: 'super_admin',
      accessPath: 'parent',
    });
    const convChain = makeConvChain({ id: FAKE_CONV_ID, company_id: OTHER_COMPANY });
    const companyChain = makeCompanyChain({
      id: OTHER_COMPANY,
      restrict_leads_to_owner: false,
    });
    const textChain = makeLeadChain([]);
    mockSvc.from
      .mockReturnValueOnce(convChain)
      .mockReturnValueOnce(companyChain)
      .mockReturnValueOnce(textChain);

    const res = makeRes();
    await handler(makeReq({ company_id: FAKE_COMPANY_ID }), res);
    expect(res._status).toBe(200);
    expect(eqCalls(convChain, 'company_id')[0][1]).toBe(OTHER_COMPANY);
    expect(eqCalls(companyChain, 'id')[0][1]).toBe(OTHER_COMPANY);
    expect(eqCalls(textChain, 'company_id')[0][1]).toBe(OTHER_COMPANY);
  });
});

describe('GET leads/search — pesquisa e escape', () => {
  it('busca textual cobre name, phone e email com ILIKE citado', async () => {
    const { textChain } = setupReadyForLeads({ textLeads: [] });
    const res = makeRes();
    await handler(makeReq({ q: 'Ana' }), res);
    const orArg = textChain.or.mock.calls[0][0];
    expect(orArg).toMatch(/^name\.ilike\."%Ana%",phone\.ilike\."%Ana%",email\.ilike\."%Ana%"$/);
    expect(phoneLookupValuesAbsent()).toBe(true);
  });

  it('caracteres especiais não quebram o .or() do PostgREST', async () => {
    const { textChain } = setupReadyForLeads({ textLeads: [] });
    const injected = 'x,email.ilike.%evil%,name.eq.1)';
    const res = makeRes();
    await handler(makeReq({ q: injected }), res);
    const orArg = textChain.or.mock.calls[0][0];
    const quotedParts = [...orArg.matchAll(/ilike\.("(?:\\.|[^"\\])*")/g)].map((m) => m[1]);
    expect(quotedParts).toHaveLength(3);
    expect(new Set(quotedParts).size).toBe(1);
    expect(orArg.startsWith('name.ilike."')).toBe(true);
    expect(orArg).toContain('\\%');
    expect(orArg).not.toMatch(/name\.ilike\.%x,/);
  });

  it('escapa %, _ , barra e aspas', async () => {
    const { textChain } = setupReadyForLeads({ textLeads: [] });
    const res = makeRes();
    await handler(makeReq({ q: '100%_a\\b"' }), res);
    const orArg = textChain.or.mock.calls[0][0];
    expect(orArg).toContain('\\%');
    expect(orArg).toContain('\\_');
    expect(orArg).toContain('\\\\');
    expect(orArg).toContain('\\"');
  });

  it('telefone com 10+ dígitos usa .in(phone_normalized) e não .or() com IN', async () => {
    const q = '11999990000';
    const { textChain, phoneChain } = setupReadyForLeads({
      textLeads: [],
      phoneLeads: [],
      withPhoneLookup: true,
    });
    const res = makeRes();
    await handler(makeReq({ q }), res);
    expect(textChain.in).not.toHaveBeenCalled();
    expect(phoneChain.in).toHaveBeenCalledTimes(1);
    expect(phoneChain.in.mock.calls[0][0]).toBe('phone_normalized');
    expect(phoneChain.in.mock.calls[0][1]).toEqual(
      brMobilePhoneLookupValues(q).filter((value) => /^\d{10,}$/.test(value)),
    );
    expect(phoneChain.or).not.toHaveBeenCalled();
    const orArg = textChain.or.mock.calls[0][0];
    expect(orArg).not.toContain('phone_normalized.in.(');
  });

  it('termo sem 10 dígitos não consulta phone_normalized', async () => {
    setupReadyForLeads({ textLeads: [] });
    const res = makeRes();
    await handler(makeReq({ q: 'Ana' }), res);
    expect(leadTableCalls()).toHaveLength(1);
  });

  it('Unicode em q permanece no filtro ILIKE citado', async () => {
    const { textChain } = setupReadyForLeads({ textLeads: [] });
    const res = makeRes();
    await handler(makeReq({ q: 'José' }), res);
    expect(res._status).toBe(200);
    const orArg = textChain.or.mock.calls[0][0];
    expect(orArg).toMatch(/^name\.ilike\."%José%",phone\.ilike\."%José%",email\.ilike\."%José%"$/);
  });
});

function phoneLookupValuesAbsent() {
  return leadTableCalls().length === 1;
}

describe('GET leads/search — resultados', () => {
  it('resultado vazio → 200 { leads: [] }', async () => {
    setupReadyForLeads({ textLeads: [] });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ leads: [] });
  });

  it('DTO mínimo sem campos internos', async () => {
    setupReadyForLeads({ textLeads: [FAKE_LEAD] });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      leads: [{
        id: 123,
        name: 'Ana',
        phone: '+55 11 99999-0000',
        email: 'ana@example.com',
        responsible_user_id: null,
      }],
    });
    const dto = res._body.leads[0];
    expect(Object.keys(dto).sort()).toEqual([
      'email', 'id', 'name', 'phone', 'responsible_user_id',
    ].sort());
    expect(dto).not.toHaveProperty('company_id');
    expect(dto).not.toHaveProperty('deleted_at');
    expect(dto).not.toHaveProperty('phone_normalized');
    expect(dto).not.toHaveProperty('metadata');
    expect(dto).not.toHaveProperty('custom_fields');
    expect(JSON.stringify(res._body)).not.toContain('interno');
    expect(JSON.stringify(res._body)).not.toContain('"secret"');
  });

  it('remove duplicatas por id e ordena name ASC, id ASC', async () => {
    const { phoneChain } = setupReadyForLeads({
      textLeads: [
        { id: 10, name: 'Ana', phone: null, email: null, responsible_user_id: null },
        { id: 2, name: 'Bruno', phone: null, email: null, responsible_user_id: null },
      ],
      phoneLeads: [
        { id: 10, name: 'Ana', phone: '1', email: null, responsible_user_id: null },
        { id: 3, name: 'Ana', phone: null, email: null, responsible_user_id: null },
      ],
      withPhoneLookup: true,
    });
    const res = makeRes();
    await handler(makeReq({ q: '11999990000' }), res);
    expect(phoneChain.in).toHaveBeenCalled();
    expect(res._body.leads.map((row) => row.id)).toEqual([3, 10, 2]);
    expect(res._body.leads).toHaveLength(3);
  });

  it('limit > 20 é clampado para 20', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      id: i + 1,
      name: `Lead ${String(i + 1).padStart(2, '0')}`,
      phone: null,
      email: null,
      responsible_user_id: null,
    }));
    const { textChain } = setupReadyForLeads({ textLeads: rows });
    const res = makeRes();
    await handler(makeReq({ limit: '99' }), res);
    expect(res._status).toBe(200);
    expect(textChain.limit).toHaveBeenCalledWith(20);
    expect(res._body.leads).toHaveLength(20);
  });

  it('SELECT de leads não inclui campos internos nem *', async () => {
    const { textChain } = setupReadyForLeads({ textLeads: [] });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    const selectArg = textChain.select.mock.calls[0][0];
    expect(selectArg).toBe('id, name, phone, email, responsible_user_id');
    expect(selectArg).not.toContain('company_id');
    expect(selectArg).not.toContain('deleted_at');
    expect(selectArg).not.toContain('phone_normalized');
    expect(selectArg).not.toContain('*');
  });
});

describe('GET leads/search — erros opacos', () => {
  it('erro no lookup da conversa não vaza mensagem interna', async () => {
    mockSvc.from.mockReturnValueOnce(makeConvChain(null, { message: 'db connection error' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(res._body)).not.toContain('db connection error');
  });

  it('erro no Supabase de leads não vaza SQL', async () => {
    setupReadyForLeads({
      textLeads: null,
      textError: { message: 'syntax error at or near ILIKE', code: '42601' },
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(res._body)).not.toContain('ILIKE');
    expect(JSON.stringify(res._body)).not.toContain('42601');
  });

  it('falha em phone_normalized → 500 sem resultados parciais', async () => {
    setupReadyForLeads({
      textLeads: [FAKE_LEAD],
      phoneLeads: null,
      phoneError: { message: 'timeout phone_normalized', code: '57014' },
      withPhoneLookup: true,
    });
    const res = makeRes();
    await handler(makeReq({ q: '11999990000' }), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(res._body).not.toHaveProperty('leads');
    expect(JSON.stringify(res._body)).not.toContain('Ana');
    expect(JSON.stringify(res._body)).not.toContain('timeout phone_normalized');
    expect(JSON.stringify(res._body)).not.toContain('57014');
  });
});

describe('GET leads/search — invariantes de código', () => {
  it('não usa templates, view_all_leads, wa_id ou contact_name para busca', () => {
    expect(HANDLER_SOURCE).not.toMatch(/view_all_leads/);
    expect(HANDLER_SOURCE).not.toMatch(/permissions/);
    expect(HANDLER_SOURCE).not.toMatch(/wa_id/);
    expect(HANDLER_SOURCE).not.toMatch(/contact_name/);
    expect(HANDLER_SOURCE).not.toMatch(/service_role/);
    expect(HANDLER_SOURCE).toMatch(/operation: 'search'/);
    expect(HANDLER_SOURCE).toMatch(/brMobilePhoneLookupValues/);
    expect(HANDLER_SOURCE).toMatch(/\.in\('phone_normalized'/);
  });
});

describe('GET leads/search — visibilidade da conversa', () => {
  const OTHER_USER_ID = 'eeee0000-0000-0000-0000-000000000005';
  const OTHER_INSTANCE_ID = 'ffff0000-0000-0000-0000-000000000006';

  function asSeller() {
    mockValidateMetaCaller.mockResolvedValue({
      ok: true,
      companyId: FAKE_COMPANY_ID,
      userId: FAKE_USER_ID,
      role: 'seller',
      accessPath: 'direct',
    });
  }

  function ownConversation() {
    return { ...FAKE_CONV_DB, assigned_to: FAKE_USER_ID };
  }

  it('A/S/T: flag desligada busca sem assigned_to e pagina o conjunto da empresa', async () => {
    asSeller();
    visibilityProbe.flag = false;
    const { convChain, textChain } = setupReadyForLeads({ textLeads: [] });
    const res = makeRes();
    await handler(makeReq({
      q: 'Ana',
      limit: '5',
      extraQuery: { company_id: OTHER_COMPANY, instance_id: OTHER_INSTANCE_ID },
    }), res);

    expect(res._status).toBe(200);
    expect(eqCalls(convChain, 'assigned_to')).toHaveLength(0);
    expect(eqCalls(convChain, 'instance_id')).toHaveLength(0);
    expect(eqCalls(convChain, 'company_id')[0][1]).toBe(FAKE_COMPANY_ID);
    expect(eqCalls(textChain, 'company_id')[0][1]).toBe(FAKE_COMPANY_ID);
    expect(textChain.is).toHaveBeenCalledWith('deleted_at', null);
    expect(textChain.limit).toHaveBeenCalledWith(5);
    expect(textChain.or.mock.calls[0][0]).not.toContain(OTHER_COMPANY);
    expect(visibilityProbe.flagChains[0].eq).toHaveBeenCalledWith('id', FAKE_COMPANY_ID);
  });

  it('B: seller restrito pesquisa somente a conversa atribuída a ele', async () => {
    asSeller();
    visibilityProbe.flag = true;
    const { convChain, textChain } = setupReadyForLeads({
      conv: ownConversation(),
      textLeads: [],
    });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(200);
    expect(eqCalls(convChain, 'assigned_to')[0][1]).toBe(FAKE_USER_ID);
    expect(eqCalls(convChain, 'status')[0][1]).toBe('active');
    expect(eqCalls(textChain, 'company_id')[0][1]).toBe(FAKE_COMPANY_ID);
  });

  it('C/D/E/M: atribuição alheia, nula ou ausente não consulta leads', async () => {
    asSeller();
    visibilityProbe.flag = true;
    for (const conv of [
      { ...ownConversation(), assigned_to: OTHER_USER_ID },
      { ...ownConversation(), assigned_to: null },
      null,
    ]) {
      companyPasses = 0;
      visibilityProbe.conversationPasses = 0;
      const convChain = makeConvChain(conv);
      const textChain = makeLeadChain([FAKE_LEAD]);
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(convChain)
        .mockReturnValueOnce(makeCompanyChain(FAKE_COMPANY_DB))
        .mockReturnValueOnce(textChain);
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(404);
      expect(res._body).toEqual({ error: 'Conversa não encontrada' });
      expect(eqCalls(convChain, 'assigned_to')[0][1]).toBe(FAKE_USER_ID);
      expect(textChain.limit).not.toHaveBeenCalled();
    }
    expect(mockAssertMetaLeadAccess).not.toHaveBeenCalled();
  });

  it('F/G: outra empresa e instance_id do cliente não ampliam a conversa', async () => {
    asSeller();
    visibilityProbe.flag = true;
    mockValidateMetaCaller.mockResolvedValue({
      ok: true,
      companyId: OTHER_COMPANY,
      userId: FAKE_USER_ID,
      role: 'seller',
      accessPath: 'direct',
    });
    const convChain = makeConvChain(null);
    mockSvc.from = vi.fn().mockReturnValueOnce(convChain);
    const res = makeRes();
    await handler(makeReq({
      company_id: FAKE_COMPANY_ID,
      extraQuery: { instance_id: OTHER_INSTANCE_ID },
    }), res);

    expect(res._status).toBe(404);
    expect(eqCalls(convChain, 'company_id')[0][1]).toBe(OTHER_COMPANY);
    expect(eqCalls(convChain, 'instance_id')).toHaveLength(0);
    expect(visibilityProbe.flagChains.at(-1).eq).toHaveBeenCalledWith('id', OTHER_COMPANY);
    expect(leadTableCalls()).toHaveLength(0);
  });

  it('H/I: partner sem atribuição e membership inativa não consultam conversa', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Acesso negado a esta empresa',
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Acesso negado a esta empresa' });
    expect(mockSvc.from).not.toHaveBeenCalled();
    expect(leadTableCalls()).toHaveLength(0);
  });

  it('J: role desconhecido é negado antes da conversa', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ok: true,
      companyId: FAKE_COMPANY_ID,
      userId: FAKE_USER_ID,
      role: 'auditor',
      accessPath: 'direct',
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Acesso negado' });
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('K: falha de leitura da flag não abre a busca', async () => {
    asSeller();
    visibilityProbe.flagError = { message: 'flag down' };
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(503);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(res._body)).not.toContain('flag down');
    expect(mockSvc.from).not.toHaveBeenCalled();
    expect(mockAssertMetaLeadAccess).not.toHaveBeenCalled();
  });

  it('L: falha da conversa permanece 500', async () => {
    asSeller();
    visibilityProbe.flag = true;
    mockSvc.from = vi.fn().mockReturnValueOnce(
      makeConvChain(null, { message: 'connection lost' }),
    );
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(res._body)).not.toContain('connection lost');
    expect(leadTableCalls()).toHaveLength(0);
  });

  it('O/P/Q: empresa, exclusão e propriedade do lead continuam no SQL', async () => {
    asSeller();
    visibilityProbe.flag = true;
    mockAssertMetaLeadAccess.mockReturnValue({ ok: true, scope: 'own' });
    const { textChain } = setupReadyForLeads({
      conv: ownConversation(),
      textLeads: [],
    });
    const res = makeRes();
    await handler(makeReq({ q: 'Ana' }), res);
    expect(res._status).toBe(200);
    expect(eqCalls(textChain, 'company_id')[0][1]).toBe(FAKE_COMPANY_ID);
    expect(textChain.is).toHaveBeenCalledWith('deleted_at', null);
    expect(eqCalls(textChain, 'responsible_user_id')[0][1]).toBe(FAKE_USER_ID);
    expect(textChain.or.mock.calls[0][0]).not.toContain(`company_id.eq.${OTHER_COMPANY}`);
  });

  it('R: as duas flags permanecem independentes', async () => {
    asSeller();
    visibilityProbe.flag = true;
    mockAssertMetaLeadAccess.mockReturnValue({ ok: true, scope: 'all' });
    const restrictedConversation = setupReadyForLeads({
      conv: ownConversation(),
      textLeads: [],
    });
    const broadLeads = makeRes();
    await handler(makeReq(), broadLeads);
    expect(broadLeads._status).toBe(200);
    expect(eqCalls(restrictedConversation.convChain, 'assigned_to')).toHaveLength(1);
    expect(eqCalls(restrictedConversation.textChain, 'responsible_user_id')).toHaveLength(0);

    visibilityProbe.flag = false;
    companyPasses = 0;
    visibilityProbe.conversationPasses = 0;
    mockAssertMetaLeadAccess.mockReturnValue({ ok: true, scope: 'own' });
    const ownedLeads = setupReadyForLeads({ textLeads: [] });
    const narrow = makeRes();
    await handler(makeReq(), narrow);
    expect(narrow._status).toBe(200);
    expect(eqCalls(ownedLeads.convChain, 'assigned_to')).toHaveLength(0);
    expect(eqCalls(ownedLeads.textChain, 'responsible_user_id')[0][1]).toBe(FAKE_USER_ID);
  });

  it('Z/W: transferência e desativação valem na requisição seguinte', async () => {
    asSeller();
    visibilityProbe.flag = true;
    setupReadyForLeads({ conv: ownConversation(), textLeads: [] });
    const opened = makeRes();
    await handler(makeReq(), opened);
    expect(opened._status).toBe(200);

    companyPasses = 0;
    visibilityProbe.conversationPasses = 0;
    const transferred = makeConvChain({ ...ownConversation(), assigned_to: OTHER_USER_ID });
    mockSvc.from = vi.fn().mockReturnValueOnce(transferred);
    const moved = makeRes();
    await handler(makeReq(), moved);
    expect(moved._status).toBe(404);
    expect(eqCalls(transferred, 'assigned_to')[0][1]).toBe(FAKE_USER_ID);

    mockValidateMetaCaller.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Acesso negado a esta empresa',
    });
    const callsBefore = mockSvc.from.mock.calls.length;
    const disabled = makeRes();
    await handler(makeReq(), disabled);
    expect(disabled._status).toBe(403);
    expect(mockSvc.from.mock.calls).toHaveLength(callsBefore);

    asSeller();
    visibilityProbe.flag = true;
    companyPasses = 0;
    visibilityProbe.conversationPasses = 0;
    setupReadyForLeads({ conv: ownConversation(), textLeads: [] });
    const restored = makeRes();
    await handler(makeReq(), restored);
    expect(restored._status).toBe(200);
  });
});
