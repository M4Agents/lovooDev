import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('../../../lib/instagram/validateInstagramCaller.js', () => ({
  validateInstagramCaller: vi.fn(async () => ({ ok: true, userId: 'user-1', role: 'seller' })),
}));

import { getSupabaseAdmin } from '../../../lib/automation/supabaseAdmin.js';
import handler from '../index.js';

const COMPANY = '3cbe5c11-d834-40d1-b1cf-425e6377f099';
const CONNECTION = '15e00e55-d0b9-4f8c-a518-f51b74b74e87';
const BYO = '3704590c-e4cb-438b-ac4c-3cec3c4b7a29';
const ACCOUNT = '17841408602689007';
const HEX = 'b'.repeat(64);

function response() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function chain(result) {
  const query = {
    fields: '',
    select(fields) {
      query.fields = fields;
      return query;
    },
    eq() { return query; },
    order() { return query; },
    not() { return query; },
    neq() { return query; },
    maybeSingle: async () => result,
    then(onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return query;
}

function database(operations) {
  const queries = [];
  const tables = {
    companies: { data: { status: 'active', deleted_at: null }, error: null },
    instagram_connections: {
      data: [{
        id: CONNECTION,
        status: 'revoked',
        instagram_username: 'usevalleron',
        instagram_user_id: '999',
        ig_webhook_id: ACCOUNT,
      }],
      error: null,
    },
    instagram_byo_poc_accounts: {
      data: [{
        id: BYO,
        instagram_account_id: ACCOUNT,
        instagram_username: 'usevalleron',
        status: 'poc_disabled',
        status_reason: null,
        direct_ingest_enabled: true,
      }],
      error: null,
    },
    instagram_account_operations: { data: operations, error: null },
    instagram_byo_company_credentials: {
      data: {
        validation_status: 'valid',
        webhook_enabled: true,
        webhook_route_id: HEX,
        webhook_verify_token_hash: HEX,
      },
      error: null,
    },
  };
  getSupabaseAdmin.mockReturnValue({
    from(table) {
      const query = chain(tables[table] ?? { data: [], error: null });
      query.table = table;
      queries.push(query);
      return query;
    },
  });
  return queries;
}

describe('GET /api/instagram/connections com conta BYO operacional', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve a conta BYO sem segredo quando a modalidade está registrada', async () => {
    const queries = database([{
      instagram_account_id: ACCOUNT,
      mode: 'byo',
      official_connection_id: null,
      byo_account_id: BYO,
    }]);
    const res = response();
    await handler({ method: 'GET', query: { company_id: COMPANY } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.byo_accounts).toEqual([{
      id: BYO,
      instagram_account_id: ACCOUNT,
      username: 'usevalleron',
    }]);
    expect(res.body.connections[0].ig_webhook_id).toBe(ACCOUNT);
    const credential = queries.find((query) => query.table === 'instagram_byo_company_credentials');
    expect(credential.fields).not.toContain('app_secret_enc');
    expect(credential.fields).not.toContain('suat_enc');
    expect(JSON.stringify(res.body)).not.toContain(HEX);
  });

  it('não lista a conta só porque a credencial e o direct_ingest existem', async () => {
    database([]);
    const res = response();
    await handler({ method: 'GET', query: { company_id: COMPANY } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.byo_accounts).toEqual([]);
  });
});
