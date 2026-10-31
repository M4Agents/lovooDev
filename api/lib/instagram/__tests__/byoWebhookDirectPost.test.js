// Testes com mocks. Não executam a RPC em PostgreSQL.
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashWebhookVerifyToken } from '../byoWebhook.js';

vi.mock('../../automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('../byoTokenCrypto.js', () => ({
  decryptByoSecret: vi.fn(),
}));

import { getSupabaseAdmin } from '../../automation/supabaseAdmin.js';
import { decryptByoSecret } from '../byoTokenCrypto.js';
import { handleByoWebhook } from '../byoWebhookHttp.js';

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const OTHER = 'dddddddd-0000-4000-8000-000000000004';
const ROUTE = 'ab'.repeat(32);
const SECRET = 'fixture-app-secret-not-real';
const ACCOUNT = 'eeeeeeee-0000-4000-8000-000000000005';
const IG = '17841405822304914';
const OTHER_IG = '17841400000000002';

function response() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; },
  };
}

function sign(body) {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
}

function incoming(body, headers = {}) {
  const encoded = Buffer.from(body);
  return {
    method: 'POST',
    query: { routeId: ROUTE },
    headers: { 'x-hub-signature-256': sign(body), ...headers },
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
    webhook_verify_token_hash: hashWebhookVerifyToken('cd'.repeat(32)),
    app_secret_enc: 'byo1:ciphertext',
    ...overrides,
  };
}

function account(overrides = {}) {
  return {
    id: ACCOUNT,
    company_id: COMPANY,
    instagram_account_id: IG,
    ...overrides,
  };
}

function harness({
  credentialRow = credential(),
  accountRow = account(),
  accountError = null,
  rpc = { data: { ok: true, skipped: true, reason: 'direct_ingest_disabled' }, error: null },
} = {}) {
  const rpcCalls = [];
  const accountFilters = [];
  getSupabaseAdmin.mockReturnValue({
    from(table) {
      const filters = {};
      const query = {
        select() { return query; },
        eq(column, value) { filters[column] = value; return query; },
        maybeSingle: async () => {
          if (table === 'instagram_byo_company_credentials') return { data: credentialRow, error: null };
          if (table === 'instagram_byo_poc_accounts') {
            accountFilters.push({ ...filters });
            if (accountError) return { data: null, error: accountError };
            const match = accountRow
              && accountRow.company_id === filters.company_id
              && accountRow.instagram_account_id === filters.instagram_account_id;
            return { data: match ? accountRow : null, error: null };
          }
          return { data: null, error: { message: 'tabela inesperada' } };
        },
      };
      return query;
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return typeof rpc === 'function' ? rpc(name, args) : rpc;
    },
  });
  return { rpcCalls, accountFilters };
}

function dmPayload(messaging, extra = {}) {
  return JSON.stringify({
    object: 'instagram',
    entry: [{ id: IG, messaging }],
    company_id: OTHER,
    ...extra,
  });
}

function message(mid, extra = {}) {
  return {
    sender: { id: '9001' },
    recipient: { id: IG },
    timestamp: 1710000000000,
    message: { mid, text: 'ola', ...extra },
  };
}

describe('POST Direct BYO com mocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decryptByoSecret.mockReturnValue(SECRET);
  });

  it('rejeita HMAC inválido, rota ausente e credencial revogada sem chamar a RPC', async () => {
    const { rpcCalls } = harness();
    const body = dmPayload([message('m1')]);

    const bad = response();
    await handleByoWebhook(incoming(body, { 'x-hub-signature-256': 'sha256=aa' }), bad);
    expect(bad.statusCode).toBe(401);
    expect(rpcCalls).toHaveLength(0);

    harness({ credentialRow: null });
    const missing = response();
    await handleByoWebhook(incoming(body), missing);
    expect(missing.statusCode).toBe(404);

    harness({
      credentialRow: credential({ validation_status: 'revoked', app_secret_enc: null, webhook_enabled: false }),
    });
    const revoked = response();
    await handleByoWebhook(incoming(body), revoked);
    expect(revoked.statusCode).toBe(401);
    expect(revoked.body).toEqual({ error: 'invalid_signature' });
  });

  it('encaminha Direct válido da empresa da rota e ignora o company_id do payload', async () => {
    const { rpcCalls, accountFilters } = harness();
    const res = response();
    await handleByoWebhook(incoming(dmPayload([message('m1')])), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(accountFilters).toEqual([{ company_id: COMPANY, instagram_account_id: IG }]);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('process_instagram_byo_dm_webhook');
    expect(rpcCalls[0].args).toMatchObject({
      p_company_id: COMPANY,
      p_byo_account_id: ACCOUNT,
      p_instagram_account_id: IG,
      p_ig_message_id: 'm1',
      p_ig_thread_id: '9001',
      p_participant_ig_user_id: '9001',
      p_direction: 'inbound',
      p_message_type: 'text',
      p_content: 'ola',
    });
    expect(rpcCalls[0].args.p_company_id).not.toBe(OTHER);
    expect(JSON.stringify(res.body)).not.toContain('ola');
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('não chama a RPC para outra empresa, evento sem mensagem, comentário ou reação', async () => {
    const foreign = harness({ accountRow: account({ company_id: OTHER }) });
    const wrong = response();
    await handleByoWebhook(incoming(dmPayload([message('m1')])), wrong);
    expect(wrong.statusCode).toBe(200);
    expect(foreign.rpcCalls).toHaveLength(0);
    expect(foreign.accountFilters[0].company_id).toBe(COMPANY);

    const empty = harness();
    const noMessage = response();
    await handleByoWebhook(incoming(dmPayload([{ sender: { id: '9001' }, recipient: { id: IG } }])), noMessage);
    expect(noMessage.statusCode).toBe(200);
    expect(empty.rpcCalls).toHaveLength(0);

    const comments = harness();
    const commentRes = response();
    await handleByoWebhook(incoming(JSON.stringify({
      object: 'instagram',
      entry: [{ id: IG, changes: [{ field: 'comments', value: { id: 'c1' } }] }],
    })), commentRes);
    expect(commentRes.statusCode).toBe(200);
    expect(comments.rpcCalls).toHaveLength(0);

    const reactions = harness();
    const reactionRes = response();
    await handleByoWebhook(incoming(dmPayload([{
      sender: { id: '9001' },
      recipient: { id: IG },
      reaction: { mid: 'm1', action: 'react', emoji: '❤️' },
    }])), reactionRes);
    expect(reactionRes.statusCode).toBe(200);
    expect(reactions.rpcCalls).toHaveLength(0);
  });

  it('rejeita JSON malformado e devolve 200 quando a RPC recusa', async () => {
    const broken = harness();
    const malformed = response();
    await handleByoWebhook(incoming('{'), malformed);
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).toEqual({ error: 'rejected' });
    expect(broken.rpcCalls).toHaveLength(0);

    for (const reason of [
      'direct_ingest_disabled',
      'official_priority',
      'ambiguous_byo_account',
      'conversation_owner_conflict',
      'duplicate_message',
    ]) {
      const { rpcCalls } = harness({
        rpc: { data: { ok: true, skipped: true, reason }, error: null },
      });
      const res = response();
      await handleByoWebhook(incoming(dmPayload([message(`mid-${reason}`)])), res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(JSON.stringify(res.body)).not.toContain(reason);
      expect(rpcCalls).toHaveLength(1);
    }
  });

  it('chama a RPC uma vez por mensagem e falha o lote inteiro se o banco falhar', async () => {
    const { rpcCalls } = harness({
      rpc: { data: { ok: true, skipped: false, reason: 'persisted' }, error: null },
    });
    const many = response();
    await handleByoWebhook(incoming(dmPayload([
      message('m1'),
      message('m2', { is_echo: true, text: 'eco' }),
    ])), many);
    expect(many.statusCode).toBe(200);
    expect(rpcCalls.map((call) => call.args.p_ig_message_id)).toEqual(['m1', 'm2']);
    expect(rpcCalls[1].args.p_direction).toBe('outbound');
    expect(rpcCalls[1].args.p_ig_thread_id).toBe(IG);
    expect(rpcCalls.every((call) => call.args.p_company_id === COMPANY)).toBe(true);

    const failed = harness({
      rpc: { data: null, error: { message: 'segredo-interno-do-banco' } },
    });
    const down = response();
    await handleByoWebhook(incoming(dmPayload([message('m1'), message('m2')])), down);
    expect(down.statusCode).toBe(500);
    expect(down.body).toEqual({ error: 'unavailable' });
    expect(JSON.stringify(down.body)).not.toContain('segredo-interno-do-banco');
    expect(failed.rpcCalls).toHaveLength(1);

    const lookup = harness({ accountError: { message: 'timeout interno' } });
    const lookupDown = response();
    await handleByoWebhook(incoming(dmPayload([message('m9')])), lookupDown);
    expect(lookupDown.statusCode).toBe(500);
    expect(lookupDown.body).toEqual({ error: 'unavailable' });
    expect(lookup.rpcCalls).toHaveLength(0);
  });

  it('não consulta outra conta quando o Instagram do evento não está associado', async () => {
    const { rpcCalls, accountFilters } = harness();
    const res = response();
    await handleByoWebhook(incoming(JSON.stringify({
      object: 'instagram',
      company_id: OTHER,
      entry: [{ id: OTHER_IG, messaging: [message('m-other')] }],
    })), res);
    expect(res.statusCode).toBe(200);
    expect(accountFilters).toEqual([{ company_id: COMPANY, instagram_account_id: OTHER_IG }]);
    expect(rpcCalls).toHaveLength(0);
  });
});
