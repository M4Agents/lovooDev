import { beforeEach, describe, expect, it, vi } from 'vitest';

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const OTHER = 'dddddddd-0000-4000-8000-000000000004';
const ACCOUNT = '17841405822304914';
const SECRET = 'fixture-app-secret-not-real';
const SUAT = 'fixture-suat-not-real';

const { state, calls } = vi.hoisted(() => ({
  state: {
    auth: { ok: true, userId: '11111111-1111-4111-8111-111111111111', role: 'admin' },
    credential: null,
    accounts: [],
    report: null,
  },
  calls: { eqs: [], selects: [], writes: [], reads: [] },
}));

vi.mock('../byoCredentialAuth.js', () => ({
  authorizeByoCredentialWrite: vi.fn(async () => state.auth),
}));

vi.mock('../byoTokenCrypto.js', () => ({
  decryptByoSecret: vi.fn((_value, context) => (
    context.field === 'app_secret' ? SECRET : SUAT
  )),
}));

vi.mock('../byoUnifiedLoginRead.js', () => ({
  readUnifiedLoginDiagnostic: vi.fn(async (input) => {
    calls.reads.push(input);
    return state.report;
  }),
}));

vi.mock('../../automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => ({
    from(table) {
      const query = {
        select(fields) {
          calls.selects.push({ table, fields });
          return query;
        },
        eq(column, value) {
          calls.eqs.push({ table, column, value });
          return query;
        },
        maybeSingle: async () => ({ data: state.credential, error: null }),
        update() { calls.writes.push('update'); return query; },
        insert() { calls.writes.push('insert'); return query; },
        then(resolve, reject) {
          const result = table === 'instagram_byo_poc_accounts'
            ? { data: state.accounts, error: null }
            : { data: null, error: { message: 'not-a-list' } };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
    rpc() {
      calls.writes.push('rpc');
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

import { authorizeByoCredentialWrite } from '../byoCredentialAuth.js';
import { decryptByoSecret } from '../byoTokenCrypto.js';
import { handleByoDiscoveryDiagnostic } from '../byoDiscoveryDiagnosticHttp.js';

function response() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function credential() {
  return {
    meta_app_id: '1234567890',
    app_secret_enc: 'byo1:cipher-app',
    suat_enc: 'byo1:cipher-suat',
  };
}

function readyReport(overrides = {}) {
  return {
    app_identity: 'compatible',
    instagram_basic: 'present',
    instagram_manage_messages: 'present',
    instagram_manage_comments: 'present',
    expected_account: 'found',
    unified_login_read: 'compatible',
    webhook_subscription: 'indeterminate',
    error_code: null,
    ...overrides,
  };
}

async function post(body, method = 'POST') {
  const res = response();
  await handleByoDiscoveryDiagnostic({ method, body, headers: { authorization: 'Bearer fixture' } }, res);
  return res;
}

describe('diagnóstico autenticado do SUAT BYO', () => {
  beforeEach(() => {
    state.auth = { ok: true, userId: '11111111-1111-4111-8111-111111111111', role: 'admin' };
    state.credential = credential();
    state.accounts = [{ instagram_account_id: ACCOUNT }];
    state.report = readyReport();
    calls.eqs = [];
    calls.selects = [];
    calls.writes = [];
    calls.reads = [];
    vi.clearAllMocks();
  });

  it('recusa JWT ausente ou inválido antes da credencial', async () => {
    state.auth = { ok: false, status: 401, error: 'Autenticação necessária' };
    const res = await post({ company_id: COMPANY });
    expect(res.statusCode).toBe(401);
    expect(calls.selects).toHaveLength(0);
    expect(decryptByoSecret).not.toHaveBeenCalled();
    expect(calls.reads).toHaveLength(0);
  });

  it('recusa usuário sem permissão', async () => {
    state.auth = { ok: false, status: 403, error: 'Permissão insuficiente para esta operação' };
    const res = await post({ company_id: COMPANY });
    expect(res.statusCode).toBe(403);
    expect(calls.reads).toHaveLength(0);
  });

  it('recusa partner', async () => {
    state.auth = { ok: false, status: 403, error: 'Permissão insuficiente para esta operação' };
    const res = await post({ company_id: COMPANY });
    expect(res.statusCode).toBe(403);
    expect(authorizeByoCredentialWrite).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      COMPANY,
    );
    expect(decryptByoSecret).not.toHaveBeenCalled();
  });

  it('rejeita company_id inválido', async () => {
    const res = await post({ company_id: 'empresa' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('rejected');
    expect(authorizeByoCredentialWrite).not.toHaveBeenCalled();
  });

  it('informa credencial inexistente', async () => {
    state.credential = null;
    const res = await post({ company_id: COMPANY });
    expect(res.statusCode).toBe(404);
    expect(res.body.error_code).toBe('not_found');
    expect(res.body.expected_account).toBe('indeterminate');
    expect(calls.reads).toHaveLength(0);
  });

  it('não consulta credencial de outra empresa', async () => {
    state.credential = null;
    await post({ company_id: COMPANY });
    expect(calls.eqs.every((entry) => entry.value === COMPANY)).toBe(true);
    expect(calls.eqs.some((entry) => entry.value === OTHER)).toBe(false);
  });

  it('autoriza antes de descriptografar e não grava', async () => {
    const res = await post({ company_id: COMPANY });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(readyReport());
    expect(authorizeByoCredentialWrite.mock.invocationCallOrder[0])
      .toBeLessThan(decryptByoSecret.mock.invocationCallOrder[0]);
    expect(calls.selects[0]).toEqual({
      table: 'instagram_byo_company_credentials',
      fields: 'meta_app_id, app_secret_enc, suat_enc',
    });
    expect(calls.writes).toHaveLength(0);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain(SUAT);
    expect(JSON.stringify(res.body)).not.toContain('byo1:');
  });

  it('pede a conta única da empresa ao leitor', async () => {
    await post({ company_id: COMPANY });
    expect(calls.reads[0].expectedAccountIds).toEqual([ACCOUNT]);
    expect(calls.reads[0].appId).toBe('1234567890');
    expect(calls.reads[0].suat).toBe(SUAT);
  });

  it('não escolhe conta quando a empresa tem várias', async () => {
    state.accounts = [
      { instagram_account_id: ACCOUNT },
      { instagram_account_id: '17841400000000002' },
    ];
    await post({ company_id: COMPANY });
    expect(calls.reads[0].expectedAccountIds).toEqual(['multiple', 'multiple']);
  });

  it('não escolhe conta quando a empresa não tem conta', async () => {
    state.accounts = [];
    await post({ company_id: COMPANY });
    expect(calls.reads[0].expectedAccountIds).toEqual([]);
  });

  it('não executa ao abrir com outro método', async () => {
    const res = await post({ company_id: COMPANY }, 'GET');
    expect(res.statusCode).toBe(405);
    expect(authorizeByoCredentialWrite).not.toHaveBeenCalled();
  });
});
