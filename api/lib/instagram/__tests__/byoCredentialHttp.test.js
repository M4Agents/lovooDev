import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const OTHER = 'dddddddd-0000-4000-8000-000000000004';
const REQUEST = 'eeeeeeee-0000-4000-8000-000000000005';
const SECRET = 'fixture-app-secret-not-real';
const SUAT = 'fixture-suat-not-real';
const APP_ENC = 'byo1:Y2lwaGVyLWFwcA==';
const SUAT_ENC = 'byo1:Y2lwaGVyLXN1YXQ=';
const H1 = `h1:${'ab'.repeat(32)}`;
const S1 = `s1:${'cd'.repeat(32)}`;
const ORIGIN = 'prj_Backend01';
const ENV_KEYS = ['VERCEL_PROJECT_ID', 'INSTAGRAM_BYO_TOKEN_ENC_KEY_V1'];

const { state, calls, realFingerprint } = vi.hoisted(() => ({
  state: {
    gate: null,
    auth: null,
    keyMissing: false,
    realFingerprint: false,
    adminThrows: false,
    rpcThrows: false,
    rpc: { data: null, error: null },
  },
  calls: { rpc: [] },
  realFingerprint: { current: null },
}));

vi.mock('../byoPocGate.js', () => ({
  evaluateByoPocAccess: vi.fn((input) => {
    if (state.gate) return state.gate;
    const requested = typeof input?.requestedCompanyId === 'string'
      ? input.requestedCompanyId.trim().toLowerCase()
      : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requested)) {
      return { ok: false, status: 400, error: 'company_id_invalid' };
    }
    return { ok: true, companyId: requested };
  }),
}));

vi.mock('../byoCredentialAuth.js', () => ({
  authorizeByoCredentialWrite: vi.fn(async (_req, _svc, companyId) => {
    if (state.auth) return state.auth;
    return { ok: true, userId: 'user-1', role: 'admin', companyId };
  }),
}));

vi.mock('../byoTokenCrypto.js', () => ({
  encryptByoSecret: vi.fn((plaintext, context) => {
    if (state.keyMissing) {
      throw new Error(`[byoTokenCrypto] Chave indisponível ${SECRET}`);
    }
    if (context?.field === 'app_secret') return APP_ENC;
    if (context?.field === 'suat') return SUAT_ENC;
    throw new Error('campo');
  }),
}));

vi.mock('../byoCredentialFingerprint.js', async (importOriginal) => {
  const actual = await importOriginal();
  realFingerprint.current = actual.fingerprintByoCredentialRequest;
  return {
    fingerprintByoCredentialRequest: vi.fn((input) => {
      if (state.realFingerprint) return actual.fingerprintByoCredentialRequest(input);
      return input?.operation === 'revoke' ? S1 : H1;
    }),
  };
});

vi.mock('../../automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => {
    if (state.adminThrows) {
      throw new Error(`ausente ${SECRET}`);
    }
    return {
      rpc: async (name, params) => {
        if (state.rpcThrows) throw new Error(`rpc-exception-sensivel ${SECRET}`);
        calls.rpc.push({ name, params });
        return state.rpc;
      },
    };
  },
}));

import { authorizeByoCredentialWrite } from '../byoCredentialAuth.js';
import { fingerprintByoCredentialRequest } from '../byoCredentialFingerprint.js';
import { handleByoCredentialPost } from '../byoCredentialHttp.js';
import { evaluateByoPocAccess } from '../byoPocGate.js';
import { encryptByoSecret } from '../byoTokenCrypto.js';

const applied = {
  result: 'applied',
  validation_status: 'saved',
  credential_version: 1,
  configured: true,
  stale: false,
  app_secret: SECRET,
  request_fingerprint: H1,
};

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function request(body, extra = {}) {
  return {
    method: extra.method ?? 'POST',
    headers: {
      'content-type': extra.contentType ?? 'application/json',
      authorization: 'Bearer test-token',
      ...(extra.contentLength ? { 'content-length': extra.contentLength } : {}),
    },
    body,
  };
}

async function run(mode, body, extra) {
  const res = response();
  await handleByoCredentialPost(request(body, extra), res, mode);
  expect(res.headers['Cache-Control']).toBe('private, no-store');
  return res;
}

function setBody(overrides = {}) {
  return {
    company_id: COMPANY,
    request_id: REQUEST,
    operation: 'set',
    meta_app_id: '1234567890',
    app_secret: SECRET,
    suat: SUAT,
    ...overrides,
  };
}

function rotateSecretBody() {
  return {
    company_id: COMPANY,
    request_id: REQUEST,
    operation: 'rotate_secret',
    expected_version: 2,
    app_secret: SECRET,
  };
}

function rotateSuatBody() {
  return {
    company_id: COMPANY,
    request_id: REQUEST,
    operation: 'rotate_suat',
    expected_version: 2,
    suat: SUAT,
  };
}

function revokeBody(overrides = {}) {
  return {
    company_id: COMPANY,
    request_id: REQUEST,
    expected_version: 4,
    ...overrides,
  };
}

function assertClean(body) {
  const encoded = JSON.stringify(body);
  expect(encoded).not.toContain(SECRET);
  expect(encoded).not.toContain(SUAT);
  expect(encoded).not.toContain(APP_ENC);
  expect(encoded).not.toContain(SUAT_ENC);
  expect(encoded).not.toContain(H1);
  expect(encoded).not.toContain(S1);
}

describe('handleByoCredentialPost', () => {
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    delete process.env.INSTAGRAM_BYO_POC_ENABLED;
    process.env.VERCEL_PROJECT_ID = ORIGIN;
    delete process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1;
    state.gate = null;
    state.auth = null;
    state.keyMissing = false;
    state.realFingerprint = false;
    state.adminThrows = false;
    state.rpcThrows = false;
    state.rpc = { data: applied, error: null };
    calls.rpc.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('grava sem a flag antiga e responde 503 quando a chave falta', async () => {
    delete process.env.INSTAGRAM_BYO_POC_ENABLED;
    delete process.env.INSTAGRAM_BYO_ALLOWED_COMPANY_ID;
    delete process.env.INSTAGRAM_BYO_ALLOWED_VERCEL_PROJECT_ID;
    const open = await run('credentials', setBody());
    expect(open.statusCode).toBe(200);
    expect(evaluateByoPocAccess).toHaveBeenCalledWith({ requestedCompanyId: COMPANY });
    expect(open.body).not.toHaveProperty('error');

    state.keyMissing = true;
    calls.rpc.length = 0;
    const missingKey = await run('credentials', setBody());
    expect(missingKey.statusCode).toBe(503);
    expect(missingKey.body).toEqual({ error: 'unavailable' });
    assertClean(missingKey.body);
    expect(calls.rpc).toHaveLength(0);
    state.keyMissing = false;
  });

  it('recusa método, content-type, tamanho e JSON antes do gate', async () => {
    expect((await run('credentials', setBody(), { method: 'GET' })).body)
      .toEqual({ error: 'method_not_allowed' });
    expect((await run('credentials', setBody(), { method: 'GET' })).statusCode).toBe(405);

    const type = await run('credentials', setBody(), { contentType: 'text/plain' });
    expect(type.statusCode).toBe(415);
    expect(type.body).toEqual({ error: 'unsupported_media_type' });

    const res = response();
    await handleByoCredentialPost({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '18433' },
      get body() {
        throw new Error('body-lido');
      },
    }, res, 'credentials');
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: 'payload_too_large' });

    const broken = await run('credentials', '{');
    expect(broken.statusCode).toBe(400);
    expect(broken.body).toEqual({ error: 'invalid_json' });
    const listed = await run('credentials', [setBody()]);
    expect(listed.statusCode).toBe(400);
    expect(evaluateByoPocAccess).not.toHaveBeenCalled();
    expect(encryptByoSecret).not.toHaveBeenCalled();
  });

  it('repassa negação do gate e da autorização sem cifrar nem chamar a RPC', async () => {
    state.gate = { ok: false, status: 400, error: 'company_id_invalid' };
    const invalid = await run('credentials', setBody({ company_id: 'nao-uuid' }));
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toEqual({ error: 'company_id_invalid' });

    state.gate = { ok: false, status: 403, error: 'forbidden' };
    const outside = await run('credentials', setBody({ company_id: OTHER }));
    expect(outside.statusCode).toBe(403);
    expect(outside.body).toEqual({ error: 'forbidden' });

    state.gate = null;
    state.auth = { ok: false, status: 401, error: 'Autenticação necessária' };
    const missing = await run('credentials', setBody());
    expect(missing.statusCode).toBe(401);
    expect(missing.body).toEqual({ error: 'Autenticação necessária' });

    state.auth = {
      ok: false,
      status: 403,
      error: 'Permissão insuficiente para esta operação',
    };
    const role = await run('credentials', setBody());
    expect(role.statusCode).toBe(403);

    state.auth = {
      ok: false,
      status: 503,
      error: 'Serviço temporariamente indisponível',
    };
    const proof = await run('credentials', setBody());
    expect(proof.statusCode).toBe(503);
    expect(proof.body).toEqual({ error: 'Serviço temporariamente indisponível' });
    expect(encryptByoSecret).not.toHaveBeenCalled();
    expect(fingerprintByoCredentialRequest).not.toHaveBeenCalled();
    expect(calls.rpc).toHaveLength(0);
  });

  it('cifra só os campos da operação e fixa revoke sem chave', async () => {
    const created = await run('credentials', setBody(), { contentType: 'application/json; charset=UTF-8' });
    expect(created.statusCode).toBe(200);
    expect(encryptByoSecret).toHaveBeenNthCalledWith(1, SECRET, { companyId: COMPANY, field: 'app_secret' });
    expect(encryptByoSecret).toHaveBeenNthCalledWith(2, SUAT, { companyId: COMPANY, field: 'suat' });
    assertClean(created.body);

    vi.clearAllMocks();
    calls.rpc.length = 0;
    await run('credentials', rotateSecretBody());
    expect(encryptByoSecret).toHaveBeenCalledTimes(1);
    expect(encryptByoSecret).toHaveBeenCalledWith(SECRET, { companyId: COMPANY, field: 'app_secret' });
    expect(calls.rpc[0].params.p_suat_enc).toBeNull();
    expect(calls.rpc[0].params.p_meta_app_id).toBeNull();
    expect(calls.rpc[0].params.p_origin_project_id).toBeNull();

    vi.clearAllMocks();
    calls.rpc.length = 0;
    await run('credentials', rotateSuatBody());
    expect(encryptByoSecret).toHaveBeenCalledTimes(1);
    expect(encryptByoSecret).toHaveBeenCalledWith(SUAT, { companyId: COMPANY, field: 'suat' });
    expect(calls.rpc[0].params.p_app_secret_enc).toBeNull();

    vi.clearAllMocks();
    calls.rpc.length = 0;
    state.realFingerprint = true;
    const revoked = await run('revoke', revokeBody());
    const expected = realFingerprint.current({
      operation: 'revoke',
      companyId: COMPANY,
      requestId: REQUEST,
      expectedVersion: 4,
    });
    expect(revoked.statusCode).toBe(200);
    expect(encryptByoSecret).not.toHaveBeenCalled();
    expect(calls.rpc[0].params.p_request_fingerprint).toBe(expected);
    expect(expected.startsWith('s1:')).toBe(true);
    expect(calls.rpc[0].params.p_operation).toBe('revoke');
    expect(calls.rpc[0].params.p_app_secret_enc).toBeNull();
    expect(calls.rpc[0].params.p_suat_enc).toBeNull();
    expect(calls.rpc[0].params.p_origin_project_id).toBeNull();
    assertClean(revoked.body);

    const injected = await run('revoke', revokeBody({ operation: 'revoke' }));
    expect(injected.statusCode).toBe(400);
    expect(injected.body).toEqual({ error: 'rejected' });
  });

  it('monta os dez parâmetros no servidor e omite segredos da resposta', async () => {
    const hostile = await run('credentials', setBody({ actor_user_id: 'intruso', origin_project_id: 'prj_FromBody1' }));
    expect(hostile.statusCode).toBe(400);
    expect(calls.rpc).toHaveLength(0);

    const ok = await run('credentials', setBody());
    expect(calls.rpc).toEqual([{
      name: 'instagram_byo_apply_credentials',
      params: {
        p_company_id: COMPANY,
        p_actor_user_id: 'user-1',
        p_operation: 'set',
        p_expected_version: null,
        p_request_id: REQUEST,
        p_request_fingerprint: H1,
        p_meta_app_id: '1234567890',
        p_app_secret_enc: APP_ENC,
        p_suat_enc: SUAT_ENC,
        p_origin_project_id: ORIGIN,
      },
    }]);
    expect(Object.keys(calls.rpc[0].params)).toHaveLength(10);
    expect(ok.body).toEqual({
      ok: true,
      result: 'applied',
      company_id: COMPANY,
      validation_status: 'saved',
      credential_version: 1,
      configured: true,
      stale: false,
    });
    assertClean(ok.body);
    expect(authorizeByoCredentialWrite).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      COMPANY,
    );

    calls.rpc.length = 0;
    process.env.VERCEL_PROJECT_ID = 'prj_test_byo_poc';
    await run('credentials', setBody({ operation: 'replace_app', expected_version: 3 }));
    expect(calls.rpc[0].params.p_origin_project_id).toBeNull();
    expect(calls.rpc[0].params.p_operation).toBe('replace_app');
  });

  it('traduz falha de chave, erro de RPC e resultado desconhecido para 503', async () => {
    state.keyMissing = true;
    const missingKey = await run('credentials', setBody());
    expect(missingKey.statusCode).toBe(503);
    expect(missingKey.body).toEqual({ error: 'unavailable' });
    assertClean(missingKey.body);
    expect(calls.rpc).toHaveLength(0);

    state.keyMissing = false;
    state.adminThrows = true;
    vi.clearAllMocks();
    const admin = await run('credentials', setBody());
    expect(admin.statusCode).toBe(503);
    expect(admin.body).toEqual({ error: 'unavailable' });
    assertClean(admin.body);
    expect(authorizeByoCredentialWrite).not.toHaveBeenCalled();

    state.adminThrows = false;
    state.rpc = { data: null, error: { message: SECRET, code: 'XX000' } };
    const rpcError = await run('credentials', setBody());
    expect(rpcError.statusCode).toBe(503);
    expect(rpcError.body).toEqual({ error: 'unavailable' });
    assertClean(rpcError.body);

    state.rpc = { data: { result: 'mystery', app_secret: SECRET }, error: null };
    const unknown = await run('credentials', setBody());
    expect(unknown.statusCode).toBe(503);
    expect(unknown.body).toEqual({ error: 'unavailable' });
    assertClean(unknown.body);
  });

  it('mapeia idempotência, conflito e revogação já feita', async () => {
    state.rpc = {
      data: {
        result: 'idempotent',
        validation_status: 'saved',
        credential_version: 1,
        configured: true,
        stale: false,
        app_secret_enc: APP_ENC,
      },
      error: null,
    };
    const fresh = await run('credentials', setBody());
    expect(fresh.statusCode).toBe(200);
    expect(fresh.body).toEqual({
      ok: true,
      result: 'idempotent',
      company_id: COMPANY,
      validation_status: 'saved',
      credential_version: 1,
      configured: true,
      stale: false,
    });
    assertClean(fresh.body);

    state.rpc = {
      data: {
        result: 'idempotent',
        validation_status: 'saved',
        credential_version: 1,
        configured: true,
        stale: true,
        request_fingerprint: H1,
      },
      error: null,
    };
    const stale = await run('credentials', setBody());
    expect(stale.statusCode).toBe(200);
    expect(stale.body.stale).toBe(true);
    expect(stale.body.result).toBe('idempotent');
    assertClean(stale.body);

    state.rpc = { data: { result: 'conflict', app_secret: SECRET }, error: null };
    const conflict = await run('credentials', setBody());
    expect(conflict.statusCode).toBe(409);
    expect(conflict.body).toEqual({ error: 'conflict' });
    assertClean(conflict.body);

    state.rpc = { data: { result: 'request_reused', suat: SUAT }, error: null };
    const reused = await run('credentials', setBody());
    expect(reused.statusCode).toBe(409);
    expect(reused.body).toEqual({ error: 'request_reused' });
    assertClean(reused.body);

    state.rpc = {
      data: {
        result: 'already_revoked',
        validation_status: 'revoked',
        credential_version: 4,
        configured: false,
        stale: false,
        app_secret: SECRET,
        request_fingerprint: S1,
      },
      error: null,
    };
    const revoked = await run('revoke', revokeBody());
    expect(revoked.statusCode).toBe(200);
    expect(revoked.body).toEqual({
      ok: true,
      result: 'already_revoked',
      company_id: COMPANY,
      validation_status: 'revoked',
      credential_version: 4,
      configured: false,
      stale: false,
    });
    assertClean(revoked.body);
  });

  it('recusa string UTF-8 acima de 18432 bytes sem Content-Length', async () => {
    const res = await run('credentials', 'x'.repeat(18433));
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: 'payload_too_large' });
    expect(evaluateByoPocAccess).not.toHaveBeenCalled();
    expect(authorizeByoCredentialWrite).not.toHaveBeenCalled();
    expect(encryptByoSecret).not.toHaveBeenCalled();
    expect(calls.rpc).toHaveLength(0);
  });

  it('trata applied sem stale como resposta indisponível', async () => {
    state.rpc = {
      data: {
        result: 'applied',
        validation_status: 'saved',
        credential_version: 1,
        configured: true,
        app_secret: SECRET,
        request_fingerprint: H1,
      },
      error: null,
    };
    const res = await run('credentials', setBody());
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'unavailable' });
    assertClean(res.body);
  });

  it('trata data nula da RPC como indisponível', async () => {
    state.rpc = { data: null, error: null };
    const res = await run('credentials', setBody());
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'unavailable' });
    assertClean(res.body);
  });

  it('esconde o texto quando a RPC lança exceção', async () => {
    state.rpcThrows = true;
    const res = await run('credentials', setBody());
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'unavailable' });
    expect(JSON.stringify(res.body)).not.toContain('rpc-exception-sensivel');
    assertClean(res.body);
  });

  it('mapeia rejected e not_found da RPC', async () => {
    state.rpc = { data: { result: 'rejected', app_secret: SECRET }, error: null };
    const rejected = await run('credentials', setBody());
    expect(rejected.statusCode).toBe(400);
    expect(rejected.body).toEqual({ error: 'rejected' });
    assertClean(rejected.body);

    state.rpc = { data: { result: 'not_found', request_fingerprint: H1 }, error: null };
    const missing = await run('credentials', setBody());
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toEqual({ error: 'not_found' });
    assertClean(missing.body);
  });

  it('rejeita app_secret acima de 4096 bytes antes da cifra', async () => {
    const res = await run('credentials', setBody({ app_secret: 'a'.repeat(4097) }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'rejected' });
    expect(encryptByoSecret).not.toHaveBeenCalled();
    expect(calls.rpc).toHaveLength(0);
  });

  it('nega companyId do gate diferente do payload validado', async () => {
    state.gate = { ok: true, companyId: OTHER };
    const res = await run('credentials', setBody());
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'rejected' });
    expect(encryptByoSecret).not.toHaveBeenCalled();
    expect(calls.rpc).toHaveLength(0);
  });
});
