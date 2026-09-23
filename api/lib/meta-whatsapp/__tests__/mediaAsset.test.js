// =============================================================================
// mediaAsset.test.js
//
// Testes unitários para api/lib/meta-whatsapp/mediaAsset.js (MVP4B.4C.1)
// Módulo puro de validação — sem Graph calls, sem banco real, sem storage real.
//
// COBERTURA:
//
//   Happy path (A–E):
//     MA-A  asset IMAGE JPEG válido
//     MA-B  asset IMAGE PNG válido
//     MA-C  asset VIDEO MP4 válido
//     MA-D  asset VIDEO 3GPP válido
//     MA-E  asset DOCUMENT PDF válido (inclui filename sanitizado)
//
//   Lookup / tenant (F–H):
//     MA-F  asset inexistente → media_asset_not_found
//     MA-G  asset de outro tenant → indistinguível de inexistente
//     MA-H  assetId inválido → media_asset_invalid
//     MA-H2 companyId inválido → media_asset_invalid
//
//   Input validation (I):
//     MA-I  expectedMediaType inválido → media_asset_invalid
//
//   Tamanho (J–K):
//     MA-J  DB file_size > limite → rejeita ANTES do download
//     MA-K  DB file_size OK, bytes reais > limite → rejeita APÓS download
//
//   MIME logic (L–P):
//     MA-L  DB mime_type falso, bytes válidos → bytes vencem (sucesso)
//     MA-M  DB mime_type válido, bytes inválidos → rejeita
//     MA-N  MIME não detectável → media_asset_type_unknown
//     MA-O  MIME fora da whitelist → media_asset_type_unsupported
//     MA-P  MIME detectado incompatível com expectedMediaType → media_asset_type_mismatch
//
//   Filename sanitização (Q–U):
//     MA-Q  filename com traversal (..) → sanitizado
//     MA-R  filename com slash/backslash → sanitizado
//     MA-S  filename vazio → fallback 'document.pdf'
//     MA-T  filename muito longo → truncado para 200 chars
//     MA-U  filename normal preservado
//
//   Storage failures (V–W):
//     MA-V  download retorna erro → media_asset_download_failed
//     MA-W  download retorna { data: null, error: null } → media_asset_download_failed
//
// GARANTIAS:
//   - Zero Graph calls em todos os testes.
//   - Supabase client sempre injetado como mock.
//   - file-type sempre mockado (sem bytes reais processados).
// =============================================================================

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { validateMediaAsset } from '../mediaAsset.js';

// =============================================================================
// Mock de file-type — DEVE ser declarado antes do import para garantir
// que o mock seja aplicado quando mediaAsset.js importar 'file-type'.
// =============================================================================
vi.mock('file-type', () => ({
  fileTypeFromBlob: vi.fn(),
}));

import { fileTypeFromBlob } from 'file-type';

// =============================================================================
// Fixtures
// =============================================================================

const VALID_COMPANY_ID = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const VALID_ASSET_ID   = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const OTHER_COMPANY_ID = 'cccccccc-0000-0000-0000-cccccccccccc'; // tenant diferente
const FAKE_S3_KEY      = 'biblioteca/companies/aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa/images/photo.jpg';

// Blobs mínimos — conteúdo irrelevante pois fileTypeFromBlob é mockado.
const makeBlob = (size = 100_000) =>
  new Blob([new Uint8Array(size)], { type: 'application/octet-stream' });

const SMALL_BLOB   = makeBlob(100_000);   // 100 KB — cabe em todos os limites
const LARGE_BLOB   = makeBlob(6 * 1024 * 1024); // 6 MB — excede limite IMAGE (5 MB)

/** Constrói uma row de company_media_library */
function makeAsset(overrides = {}) {
  return {
    id:                VALID_ASSET_ID,
    company_id:        VALID_COMPANY_ID,
    s3_key:            FAKE_S3_KEY,
    file_size:         100_000,         // 100 KB — dentro de qualquer limite
    mime_type:         'image/jpeg',    // hint — não é autoridade
    original_filename: 'photo.jpg',
    file_type:         'image',
    ...overrides,
  };
}

/**
 * Constrói um mock de Supabase com comportamento configurável.
 *
 * @param {object} opts
 * @param {object|null} opts.assetRow     - row retornada pelo lookup DB (null = not found)
 * @param {object|null} opts.dbError      - erro retornado pelo lookup DB
 * @param {Blob|null}   opts.downloadBlob - blob retornado pelo download
 * @param {object|null} opts.downloadError- erro retornado pelo download
 */
function makeSupabase({
  assetRow     = makeAsset(),
  dbError      = null,
  downloadBlob = SMALL_BLOB,
  downloadError = null,
} = {}) {
  const maybeSingle = vi.fn().mockResolvedValue(
    dbError
      ? { data: null, error: dbError }
      : { data: assetRow, error: null },
  );

  // Cadeia: .from().select().eq().eq().maybeSingle()
  const queryBuilder = {
    select:     vi.fn().mockReturnThis(),
    eq:         vi.fn().mockReturnThis(),
    maybeSingle,
  };

  const from = vi.fn().mockReturnValue(queryBuilder);

  const download = vi.fn().mockResolvedValue(
    downloadError
      ? { data: null, error: downloadError }
      : { data: downloadBlob, error: null },
  );

  const storageFrom = vi.fn().mockReturnValue({ download });

  return { from, storage: { from: storageFrom }, _maybeSingle: maybeSingle, _download: download };
}

/** Params válidos para caso de sucesso IMAGE JPEG */
const VALID_IMAGE_PARAMS = {
  companyId:         VALID_COMPANY_ID,
  assetId:           VALID_ASSET_ID,
  expectedMediaType: 'IMAGE',
};

// =============================================================================
// Setup
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  // Default: detecta image/jpeg
  fileTypeFromBlob.mockResolvedValue({ ext: 'jpg', mime: 'image/jpeg' });
});

// =============================================================================
// Happy path
// =============================================================================

describe('validateMediaAsset — happy path', () => {
  it('MA-A: IMAGE JPEG válido → retorna resultado correto sem filename', async () => {
    fileTypeFromBlob.mockResolvedValue({ ext: 'jpg', mime: 'image/jpeg' });
    const svc = makeSupabase({ assetRow: makeAsset({ mime_type: 'image/jpeg' }) });

    const result = await validateMediaAsset({ supabase: svc, ...VALID_IMAGE_PARAMS });

    expect(result.assetId).toBe(VALID_ASSET_ID);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.mediaType).toBe('IMAGE');
    expect(result.size).toBe(SMALL_BLOB.size);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.filename).toBeUndefined(); // IMAGE não retorna filename
  });

  it('MA-B: IMAGE PNG válido', async () => {
    fileTypeFromBlob.mockResolvedValue({ ext: 'png', mime: 'image/png' });
    const svc = makeSupabase({ assetRow: makeAsset({ mime_type: 'image/png', original_filename: 'banner.png' }) });

    const result = await validateMediaAsset({ supabase: svc, ...VALID_IMAGE_PARAMS });

    expect(result.mimeType).toBe('image/png');
    expect(result.mediaType).toBe('IMAGE');
    expect(result.filename).toBeUndefined();
  });

  it('MA-C: VIDEO MP4 válido', async () => {
    fileTypeFromBlob.mockResolvedValue({ ext: 'mp4', mime: 'video/mp4' });
    const svc = makeSupabase({
      assetRow: makeAsset({ mime_type: 'video/mp4', file_type: 'video', file_size: 10_000_000 }),
    });

    const result = await validateMediaAsset({
      supabase: svc,
      companyId: VALID_COMPANY_ID,
      assetId:   VALID_ASSET_ID,
      expectedMediaType: 'VIDEO',
    });

    expect(result.mimeType).toBe('video/mp4');
    expect(result.mediaType).toBe('VIDEO');
    expect(result.filename).toBeUndefined();
  });

  it('MA-D: VIDEO 3GPP válido', async () => {
    fileTypeFromBlob.mockResolvedValue({ ext: '3gp', mime: 'video/3gpp' });
    const svc = makeSupabase({
      assetRow: makeAsset({ mime_type: 'video/3gpp', file_type: 'video', file_size: 5_000_000 }),
    });

    const result = await validateMediaAsset({
      supabase: svc,
      companyId: VALID_COMPANY_ID,
      assetId:   VALID_ASSET_ID,
      expectedMediaType: 'VIDEO',
    });

    expect(result.mimeType).toBe('video/3gpp');
    expect(result.mediaType).toBe('VIDEO');
  });

  it('MA-E: DOCUMENT PDF válido → retorna filename sanitizado', async () => {
    fileTypeFromBlob.mockResolvedValue({ ext: 'pdf', mime: 'application/pdf' });
    const svc = makeSupabase({
      assetRow: makeAsset({ mime_type: 'application/pdf', file_type: 'document', original_filename: 'Relatório Q3.pdf' }),
    });

    const result = await validateMediaAsset({
      supabase: svc,
      companyId: VALID_COMPANY_ID,
      assetId:   VALID_ASSET_ID,
      expectedMediaType: 'DOCUMENT',
    });

    expect(result.mimeType).toBe('application/pdf');
    expect(result.mediaType).toBe('DOCUMENT');
    expect(result.filename).toBe('Relatório Q3.pdf'); // nome normal preservado
  });
});

// =============================================================================
// Lookup / tenant
// =============================================================================

describe('validateMediaAsset — lookup e tenant', () => {
  it('MA-F: asset inexistente → media_asset_not_found (opaco)', async () => {
    const svc = makeSupabase({ assetRow: null });

    await expect(
      validateMediaAsset({ supabase: svc, ...VALID_IMAGE_PARAMS }),
    ).rejects.toMatchObject({ code: 'media_asset_not_found' });

    // Garantia: download NÃO chamado
    expect(svc._download).not.toHaveBeenCalled();
  });

  it('MA-G: asset de outro tenant → indistinguível de inexistente', async () => {
    // Simula: lookup com companyId=A retorna null porque o asset pertence a B
    const svc = makeSupabase({ assetRow: null });

    await expect(
      validateMediaAsset({
        supabase:          svc,
        companyId:         OTHER_COMPANY_ID, // tenant diferente
        assetId:           VALID_ASSET_ID,
        expectedMediaType: 'IMAGE',
      }),
    ).rejects.toMatchObject({ code: 'media_asset_not_found' });

    expect(svc._download).not.toHaveBeenCalled();
  });

  it('MA-H: assetId inválido → media_asset_invalid (sem DB call)', async () => {
    const svc = makeSupabase();

    await expect(
      validateMediaAsset({
        supabase:          svc,
        companyId:         VALID_COMPANY_ID,
        assetId:           'not-a-uuid',
        expectedMediaType: 'IMAGE',
      }),
    ).rejects.toMatchObject({ code: 'media_asset_invalid' });

    expect(svc.from).not.toHaveBeenCalled();
  });

  it('MA-H2: companyId inválido → media_asset_invalid (sem DB call)', async () => {
    const svc = makeSupabase();

    await expect(
      validateMediaAsset({
        supabase:          svc,
        companyId:         'invalid-company',
        assetId:           VALID_ASSET_ID,
        expectedMediaType: 'IMAGE',
      }),
    ).rejects.toMatchObject({ code: 'media_asset_invalid' });

    expect(svc.from).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Input validation
// =============================================================================

describe('validateMediaAsset — validação de inputs', () => {
  it('MA-I: expectedMediaType inválido → media_asset_invalid (sem DB call)', async () => {
    const svc = makeSupabase();

    await expect(
      validateMediaAsset({
        supabase:          svc,
        companyId:         VALID_COMPANY_ID,
        assetId:           VALID_ASSET_ID,
        expectedMediaType: 'AUDIO',
      }),
    ).rejects.toMatchObject({ code: 'media_asset_invalid' });

    expect(svc.from).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Tamanho
// =============================================================================

describe('validateMediaAsset — validação de tamanho', () => {
  it('MA-J: DB file_size > limite IMAGE → rejeita ANTES do download', async () => {
    const svc = makeSupabase({
      assetRow: makeAsset({ file_size: 6 * 1024 * 1024 }), // 6 MB > 5 MB limite
    });

    await expect(
      validateMediaAsset({ supabase: svc, ...VALID_IMAGE_PARAMS }),
    ).rejects.toMatchObject({ code: 'media_asset_too_large' });

    // Garantia: download NÃO chamado (rejeição antecipada)
    expect(svc._download).not.toHaveBeenCalled();
  });

  it('MA-K: DB file_size OK mas bytes reais > limite IMAGE → rejeita após download', async () => {
    const svc = makeSupabase({
      assetRow:    makeAsset({ file_size: 4 * 1024 * 1024 }), // 4 MB — passa pre-check
      downloadBlob: LARGE_BLOB,                                // 6 MB — falha no real check
    });

    await expect(
      validateMediaAsset({ supabase: svc, ...VALID_IMAGE_PARAMS }),
    ).rejects.toMatchObject({ code: 'media_asset_too_large' });

    // Garantia: download FOI chamado (rejeição ocorreu depois)
    expect(svc._download).toHaveBeenCalledOnce();
  });
});

// =============================================================================
// MIME logic
// =============================================================================

describe('validateMediaAsset — detecção de MIME', () => {
  it('MA-L: mime_type do DB é falso, bytes indicam JPEG → bytes vencem (sucesso)', async () => {
    fileTypeFromBlob.mockResolvedValue({ ext: 'jpg', mime: 'image/jpeg' });
    const svc = makeSupabase({
      assetRow: makeAsset({ mime_type: 'text/plain' }), // mime_type do DB incorreto
    });

    const result = await validateMediaAsset({ supabase: svc, ...VALID_IMAGE_PARAMS });

    // Bytes vencem: JPEG aceito apesar do mime_type do DB
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.mediaType).toBe('IMAGE');
  });

  it('MA-M: mime_type do DB válido mas bytes inválidos → rejeita', async () => {
    fileTypeFromBlob.mockResolvedValue(undefined); // MIME não detectável
    const svc = makeSupabase({
      assetRow: makeAsset({ mime_type: 'image/jpeg' }), // DB diz jpeg, mas bytes não confirmam
    });

    await expect(
      validateMediaAsset({ supabase: svc, ...VALID_IMAGE_PARAMS }),
    ).rejects.toMatchObject({ code: 'media_asset_type_unknown' });
  });

  it('MA-N: MIME não detectável pelos bytes → media_asset_type_unknown', async () => {
    fileTypeFromBlob.mockResolvedValue(null);
    const svc = makeSupabase();

    await expect(
      validateMediaAsset({ supabase: svc, ...VALID_IMAGE_PARAMS }),
    ).rejects.toMatchObject({ code: 'media_asset_type_unknown' });
  });

  it('MA-O: MIME detectado mas fora da whitelist → media_asset_type_unsupported', async () => {
    // image/webp: detectável pelo file-type mas pendente confirmação para template HEADER
    fileTypeFromBlob.mockResolvedValue({ ext: 'webp', mime: 'image/webp' });
    const svc = makeSupabase();

    await expect(
      validateMediaAsset({ supabase: svc, ...VALID_IMAGE_PARAMS }),
    ).rejects.toMatchObject({ code: 'media_asset_type_unsupported' });
  });

  it('MA-P: MIME na whitelist mas incompatível com expectedMediaType → media_asset_type_mismatch', async () => {
    // Asset é PDF mas endpoint espera IMAGE
    fileTypeFromBlob.mockResolvedValue({ ext: 'pdf', mime: 'application/pdf' });
    const svc = makeSupabase({
      assetRow: makeAsset({ mime_type: 'application/pdf' }),
    });

    await expect(
      validateMediaAsset({ supabase: svc, ...VALID_IMAGE_PARAMS }), // expectedMediaType: IMAGE
    ).rejects.toMatchObject({ code: 'media_asset_type_mismatch' });
  });
});

// =============================================================================
// Filename sanitização (somente DOCUMENT)
// =============================================================================

describe('validateMediaAsset — sanitização de filename (DOCUMENT)', () => {
  async function getFilename(originalFilename) {
    fileTypeFromBlob.mockResolvedValue({ ext: 'pdf', mime: 'application/pdf' });
    const svc = makeSupabase({
      assetRow: makeAsset({ mime_type: 'application/pdf', file_type: 'document', original_filename: originalFilename }),
    });
    const result = await validateMediaAsset({
      supabase: svc,
      companyId: VALID_COMPANY_ID,
      assetId:   VALID_ASSET_ID,
      expectedMediaType: 'DOCUMENT',
    });
    return result.filename;
  }

  it('MA-Q: filename com traversal (..) → pontos colapsados', async () => {
    const filename = await getFilename('../../../etc/passwd');
    expect(filename).not.toContain('..');
    expect(filename).not.toContain('/');
    expect(filename).not.toBe('..');
    expect(filename.length).toBeGreaterThan(0);
  });

  it('MA-R: filename com slash e backslash → removidos', async () => {
    const filename = await getFilename('secret/dir\\data.pdf');
    expect(filename).not.toContain('/');
    expect(filename).not.toContain('\\');
    expect(filename).toBe('secretdirdata.pdf');
  });

  it('MA-S: filename vazio → fallback document.pdf', async () => {
    const filename = await getFilename('');
    expect(filename).toBe('document.pdf');
  });

  it('MA-T: filename muito longo (250 chars) → truncado a 200 chars', async () => {
    const longName = 'a'.repeat(250) + '.pdf';
    const filename = await getFilename(longName);
    expect(filename.length).toBeLessThanOrEqual(200);
  });

  it('MA-U: filename normal → preservado sem alteração', async () => {
    const filename = await getFilename('relatorio-2026-Q3.pdf');
    expect(filename).toBe('relatorio-2026-Q3.pdf');
  });
});

// =============================================================================
// Storage failures
// =============================================================================

describe('validateMediaAsset — falhas de storage', () => {
  it('MA-V: download retorna erro → media_asset_download_failed', async () => {
    const svc = makeSupabase({
      downloadBlob:  null,
      downloadError: { message: 'Object not found' },
    });

    await expect(
      validateMediaAsset({ supabase: svc, ...VALID_IMAGE_PARAMS }),
    ).rejects.toMatchObject({ code: 'media_asset_download_failed' });

    expect(fileTypeFromBlob).not.toHaveBeenCalled();
  });

  it('MA-W: download retorna { data: null, error: null } → media_asset_download_failed', async () => {
    const svc = makeSupabase({
      downloadBlob:  null,
      downloadError: null,
    });

    await expect(
      validateMediaAsset({ supabase: svc, ...VALID_IMAGE_PARAMS }),
    ).rejects.toMatchObject({ code: 'media_asset_download_failed' });

    expect(fileTypeFromBlob).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Garantia adicional: zero Graph calls
// =============================================================================

describe('validateMediaAsset — garantias de isolamento', () => {
  it('ISOLAMENTO: fetch global nunca chamado em nenhum cenário', async () => {
    const originalFetch = global.fetch;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    try {
      // Sucesso
      const svc = makeSupabase();
      fileTypeFromBlob.mockResolvedValue({ ext: 'jpg', mime: 'image/jpeg' });
      await validateMediaAsset({ supabase: svc, ...VALID_IMAGE_PARAMS });

      // Falha — asset not found
      const svc2 = makeSupabase({ assetRow: null });
      await expect(
        validateMediaAsset({ supabase: svc2, ...VALID_IMAGE_PARAMS }),
      ).rejects.toBeDefined();
    } finally {
      global.fetch = originalFetch;
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
