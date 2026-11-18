// =============================================================================
// outboundAudioPersistenceContracts.test.js — B3.2-C.3-D.3-E.2-B.3
// Funções puras. Zero rede, SQL, S3, Graph ou process.env.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMetaOutboundAudioSourceRef,
  buildOutboundAudioChatInsert,
  buildOutboundAudioMediaLibraryInsert,
  buildOutboundAudioTrackingInsert,
  compareOutboundAudioChat,
  compareOutboundAudioMediaLibrary,
  compareOutboundAudioTracking,
  PERSIST_COMPARE,
} from '../outboundAudioPersistenceContracts.js';

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../outboundAudioPersistenceContracts.js'),
  'utf8',
);

const COMPANY_A = 'aaaa0000-0000-4000-8000-000000000001';
const COMPANY_B = 'bbbb0000-0000-4000-8000-000000000002';
const INSTANCE_A = 'cccc0000-0000-4000-8000-000000000003';
const INSTANCE_B = 'dddd0000-0000-4000-8000-000000000004';
const CONVERSATION_A = 'eeee0000-0000-4000-8000-000000000005';
const CONVERSATION_B = 'ffff0000-0000-4000-8000-000000000006';
const OPERATION_A = '11111111-1111-4111-8111-111111111111';
const OPERATION_B = '22222222-2222-4222-8222-222222222222';
const OPERATION_UPPER = 'A0B1C2D3-E4F5-4A67-8B90-123456789ABC';
const OPERATION_CANONICAL = 'a0b1c2d3-e4f5-4a67-8b90-123456789abc';
const UUID_V1 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const ASSET_A = '99999999-0000-4000-8000-000000000009';
const ASSET_B = '88888888-0000-4000-8000-000000000008';
const SHA = 'a'.repeat(64);
const WAMID = 'wamid.HBgLNTU1MTk4NzY1NDMyMQIVAgARGBI4NzY1NDMyMQ==';
const WAMID_B = 'wamid.OTHERFAKEWAMID==';
const SIZE = 2048;
const TS_A = '2026-11-18T18:00:00.000Z';
const TS_B = '2026-11-18T19:30:00.123Z';
const S3_A =
  `clientes/${COMPANY_A}/meta-outbound/${OPERATION_A}/audio.m4a`;
const S3_OTHER_COMPANY =
  `clientes/${COMPANY_B}/meta-outbound/${OPERATION_A}/audio.m4a`;
const S3_OTHER_OP =
  `clientes/${COMPANY_A}/meta-outbound/${OPERATION_B}/audio.m4a`;

function cmlContext(overrides = {}) {
  return {
    companyId: COMPANY_A,
    operationId: OPERATION_A,
    audioSha256: SHA,
    s3Key: S3_A,
    audioSizeBytes: SIZE,
    ...overrides,
  };
}

function trackingContext(overrides = {}) {
  return {
    companyId: COMPANY_A,
    instanceId: INSTANCE_A,
    wamid: WAMID,
    ...overrides,
  };
}

function chatContext(overrides = {}) {
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

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called in persistence contract tests');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('identidade', () => {
  it('UUIDs válidos constroem CML, tracking e chat', () => {
    expect(buildOutboundAudioMediaLibraryInsert(cmlContext()).ok).toBe(true);
    expect(buildOutboundAudioTrackingInsert(trackingContext()).ok).toBe(true);
    expect(buildOutboundAudioChatInsert(chatContext()).ok).toBe(true);
  });

  it('UUID inválido é rejeitado', () => {
    expect(buildOutboundAudioMediaLibraryInsert(cmlContext({
      companyId: 'not-a-uuid',
    })).reason).toBe('invalid_company_id');
    expect(buildOutboundAudioTrackingInsert(trackingContext({
      instanceId: 'nope',
    })).reason).toBe('invalid_instance_id');
    expect(buildOutboundAudioChatInsert(chatContext({
      mediaAssetId: 'x',
    })).reason).toBe('invalid_media_asset_id');
  });

  it('operationId que não é UUIDv4 é rejeitado', () => {
    expect(buildMetaOutboundAudioSourceRef(UUID_V1).ok).toBe(false);
    expect(buildOutboundAudioMediaLibraryInsert(cmlContext({
      operationId: UUID_V1,
      s3Key: `clientes/${COMPANY_A}/meta-outbound/${UUID_V1}/audio.m4a`,
    })).reason).toBe('invalid_operation_id');
  });

  it('SHA-256 inválido é rejeitado', () => {
    expect(buildOutboundAudioMediaLibraryInsert(cmlContext({
      audioSha256: 'ZZ',
    })).reason).toBe('invalid_audio_sha256');
    expect(buildOutboundAudioMediaLibraryInsert(cmlContext({
      audioSha256: 'A'.repeat(64),
    })).reason).toBe('invalid_audio_sha256');
  });

  it('wamid, companyId, instanceId e conversationId ausentes são rejeitados', () => {
    expect(buildOutboundAudioTrackingInsert(trackingContext({ wamid: '' })).ok).toBe(false);
    expect(buildOutboundAudioTrackingInsert({
      instanceId: INSTANCE_A,
      wamid: WAMID,
    }).reason).toBe('invalid_company_id');
    expect(buildOutboundAudioTrackingInsert({
      companyId: COMPANY_A,
      wamid: WAMID,
    }).reason).toBe('invalid_instance_id');
    expect(buildOutboundAudioChatInsert({
      companyId: COMPANY_A,
      instanceId: INSTANCE_A,
      wamid: WAMID,
      mediaAssetId: ASSET_A,
      providerTimestamp: TS_A,
    }).reason).toBe('invalid_conversation_id');
  });

  it('s3Key de outra empresa ou operação é rejeitada', () => {
    expect(buildOutboundAudioMediaLibraryInsert(cmlContext({
      s3Key: S3_OTHER_COMPANY,
    })).reason).toBe('invalid_s3_key');
    expect(buildOutboundAudioMediaLibraryInsert(cmlContext({
      s3Key: S3_OTHER_OP,
    })).reason).toBe('invalid_s3_key');
  });
});

describe('source_ref', () => {
  it('é determinístico e canônico', () => {
    const first = buildMetaOutboundAudioSourceRef(OPERATION_A);
    const second = buildMetaOutboundAudioSourceRef(OPERATION_A);
    const upper = buildMetaOutboundAudioSourceRef(OPERATION_UPPER);
    expect(first).toEqual({
      ok: true,
      sourceRef: `meta-outbound:${OPERATION_A}`,
      operationId: OPERATION_A,
    });
    expect(second.sourceRef).toBe(first.sourceRef);
    expect(upper.sourceRef).toBe(`meta-outbound:${OPERATION_CANONICAL}`);
    expect(buildMetaOutboundAudioSourceRef('not-uuid').ok).toBe(false);
  });
});

describe('CML', () => {
  it('constrói campos exatos sem token, telefone ou URL', () => {
    const built = buildOutboundAudioMediaLibraryInsert(cmlContext());
    expect(built.row).toEqual({
      company_id: COMPANY_A,
      folder_path: '/',
      original_filename: 'audio.m4a',
      s3_key: S3_A,
      file_type: 'audio',
      mime_type: 'audio/mp4',
      file_size: SIZE,
      preview_url: null,
      created_by: null,
      source_ref: `meta-outbound:${OPERATION_A}`,
    });
    expect(JSON.stringify(built)).not.toContain('accessToken');
    expect(JSON.stringify(built)).not.toContain('5511');
  });

  it('registro idêntico → match; divergências → conflict; ausente → indeterminate', () => {
    const expected = buildOutboundAudioMediaLibraryInsert(cmlContext()).row;
    expect(compareOutboundAudioMediaLibrary(expected, expected)).toEqual({
      result: PERSIST_COMPARE.MATCH,
      reason: 'identity_match',
    });
    expect(compareOutboundAudioMediaLibrary(
      { ...expected, company_id: COMPANY_B },
      expected,
    ).reason).toBe('company_mismatch');
    expect(compareOutboundAudioMediaLibrary(
      { ...expected, s3_key: S3_OTHER_OP },
      expected,
    ).reason).toBe('s3_key_mismatch');
    expect(compareOutboundAudioMediaLibrary(
      { ...expected, source_ref: `meta-outbound:${OPERATION_B}` },
      expected,
    ).reason).toBe('source_ref_mismatch');
    expect(compareOutboundAudioMediaLibrary(
      { ...expected, mime_type: 'audio/ogg' },
      expected,
    ).reason).toBe('media_metadata_mismatch');
    expect(compareOutboundAudioMediaLibrary(
      { ...expected, file_size: SIZE + 1 },
      expected,
    ).reason).toBe('media_metadata_mismatch');
    const { file_size: _omit, ...missing } = expected;
    expect(compareOutboundAudioMediaLibrary(missing, expected)).toEqual({
      result: PERSIST_COMPARE.INDETERMINATE,
      reason: 'missing_required_field',
    });
    expect(JSON.stringify(compareOutboundAudioMediaLibrary(expected, expected)))
      .not.toContain(SHA);
  });
});

describe('tracking', () => {
  it('constrói o INSERT mínimo com status accepted', () => {
    const built = buildOutboundAudioTrackingInsert(trackingContext());
    expect(built.row).toEqual({
      company_id: COMPANY_A,
      instance_id: INSTANCE_A,
      meta_message_id: WAMID,
      status: 'accepted',
    });
    expect(built.row).not.toHaveProperty('conversation_id');
    expect(built.row).not.toHaveProperty('to');
    expect(built.row).not.toHaveProperty('message_type');
  });

  it('status de entrega existente não impede match e não é alterado', () => {
    const expected = buildOutboundAudioTrackingInsert(trackingContext()).row;
    for (const status of ['accepted', 'sent', 'delivered', 'read', 'failed']) {
      const existing = { ...expected, status };
      const frozen = Object.freeze({ ...existing });
      const result = compareOutboundAudioTracking(frozen, expected);
      expect(result).toEqual({
        result: PERSIST_COMPARE.MATCH,
        reason: 'identity_match',
      });
      expect(frozen.status).toBe(status);
    }
  });

  it('empresa, instância ou wamid divergentes → conflict', () => {
    const expected = buildOutboundAudioTrackingInsert(trackingContext()).row;
    expect(compareOutboundAudioTracking(
      { ...expected, company_id: COMPANY_B },
      expected,
    ).reason).toBe('company_mismatch');
    expect(compareOutboundAudioTracking(
      { ...expected, instance_id: INSTANCE_B },
      expected,
    ).reason).toBe('instance_mismatch');
    expect(compareOutboundAudioTracking(
      { ...expected, meta_message_id: WAMID_B },
      expected,
    ).reason).toBe('wamid_mismatch');
  });
});

describe('chat', () => {
  it('constrói outbound/audio/body null sem URL', () => {
    const built = buildOutboundAudioChatInsert(chatContext());
    expect(built.row).toEqual({
      company_id: COMPANY_A,
      instance_id: INSTANCE_A,
      conversation_id: CONVERSATION_A,
      meta_message_id: WAMID,
      direction: 'outbound',
      message_type: 'audio',
      body: null,
      media_asset_id: ASSET_A,
      provider_timestamp: TS_A,
    });
    expect(JSON.stringify(built.row)).not.toContain('https://');
    expect(built.row).not.toHaveProperty('preview_url');
  });

  it('mesmo asset → match; asset/conversa/empresa/direção/tipo divergentes → conflict', () => {
    const expected = buildOutboundAudioChatInsert(chatContext()).row;
    expect(compareOutboundAudioChat(expected, expected).result).toBe('match');
    expect(compareOutboundAudioChat(
      { ...expected, media_asset_id: ASSET_B },
      expected,
    ).reason).toBe('asset_mismatch');
    expect(compareOutboundAudioChat(
      { ...expected, conversation_id: CONVERSATION_B },
      expected,
    ).reason).toBe('conversation_mismatch');
    expect(compareOutboundAudioChat(
      { ...expected, company_id: COMPANY_B },
      expected,
    ).reason).toBe('company_mismatch');
    expect(compareOutboundAudioChat(
      { ...expected, direction: 'inbound' },
      expected,
    ).reason).toBe('direction_mismatch');
    expect(compareOutboundAudioChat(
      { ...expected, message_type: 'text', body: 'oi' },
      expected,
    ).reason).toBe('message_type_mismatch');
  });

  it('provider_timestamp diferente ainda dá match; campo obrigatório ausente → indeterminate', () => {
    const expected = buildOutboundAudioChatInsert(chatContext()).row;
    const later = buildOutboundAudioChatInsert(chatContext({
      providerTimestamp: TS_B,
    })).row;
    expect(compareOutboundAudioChat(
      { ...expected, provider_timestamp: later.provider_timestamp },
      expected,
    )).toEqual({ result: 'match', reason: 'identity_match' });
    const { media_asset_id: _omit, ...missing } = expected;
    expect(compareOutboundAudioChat(missing, expected).result).toBe('indeterminate');
  });
});

describe('pureza', () => {
  it('não importa Supabase, AWS SDK, Graph Client nem process.env', () => {
    const executable = SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(executable).not.toContain('@supabase');
    expect(executable).not.toContain('@aws-sdk');
    expect(executable).not.toContain('graphClient');
    expect(executable).not.toContain('process.env');
    expect(executable).not.toContain('Date.now');
    expect(executable).not.toContain('.from(');
    expect(executable).not.toContain('.rpc(');
    expect(executable).not.toContain('fetch(');
    expect(executable).not.toContain('uploadMedia');
    expect(executable).not.toContain('sendAudioMessage');
  });

  it('não muta objetos recebidos e não chama rede', () => {
    const expected = buildOutboundAudioMediaLibraryInsert(cmlContext()).row;
    const existing = Object.freeze({
      ...expected,
      file_type: 'audio',
    });
    const before = JSON.stringify(existing);
    compareOutboundAudioMediaLibrary(existing, expected);
    expect(JSON.stringify(existing)).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  });
});
