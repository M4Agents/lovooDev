import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSvc = { from: vi.fn(), auth: { getUser: vi.fn() } };

vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

const mockValidateMetaCaller = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  META_CONNECT_ROLES: ['super_admin', 'system_admin', 'partner', 'admin'],
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
}));

const mockDecryptMetaToken = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/tokenCrypto.js', () => ({
  decryptMetaToken: (...args) => mockDecryptMetaToken(...args),
}));

const mockCreateMessageTemplate = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/graphClient.js', () => ({
  createMessageTemplate: (...args) => mockCreateMessageTemplate(...args),
}));

import handler from '../create.js';

const FAKE_COMPANY_ID = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_USER_ID = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_INSTANCE_ID = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_OTHER_INSTANCE = 'dddd0000-0000-0000-0000-000000000004';
const FAKE_WABA_ID = '111111111111111';
const FAKE_TOKEN_ENC = 'enc:fake:cipher:xyz';
const FAKE_TOKEN_PLAIN = 'EAAFakeTokenForTesting123456789';

function makeAuthOk(overrides = {}) {
  return {
    ok: true,
    userId: FAKE_USER_ID,
    companyId: FAKE_COMPANY_ID,
    role: 'admin',
    accessPath: 'direct',
    ...overrides,
  };
}

function setupDbMocks(instanceData = { id: FAKE_INSTANCE_ID, waba_id: FAKE_WABA_ID, status: 'connected' }, credData = { access_token_enc: FAKE_TOKEN_ENC }) {
  const maybeSingleInst = vi.fn().mockResolvedValue({ data: instanceData, error: null });
  const isInst = vi.fn().mockReturnValue({ maybeSingle: maybeSingleInst });
  const eqInst2 = vi.fn().mockReturnValue({ is: isInst });
  const eqInst1 = vi.fn().mockReturnValue({ eq: eqInst2 });
  const selectInst = vi.fn().mockReturnValue({ eq: eqInst1 });
  const maybeSingleCred = vi.fn().mockResolvedValue({ data: credData, error: null });
  const eqCred = vi.fn().mockReturnValue({ maybeSingle: maybeSingleCred });
  const selectCred = vi.fn().mockReturnValue({ eq: eqCred });

  mockSvc.from.mockImplementation((table) => {
    if (table === 'meta_whatsapp_instances') return { select: selectInst };
    if (table === 'meta_whatsapp_credentials') return { select: selectCred };
    return { select: vi.fn().mockReturnValue({ eq: vi.fn() }) };
  });

  return { eqInst2 };
}

function makeReq(overrides = {}) {
  const { body: bodyOverrides, ...rest } = overrides;
  return {
    method: 'POST',
    headers: { authorization: 'Bearer fake-token' },
    body: {
      company_id: FAKE_COMPANY_ID,
      instance_id: FAKE_INSTANCE_ID,
      name: 'pedido_enviado',
      language: 'pt_BR',
      category: 'UTILITY',
      body_text: 'Olá {{1}}, pedido {{2}} enviado.',
      examples: { body: { '1': 'João', '2': 'ORD-1' } },
      ...bodyOverrides,
    },
    ...rest,
  };
}

function makeRes() {
  return {
    _status: null,
    _body: null,
    _headers: {},
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
    setHeader(k, v) { this._headers[k] = v; },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValidateMetaCaller.mockResolvedValue(makeAuthOk());
  mockDecryptMetaToken.mockReturnValue(FAKE_TOKEN_PLAIN);
  mockCreateMessageTemplate.mockResolvedValue({
    id: '594425479261596',
    status: 'PENDING',
    category: 'UTILITY',
  });
  setupDbMocks();
});

describe('POST /api/whatsapp/meta/templates/create', () => {
  it('TPLB-01: admin autorizado cria e recebe status real da Graph', async () => {
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      id: '594425479261596',
      name: 'pedido_enviado',
      language: 'pt_BR',
      status: 'PENDING',
      category: 'UTILITY',
      message: 'Modelo enviado para análise da Meta. Status atual: PENDING. A aprovação não é imediata.',
    });
    expect(res._body.message).not.toMatch(/aprovado/i);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_TOKEN_PLAIN);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_WABA_ID);
  });

  it('TPLB-02: seller recebe 403', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Permissão insuficiente para esta operação',
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(mockCreateMessageTemplate).not.toHaveBeenCalled();
  });

  it('TPLB-03: partner sem assignment recebe 403', async () => {
    mockValidateMetaCaller.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Partner sem assignment ativo para esta empresa',
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(mockCreateMessageTemplate).not.toHaveBeenCalled();
  });

  it('TPLB-04: instância de outra empresa → 404', async () => {
    setupDbMocks(null);
    const res = makeRes();
    await handler(makeReq({ body: { instance_id: FAKE_OTHER_INSTANCE } }), res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('instance_not_found');
    expect(mockCreateMessageTemplate).not.toHaveBeenCalled();
  });

  it('TPLB-05: WABA e token vêm do banco; client waba/token ignorados', async () => {
    const db = setupDbMocks();
    const res = makeRes();
    await handler(makeReq({
      body: {
        waba_id: '999999999999999',
        access_token: 'EAA-from-client',
      },
    }), res);
    expect(res._status).toBe(200);
    expect(db.eqInst2).toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
    expect(mockCreateMessageTemplate).toHaveBeenCalledWith(
      FAKE_TOKEN_PLAIN,
      FAKE_WABA_ID,
      expect.objectContaining({ name: 'pedido_enviado' }),
    );
    const graphArgs = mockCreateMessageTemplate.mock.calls[0];
    expect(graphArgs[1]).not.toBe('999999999999999');
    expect(graphArgs[0]).not.toBe('EAA-from-client');
  });

  it('TPLB-06: AUTHENTICATION rejeitado antes da Graph', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { category: 'AUTHENTICATION' } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('authentication_not_supported');
    expect(mockCreateMessageTemplate).not.toHaveBeenCalled();
  });

  it('TPLB-07: botões e mídia rejeitados', async () => {
    const buttonsRes = makeRes();
    await handler(makeReq({ body: { buttons: [{ type: 'QUICK_REPLY', text: 'Ok' }] } }), buttonsRes);
    expect(buttonsRes._body.error).toBe('buttons_not_supported');
    const mediaRes = makeRes();
    await handler(makeReq({ body: { header_format: 'IMAGE' } }), mediaRes);
    expect(mediaRes._body.error).toBe('media_not_supported');
    expect(mockCreateMessageTemplate).not.toHaveBeenCalled();
  });

  it('TPLB-08: variáveis e exemplos inválidos', async () => {
    const varsRes = makeRes();
    await handler(makeReq({ body: { body_text: 'Oi {{2}}', examples: { body: { '2': 'x' } } } }), varsRes);
    expect(varsRes._body.error).toBe('invalid_template_variables');
    const exRes = makeRes();
    await handler(makeReq({ body: { examples: { body: { '1': 'João' } } } }), exRes);
    expect(exRes._body.error).toBe('invalid_template_examples');
    expect(mockCreateMessageTemplate).not.toHaveBeenCalled();
  });

  it('TPLB-09: erro Graph sanitizado', async () => {
    mockCreateMessageTemplate.mockRejectedValue(Object.assign(new Error('EAA leaked'), {
      code: 'graph_template_create_failed',
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(502);
    expect(res._body.error).toBe('provider_error');
    expect(JSON.stringify(res._body)).not.toContain('EAA');
  });

  it('TPLB-10: GET create não é permitido; validate usa META_CONNECT_ROLES', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    expect(res._status).toBe(405);
    expect(res._headers.Allow).toBe('POST');
    const okRes = makeRes();
    await handler(makeReq(), okRes);
    expect(mockValidateMetaCaller.mock.calls[0][3]).toEqual({
      roles: ['super_admin', 'system_admin', 'partner', 'admin'],
    });
  });

  it('TPLB-11: nome inválido rejeitado sem Graph', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { name: 'Hello World' } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_template_name');
    expect(mockCreateMessageTemplate).not.toHaveBeenCalled();
  });

  it('TPLB-12: timeout Graph não reenvia', async () => {
    mockCreateMessageTemplate.mockRejectedValue(Object.assign(new Error('timed out'), {
      code: 'graph_timeout',
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(503);
    expect(res._body.error).toBe('provider_unavailable');
    expect(mockCreateMessageTemplate).toHaveBeenCalledTimes(1);
  });
});
