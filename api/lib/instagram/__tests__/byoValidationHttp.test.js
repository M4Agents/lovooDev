import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const REQUEST = 'eeeeeeee-0000-4000-8000-000000000005';
const SECRET = 'fixture-app-secret-not-real';
const SUAT = 'fixture-suat-not-real';
const ACCOUNT = '17841405822304914';
const OTHER = '17841400000000002';

const { state, calls } = vi.hoisted(() => ({
  state: {
    auth: { ok: true, userId: '11111111-1111-4111-8111-111111111111', role: 'admin' },
    row: null,
    rpc: { data: null, error: null },
    inspection: { ok: true, systemUserId: '99887766', scopes: ['instagram_basic', 'pages_show_list'], accounts: [] },
  },
  calls: { rpc: [], inspect: 0 },
}));

vi.mock('../byoCredentialAuth.js', () => ({
  authorizeByoCredentialWrite: vi.fn(async () => state.auth),
}));

vi.mock('../byoTokenCrypto.js', () => ({
  decryptByoSecret: vi.fn((_value, context) => (
    context.field === 'app_secret' ? SECRET : SUAT
  )),
}));

vi.mock('../byoMetaClient.js', () => ({
  inspectByoSystemUser: vi.fn(async () => {
    calls.inspect += 1;
    return state.inspection;
  }),
}));

vi.mock('../../automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => ({
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: state.row, error: null }),
      };
    },
    rpc: async (name, params) => {
      calls.rpc.push({ name, params });
      return state.rpc;
    },
  }),
}));

import { handleByoValidationPost } from '../byoValidationHttp.js';

function response() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function savedRow(status = 'saved', version = 2) {
  return {
    meta_app_id: '1234567890',
    app_secret_enc: 'byo1:cipher-app',
    suat_enc: 'byo1:cipher-suat',
    validation_status: status,
    credential_version: version,
  };
}

function accounts(ids = [ACCOUNT]) {
  return ids.map((id, index) => ({
    instagram_account_id: id,
    instagram_username: index === 0 ? 'valleron' : 'outra',
  }));
}

function applied(status, version, error = null) {
  return {
    data: {
      result: 'applied',
      validation_status: status,
      credential_version: version,
      configured: true,
      stale: false,
      validation_error_code: error,
    },
    error: null,
  };
}

async function post(mode, body) {
  const res = response();
  await handleByoValidationPost({ method: 'POST', body }, res, mode);
  return res;
}

describe('validação e associação BYO', () => {
  beforeEach(() => {
    state.auth = { ok: true, userId: '11111111-1111-4111-8111-111111111111', role: 'admin' };
    state.row = savedRow();
    state.rpc = applied('valid', 3);
    state.inspection = {
      ok: true,
      systemUserId: '99887766',
      scopes: ['instagram_basic', 'pages_show_list'],
      accounts: accounts([ACCOUNT, OTHER]),
    };
    calls.rpc = [];
    calls.inspect = 0;
  });

  it('grava validação quando o token e o aplicativo conferem', async () => {
    const res = await post('validate', {
      company_id: COMPANY,
      request_id: REQUEST,
      expected_version: 2,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.validation_status).toBe('valid');
    expect(res.body.accounts).toHaveLength(2);
    expect(calls.rpc[0].name).toBe('instagram_byo_record_validation');
    expect(calls.rpc[0].params.p_next_status).toBe('valid');
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain(SUAT);
    expect(JSON.stringify(calls.rpc)).not.toContain(SECRET);
    expect(JSON.stringify(calls.rpc)).not.toContain(SUAT);
  });

  it.each([
    ['token_invalid', 'token inválido'],
    ['token_wrong_app', 'aplicativo diferente'],
    ['insufficient_permissions', 'permissão insuficiente'],
    ['token_type_unsupported', 'tipo incompatível'],
  ])('registra falha definitiva para %s', async (code) => {
    state.inspection = { ok: false, code, definitive: true };
    state.rpc = applied('failed', 3, code);
    const res = await post('validate', {
      company_id: COMPANY,
      request_id: REQUEST,
      expected_version: 2,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.validation_status).toBe('failed');
    expect(res.body.validation_error_code).toBe(code);
    expect(res.body.accounts).toEqual([]);
    expect(calls.rpc[0].params.p_error_code).toBe(code);
  });

  it('informa quando nenhuma conta é encontrada', async () => {
    state.inspection = { ...state.inspection, accounts: [] };
    const res = await post('validate', {
      company_id: COMPANY,
      request_id: REQUEST,
      expected_version: 2,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.accounts).toEqual([]);
    expect(calls.rpc[0].params.p_next_status).toBe('valid');
  });

  it.each([
    ['sem vínculo', { ok: false, status: 403, error: 'Acesso negado' }],
    ['partner sem atribuição', { ok: false, status: 403, error: 'Permissão insuficiente para esta operação' }],
    ['sem permissão de escrita', { ok: false, status: 403, error: 'Permissão insuficiente para esta operação' }],
  ])('não consulta a Meta para %s', async (_label, auth) => {
    state.auth = auth;
    const res = await post('validate', {
      company_id: COMPANY,
      request_id: REQUEST,
      expected_version: 2,
    });
    expect(res.statusCode).toBe(403);
    expect(calls.inspect).toBe(0);
    expect(calls.rpc).toHaveLength(0);
  });

  it('não associa conta que a descoberta não devolveu', async () => {
    state.row = savedRow('valid', 3);
    const res = await post('associate', {
      company_id: COMPANY,
      request_id: REQUEST,
      expected_version: 3,
      instagram_account_id: '17841400000000999',
    });
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('account_not_discovered');
    expect(calls.rpc).toHaveLength(0);
    expect(JSON.stringify(res.body)).not.toContain(SUAT);
  });

  it('associa somente a conta descoberta', async () => {
    state.row = savedRow('valid', 3);
    state.rpc = applied('valid', 4);
    const res = await post('associate', {
      company_id: COMPANY,
      request_id: REQUEST,
      expected_version: 3,
      instagram_account_id: ACCOUNT,
    });
    expect(res.statusCode).toBe(200);
    expect(calls.rpc[0].name).toBe('instagram_byo_associate_account');
    expect(calls.rpc[0].params.p_instagram_account_id).toBe(ACCOUNT);
    expect(calls.rpc[0].params.p_expected_version).toBe(3);
    expect(res.body.account.instagram_username).toBe('valleron');
  });

  it('conflita quando a versão muda durante a associação', async () => {
    state.row = savedRow('valid', 3);
    state.rpc = { data: { result: 'conflict' }, error: null };
    const res = await post('associate', {
      company_id: COMPANY,
      request_id: REQUEST,
      expected_version: 3,
      instagram_account_id: ACCOUNT,
    });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('conflict');
  });

  it('registra a origem de token_invalid sem segredo e sem alterar a resposta', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    state.inspection = {
      ok: false,
      code: 'token_invalid',
      definitive: true,
      diagnostic: {
        stage: 'assigned_pages',
        reason: 'meta_oauth_error',
        meta_error_code: 102,
        meta_error_subcode: 12,
        message: SUAT,
        access_token: SECRET,
      },
    };
    state.rpc = applied('failed', 3, 'token_invalid');
    const res = await post('validate', {
      company_id: COMPANY,
      request_id: REQUEST,
      expected_version: 2,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.validation_error_code).toBe('token_invalid');
    expect(res.body.diagnostic).toBeUndefined();
    const logged = spy.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
    expect(logged).toContain(`"request_id":"${REQUEST}"`);
    expect(logged).toContain('"stage":"assigned_pages"');
    expect(logged).toContain('"reason":"meta_oauth_error"');
    expect(logged).toContain('"meta_error_code":102');
    expect(logged).toContain('"public_code":"token_invalid"');
    expect(logged).not.toContain(SUAT);
    expect(logged).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain(SUAT);
    spy.mockRestore();
  });

  it('não grava status quando a Meta falha de forma temporária', async () => {
    state.inspection = { ok: false, code: 'temporary', definitive: false };
    const res = await post('validate', {
      company_id: COMPANY,
      request_id: REQUEST,
      expected_version: 2,
    });
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('meta_unavailable');
    expect(calls.rpc).toHaveLength(0);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain(SUAT);
  });

  it('preserva o Instagram oficial', () => {
    const files = [
      'api/lib/instagram/byoMetaClient.js',
      'api/lib/instagram/byoMetaDiscovery.js',
      'api/lib/instagram/byoValidationHttp.js',
      'api/instagram/byo-poc/validate.js',
      'api/instagram/byo-poc/accounts.js',
      'supabase/migrations/20261030180000_instagram_byo_validation_account.sql',
    ];
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toContain('instagram_connections');
    expect(source).not.toContain('graph.instagram.com');
    expect(source).not.toContain('api.instagram.com');
    expect(source).not.toContain('INSTAGRAM_APP_SECRET');
    expect(source).not.toContain('decryptInstagramToken');
    expect(source).toContain('graph.facebook.com');
    expect(source).toContain('REVOKE ALL ON FUNCTION public.instagram_byo_record_validation');
    expect(source).toContain('GRANT EXECUTE ON FUNCTION public.instagram_byo_associate_account');
  });
});
