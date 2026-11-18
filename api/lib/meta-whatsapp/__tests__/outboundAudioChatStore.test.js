// =============================================================================
// outboundAudioChatStore.test.js — B3.2-C.3-D.3-E.2-B.5
// Supabase mockado. Zero Graph, S3 real, SQL remoto, HTTP ou process.env.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOutboundAudioChatInsert } from '../outboundAudioPersistenceContracts.js';
import {
  META_MESSAGES_TABLE,
  persistOutboundAudioChat,
} from '../outboundAudioChatStore.js';

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../outboundAudioChatStore.js'),
  'utf8',
);

const COMPANY_A = 'aaaa0000-0000-4000-8000-000000000001';
const COMPANY_B = 'bbbb0000-0000-4000-8000-000000000002';
const INSTANCE_A = 'cccc0000-0000-4000-8000-000000000003';
const INSTANCE_B = 'dddd0000-0000-4000-8000-000000000004';
const CONVERSATION_A = 'eeee0000-0000-4000-8000-000000000005';
const CONVERSATION_B = 'ffff0000-0000-4000-8000-000000000006';
const ASSET_A = '99999999-0000-4000-8000-000000000009';
const ASSET_B = '88888888-0000-4000-8000-000000000008';
const CHAT_ID = '77777777-0000-4000-8000-000000000007';
const WAMID = 'wamid.HBgLNTU1MTk4NzY1NDMyMQIVAgARGBI4NzY1NDMyMQ==';
const WAMID_B = 'wamid.OTHERFAKEWAMID==';
const TS_A = '2026-11-18T18:00:00.000Z';
const TS_B = '2026-11-18T19:30:00.123Z';

function context(overrides = {}) {
  return {
    companyId: COMPANY_A,
    instanceId: INSTANCE_A,
    conversationId: CONVERSATION_A,
    wamid: WAMID,
    mediaAssetId: ASSET_A,
    providerTimestamp: TS_A,
    ...overrides,
  };
}

function expectedRow() {
  return buildOutboundAudioChatInsert(context()).row;
}

function storedRow(overrides = {}) {
  return {
    id: CHAT_ID,
    ...expectedRow(),
    ...overrides,
  };
}

function makeInsertChain({ data = storedRow(), error = null } = {}) {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function makeSelectChain({ data = storedRow(), error = null } = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function makeSvc(insertChain, selectChain) {
  const from = vi.fn();
  from.mockReturnValueOnce(insertChain);
  if (selectChain) from.mockReturnValueOnce(selectChain);
  return { from };
}

function uniqueErr() {
  return { code: '23505', message: 'duplicate key' };
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called in chat store tests');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('persistOutboundAudioChat — entrada', () => {
  it('contexto válido insere e devolve chatMessageId', async () => {
    const insertChain = makeInsertChain();
    const result = await persistOutboundAudioChat({
      supabase: makeSvc(insertChain),
      context: context(),
    });
    expect(result).toEqual({
      ok: true,
      idempotent: false,
      chatMessageId: CHAT_ID,
    });
    expect(insertChain.insert).toHaveBeenCalledTimes(1);
    expect(insertChain.insert.mock.calls[0][0]).toEqual(expectedRow());
    expect(insertChain.insert.mock.calls[0][0].body).toBeNull();
    expect(insertChain.insert.mock.calls[0][0]).not.toHaveProperty('preview_url');
  });

  it('entrada inválida ou cliente ausente não acessa o banco', async () => {
    const from = vi.fn();
    const cases = [
      { ...context(), companyId: undefined },
      context({ mediaAssetId: 'not-uuid' }),
      context({ providerTimestamp: 'yesterday' }),
      context({ providerTimestamp: undefined }),
      context({ wamid: '' }),
    ];
    for (const input of cases) {
      from.mockClear();
      const result = await persistOutboundAudioChat({
        supabase: { from },
        context: input,
      });
      expect(result).toEqual({ ok: false, error: 'invalid_input' });
      expect(from).not.toHaveBeenCalled();
    }
    expect(await persistOutboundAudioChat({
      context: context(),
    })).toEqual({ ok: false, error: 'invalid_input' });
  });
});

describe('persistOutboundAudioChat — INSERT', () => {
  it('erro não-23505, row/id inválidos e divergências', async () => {
    await expect(persistOutboundAudioChat({
      supabase: makeSvc(makeInsertChain({ data: null })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'chat_indeterminate' });

    await expect(persistOutboundAudioChat({
      supabase: makeSvc(makeInsertChain({ data: storedRow({ id: undefined }) })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'chat_indeterminate' });

    await expect(persistOutboundAudioChat({
      supabase: makeSvc(makeInsertChain({ data: storedRow({ id: 'not-uuid' }) })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'chat_indeterminate' });

    await expect(persistOutboundAudioChat({
      supabase: makeSvc(makeInsertChain({
        data: storedRow({ company_id: COMPANY_B }),
      })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'chat_conflict' });

    await expect(persistOutboundAudioChat({
      supabase: makeSvc(makeInsertChain({
        data: storedRow({ instance_id: INSTANCE_B }),
      })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'chat_conflict' });

    await expect(persistOutboundAudioChat({
      supabase: makeSvc(makeInsertChain({
        data: storedRow({ conversation_id: CONVERSATION_B }),
      })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'chat_conflict' });

    await expect(persistOutboundAudioChat({
      supabase: makeSvc(makeInsertChain({
        data: storedRow({ meta_message_id: WAMID_B }),
      })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'chat_conflict' });

    await expect(persistOutboundAudioChat({
      supabase: makeSvc(makeInsertChain({
        data: storedRow({ media_asset_id: ASSET_B }),
      })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'chat_conflict' });

    await expect(persistOutboundAudioChat({
      supabase: makeSvc(makeInsertChain({
        data: storedRow({ direction: 'inbound' }),
      })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'chat_conflict' });

    await expect(persistOutboundAudioChat({
      supabase: makeSvc(makeInsertChain({
        data: storedRow({ message_type: 'text' }),
      })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'chat_conflict' });

    await expect(persistOutboundAudioChat({
      supabase: makeSvc(makeInsertChain({
        data: storedRow({ body: 'nao nulo' }),
      })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'chat_conflict' });

    const { media_asset_id: _omit, ...incomplete } = storedRow();
    await expect(persistOutboundAudioChat({
      supabase: makeSvc(makeInsertChain({ data: incomplete })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'chat_indeterminate' });

    await expect(persistOutboundAudioChat({
      supabase: makeSvc(makeInsertChain({ data: null, error: { code: '42P01' } })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'chat_insert_failed' });
  });

  it('exceção do cliente e uma única tentativa de INSERT', async () => {
    const insertChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const supabase = makeSvc(insertChain);
    const result = await persistOutboundAudioChat({
      supabase,
      context: context(),
    });
    expect(result).toEqual({ ok: false, error: 'chat_indeterminate' });
    expect(insertChain.insert).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});

describe('persistOutboundAudioChat — 23505', () => {
  it('winner idêntico, inclusive com provider_timestamp diferente', async () => {
    const insertChain = makeInsertChain({ data: null, error: uniqueErr() });
    const selectChain = makeSelectChain({
      data: storedRow({ provider_timestamp: TS_B }),
    });
    const supabase = makeSvc(insertChain, selectChain);
    const result = await persistOutboundAudioChat({
      supabase,
      context: context(),
    });
    expect(result).toEqual({
      ok: true,
      idempotent: true,
      chatMessageId: CHAT_ID,
    });
    expect(insertChain.insert).toHaveBeenCalledTimes(1);
    expect(selectChain.eq).toHaveBeenCalledWith('company_id', COMPANY_A);
    expect(selectChain.eq).toHaveBeenCalledWith('instance_id', INSTANCE_A);
    expect(selectChain.eq).toHaveBeenCalledWith('meta_message_id', WAMID);
    expect(selectChain.eq).not.toHaveBeenCalledWith('conversation_id', CONVERSATION_A);
    expect(selectChain.eq).not.toHaveBeenCalledWith('company_id', COMPANY_B);
  });

  it('winner divergente, ausente ou SELECT falho → sem segundo INSERT', async () => {
    const cases = [
      {
        select: makeSelectChain({ data: storedRow({ media_asset_id: ASSET_B }) }),
        error: 'chat_conflict',
      },
      {
        select: makeSelectChain({
          data: storedRow({ conversation_id: CONVERSATION_B }),
        }),
        error: 'chat_conflict',
      },
      {
        select: makeSelectChain({ data: storedRow({ company_id: COMPANY_B }) }),
        error: 'chat_conflict',
      },
      {
        select: makeSelectChain({ data: storedRow({ direction: 'inbound' }) }),
        error: 'chat_conflict',
      },
      {
        select: makeSelectChain({ data: storedRow({ message_type: 'text' }) }),
        error: 'chat_conflict',
      },
      {
        select: makeSelectChain({ data: null }),
        error: 'chat_indeterminate',
      },
      {
        select: makeSelectChain({ data: null, error: { code: 'PGRST301' } }),
        error: 'chat_indeterminate',
      },
      {
        select: {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockRejectedValue(new Error('select boom')),
        },
        error: 'chat_indeterminate',
      },
      {
        select: makeSelectChain({ data: [storedRow(), storedRow()] }),
        error: 'chat_indeterminate',
      },
    ];

    for (const item of cases) {
      const insertChain = makeInsertChain({ data: null, error: uniqueErr() });
      const supabase = makeSvc(insertChain, item.select);
      const result = await persistOutboundAudioChat({
        supabase,
        context: context(),
      });
      expect(result).toEqual({ ok: false, error: item.error });
      expect(insertChain.insert).toHaveBeenCalledTimes(1);
      expect(supabase.from).toHaveBeenCalledTimes(2);
      expect(supabase.from.mock.calls.map(([table]) => table)).toEqual([
        META_MESSAGES_TABLE,
        META_MESSAGES_TABLE,
      ]);
    }
  });
});

describe('persistOutboundAudioChat — segurança', () => {
  it('não muta o context e não devolve payload sensível', async () => {
    const input = Object.freeze(context());
    const before = JSON.stringify(input);
    const result = await persistOutboundAudioChat({
      supabase: makeSvc(makeInsertChain()),
      context: input,
    });
    expect(JSON.stringify(input)).toBe(before);
    expect(result).not.toHaveProperty('meta_message_id');
    expect(result).not.toHaveProperty('wamid');
    expect(result).not.toHaveProperty('s3_key');
    expect(JSON.stringify(result)).not.toContain('accessToken');
    expect(JSON.stringify(result)).not.toContain(WAMID);
  });

  it('fonte sem AWS, Graph, HTTP, env, Date.now, UPDATE, DELETE ou UPSERT', () => {
    const executable = SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(executable).not.toContain('getSupabaseAdmin');
    expect(executable).not.toContain('@aws-sdk');
    expect(executable).not.toContain('graphClient');
    expect(executable).not.toContain('uploadMedia');
    expect(executable).not.toContain('sendAudioMessage');
    expect(executable).not.toContain('process.env');
    expect(executable).not.toContain('Date.now');
    expect(executable).not.toContain('.update(');
    expect(executable).not.toContain('.delete(');
    expect(executable).not.toContain('upsert');
    expect(executable).not.toContain('onConflict');
    expect(executable).not.toContain('markCompleted');
    expect(executable).not.toContain('company_media_library');
    expect(executable).not.toContain('meta_whatsapp_messages');
    expect(executable).toContain("eq('company_id'");
    expect(executable).toContain("eq('instance_id'");
    expect(executable).toContain("eq('meta_message_id'");
  });
});
