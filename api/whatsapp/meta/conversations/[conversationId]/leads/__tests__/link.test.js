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

function rpcRow(result, conversationId = FAKE_CONV_ID, leadId = LEAD_ID) {
  return {
    result_code: result,
    conversation_id: result === 'linked' || result === 'already_linked' ? conversationId : null,
    lead_id: result === 'linked' || result === 'already_linked' ? leadId : null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
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

  it('não há UPDATE direto nem consulta à conversa', () => {
    expect(HANDLER_SOURCE).not.toMatch(/\.update\s*\(/);
    expect(HANDLER_SOURCE).not.toMatch(/from\s*\(\s*['"]meta_conversations['"]\s*\)/);
    expect(HANDLER_SOURCE).not.toMatch(/assertMetaLeadAccess/);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });
});
