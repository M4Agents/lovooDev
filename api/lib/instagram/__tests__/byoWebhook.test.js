import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyByoWebhookPayload,
  createWebhookSecret,
  hashWebhookVerifyToken,
  verifyTokenMatches,
  WEBHOOK_BODY_LIMIT,
} from '../byoWebhook.js';

vi.mock('../../automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('../byoTokenCrypto.js', () => ({
  decryptByoSecret: vi.fn(),
}));

vi.mock('../byoCredentialAuth.js', () => ({
  authorizeByoCredentialWrite: vi.fn(),
}));

import { getSupabaseAdmin } from '../../automation/supabaseAdmin.js';
import { decryptByoSecret } from '../byoTokenCrypto.js';
import { authorizeByoCredentialWrite } from '../byoCredentialAuth.js';
import { handleByoWebhook } from '../byoWebhookHttp.js';
import { handleByoWebhookSetup } from '../byoWebhookSetupHttp.js';

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const OTHER = 'dddddddd-0000-4000-8000-000000000004';
const ROUTE = 'ab'.repeat(32);
const SECRET = 'fixture-app-secret-not-real';
const TOKEN = 'cd'.repeat(32);

function response() {
  return {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function incoming({ method = 'POST', routeId = ROUTE, query = {}, headers = {}, body = '' } = {}) {
  const encoded = Buffer.from(body);
  return {
    method,
    query: { routeId, ...query },
    headers,
    async *[Symbol.asyncIterator]() {
      if (encoded.length > 0) yield encoded;
    },
  };
}

function sign(body) {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
}

function credential(overrides = {}) {
  return {
    company_id: COMPANY,
    validation_status: 'valid',
    webhook_enabled: true,
    webhook_route_id: ROUTE,
    webhook_verify_token_hash: hashWebhookVerifyToken(TOKEN),
    app_secret_enc: 'byo1:ciphertext',
    ...overrides,
  };
}

describe('webhook BYO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decryptByoSecret.mockReturnValue(SECRET);
  });

  it('gera identificador de 32 bytes e compara o hash em tempo constante', () => {
    const route = createWebhookSecret();
    const token = createWebhookSecret();
    expect(route).toMatch(/^[0-9a-f]{64}$/);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyTokenMatches(token, hashWebhookVerifyToken(token))).toBe(true);
    expect(verifyTokenMatches('outro-token', hashWebhookVerifyToken(token))).toBe(false);
    expect(classifyByoWebhookPayload({
      object: 'instagram',
      entry: [{ messaging: [{ message: { mid: 'm1' } }] }],
    })).toBe('dm');
    expect(classifyByoWebhookPayload({
      object: 'instagram',
      entry: [{ changes: [{ field: 'comments' }] }],
    })).toBe('comment');
  });

  it('aceita o GET somente com o token da rota habilitada', async () => {
    getSupabaseAdmin.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: credential(), error: null }),
          }),
        }),
      }),
    });
    const ok = response();
    await handleByoWebhook(incoming({
      method: 'GET',
      query: { 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': 'challenge-1' },
    }), ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('challenge-1');

    getSupabaseAdmin.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: credential(), error: null }),
          }),
        }),
      }),
    });
    const denied = response();
    await handleByoWebhook(incoming({
      method: 'GET',
      query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': 'challenge-1' },
    }), denied);
    expect(denied.statusCode).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain(TOKEN);
  });

  it('aceita POST autenticado sem conta elegível e rejeita HMAC, rota e excesso', async () => {
    const tables = [];
    getSupabaseAdmin.mockReturnValue({
      from: (table) => {
        tables.push(table);
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: table === 'instagram_byo_company_credentials' ? credential() : null, error: null }),
        };
        return query;
      },
      rpc: async () => ({ data: { ok: true, skipped: false, reason: 'persisted' }, error: null }),
    });
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{ id: '17841405822304914', messaging: [{ sender: { id: '9001' }, recipient: { id: '17841405822304914' }, timestamp: 1710000000000, message: { mid: 'm1', text: 'ola' } }] }],
      company_id: OTHER,
    });
    const ok = response();
    await handleByoWebhook(incoming({
      headers: { 'x-hub-signature-256': sign(body) },
      body,
    }), ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toEqual({ ok: true });
    expect(tables).toEqual(['instagram_byo_company_credentials', 'instagram_byo_poc_accounts']);
    expect(decryptByoSecret).toHaveBeenCalledWith('byo1:ciphertext', {
      companyId: COMPANY,
      field: 'app_secret',
    });

    const bad = response();
    await handleByoWebhook(incoming({
      headers: { 'x-hub-signature-256': 'sha256=aa' },
      body,
    }), bad);
    expect(bad.statusCode).toBe(401);

    getSupabaseAdmin.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    });
    const missing = response();
    await handleByoWebhook(incoming({ headers: { 'x-hub-signature-256': sign(body) }, body }), missing);
    expect(missing.statusCode).toBe(404);

    const revoked = response();
    getSupabaseAdmin.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: credential({ validation_status: 'revoked', app_secret_enc: null, webhook_enabled: false }),
              error: null,
            }),
          }),
        }),
      }),
    });
    await handleByoWebhook(incoming({ headers: { 'x-hub-signature-256': sign(body) }, body }), revoked);
    expect(revoked.statusCode).toBe(401);

    const huge = response();
    await handleByoWebhook(incoming({
      headers: { 'content-length': String(WEBHOOK_BODY_LIMIT + 1) },
      body: 'x',
    }), huge);
    expect(huge.statusCode).toBe(413);
    expect(JSON.stringify(ok.body)).not.toContain(SECRET);
    expect(JSON.stringify(ok.body)).not.toContain('ola');
  });

  it('não altera o webhook oficial nem gera rota na migration', () => {
    const official = readFileSync(resolve('api/instagram/webhook.js'), 'utf8');
    const migration = readFileSync(resolve('supabase/migrations/20261030210000_instagram_byo_webhook_route.sql'), 'utf8');
    const handler = readFileSync(resolve('api/lib/instagram/byoWebhookHttp.js'), 'utf8');
    expect(official).not.toContain('webhook_route_id');
    expect(official).not.toContain('byo-poc/webhook');
    expect(handler).not.toContain('instagram_messages');
    expect(handler).not.toContain('instagram_comments');
    expect(handler).toContain("rpc('process_instagram_byo_dm_webhook'");
    expect(handler).not.toContain('process_instagram_dm_webhook');
    expect(handler).not.toContain('process_instagram_comment_webhook');
    expect(handler).not.toContain('direct_ingest_enabled');
    expect(handler).not.toContain('3cbe5c11-d834-40d1-b1cf-425e6377f099');
    expect(handler).not.toContain('graph.facebook.com');
    expect(handler).not.toContain('fetch(');
    expect(migration).not.toContain('UPDATE');
    expect(migration).not.toContain('3cbe5c11-d834-40d1-b1cf-425e6377f099');
    expect(migration).toContain('webhook_enabled BOOLEAN NOT NULL DEFAULT false');
  });
});

describe('configuração do webhook BYO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeByoCredentialWrite.mockResolvedValue({ ok: true, userId: 'user-1', role: 'admin' });
  });

  function clientFor(row, { active = true, updated = row } = {}) {
    return {
      from(table) {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          in() {
            return this;
          },
          is() {
            return this;
          },
          update() {
            return this;
          },
          maybeSingle: async () => {
            if (table === 'companies') {
              return {
                data: active ? { id: COMPANY, status: 'active', deleted_at: null } : { id: COMPANY, status: 'inactive', deleted_at: null },
                error: null,
              };
            }
            if (table === 'instagram_byo_company_credentials' && !updated) {
              return { data: row, error: null };
            }
            return { data: table === 'companies' ? null : (updated ?? row), error: null };
          },
        };
      },
    };
  }

  it('nega partner e empresa inativa antes de gravar segredo', async () => {
    authorizeByoCredentialWrite.mockResolvedValue({ ok: false, status: 403, error: 'forbidden' });
    getSupabaseAdmin.mockReturnValue(clientFor(credential()));
    const denied = response();
    await handleByoWebhookSetup({
      method: 'POST',
      body: { company_id: COMPANY, action: 'generate' },
    }, denied);
    expect(denied.statusCode).toBe(403);

    authorizeByoCredentialWrite.mockResolvedValue({ ok: true, userId: 'user-1', role: 'admin' });
    getSupabaseAdmin.mockReturnValue(clientFor(credential(), { active: false, updated: null }));
    const inactive = response();
    await handleByoWebhookSetup({
      method: 'POST',
      body: { company_id: COMPANY, action: 'generate' },
    }, inactive);
    expect(inactive.statusCode).toBe(403);
    expect(JSON.stringify(inactive.body)).not.toContain(SECRET);
  });

  it('devolve o token só na geração e isola a empresa', async () => {
    const stored = credential({ webhook_route_id: null, webhook_enabled: false, webhook_verify_token_hash: null });
    getSupabaseAdmin.mockReturnValue({
      from(table) {
        let action = 'read';
        const query = {
          select() { return query; },
          eq(column, value) {
            if (column === 'company_id') expect(value).toBe(COMPANY);
            return query;
          },
          in() { return query; },
          is() { return query; },
          update(values) {
            action = 'update';
            expect(values.webhook_verify_token_hash).toMatch(/^[0-9a-f]{64}$/);
            expect(values.webhook_verify_token_hash).not.toBe(values.webhook_route_id);
            expect(values).not.toHaveProperty('app_secret_enc');
            expect(values).not.toHaveProperty('suat_enc');
            return query;
          },
          maybeSingle: async () => {
            if (table === 'companies') return { data: { id: COMPANY, status: 'active', deleted_at: null }, error: null };
            if (action === 'update') return { data: { company_id: COMPANY }, error: null };
            return { data: stored, error: null };
          },
        };
        return query;
      },
    });
    const res = response();
    await handleByoWebhookSetup({
      method: 'POST',
      body: { company_id: COMPANY, action: 'generate' },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.company_id).toBe(COMPANY);
    expect(res.body.webhook_verify_token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.webhook_route_id).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });
});
