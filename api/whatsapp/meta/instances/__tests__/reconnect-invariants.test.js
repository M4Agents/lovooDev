// =============================================================================
// reconnect-invariants.test.js — A5.3.2
// Zero Graph real, zero credencial na resposta, zero UPDATE antecipado,
// zero write cross-tenant, zero INSERT de credencial, OCC por updated_at.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mockSvc = { from: vi.fn(), rpc: vi.fn() };

vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
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
const mockRegisterPhoneNumber = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/graphClient.js', () => ({
  listWabaPhoneNumbers: (...args) => mockListWabaPhoneNumbers(...args),
  registerPhoneNumber:  (...args) => mockRegisterPhoneNumber(...args),
}));

import handler from '../reconnect.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '../reconnect.js'), 'utf8');

const COMPANY_A  = 'aaaa0000-0000-0000-0000-000000000001';
const COMPANY_B  = 'bbbb0000-0000-0000-0000-0000000000b2';
const USER_ID    = 'cccc0000-0000-0000-0000-000000000002';
const INSTANCE_A = 'dddd0000-0000-0000-0000-0000000000a3';
const PHONE_A    = '106540352242922';
const WABA_A     = '1993847387980529';
const SNAPSHOT   = '2026-10-23T12:00:00.123456+00:00';

function makeSelectChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    is:          vi.fn().mockReturnThis(),
    update:      vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function makeUpdateChain(rows) {
  return {
    update: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue({ data: rows, error: null }),
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

const INSTANCE = {
  id: INSTANCE_A, status: 'disconnected',
  phone_number_id: PHONE_A, waba_id: WABA_A,
  updated_at: SNAPSHOT,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockValidateMetaCaller.mockResolvedValue({
    ok: true, userId: USER_ID, companyId: COMPANY_A, role: 'admin', accessPath: 'direct',
  });
  mockDecryptMetaToken.mockReturnValue('plain-fixture');
  mockListWabaPhoneNumbers.mockResolvedValue([
    { id: PHONE_A, displayPhoneNumber: '+55 11 90000-0000', verifiedName: 'A' },
  ]);
});

describe('INV-01: nenhum UPDATE antes da Graph', () => {
  it('Graph inacessível → from só instance + credentials', async () => {
    const updateChain = makeUpdateChain([{ id: INSTANCE_A, status: 'connected' }]);
    mockListWabaPhoneNumbers.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'graph_waba_inaccessible' }),
    );
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(INSTANCE))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:enc' }))
      .mockReturnValueOnce(updateChain);

    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer fake-jwt-fixture' },
      body: { company_id: COMPANY_A, instance_id: INSTANCE_A },
    }, makeRes());

    expect(updateChain.update).not.toHaveBeenCalled();
    expect(mockSvc.from).toHaveBeenCalledTimes(2);
  });
});

describe('INV-02: UPDATE só no tenant autorizado, só status, com OCC', () => {
  it('payload e predicados: status + snapshot cru + identidade + tenant', async () => {
    const updateChain = makeUpdateChain([{ id: INSTANCE_A, status: 'connected' }]);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(INSTANCE))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:enc' }))
      .mockReturnValueOnce(updateChain);

    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer fake-jwt-fixture' },
      body: { company_id: COMPANY_B, instance_id: INSTANCE_A },
    }, makeRes());

    expect(updateChain.update).toHaveBeenCalledWith({ status: 'connected' });
    const payload = updateChain.update.mock.calls[0][0];
    expect(Object.keys(payload)).toEqual(['status']);
    expect(payload).not.toHaveProperty('deleted_at');
    expect(payload).not.toHaveProperty('phone_number_id');
    expect(payload).not.toHaveProperty('waba_id');
    expect(payload).not.toHaveProperty('updated_at');
    expect(updateChain.eq).toHaveBeenCalledWith('company_id', COMPANY_A);
    expect(updateChain.eq).not.toHaveBeenCalledWith('company_id', COMPANY_B);
    expect(updateChain.eq).toHaveBeenCalledWith('status', 'disconnected');
    expect(updateChain.eq).toHaveBeenCalledWith('updated_at', SNAPSHOT);
    expect(updateChain.eq).toHaveBeenCalledWith('waba_id', WABA_A);
    expect(updateChain.eq).toHaveBeenCalledWith('phone_number_id', PHONE_A);
    expect(updateChain.is).toHaveBeenCalledWith('deleted_at', null);
  });
});

describe('INV-03: credenciais e Graph', () => {
  it('não altera credentials, não registra número, não chama RPC, sem segredo', async () => {
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(INSTANCE))
      .mockReturnValueOnce(makeSelectChain({ access_token_enc: 'v1:enc' }))
      .mockReturnValueOnce(makeUpdateChain([{ id: INSTANCE_A, status: 'connected' }]));

    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer fake-jwt-fixture' },
      body: {
        company_id: COMPANY_A,
        instance_id: INSTANCE_A,
        access_token: 'EAAAN_injected',
        access_token_enc: 'v1:injected',
      },
    }, res);

    expect(res._status).toBe(200);
    expect(mockRegisterPhoneNumber).not.toHaveBeenCalled();
    expect(mockSvc.rpc).not.toHaveBeenCalled();
    const tables = mockSvc.from.mock.calls.map((c) => c[0]);
    expect(tables.filter((t) => t === 'meta_whatsapp_credentials')).toHaveLength(1);
    expect(JSON.stringify(res._body)).not.toMatch(/EAAAN|access_token|v1:|ciphertext|plain-fixture/i);
  });

  it('fonte não importa canal legado nem registerPhoneNumber', () => {
    expect(SRC).not.toMatch(/from ['"].*uazapi/i);
    expect(SRC).not.toMatch(/whatsapp_life_instances/);
    expect(SRC).not.toMatch(/import\s*\{[^}]*registerPhoneNumber/);
    expect(SRC).toContain('listWabaPhoneNumbers');
    expect(SRC).toContain('decryptMetaToken');
    expect(SRC).toContain("eq('updated_at', updatedAtSnapshot)");
  });
});

describe('INV-04: isolamento A/B no lookup', () => {
  it('JWT da empresa A com body da empresa B consulta A e 404 se vazio', async () => {
    const selectChain = makeSelectChain(null);
    mockSvc.from = vi.fn().mockReturnValue(selectChain);
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer fake-jwt-fixture' },
      body: { company_id: COMPANY_B, instance_id: INSTANCE_A },
    }, res);

    expect(selectChain.eq).toHaveBeenCalledWith('company_id', COMPANY_A);
    expect(selectChain.eq).not.toHaveBeenCalledWith('company_id', COMPANY_B);
    expect(res._status).toBe(404);
    expect(mockListWabaPhoneNumbers).not.toHaveBeenCalled();
  });
});
