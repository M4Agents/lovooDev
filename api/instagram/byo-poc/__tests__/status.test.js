import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { state, calls, client } = vi.hoisted(() => {
  const state = {
    user: null,
    direct: null,
    parent: null,
    assignment: null,
    child: null,
    credential: null,
    accounts: [],
    dbError: null,
  };
  const calls = [];

  function eqValue(filters, column) {
    return filters.find((item) => item[0] === 'eq' && item[1] === column)?.[2];
  }

  function resolve(table, filters) {
    const hasRoleList = filters.some((item) => item[0] === 'in' && item[1] === 'role');

    if (table === 'company_users' && !hasRoleList) {
      if (!state.direct) return { data: null, error: null };
      if (eqValue(filters, 'company_id') !== state.direct.companyId) return { data: null, error: null };
      if (eqValue(filters, 'is_active') !== true) return { data: null, error: null };
      if (eqValue(filters, 'user_id') !== state.user?.id) return { data: null, error: null };
      return { data: { role: state.direct.role }, error: null };
    }

    if (table === 'company_users' && hasRoleList) {
      const roles = filters.find((item) => item[0] === 'in' && item[1] === 'role')?.[2] ?? [];
      if (!state.parent || !roles.includes(state.parent.role)) return { data: null, error: null };
      if (eqValue(filters, 'user_id') !== state.user?.id) return { data: null, error: null };
      if (eqValue(filters, 'is_active') !== true) return { data: null, error: null };
      return { data: state.parent, error: null };
    }

    if (table === 'partner_company_assignments') {
      if (!state.assignment) return { data: null, error: null };
      if (eqValue(filters, 'company_id') !== state.assignment.companyId) return { data: null, error: null };
      if (eqValue(filters, 'partner_user_id') !== state.user?.id) return { data: null, error: null };
      if (eqValue(filters, 'is_active') !== true) return { data: null, error: null };
      return { data: { id: state.assignment.id }, error: null };
    }

    if (table === 'companies') {
      if (!state.child) return { data: null, error: null };
      if (eqValue(filters, 'id') !== state.child.id) return { data: null, error: null };
      if (eqValue(filters, 'parent_company_id') !== state.child.parentCompanyId) return { data: null, error: null };
      return { data: { id: state.child.id }, error: null };
    }

    if (table === 'instagram_byo_company_credentials') {
      if (state.dbError === 'credentials') {
        return { data: null, error: { message: 'db fixture-secret-not-real', code: 'XX000' } };
      }
      return { data: state.credential, error: null };
    }

    if (table === 'instagram_byo_poc_accounts') {
      if (state.dbError === 'accounts') {
        return { data: null, error: { message: 'db fixture-secret-not-real', code: 'XX000' } };
      }
      return { data: state.accounts, error: null };
    }

    return { data: null, error: { message: 'tabela inesperada' } };
  }

  function from(table) {
    const filters = [];
    const query = {
      _fields: '',
      select(fields) {
        query._fields = fields;
        return query;
      },
      eq(column, value) {
        filters.push(['eq', column, value]);
        return query;
      },
      in(column, value) {
        filters.push(['in', column, value]);
        return query;
      },
      insert() {
        calls.push({ table, op: 'insert' });
        return query;
      },
      update() {
        calls.push({ table, op: 'update' });
        return query;
      },
      delete() {
        calls.push({ table, op: 'delete' });
        return query;
      },
      maybeSingle() {
        calls.push({ table, op: 'maybeSingle', filters: filters.map((item) => [...item]), fields: query._fields });
        return Promise.resolve(resolve(table, filters));
      },
      then(onFulfilled, onRejected) {
        calls.push({ table, op: 'list', filters: filters.map((item) => [...item]), fields: query._fields });
        return Promise.resolve(resolve(table, filters)).then(onFulfilled, onRejected);
      },
    };
    return query;
  }

  const client = {
    auth: {
      getUser: vi.fn(async () => {
        if (!state.user) return { data: { user: null }, error: { message: 'invalid' } };
        return { data: { user: state.user }, error: null };
      }),
    },
    from,
  };

  return { state, calls, client };
});

vi.mock('../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => client,
}));

import handler from '../status.js';

const ALLOWED_COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const OTHER_COMPANY = 'dddddddd-0000-4000-8000-000000000004';
const PARENT_OK = 'aaaaaaaa-0000-4000-8000-000000000001';
const PARENT_OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';
const FIXTURE_SECRET = 'fixture-secret-not-real';

const OFFICIAL_TABLES = [
  'instagram_connections',
  'instagram_company_settings',
  'instagram_conversations',
  'instagram_messages',
  'instagram_comments',
  'instagram_webhook_events',
  'instagram_audit_logs',
];

const ENV_KEYS = [
  'INSTAGRAM_BYO_APP_ID',
  'INSTAGRAM_BYO_APP_SECRET',
  'INSTAGRAM_BYO_TOKEN_ENC_KEY_V1',
];

let saved;

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

function arm() {
  delete process.env.INSTAGRAM_BYO_POC_ENABLED;
  delete process.env.INSTAGRAM_BYO_ALLOWED_COMPANY_ID;
  delete process.env.INSTAGRAM_BYO_ALLOWED_VERCEL_PROJECT_ID;
}

function resetState() {
  state.user = { id: 'user-1' };
  state.direct = null;
  state.parent = null;
  state.assignment = null;
  state.child = { id: ALLOWED_COMPANY, parentCompanyId: PARENT_OK };
  state.credential = null;
  state.accounts = [];
  state.dbError = null;
}

function request(companyId = ALLOWED_COMPANY, headers = { authorization: 'Bearer test-token' }) {
  return { method: 'GET', query: { company_id: companyId }, headers };
}

function assertOfficialUntouched() {
  expect(calls.some((call) => OFFICIAL_TABLES.includes(call.table))).toBe(false);
  expect(calls.some((call) => call.op === 'insert' || call.op === 'update' || call.op === 'delete')).toBe(false);
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  calls.length = 0;
  client.auth.getUser.mockClear();
  resetState();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('GET /api/instagram/byo-poc/status', () => {
  it('segue para a autorização sem flag, projeto ou empresa fixa', async () => {
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('Acesso negado a esta empresa');
    expect(client.auth.getUser).toHaveBeenCalled();
    expect(calls.some((call) => call.table === 'instagram_byo_company_credentials')).toBe(false);
    assertOfficialUntouched();
  });

  it('libera outra empresa para o admin vinculado e filtra o company_id', async () => {
    arm();
    state.direct = { role: 'admin', companyId: OTHER_COMPANY };
    state.credential = {
      meta_app_id: '12345',
      validation_status: 'saved',
      validation_error_code: null,
      validated_at: null,
      revoked_at: null,
      credential_version: 2,
      app_secret_enc: FIXTURE_SECRET,
      suat_enc: FIXTURE_SECRET,
    };
    const res = response();
    await handler(request(OTHER_COMPANY), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.company_id).toBe(OTHER_COMPANY);
    expect(JSON.stringify(res.body)).not.toContain(FIXTURE_SECRET);
    expect(JSON.stringify(res.body)).not.toContain('app_secret');
    expect(JSON.stringify(res.body)).not.toContain('suat');
    const credentialRead = calls.find((call) => call.table === 'instagram_byo_company_credentials');
    expect(credentialRead.filters).toContainEqual(['eq', 'company_id', OTHER_COMPANY]);
  });

  it('nega usuário sem vínculo na empresa pedida sem ler credenciais', async () => {
    arm();
    state.direct = { role: 'admin', companyId: ALLOWED_COMPANY };
    const res = response();
    await handler(request(OTHER_COMPANY), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('Acesso negado a esta empresa');
    expect(calls.some((call) => call.table === 'instagram_byo_company_credentials')).toBe(false);
    expect(calls.some((call) => call.table === 'instagram_byo_poc_accounts')).toBe(false);
    assertOfficialUntouched();
  });

  it('nega usuário não autenticado', async () => {
    arm();
    const res = response();
    await handler(request(ALLOWED_COMPANY, {}), res);
    expect(res.statusCode).toBe(401);
    expect(client.auth.getUser).not.toHaveBeenCalled();
    assertOfficialUntouched();
  });

  it('nega seller membro da empresa autorizada', async () => {
    arm();
    state.direct = { role: 'seller', companyId: ALLOWED_COMPANY };
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('Permissão insuficiente para esta operação');
    expect(calls.some((call) => call.table === 'instagram_byo_poc_accounts')).toBe(false);
    expect(calls.some((call) => call.table === 'instagram_byo_company_credentials')).toBe(false);
    assertOfficialUntouched();
  });

  it('nega JWT inválido', async () => {
    arm();
    state.user = null;
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Sessão inválida ou expirada');
    expect(calls.some((call) => call.table === 'instagram_byo_company_credentials')).toBe(false);
    assertOfficialUntouched();
  });

  it('permite manager e descreve a ausência de credenciais', async () => {
    arm();
    state.direct = { role: 'manager', companyId: ALLOWED_COMPANY };
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(res.body.credentials).toEqual({
      configured: false,
      validation_status: 'not_configured',
      meta_app_id: null,
      validated_at: null,
      revoked_at: null,
      credential_version: null,
      validation_error_code: null,
      webhook_route_id: null,
      webhook_enabled: false,
      webhook_verify_configured: false,
    });
    expect(res.body.account_status).toBe('not_connected');
    const read = calls.find((call) => call.table === 'instagram_byo_company_credentials');
    expect(read.op).toBe('maybeSingle');
    expect(read.filters).toContainEqual(['eq', 'company_id', ALLOWED_COMPANY]);
    expect(read.fields).not.toContain('app_secret_enc');
    expect(read.fields).not.toContain('suat_enc');
    assertOfficialUntouched();
  });

  it('nega partner sem assignment ativo', async () => {
    arm();
    state.direct = { role: 'partner', companyId: ALLOWED_COMPANY };
    state.assignment = null;
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('Partner sem assignment ativo para esta empresa');
    expect(calls.some((call) => call.table === 'partner_company_assignments')).toBe(true);
    assertOfficialUntouched();
  });

  it('permite partner com assignment ativo na empresa autorizada', async () => {
    arm();
    state.direct = { role: 'partner', companyId: ALLOWED_COMPANY };
    state.assignment = { id: 'assignment-1', companyId: ALLOWED_COMPANY };
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(200);
    const assignment = calls.find((call) => call.table === 'partner_company_assignments');
    expect(assignment.filters).toContainEqual(['eq', 'company_id', ALLOWED_COMPANY]);
    expect(assignment.filters).toContainEqual(['eq', 'is_active', true]);
    assertOfficialUntouched();
  });

  it('permite super_admin da empresa pai correta', async () => {
    arm();
    state.parent = {
      role: 'super_admin',
      company_id: PARENT_OK,
      companies: { company_type: 'parent' },
    };
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(200);
    const childLookup = calls.find((call) => call.table === 'companies');
    expect(childLookup.filters).toContainEqual(['eq', 'id', ALLOWED_COMPANY]);
    expect(childLookup.filters).toContainEqual(['eq', 'parent_company_id', PARENT_OK]);
    assertOfficialUntouched();
  });

  it('nega system_admin de outra empresa pai', async () => {
    arm();
    state.parent = {
      role: 'system_admin',
      company_id: PARENT_OTHER,
      companies: { company_type: 'parent' },
    };
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('Empresa não encontrada ou sem acesso');
    expect(calls.some((call) => call.table === 'instagram_byo_poc_accounts')).toBe(false);
    assertOfficialUntouched();
  });

  it('nega super_admin cuja membership elevada não é da empresa pai', async () => {
    arm();
    state.parent = {
      role: 'super_admin',
      company_id: OTHER_COMPANY,
      companies: { company_type: 'client' },
    };
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(403);
    expect(calls.some((call) => call.table === 'companies')).toBe(false);
    assertOfficialUntouched();
  });

  it('nega system_admin sem nenhuma membership elevada', async () => {
    arm();
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('Acesso negado a esta empresa');
    assertOfficialUntouched();
  });

  it('não devolve indicadores de credencial e não toca tabelas oficiais', async () => {
    arm();
    process.env.INSTAGRAM_BYO_APP_ID = '111111111111111';
    process.env.INSTAGRAM_BYO_APP_SECRET = FIXTURE_SECRET;
    process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1 = 'aa'.repeat(32);
    state.direct = { role: 'admin', companyId: ALLOWED_COMPANY };
    const res = response();
    await handler(request(), res);

    expect(res.statusCode).toBe(200);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(FIXTURE_SECRET);
    expect(serialized).not.toContain('app_id_configured');
    expect(serialized).not.toContain('app_secret_configured');
    expect(serialized).not.toContain('token_key_configured');
    expect(res.body.configuration).toBeUndefined();
    expect(res.body.credentials.validation_status).toBe('not_configured');
    expect(res.body.account_status).toBe('not_connected');
    expect(res.headers['Cache-Control']).toBe('private, no-store');

    const read = calls.find((call) => call.table === 'instagram_byo_poc_accounts');
    expect(read.op).toBe('list');
    expect(read.fields).not.toContain('access_token_enc');
    expect(read.filters).toContainEqual(['eq', 'company_id', ALLOWED_COMPANY]);
    expect(calls.filter((call) => call.table === 'instagram_byo_poc_accounts')).toHaveLength(1);
    assertOfficialUntouched();
  });

  it.each([
    ['saved', null, false],
    ['pending', null, false],
    ['valid', '2026-10-29T18:00:00.000Z', false],
    ['failed', null, true],
    ['revoked', null, false],
  ])('expõe o estado %s sem ciphertext', async (validationStatus, validatedAt, withError) => {
    arm();
    state.direct = { role: 'admin', companyId: ALLOWED_COMPANY };
    state.credential = {
      meta_app_id: '123456789012345',
      validation_status: validationStatus,
      validation_error_code: withError ? 'meta_rejected' : 'should-not-leave-failed',
      validated_at: validatedAt,
      revoked_at: validationStatus === 'revoked' ? '2026-10-29T18:05:00.000Z' : null,
      credential_version: 2,
      app_secret_enc: 'byo1:fixture-secret-not-real',
      suat_enc: 'byo1:fixture-suat-not-real',
      webhook_route_id: 'ab'.repeat(32),
      webhook_enabled: true,
      webhook_verify_token_hash: 'cd'.repeat(32),
    };
    const res = response();
    await handler(request(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.credentials.validation_status).toBe(validationStatus);
    expect(res.body.credentials.configured).toBe(validationStatus !== 'revoked');
    expect(res.body.credentials.meta_app_id).toBe('123456789012345');
    expect(res.body.credentials.validated_at).toBe(validatedAt);
    expect(res.body.credentials.validation_error_code).toBe(withError ? 'meta_rejected' : null);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('byo1:');
    expect(serialized).not.toContain('fixture-secret-not-real');
    expect(serialized).not.toContain('fixture-suat-not-real');
    expect(serialized).not.toContain('app_secret_enc');
    expect(serialized).not.toContain('suat_enc');
    expect(serialized).not.toContain('webhook_verify_token_hash');
    expect(serialized).not.toContain('"webhook_verify_token"');
    expect(serialized).not.toContain('cd'.repeat(32));
    expect(res.body.credentials.webhook_verify_configured).toBe(true);
  });

  it.each([
    [[], 'not_connected'],
    [[{ status: 'poc_disabled' }], 'poc_disabled'],
    [[{ status: 'poc_disabled' }, { status: 'poc_enabled' }], 'poc_enabled'],
  ])('resume a conta BYO como %j', async (accounts, accountStatus) => {
    arm();
    state.direct = { role: 'admin', companyId: ALLOWED_COMPANY };
    state.accounts = accounts;
    const res = response();
    await handler(request(), res);
    expect(res.body.account_status).toBe(accountStatus);
    expect(res.body.accounts).toEqual(accounts);
  });

  it('não vaza o erro do banco de credenciais', async () => {
    arm();
    state.direct = { role: 'admin', companyId: ALLOWED_COMPANY };
    state.dbError = 'credentials';
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'unavailable' });
    expect(JSON.stringify(res.body)).not.toContain('fixture-secret-not-real');
    expect(calls.some((call) => call.table === 'instagram_byo_poc_accounts')).toBe(false);
    assertOfficialUntouched();
  });

  it('não vaza o erro do banco de contas', async () => {
    arm();
    state.direct = { role: 'admin', companyId: ALLOWED_COMPANY };
    state.dbError = 'accounts';
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'unavailable' });
    expect(JSON.stringify(res.body)).not.toContain('fixture-secret-not-real');
    assertOfficialUntouched();
  });
});
