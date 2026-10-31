import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const OTHER = 'dddddddd-0000-4000-8000-000000000004';
const CONNECTION = '11111111-1111-4111-8111-111111111111';
const FOREIGN_CONNECTION = '33333333-3333-4333-8333-333333333333';
const BYO = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '17841400000000001';
const USER = '99999999-9999-4999-8999-999999999999';
const SECRET = 'ciphertext-must-not-leak';

const { state } = vi.hoisted(() => ({
  state: {
    auth: { ok: true, userId: '99999999-9999-4999-8999-999999999999', role: 'admin' },
    readAuth: { ok: true, userId: '99999999-9999-4999-8999-999999999999', role: 'admin' },
    adminThrows: false,
    rpc: { data: { ok: true, reason: 'switched', target_mode: 'byo', moved_count: 2 }, error: null },
    rows: {},
  },
}));

vi.mock('../instagramModalityAuth.js', () => ({
  authorizeInstagramModalitySwitch: vi.fn(async () => state.auth),
}));

vi.mock('../validateInstagramCaller.js', () => ({
  validateInstagramCaller: vi.fn(async () => state.readAuth),
}));

vi.mock('../../automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => {
    if (state.adminThrows) throw new Error(SECRET);
    return state.svc;
  },
}));

import { authorizeInstagramModalitySwitch } from '../instagramModalityAuth.js';
import { handleInstagramModality } from '../instagramModalityHttp.js';

function chain(rows) {
  const filters = [];
  const builder = {
    select(columns) {
      state.selects.push(columns);
      return builder;
    },
    eq(column, value) {
      filters.push((row) => row[column] === value);
      return builder;
    },
    not(column, operator, value) {
      if (operator === 'is' && value === null) filters.push((row) => row[column] != null);
      return builder;
    },
    neq(column, value) {
      filters.push((row) => row[column] !== value);
      return builder;
    },
    maybeSingle: async () => ({
      data: rows.find((row) => filters.every((filter) => filter(row))) ?? null,
      error: null,
    }),
    then(resolve, reject) {
      const data = rows.filter((row) => filters.every((filter) => filter(row)));
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

function response() {
  return {
    statusCode: 200,
    body: null,
    setHeader() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function post(body, extra = {}) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json', ...extra },
    body,
  };
}

function readyBody(overrides = {}) {
  return {
    company_id: COMPANY,
    instagram_account_id: ACCOUNT,
    target_mode: 'byo',
    official_connection_id: CONNECTION,
    byo_account_id: BYO,
    confirmed: true,
    ...overrides,
  };
}

describe('handleInstagramModality', () => {
  const originalFlag = process.env.INSTAGRAM_MODALITY_SWITCH_ENABLED;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.INSTAGRAM_MODALITY_SWITCH_ENABLED;
    else process.env.INSTAGRAM_MODALITY_SWITCH_ENABLED = originalFlag;
  });

  beforeEach(() => {
    process.env.INSTAGRAM_MODALITY_SWITCH_ENABLED = 'true';
    state.auth = { ok: true, userId: USER, role: 'admin' };
    state.readAuth = { ok: true, userId: USER, role: 'manager' };
    state.adminThrows = false;
    state.rpc = { data: { ok: true, reason: 'switched', target_mode: 'byo', moved_count: 2 }, error: null };
    state.calls = [];
    state.selects = [];
    state.rows = {
      companies: [{ id: COMPANY, status: 'active', deleted_at: null }],
      instagram_connections: [{
        id: CONNECTION,
        company_id: COMPANY,
        status: 'revoked',
        instagram_username: 'conta',
        instagram_user_id: '999',
        ig_webhook_id: ACCOUNT,
      }],
      instagram_byo_poc_accounts: [{
        id: BYO,
        company_id: COMPANY,
        instagram_account_id: ACCOUNT,
        instagram_username: 'conta',
        status: 'poc_disabled',
        status_reason: null,
        direct_ingest_enabled: false,
      }],
      instagram_account_operations: [],
      instagram_byo_company_credentials: [{
        company_id: COMPANY,
        validation_status: 'valid',
        webhook_enabled: false,
        webhook_route_id: null,
        webhook_verify_token_hash: null,
        app_secret_enc: SECRET,
        suat_enc: SECRET,
      }],
    };
    state.svc = {
      from(table) { return chain(state.rows[table] ?? []); },
      rpc: async (name, params) => {
        state.calls.push({ name, params });
        return state.rpc;
      },
    };
  });

  it('não menciona WhatsApp nem atualiza conversas direto', () => {
    const source = readFileSync(resolve('api/lib/instagram/instagramModalityHttp.js'), 'utf8');
    expect(source.toLowerCase()).not.toContain('whatsapp');
    expect(source).not.toContain('instagram_conversations');
    expect(source).toContain("rpc('switch_instagram_account_modality'");
    expect(source).toContain('p_actor_id: auth.userId');
    expect(source).not.toContain('body.actor_id');
    expect(source).not.toContain('body.p_actor_id');
    expect(source).toContain('INSTAGRAM_MODALITY_SWITCH_ENABLED');
    expect(source).not.toContain('.update(');
    expect(source).not.toContain('.insert(');
  });

  it('recusa leitura sem autenticação', async () => {
    state.readAuth = { ok: false, status: 401, error: 'Autenticação necessária' };
    const res = response();
    await handleInstagramModality({
      method: 'GET',
      query: { company_id: COMPANY },
      headers: {},
    }, res);
    expect(res.statusCode).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it('recusa quem não pertence à empresa', async () => {
    state.auth = { ok: false, status: 403, error: 'Acesso negado a esta empresa' };
    const res = response();
    await handleInstagramModality(post(readyBody({ company_id: OTHER })), res);
    expect(res.statusCode).toBe(403);
    expect(authorizeInstagramModalitySwitch).toHaveBeenCalledWith(expect.anything(), state.svc, OTHER);
    expect(state.calls).toEqual([]);
  });

  it('recusa papel não autorizado', async () => {
    state.auth = { ok: false, status: 403, error: 'Permissão insuficiente para esta operação' };
    const res = response();
    await handleInstagramModality(post(readyBody()), res);
    expect(res.statusCode).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it('recusa conexão de outra empresa e conexão incompatível sem chamar a RPC', async () => {
    const foreign = response();
    await handleInstagramModality(post(readyBody({ official_connection_id: FOREIGN_CONNECTION })), foreign);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body.error).toBe('company_mismatch');

    state.rows.instagram_connections[0].ig_webhook_id = '17841400000000002';
    state.rows.instagram_connections[0].instagram_user_id = '17841400000000003';
    const mismatch = response();
    await handleInstagramModality(post(readyBody()), mismatch);
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.body.error).toBe('identity_mismatch');
    expect(state.calls).toEqual([]);
  });

  it('devolve o bloqueio da RPC quando o destino BYO não está pronto', async () => {
    state.rpc = { data: { ok: false, reason: 'destination_not_ready' }, error: null };
    const res = response();
    await handleInstagramModality(post(readyBody()), res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'destination_not_ready' });
    expect(state.calls[0].name).toBe('switch_instagram_account_modality');
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('exige confirmação e rejeita ator ou conversa enviados pelo cliente', async () => {
    const missing = response();
    await handleInstagramModality(post(readyBody({ confirmed: false })), missing);
    expect(missing.statusCode).toBe(400);
    expect(missing.body.error).toBe('confirmation_required');

    const actor = response();
    await handleInstagramModality(post(readyBody({ p_actor_id: OTHER })), actor);
    expect(actor.statusCode).toBe(400);
    expect(actor.body.error).toBe('rejected');

    const thread = response();
    await handleInstagramModality(post(readyBody({ conversation_id: OTHER })), thread);
    expect(thread.body.error).toBe('rejected');
    expect(state.calls).toEqual([]);
  });

  it('trata a segunda chamada já aplicada como idempotente', async () => {
    const first = response();
    await handleInstagramModality(post(readyBody()), first);
    state.rpc = { data: { ok: true, reason: 'already_applied', target_mode: 'byo', moved_count: 0 }, error: null };
    const second = response();
    await handleInstagramModality(post(readyBody()), second);
    expect(first.body).toMatchObject({ ok: true, reason: 'switched', moved_count: 2 });
    expect(second.body).toMatchObject({ ok: true, reason: 'already_applied', moved_count: 0 });
    expect(state.calls).toHaveLength(2);
    expect(state.calls[1].params.p_actor_id).toBe(USER);
  });

  it('oculta erro interno da RPC', async () => {
    state.rpc = { data: null, error: { message: SECRET } };
    const res = response();
    await handleInstagramModality(post(readyBody()), res);
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('mostra o oficial como modalidade atual quando não há registro', async () => {
    const res = response();
    await handleInstagramModality({
      method: 'GET',
      query: { company_id: COMPANY },
      headers: { authorization: 'Bearer token' },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.switch_available).toBe(true);
    expect(res.body.accounts[0]).toMatchObject({
      operational_mode: 'official',
      mode_registered: false,
      mode_basis: 'compatibility',
      official_receive_supported: false,
      direct_ingest_enabled: false,
      send_supported: false,
      byo_send_supported: false,
    });
    expect(res.body.accounts[0].targets.byo.block_reason).toBe('destination_not_ready');
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain('INSTAGRAM_');
    expect(state.selects.join(' ')).not.toContain('app_secret_enc');
    expect(state.selects.join(' ')).not.toContain('suat_enc');
    expect(state.calls).toEqual([]);
  });

  it('informa a troca desligada no GET e não altera a modalidade', async () => {
    delete process.env.INSTAGRAM_MODALITY_SWITCH_ENABLED;
    const missing = response();
    await handleInstagramModality({
      method: 'GET',
      query: { company_id: COMPANY },
      headers: { authorization: 'Bearer token' },
    }, missing);
    expect(missing.body.switch_available).toBe(false);
    expect(missing.body.accounts[0].operational_mode).toBe('official');

    process.env.INSTAGRAM_MODALITY_SWITCH_ENABLED = 'false';
    const disabled = response();
    await handleInstagramModality({
      method: 'GET',
      query: { company_id: COMPANY },
      headers: { authorization: 'Bearer token' },
    }, disabled);
    expect(disabled.body.switch_available).toBe(false);
    expect(state.calls).toEqual([]);
  });

  it('recusa o POST quando a flag não é a string true e mantém a autorização', async () => {
    state.auth = { ok: false, status: 403, error: 'Permissão insuficiente para esta operação' };
    delete process.env.INSTAGRAM_MODALITY_SWITCH_ENABLED;
    const denied = response();
    await handleInstagramModality(post(readyBody()), denied);
    expect(denied.statusCode).toBe(403);
    expect(state.calls).toEqual([]);

    state.auth = { ok: true, userId: USER, role: 'admin' };
    for (const value of [undefined, 'false', 'TRUE', '1', ' true ']) {
      if (value === undefined) delete process.env.INSTAGRAM_MODALITY_SWITCH_ENABLED;
      else process.env.INSTAGRAM_MODALITY_SWITCH_ENABLED = value;
      const res = response();
      await handleInstagramModality(post(readyBody()), res);
      expect(res.statusCode).toBe(409);
      expect(res.body).toEqual({ error: 'modality_switch_disabled' });
    }
    expect(state.calls).toEqual([]);

    process.env.INSTAGRAM_MODALITY_SWITCH_ENABLED = 'true';
    const enabled = response();
    await handleInstagramModality(post(readyBody()), enabled);
    expect(enabled.body.reason).toBe('switched');
    expect(state.calls).toHaveLength(1);
  });

  it('mostra recebimento oficial quando a conexão active não tem registro', async () => {
    state.rows.instagram_connections[0].status = 'active';
    const res = response();
    await handleInstagramModality({
      method: 'GET',
      query: { company_id: COMPANY },
      headers: { authorization: 'Bearer token' },
    }, res);
    expect(res.body.accounts[0]).toMatchObject({
      operational_mode: 'official',
      mode_registered: false,
      mode_basis: 'compatibility',
      official_receive_supported: true,
      send_supported: true,
    });
    expect(res.body.accounts[0].official_connection.id).toBe(CONNECTION);
    expect(state.calls).toEqual([]);
  });

  it('trata dois POSTs simultâneos como uma troca e uma repetição idempotente', async () => {
    let applied = false;
    state.svc.rpc = async (name, params) => {
      state.calls.push({ name, params });
      if (applied) {
        return { data: { ok: true, reason: 'already_applied', target_mode: 'byo', moved_count: 0 }, error: null };
      }
      applied = true;
      await Promise.resolve();
      return { data: { ok: true, reason: 'switched', target_mode: 'byo', moved_count: 2 }, error: null };
    };

    const first = response();
    const second = response();
    await Promise.all([
      handleInstagramModality(post(readyBody()), first),
      handleInstagramModality(post(readyBody()), second),
    ]);

    const reasons = [first.body.reason, second.body.reason].sort();
    expect(reasons).toEqual(['already_applied', 'switched']);
    expect(first.body.moved_count + second.body.moved_count).toBe(2);
    expect(state.calls).toHaveLength(2);
    expect(state.calls.every((call) => call.params.p_actor_id === USER)).toBe(true);
    expect(JSON.stringify(first.body) + JSON.stringify(second.body)).not.toContain(SECRET);
  });

  it('não deixa a concorrência ignorar a autorização nem vazar erro interno', async () => {
    state.auth = { ok: false, status: 403, error: 'Permissão insuficiente para esta operação' };
    const denied = [response(), response()];
    await Promise.all(denied.map((res) => handleInstagramModality(post(readyBody()), res)));
    expect(denied.map((res) => res.statusCode)).toEqual([403, 403]);
    expect(denied.every((res) => res.body.error === 'Permissão insuficiente para esta operação')).toBe(true);
    expect(state.calls).toEqual([]);

    state.auth = { ok: true, userId: USER, role: 'admin' };
    state.svc.rpc = async () => ({ data: null, error: { message: SECRET } });
    const failed = [response(), response()];
    await Promise.all(failed.map((res) => handleInstagramModality(post(readyBody()), res)));
    expect(failed.map((res) => res.statusCode)).toEqual([503, 503]);
    expect(JSON.stringify(failed.map((res) => res.body))).not.toContain(SECRET);
  });
});
