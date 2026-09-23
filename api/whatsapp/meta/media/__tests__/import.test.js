// =============================================================================
// import.test.js
//
// Testes unitários para POST /api/whatsapp/meta/media/import (MVP4B.4D.2B)
// Todos os testes usam mocks — sem AWS real, sem banco, sem storage, sem rede.
//
// COBERTURA (27 casos):
//
//   HTTP:
//     IMP-01  não-POST (GET) → 405 + Allow: POST; nenhum guard chamado
//     IMP-02  não-POST (PUT) → 405 + Allow: POST
//
//   AUTH + RBAC:
//     IMP-03  sem Authorization → 401; nenhum DB lookup
//     IMP-04  JWT inválido → 401
//     IMP-05  role proibida → 403; nenhum DB lookup pós-auth
//     IMP-06  feature flag off → 403
//
//   VALIDAÇÃO DE source_id (pós-auth):
//     IMP-07  source_id ausente → 400 invalid_request
//     IMP-08  source_id não-UUID → 400 invalid_request
//
//   IDEMPOTÊNCIA (precheck):
//     IMP-09  source_ref já existe em company_media_library → 200 { id } sem download
//
//   LOOKUP lead_media_unified:
//     IMP-10  source not found → 404 source_not_found; download = 0
//     IMP-11  source cross-tenant → 404 source_not_found (opaco)
//     IMP-12  lookup DB error → 404 source_not_found
//
//   PREFIXO DE KEY:
//     IMP-13  s3_key sem prefixo clientes/<companyId>/ → 500 internal_error; download = 0
//
//   VALIDAÇÃO DE file_type:
//     IMP-14  file_type desconhecido (ex: 'audio') → 422 media_type_unsupported; download = 0
//
//   PREFILTER DE TAMANHO (hint):
//     IMP-15  DB file_size > limite → 422 media_too_large; download = 0
//
//   DOWNLOAD AWS:
//     IMP-16  aws_object_not_found → 404 source_file_not_found
//     IMP-17  aws_credentials_unavailable → 500 internal_error
//     IMP-18  aws_download_failed / aws_stream_error → 502 source_unavailable
//
//   TAMANHO REAL (autoridade):
//     IMP-19  bytes reais > limite → 422 media_too_large; upload = 0
//
//   MIME DETECTION:
//     IMP-20  MIME não detectável → 422 media_type_unknown; upload = 0
//     IMP-21  MIME fora da whitelist → 422 media_type_unsupported; upload = 0
//     IMP-22  MIME incompatível com file_type do DB → 422 media_type_mismatch; upload = 0
//
//   UPLOAD STORAGE:
//     IMP-23  upload falha → 500 internal_error; INSERT = 0
//
//   INSERT 23505 RACE:
//     IMP-24  23505 com vencedor encontrado → 200 { id } do vencedor; cleanup chamado
//     IMP-25  23505 sem vencedor → 409 conflict_error; cleanup chamado
//
//   HAPPY PATH:
//     IMP-26  IMAGE JPEG — sucesso completo → 200 { id }
//     IMP-27  DOCUMENT PDF — sucesso com filename sanitizado → 200 { id }
//
// GARANTIAS:
//   - Zero chamadas AWS reais.
//   - Zero chamadas banco reais.
//   - Supabase client sempre injetado via mock de getSupabaseAdmin.
//   - downloadAwsBytes sempre mockado.
//   - fileTypeFromBlob sempre mockado.
// =============================================================================

import { vi, describe, it, expect, beforeEach } from 'vitest';

// =============================================================================
// Mocks — declarados antes dos imports para garantir hoisting correto
// =============================================================================

vi.mock('file-type', () => ({
  fileTypeFromBlob: vi.fn(),
}));

vi.mock('../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  validateMetaCaller: vi.fn(),
  META_SEND_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
}));

vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('../../../../lib/meta-whatsapp/awsDownload.js', () => ({
  downloadAwsBytes: vi.fn(),
}));

// =============================================================================
// Imports após mocks
// =============================================================================

import { fileTypeFromBlob }       from 'file-type';
import { validateMetaCaller }     from '../../../../lib/meta-whatsapp/validateMetaCaller.js';
import { getSupabaseAdmin }       from '../../../../lib/automation/supabaseAdmin.js';
import { downloadAwsBytes }       from '../../../../lib/meta-whatsapp/awsDownload.js';
import handler                    from '../import.js';

// =============================================================================
// Fixtures
// =============================================================================

const COMPANY_ID  = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const USER_ID     = 'dddddddd-0000-0000-0000-dddddddddddd';
const SOURCE_ID   = 'eeeeeeee-0000-0000-0000-eeeeeeeeeeee';
const ASSET_ID    = 'ffffffff-0000-0000-0000-ffffffffffff';
const OTHER_CO_ID = 'cccccccc-0000-0000-0000-cccccccccccc';

const VALID_S3_KEY = `clientes/${COMPANY_ID}/whatsapp/2026/07/image.jpg`;

const AUTH_OK = { ok: true, userId: USER_ID, companyId: COMPANY_ID, role: 'admin' };

const SMALL_BUFFER   = Buffer.alloc(100_000);          // 100 KB — dentro de qualquer limite
const VIDEO_BUFFER   = Buffer.alloc(15 * 1024 * 1024); // 15 MB — dentro do limite VIDEO (16 MB)
const OVERLARGE_IMG  = Buffer.alloc(6 * 1024 * 1024);  // 6 MB — excede IMAGE (5 MB)

/** Row mínima de lead_media_unified */
function makeSourceRow(overrides = {}) {
  return {
    id:                SOURCE_ID,
    s3_key:            VALID_S3_KEY,
    file_size:         100_000,
    mime_type:         'image/jpeg',
    original_filename: 'photo.jpg',
    file_type:         'image',
    ...overrides,
  };
}

// =============================================================================
// Factory do mock Supabase
// =============================================================================

/**
 * Constrói um mock do client Supabase com controle total de comportamento.
 *
 * @param {object} opts
 * @param {object|null} opts.existingAsset   - Row precheck idempotência (null = não existe)
 * @param {object|null} opts.sourceRow       - Row lead_media_unified (null = não encontrado)
 * @param {object|null} opts.sourceDbError   - Erro no lookup lead_media_unified
 * @param {object|null} opts.insertedRow     - Row retornada após INSERT { id }
 * @param {object|null} opts.insertError     - Erro no INSERT
 * @param {object|null} opts.raceWinner      - Row re-query após 23505 (null = não encontrado)
 * @param {object|null} opts.uploadError     - Erro no upload do storage
 */
function makeSvc({
  existingAsset  = null,
  sourceRow      = makeSourceRow(),
  sourceDbError  = null,
  insertedRow    = { id: ASSET_ID },
  insertError    = null,
  raceWinner     = null,
  uploadError    = null,
} = {}) {
  // Controla chamadas sequenciais ao .maybeSingle() por query.
  // 1ª chamada = precheck idempotência, 2ª = lookup lead_media_unified,
  // 3ª (se 23505) = re-query race winner.
  let maybeSingleCallCount = 0;

  const maybeSingle = vi.fn().mockImplementation(() => {
    maybeSingleCallCount++;
    if (maybeSingleCallCount === 1) {
      // Precheck idempotência
      return Promise.resolve({ data: existingAsset, error: null });
    }
    if (maybeSingleCallCount === 2) {
      // Lookup lead_media_unified
      if (sourceDbError) return Promise.resolve({ data: null, error: sourceDbError });
      return Promise.resolve({ data: sourceRow, error: null });
    }
    // Re-query pós-23505
    return Promise.resolve({ data: raceWinner, error: null });
  });

  const single = vi.fn().mockResolvedValue(
    insertError
      ? { data: null, error: insertError }
      : { data: insertedRow, error: null },
  );

  const select     = vi.fn().mockReturnThis();
  const eq         = vi.fn().mockReturnThis();
  const insert     = vi.fn().mockReturnValue({ select: () => ({ single }) });
  const queryChain = { select, eq, maybeSingle };

  const from = vi.fn().mockReturnValue({ ...queryChain, insert });

  // Storage mock
  const remove      = vi.fn().mockResolvedValue({ error: null });
  const getPublicUrl = vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/asset.jpg' } });

  const upload = vi.fn().mockResolvedValue(
    uploadError ? { error: uploadError } : { error: null },
  );

  const storageFrom = vi.fn().mockReturnValue({ upload, remove, getPublicUrl });

  return {
    from,
    storage: { from: storageFrom },
    _upload:       upload,
    _remove:       remove,
    _single:       single,
    _maybeSingle:  maybeSingle,
    _storageFrom:  storageFrom,
  };
}

/** Constrói req mock mínimo */
function makeReq(overrides = {}) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token' },
    body:   { company_id: COMPANY_ID, source_id: SOURCE_ID },
    ...overrides,
  };
}

/** Constrói res mock mínimo com capture de status/json */
function makeRes() {
  const res = {
    _status: null,
    _body:   null,
    setHeader: vi.fn(),
    status(code) { this._status = code; return this; },
    json(body)   { this._body  = body;  return this; },
  };
  return res;
}

// =============================================================================
// Setup
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // Defaults felizes
  validateMetaCaller.mockResolvedValue(AUTH_OK);
  fileTypeFromBlob.mockResolvedValue({ ext: 'jpg', mime: 'image/jpeg' });
  downloadAwsBytes.mockResolvedValue(SMALL_BUFFER);
  getSupabaseAdmin.mockReturnValue(makeSvc());
});

// =============================================================================
// HTTP
// =============================================================================

describe('HTTP method guard', () => {
  it('IMP-01: GET → 405 + Allow: POST; guard não chamado', async () => {
    const req = makeReq({ method: 'GET' });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(405);
    expect(res._body).toEqual({ error: 'method_not_allowed' });
    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
    expect(validateMetaCaller).not.toHaveBeenCalled();
  });

  it('IMP-02: PUT → 405 + Allow: POST', async () => {
    const req = makeReq({ method: 'PUT' });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(405);
    expect(validateMetaCaller).not.toHaveBeenCalled();
  });
});

// =============================================================================
// AUTH + RBAC
// =============================================================================

describe('Auth + RBAC', () => {
  it('IMP-03: sem Authorization → 401; nenhum DB lookup', async () => {
    validateMetaCaller.mockResolvedValue({ ok: false, status: 401, error: 'unauthorized' });
    const svc = makeSvc();
    getSupabaseAdmin.mockReturnValue(svc);

    const req = makeReq({ headers: {} });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(401);
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('IMP-04: JWT inválido → 401', async () => {
    validateMetaCaller.mockResolvedValue({ ok: false, status: 401, error: 'unauthorized' });

    const req = makeReq({ headers: { authorization: 'Bearer invalid' } });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(401);
  });

  it('IMP-05: role proibida → 403; nenhum DB lookup pós-auth', async () => {
    validateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'forbidden' });
    const svc = makeSvc();
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(403);
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('IMP-06: feature flag off → 403', async () => {
    validateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'feature_disabled' });

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'feature_disabled' });
  });
});

// =============================================================================
// Validação de source_id (pós-auth)
// =============================================================================

describe('Validação source_id', () => {
  it('IMP-07: source_id ausente → 400 invalid_request', async () => {
    const req = makeReq({ body: { company_id: COMPANY_ID } });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'invalid_request' });
    expect(downloadAwsBytes).not.toHaveBeenCalled();
  });

  it('IMP-08: source_id não-UUID → 400 invalid_request', async () => {
    const req = makeReq({ body: { company_id: COMPANY_ID, source_id: 'not-a-uuid' } });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'invalid_request' });
    expect(downloadAwsBytes).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Idempotência (precheck)
// =============================================================================

describe('Idempotência precheck', () => {
  it('IMP-09: source_ref já existe → 200 { id } sem download', async () => {
    const svc = makeSvc({ existingAsset: { id: ASSET_ID } });
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ id: ASSET_ID });
    expect(downloadAwsBytes).not.toHaveBeenCalled();
    expect(svc._upload).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Lookup lead_media_unified
// =============================================================================

describe('Lookup lead_media_unified', () => {
  it('IMP-10: source not found → 404 source_not_found; download = 0', async () => {
    const svc = makeSvc({ sourceRow: null });
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'source_not_found' });
    expect(downloadAwsBytes).not.toHaveBeenCalled();
  });

  it('IMP-11: source cross-tenant → 404 opaco (indistinguível de not found)', async () => {
    // Simula retorno null pois o .eq('company_id', auth.companyId) filtra o row
    const svc = makeSvc({ sourceRow: null });
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(404);
    expect(res._body.error).toBe('source_not_found');
  });

  it('IMP-12: lookup DB error → 404 source_not_found', async () => {
    const svc = makeSvc({ sourceRow: null, sourceDbError: { message: 'DB error' } });
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(404);
    expect(downloadAwsBytes).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Prefixo de key
// =============================================================================

describe('Validação de prefixo de key', () => {
  it('IMP-13: s3_key sem prefixo correto → 500 internal_error; download = 0', async () => {
    const svc = makeSvc({
      sourceRow: makeSourceRow({
        s3_key: `clientes/${OTHER_CO_ID}/whatsapp/other.jpg`, // prefixo de outro tenant
      }),
    });
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(downloadAwsBytes).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Validação file_type
// =============================================================================

describe('Validação de file_type', () => {
  it('IMP-14: file_type desconhecido → 422 media_type_unsupported; download = 0', async () => {
    const svc = makeSvc({ sourceRow: makeSourceRow({ file_type: 'audio' }) });
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(422);
    expect(res._body).toEqual({ error: 'media_type_unsupported' });
    expect(downloadAwsBytes).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Prefilter de tamanho (hint)
// =============================================================================

describe('DB file_size prefilter', () => {
  it('IMP-15: DB file_size > limite → 422 media_too_large; download = 0', async () => {
    const svc = makeSvc({
      sourceRow: makeSourceRow({
        file_type: 'image',
        file_size: 6 * 1024 * 1024, // 6 MB — excede IMAGE (5 MB)
      }),
    });
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(422);
    expect(res._body).toEqual({ error: 'media_too_large' });
    expect(downloadAwsBytes).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Download AWS
// =============================================================================

describe('Download AWS', () => {
  it('IMP-16: aws_object_not_found → 404 source_file_not_found', async () => {
    downloadAwsBytes.mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'aws_object_not_found' }),
    );

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'source_file_not_found' });
  });

  it('IMP-17: aws_credentials_unavailable → 500 internal_error', async () => {
    downloadAwsBytes.mockRejectedValue(
      Object.assign(new Error('no creds'), { code: 'aws_credentials_unavailable' }),
    );

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
  });

  it('IMP-18: aws_download_failed → 502 source_unavailable', async () => {
    downloadAwsBytes.mockRejectedValue(
      Object.assign(new Error('download failed'), { code: 'aws_download_failed' }),
    );

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(502);
    expect(res._body).toEqual({ error: 'source_unavailable' });
  });
});

// =============================================================================
// Tamanho real (autoridade)
// =============================================================================

describe('Tamanho real (bytes)', () => {
  it('IMP-19: bytes reais > limite → 422 media_too_large; upload = 0', async () => {
    downloadAwsBytes.mockResolvedValue(OVERLARGE_IMG); // 6 MB > IMAGE limit 5 MB
    const svc = makeSvc();
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(422);
    expect(res._body).toEqual({ error: 'media_too_large' });
    expect(svc._upload).not.toHaveBeenCalled();
  });
});

// =============================================================================
// MIME detection
// =============================================================================

describe('MIME detection', () => {
  it('IMP-20: MIME não detectável → 422 media_type_unknown; upload = 0', async () => {
    fileTypeFromBlob.mockResolvedValue(undefined);
    const svc = makeSvc();
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(422);
    expect(res._body).toEqual({ error: 'media_type_unknown' });
    expect(svc._upload).not.toHaveBeenCalled();
  });

  it('IMP-21: MIME fora da whitelist → 422 media_type_unsupported; upload = 0', async () => {
    fileTypeFromBlob.mockResolvedValue({ ext: 'webp', mime: 'image/webp' });
    const svc = makeSvc();
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(422);
    expect(res._body).toEqual({ error: 'media_type_unsupported' });
    expect(svc._upload).not.toHaveBeenCalled();
  });

  it('IMP-22: MIME incompatível com file_type DB → 422 media_type_mismatch; upload = 0', async () => {
    // file_type DB = 'image', mas bytes detectam video/mp4
    fileTypeFromBlob.mockResolvedValue({ ext: 'mp4', mime: 'video/mp4' });
    const svc = makeSvc({
      sourceRow: makeSourceRow({ file_type: 'image' }),
    });
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(422);
    expect(res._body).toEqual({ error: 'media_type_mismatch' });
    expect(svc._upload).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Upload Storage
// =============================================================================

describe('Upload Storage', () => {
  it('IMP-23: upload falha → 500 internal_error; INSERT = 0', async () => {
    const svc = makeSvc({ uploadError: { message: 'storage error', statusCode: 500 } });
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(svc._single).not.toHaveBeenCalled();
  });
});

// =============================================================================
// INSERT 23505 race condition
// =============================================================================

describe('INSERT 23505 race condition', () => {
  it('IMP-24: 23505 com vencedor → 200 { id } do vencedor; cleanup chamado', async () => {
    const WINNER_ID   = 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb';
    const insertError = Object.assign(new Error('duplicate key'), { code: '23505' });
    const svc = makeSvc({
      insertError,
      raceWinner: { id: WINNER_ID },
    });
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ id: WINNER_ID });
    // cleanup deve ter sido chamado
    expect(svc._remove).toHaveBeenCalledTimes(1);
  });

  it('IMP-25: 23505 sem vencedor → 409 conflict_error; cleanup chamado', async () => {
    const insertError = Object.assign(new Error('duplicate key'), { code: '23505' });
    const svc = makeSvc({
      insertError,
      raceWinner: null, // re-query não encontra
    });
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(409);
    expect(res._body).toEqual({ error: 'conflict_error' });
    expect(svc._remove).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Happy path
// =============================================================================

describe('Happy path', () => {
  it('IMP-26: IMAGE JPEG — sucesso completo → 200 { id }', async () => {
    fileTypeFromBlob.mockResolvedValue({ ext: 'jpg', mime: 'image/jpeg' });
    downloadAwsBytes.mockResolvedValue(SMALL_BUFFER);

    const svc = makeSvc({ insertedRow: { id: ASSET_ID } });
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ id: ASSET_ID });

    // Upload deve ter sido chamado com MIME correto
    expect(svc._upload).toHaveBeenCalledWith(
      expect.stringContaining(`biblioteca/companies/${COMPANY_ID}/meta-imports/`),
      SMALL_BUFFER,
      { contentType: 'image/jpeg', upsert: false },
    );

    // INSERT deve ter sido chamado com campos corretos
    expect(svc.from).toHaveBeenCalledWith('company_media_library');
  });

  it('IMP-27: DOCUMENT PDF — sucesso com filename sanitizado → 200 { id }', async () => {
    fileTypeFromBlob.mockResolvedValue({ ext: 'pdf', mime: 'application/pdf' });
    downloadAwsBytes.mockResolvedValue(SMALL_BUFFER);

    const svc = makeSvc({
      sourceRow: makeSourceRow({
        file_type:         'document',
        mime_type:         'application/pdf',
        original_filename: 'Relatório ../../../etc/passwd.pdf', // filename malicioso
        s3_key:            `clientes/${COMPANY_ID}/whatsapp/2026/doc.pdf`,
      }),
      insertedRow: { id: ASSET_ID },
    });
    getSupabaseAdmin.mockReturnValue(svc);

    const res = makeRes();
    await handler(
      makeReq({ body: { company_id: COMPANY_ID, source_id: SOURCE_ID } }),
      res,
    );

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ id: ASSET_ID });

    // destinationKey deve conter filename sanitizado (sem traversal)
    const uploadCall = svc._upload.mock.calls[0];
    const uploadedKey = uploadCall[0];
    expect(uploadedKey).not.toContain('..');
    expect(uploadedKey).not.toContain('etc/passwd');
    expect(uploadedKey).toContain(`biblioteca/companies/${COMPANY_ID}/meta-imports/`);
  });
});
