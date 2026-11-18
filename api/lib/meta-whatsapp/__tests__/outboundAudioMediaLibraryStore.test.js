// =============================================================================
// outboundAudioMediaLibraryStore.test.js — B3.2-C.3-D.3-E.2-B.4
// Supabase mockado. Zero Graph, S3 real, SQL remoto, HTTP ou process.env.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOutboundAudioMediaLibraryInsert } from '../outboundAudioPersistenceContracts.js';
import {
  COMPANY_MEDIA_LIBRARY_TABLE,
  persistOutboundAudioMediaLibrary,
} from '../outboundAudioMediaLibraryStore.js';

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../outboundAudioMediaLibraryStore.js'),
  'utf8',
);

const COMPANY_A = 'aaaa0000-0000-4000-8000-000000000001';
const COMPANY_B = 'bbbb0000-0000-4000-8000-000000000002';
const OPERATION_A = '11111111-1111-4111-8111-111111111111';
const OPERATION_B = '22222222-2222-4222-8222-222222222222';
const UUID_V1 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const ASSET_ID = '99999999-0000-4000-8000-000000000009';
const SHA = 'a'.repeat(64);
const SIZE = 2048;
const S3_A = `clientes/${COMPANY_A}/meta-outbound/${OPERATION_A}/audio.m4a`;
const SOURCE_REF = `meta-outbound:${OPERATION_A}`;

function context(overrides = {}) {
  return {
    companyId: COMPANY_A,
    operationId: OPERATION_A,
    audioSha256: SHA,
    s3Key: S3_A,
    audioSizeBytes: SIZE,
    ...overrides,
  };
}

function expectedRow() {
  return buildOutboundAudioMediaLibraryInsert(context()).row;
}

function storedRow(overrides = {}) {
  return {
    id: ASSET_ID,
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

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called in media library store tests');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('persistOutboundAudioMediaLibrary — entrada', () => {
  it('contexto válido insere e devolve mediaAssetId', async () => {
    const insertChain = makeInsertChain();
    const result = await persistOutboundAudioMediaLibrary({
      supabase: makeSvc(insertChain),
      context: context(),
    });
    expect(result).toEqual({
      ok: true,
      idempotent: false,
      mediaAssetId: ASSET_ID,
    });
    expect(insertChain.insert).toHaveBeenCalledTimes(1);
    expect(insertChain.insert.mock.calls[0][0]).toEqual(expectedRow());
  });

  it('entrada inválida não acessa o banco', async () => {
    const from = vi.fn();
    const cases = [
      { ...context(), companyId: undefined },
      context({ operationId: UUID_V1 }),
      context({ s3Key: `clientes/${COMPANY_B}/meta-outbound/${OPERATION_A}/audio.m4a` }),
      context({ s3Key: `clientes/${COMPANY_A}/meta-outbound/${OPERATION_B}/audio.m4a` }),
      context({ audioSizeBytes: 0 }),
    ];
    for (const input of cases) {
      from.mockClear();
      const result = await persistOutboundAudioMediaLibrary({
        supabase: { from },
        context: input,
      });
      expect(result).toEqual({ ok: false, error: 'invalid_input' });
      expect(from).not.toHaveBeenCalled();
    }
    expect(await persistOutboundAudioMediaLibrary({
      context: context(),
    })).toEqual({ ok: false, error: 'invalid_input' });
  });
});

describe('persistOutboundAudioMediaLibrary — INSERT', () => {
  it('erro não-23505, row/id inválidos e divergências', async () => {
    await expect(persistOutboundAudioMediaLibrary({
      supabase: makeSvc(makeInsertChain({ data: null, error: { code: '42P01' } })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'media_library_insert_failed' });

    await expect(persistOutboundAudioMediaLibrary({
      supabase: makeSvc(makeInsertChain({ data: null })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'media_library_indeterminate' });

    await expect(persistOutboundAudioMediaLibrary({
      supabase: makeSvc(makeInsertChain({ data: storedRow({ id: undefined }) })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'media_library_indeterminate' });

    await expect(persistOutboundAudioMediaLibrary({
      supabase: makeSvc(makeInsertChain({ data: storedRow({ id: 'not-uuid' }) })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'media_library_indeterminate' });

    await expect(persistOutboundAudioMediaLibrary({
      supabase: makeSvc(makeInsertChain({
        data: storedRow({ company_id: COMPANY_B }),
      })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'media_library_conflict' });

    await expect(persistOutboundAudioMediaLibrary({
      supabase: makeSvc(makeInsertChain({
        data: storedRow({ source_ref: `meta-outbound:${OPERATION_B}` }),
      })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'media_library_conflict' });

    await expect(persistOutboundAudioMediaLibrary({
      supabase: makeSvc(makeInsertChain({
        data: storedRow({ s3_key: `clientes/${COMPANY_A}/meta-outbound/${OPERATION_B}/audio.m4a` }),
      })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'media_library_conflict' });

    await expect(persistOutboundAudioMediaLibrary({
      supabase: makeSvc(makeInsertChain({
        data: storedRow({ file_size: SIZE + 9 }),
      })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'media_library_conflict' });

    const { file_size: _omit, ...incomplete } = storedRow();
    await expect(persistOutboundAudioMediaLibrary({
      supabase: makeSvc(makeInsertChain({ data: incomplete })),
      context: context(),
    })).resolves.toEqual({ ok: false, error: 'media_library_indeterminate' });
  });

  it('exceção do cliente e uma única tentativa de INSERT', async () => {
    const insertChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const supabase = makeSvc(insertChain);
    const result = await persistOutboundAudioMediaLibrary({
      supabase,
      context: context(),
    });
    expect(result).toEqual({ ok: false, error: 'media_library_indeterminate' });
    expect(insertChain.insert).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});

describe('persistOutboundAudioMediaLibrary — 23505', () => {
  function uniqueErr() {
    return { code: '23505', message: 'duplicate key' };
  }

  it('winner idêntico → sucesso idempotente filtrado por company_id + source_ref', async () => {
    const insertChain = makeInsertChain({ data: null, error: uniqueErr() });
    const selectChain = makeSelectChain();
    const supabase = makeSvc(insertChain, selectChain);
    const result = await persistOutboundAudioMediaLibrary({
      supabase,
      context: context(),
    });
    expect(result).toEqual({
      ok: true,
      idempotent: true,
      mediaAssetId: ASSET_ID,
    });
    expect(insertChain.insert).toHaveBeenCalledTimes(1);
    expect(supabase.from.mock.calls.map(([table]) => table)).toEqual([
      COMPANY_MEDIA_LIBRARY_TABLE,
      COMPANY_MEDIA_LIBRARY_TABLE,
    ]);
    expect(selectChain.eq).toHaveBeenCalledWith('company_id', COMPANY_A);
    expect(selectChain.eq).toHaveBeenCalledWith('source_ref', SOURCE_REF);
    expect(selectChain.eq).not.toHaveBeenCalledWith('company_id', COMPANY_B);
  });

  it('winner divergente, ausente, incompleto ou SELECT falho → não faz segundo INSERT', async () => {
    const cases = [
      {
        select: makeSelectChain({ data: storedRow({ company_id: COMPANY_B }) }),
        error: 'media_library_conflict',
      },
      {
        select: makeSelectChain({
          data: storedRow({
            s3_key: `clientes/${COMPANY_A}/meta-outbound/${OPERATION_B}/audio.m4a`,
          }),
        }),
        error: 'media_library_conflict',
      },
      {
        select: makeSelectChain({ data: storedRow({ mime_type: 'audio/ogg' }) }),
        error: 'media_library_conflict',
      },
      {
        select: makeSelectChain({ data: storedRow({ file_size: 1 }) }),
        error: 'media_library_conflict',
      },
      {
        select: makeSelectChain({ data: null }),
        error: 'media_library_indeterminate',
      },
      {
        select: makeSelectChain({ data: null, error: { code: 'PGRST301' } }),
        error: 'media_library_indeterminate',
      },
      {
        select: {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockRejectedValue(new Error('select boom')),
        },
        error: 'media_library_indeterminate',
      },
      {
        select: makeSelectChain({
          data: (() => {
            const { file_size: _omit, ...row } = storedRow();
            return row;
          })(),
        }),
        error: 'media_library_indeterminate',
      },
      {
        select: makeSelectChain({ data: storedRow({ id: 'bad' }) }),
        error: 'media_library_indeterminate',
      },
      {
        select: makeSelectChain({ data: [storedRow(), storedRow({ id: ASSET_ID })] }),
        error: 'media_library_indeterminate',
      },
    ];

    for (const item of cases) {
      const insertChain = makeInsertChain({ data: null, error: uniqueErr() });
      const supabase = makeSvc(insertChain, item.select);
      const result = await persistOutboundAudioMediaLibrary({
        supabase,
        context: context(),
      });
      expect(result).toEqual({ ok: false, error: item.error });
      expect(insertChain.insert).toHaveBeenCalledTimes(1);
      expect(supabase.from).toHaveBeenCalledTimes(2);
    }
  });
});

describe('persistOutboundAudioMediaLibrary — segurança', () => {
  it('não muta o context e não devolve payload sensível', async () => {
    const input = Object.freeze(context());
    const before = JSON.stringify(input);
    const result = await persistOutboundAudioMediaLibrary({
      supabase: makeSvc(makeInsertChain()),
      context: input,
    });
    expect(JSON.stringify(input)).toBe(before);
    expect(result).not.toHaveProperty('s3_key');
    expect(result).not.toHaveProperty('audioSha256');
    expect(JSON.stringify(result)).not.toContain('accessToken');
    expect(JSON.stringify(result)).not.toContain(SHA);
  });

  it('fonte sem AWS, Graph, HTTP, env, UPDATE, DELETE ou UPSERT', () => {
    const executable = SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(executable).not.toContain('getSupabaseAdmin');
    expect(executable).not.toContain('@aws-sdk');
    expect(executable).not.toContain('graphClient');
    expect(executable).not.toContain('uploadMedia');
    expect(executable).not.toContain('sendAudioMessage');
    expect(executable).not.toContain('process.env');
    expect(executable).not.toContain('.update(');
    expect(executable).not.toContain('.delete(');
    expect(executable).not.toContain('upsert');
    expect(executable).not.toContain('onConflict');
    expect(executable).not.toContain('markCompleted');
    expect(executable).not.toContain('meta_whatsapp_messages');
    expect(executable).not.toContain('meta_messages');
    expect(executable).toContain("eq('company_id'");
    expect(executable).toContain("eq('source_ref'");
  });
});
