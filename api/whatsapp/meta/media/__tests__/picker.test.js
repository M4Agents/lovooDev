// =============================================================================
// picker.test.js
//
// Testes unitários para GET /api/whatsapp/meta/media/picker (MVP4B.4D.2C)
// Todos os testes usam mocks — sem banco real, sem AWS, sem network.
//
// COBERTURA (15 casos):
//
//   HTTP:
//     PCK-01  não-GET (POST) → 405 + Allow: GET; guard não chamado
//
//   AUTH + RBAC:
//     PCK-02  sem auth → 401
//     PCK-03  role proibida → 403
//     PCK-04  feature flag off → 403
//
//   VALIDAÇÃO media_type:
//     PCK-05  media_type inválido → 400 invalid_media_type
//
//   DTO CML:
//     PCK-06  CML IMAGE item → picker_id = 'cml:<uuid>'; source = 'company_media_library'
//
//   DTO LMU:
//     PCK-07  LMU VIDEO item → picker_id = 'lmu:<uuid>'; source = 'lead_media_unified'
//
//   FILTROS em memória:
//     PCK-08  LMU com MIME fora da whitelist → excluído
//     PCK-09  LMU com file_size > limite → excluído
//     PCK-10  LMU com s3_key sem prefixo correto → excluído
//
//   DEDUPE:
//     PCK-11  LMU com source_ref importado em CML → LMU excluído; CML presente
//     PCK-12  CML sem source_ref → LMU não deduplicado (não exclusão incorreta)
//
//   SEGURANÇA DE RESPOSTA:
//     PCK-13  response NÃO contém s3_key / source_ref / internals
//
//   SORT + TRUNCATE:
//     PCK-14  sort descending: CML mais novo antes de CML mais antigo
//     PCK-15  allItems > 100 → truncated=true; resposta com exatamente 100 items
// =============================================================================

import { vi, describe, it, expect, beforeEach } from 'vitest';

// =============================================================================
// Mocks
// =============================================================================

vi.mock('../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  validateMetaCaller: vi.fn(),
  META_SEND_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
}));

vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(),
}));

// =============================================================================
// Imports pós-mocks
// =============================================================================

import { validateMetaCaller }  from '../../../../lib/meta-whatsapp/validateMetaCaller.js';
import { getSupabaseAdmin }    from '../../../../lib/automation/supabaseAdmin.js';
import handler                 from '../picker.js';

// =============================================================================
// Fixtures
// =============================================================================

const COMPANY_ID  = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const OTHER_CO_ID = 'cccccccc-0000-0000-0000-cccccccccccc';
const CML_ID      = 'bbbbbbbb-1111-0000-0000-bbbbbbbbbbbb';
const LMU_ID      = 'dddddddd-2222-0000-0000-dddddddddddd';
const LMU_ID_2    = 'eeeeeeee-3333-0000-0000-eeeeeeeeeeee';

const AUTH_OK = { ok: true, userId: 'uuuu-0000', companyId: COMPANY_ID, role: 'admin' };

const VALID_CML_ROW = {
  id:                CML_ID,
  original_filename: 'photo.jpg',
  file_type:         'image',
  mime_type:         'image/jpeg',
  file_size:         1_000_000,
  preview_url:       'https://cdn.example.com/photo.jpg',
  created_at:        '2026-09-20T12:00:00.000Z',
  source_ref:        null,
};

const VALID_LMU_ROW = {
  id:                LMU_ID,
  original_filename: 'received.mp4',
  file_type:         'video',
  mime_type:         'video/mp4',
  file_size:         8_000_000,
  preview_url:       null,
  received_at:       '2026-09-19T10:00:00.000Z',
  s3_key:            `clientes/${COMPANY_ID}/whatsapp/2026/09/received.mp4`,
};

// =============================================================================
// Factory do mock Supabase com controle de resultados por tabela
// =============================================================================

function makeSvc({
  cmlRows    = [VALID_CML_ROW],
  cmlError   = null,
  lmuRows    = [VALID_LMU_ROW],
  lmuError   = null,
} = {}) {
  // Controla qual resultado retornar baseado na tabela consultada
  const fromMap = {
    company_media_library: {
      rows:  cmlRows,
      error: cmlError,
    },
    lead_media_unified: {
      rows:  lmuRows,
      error: lmuError,
    },
  };

  const limit = vi.fn().mockImplementation(function () {
    return Promise.resolve({
      data:  this._rows,
      error: this._error,
    });
  });

  const order = vi.fn().mockReturnThis();
  const eq    = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnThis();

  // O from é chamado com o nome da tabela; retorna query chain com dados corretos
  const from = vi.fn().mockImplementation((table) => {
    const entry = fromMap[table] ?? { rows: [], error: null };
    const chain = {
      _rows:  entry.rows,
      _error: entry.error,
      select,
      eq,
      order,
      limit,
    };
    // Fazer limit usar o contexto correto
    chain.limit = vi.fn().mockResolvedValue({ data: entry.rows, error: entry.error });
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq     = vi.fn().mockReturnValue(chain);
    chain.order  = vi.fn().mockReturnValue(chain);
    return chain;
  });

  return { from };
}

// =============================================================================
// Helpers req/res
// =============================================================================

function makeReq(overrides = {}) {
  return {
    method:  'GET',
    headers: { authorization: 'Bearer valid-token' },
    query:   { company_id: COMPANY_ID, media_type: 'IMAGE' },
    ...overrides,
  };
}

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
  validateMetaCaller.mockResolvedValue(AUTH_OK);
  getSupabaseAdmin.mockReturnValue(makeSvc());
});

// =============================================================================
// HTTP
// =============================================================================

describe('HTTP method guard', () => {
  it('PCK-01: POST → 405 + Allow: GET; guard não chamado', async () => {
    const req = makeReq({ method: 'POST' });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(405);
    expect(res._body).toEqual({ error: 'method_not_allowed' });
    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET');
    expect(validateMetaCaller).not.toHaveBeenCalled();
  });
});

// =============================================================================
// AUTH + RBAC
// =============================================================================

describe('Auth + RBAC', () => {
  it('PCK-02: sem auth → 401', async () => {
    validateMetaCaller.mockResolvedValue({ ok: false, status: 401, error: 'unauthorized' });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(401);
  });

  it('PCK-03: role proibida → 403', async () => {
    validateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'forbidden' });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
  });

  it('PCK-04: feature flag off → 403', async () => {
    validateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'feature_disabled' });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'feature_disabled' });
  });
});

// =============================================================================
// Validação media_type
// =============================================================================

describe('Validação media_type', () => {
  it('PCK-05: media_type inválido → 400 invalid_media_type', async () => {
    const req = makeReq({ query: { company_id: COMPANY_ID, media_type: 'AUDIO' } });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'invalid_media_type' });
  });
});

// =============================================================================
// DTO CML
// =============================================================================

describe('DTO CML', () => {
  it('PCK-06: CML IMAGE item → picker_id = "cml:<uuid>"; source correto', async () => {
    getSupabaseAdmin.mockReturnValue(makeSvc({
      cmlRows: [{ ...VALID_CML_ROW, file_type: 'image', mime_type: 'image/jpeg' }],
      lmuRows: [],
    }));

    const req = makeReq({ query: { company_id: COMPANY_ID, media_type: 'IMAGE' } });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.items).toHaveLength(1);
    expect(res._body.items[0].picker_id).toBe(`cml:${CML_ID}`);
    expect(res._body.items[0].source).toBe('company_media_library');
    expect(res._body.items[0].media_type).toBe('IMAGE');
    expect(res._body.items[0].filename).toBe('photo.jpg');
    expect(res._body.truncated).toBe(false);
  });
});

// =============================================================================
// DTO LMU
// =============================================================================

describe('DTO LMU', () => {
  it('PCK-07: LMU VIDEO item → picker_id = "lmu:<uuid>"; source correto', async () => {
    getSupabaseAdmin.mockReturnValue(makeSvc({
      cmlRows: [],
      lmuRows: [{ ...VALID_LMU_ROW, file_type: 'video', mime_type: 'video/mp4' }],
    }));

    const req = makeReq({ query: { company_id: COMPANY_ID, media_type: 'VIDEO' } });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.items).toHaveLength(1);
    expect(res._body.items[0].picker_id).toBe(`lmu:${LMU_ID}`);
    expect(res._body.items[0].source).toBe('lead_media_unified');
    expect(res._body.items[0].media_type).toBe('VIDEO');
  });
});

// =============================================================================
// Filtros em memória
// =============================================================================

describe('Filtros em memória', () => {
  it('PCK-08: LMU com MIME fora da whitelist → excluído', async () => {
    getSupabaseAdmin.mockReturnValue(makeSvc({
      cmlRows: [],
      lmuRows: [{
        ...VALID_LMU_ROW,
        file_type: 'image',
        mime_type: 'image/webp',  // fora da whitelist
        s3_key: `clientes/${COMPANY_ID}/whatsapp/img.webp`,
      }],
    }));

    const req = makeReq({ query: { company_id: COMPANY_ID, media_type: 'IMAGE' } });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.items).toHaveLength(0);
  });

  it('PCK-09: LMU com file_size > limite → excluído', async () => {
    getSupabaseAdmin.mockReturnValue(makeSvc({
      cmlRows: [],
      lmuRows: [{
        ...VALID_LMU_ROW,
        file_type:  'image',
        mime_type:  'image/jpeg',
        file_size:  6 * 1024 * 1024, // 6 MB > IMAGE limit 5 MB
        s3_key:     `clientes/${COMPANY_ID}/whatsapp/large.jpg`,
      }],
    }));

    const req = makeReq({ query: { company_id: COMPANY_ID, media_type: 'IMAGE' } });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.items).toHaveLength(0);
  });

  it('PCK-10: LMU com s3_key sem prefixo correto → excluído', async () => {
    getSupabaseAdmin.mockReturnValue(makeSvc({
      cmlRows: [],
      lmuRows: [{
        ...VALID_LMU_ROW,
        file_type: 'video',
        mime_type: 'video/mp4',
        s3_key:    `clientes/${OTHER_CO_ID}/whatsapp/other.mp4`, // outro tenant
      }],
    }));

    const req = makeReq({ query: { company_id: COMPANY_ID, media_type: 'VIDEO' } });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.items).toHaveLength(0);
  });
});

// =============================================================================
// Dedupe CML × LMU
// =============================================================================

describe('Dedupe CML × LMU via source_ref', () => {
  it('PCK-11: LMU com source_ref importado em CML → LMU excluído; CML presente', async () => {
    // CML importou o LMU (source_ref = 'lmu:<LMU_ID>')
    const cmlImported = {
      ...VALID_CML_ROW,
      file_type:  'image',
      mime_type:  'image/jpeg',
      source_ref: `lmu:${LMU_ID}`,
    };
    const lmuOriginal = {
      ...VALID_LMU_ROW,
      id:        LMU_ID,
      file_type: 'image',
      mime_type: 'image/jpeg',
      s3_key:    `clientes/${COMPANY_ID}/whatsapp/orig.jpg`,
    };

    getSupabaseAdmin.mockReturnValue(makeSvc({
      cmlRows: [cmlImported],
      lmuRows: [lmuOriginal],
    }));

    const req = makeReq({ query: { company_id: COMPANY_ID, media_type: 'IMAGE' } });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(200);
    // Somente CML no resultado — LMU original deve estar ausente
    expect(res._body.items).toHaveLength(1);
    expect(res._body.items[0].picker_id).toBe(`cml:${CML_ID}`);
    expect(res._body.items.some(i => i.picker_id === `lmu:${LMU_ID}`)).toBe(false);
  });

  it('PCK-12: CML sem source_ref → LMU não deduplicado indevidamente', async () => {
    const cmlNoRef = { ...VALID_CML_ROW, source_ref: null, file_type: 'image', mime_type: 'image/jpeg' };
    const lmuUnrelated = {
      ...VALID_LMU_ROW,
      id:        LMU_ID_2,
      file_type: 'image',
      mime_type: 'image/jpeg',
      file_size: 1_000_000,  // < 5 MB IMAGE limit — válido para passar no filtro de tamanho
      s3_key:    `clientes/${COMPANY_ID}/whatsapp/unrelated.jpg`,
    };

    getSupabaseAdmin.mockReturnValue(makeSvc({
      cmlRows: [cmlNoRef],
      lmuRows: [lmuUnrelated],
    }));

    const req = makeReq({ query: { company_id: COMPANY_ID, media_type: 'IMAGE' } });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(200);
    // Ambos devem aparecer
    expect(res._body.items).toHaveLength(2);
    expect(res._body.items.some(i => i.picker_id === `cml:${CML_ID}`)).toBe(true);
    expect(res._body.items.some(i => i.picker_id === `lmu:${LMU_ID_2}`)).toBe(true);
  });
});

// =============================================================================
// Segurança de resposta
// =============================================================================

describe('Segurança de resposta', () => {
  it('PCK-13: response não contém s3_key / source_ref / internals', async () => {
    getSupabaseAdmin.mockReturnValue(makeSvc({
      cmlRows: [{ ...VALID_CML_ROW, file_type: 'image', mime_type: 'image/jpeg' }],
      lmuRows: [{
        ...VALID_LMU_ROW,
        file_type: 'image',
        mime_type: 'image/jpeg',
        s3_key: `clientes/${COMPANY_ID}/whatsapp/img.jpg`,
      }],
    }));

    const req = makeReq({ query: { company_id: COMPANY_ID, media_type: 'IMAGE' } });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(200);
    for (const item of res._body.items) {
      expect(item).not.toHaveProperty('s3_key');
      expect(item).not.toHaveProperty('source_ref');
      expect(item).not.toHaveProperty('_date');
      expect(item).not.toHaveProperty('created_at');
      expect(item).not.toHaveProperty('received_at');
      expect(item).not.toHaveProperty('lead_id');
      expect(item).not.toHaveProperty('company_id');
      // Campos esperados
      expect(item).toHaveProperty('picker_id');
      expect(item).toHaveProperty('source');
      expect(item).toHaveProperty('filename');
      expect(item).toHaveProperty('media_type');
      expect(item).toHaveProperty('mime_type');
      expect(item).toHaveProperty('file_size');
      expect(item).toHaveProperty('preview_url');
    }
  });
});

// =============================================================================
// Sort + Truncate
// =============================================================================

describe('Sort + Truncate', () => {
  it('PCK-14: CML mais recente aparece antes de CML mais antigo', async () => {
    const newer = { ...VALID_CML_ROW, id: 'newer-id-0000-0000-0000-000000000000', created_at: '2026-09-22T10:00:00.000Z', file_type: 'image', mime_type: 'image/jpeg', source_ref: null };
    const older = { ...VALID_CML_ROW, id: 'older-id-0000-0000-0000-000000000000', created_at: '2026-09-20T10:00:00.000Z', file_type: 'image', mime_type: 'image/jpeg', source_ref: null };

    getSupabaseAdmin.mockReturnValue(makeSvc({
      cmlRows: [older, newer], // entram fora de ordem intencionalmente
      lmuRows: [],
    }));

    const req = makeReq({ query: { company_id: COMPANY_ID, media_type: 'IMAGE' } });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.items[0].picker_id).toBe('cml:newer-id-0000-0000-0000-000000000000');
    expect(res._body.items[1].picker_id).toBe('cml:older-id-0000-0000-0000-000000000000');
  });

  it('PCK-15: allItems > 100 → truncated=true; resposta com exatamente 100 items', async () => {
    // 80 CML + 40 LMU = 120 items pré-filtro → truncated
    const cmlBatch = Array.from({ length: 80 }, (_, i) => ({
      id:                `cml-id-${i.toString().padStart(36, '0')}`.slice(0, 36),
      original_filename: `file-${i}.jpg`,
      file_type:         'image',
      mime_type:         'image/jpeg',
      file_size:         100_000,
      preview_url:       null,
      created_at:        `2026-09-${(i % 28 + 1).toString().padStart(2, '0')}T10:00:00.000Z`,
      source_ref:        null,
    }));

    const lmuBatch = Array.from({ length: 40 }, (_, i) => ({
      id:                `lmu-id-${i.toString().padStart(36, '0')}`.slice(0, 36),
      original_filename: `recv-${i}.jpg`,
      file_type:         'image',
      mime_type:         'image/jpeg',
      file_size:         100_000,
      preview_url:       null,
      received_at:       `2026-08-${(i % 28 + 1).toString().padStart(2, '0')}T10:00:00.000Z`,
      s3_key:            `clientes/${COMPANY_ID}/whatsapp/recv-${i}.jpg`,
    }));

    getSupabaseAdmin.mockReturnValue(makeSvc({ cmlRows: cmlBatch, lmuRows: lmuBatch }));

    const req = makeReq({ query: { company_id: COMPANY_ID, media_type: 'IMAGE' } });
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.truncated).toBe(true);
    expect(res._body.items).toHaveLength(100);
  });
});
