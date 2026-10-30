import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashWebhookVerifyToken } from '../byoWebhook.js';

vi.mock('../../automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('../byoTokenCrypto.js', () => ({
  decryptByoSecret: vi.fn(() => 'fixture-app-secret-not-real'),
}));

vi.mock('../byoCredentialAuth.js', () => ({
  authorizeByoCredentialWrite: vi.fn(),
}));

import { getSupabaseAdmin } from '../../automation/supabaseAdmin.js';
import { authorizeByoCredentialWrite } from '../byoCredentialAuth.js';
import { handleByoWebhook } from '../byoWebhookHttp.js';
import { handleByoWebhookSetup } from '../byoWebhookSetupHttp.js';

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const ROUTE = 'ab'.repeat(32);
const PREVIOUS_HASH = hashWebhookVerifyToken('previous-verify-token');
const MIGRATION = 'supabase/migrations/20261030233000_instagram_byo_revoke_clears_webhook.sql';

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

function incoming({ method = 'POST', query = {}, headers = {}, body = '' } = {}) {
  const encoded = Buffer.from(body);
  return {
    method,
    query: { routeId: ROUTE, ...query },
    headers,
    async *[Symbol.asyncIterator]() {
      if (encoded.length > 0) yield encoded;
    },
  };
}

function credential(overrides = {}) {
  return {
    company_id: COMPANY,
    validation_status: 'valid',
    webhook_enabled: true,
    webhook_route_id: ROUTE,
    webhook_verify_token_hash: PREVIOUS_HASH,
    app_secret_enc: 'byo1:ciphertext',
    ...overrides,
  };
}

function executable(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

describe('migration de revogação do webhook BYO', () => {
  const sql = readFileSync(resolve(MIGRATION), 'utf8');
  const body = executable(sql);
  const rpc = readFileSync(resolve('supabase/migrations/20261029190000_instagram_byo_credential_rpc.sql'), 'utf8');

  it('limpa o webhook na transição para revoked e só nas linhas já revogadas', () => {
    expect(body).toContain('NEW.validation_status = \'revoked\'');
    expect(body).toContain('OLD.validation_status IS DISTINCT FROM \'revoked\'');
    expect(body).toContain('NEW.webhook_enabled := false');
    expect(body).toContain('NEW.webhook_route_id := NULL');
    expect(body).toContain('NEW.webhook_verify_token_hash := NULL');
    expect(body).toContain('SECURITY INVOKER');
    expect(body).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(body).toContain('BEFORE UPDATE ON public.instagram_byo_company_credentials');
    const updates = body.match(/UPDATE\s+public\.instagram_byo_company_credentials/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(body).toContain("validation_status = 'revoked'");
    expect(body).not.toContain("validation_status = 'valid'");
    expect(body).not.toContain('instagram_byo_apply_credentials');
    expect(body).not.toContain('direct_ingest_enabled');
    expect(body).not.toContain('process_instagram_');
    expect(body).not.toContain('instagram_messages');
    expect(body).not.toContain('instagram_conversations');
    expect(body).not.toContain('instagram_connections');
    expect(body).not.toContain('3cbe5c11-d834-40d1-b1cf-425e6377f099');
    expect(body).not.toContain('DELETE FROM');
    expect(sql).not.toMatch(/webhook_verify_token(?!_hash)/);
  });

  it('preserva o revoke atual de segredo e o evento, sem reativar no set', () => {
    const revoke = rpc.slice(rpc.indexOf("ELSIF p_operation = 'revoke'"), rpc.indexOf('UPDATE public.instagram_byo_poc_accounts'));
    const setFromRevoked = rpc.slice(rpc.indexOf("ELSIF v_status = 'revoked'"), rpc.indexOf("ELSIF p_operation = 'replace_app'"));
    expect(revoke).toContain('app_secret_enc = NULL');
    expect(revoke).toContain('suat_enc = NULL');
    expect(revoke).toContain("validation_status = 'revoked'");
    expect(revoke).not.toContain('webhook_route_id');
    expect(setFromRevoked).not.toContain('webhook_enabled');
    expect(setFromRevoked).not.toContain('webhook_route_id');
    expect(rpc).toContain('INSERT INTO public.instagram_byo_credential_events');
    expect(body).not.toContain('instagram_byo_credential_events');
  });

  it('não altera o webhook oficial nem o POST BYO', () => {
    const official = readFileSync(resolve('api/instagram/webhook.js'), 'utf8');
    const dm = readFileSync(resolve('supabase/migrations/20260526110000_rpc_fix_ig_webhook_id_lookup.sql'), 'utf8');
    const handler = readFileSync(resolve('api/lib/instagram/byoWebhookHttp.js'), 'utf8');
    expect(official).not.toContain('instagram_byo_clear_webhook_on_revoke');
    expect(dm).not.toContain('instagram_byo_clear_webhook_on_revoke');
    expect(handler).not.toContain('process_instagram_');
    expect(handler).not.toContain('instagram_messages');
    expect(handler).toContain('classifyByoWebhookPayload');
  });
});

describe('rotação e revogação do webhook BYO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeByoCredentialWrite.mockResolvedValue({ ok: true, userId: 'user-1', role: 'admin' });
  });

  function store({ row, visibleHash = PREVIOUS_HASH, commitOnMatch = true } = {}) {
    let committed = visibleHash;
    const calls = [];
    const client = {
      from(table) {
        const filters = {};
        let mode = 'read';
        let pending = null;
        const query = {
          select() { return query; },
          eq(column, value) { filters[column] = value; return query; },
          in(column, value) { filters[column] = value; return query; },
          is(column, value) { filters[column] = value; return query; },
          update(values) { mode = 'update'; pending = values; return query; },
          maybeSingle: async () => {
            if (table === 'companies') {
              return { data: { id: COMPANY, status: 'active', deleted_at: null }, error: null };
            }
            if (mode === 'update') {
              calls.push({ filters: { ...filters }, pending });
              const eligible = Array.isArray(filters.validation_status)
                && filters.validation_status.every((status) => status !== 'revoked');
              const freshGenerate = filters.webhook_route_id === null
                && filters.webhook_verify_token_hash === undefined;
              const matched = commitOnMatch
                && eligible
                && (freshGenerate
                  || (filters.webhook_enabled === true && filters.webhook_verify_token_hash === committed));
              if (!matched) return { data: null, error: null };
              committed = pending.webhook_verify_token_hash;
              return { data: { company_id: COMPANY }, error: null };
            }
            return { data: row ?? credential({ webhook_verify_token_hash: visibleHash }), error: null };
          },
        };
        return query;
      },
    };
    return { client, calls };
  }

  async function rotate(client) {
    getSupabaseAdmin.mockReturnValue(client);
    const res = response();
    await handleByoWebhookSetup({
      method: 'POST',
      body: { company_id: COMPANY, action: 'rotate' },
    }, res);
    return res;
  }

  it('aceita uma rotação e recusa a segunda baseada no hash antigo', async () => {
    const first = store();
    const ok = await rotate(first.client);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.webhook_verify_token).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(ok.body)).not.toContain(PREVIOUS_HASH);
    expect(first.calls[0].filters.webhook_verify_token_hash).toBe(PREVIOUS_HASH);

    const lost = await rotate(first.client);
    expect(lost.statusCode).toBe(409);
    expect(lost.body).toEqual({ error: 'conflict' });
    expect(lost.body.webhook_verify_token).toBeUndefined();
  });

  it('recusa rotação quando a revogação já venceu a atualização', async () => {
    const raced = store({ commitOnMatch: false });
    const res = await rotate(raced.client);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'conflict' });
    expect(raced.calls).toHaveLength(1);
    expect(raced.calls[0].filters.validation_status).not.toContain('revoked');
  });

  it('recusa rotação de credencial revogada ou sem hash', async () => {
    const revoked = store({
      row: credential({ validation_status: 'revoked', app_secret_enc: null, webhook_enabled: false, webhook_route_id: null, webhook_verify_token_hash: null }),
    });
    const denied = await rotate(revoked.client);
    expect(denied.statusCode).toBe(409);
    expect(denied.body).toEqual({ error: 'conflict' });
    expect(revoked.calls).toHaveLength(0);

    const missing = store({ row: credential({ webhook_verify_token_hash: null }) });
    const incomplete = await rotate(missing.client);
    expect(incomplete.statusCode).toBe(409);
    expect(incomplete.body).toEqual({ error: 'conflict' });
    expect(missing.calls).toHaveLength(0);
  });

  it('gera uma rota nova depois da revogação sem reaproveitar hash', async () => {
    const fresh = store({
      row: credential({
        validation_status: 'saved',
        webhook_enabled: false,
        webhook_route_id: null,
        webhook_verify_token_hash: null,
      }),
    });
    let sawNullRoute = false;
    const originalFrom = fresh.client.from.bind(fresh.client);
    fresh.client.from = (table) => {
      const query = originalFrom(table);
      const is = query.is.bind(query);
      query.is = (column, value) => {
        if (column === 'webhook_route_id' && value === null) sawNullRoute = true;
        return is(column, value);
      };
      return query;
    };
    getSupabaseAdmin.mockReturnValue(fresh.client);
    const res = response();
    await handleByoWebhookSetup({
      method: 'POST',
      body: { company_id: COMPANY, action: 'generate' },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.webhook_enabled).toBe(true);
    expect(res.body.webhook_route_id).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.webhook_verify_token).toMatch(/^[0-9a-f]{64}$/);
    expect(sawNullRoute).toBe(true);
    expect(fresh.calls[0].filters.webhook_verify_token_hash).toBeUndefined();
  });

  it('rejeita GET e POST da rota revogada ou já removida', async () => {
    getSupabaseAdmin.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    });
    const missingGet = response();
    await handleByoWebhook(incoming({
      method: 'GET',
      query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'cd'.repeat(32), 'hub.challenge': 'challenge-1' },
    }), missingGet);
    expect(missingGet.statusCode).toBe(404);

    const missingPost = response();
    await handleByoWebhook(incoming({
      headers: { 'x-hub-signature-256': 'sha256=aa' },
      body: '{}',
    }), missingPost);
    expect(missingPost.statusCode).toBe(404);

    getSupabaseAdmin.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: credential({
                validation_status: 'revoked',
                app_secret_enc: null,
                webhook_enabled: false,
              }),
              error: null,
            }),
          }),
        }),
      }),
    });
    const revokedGet = response();
    await handleByoWebhook(incoming({
      method: 'GET',
      query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'cd'.repeat(32), 'hub.challenge': 'challenge-1' },
    }), revokedGet);
    expect(revokedGet.statusCode).toBe(403);

    const revokedPost = response();
    const payload = JSON.stringify({ object: 'instagram', entry: [] });
    await handleByoWebhook(incoming({
      headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', 'fixture-app-secret-not-real').update(payload).digest('hex')}` },
      body: payload,
    }), revokedPost);
    expect(revokedPost.statusCode).toBe(401);
  });

  it('mantém o POST autenticado sem persistir mensagem', async () => {
    const tables = [];
    getSupabaseAdmin.mockReturnValue({
      from: (table) => {
        tables.push(table);
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: credential(), error: null }),
            }),
          }),
        };
      },
    });
    const payload = JSON.stringify({
      object: 'instagram',
      entry: [{ id: '17841405822304914', messaging: [{ message: { mid: 'm1', text: 'ola' } }] }],
    });
    const res = response();
    await handleByoWebhook(incoming({
      headers: {
        'x-hub-signature-256': `sha256=${createHmac('sha256', 'fixture-app-secret-not-real').update(payload).digest('hex')}`,
      },
      body: payload,
    }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(tables).toEqual(['instagram_byo_company_credentials']);
    const handler = readFileSync(resolve('api/lib/instagram/byoWebhookHttp.js'), 'utf8');
    expect(handler).not.toContain('.rpc(');
    expect(handler).not.toContain('process_instagram_byo_dm_webhook');
  });
});
