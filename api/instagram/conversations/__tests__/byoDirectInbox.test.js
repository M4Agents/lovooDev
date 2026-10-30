import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('../../../lib/instagram/validateInstagramCaller.js', () => ({
  validateInstagramCaller: vi.fn(async () => ({ ok: true, userId: 'user-1', role: 'admin' })),
}));

vi.mock('../../../lib/instagram/instagramMessageService.js', () => ({
  sendInstagramMessage: vi.fn(),
}));

vi.mock('../../../lib/instagram/tokenCrypto.js', () => ({
  decryptInstagramToken: vi.fn(() => {
    throw new Error('token lido');
  }),
}));

import { getSupabaseAdmin } from '../../../lib/automation/supabaseAdmin.js';
import { sendInstagramMessage } from '../../../lib/instagram/instagramMessageService.js';
import { decryptInstagramToken } from '../../../lib/instagram/tokenCrypto.js';
import listHandler from '../index.js';
import messagesHandler from '../[conversationId]/messages.js';
import sendHandler from '../[conversationId]/send.js';
import sendMediaHandler from '../[conversationId]/send-media.js';
import reactHandler from '../[conversationId]/react.js';
import enrichHandler from '../[conversationId]/enrich-participant.js';
import { sendInstagramGateway } from '../../../lib/agents/instagramGateway.ts';

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const OTHER = 'dddddddd-0000-4000-8000-000000000004';
const CONNECTION = '11111111-1111-4111-8111-111111111111';
const BYO_ACCOUNT = '22222222-2222-4222-8222-222222222222';

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
  };
}

function chain(result) {
  const query = {
    filters: [],
    fields: '',
    select(fields) {
      query.fields = fields;
      return query;
    },
    eq(column, value) {
      query.filters.push([column, value]);
      return query;
    },
    order() { return query; },
    limit() { return query; },
    or() { return query; },
    gt() { return query; },
    not() { return query; },
    is() { return query; },
    in() { return query; },
    insert() { return Promise.resolve({ error: null }); },
    maybeSingle: async () => result,
    then(onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return query;
}

describe('lista e mensagens Direct BYO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('meta');
    }));
  });

  it('prepara a lista all com as duas origens e sem token', async () => {
    const query = chain({
      data: [
        {
          id: 'official-1',
          company_id: COMPANY,
          connection_id: CONNECTION,
          byo_account_id: null,
          byo_account: null,
        },
        {
          id: 'byo-1',
          company_id: COMPANY,
          connection_id: null,
          byo_account_id: BYO_ACCOUNT,
          byo_account: {
            instagram_username: 'usevalleron',
            access_token_enc: 'byo1:nao-deve-sair',
          },
        },
      ],
      error: null,
    });
    getSupabaseAdmin.mockReturnValue({ from: () => query });
    const res = response();
    await listHandler({ method: 'GET', query: { company_id: COMPANY, connection_id: 'all' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.conversations).toEqual([
      expect.objectContaining({ id: 'official-1', connection_id: CONNECTION, byo_account_id: null, byo_instagram_username: null }),
      expect.objectContaining({ id: 'byo-1', connection_id: null, byo_account_id: BYO_ACCOUNT, byo_instagram_username: 'usevalleron' }),
    ]);
    expect(query.filters).toContainEqual(['company_id', COMPANY]);
    expect(query.filters.some(([column]) => column === 'connection_id')).toBe(false);
    expect(query.fields).not.toContain('access_token');
    expect(JSON.stringify(res.body)).not.toContain('byo1:nao-deve-sair');
    expect(JSON.stringify(res.body)).not.toContain(OTHER);
  });

  it('filtra uma conexão oficial e deixa a conta BYO de fora da consulta', async () => {
    const query = chain({ data: [], error: null });
    getSupabaseAdmin.mockReturnValue({ from: () => query });
    const res = response();
    await listHandler({
      method: 'GET',
      query: { company_id: COMPANY, connection_id: CONNECTION },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(query.filters).toContainEqual(['company_id', COMPANY]);
    expect(query.filters).toContainEqual(['connection_id', CONNECTION]);
  });

  it('lista mensagens da conversa BYO pela empresa, sem conexão oficial', async () => {
    const queries = [];
    getSupabaseAdmin.mockReturnValue({
      from(table) {
        const query = chain(
          table === 'instagram_conversations'
            ? { data: { company_id: COMPANY, byo_account_id: BYO_ACCOUNT, connection_id: null }, error: null }
            : { data: table === 'instagram_messages'
              ? [{ id: 'msg-1', company_id: COMPANY, conversation_id: 'byo-1', content: 'ola' }]
              : [], error: null },
        );
        queries.push({ table, query });
        return query;
      },
    });
    const res = response();
    await messagesHandler({ method: 'GET', query: { conversationId: 'byo-1' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.messages[0].content).toBe('ola');
    expect(queries.map((item) => item.table)).not.toContain('instagram_connections');
    const messages = queries.find((item) => item.table === 'instagram_messages');
    expect(messages.query.filters).toContainEqual(['conversation_id', 'byo-1']);
    expect(messages.query.filters).toContainEqual(['company_id', COMPANY]);
    expect(decryptInstagramToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('bloqueio de envio Direct BYO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('meta');
    }));
  });

  function arm(conversation) {
    const tables = [];
    getSupabaseAdmin.mockReturnValue({
      from(table) {
        tables.push(table);
        return chain({ data: conversation, error: null });
      },
    });
    return tables;
  }

  it.each([
    ['send', sendHandler, { text: 'ola' }],
    ['send-media', sendMediaHandler, { media_url: 'https://cdn.example/a.jpg', media_type: 'image' }],
    ['react', reactHandler, { ig_message_id: 'mid-1', emoji: 'like', action: 'react' }],
  ])('responde 422 em %s sem token e sem Meta', async (_name, handler, body) => {
    const tables = arm({
      id: 'byo-1',
      company_id: COMPANY,
      connection_id: null,
      byo_account_id: BYO_ACCOUNT,
      ig_participant_id: '1784',
    });
    const res = response();
    await handler({ method: 'POST', query: { conversationId: 'byo-1' }, body }, res);

    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('byo_send_disabled');
    expect(tables).toEqual(['instagram_conversations']);
    expect(sendInstagramMessage).not.toHaveBeenCalled();
    expect(decryptInstagramToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('mantém o envio oficial no serviço compartilhado', async () => {
    arm({
      id: 'official-1',
      company_id: COMPANY,
      connection_id: CONNECTION,
      byo_account_id: null,
      ig_participant_id: '1784',
    });
    sendInstagramMessage.mockResolvedValue({ ok: true, savedMessage: { id: 'saved-1' } });
    const res = response();
    await sendHandler({
      method: 'POST',
      query: { conversationId: 'official-1' },
      body: { text: 'ola' },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(sendInstagramMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'official-1',
      companyId: COMPANY,
    }));
  });

  it('devolve o perfil já salvo no enrich BYO', async () => {
    const tables = arm({
      company_id: COMPANY,
      connection_id: null,
      byo_account_id: BYO_ACCOUNT,
      participant_name: 'Ana',
      participant_username: 'ana',
      participant_avatar: null,
    });
    const res = response();
    await enrichHandler({ method: 'POST', query: { conversationId: 'byo-1' }, body: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.participant_name).toBe('Ana');
    expect(tables).toEqual(['instagram_conversations']);
    expect(decryptInstagramToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('impede o gateway de enviar conversa BYO', async () => {
    const tables = [];
    const svc = {
      from(table) {
        tables.push(table);
        return chain({
          data: {
            id: 'byo-1',
            company_id: COMPANY,
            ai_state: 'ai_active',
            ai_assignment_id: 'assign-1',
            connection_id: null,
            byo_account_id: BYO_ACCOUNT,
          },
          error: null,
        });
      },
    };
    const result = await sendInstagramGateway({
      svc,
      company_id: COMPANY,
      instagram_conversation_id: 'byo-1',
      assignment_id: 'assign-1',
      response_text: 'resposta',
      run_id: 'run-1',
    });

    expect(result).toEqual({ success: false, skip_reason: 'byo_send_disabled' });
    expect(tables).toEqual(['instagram_conversations']);
    expect(sendInstagramMessage).not.toHaveBeenCalled();
  });
});

describe('migration do dono da conversa', () => {
  it('é aditiva e preserva a linha oficial', () => {
    const sql = readFileSync(resolve('supabase/migrations/20261030230000_instagram_conversations_byo_owner.sql'), 'utf8');
    const officialDm = readFileSync(resolve('supabase/migrations/20260526110000_rpc_fix_ig_webhook_id_lookup.sql'), 'utf8');
    const officialWebhook = readFileSync(resolve('api/instagram/webhook.js'), 'utf8');
    expect(sql).toContain('ADD COLUMN byo_account_id UUID');
    expect(sql).toContain('ALTER COLUMN connection_id DROP NOT NULL');
    expect(sql).toContain('FOREIGN KEY (byo_account_id, company_id)');
    expect(sql).toContain('REFERENCES public.instagram_byo_poc_accounts (id, company_id)');
    expect(sql).toContain('UNIQUE (id, company_id)');
    expect(sql).toContain('(connection_id IS NOT NULL AND byo_account_id IS NULL)');
    expect(sql).toContain('(connection_id IS NULL AND byo_account_id IS NOT NULL)');
    expect(sql).toContain('WHERE byo_account_id IS NOT NULL');
    expect(sql).not.toMatch(/\bUPDATE\b/);
    expect(sql).not.toMatch(/\bDELETE FROM\b/);
    expect(sql).not.toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toContain('instagram_messages');
    expect(sql).not.toContain('instagram_comments');
    expect(sql).not.toContain('instagram_connections');
    expect(sql).not.toContain('process_instagram_dm_webhook');
    expect(officialDm).not.toContain('byo_account_id');
    expect(officialWebhook).not.toContain('byo-poc/webhook');
    expect(officialWebhook).not.toContain('byo_account_id');
  });
});
