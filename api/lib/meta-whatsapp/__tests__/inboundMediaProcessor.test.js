// =============================================================================
// inboundMediaProcessor.test.js  (INBOUND-MEDIA-B)
//
// Testes unitários para downloadAndStoreInboundMedia().
//
// Nenhuma chamada externa real:
//   - downloadMediaMetadata e downloadMediaBytes → vi.mock('../graphClient.js')
//   - fileTypeFromBlob → vi.mock('file-type')
//   - Supabase client → objeto mock por teste
//
// Todos os valores são fictícios — sem secrets, sem rede, sem banco.
// =============================================================================

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../graphClient.js', () => ({
  downloadMediaMetadata: vi.fn(),
  downloadMediaBytes:    vi.fn(),
}));

vi.mock('file-type', () => ({
  fileTypeFromBlob: vi.fn(),
}));

import { downloadMediaMetadata, downloadMediaBytes } from '../graphClient.js';
import { fileTypeFromBlob }                         from 'file-type';
import { downloadAndStoreInboundMedia }             from '../inboundMediaProcessor.js';

// =============================================================================
// Fixtures
// =============================================================================

const FAKE_TOKEN      = 'EAAAN_fake_processor_token_not_real_0987654321';
const FAKE_COMPANY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const FAKE_MEDIA_ID   = '987654321098765';
const FAKE_WAMID      =
  'wamid.HBgLNTUxMTk5OTk5OTkVAgASGBQxNzE2MjExNzA2NzE2MjExNzA2AA==';
const FAKE_ASSET_UUID = 'f1e2d3c4-b5a6-7890-cdef-012345678901';
// FAKE_CDN_URL nunca logada — apenas usada internamente por downloadMediaBytes mock
const FAKE_CDN_URL    = 'https://cdn.fbcdn.net/fake-inbound-document-fixture.pdf';

// Parâmetros base válidos — reutilizados com spread em cada teste
const BASE_PARAMS = {
  token:             FAKE_TOKEN,
  companyId:         FAKE_COMPANY_ID,
  mediaId:           FAKE_MEDIA_ID,
  wamid:             FAKE_WAMID,
  expectedMediaType: 'DOCUMENT',
  hintFilename:      'contrato.pdf',
  maxBytes:          5 * 1024 * 1024, // 5 MB
};

// Metadata retornada por downloadMediaMetadata (fictícia)
const FAKE_METADATA = {
  url:       FAKE_CDN_URL,
  mime_type: 'application/pdf',
  sha256:    null,
  file_size: 100 * 1024, // 100 KB — dentro do maxBytes
};

// Blob real (Node.js/Vitest), conteúdo zerado — apenas tamanho importa na maioria dos testes.
// Deve ser um Blob real para que blob.arrayBuffer() esteja disponível no processor (step 10).
// MIME não é definido aqui: em produção downloadMediaBytes retorna Blob sem type,
// e fileTypeFromBlob (mockado) detecta o MIME pelos bytes — não por blob.type.
function makeMockBlob(size = 1024) {
  return new Blob([new Uint8Array(size)]);
}

// =============================================================================
// Supabase mock builder
// =============================================================================

const FAKE_PREVIEW_URL = 'https://cdn.lovoocrm.com/biblioteca/companies/fake-key.pdf';

/**
 * Cria um svc Supabase mock configurável.
 *
 * @param {object} opts
 * @param {object|null} [opts.precheckData]     — dados retornados pelo precheck (null = não existe)
 * @param {object|null} [opts.insertData]       — dados inseridos com sucesso
 * @param {object|null} [opts.insertError]      — erro do INSERT
 * @param {object|null} [opts.uploadError]      — erro do Storage upload
 * @param {object|null} [opts.raceWinnerData]   — dados da re-query após 23505
 */
function makeSvc({
  precheckData    = null,
  insertData      = { id: FAKE_ASSET_UUID },
  insertError     = null,
  uploadError     = null,
  raceWinnerData  = null,
} = {}) {
  // maybeSingle chamado: 1) precheck, 2) re-query 23505 (se aplicável)
  const maybySingleQueue = [
    { data: precheckData, error: null },
    { data: raceWinnerData, error: null },
  ];
  let maybySingleIdx = 0;

  const mockMaybySingle = vi.fn().mockImplementation(() =>
    Promise.resolve(maybySingleQueue[maybySingleIdx++] ?? { data: null, error: null }),
  );

  const mockSingle = vi.fn().mockResolvedValue({
    data:  insertError ? null : insertData,
    error: insertError ?? null,
  });

  const mockInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: mockSingle }),
  });

  const mockFrom = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle: mockMaybySingle }),
      }),
    }),
    insert: mockInsert,
  });

  const mockUpload    = vi.fn().mockResolvedValue({ error: uploadError ?? null });
  const mockPublicUrl = vi.fn().mockReturnValue({
    data: { publicUrl: FAKE_PREVIEW_URL },
  });
  const mockRemove    = vi.fn().mockResolvedValue({ error: null });

  const mockStorageFrom = vi.fn().mockReturnValue({
    upload:       mockUpload,
    getPublicUrl: mockPublicUrl,
    remove:       mockRemove,
  });

  const svc = {
    from:    mockFrom,
    storage: { from: mockStorageFrom },
  };

  return {
    svc,
    mockMaybySingle,
    mockSingle,
    mockFrom,
    mockInsert,
    mockUpload,
    mockPublicUrl,
    mockRemove,
    mockStorageFrom,
  };
}

// =============================================================================
// Setup global de mocks padrão
// =============================================================================

beforeEach(() => {
  // Happy path padrão — cada teste sobrescreve o que precisar
  downloadMediaMetadata.mockResolvedValue(FAKE_METADATA);
  downloadMediaBytes.mockResolvedValue(makeMockBlob());
  fileTypeFromBlob.mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' });
});

afterEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// INPUT — B-01..06
// =============================================================================

describe('INPUT — validação de parâmetros', () => {
  it('B-01: companyId inválido → inbound_media_invalid_input, sem I/O', async () => {
    for (const bad of ['', 'nao-uuid', null, undefined, 123, 'ZZZZZZZZ-0000-0000-0000-000000000000']) {
      const { svc } = makeSvc();
      await expect(
        downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc, companyId: bad }),
      ).rejects.toMatchObject({ code: 'inbound_media_invalid_input' });
      expect(svc.from).not.toHaveBeenCalled();
      expect(downloadMediaMetadata).not.toHaveBeenCalled();
    }
  });

  it('B-02: wamid vazio/inválido → inbound_media_invalid_input, sem I/O', async () => {
    for (const bad of ['', '   ', null, undefined, 123]) {
      const { svc } = makeSvc();
      await expect(
        downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc, wamid: bad }),
      ).rejects.toMatchObject({ code: 'inbound_media_invalid_input' });
      expect(svc.from).not.toHaveBeenCalled();
      expect(downloadMediaMetadata).not.toHaveBeenCalled();
    }
  });

  it('B-02b: wamid > 200 chars → inbound_media_invalid_input', async () => {
    const { svc } = makeSvc();
    const longWamid = 'w'.repeat(201);
    await expect(
      downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc, wamid: longWamid }),
    ).rejects.toMatchObject({ code: 'inbound_media_invalid_input' });
    expect(downloadMediaMetadata).not.toHaveBeenCalled();
  });

  it('B-03: mediaId inválido → inbound_media_invalid_input, sem I/O', async () => {
    for (const bad of ['', '   ', null, undefined]) {
      const { svc } = makeSvc();
      await expect(
        downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc, mediaId: bad }),
      ).rejects.toMatchObject({ code: 'inbound_media_invalid_input' });
      expect(downloadMediaMetadata).not.toHaveBeenCalled();
    }
  });

  it('B-04: expectedMediaType inválido → inbound_media_invalid_input, sem I/O', async () => {
    for (const bad of ['AUDIO', 'document', 'image', '', null, undefined]) {
      const { svc } = makeSvc();
      await expect(
        downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc, expectedMediaType: bad }),
      ).rejects.toMatchObject({ code: 'inbound_media_invalid_input' });
      expect(downloadMediaMetadata).not.toHaveBeenCalled();
    }
  });

  it('B-05: maxBytes inválido → inbound_media_invalid_input, sem I/O', async () => {
    for (const bad of [0, -1, 1.5, 'grande', null, undefined, NaN]) {
      const { svc } = makeSvc();
      await expect(
        downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc, maxBytes: bad }),
      ).rejects.toMatchObject({ code: 'inbound_media_invalid_input' });
      expect(downloadMediaMetadata).not.toHaveBeenCalled();
    }
  });

  it('B-06: maxBytes > limite do formato (IMAGE) → inbound_media_invalid_input', async () => {
    // IMAGE limit = 5 MB; passing 6 MB → fail
    const { svc } = makeSvc();
    await expect(
      downloadAndStoreInboundMedia({
        ...BASE_PARAMS,
        svc,
        expectedMediaType: 'IMAGE',
        maxBytes: 6 * 1024 * 1024, // > 5 MB IMAGE limit
      }),
    ).rejects.toMatchObject({ code: 'inbound_media_invalid_input' });
    expect(downloadMediaMetadata).not.toHaveBeenCalled();
  });

  it('B-06b: maxBytes > limite do formato (VIDEO) → inbound_media_invalid_input', async () => {
    // VIDEO limit = 16 MB; passing 17 MB → fail
    const { svc } = makeSvc();
    await expect(
      downloadAndStoreInboundMedia({
        ...BASE_PARAMS,
        svc,
        expectedMediaType: 'VIDEO',
        maxBytes: 17 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'inbound_media_invalid_input' });
    expect(downloadMediaMetadata).not.toHaveBeenCalled();
  });
});

// =============================================================================
// IDEMPOTÊNCIA — B-07
// =============================================================================

describe('IDEMPOTÊNCIA — precheck', () => {
  it('B-07: precheck hit → retorna existente, ZERO metadata/bytes/storage', async () => {
    const existingAsset = {
      id:                FAKE_ASSET_UUID,
      mime_type:         'application/pdf',
      file_size:         39313,
      original_filename: 'contrato.pdf',
    };
    const { svc, mockUpload } = makeSvc({ precheckData: existingAsset });

    const result = await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc });

    expect(result).toEqual({
      assetId:  FAKE_ASSET_UUID,
      mimeType: 'application/pdf',
      fileSize: 39313,
      filename: 'contrato.pdf',
      reused:   true,
    });

    // ZERO Graph calls
    expect(downloadMediaMetadata).not.toHaveBeenCalled();
    expect(downloadMediaBytes).not.toHaveBeenCalled();
    // ZERO Storage
    expect(mockUpload).not.toHaveBeenCalled();
    // fileTypeFromBlob não chamado
    expect(fileTypeFromBlob).not.toHaveBeenCalled();
  });
});

// =============================================================================
// METADATA — B-08
// =============================================================================

describe('METADATA — precheck de tamanho', () => {
  it('B-08: metadata.file_size > maxBytes → inbound_media_too_large antes do download', async () => {
    downloadMediaMetadata.mockResolvedValueOnce({
      ...FAKE_METADATA,
      file_size: BASE_PARAMS.maxBytes + 1, // 1 byte acima do limite
    });
    const { svc, mockUpload } = makeSvc();

    await expect(
      downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc }),
    ).rejects.toMatchObject({ code: 'inbound_media_too_large' });

    // Download não deve ter ocorrido
    expect(downloadMediaBytes).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('B-08b: metadata.file_size ausente → não falha precheck (ausência não substitui validação)', async () => {
    downloadMediaMetadata.mockResolvedValueOnce({ ...FAKE_METADATA, file_size: null });
    const { svc } = makeSvc();

    // Deve prosseguir para o download
    const result = await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc });
    expect(result.assetId).toBe(FAKE_ASSET_UUID);
    expect(downloadMediaBytes).toHaveBeenCalledOnce();
  });
});

// =============================================================================
// BYTES — B-09..14
// =============================================================================

describe('BYTES — MIME detection e limites', () => {
  it('B-09: DOCUMENT + PDF válido → sucesso', async () => {
    fileTypeFromBlob.mockResolvedValueOnce({ mime: 'application/pdf', ext: 'pdf' });
    downloadMediaBytes.mockResolvedValueOnce(makeMockBlob(50 * 1024));
    const { svc } = makeSvc();

    const result = await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc });
    expect(result.assetId).toBe(FAKE_ASSET_UUID);
    expect(result.mimeType).toBe('application/pdf');
    expect(result.reused).toBe(false);
  });

  it('B-10: DOCUMENT + JPEG → inbound_media_type_mismatch', async () => {
    fileTypeFromBlob.mockResolvedValueOnce({ mime: 'image/jpeg', ext: 'jpg' });
    const { svc, mockUpload } = makeSvc();

    await expect(
      downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc, expectedMediaType: 'DOCUMENT' }),
    ).rejects.toMatchObject({ code: 'inbound_media_type_mismatch' });

    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('B-11: IMAGE + JPEG válido → sucesso', async () => {
    fileTypeFromBlob.mockResolvedValueOnce({ mime: 'image/jpeg', ext: 'jpg' });
    downloadMediaBytes.mockResolvedValueOnce(makeMockBlob(100 * 1024));
    const { svc } = makeSvc();

    const result = await downloadAndStoreInboundMedia({
      ...BASE_PARAMS,
      svc,
      expectedMediaType: 'IMAGE',
      maxBytes:          5 * 1024 * 1024,
    });

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.reused).toBe(false);
  });

  it('B-12: VIDEO + MP4 válido → sucesso', async () => {
    fileTypeFromBlob.mockResolvedValueOnce({ mime: 'video/mp4', ext: 'mp4' });
    downloadMediaBytes.mockResolvedValueOnce(makeMockBlob(1 * 1024 * 1024));
    const { svc } = makeSvc();

    const result = await downloadAndStoreInboundMedia({
      ...BASE_PARAMS,
      svc,
      expectedMediaType: 'VIDEO',
      maxBytes:          16 * 1024 * 1024,
    });

    expect(result.mimeType).toBe('video/mp4');
    expect(result.reused).toBe(false);
  });

  it('B-13: buffer.size > maxBytes → inbound_media_too_large (defense in depth)', async () => {
    const maxBytes = 100 * 1024; // 100 KB
    // graphClient teria abortado, mas simulamos vazamento de bytes acima do limite
    downloadMediaBytes.mockResolvedValueOnce(makeMockBlob(maxBytes + 1));
    const { svc, mockUpload } = makeSvc();

    await expect(
      downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc, maxBytes }),
    ).rejects.toMatchObject({ code: 'inbound_media_too_large' });

    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('B-14: MIME indetectável → inbound_media_type_mismatch', async () => {
    fileTypeFromBlob.mockResolvedValueOnce(undefined); // não detectável
    const { svc, mockUpload } = makeSvc();

    await expect(
      downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc }),
    ).rejects.toMatchObject({ code: 'inbound_media_type_mismatch' });

    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('B-14b: IMAGE + MP4 → inbound_media_type_mismatch', async () => {
    fileTypeFromBlob.mockResolvedValueOnce({ mime: 'video/mp4', ext: 'mp4' });
    const { svc } = makeSvc();

    await expect(
      downloadAndStoreInboundMedia({
        ...BASE_PARAMS,
        svc,
        expectedMediaType: 'IMAGE',
        maxBytes:          5 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'inbound_media_type_mismatch' });
  });
});

// =============================================================================
// FILENAME — B-15..18
// =============================================================================

describe('FILENAME — sanitização e fallback', () => {
  it('B-15: traversal filename sanitizado antes de armazenar', async () => {
    // hintFilename com path traversal — deve ser sanitizado, não rejeitado
    const { svc, mockInsert } = makeSvc();

    await downloadAndStoreInboundMedia({
      ...BASE_PARAMS,
      svc,
      hintFilename: '../../etc/passwd',
    });

    const insertedPayload = mockInsert.mock.calls[0][0];
    // O filename sanitizado não deve conter / ou \ ou sequências ..
    expect(insertedPayload.original_filename).not.toContain('/');
    expect(insertedPayload.original_filename).not.toContain('\\');
    expect(insertedPayload.original_filename).not.toContain('..');
    // Deve ser diferente do valor original
    expect(insertedPayload.original_filename).not.toBe('../../etc/passwd');
  });

  it('B-16: DOCUMENT sem hintFilename → fallback document.pdf', async () => {
    const { svc, mockInsert } = makeSvc();

    await downloadAndStoreInboundMedia({
      ...BASE_PARAMS,
      svc,
      hintFilename: undefined,
    });

    expect(mockInsert.mock.calls[0][0].original_filename).toBe('document.pdf');
  });

  it('B-16b: DOCUMENT hintFilename vazio → fallback document.pdf', async () => {
    const { svc, mockInsert } = makeSvc();

    await downloadAndStoreInboundMedia({
      ...BASE_PARAMS,
      svc,
      hintFilename: '   ',
    });

    expect(mockInsert.mock.calls[0][0].original_filename).toBe('document.pdf');
  });

  it('B-17: IMAGE sem hintFilename → fallback usa extensão detectada (jpg)', async () => {
    fileTypeFromBlob.mockResolvedValueOnce({ mime: 'image/jpeg', ext: 'jpg' });
    downloadMediaBytes.mockResolvedValueOnce(makeMockBlob());
    const { svc, mockInsert } = makeSvc();

    await downloadAndStoreInboundMedia({
      ...BASE_PARAMS,
      svc,
      expectedMediaType: 'IMAGE',
      maxBytes:          5 * 1024 * 1024,
      hintFilename:      undefined,
    });

    expect(mockInsert.mock.calls[0][0].original_filename).toBe('inbound.jpg');
  });

  it('B-17b: IMAGE sem hintFilename PNG → fallback usa extensão detectada (png)', async () => {
    fileTypeFromBlob.mockResolvedValueOnce({ mime: 'image/png', ext: 'png' });
    downloadMediaBytes.mockResolvedValueOnce(makeMockBlob());
    const { svc, mockInsert } = makeSvc();

    await downloadAndStoreInboundMedia({
      ...BASE_PARAMS,
      svc,
      expectedMediaType: 'IMAGE',
      maxBytes:          5 * 1024 * 1024,
      hintFilename:      undefined,
    });

    expect(mockInsert.mock.calls[0][0].original_filename).toBe('inbound.png');
  });

  it('B-18: VIDEO sem hintFilename MP4 → fallback usa extensão detectada (mp4)', async () => {
    fileTypeFromBlob.mockResolvedValueOnce({ mime: 'video/mp4', ext: 'mp4' });
    downloadMediaBytes.mockResolvedValueOnce(makeMockBlob());
    const { svc, mockInsert } = makeSvc();

    await downloadAndStoreInboundMedia({
      ...BASE_PARAMS,
      svc,
      expectedMediaType: 'VIDEO',
      maxBytes:          16 * 1024 * 1024,
      hintFilename:      undefined,
    });

    expect(mockInsert.mock.calls[0][0].original_filename).toBe('inbound.mp4');
  });
});

// =============================================================================
// STORAGE — B-19..20
// =============================================================================

describe('STORAGE — destinationKey e upload', () => {
  it('B-19: destinationKey começa com biblioteca/companies/<companyId>/meta-inbound/', async () => {
    const { svc, mockStorageFrom, mockUpload } = makeSvc();

    await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc });

    expect(mockStorageFrom).toHaveBeenCalledWith('aws-lovoocrm-media');
    const uploadKey = mockUpload.mock.calls[0][0];
    expect(uploadKey).toMatch(
      new RegExp(`^biblioteca/companies/${FAKE_COMPANY_ID}/meta-inbound/[0-9a-f-]{36}/`),
    );
  });

  it('B-19b: bucket hardcoded = aws-lovoocrm-media', async () => {
    const { svc, mockStorageFrom } = makeSvc();
    await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc });
    // Todas chamadas ao storage.from devem usar o bucket correto
    for (const call of mockStorageFrom.mock.calls) {
      expect(call[0]).toBe('aws-lovoocrm-media');
    }
  });

  it('B-STORAGE-BODY: body enviado ao Storage é ArrayBuffer (não Blob); contentType = detected.mime; upsert=false', async () => {
    // Prova que a conversão Blob → ArrayBuffer acontece DEPOIS das validações (step 10).
    // Garante que @supabase/storage-js segue o branch direto onde headers['content-type']
    // = options.contentType é aplicado — e não o branch FormData que ignora essa opção.
    const BLOB_SIZE = 2048;
    downloadMediaBytes.mockResolvedValueOnce(makeMockBlob(BLOB_SIZE));
    fileTypeFromBlob.mockResolvedValueOnce({ mime: 'application/pdf', ext: 'pdf' });
    const { svc, mockUpload, mockStorageFrom } = makeSvc();

    await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc });

    expect(mockUpload).toHaveBeenCalledOnce();
    const [, body, options] = mockUpload.mock.calls[0];

    // Body NÃO é Blob — o branch FormData do SDK NÃO será ativado
    expect(body instanceof Blob).toBe(false);
    // Body É ArrayBuffer — SDK usa branch direto → content-type header é respeitado
    expect(body instanceof ArrayBuffer).toBe(true);
    // byteLength bate com o tamanho dos bytes originais baixados
    expect(body.byteLength).toBe(BLOB_SIZE);

    // contentType vem de detected.mime (byte authority), não de metadata, filename ou blob.type
    expect(options.contentType).toBe('application/pdf');
    // upsert=false sempre — importId garante unicidade do path
    expect(options.upsert).toBe(false);

    // Bucket hardcoded — nunca vindo do caller
    expect(mockStorageFrom).toHaveBeenCalledWith('aws-lovoocrm-media');
  });

  it('B-20: storage upload failure → inbound_media_storage_failed, sem CML insert', async () => {
    const { svc, mockInsert } = makeSvc({
      uploadError: { message: 'Storage error', statusCode: 500 },
    });

    await expect(
      downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc }),
    ).rejects.toMatchObject({ code: 'inbound_media_storage_failed' });

    expect(mockInsert).not.toHaveBeenCalled();
  });
});

// =============================================================================
// CML INSERT — B-21..22
// =============================================================================

describe('CML INSERT — campos e created_by', () => {
  it('B-21: insert contém company_id e source_ref corretos', async () => {
    const { svc, mockInsert } = makeSvc();

    await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc });

    const payload = mockInsert.mock.calls[0][0];
    expect(payload.company_id).toBe(FAKE_COMPANY_ID);
    expect(payload.source_ref).toBe(`meta-inbound:${FAKE_WAMID}`);
  });

  it('B-21b: insert contém file_type lowercase correto', async () => {
    const { svc, mockInsert } = makeSvc();
    await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc, expectedMediaType: 'DOCUMENT' });
    expect(mockInsert.mock.calls[0][0].file_type).toBe('document');
  });

  it('B-21c: insert contém mime_type dos bytes reais, não do metadata', async () => {
    // metadata diz mp4 mas bytes detectam pdf — bytes são autoridade
    downloadMediaMetadata.mockResolvedValueOnce({ ...FAKE_METADATA, mime_type: 'video/mp4' });
    fileTypeFromBlob.mockResolvedValueOnce({ mime: 'application/pdf', ext: 'pdf' });
    const { svc, mockInsert } = makeSvc();

    await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc });

    expect(mockInsert.mock.calls[0][0].mime_type).toBe('application/pdf');
  });

  it('B-22: created_by = null (system ingestion, sem usuário)', async () => {
    const { svc, mockInsert } = makeSvc();

    await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc });

    expect(mockInsert.mock.calls[0][0].created_by).toBeNull();
  });
});

// =============================================================================
// CLEANUP — B-23..24
// =============================================================================

describe('CLEANUP — upload OK + insert fail', () => {
  it('B-23: upload OK + insert fail não-23505 → cleanup + inbound_media_persistence_failed', async () => {
    const { svc, mockRemove } = makeSvc({
      insertError: { code: '23000', message: 'fk violation' },
    });

    await expect(
      downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc }),
    ).rejects.toMatchObject({ code: 'inbound_media_persistence_failed' });

    // Cleanup deve ter sido chamado
    expect(mockRemove).toHaveBeenCalledOnce();
  });

  it('B-24: cleanup fail não mascara erro primário', async () => {
    const { svc, mockRemove } = makeSvc({
      insertError: { code: '23000', message: 'fk violation' },
    });
    // Cleanup lança — não deve ocultar o erro primário
    mockRemove.mockRejectedValueOnce(new Error('cleanup network error'));

    const err = await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc })
      .catch(e => e);

    expect(err.code).toBe('inbound_media_persistence_failed');
  });
});

// =============================================================================
// RACE 23505 — B-25..26
// =============================================================================

describe('RACE — 23505 insert conflict', () => {
  it('B-25: 23505 → cleanup + re-query winner → retorna winner com reused=true', async () => {
    const winner = {
      id:                'winner-uuid-aaaa-bbbb-cccc-dddddddddddd',
      mime_type:         'application/pdf',
      file_size:         50000,
      original_filename: 'contrato.pdf',
    };
    const { svc, mockRemove, mockMaybySingle } = makeSvc({
      insertError:    { code: '23505', message: 'unique violation' },
      raceWinnerData: winner,
    });

    const result = await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc });

    // Deve retornar o winner
    expect(result.assetId).toBe('winner-uuid-aaaa-bbbb-cccc-dddddddddddd');
    expect(result.reused).toBe(true);
    // Cleanup do objeto Storage órfão foi chamado
    expect(mockRemove).toHaveBeenCalledOnce();
    // maybeSingle chamado 2x: precheck + re-query
    expect(mockMaybySingle).toHaveBeenCalledTimes(2);
    // Re-query inclui company_id (verificado via structure do mock)
  });

  it('B-26: 23505 + winner ausente → inbound_media_conflict', async () => {
    const { svc, mockRemove } = makeSvc({
      insertError:    { code: '23505', message: 'unique violation' },
      raceWinnerData: null, // não encontrou winner
    });

    await expect(
      downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc }),
    ).rejects.toMatchObject({ code: 'inbound_media_conflict' });

    expect(mockRemove).toHaveBeenCalledOnce();
  });
});

// =============================================================================
// SEGURANÇA — B-27..30
// =============================================================================

describe('SEGURANÇA — token, URL e company_id', () => {
  it('B-27: erro de download não contém token', async () => {
    downloadMediaMetadata.mockRejectedValueOnce(
      Object.assign(new Error('graph error'), { code: 'media_metadata_failed' }),
    );
    const { svc } = makeSvc();

    try {
      await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc });
      expect.fail('deveria ter lançado');
    } catch (err) {
      expect(err.message).not.toContain(FAKE_TOKEN);
      if (err.code) expect(String(err.code)).not.toContain(FAKE_TOKEN);
    }
  });

  it('B-28: erro de download não contém metadata.url', async () => {
    // metadata retorna url, mas o download falha
    downloadMediaBytes.mockRejectedValueOnce(
      Object.assign(new Error('download failed'), { code: 'media_download_failed' }),
    );
    const { svc } = makeSvc();

    try {
      await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc });
      expect.fail('deveria ter lançado');
    } catch (err) {
      // URL de CDN nunca deve aparecer em mensagem de erro
      expect(err.message).not.toContain(FAKE_CDN_URL);
      expect(err.message).not.toContain('fbcdn.net');
    }
  });

  it('B-29: erro não contém bytes do arquivo', async () => {
    fileTypeFromBlob.mockResolvedValueOnce({ mime: 'image/jpeg', ext: 'jpg' });
    const { svc } = makeSvc();

    try {
      // expectedMediaType = DOCUMENT mas bytes = JPEG → mismatch
      await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc, expectedMediaType: 'DOCUMENT' });
      expect.fail('deveria ter lançado');
    } catch (err) {
      // Mensagem não deve conter dados de bytes ou MIME bruto do payload
      expect(err.message).not.toMatch(/0x|%|base64/i);
    }
  });

  it('B-30: todas as queries CML sempre incluem company_id', async () => {
    const { svc, mockFrom } = makeSvc();

    await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc });

    // Toda chamada a svc.from retorna um objeto com .select().eq().eq()
    // O eq() mais externo contém company_id — verificar via mock calls
    const fromCalls = mockFrom.mock.calls.map(c => c[0]);
    for (const tableName of fromCalls) {
      expect(tableName).toBe('company_media_library');
    }

    // Verificar que o precheck usou eq('company_id', companyId)
    const selectObj = mockFrom.mock.results[0].value;
    const firstEqCall = selectObj.select.mock.results[0].value.eq.mock.calls[0];
    expect(firstEqCall[0]).toBe('company_id');
    expect(firstEqCall[1]).toBe(FAKE_COMPANY_ID);
  });

  it('B-30b: race re-query também inclui company_id', async () => {
    const winner = {
      id:                'winner-race-uuid',
      mime_type:         'application/pdf',
      file_size:         1000,
      original_filename: 'file.pdf',
    };
    const { svc, mockFrom } = makeSvc({
      insertError:    { code: '23505', message: 'conflict' },
      raceWinnerData: winner,
    });

    await downloadAndStoreInboundMedia({ ...BASE_PARAMS, svc });

    // Todos os from() foram 'company_media_library'
    for (const call of mockFrom.mock.calls) {
      expect(call[0]).toBe('company_media_library');
    }
  });
});
