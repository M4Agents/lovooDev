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
  META_SEND_ROLES: ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  META_VIEW_ROLES: ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
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
const USER_ID     = '11111111-1111-4111-8111-111111111111';
const OTHER_USER  = '22222222-2222-4222-8222-222222222222';
const CONV_ID     = '33333333-3333-4333-8333-333333333333';
const INSTANCE_ID = '44444444-4444-4444-8444-444444444444';
const WAMID       = 'wamid.HBgLMTIzNDU2Nzg5MA';

const AUTH_OK = {
  ok: true,
  userId: USER_ID,
  companyId: COMPANY_ID,
  role: 'admin',
  accessPath: 'direct',
};

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

function companyChain({ flag = false, error = null, missing = false } = {}) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({
      data: missing || error ? null : { chat_visibility_by_assigned_to: flag },
      error,
    })),
  };
  return chain;
}

function makeSvc({
  cmlRows    = [VALID_CML_ROW],
  cmlError   = null,
  lmuRows    = [VALID_LMU_ROW],
  lmuError   = null,
  flag       = false,
  companyError = null,
  companyMissing = false,
} = {}) {
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

  const from = vi.fn().mockImplementation((table) => {
    if (table === 'companies') {
      return companyChain({ flag, error: companyError, missing: companyMissing });
    }
    const entry = fromMap[table] ?? { rows: [], error: null };
    const chain = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq     = vi.fn().mockReturnValue(chain);
    chain.order  = vi.fn().mockReturnValue(chain);
    chain.limit  = vi.fn().mockResolvedValue({ data: entry.rows, error: entry.error });
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

// =============================================================================
// Visibilidade da conversa — seller restrito e preservação da biblioteca
// =============================================================================

const META_PREVIEW = 'https://cdn.example.com/meta-private.jpg';
const SHARED_PREVIEW = 'https://cdn.example.com/shared.jpg';
const LMU_IMPORT_ID = '55555555-5555-4555-8555-555555555555';
const OP_ID = '66666666-6666-4666-8666-666666666666';

function sellerAuth(role = 'seller') {
  return { ...AUTH_OK, role, accessPath: role === 'partner' ? 'partner' : 'direct' };
}

function inboundRow(overrides = {}) {
  return {
    ...VALID_CML_ROW,
    id: CML_ID,
    company_id: COMPANY_ID,
    preview_url: META_PREVIEW,
    source_ref: `meta-inbound:${WAMID}`,
    s3_key: `biblioteca/companies/${COMPANY_ID}/meta-inbound/obj/photo.jpg`,
    ...overrides,
  };
}

function messageRow(overrides = {}) {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    company_id: COMPANY_ID,
    conversation_id: CONV_ID,
    instance_id: INSTANCE_ID,
    meta_message_id: WAMID,
    media_asset_id: CML_ID,
    ...overrides,
  };
}

function conversationRow(overrides = {}) {
  return {
    id: CONV_ID,
    company_id: COMPANY_ID,
    instance_id: INSTANCE_ID,
    assigned_to: USER_ID,
    status: 'active',
    ...overrides,
  };
}

function thenable(result) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: async () => result,
    maybeSingle: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function makeRestrictedSvc({
  commercial = [],
  meta = [],
  lmuRows = [],
  messages = [],
  operations = [],
  conversations = [],
  messageError = null,
  operationError = null,
  conversationError = null,
  flag = true,
  companyError = null,
} = {}) {
  const calls = { messages: 0, operations: 0, conversations: 0, cml: [] };
  const from = vi.fn((table) => {
    if (table === 'companies') return companyChain({ flag, error: companyError });
    if (table === 'lead_media_unified') return thenable({ data: lmuRows, error: null });
    if (table === 'meta_messages') {
      calls.messages += 1;
      return thenable({ data: messageError ? null : messages, error: messageError });
    }
    if (table === 'meta_outbound_audio_operations') {
      calls.operations += 1;
      return thenable({ data: operationError ? null : operations, error: operationError });
    }
    if (table === 'meta_conversations') {
      calls.conversations += 1;
      return thenable({ data: conversationError ? null : conversations, error: conversationError });
    }
    const chain = {};
    let filter = '';
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.or = (expr) => { filter = expr; return chain; };
    chain.order = () => chain;
    chain.limit = async () => {
      calls.cml.push(filter);
      if (filter.startsWith('source_ref.like.meta-inbound:%')) return { data: meta, error: null };
      return { data: commercial, error: null };
    };
    return chain;
  });
  return { from, calls };
}

function bodyText(res) {
  return JSON.stringify(res._body);
}

describe('visibilidade da mídia de conversa', () => {
  beforeEach(() => {
    validateMetaCaller.mockResolvedValue(sellerAuth());
  });

  it('A: seller restrito vê a mídia da própria conversa ativa', async () => {
    getSupabaseAdmin.mockReturnValue(makeRestrictedSvc({
      meta: [inboundRow()],
      messages: [messageRow()],
      conversations: [conversationRow()],
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body.items.map((item) => item.picker_id)).toEqual([`cml:${CML_ID}`]);
    expect(res._body.items[0].preview_url).toBe(META_PREVIEW);
    expect(res._body.items[0]).not.toHaveProperty('source_ref');
    expect(res._body.items[0]).not.toHaveProperty('s3_key');
  });

  it('B/C/D: outro vendedor, sem atribuição ou arquivada fica fora do DTO', async () => {
    const cases = [
      conversationRow({ assigned_to: OTHER_USER }),
      conversationRow({ assigned_to: null }),
      conversationRow({ status: 'archived' }),
    ];
    for (const conversation of cases) {
      getSupabaseAdmin.mockReturnValue(makeRestrictedSvc({
        meta: [inboundRow()],
        messages: [messageRow()],
        conversations: [conversation],
      }));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(200);
      expect(res._body.items).toEqual([]);
      expect(bodyText(res)).not.toContain(META_PREVIEW);
      expect(bodyText(res)).not.toContain('meta-inbound');
    }
  });

  it('E/F/G/H/I: origem ausente, ambígua, malformada, de outra empresa ou incompatível fica oculta', async () => {
    const hidden = [
      { meta: [inboundRow()], messages: [] },
      { meta: [inboundRow()], messages: [messageRow(), messageRow({ id: '88888888-8888-4888-8888-888888888888' })] },
      { meta: [inboundRow({ source_ref: 'meta-inbound:' })], messages: [messageRow()] },
      { meta: [inboundRow()], messages: [messageRow({ company_id: OTHER_CO_ID })] },
      { meta: [inboundRow()], messages: [messageRow({ media_asset_id: LMU_IMPORT_ID })] },
    ];
    for (const fixture of hidden) {
      getSupabaseAdmin.mockReturnValue(makeRestrictedSvc({
        ...fixture,
        conversations: [conversationRow()],
      }));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(200);
      expect(bodyText(res)).not.toContain(META_PREVIEW);
      expect(bodyText(res)).not.toContain(WAMID);
    }
  });

  it('J/K: flag falsa e role ampla preservam a mídia Meta no contrato atual', async () => {
    const meta = inboundRow();
    getSupabaseAdmin.mockReturnValue(makeSvc({ cmlRows: [meta], lmuRows: [], flag: false }));
    validateMetaCaller.mockResolvedValue(sellerAuth());
    const sellerRes = makeRes();
    await handler(makeReq(), sellerRes);
    expect(sellerRes._status).toBe(200);
    expect(sellerRes._body.items[0].preview_url).toBe(META_PREVIEW);

    getSupabaseAdmin.mockReturnValue(makeSvc({ cmlRows: [meta], lmuRows: [], flag: true }));
    validateMetaCaller.mockResolvedValue(sellerAuth('manager'));
    const managerRes = makeRes();
    await handler(makeReq(), managerRes);
    expect(managerRes._status).toBe(200);
    expect(managerRes._body.items[0].picker_id).toBe(`cml:${CML_ID}`);
  });

  it('L/M: partner sem empresa e membership inativa permanecem no guard', async () => {
    validateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'Acesso negado' });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Acesso negado' });
  });

  it('N: falha ao ler a flag fecha o acesso', async () => {
    const svc = makeSvc({ companyError: { message: 'db down' }, cmlRows: [inboundRow()], lmuRows: [] });
    getSupabaseAdmin.mockReturnValue(svc);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(503);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(svc.from).not.toHaveBeenCalledWith('company_media_library');
  });

  it('O: falha ao resolver a origem não devolve a mídia', async () => {
    getSupabaseAdmin.mockReturnValue(makeRestrictedSvc({
      meta: [inboundRow()],
      messageError: { message: 'messages down' },
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(bodyText(res)).not.toContain(META_PREVIEW);
  });

  it('P/Q/R: biblioteca sem origem, importação lmu e lead_media_unified permanecem', async () => {
    const shared = { ...VALID_CML_ROW, id: CONV_ID, preview_url: SHARED_PREVIEW, source_ref: null };
    const imported = {
      ...VALID_CML_ROW,
      id: LMU_IMPORT_ID,
      preview_url: 'https://cdn.example.com/imported.jpg',
      source_ref: `lmu:${LMU_ID}`,
    };
    const lmu = {
      ...VALID_LMU_ROW,
      id: LMU_ID_2,
      file_type: 'image',
      mime_type: 'image/jpeg',
      file_size: 1000,
      preview_url: 'https://cdn.example.com/lead.jpg',
    };
    getSupabaseAdmin.mockReturnValue(makeRestrictedSvc({
      commercial: [shared, imported],
      lmuRows: [lmu],
    }));
    const res = makeRes();
    await handler(makeReq({ query: { company_id: COMPANY_ID, media_type: 'IMAGE' } }), res);
    expect(res._status).toBe(200);
    const ids = res._body.items.map((item) => item.picker_id);
    expect(ids).toContain(`cml:${CONV_ID}`);
    expect(ids).toContain(`cml:${LMU_IMPORT_ID}`);
    expect(ids).toContain(`lmu:${LMU_ID_2}`);
  });

  it('U: mídia Meta negada não desloca arquivo comercial do limite', async () => {
    const commercial = {
      ...VALID_CML_ROW,
      id: CONV_ID,
      preview_url: SHARED_PREVIEW,
      created_at: '2020-01-01T00:00:00.000Z',
      source_ref: null,
    };
    const meta = Array.from({ length: 100 }, (_, index) => inboundRow({
      id: `99999999-9999-4999-8999-${index.toString().padStart(12, '0')}`,
      created_at: '2026-01-01T00:00:00.000Z',
      preview_url: `https://cdn.example.com/denied-${index}.jpg`,
      source_ref: `meta-inbound:wamid.DENIED${index}`,
    }));
    getSupabaseAdmin.mockReturnValue(makeRestrictedSvc({ commercial: [commercial], meta }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body.items.map((item) => item.picker_id)).toEqual([`cml:${CONV_ID}`]);
    expect(bodyText(res)).not.toContain('denied-0');
  });

  it('V: várias mídias resolvem origem em uma consulta por tabela', async () => {
    const rows = [0, 1, 2].map((index) => {
      const id = `abababab-0000-4000-8000-00000000000${index}`;
      const wamid = `wamid.BATCH${index}`;
      return {
        row: inboundRow({ id, source_ref: `meta-inbound:${wamid}`, preview_url: `https://cdn.example.com/own-${index}.jpg` }),
        message: messageRow({ id, meta_message_id: wamid, media_asset_id: id }),
      };
    });
    const svc = makeRestrictedSvc({
      meta: rows.map((item) => item.row),
      messages: rows.map((item) => item.message),
      conversations: [conversationRow()],
    });
    getSupabaseAdmin.mockReturnValue(svc);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body.items).toHaveLength(3);
    expect(svc.calls.messages).toBe(1);
    expect(svc.calls.conversations).toBe(1);
    expect(svc.calls.operations).toBe(0);
  });

  it('W: transferência entre requisições deixa de devolver a mídia', async () => {
    const first = makeRestrictedSvc({
      meta: [inboundRow()],
      messages: [messageRow()],
      conversations: [conversationRow({ assigned_to: USER_ID })],
    });
    getSupabaseAdmin.mockReturnValue(first);
    const allowed = makeRes();
    await handler(makeReq(), allowed);
    expect(allowed._body.items).toHaveLength(1);

    const second = makeRestrictedSvc({
      meta: [inboundRow()],
      messages: [messageRow()],
      conversations: [conversationRow({ assigned_to: OTHER_USER })],
    });
    getSupabaseAdmin.mockReturnValue(second);
    const denied = makeRes();
    await handler(makeReq(), denied);
    expect(denied._status).toBe(200);
    expect(denied._body.items).toEqual([]);
    expect(bodyText(denied)).not.toContain(META_PREVIEW);
  });

  it('AD: item autorizado mantém o contrato do picker', async () => {
    getSupabaseAdmin.mockReturnValue(makeRestrictedSvc({
      meta: [inboundRow()],
      messages: [messageRow()],
      conversations: [conversationRow()],
    }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(Object.keys(res._body).sort()).toEqual(['items', 'truncated']);
    expect(Object.keys(res._body.items[0]).sort()).toEqual([
      'file_size', 'filename', 'media_type', 'mime_type', 'picker_id', 'preview_url', 'source',
    ]);
  });
});
