// =============================================================================
// link.test.js
//
// Testes unitários de POST .../leads/link. Mocks apenas. Sem Supabase real.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { mockValidateMetaCaller, mockGetSupabaseAdmin, mockSvc } = vi.hoisted(() => ({
  mockValidateMetaCaller: vi.fn(),
  mockGetSupabaseAdmin: vi.fn(),
  mockSvc: { rpc: vi.fn(), from: vi.fn() },
}));

vi.mock('../../../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
  META_VIEW_ROLES: ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
}));

vi.mock('../../../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: (...args) => mockGetSupabaseAdmin(...args),
}));

const visibilityProbe = {
  flag: false,
  flagError: null,
  flagChains: [],
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

function hideTrackedCall() {
  trackedFrom.mock.calls.pop();
  trackedFrom.mock.results.pop();
  trackedFrom.mock.invocationCallOrder.pop();
}

function routeFrom(table) {
  if (typeof innerFrom !== 'function') return undefined;
  if (table === 'companies') {
    const chain = makeVisibilityFlagChain();
    visibilityProbe.flagChains.push(chain);
    hideTrackedCall();
    return chain;
  }
  if (table === 'meta_conversations') {
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

import handler from '../link.js';
import { META_VIEW_ROLES } from '../../../../../../lib/meta-whatsapp/validateMetaCaller.js';

const FAKE_COMPANY_ID = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_CONV_ID = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_USER_ID = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_ACTOR_FROM_BODY = 'dddd0000-0000-0000-0000-000000000004';
const LEAD_ID = 123;
const OTHER_LEAD_ID = 456;

const FAKE_AUTH_OK = {
  ok: true,
  companyId: FAKE_COMPANY_ID,
  userId: FAKE_USER_ID,
  role: 'admin',
  accessPath: 'direct',
};

const HANDLER_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../link.js'),
  'utf8',
);

function makeReq({
  method = 'POST',
  conversationId = FAKE_CONV_ID,
  headers = { authorization: 'Bearer fake_token_for_tests' },
  body = {
    company_id: FAKE_COMPANY_ID,
    lead_id: LEAD_ID,
    expected_lead_id: null,
  },
} = {}) {
  return { method, headers, query: { conversationId }, body };
}

function makeRes() {
  return {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
}

const DEFAULT_CONVERSATION = {
  id: FAKE_CONV_ID,
  company_id: FAKE_COMPANY_ID,
  assigned_to: null,
  status: 'active',
};

function makeConvChain(data, error = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function eqCalls(chain, column) {
  return (chain.eq.mock.calls ?? []).filter((call) => call[0] === column);
}

function rpcRow(result, conversationId = FAKE_CONV_ID, leadId = LEAD_ID) {
  return {
    result_code: result,
    conversation_id: result === 'linked' || result === 'already_linked' ? conversationId : null,
    lead_id: result === 'linked' || result === 'already_linked' ? leadId : null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  innerFrom = vi.fn();
  visibilityProbe.flag = false;
  visibilityProbe.flagError = null;
  visibilityProbe.flagChains = [];
  visibilityProbe.lastConversationChain = null;
  trackedFrom.mockImplementation(routeFrom);
  innerFrom.mockReturnValue(makeConvChain(DEFAULT_CONVERSATION));
  mockGetSupabaseAdmin.mockReturnValue(mockSvc);
  mockValidateMetaCaller.mockResolvedValue(FAKE_AUTH_OK);
  mockSvc.rpc.mockResolvedValue({ data: [rpcRow('linked')], error: null });
});

describe('POST leads/link — entrada', () => {
  it.each(['GET', 'PUT', 'PATCH', 'DELETE'])('%s → 405 sem RPC', async (method) => {
    const res = makeRes();
    await handler(makeReq({ method }), res);
    expect(res._status).toBe(405);
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('body ausente → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ body: null }), res);
    expect(res._status).toBe(400);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('body array → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ body: [] }), res);
    expect(res._status).toBe(400);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('company_id inválido → 400', async () => {
    const res = makeRes();
    await handler(makeReq({
      body: { company_id: 'not-a-uuid', lead_id: LEAD_ID, expected_lead_id: null },
    }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain('company_id');
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
  });

  it('company_id array → 400', async () => {
    const res = makeRes();
    await handler(makeReq({
      body: { company_id: [FAKE_COMPANY_ID], lead_id: LEAD_ID, expected_lead_id: null },
    }), res);
    expect(res._status).toBe(400);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('conversationId inválido → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ conversationId: 'abc' }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain('conversationId');
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('conversationId array → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ conversationId: [FAKE_CONV_ID] }), res);
    expect(res._status).toBe(400);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['string', '123'],
    ['zero', 0],
    ['negativo', -1],
    ['fração', 1.5],
    ['array', [LEAD_ID]],
    ['inseguro', Number.MAX_SAFE_INTEGER + 1],
  ])('lead_id %s → 400', async (_label, leadId) => {
    const res = makeRes();
    await handler(makeReq({
      body: { company_id: FAKE_COMPANY_ID, lead_id: leadId, expected_lead_id: null },
    }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain('lead_id');
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('expected_lead_id ausente → 400', async () => {
    const res = makeRes();
    await handler(makeReq({
      body: { company_id: FAKE_COMPANY_ID, lead_id: LEAD_ID },
    }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toContain('expected_lead_id');
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['string', '1'],
    ['zero', 0],
    ['fração', 2.5],
    ['array', [OTHER_LEAD_ID]],
    ['false', false],
  ])('expected_lead_id %s → 400', async (_label, expectedLeadId) => {
    const res = makeRes();
    await handler(makeReq({
      body: { company_id: FAKE_COMPANY_ID, lead_id: LEAD_ID, expected_lead_id: expectedLeadId },
    }), res);
    expect(res._status).toBe(400);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });
});

describe('POST leads/link — autenticação', () => {
  it('Authorization ausente → 401 sem RPC', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ok: false, status: 401, error: 'Autenticação necessária',
    });
    const req = makeReq({ headers: {} });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Autenticação necessária' });
    expect(mockValidateMetaCaller).toHaveBeenCalledWith(req, mockSvc, FAKE_COMPANY_ID, { roles: META_VIEW_ROLES });
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('JWT inválido → 401 sem RPC', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ok: false, status: 401, error: 'Sessão inválida ou expirada',
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Sessão inválida ou expirada' });
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('empresa não autorizada → 403 sem RPC', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ok: false, status: 403, error: 'Acesso negado a esta empresa',
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Acesso negado a esta empresa' });
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });
});

describe('POST leads/link — RPC', () => {
  it('expected_lead_id null explícito segue nulo e o ator é auth.userId', async () => {
    const res = makeRes();
    await handler(makeReq({
      body: {
        company_id: FAKE_COMPANY_ID,
        lead_id: LEAD_ID,
        expected_lead_id: null,
        actor_user_id: FAKE_ACTOR_FROM_BODY,
      },
    }), res);

    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
    expect(mockSvc.rpc).toHaveBeenCalledWith('link_meta_conversation_lead', {
      p_company_id: FAKE_COMPANY_ID,
      p_conversation_id: FAKE_CONV_ID,
      p_destination_lead_id: LEAD_ID,
      p_expected_lead_id: null,
      p_actor_user_id: FAKE_USER_ID,
    });
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      result: 'linked',
      conversation_id: FAKE_CONV_ID,
      lead_id: LEAD_ID,
    });
  });

  it('already_linked → 200', async () => {
    mockSvc.rpc.mockResolvedValue({ data: [rpcRow('already_linked')], error: null });
    const res = makeRes();
    await handler(makeReq({
      body: { company_id: FAKE_COMPANY_ID, lead_id: LEAD_ID, expected_lead_id: LEAD_ID },
    }), res);
    expect(res._status).toBe(200);
    expect(res._body.result).toBe('already_linked');
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
  });

  it('conflict não expõe lead vinculado', async () => {
    mockSvc.rpc.mockResolvedValue({
      data: [{ result_code: 'conflict', conversation_id: FAKE_CONV_ID, lead_id: OTHER_LEAD_ID }],
      error: null,
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'conflict' });
    expect(JSON.stringify(res._body)).not.toContain(String(OTHER_LEAD_ID));
  });

  it('forbidden → 403 opaco', async () => {
    mockSvc.rpc.mockResolvedValue({ data: [rpcRow('forbidden')], error: null });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Permissão insuficiente para esta operação' });
  });

  it('not_found → 404 opaco', async () => {
    mockSvc.rpc.mockResolvedValue({ data: [rpcRow('not_found')], error: null });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'Registro não encontrado' });
  });

  it.each(['40001', '40P01'])('%s → 409 retryable e uma única chamada', async (code) => {
    mockSvc.rpc.mockResolvedValue({ data: null, error: { code, message: 'sql ' + code } });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'conflict', retryable: true });
    expect(JSON.stringify(res._body)).not.toContain(code);
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
  });

  it.each(['LM003', '23503', '23514', 'XX000'])('%s → 500 sem SQL', async (code) => {
    mockSvc.rpc.mockResolvedValue({ data: null, error: { code, message: 'detalhe interno ' + code } });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
  });

  it('exceção inesperada → 500 e uma única chamada', async () => {
    mockSvc.rpc.mockRejectedValue(new Error('stack secreto'));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(res._body)).not.toContain('stack');
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
  });

  it('zero linhas → 500', async () => {
    mockSvc.rpc.mockResolvedValue({ data: [], error: null });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
  });

  it('múltiplas linhas → 500', async () => {
    mockSvc.rpc.mockResolvedValue({ data: [rpcRow('linked'), rpcRow('linked')], error: null });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
  });

  it('result_code desconhecido → 500', async () => {
    mockSvc.rpc.mockResolvedValue({
      data: [{ result_code: 'ok', conversation_id: FAKE_CONV_ID, lead_id: LEAD_ID }],
      error: null,
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
  });

  it('não há UPDATE direto e a conversa ativa é filtrada antes da RPC', () => {
    expect(HANDLER_SOURCE).not.toMatch(/\.update\s*\(/);
    expect(HANDLER_SOURCE).toMatch(/from\('meta_conversations'\)/);
    expect(HANDLER_SOURCE).toMatch(/\.eq\('status', 'active'\)/);
    expect(HANDLER_SOURCE).not.toMatch(/assertMetaLeadAccess/);
    expect(HANDLER_SOURCE).not.toMatch(/restrict_leads_to_owner/);
  });
});

describe('POST leads/link — visibilidade da conversa', () => {
  const OTHER_USER_ID = 'eeee0000-0000-0000-0000-000000000005';
  const OTHER_COMPANY_ID = 'ffff0000-0000-0000-0000-000000000006';

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
    return { ...DEFAULT_CONVERSATION, assigned_to: FAKE_USER_ID };
  }

  it('A/N/O: flag desligada preserva a RPC e não filtra assigned_to', async () => {
    asSeller();
    visibilityProbe.flag = false;
    const res = makeRes();
    await handler(makeReq({
      body: {
        company_id: OTHER_COMPANY_ID,
        lead_id: LEAD_ID,
        expected_lead_id: null,
        assigned_to: OTHER_USER_ID,
        actor_user_id: FAKE_ACTOR_FROM_BODY,
        role: 'admin',
      },
    }), res);

    const convChain = visibilityProbe.lastConversationChain;
    expect(res._status).toBe(200);
    expect(eqCalls(convChain, 'company_id')[0][1]).toBe(FAKE_COMPANY_ID);
    expect(eqCalls(convChain, 'id')[0][1]).toBe(FAKE_CONV_ID);
    expect(eqCalls(convChain, 'status')[0][1]).toBe('active');
    expect(eqCalls(convChain, 'assigned_to')).toHaveLength(0);
    expect(visibilityProbe.flagChains[0].eq).toHaveBeenCalledWith('id', FAKE_COMPANY_ID);
    expect(mockSvc.rpc).toHaveBeenCalledWith('link_meta_conversation_lead', {
      p_company_id: FAKE_COMPANY_ID,
      p_conversation_id: FAKE_CONV_ID,
      p_destination_lead_id: LEAD_ID,
      p_expected_lead_id: null,
      p_actor_user_id: FAKE_USER_ID,
    });
  });

  it('B/P: seller restrito vincula a própria conversa', async () => {
    asSeller();
    visibilityProbe.flag = true;
    innerFrom.mockReturnValueOnce(makeConvChain(ownConversation()));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      result: 'linked',
      conversation_id: FAKE_CONV_ID,
      lead_id: LEAD_ID,
    });
    expect(eqCalls(visibilityProbe.lastConversationChain, 'assigned_to')[0][1]).toBe(FAKE_USER_ID);
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
  });

  it('C/D/E/G/M: atribuição alheia, nula, ausente ou arquivada não chama a RPC', async () => {
    asSeller();
    visibilityProbe.flag = true;
    const rows = [
      { ...ownConversation(), assigned_to: OTHER_USER_ID },
      { ...ownConversation(), assigned_to: null },
      null,
      { ...ownConversation(), status: 'archived' },
    ];
    for (const row of rows) {
      visibilityProbe.flagChains = [];
      const chain = makeConvChain(row);
      innerFrom.mockReturnValueOnce(chain);
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(404);
      expect(res._body).toEqual({ error: 'Registro não encontrado' });
      if (row) {
        expect(eqCalls(chain, 'assigned_to')[0][1]).toBe(FAKE_USER_ID);
        expect(eqCalls(chain, 'status')[0][1]).toBe('active');
      }
    }
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('F: conversa de outra empresa usa o company_id autorizado', async () => {
    asSeller();
    visibilityProbe.flag = true;
    const chain = makeConvChain({
      ...ownConversation(),
      company_id: OTHER_COMPANY_ID,
    });
    innerFrom.mockReturnValueOnce(chain);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'Registro não encontrado' });
    expect(eqCalls(chain, 'company_id')[0][1]).toBe(FAKE_COMPANY_ID);
    expect(eqCalls(chain, 'company_id').some((call) => call[1] === OTHER_COMPANY_ID)).toBe(false);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('H/I: partner e membership inativa não consultam a conversa', async () => {
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
    expect(mockSvc.rpc).not.toHaveBeenCalled();
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
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('K: falha da flag não abre a vinculação', async () => {
    asSeller();
    visibilityProbe.flagError = { message: 'flag down' };
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(503);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(res._body)).not.toContain('flag down');
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('L: falha da conversa permanece 500', async () => {
    asSeller();
    visibilityProbe.flag = true;
    innerFrom.mockReturnValueOnce(makeConvChain(null, { message: 'connection lost' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(res._body)).not.toContain('connection lost');
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('Q/S: a RPC continua dona do lead e do relink', async () => {
    asSeller();
    visibilityProbe.flag = false;
    mockSvc.rpc.mockResolvedValue({ data: [rpcRow('not_found')], error: null });
    const missingLead = makeRes();
    await handler(makeReq(), missingLead);
    expect(missingLead._status).toBe(404);
    expect(missingLead._body).toEqual({ error: 'Registro não encontrado' });

    mockSvc.rpc.mockResolvedValue({ data: [rpcRow('forbidden')], error: null });
    const relink = makeRes();
    await handler(makeReq({
      body: {
        company_id: FAKE_COMPANY_ID,
        lead_id: LEAD_ID,
        expected_lead_id: OTHER_LEAD_ID,
      },
    }), relink);
    expect(relink._status).toBe(403);
    expect(relink._body).toEqual({ error: 'Permissão insuficiente para esta operação' });
    expect(mockSvc.rpc).toHaveBeenCalledTimes(2);
    expect(mockSvc.rpc.mock.calls[1][1].p_expected_lead_id).toBe(OTHER_LEAD_ID);
  });

  it('R/T/U/AC: relink, conflito e already_linked preservam o contrato', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ...FAKE_AUTH_OK,
      role: 'admin',
    });
    mockSvc.rpc.mockResolvedValue({ data: [rpcRow('linked', FAKE_CONV_ID, LEAD_ID)], error: null });
    const relink = makeRes();
    await handler(makeReq({
      body: {
        company_id: FAKE_COMPANY_ID,
        lead_id: LEAD_ID,
        expected_lead_id: OTHER_LEAD_ID,
      },
    }), relink);
    expect(relink._status).toBe(200);
    expect(relink._body.result).toBe('linked');

    mockSvc.rpc.mockResolvedValue({
      data: [{ result_code: 'conflict', conversation_id: FAKE_CONV_ID, lead_id: OTHER_LEAD_ID }],
      error: null,
    });
    const conflict = makeRes();
    await handler(makeReq(), conflict);
    expect(conflict._status).toBe(409);
    expect(conflict._body).toEqual({ error: 'conflict' });
    expect(JSON.stringify(conflict._body)).not.toContain(String(OTHER_LEAD_ID));

    mockSvc.rpc.mockResolvedValue({ data: [rpcRow('already_linked')], error: null });
    const same = makeRes();
    await handler(makeReq({
      body: { company_id: FAKE_COMPANY_ID, lead_id: LEAD_ID, expected_lead_id: LEAD_ID },
    }), same);
    expect(same._status).toBe(200);
    expect(same._body).toEqual({
      result: 'already_linked',
      conversation_id: FAKE_CONV_ID,
      lead_id: LEAD_ID,
    });
  });

  it('V: a flag da conversa não aplica a restrição de propriedade do lead', async () => {
    asSeller();
    visibilityProbe.flag = true;
    innerFrom.mockReturnValueOnce(makeConvChain(ownConversation()));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(eqCalls(visibilityProbe.lastConversationChain, 'assigned_to')).toHaveLength(1);
    expect(eqCalls(visibilityProbe.lastConversationChain, 'responsible_user_id')).toHaveLength(0);
    expect(HANDLER_SOURCE).not.toMatch(/restrict_leads_to_owner/);
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
  });

  it('W: transferência entre requisições é reavaliada', async () => {
    asSeller();
    visibilityProbe.flag = true;
    innerFrom.mockReturnValueOnce(makeConvChain(ownConversation()));
    const opened = makeRes();
    await handler(makeReq(), opened);
    expect(opened._status).toBe(200);

    const transferred = makeConvChain({ ...ownConversation(), assigned_to: OTHER_USER_ID });
    innerFrom.mockReturnValueOnce(transferred);
    const moved = makeRes();
    await handler(makeReq(), moved);
    expect(moved._status).toBe(404);
    expect(moved._body).toEqual({ error: 'Registro não encontrado' });
    expect(eqCalls(transferred, 'assigned_to')[0][1]).toBe(FAKE_USER_ID);
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
  });

  it('X/AB: not_found da RPC depois da autorização usa o mesmo 404', async () => {
    asSeller();
    visibilityProbe.flag = true;
    innerFrom.mockReturnValueOnce(makeConvChain(ownConversation()));
    mockSvc.rpc.mockResolvedValue({ data: [rpcRow('not_found')], error: null });
    const raced = makeRes();
    await handler(makeReq(), raced);

    visibilityProbe.flag = true;
    innerFrom.mockReturnValueOnce(makeConvChain(null));
    const missing = makeRes();
    await handler(makeReq(), missing);

    expect(raced._status).toBe(404);
    expect(missing._status).toBe(404);
    expect(raced._body).toEqual(missing._body);
    expect(raced._body).toEqual({ error: 'Registro não encontrado' });
    expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
  });

  it('Y: desativação entre a autorização e a RPC impede a chamada', async () => {
    mockValidateMetaCaller
      .mockResolvedValueOnce({
        ok: true,
        companyId: FAKE_COMPANY_ID,
        userId: FAKE_USER_ID,
        role: 'seller',
        accessPath: 'direct',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: 'Acesso negado a esta empresa',
      });
    visibilityProbe.flag = true;
    innerFrom.mockReturnValueOnce(makeConvChain(ownConversation()));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Acesso negado a esta empresa' });
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });

  it('Z/AA: sucesso não devolve a nova atribuição nem conteúdo da conversa', async () => {
    asSeller();
    visibilityProbe.flag = true;
    innerFrom.mockReturnValueOnce(makeConvChain(ownConversation()));
    mockSvc.rpc.mockResolvedValue({
      data: [{
        result_code: 'linked',
        conversation_id: FAKE_CONV_ID,
        lead_id: LEAD_ID,
        assigned_to: OTHER_USER_ID,
        message: 'conteudo interno',
      }],
      error: null,
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      result: 'linked',
      conversation_id: FAKE_CONV_ID,
      lead_id: LEAD_ID,
    });
    expect(Object.keys(res._body).sort()).toEqual(['conversation_id', 'lead_id', 'result']);
    expect(JSON.stringify(res._body)).not.toContain(OTHER_USER_ID);
    expect(JSON.stringify(res._body)).not.toContain('conteudo interno');
  });
});
