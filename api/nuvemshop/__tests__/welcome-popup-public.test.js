import { afterEach, describe, expect, it, vi } from 'vitest';

const { adminState } = vi.hoisted(() => ({ adminState: { client: null } }));

vi.mock('../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => {
    if (!adminState.client) throw new Error('sem cliente nesta prova');
    return adminState.client;
  },
}));

import handler from '../welcome-popup/public.js';

const COMPANY = '3cbe5c11-d834-40d1-b1cf-425e6377f099';
const ATTEMPT = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'https://valleron.store';

function response(initial = {}) {
  const store = new Map();
  for (const [name, value] of Object.entries(initial)) store.set(name.toLowerCase(), value);
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(name, value) { store.set(String(name).toLowerCase(), value); return this; },
    getHeader(name) { return store.get(String(name).toLowerCase()); },
  };
}

function campaignAdmin(options = {}) {
  const calls = { rpc: 0 };
  const campaign = {
    id: '11111111-1111-4111-8111-111111111111',
    enabled: true,
    title: 'Bem-vindo',
    description: 'Primeira compra',
    image_url: null,
    button_label: 'Quero',
    background_color: '#ffffff',
    text_color: '#111111',
    button_color: '#000000',
    consent_text: 'Aceito receber o cupom',
    consent_version: '2026-11',
    promo_consent_text: null,
    promo_consent_version: null,
    coupon_code: 'CUPOM10',
    delay_seconds: 10,
    resurface_days: 7,
    allowed_origins: [ORIGIN],
  };
  return {
    calls,
    from(table) {
      const filters = [];
      const api = {
        select() { return api; },
        eq(column, value) { filters.push([column, value]); return api; },
        maybeSingle: async () => (
          table === 'nuvemshop_welcome_campaigns'
            ? { data: campaign, error: null }
            : { data: null, error: null }
        ),
        then(onOk, onFail) {
          const rows = table === 'nuvemshop_connections'
            ? [{ company_id: COMPANY, nuvemshop_store_id: '7680914', status: 'active' }]
            : [];
          const matched = rows.filter((row) => filters.every(([column, value]) => row[column] === value));
          return Promise.resolve({ data: matched, error: null }).then(onOk, onFail);
        },
      };
      return api;
    },
    rpc: options.rpc ?? (async () => {
      calls.rpc += 1;
      return { data: null, error: { message: 'nao deveria gravar' } };
    }),
  };
}

function post(body, extra = {}) {
  return {
    method: 'POST',
    headers: { origin: ORIGIN },
    query: { store_id: '7680914' },
    body: {
      store_id: '7680914',
      attempt_id: ATTEMPT,
      name: 'Ana',
      email: 'ana@valleron.store',
      phone: '11999999999',
      coupon_consent: true,
      ...body,
    },
    ...extra,
  };
}

function expectCors(res, origin = ORIGIN) {
  expect(res.getHeader('access-control-allow-origin')).toBe(origin);
  expect(res.getHeader('access-control-allow-origin')).not.toBe('*');
  expect(res.getHeader('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
  expect(res.getHeader('access-control-allow-headers')).toBe('Content-Type');
}

afterEach(() => {
  adminState.client = null;
});

describe('cadastro público', () => {
  it('recusa GET e POST sem gravar, mesmo com corpo pedindo ativação', async () => {
    const get = response();
    const post = response();

    await handler({ method: 'GET', query: { store_id: '7680914', enabled: 'true' } }, get);
    await handler({
      method: 'POST',
      body: { store_id: '7680914', enabled: true, email: 'teste@valleron.store' },
    }, post);

    expect(get.statusCode).toBe(409);
    expect(post.statusCode).toBe(409);
    expect(get.body.code).toBe('publication_blocked');
    expect(post.body.code).toBe('publication_blocked');
    expect(JSON.stringify(post.body)).not.toMatch(/BEMVINDO10|company_id/);
    expect(get.getHeader('access-control-allow-origin')).toBeUndefined();
    expect(post.getHeader('access-control-allow-origin')).toBeUndefined();
  });

  it('ecoa a origem autorizada no sucesso e nos erros, sem curinga', async () => {
    adminState.client = campaignAdmin({
      rpc: async () => {
        adminState.client.calls.rpc += 1;
        return {
          data: {
            ok: true,
            repeated: false,
            grantCreated: true,
            signup: {
              id: 'signup-1',
              identity_result: 'reuse',
              eligibility_result: 'eligible_limited',
              nuvemshop_store_id: '7680914',
              campaign_id: '11111111-1111-4111-8111-111111111111',
              limitation_note: null,
            },
            grant: {
              coupon_code: 'CUPOM10',
              apply_url: 'https://valleron.store/discount/CUPOM10?redirect_to=/',
            },
          },
          error: null,
        };
      },
    });
    const ok = response({ Vary: 'Accept-Encoding' });
    await handler({
      method: 'GET',
      headers: { origin: ORIGIN },
      query: { store_id: '7680914' },
    }, ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.config.coupon_code).toBeUndefined();
    expectCors(ok);
    expect(ok.getHeader('vary')).toBe('Accept-Encoding, Origin');

    const conflictRes = response({ Vary: 'Accept-Encoding, Origin' });
    adminState.client.rpc = async () => {
      adminState.client.calls.rpc += 1;
      return {
        data: {
          ok: true,
          signup: { identity_result: 'conflict' },
          grant: null,
        },
        error: null,
      };
    };
    await handler(post({
      attempt_id: '33333333-3333-4333-8333-333333333333',
      email: 'conflito@valleron.store',
    }), conflictRes);
    expect(conflictRes.statusCode).toBe(200);
    expect(conflictRes.body.code).toBe('identity_conflict');
    expectCors(conflictRes);
    expect(conflictRes.getHeader('vary')).toBe('Accept-Encoding, Origin');

    const invalid = response({ Vary: 'Accept-Encoding' });
    const beforeRpc = adminState.client.calls.rpc;
    await handler(post({ email: 'sem-dominio', coupon_consent: false }), invalid);
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body.code).toBe('validation_error');
    expect(invalid.body.coupon_revealed).toBe(false);
    expect(adminState.client.calls.rpc).toBe(beforeRpc);
    expectCors(invalid);
    expect(invalid.getHeader('vary')).toBe('Accept-Encoding, Origin');

    const limited = response();
    adminState.client.rpc = async () => {
      throw new Error('muitas tentativas simuladas');
    };
    await handler(post({
      attempt_id: '44444444-4444-4444-8444-444444444444',
      email: 'limite@valleron.store',
    }, { ip: '198.51.100.9' }), limited);
    expect(limited.statusCode).toBe(503);
    expect(limited.body.code).toBe('signup_unavailable');
    expect(JSON.stringify(limited.body)).not.toMatch(/simuladas|limite@/);
    expectCors(limited);
    expect(limited.getHeader('vary')).toBe('Origin');

    const preflight = response({ Vary: 'Accept-Encoding' });
    await handler({
      method: 'OPTIONS',
      headers: { origin: ORIGIN },
      query: { store_id: '7680914' },
    }, preflight);
    expect(preflight.statusCode).toBe(200);
    expectCors(preflight);
    expect(preflight.getHeader('vary')).toBe('Accept-Encoding, Origin');
  });

  it('mantém o eco da origem autorizada quando o limite de tentativas responde', async () => {
    adminState.client = campaignAdmin();
    const attempts = [
      '55555555-5555-4555-8555-555555555551',
      '55555555-5555-4555-8555-555555555552',
      '55555555-5555-4555-8555-555555555553',
      '55555555-5555-4555-8555-555555555554',
      '55555555-5555-4555-8555-555555555555',
      '55555555-5555-4555-8555-555555555556',
    ];
    let blocked = null;
    for (const attemptId of attempts) {
      const res = response({ Vary: 'Accept-Encoding' });
      await handler(post({
        attempt_id: attemptId,
        email: 'taxa@valleron.store',
      }), res);
      if (res.statusCode === 429) blocked = res;
    }
    expect(blocked).not.toBeNull();
    expect(blocked.body.code).toBe('rate_limited');
    expect(blocked.body.coupon_revealed).toBe(false);
    expectCors(blocked);
    expect(blocked.getHeader('vary')).toBe('Accept-Encoding, Origin');
    expect(adminState.client.calls.rpc).toBe(5);
    expect(JSON.stringify(blocked.body)).not.toMatch(/taxa@|11999999999/);
  });

  it('não ecoa origem ausente ou recusada e preserva o Vary existente', async () => {
    adminState.client = campaignAdmin();
    const rejected = response({ Vary: 'Accept-Encoding' });
    await handler(post({}, { headers: { origin: 'https://evil.example' } }), rejected);
    expect(rejected.statusCode).toBe(403);
    expect(rejected.body.code).toBe('origin_not_allowed');
    expect(rejected.getHeader('access-control-allow-origin')).toBeUndefined();
    expect(rejected.getHeader('vary')).toBe('Accept-Encoding');
    expect(adminState.client.calls.rpc).toBe(0);

    const missing = response({ Vary: 'Accept-Encoding' });
    await handler(post({}, { headers: {} }), missing);
    expect(missing.statusCode).toBe(403);
    expect(missing.body.code).toBe('origin_not_allowed');
    expect(missing.getHeader('access-control-allow-origin')).toBeUndefined();
    expect(missing.getHeader('vary')).toBe('Accept-Encoding');

    const exploded = response({ Vary: 'Accept-Encoding' });
    adminState.client.from = () => { throw new Error('loja fora'); };
    await handler(post(), exploded);
    expect(exploded.statusCode).toBe(503);
    expect(exploded.body.code).toBe('signup_unavailable');
    expect(exploded.getHeader('access-control-allow-origin')).toBeUndefined();
    expect(exploded.getHeader('vary')).toBe('Accept-Encoding');
  });
});
