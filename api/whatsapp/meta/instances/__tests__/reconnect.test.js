// =============================================================================
// reconnect.test.js — contrato A5.3.2
// Mocks apenas. Sem Graph real, SQL WRITE real, token real ou reconexão real.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSvc = { from: vi.fn(), rpc: vi.fn() };
const mockGetSupabaseAdmin = vi.fn(() => mockSvc);

vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: (...args) => mockGetSupabaseAdmin(...args),
}));

const mockValidateMetaCaller = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  META_CONNECT_ROLES: ['super_admin', 'system_admin', 'partner', 'admin'],
  META_VIEW_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  META_SEND_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
}));

const mockDecryptMetaToken = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/tokenCrypto.js', () => ({
  decryptMetaToken: (...args) => mockDecryptMetaToken(...args),
}));

const mockListWabaPhoneNumbers = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/graphClient.js', () => ({
  listWabaPhoneNumbers: (...args) => mockListWabaPhoneNumbers(...args),
}));

import handler, { classifyReconnectState, mapGraphReconnectError } from '../reconnect.js';
import { META_CONNECT_ROLES } from '../../../../lib/meta-whatsapp/validateMetaCaller.js';

const FAKE_COMPANY_ID  = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_OTHER_CO    = 'dddd0000-0000-0000-0000-000000000099';
const FAKE_USER_ID     = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_INSTANCE_ID = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_PHONE_ID    = '106540352242922';
const FAKE_WABA_ID     = '1993847387980529';
const FAKE_PLAIN       = 'plain-token-fixture-not-real';
const SNAPSHOT_AT      = '2026-10-23T12:00:00.123456+00:00';
const LATER_AT         = '2026-10-23T12:00:10.000001+00:00';

const HAPPY_BODY = { company_id: FAKE_COMPANY_ID, instance_id: FAKE_INSTANCE_ID };

const DISCONNECTED = {
  id: FAKE_INSTANCE_ID, status: 'disconnected',
  phone_number_id: FAKE_PHONE_ID, waba_id: FAKE_WABA_ID,
  updated_at: SNAPSHOT_AT,
};
const CONNECTED = { ...DISCONNECTED, status: 'connected' };
const GRAPH_PHONES = [
  { id: FAKE_PHONE_ID, displayPhoneNumber: '+55 11 90000-0000', verifiedName: 'Fake' },
];

function makeSelectChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    is:          vi.fn().mockReturnThis(),
    update:      vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function makeUpdateChain(rows, error = null) {
  return {
    update: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue({ data: rows, error }),
  };
}

function makeReq({ body = HAPPY_BODY, method = 'POST', headers = {} } = {}) {
  return {
    method,
    headers: { authorization: 'Bearer fake-jwt-fixture', ...headers },
    body,
  };
}

function makeRes() {
  return {
    _status: null, _body: null, _headers: {},
    status(code) { this._status = code; return this; },
    json(body)   { this._body   = body; return this; },
    setHeader(k, v) { this._headers[k] = v; return this; },
  };
}

function setupGuardOk(role = 'admin', companyId = FAKE_COMPANY_ID) {
  mockValidateMetaCaller.mockResolvedValue({
    ok: true, userId: FAKE_USER_ID, companyId, role, accessPath: 'direct',
  });
}

function setupGuardFail(status, error) {
  mockValidateMetaCaller.mockResolvedValue({ ok: false, status, error });
}

function setupGraphOk() {
  mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN);
  mockListWabaPhoneNumbers.mockResolvedValue(GRAPH_PHONES);
}

function expectOccPredicates(updateChain) {
  expect(updateChain.update).toHaveBeenCalledWith({ status: 'connected' });
  expect(updateChain.eq).toHaveBeenCalledWith('id', FAKE_INSTANCE_ID);
  expect(updateChain.eq).toHaveBeenCalledWith('status', 'disconnected');
  expect(updateChain.eq).toHaveBeenCalledWith('updated_at', SNAPSHOT_AT);
  expect(updateChain.eq).toHaveBeenCalledWith('waba_id', FAKE_WABA_ID);
  expect(updateChain.eq).toHaveBeenCalledWith('phone_number_id', FAKE_PHONE_ID);
  expect(updateChain.is).toHaveBeenCalledWith('deleted_at', null);
}

function setupDisconnectedSuccess() {
  setupGuardOk();
  setupGraphOk();
  const instChain = makeSelectChain(DISCONNECTED);
  const credChain = makeSelectChain({ access_token_enc: 'v1:cipher-fixture' });
  const updateChain = makeUpdateChain([{ id: FAKE_INSTANCE_ID, status: 'connected' }]);
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(instChain)
    .mockReturnValueOnce(credChain)
    .mockReturnValueOnce(updateChain);
  return { instChain, credChain, updateChain };
}

function setupConnectedIdempotent() {
  setupGuardOk();
  setupGraphOk();
  const instChain = makeSelectChain(CONNECTED);
  const credChain = makeSelectChain({ access_token_enc: 'v1:cipher-fixture' });
  const reloadChain = makeSelectChain(CONNECTED);
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(instChain)
    .mockReturnValueOnce(credChain)
    .mockReturnValueOnce(reloadChain);
  return { instChain, credChain, reloadChain };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSupabaseAdmin.mockReset();
  mockGetSupabaseAdmin.mockImplementation(() => mockSvc);
});

describe('RC-01: método HTTP', () => {
  it.each(['GET', 'PUT', 'PATCH', 'DELETE'])('%s → 405', async (method) => {
    const res = makeRes();
    await handler(makeReq({ method }), res);
    expect(res._status).toBe(405);
    expect(res._headers['Allow']).toBe('POST');
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
    expect(mockListWabaPhoneNumbers).not.toHaveBeenCalled();
  });
});

describe('RC-02: body inválido', () => {
  it('instance_id ausente → 400', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { company_id: FAKE_COMPANY_ID } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('instance_id inválido → 400', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { company_id: FAKE_COMPANY_ID, instance_id: 'x' } }), res);
    expect(res._status).toBe(400);
  });

  it('company_id inválido → 400 do guard', async () => {
    setupGuardFail(400, 'company_id inválido');
    const res = makeRes();
    await handler(makeReq({ body: { company_id: 'x', instance_id: FAKE_INSTANCE_ID } }), res);
    expect(res._status).toBe(400);
  });
});

describe('RC-03: auth e RBAC', () => {
  it('sem Authorization → 401', async () => {
    setupGuardFail(401, 'Autenticação necessária');
    const res = makeRes();
    await handler(makeReq({ headers: { authorization: undefined } }), res);
    expect(res._status).toBe(401);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('seller → 403', async () => {
    setupGuardFail(403, 'Permissão insuficiente para esta operação');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(mockListWabaPhoneNumbers).not.toHaveBeenCalled();
  });

  it('manager → 403', async () => {
    setupGuardFail(403, 'Permissão insuficiente para esta operação');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
  });

  it('partner sem assignment → 403', async () => {
    setupGuardFail(403, 'Partner sem assignment ativo para esta empresa');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
  });

  it('impersonação não autorizada → 403', async () => {
    setupGuardFail(403, 'Empresa não encontrada ou sem acesso');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
  });

  it('feature flag desabilitada → 403', async () => {
    setupGuardFail(403, 'Meta WhatsApp não habilitado para esta empresa');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
  });

  it('guard recebe META_CONNECT_ROLES', async () => {
    setupDisconnectedSuccess();
    await handler(makeReq(), makeRes());
    expect(mockValidateMetaCaller).toHaveBeenCalledWith(
      expect.anything(), mockSvc, FAKE_COMPANY_ID, { roles: META_CONNECT_ROLES },
    );
  });
});

describe('RC-04: isolamento', () => {
  it('outra empresa → 404 opaco, sem Graph', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'instance_not_found' });
    expect(mockListWabaPhoneNumbers).not.toHaveBeenCalled();
    expect(JSON.stringify(res._body)).not.toMatch(/dddd0000|owner|company_id/);
  });

  it('soft-deleted → 404 e filtro deleted_at', async () => {
    setupGuardOk();
    const chain = makeSelectChain(null);
    mockSvc.from = vi.fn().mockReturnValue(chain);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
  });

  it('SELECT e UPDATE usam auth.companyId', async () => {
    setupGuardOk('admin', FAKE_OTHER_CO);
    setupGraphOk();
    const instChain = makeSelectChain({ ...DISCONNECTED });
    const credChain = makeSelectChain({ access_token_enc: 'v1:cipher-fixture' });
    const updateChain = makeUpdateChain([{ id: FAKE_INSTANCE_ID, status: 'connected' }]);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(instChain)
      .mockReturnValueOnce(credChain)
      .mockReturnValueOnce(updateChain);

    const res = makeRes();
    await handler(makeReq({ body: { company_id: FAKE_COMPANY_ID, instance_id: FAKE_INSTANCE_ID } }), res);
    expect(res._status).toBe(200);
    expect(instChain.eq).toHaveBeenCalledWith('company_id', FAKE_OTHER_CO);
    expect(updateChain.eq).toHaveBeenCalledWith('company_id', FAKE_OTHER_CO);
    expect(updateChain.eq).not.toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
  });
});

describe('RC-05: estados sem Graph', () => {
  it('error → 409 credential_reauth_required', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain({ ...DISCONNECTED, status: 'error' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'credential_reauth_required' });
    expect(mockListWabaPhoneNumbers).not.toHaveBeenCalled();
    expect(mockDecryptMetaToken).not.toHaveBeenCalled();
  });

  it('token_revoked → 409 credential_reauth_required', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain({ ...DISCONNECTED, status: 'token_revoked' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(409);
    expect(res._body.error).toBe('credential_reauth_required');
    expect(mockListWabaPhoneNumbers).not.toHaveBeenCalled();
  });

  it('status inesperado → 409 instance_state_conflict', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain({ ...DISCONNECTED, status: 'weird' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(409);
    expect(res._body.error).toBe('instance_state_conflict');
    expect(mockListWabaPhoneNumbers).not.toHaveBeenCalled();
  });
});

describe('RC-06: credencial', () => {
  it('ausente → 500 credential_unavailable, sem Graph nem UPDATE', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(DISCONNECTED))
      .mockReturnValueOnce(makeSelectChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'credential_unavailable' });
    expect(mockListWabaPhoneNumbers).not.toHaveBeenCalled();
  });

  it('decrypt falha → 500 credential_unavailable, sem Graph', async () => {
    setupGuardOk();
    mockDecryptMetaToken.mockImplementation(() => { throw new Error('bad cipher'); });
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(DISCONNECTED))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:bad' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'credential_unavailable' });
    expect(JSON.stringify(res._body)).not.toMatch(/bad cipher|v1:/);
    expect(mockListWabaPhoneNumbers).not.toHaveBeenCalled();
  });
});

describe('RC-07: Graph', () => {
  function setupReadyForGraph() {
    setupGuardOk();
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(DISCONNECTED))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:cipher-fixture' }));
  }

  async function expectInaccessibleNoUpdate() {
    setupReadyForGraph();
    mockListWabaPhoneNumbers.mockRejectedValue(
      Object.assign(new Error('graph'), { code: 'graph_waba_inaccessible' }),
    );
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(502);
    expect(res._body).toEqual({ error: 'provider_error' });
    expect(res._body.error).not.toBe('credential_reauth_required');
    expect(mockSvc.from).toHaveBeenCalledTimes(2);
  }

  it('token inválido/revogado (Graph 401 colapsado) → 502, sem UPDATE', async () => {
    await expectInaccessibleNoUpdate();
  });

  it('permissão Graph insuficiente (403 colapsado) → 502, sem UPDATE', async () => {
    await expectInaccessibleNoUpdate();
  });

  it('Graph rate limit (429 colapsado) → 502, sem afirmar revogação', async () => {
    await expectInaccessibleNoUpdate();
  });

  it('Graph resposta inválida → 502 provider_error', async () => {
    setupReadyForGraph();
    mockListWabaPhoneNumbers.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'graph_invalid_response' }),
    );
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(502);
    expect(res._body).toEqual({ error: 'provider_error' });
  });

  it('timeout → 503 provider_unavailable', async () => {
    setupReadyForGraph();
    mockListWabaPhoneNumbers.mockRejectedValue(Object.assign(new Error('x'), { code: 'graph_timeout' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(503);
    expect(res._body).toEqual({ error: 'provider_unavailable' });
  });

  it('rede → 503 provider_unavailable', async () => {
    setupReadyForGraph();
    mockListWabaPhoneNumbers.mockRejectedValue(Object.assign(new Error('x'), { code: 'graph_network_error' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(503);
    expect(res._body.error).toBe('provider_unavailable');
  });

  it('número ausente da WABA → 409 credential_reauth_required, sem UPDATE', async () => {
    setupReadyForGraph();
    mockListWabaPhoneNumbers.mockResolvedValue([
      { id: '000000000000000', displayPhoneNumber: '+55 11 00000-0000', verifiedName: null },
    ]);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'credential_reauth_required' });
    expect(mockSvc.from).toHaveBeenCalledTimes(2);
  });

  it('WABA e número corretos → Graph com token e waba persistidos', async () => {
    const { updateChain } = setupDisconnectedSuccess();
    await handler(makeReq(), makeRes());
    expect(mockListWabaPhoneNumbers).toHaveBeenCalledWith(FAKE_PLAIN, FAKE_WABA_ID);
    expectOccPredicates(updateChain);
  });
});

describe('RC-08: sucesso e idempotência', () => {
  it('disconnected + Graph ok + UPDATE com OCC → 200 connected', async () => {
    const { updateChain } = setupDisconnectedSuccess();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      ok: true, instance_id: FAKE_INSTANCE_ID, status: 'connected',
    });
    expectOccPredicates(updateChain);
  });

  it('connected + Graph ok + identidade igual → 200 sem UPDATE', async () => {
    const { reloadChain } = setupConnectedIdempotent();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      ok: true, instance_id: FAKE_INSTANCE_ID, status: 'connected',
    });
    expect(reloadChain.update).not.toHaveBeenCalled();
    const tables = mockSvc.from.mock.calls.map((c) => c[0]);
    expect(tables.filter((t) => t === 'meta_whatsapp_instances')).toHaveLength(2);
  });
});

describe('RC-09: concorrência OCC', () => {
  it('ciclo connected→disconnected durante Graph (começou disconnected) → 409, UPDATE com snapshot antigo', async () => {
    setupGuardOk();
    setupGraphOk();
    const updateChain = makeUpdateChain([]);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(DISCONNECTED))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:cipher-fixture' }))
      .mockReturnValueOnce(updateChain)
      .mockReturnValueOnce(makeSelectChain({
        ...DISCONNECTED, updated_at: LATER_AT,
      }));
    const res = makeRes();
    await handler(makeReq(), res);
    expectOccPredicates(updateChain);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'instance_state_conflict' });
  });

  it('começou connected e disconnect conclui durante Graph → 409, zero UPDATE', async () => {
    setupGuardOk();
    setupGraphOk();
    const updateChain = makeUpdateChain([{ id: FAKE_INSTANCE_ID, status: 'connected' }]);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(CONNECTED))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:cipher-fixture' }))
      .mockReturnValueOnce(makeSelectChain({ ...DISCONNECTED, updated_at: LATER_AT }))
      .mockReturnValueOnce(updateChain);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'instance_state_conflict' });
    expect(updateChain.update).not.toHaveBeenCalled();
  });

  it('dois reconnects com o mesmo snapshot: segundo 0 linhas + connected → 200', async () => {
    setupGuardOk();
    setupGraphOk();
    const firstUpdate = makeUpdateChain([{ id: FAKE_INSTANCE_ID, status: 'connected' }]);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(DISCONNECTED))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:cipher-fixture' }))
      .mockReturnValueOnce(firstUpdate);
    const first = makeRes();
    await handler(makeReq(), first);
    expect(first._status).toBe(200);
    expectOccPredicates(firstUpdate);

    const secondUpdate = makeUpdateChain([]);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(DISCONNECTED))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:cipher-fixture' }))
      .mockReturnValueOnce(secondUpdate)
      .mockReturnValueOnce(makeSelectChain({ ...CONNECTED, updated_at: LATER_AT }));
    const second = makeRes();
    await handler(makeReq(), second);
    expectOccPredicates(secondUpdate);
    expect(second._status).toBe(200);
    expect(second._body).toEqual({
      ok: true, instance_id: FAKE_INSTANCE_ID, status: 'connected',
    });
  });

  it('UPDATE com updated_at divergente → 0 linhas + disconnected → 409', async () => {
    setupGuardOk();
    setupGraphOk();
    const updateChain = makeUpdateChain([]);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(DISCONNECTED))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:cipher-fixture' }))
      .mockReturnValueOnce(updateChain)
      .mockReturnValueOnce(makeSelectChain({ ...DISCONNECTED, updated_at: LATER_AT }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(updateChain.eq).toHaveBeenCalledWith('updated_at', SNAPSHOT_AT);
    expect(updateChain.eq).not.toHaveBeenCalledWith('updated_at', LATER_AT);
    expect(res._status).toBe(409);
    expect(res._body.error).toBe('instance_state_conflict');
  });

  it('UPDATE 0 linhas + estado final connected e identidade igual → 200', async () => {
    setupGuardOk();
    setupGraphOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(DISCONNECTED))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:cipher-fixture' }))
      .mockReturnValueOnce(makeUpdateChain([]))
      .mockReturnValueOnce(makeSelectChain({ ...CONNECTED, updated_at: LATER_AT }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body.status).toBe('connected');
  });

  it('UPDATE 0 linhas + estado final disconnected → 409', async () => {
    setupGuardOk();
    setupGraphOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(DISCONNECTED))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:cipher-fixture' }))
      .mockReturnValueOnce(makeUpdateChain([]))
      .mockReturnValueOnce(makeSelectChain({ ...DISCONNECTED, updated_at: LATER_AT }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(409);
    expect(res._body.error).toBe('instance_state_conflict');
  });

  it('soft-delete durante Graph no caminho connected → 404', async () => {
    setupGuardOk();
    setupGraphOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(CONNECTED))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:cipher-fixture' }))
      .mockReturnValueOnce(makeSelectChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('instance_not_found');
  });

  it('UPDATE 0 + soft-delete → 404', async () => {
    setupGuardOk();
    setupGraphOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(DISCONNECTED))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:cipher-fixture' }))
      .mockReturnValueOnce(makeUpdateChain([]))
      .mockReturnValueOnce(makeSelectChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('instance_not_found');
  });

  it('UPDATE com erro de banco → 500, sem sucesso', async () => {
    setupGuardOk();
    setupGraphOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(DISCONNECTED))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:cipher-fixture' }))
      .mockReturnValueOnce(makeUpdateChain(null, { message: 'db write failed' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(res._body.ok).toBeUndefined();
  });

  it('retry explícito após timeout: primeiro 503 sem UPDATE; segundo com snapshot atual → 200', async () => {
    setupGuardOk();
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN);
    mockListWabaPhoneNumbers.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'graph_timeout' }),
    );
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(DISCONNECTED))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:cipher-fixture' }));
    const timedOut = makeRes();
    await handler(makeReq(), timedOut);
    expect(timedOut._status).toBe(503);
    expect(timedOut._body.error).toBe('provider_unavailable');
    expect(mockSvc.from).toHaveBeenCalledTimes(2);

    mockListWabaPhoneNumbers.mockResolvedValue(GRAPH_PHONES);
    const retryUpdate = makeUpdateChain([{ id: FAKE_INSTANCE_ID, status: 'connected' }]);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain({ ...DISCONNECTED, updated_at: LATER_AT }))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:cipher-fixture' }))
      .mockReturnValueOnce(retryUpdate);
    const retry = makeRes();
    await handler(makeReq(), retry);
    expect(retry._status).toBe(200);
    expect(retryUpdate.eq).toHaveBeenCalledWith('updated_at', LATER_AT);
    expect(retryUpdate.eq).not.toHaveBeenCalledWith('updated_at', SNAPSHOT_AT);
  });
});

describe('RC-10: classify e mapGraph', () => {
  it('classifyReconnectState', () => {
    expect(classifyReconnectState('disconnected')).toEqual({ kind: 'eligible' });
    expect(classifyReconnectState('connected')).toEqual({ kind: 'eligible' });
    expect(classifyReconnectState('error')).toEqual({ kind: 'reauth' });
    expect(classifyReconnectState('token_revoked')).toEqual({ kind: 'reauth' });
    expect(classifyReconnectState('x')).toEqual({ kind: 'conflict' });
  });

  it('mapGraphReconnectError é conservador', () => {
    expect(mapGraphReconnectError({ code: 'graph_timeout' })).toEqual({
      status: 503, error: 'provider_unavailable',
    });
    expect(mapGraphReconnectError({ code: 'graph_network_error' })).toEqual({
      status: 503, error: 'provider_unavailable',
    });
    expect(mapGraphReconnectError({ code: 'graph_waba_inaccessible' })).toEqual({
      status: 502, error: 'provider_error',
    });
    expect(mapGraphReconnectError({ code: 'graph_invalid_response' })).toEqual({
      status: 502, error: 'provider_error',
    });
  });
});
