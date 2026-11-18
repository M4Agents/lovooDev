// =============================================================================
// awsOutboundAudio.test.js — B3.2-C.3-D.3-E.2-B.1
// Mocks locais. Zero S3 real, Graph, SQL, .env ou rede.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { META_OUTBOUND_AUDIO_MAX_BYTES } from '../audioBytes.js';

const mockSend = vi.hoisted(() => vi.fn());
const constructedCmds = vi.hoisted(() => []);
const mockS3ClientCtor = vi.hoisted(() => vi.fn(() => {
  throw new Error('S3Client must not be constructed by awsOutboundAudio');
}));

vi.mock('@aws-sdk/client-s3', () => {
  class PutObjectCommand {
    constructor(input) {
      this.input = input;
      this.__type = 'PutObject';
      constructedCmds.push(this);
    }
  }
  class HeadObjectCommand {
    constructor(input) {
      this.input = input;
      this.__type = 'HeadObject';
      constructedCmds.push(this);
    }
  }
  class S3Client {
    constructor(config) {
      mockS3ClientCtor(config);
    }
  }
  return { PutObjectCommand, HeadObjectCommand, S3Client };
});

import {
  META_OUTBOUND_AUDIO_S3_CONTENT_TYPE,
  META_OUTBOUND_AUDIO_S3_FILENAME,
  buildMetaOutboundAudioS3Key,
  uploadMetaOutboundAudio,
} from '../awsOutboundAudio.js';

const COMPANY_A = 'aaaa0000-0000-4000-8000-000000000001';
const COMPANY_B = 'bbbb0000-0000-4000-8000-000000000002';
const OPERATION_A = '11111111-1111-4111-8111-111111111111';
const OPERATION_UPPER = 'A0B1C2D3-E4F5-4A67-8B90-123456789ABC';
const OPERATION_CANONICAL = 'a0b1c2d3-e4f5-4a67-8b90-123456789abc';
const UUID_V1 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const BUCKET = 'test-lovoo-media-bucket';

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../awsOutboundAudio.js'),
  'utf8',
);

function u32(n) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n >>> 0, 0);
  return buf;
}

function fourcc(type) {
  return Buffer.from(type, 'ascii');
}

function box(type, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.concat(payload);
  return Buffer.concat([u32(8 + body.length), fourcc(type), body]);
}

function hdlr(handlerName) {
  return box('hdlr', [
    Buffer.alloc(8),
    fourcc(handlerName),
    Buffer.alloc(12),
    Buffer.from([0x00]),
  ]);
}

function mp4aPayload(extra) {
  const fields = Buffer.alloc(28);
  fields[7] = 0x01;
  fields[17] = 0x02;
  fields[19] = 0x10;
  fields.writeUInt32BE((44100 * 65536) >>> 0, 24);
  return extra ? Buffer.concat([fields, extra]) : fields;
}

function esdsAacLc() {
  return box('esds', Buffer.from([
    0x00, 0x00, 0x00, 0x00,
    0x03, 0x19,
    0x00, 0x00,
    0x00,
    0x04, 0x11,
    0x40,
    0x15,
    0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x05, 0x02,
    0x12, 0x10,
    0x06, 0x01,
    0x02,
  ]));
}

function stsdWith(sampleEntry) {
  return box('stsd', [Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]), sampleEntry]);
}

function audioTrack(withEsds) {
  const extra = withEsds ? esdsAacLc() : null;
  const sample = box('mp4a', mp4aPayload(extra));
  return box('trak', [
    box('mdia', [
      hdlr('soun'),
      box('minf', [box('stbl', [stsdWith(sample)])]),
    ]),
  ]);
}

function buildAudioMp4(withEsds = false) {
  return Buffer.concat([
    box('ftyp', [fourcc('isom'), u32(0), fourcc('isom'), fourcc('iso2'), fourcc('mp41')]),
    box('moov', [audioTrack(withEsds)]),
  ]);
}

function webmBytes() {
  return Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01]);
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

const VALID_BYTES = buildAudioMp4(true);
const VALID_SHA = sha256(VALID_BYTES);
const EXPECTED_KEY_A =
  `clientes/${COMPANY_A}/meta-outbound/${OPERATION_A}/${META_OUTBOUND_AUDIO_S3_FILENAME}`;

function makeClient() {
  return { send: mockSend };
}

function baseUpload(overrides = {}) {
  return {
    companyId: COMPANY_A,
    operationId: OPERATION_A,
    audioBytes: VALID_BYTES,
    audioSha256: VALID_SHA,
    s3Client: makeClient(),
    bucket: BUCKET,
    ...overrides,
  };
}

function cmdsOf(type) {
  return constructedCmds.filter((cmd) => cmd.__type === type);
}

function lastCmd(type) {
  return [...constructedCmds].reverse().find((cmd) => cmd.__type === type);
}

function preconditionFailed() {
  return Object.assign(new Error('PreconditionFailed'), {
    name: 'PreconditionFailed',
    $metadata: { httpStatusCode: 412 },
  });
}

function matchingHead(overrides = {}) {
  return {
    ContentLength: VALID_BYTES.length,
    ContentType: META_OUTBOUND_AUDIO_S3_CONTENT_TYPE,
    Metadata: {
      'audio-sha256': VALID_SHA,
      'operation-id': OPERATION_A,
      'company-id': COMPANY_A,
    },
    ETag: '"not-a-sha256-etag"',
    ...overrides,
  };
}

beforeEach(() => {
  mockSend.mockReset();
  mockS3ClientCtor.mockClear();
  constructedCmds.length = 0;
  mockSend.mockResolvedValue({});
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called in awsOutboundAudio tests');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildMetaOutboundAudioS3Key', () => {
  it('gera key determinística isolada por empresa', () => {
    const first = buildMetaOutboundAudioS3Key({
      companyId: COMPANY_A,
      operationId: OPERATION_A,
    });
    const second = buildMetaOutboundAudioS3Key({
      companyId: COMPANY_A,
      operationId: OPERATION_A,
    });
    expect(first).toEqual({
      ok: true,
      objectKey: EXPECTED_KEY_A,
      companyId: COMPANY_A,
      operationId: OPERATION_A,
    });
    expect(second.objectKey).toBe(first.objectKey);
  });

  it('empresas diferentes nunca compartilham key', () => {
    const a = buildMetaOutboundAudioS3Key({
      companyId: COMPANY_A,
      operationId: OPERATION_A,
    });
    const b = buildMetaOutboundAudioS3Key({
      companyId: COMPANY_B,
      operationId: OPERATION_A,
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.objectKey).not.toBe(b.objectKey);
    expect(b.objectKey).toBe(
      `clientes/${COMPANY_B}/meta-outbound/${OPERATION_A}/audio.m4a`,
    );
  });

  it('canonicaliza operationId UUID v4', () => {
    const result = buildMetaOutboundAudioS3Key({
      companyId: COMPANY_A.toUpperCase(),
      operationId: OPERATION_UPPER,
    });
    expect(result.ok).toBe(true);
    expect(result.operationId).toBe(OPERATION_CANONICAL);
    expect(result.objectKey).toBe(
      `clientes/${COMPANY_A}/meta-outbound/${OPERATION_CANONICAL}/audio.m4a`,
    );
  });

  it('rejeita UUID inválido e path traversal', () => {
    expect(buildMetaOutboundAudioS3Key({
      companyId: 'not-a-uuid',
      operationId: OPERATION_A,
    }).ok).toBe(false);
    expect(buildMetaOutboundAudioS3Key({
      companyId: COMPANY_A,
      operationId: UUID_V1,
    }).ok).toBe(false);
    expect(buildMetaOutboundAudioS3Key({
      companyId: '../' + COMPANY_A,
      operationId: OPERATION_A,
    }).ok).toBe(false);
    expect(buildMetaOutboundAudioS3Key({
      companyId: COMPANY_A,
      operationId: `${OPERATION_A}/../evil`,
    }).ok).toBe(false);
    expect(buildMetaOutboundAudioS3Key({
      companyId: COMPANY_A,
      operationId: '%2e%2e/' + OPERATION_A,
    }).ok).toBe(false);
  });
});

describe('uploadMetaOutboundAudio — validação', () => {
  it('rejeita buffer vazio, maior que 4 MiB, SHA inválido e SHA divergente', async () => {
    await expect(uploadMetaOutboundAudio(baseUpload({
      audioBytes: Buffer.alloc(0),
    }))).resolves.toEqual({ ok: false, error: 'invalid_input' });
    await expect(uploadMetaOutboundAudio(baseUpload({
      audioBytes: Buffer.alloc(META_OUTBOUND_AUDIO_MAX_BYTES + 1, 1),
      audioSha256: sha256(Buffer.alloc(META_OUTBOUND_AUDIO_MAX_BYTES + 1, 1)),
    }))).resolves.toEqual({ ok: false, error: 'audio_too_large' });
    await expect(uploadMetaOutboundAudio(baseUpload({
      audioSha256: 'ZZ',
    }))).resolves.toEqual({ ok: false, error: 'invalid_input' });
    await expect(uploadMetaOutboundAudio(baseUpload({
      audioSha256: 'a'.repeat(64),
    }))).resolves.toEqual({ ok: false, error: 'invalid_input' });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rejeita MP4 inválido e AAC-LC não confirmado', async () => {
    const webm = webmBytes();
    await expect(uploadMetaOutboundAudio(baseUpload({
      audioBytes: webm,
      audioSha256: sha256(webm),
    }))).resolves.toEqual({ ok: false, error: 'invalid_audio' });

    const unconfirmed = buildAudioMp4(false);
    await expect(uploadMetaOutboundAudio(baseUpload({
      audioBytes: unconfirmed,
      audioSha256: sha256(unconfirmed),
    }))).resolves.toEqual({ ok: false, error: 'invalid_audio' });
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('uploadMetaOutboundAudio — PutObject', () => {
  it('envia ContentType audio/mp4, IfNoneMatch *, metadata e sem ACL pública', async () => {
    const result = await uploadMetaOutboundAudio(baseUpload());
    expect(result).toEqual({
      ok: true,
      idempotent: false,
      objectKey: EXPECTED_KEY_A,
      contentType: 'audio/mp4',
      sizeBytes: VALID_BYTES.length,
    });
    expect(cmdsOf('PutObject')).toHaveLength(1);
    const input = lastCmd('PutObject').input;
    expect(input.Bucket).toBe(BUCKET);
    expect(input.Key).toBe(EXPECTED_KEY_A);
    expect(input.Body).toBe(VALID_BYTES);
    expect(input.ContentType).toBe('audio/mp4');
    expect(input.IfNoneMatch).toBe('*');
    expect(input.Metadata).toEqual({
      'audio-sha256': VALID_SHA,
      'operation-id': OPERATION_A,
      'company-id': COMPANY_A,
    });
    expect(input.ACL).toBeUndefined();
    expect(JSON.stringify(input)).not.toMatch(/public-read|public-read-write/i);
    expect(result).not.toHaveProperty('url');
    expect(JSON.stringify(result)).not.toContain('accessToken');
    expect(JSON.stringify(result)).not.toContain('AKIA');
    expect(mockS3ClientCtor).not.toHaveBeenCalled();
  });
});

describe('uploadMetaOutboundAudio — idempotência e conflitos', () => {
  it('412 + HeadObject idêntico retorna sucesso idempotente', async () => {
    mockSend
      .mockRejectedValueOnce(preconditionFailed())
      .mockResolvedValueOnce(matchingHead());
    const result = await uploadMetaOutboundAudio(baseUpload());
    expect(result).toEqual({
      ok: true,
      idempotent: true,
      objectKey: EXPECTED_KEY_A,
      contentType: 'audio/mp4',
      sizeBytes: VALID_BYTES.length,
    });
    expect(cmdsOf('PutObject')).toHaveLength(1);
    expect(cmdsOf('HeadObject')).toHaveLength(1);
    expect(lastCmd('HeadObject').input).toEqual({
      Bucket: BUCKET,
      Key: EXPECTED_KEY_A,
    });
    expect(result).not.toHaveProperty('ETag');
  });

  it('412 + hash divergente retorna conflito', async () => {
    mockSend
      .mockRejectedValueOnce(preconditionFailed())
      .mockResolvedValueOnce(matchingHead({
        Metadata: {
          'audio-sha256': 'b'.repeat(64),
          'operation-id': OPERATION_A,
          'company-id': COMPANY_A,
        },
      }));
    const result = await uploadMetaOutboundAudio(baseUpload());
    expect(result).toEqual({
      ok: false,
      error: 'aws_upload_conflict',
      objectKey: EXPECTED_KEY_A,
    });
    expect(cmdsOf('PutObject')).toHaveLength(1);
  });

  it('412 + tamanho divergente retorna conflito', async () => {
    mockSend
      .mockRejectedValueOnce(preconditionFailed())
      .mockResolvedValueOnce(matchingHead({ ContentLength: VALID_BYTES.length + 8 }));
    const result = await uploadMetaOutboundAudio(baseUpload());
    expect(result.error).toBe('aws_upload_conflict');
    expect(cmdsOf('PutObject')).toHaveLength(1);
  });

  it('412 + ContentType divergente retorna conflito', async () => {
    mockSend
      .mockRejectedValueOnce(preconditionFailed())
      .mockResolvedValueOnce(matchingHead({ ContentType: 'audio/ogg' }));
    const result = await uploadMetaOutboundAudio(baseUpload());
    expect(result.error).toBe('aws_upload_conflict');
    expect(cmdsOf('PutObject')).toHaveLength(1);
  });

  it('412 + metadata ausente não confirma idempotência', async () => {
    mockSend
      .mockRejectedValueOnce(preconditionFailed())
      .mockResolvedValueOnce({
        ContentLength: VALID_BYTES.length,
        ContentType: 'audio/mp4',
        Metadata: {},
        ETag: `"${VALID_SHA}"`,
      });
    const result = await uploadMetaOutboundAudio(baseUpload());
    expect(result).toEqual({
      ok: false,
      error: 'aws_upload_indeterminate',
      objectKey: EXPECTED_KEY_A,
    });
    expect(cmdsOf('PutObject')).toHaveLength(1);
  });

  it('HeadObject falha → erro conservador sem novo PutObject', async () => {
    mockSend
      .mockRejectedValueOnce(preconditionFailed())
      .mockRejectedValueOnce(Object.assign(new Error('NotFound'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      }));
    const result = await uploadMetaOutboundAudio(baseUpload());
    expect(result.error).toBe('aws_upload_indeterminate');
    expect(cmdsOf('PutObject')).toHaveLength(1);
    expect(cmdsOf('HeadObject')).toHaveLength(1);
  });
});

describe('uploadMetaOutboundAudio — falhas sem retry', () => {
  it('timeout, rede e 5xx não repetem PutObject', async () => {
    const cases = [
      Object.assign(new Error('Timeout'), { name: 'TimeoutError' }),
      Object.assign(new Error('ECONNRESET'), { name: 'NetworkingError' }),
      Object.assign(new Error('InternalError'), {
        name: 'InternalError',
        $metadata: { httpStatusCode: 500 },
      }),
    ];
    for (const err of cases) {
      constructedCmds.length = 0;
      mockSend.mockReset();
      mockSend.mockRejectedValueOnce(err);
      const result = await uploadMetaOutboundAudio(baseUpload());
      expect(result).toEqual({
        ok: false,
        error: 'aws_upload_transient',
        objectKey: EXPECTED_KEY_A,
      });
      expect(cmdsOf('PutObject')).toHaveLength(1);
      expect(cmdsOf('HeadObject')).toHaveLength(0);
      expect(mockSend).toHaveBeenCalledTimes(1);
    }
  });
});

describe('uploadMetaOutboundAudio — isolamento', () => {
  it('não chama Graph, SQL, S3Client global nem serializa token/áudio', async () => {
    const result = await uploadMetaOutboundAudio(baseUpload());
    expect(result.ok).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(mockS3ClientCtor).not.toHaveBeenCalled();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('EAA');
    expect(serialized).not.toContain(VALID_BYTES.toString('hex'));
    expect(serialized).not.toContain(VALID_BYTES.toString('base64'));

    const executable = SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(executable).not.toContain('process.env');
    expect(executable).not.toContain('uploadMedia');
    expect(executable).not.toContain('sendAudioMessage');
    expect(executable).not.toContain('decryptMetaToken');
    expect(executable).not.toContain('from(');
    expect(executable).not.toContain('.rpc(');
    expect(executable).not.toContain('orchestrateOutboundAudioSend');
    expect(executable).not.toContain('send-audio');
    expect(executable).not.toContain('ACL');
    expect(executable).not.toContain('public-read');
    expect(executable).not.toContain('ETag');
    expect(executable).not.toContain('new S3Client');
  });
});
