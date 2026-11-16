// =============================================================================
// awsUpload.test.js  (MVP5.B3.2.AWS-1)
//
// Testes unitários do helper backend AWS S3 para áudio inbound Meta.
// Zero AWS real, zero Graph, zero banco, zero rede.
//
// COBERTURA:
//   AU-01  upload com companyId válido
//   AU-02  key no prefixo clientes/{companyId}/meta-inbound/{uuid}/{filename}
//   AU-03  MIME preservado no ContentType
//   AU-04  ausência de ACL pública
//   AU-05  credencial ausente
//   AU-06  falha AWS transitória (upload)
//   AU-07  falha AWS não transitória (upload)
//   AU-08  signed URL via getSignedUrl mockado (não URL pública montada)
//   AU-09  TTL 3600 segundos
//   AU-10  rejeição de key de outro tenant
//   AU-11  rejeição de key Uazapi (whatsapp/)
//   AU-12  rejeição de path traversal
//   AU-13  DeleteObject de uma key específica
//   AU-14  nenhuma exclusão em massa
//   AU-15  isolamento de credenciais entre empresas
//   AU-16  nenhum acesso real à AWS ou Meta
// =============================================================================

import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockSend          = vi.hoisted(() => vi.fn());
const mockGetSignedUrl  = vi.hoisted(() => vi.fn());
const mockS3ClientCtor  = vi.hoisted(() => vi.fn());
const constructedCmds   = vi.hoisted(() => []);

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    constructor(config) {
      mockS3ClientCtor(config);
      this.config = config;
      this.send = mockSend;
    }
  }
  class PutObjectCommand {
    constructor(input) {
      this.input = input;
      this.__type = 'PutObject';
      constructedCmds.push(this);
    }
  }
  class GetObjectCommand {
    constructor(input) {
      this.input = input;
      this.__type = 'GetObject';
      constructedCmds.push(this);
    }
  }
  class DeleteObjectCommand {
    constructor(input) {
      this.input = input;
      this.__type = 'DeleteObject';
      constructedCmds.push(this);
    }
  }
  class ListObjectsV2Command {
    constructor(input) {
      this.input = input;
      this.__type = 'ListObjectsV2';
      constructedCmds.push(this);
    }
  }
  class DeleteObjectsCommand {
    constructor(input) {
      this.input = input;
      this.__type = 'DeleteObjects';
      constructedCmds.push(this);
    }
  }
  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    DeleteObjectsCommand,
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args) => mockGetSignedUrl(...args),
}));

import {
  uploadMetaInboundAudio,
  signMetaInboundAudioGetUrl,
  deleteMetaInboundAudioObject,
  SIGNED_URL_TTL_SECONDS,
} from '../awsUpload.js';

// =============================================================================
// Fixtures — fictícios, nunca reais
// =============================================================================

const COMPANY_A = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const COMPANY_B = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const OBJECT_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
const FILENAME  = 'inbound.ogg';
const MIME      = 'audio/ogg';
const BYTES     = Buffer.from('fake-ogg-opus-bytes-not-real');

const AUTHORIZED_KEY = `clientes/${COMPANY_A}/meta-inbound/${OBJECT_ID}/${FILENAME}`;

const FAKE_SIGNED_URL =
  'https://example-bucket.s3.sa-east-1.amazonaws.com/fake-key?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef';

function makeCreds(companyId, suffix) {
  return {
    id:                 `cred-${suffix}`,
    company_id:         companyId,
    access_key_id:      `AKIAFAKE${suffix}`,
    secret_access_key:  `secret-fake-${suffix}-not-real`,
    region:             'sa-east-1',
    bucket:             'aws-lovoocrm-media',
    is_active:          true,
  };
}

function makeSvc(credsOrError) {
  const rpc = vi.fn().mockImplementation(async (fn, args) => {
    if (typeof credsOrError === 'function') {
      return credsOrError(fn, args);
    }
    if (credsOrError && credsOrError.error) {
      return { data: null, error: credsOrError.error };
    }
    if (credsOrError && credsOrError.empty) {
      return { data: [], error: null };
    }
    return { data: [credsOrError], error: null };
  });
  return { rpc };
}

const BASE_UPLOAD = {
  companyId: COMPANY_A,
  objectId:  OBJECT_ID,
  bytes:     BYTES,
  mimeType:  MIME,
  filename:  FILENAME,
};

beforeEach(() => {
  mockSend.mockReset();
  mockGetSignedUrl.mockReset();
  mockS3ClientCtor.mockReset();
  constructedCmds.length = 0;
  mockSend.mockResolvedValue({});
  mockGetSignedUrl.mockResolvedValue(FAKE_SIGNED_URL);
});

function lastCmd(type) {
  return [...constructedCmds].reverse().find((c) => c.__type === type);
}

function cmdsOf(type) {
  return constructedCmds.filter((c) => c.__type === type);
}

// =============================================================================
// AU-01..04 — Upload
// =============================================================================

describe('uploadMetaInboundAudio', () => {
  it('AU-01: upload com companyId válido chama PutObject no bucket do tenant', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));

    const result = await uploadMetaInboundAudio({ ...BASE_UPLOAD, svc });

    expect(svc.rpc).toHaveBeenCalledTimes(1);
    expect(svc.rpc).toHaveBeenCalledWith('webhook_resolve_aws_credentials', {
      p_company_id: COMPANY_A,
    });
    expect(mockS3ClientCtor).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);

    const put = lastCmd('PutObject');
    expect(put).toBeDefined();
    expect(put.input.Bucket).toBe('aws-lovoocrm-media');
    expect(put.input.Body).toEqual(BYTES);

    expect(result.objectKey).toBe(AUTHORIZED_KEY);
    expect(result.sizeBytes).toBe(BYTES.length);
    expect(result).not.toHaveProperty('url');
  });

  it('AU-02: key gerada no prefixo clientes/{companyId}/meta-inbound/{uuid}/{filename}', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));

    const result = await uploadMetaInboundAudio({ ...BASE_UPLOAD, svc });

    expect(result.objectKey).toBe(
      `clientes/${COMPANY_A}/meta-inbound/${OBJECT_ID}/${FILENAME}`,
    );
    expect(result.objectKey).not.toContain('/whatsapp/');
    expect(lastCmd('PutObject').input.Key).toBe(result.objectKey);
  });

  it('AU-03: MIME detectado é preservado em ContentType (inclui parâmetros)', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));
    const mimeWithParams = 'audio/ogg; codecs=opus';

    const result = await uploadMetaInboundAudio({
      ...BASE_UPLOAD,
      svc,
      mimeType: mimeWithParams,
    });

    expect(lastCmd('PutObject').input.ContentType).toBe(mimeWithParams);
    expect(result.contentType).toBe(mimeWithParams);
  });

  it('AU-04: PutObject não define ACL pública', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));

    await uploadMetaInboundAudio({ ...BASE_UPLOAD, svc });

    const input = lastCmd('PutObject').input;
    expect(input.ACL).toBeUndefined();
    expect(JSON.stringify(input)).not.toMatch(/public-read|public-read-write/i);
  });

  it('AU-H1: PutObjectCommand contém IfNoneMatch: *', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));

    await uploadMetaInboundAudio({ ...BASE_UPLOAD, svc });

    const input = lastCmd('PutObject').input;
    expect(input.IfNoneMatch).toBe('*');
    expect(input.Bucket).toBe('aws-lovoocrm-media');
    expect(input.Key).toBe(AUTHORIZED_KEY);
    expect(input.Body).toEqual(BYTES);
    expect(input.ContentType).toBe(MIME);
    expect(input.ACL).toBeUndefined();
  });

  it('AU-H2: buffer de exatamente 16 MiB é aceito', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));
    const exactLimit = Buffer.alloc(16 * 1024 * 1024, 1);

    const result = await uploadMetaInboundAudio({
      ...BASE_UPLOAD,
      svc,
      bytes: exactLimit,
    });

    expect(result.sizeBytes).toBe(16 * 1024 * 1024);
    expect(svc.rpc).toHaveBeenCalledTimes(1);
    expect(lastCmd('PutObject').input.Body.length).toBe(16 * 1024 * 1024);
    expect(lastCmd('PutObject').input.IfNoneMatch).toBe('*');
  });

  it('AU-H3: 16 MiB + 1 byte é rejeitado antes da RPC e do SDK', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));
    const oversized = Buffer.alloc(16 * 1024 * 1024 + 1, 1);

    await expect(
      uploadMetaInboundAudio({ ...BASE_UPLOAD, svc, bytes: oversized }),
    ).rejects.toMatchObject({ code: 'aws_upload_invalid_input' });

    expect(svc.rpc).not.toHaveBeenCalled();
    expect(mockS3ClientCtor).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(cmdsOf('PutObject')).toHaveLength(0);
  });

  it('AU-H4: PreconditionFailed / HTTP 412 não é sucesso e não dispara DeleteObject', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));
    mockSend.mockRejectedValueOnce({
      name: 'PreconditionFailed',
      $metadata: { httpStatusCode: 412 },
      message: 'At least one of the pre-conditions you specified did not hold',
    });

    await expect(
      uploadMetaInboundAudio({ ...BASE_UPLOAD, svc }),
    ).rejects.toMatchObject({ code: 'aws_upload_conflict' });

    expect(cmdsOf('DeleteObject')).toHaveLength(0);
    expect(cmdsOf('DeleteObjects')).toHaveLength(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('AU-H5: ConditionalRequestConflict / HTTP 409 não é sucesso e não dispara DeleteObject', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));
    mockSend.mockRejectedValueOnce({
      name: 'ConditionalRequestConflict',
      $metadata: { httpStatusCode: 409 },
      message: 'A conflicting conditional operation is currently in progress',
    });

    await expect(
      uploadMetaInboundAudio({ ...BASE_UPLOAD, svc }),
    ).rejects.toMatchObject({ code: 'aws_upload_conflict' });

    expect(cmdsOf('DeleteObject')).toHaveLength(0);
    expect(cmdsOf('DeleteObjects')).toHaveLength(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('AU-05: credencial ausente → aws_credentials_unavailable; PutObject = 0', async () => {
    const svc = makeSvc({ empty: true });

    await expect(
      uploadMetaInboundAudio({ ...BASE_UPLOAD, svc }),
    ).rejects.toMatchObject({ code: 'aws_credentials_unavailable' });

    expect(mockSend).not.toHaveBeenCalled();
    expect(cmdsOf('PutObject')).toHaveLength(0);
  });

  it('AU-05b: RPC com erro → aws_credentials_unavailable; sem IAM de env', async () => {
    const svc = makeSvc({ error: { message: 'rpc failed' } });

    await expect(
      uploadMetaInboundAudio({ ...BASE_UPLOAD, svc }),
    ).rejects.toMatchObject({ code: 'aws_credentials_unavailable' });

    expect(mockS3ClientCtor).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('AU-06: falha AWS transitória (503) → aws_upload_transient', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));
    mockSend.mockRejectedValueOnce({
      name: 'ServiceUnavailable',
      $metadata: { httpStatusCode: 503 },
      message: 'slow down',
    });

    await expect(
      uploadMetaInboundAudio({ ...BASE_UPLOAD, svc }),
    ).rejects.toMatchObject({ code: 'aws_upload_transient' });
  });

  it('AU-07: falha AWS não transitória (403) → aws_upload_failed', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));
    mockSend.mockRejectedValueOnce({
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
      message: 'Access Denied',
    });

    await expect(
      uploadMetaInboundAudio({ ...BASE_UPLOAD, svc }),
    ).rejects.toMatchObject({ code: 'aws_upload_failed' });
  });

  it('AU-12a: filename com traversal → aws_upload_invalid_input; sem S3', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));

    await expect(
      uploadMetaInboundAudio({ ...BASE_UPLOAD, svc, filename: '../secret.ogg' }),
    ).rejects.toMatchObject({ code: 'aws_upload_invalid_input' });

    await expect(
      uploadMetaInboundAudio({ ...BASE_UPLOAD, svc, filename: 'a/../../x.ogg' }),
    ).rejects.toMatchObject({ code: 'aws_upload_invalid_input' });

    expect(svc.rpc).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('AU-input: companyId / objectId / mime / bytes inválidos', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));

    await expect(
      uploadMetaInboundAudio({ ...BASE_UPLOAD, svc, companyId: 'not-a-uuid' }),
    ).rejects.toMatchObject({ code: 'aws_upload_invalid_input' });

    await expect(
      uploadMetaInboundAudio({ ...BASE_UPLOAD, svc, objectId: COMPANY_A + '/../x' }),
    ).rejects.toMatchObject({ code: 'aws_upload_invalid_input' });

    await expect(
      uploadMetaInboundAudio({ ...BASE_UPLOAD, svc, mimeType: 'image/jpeg' }),
    ).rejects.toMatchObject({ code: 'aws_upload_invalid_input' });

    await expect(
      uploadMetaInboundAudio({ ...BASE_UPLOAD, svc, bytes: Buffer.alloc(0) }),
    ).rejects.toMatchObject({ code: 'aws_upload_invalid_input' });

    expect(mockSend).not.toHaveBeenCalled();
  });
});

// =============================================================================
// AU-08..12 — Signed URL
// =============================================================================

describe('signMetaInboundAudioGetUrl', () => {
  it('AU-08: signed URL verdadeira via getSignedUrl; não monta URL pública', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));

    const result = await signMetaInboundAudioGetUrl({
      svc,
      companyId: COMPANY_A,
      objectKey: AUTHORIZED_KEY,
    });

    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    const [clientArg, commandArg, optsArg] = mockGetSignedUrl.mock.calls[0];
    expect(clientArg).toBeDefined();
    expect(commandArg.__type).toBe('GetObject');
    expect(commandArg.input.Key).toBe(AUTHORIZED_KEY);
    expect(commandArg.input.Bucket).toBe('aws-lovoocrm-media');
    expect(optsArg).toEqual({ expiresIn: 3600 });

    expect(result.url).toBe(FAKE_SIGNED_URL);
    expect(result.url).toContain('X-Amz-Signature=');
    expect(result.url).not.toBe(
      `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${AUTHORIZED_KEY}`,
    );
  });

  it('AU-09: TTL explícito = 3600 segundos', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));

    const result = await signMetaInboundAudioGetUrl({
      svc,
      companyId: COMPANY_A,
      objectKey: AUTHORIZED_KEY,
    });

    expect(SIGNED_URL_TTL_SECONDS).toBe(3600);
    expect(result.expiresIn).toBe(3600);
    expect(mockGetSignedUrl.mock.calls[0][2].expiresIn).toBe(3600);
  });

  it('AU-10: key de outro tenant é rejeitada; getSignedUrl = 0', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));
    const foreignKey = `clientes/${COMPANY_B}/meta-inbound/${OBJECT_ID}/${FILENAME}`;

    await expect(
      signMetaInboundAudioGetUrl({ svc, companyId: COMPANY_A, objectKey: foreignKey }),
    ).rejects.toMatchObject({ code: 'aws_upload_invalid_input' });

    expect(mockGetSignedUrl).not.toHaveBeenCalled();
    expect(svc.rpc).not.toHaveBeenCalled();
  });

  it('AU-11: key Uazapi (whatsapp/) é rejeitada', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));
    const uazapiKey = `clientes/${COMPANY_A}/whatsapp/2026/11/16/${OBJECT_ID}/${FILENAME}`;

    await expect(
      signMetaInboundAudioGetUrl({ svc, companyId: COMPANY_A, objectKey: uazapiKey }),
    ).rejects.toMatchObject({ code: 'aws_upload_invalid_input' });

    await expect(
      deleteMetaInboundAudioObject({ svc, companyId: COMPANY_A, objectKey: uazapiKey }),
    ).rejects.toMatchObject({ code: 'aws_upload_invalid_input' });

    expect(mockGetSignedUrl).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('AU-12: path traversal / URL / prefixo incompleto rejeitados', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));
    const rejected = [
      `clientes/${COMPANY_A}/meta-inbound/../secret.ogg`,
      `clientes/${COMPANY_A}/meta-inbound/${OBJECT_ID}/../../etc/passwd`,
      `clientes/${COMPANY_A}/meta-inbound/${OBJECT_ID}/%2e%2e/${FILENAME}`,
      `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${AUTHORIZED_KEY}`,
      `clientes/${COMPANY_A}/meta-inbound/`,
      `clientes/${COMPANY_A}/meta-inbound/${OBJECT_ID}`,
    ];

    for (const objectKey of rejected) {
      await expect(
        signMetaInboundAudioGetUrl({ svc, companyId: COMPANY_A, objectKey }),
      ).rejects.toMatchObject({ code: 'aws_upload_invalid_input' });
    }

    expect(mockGetSignedUrl).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

// =============================================================================
// AU-13..14 — Cleanup
// =============================================================================

describe('deleteMetaInboundAudioObject', () => {
  it('AU-13: DeleteObject restrito à key específica autorizada', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));

    const result = await deleteMetaInboundAudioObject({
      svc,
      companyId: COMPANY_A,
      objectKey: AUTHORIZED_KEY,
    });

    expect(result.objectKey).toBe(AUTHORIZED_KEY);
    expect(cmdsOf('DeleteObject')).toHaveLength(1);
    expect(lastCmd('DeleteObject').input).toEqual({
      Bucket: 'aws-lovoocrm-media',
      Key:    AUTHORIZED_KEY,
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('AU-14: nenhuma exclusão em massa (sem ListObjects / DeleteObjects / prefixo)', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));

    await deleteMetaInboundAudioObject({
      svc,
      companyId: COMPANY_A,
      objectKey: AUTHORIZED_KEY,
    });

    expect(cmdsOf('ListObjectsV2')).toHaveLength(0);
    expect(cmdsOf('DeleteObjects')).toHaveLength(0);
    expect(lastCmd('DeleteObject').input.Key).toBe(AUTHORIZED_KEY);
    expect(lastCmd('DeleteObject').input.Prefix).toBeUndefined();
    expect(Array.isArray(lastCmd('DeleteObject').input.Delete)).toBe(false);
  });

  it('AU-10b: delete de key de outro tenant é rejeitado', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));
    const foreignKey = `clientes/${COMPANY_B}/meta-inbound/${OBJECT_ID}/${FILENAME}`;

    await expect(
      deleteMetaInboundAudioObject({ svc, companyId: COMPANY_A, objectKey: foreignKey }),
    ).rejects.toMatchObject({ code: 'aws_upload_invalid_input' });

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('AU-06b: delete transitório → aws_delete_transient', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));
    mockSend.mockRejectedValueOnce({
      name: 'SlowDown',
      $metadata: { httpStatusCode: 503 },
    });

    await expect(
      deleteMetaInboundAudioObject({
        svc,
        companyId: COMPANY_A,
        objectKey: AUTHORIZED_KEY,
      }),
    ).rejects.toMatchObject({ code: 'aws_delete_transient' });
  });

  it('AU-07b: delete não transitório → aws_delete_failed', async () => {
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));
    mockSend.mockRejectedValueOnce({
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    });

    await expect(
      deleteMetaInboundAudioObject({
        svc,
        companyId: COMPANY_A,
        objectKey: AUTHORIZED_KEY,
      }),
    ).rejects.toMatchObject({ code: 'aws_delete_failed' });
  });
});

// =============================================================================
// AU-15 — Isolamento de credenciais
// =============================================================================

describe('isolamento multi-tenant de credenciais', () => {
  it('AU-15: empresas distintas usam access keys distintas; RPC por company_id', async () => {
    const credsA = makeCreds(COMPANY_A, 'A');
    const credsB = makeCreds(COMPANY_B, 'B');

    const svc = makeSvc(async (_fn, args) => {
      if (args.p_company_id === COMPANY_A) return { data: [credsA], error: null };
      if (args.p_company_id === COMPANY_B) return { data: [credsB], error: null };
      return { data: [], error: null };
    });

    await uploadMetaInboundAudio({ ...BASE_UPLOAD, svc, companyId: COMPANY_A });
    await uploadMetaInboundAudio({
      ...BASE_UPLOAD,
      svc,
      companyId: COMPANY_B,
      objectId:  OBJECT_ID,
    });

    expect(svc.rpc).toHaveBeenNthCalledWith(1, 'webhook_resolve_aws_credentials', {
      p_company_id: COMPANY_A,
    });
    expect(svc.rpc).toHaveBeenNthCalledWith(2, 'webhook_resolve_aws_credentials', {
      p_company_id: COMPANY_B,
    });

    expect(mockS3ClientCtor).toHaveBeenCalledTimes(2);
    expect(mockS3ClientCtor.mock.calls[0][0].credentials.accessKeyId).toBe(credsA.access_key_id);
    expect(mockS3ClientCtor.mock.calls[1][0].credentials.accessKeyId).toBe(credsB.access_key_id);
    expect(mockS3ClientCtor.mock.calls[0][0].credentials.accessKeyId)
      .not.toBe(mockS3ClientCtor.mock.calls[1][0].credentials.accessKeyId);

    expect(cmdsOf('PutObject')[0].input.Key).toContain(`clientes/${COMPANY_A}/meta-inbound/`);
    expect(cmdsOf('PutObject')[1].input.Key).toContain(`clientes/${COMPANY_B}/meta-inbound/`);
  });
});

// =============================================================================
// AU-16 — Sem I/O real
// =============================================================================

describe('sem I/O real', () => {
  it('AU-16: mocks cobrem S3 e presigner; fetch/env IAM não são usados', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    const svc = makeSvc(makeCreds(COMPANY_A, 'A'));

    await uploadMetaInboundAudio({ ...BASE_UPLOAD, svc });
    await signMetaInboundAudioGetUrl({
      svc,
      companyId: COMPANY_A,
      objectKey: AUTHORIZED_KEY,
    });
    await deleteMetaInboundAudioObject({
      svc,
      companyId: COMPANY_A,
      objectKey: AUTHORIZED_KEY,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalled();
    expect(mockGetSignedUrl).toHaveBeenCalled();

    const clientCfg = mockS3ClientCtor.mock.calls[0][0];
    expect(clientCfg.credentials.accessKeyId).toBe('AKIAFAKEA');
    expect(clientCfg.credentials.accessKeyId).not.toBe(process.env.AWS_ACCESS_KEY_ID);

    fetchSpy.mockRestore();
  });

  it('AU-msg: erros não incluem secrets, signed URL nem keys', async () => {
    const svc = makeSvc({ empty: true });

    await expect(
      uploadMetaInboundAudio({ ...BASE_UPLOAD, svc }),
    ).rejects.toSatisfy((err) => {
      const blob = `${err.message}\n${err.stack ?? ''}`;
      expect(blob).not.toMatch(/AKIA|secret-fake|X-Amz-Signature|EAAAN/i);
      expect(blob).not.toContain(AUTHORIZED_KEY);
      return err.code === 'aws_credentials_unavailable';
    });
  });
});
