// =============================================================================
// index.test.js
//
// Testes unitários para GET /api/whatsapp/meta/templates
// Todos os testes usam mocks — sem banco, rede, Graph, decrypt ou token real.
//
// COBERTURA (TPL-01 a TPL-45):
//
//   TPL-01  GET happy path — retorna 200 com lista sanitizada
//   TPL-02  POST/PUT/DELETE → 405 + Allow: GET
//   TPL-03  sem Authorization → 401
//   TPL-04  role inválida → 403
//   TPL-05  feature flag off → 403
//   TPL-06  company_id inválido → 400
//   TPL-07  instance_id inválido → 400
//   TPL-08  instance inexistente → 404 instance_not_found
//   TPL-09  cross-tenant instance → mesmo 404
//   TPL-10  instance não connected → 409
//   TPL-11  credential ausente → erro sanitizado
//   TPL-12  decrypt failure → erro sanitizado
//   TPL-13  Graph failure → provider error sanitizado
//   TPL-14  lista vazia → 200 com templates: []
//   TPL-15  nextCursor presente → retorna next_cursor
//   TPL-16  after repassado ao graphClient
//   TPL-17  after inválido/grande → 400
//   TPL-18  somente auth.companyId nos lookups de DB
//   TPL-19  Graph recebe waba_id somente do banco
//   TPL-20  Graph recebe token decriptado somente backend
//   TPL-21  status APPROVED hardcoded na chamada Graph
//   TPL-22  limit 100 hardcoded na chamada Graph
//   TPL-23  DTO não contém token/waba/phone_number_id
//   TPL-24  POSITIONAL body params — extração correta
//   TPL-25  POSITIONAL header param — extração correta
//   TPL-26  NAMED body params — extração correta
//   TPL-27  NAMED header param — extração correta
//   TPL-28  parameter_format ausente → assume POSITIONAL
//   TPL-29  BODY TEXT → supported=true
//   TPL-30  HEADER TEXT → supported=true
//   TPL-31  FOOTER → supported=true
//   TPL-32  HEADER IMAGE → supported=false
//   TPL-33  HEADER VIDEO → supported=false
//   TPL-34  HEADER DOCUMENT → supported=false
//   TPL-35  BUTTONS → supported=false
//   TPL-36  CAROUSEL → supported=false
//   TPL-37  AUTHENTICATION → supported=false
//   TPL-38  unknown parameter_format → supported=false
//   TPL-39  components inválidos (não-array) → unsupported
//   TPL-40  template malformed (sem id) não vira supported
//   TPL-41  N+1: uma única chamada Graph por request
//   TPL-42  nenhuma query de banco usa tenant externo
//   TPL-43  cursor nunca tratado como URL
//   TPL-44  Graph raw error não vaza na resposta
//   TPL-45  examples sensíveis não aparecem em logs de erro
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks (antes dos imports do handler)
// =============================================================================

const mockSvc = { from: vi.fn(), auth: { getUser: vi.fn() } };

vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

const mockValidateMetaCaller = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  META_VIEW_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  META_SEND_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  META_CONNECT_ROLES: ['super_admin', 'system_admin', 'partner', 'admin'],
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
}));

const mockDecryptMetaToken = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/tokenCrypto.js', () => ({
  decryptMetaToken: (...args) => mockDecryptMetaToken(...args),
}));

const mockListMessageTemplates = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/graphClient.js', () => ({
  listMessageTemplates: (...args) => mockListMessageTemplates(...args),
}));

import handler from '../index.js';

// =============================================================================
// Fixtures — todos fictícios, nunca reais
// =============================================================================

const FAKE_COMPANY_ID  = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_USER_ID     = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_INSTANCE_ID = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_WABA_ID     = '111111111111111';
const FAKE_TOKEN_ENC   = 'enc:fake:cipher:xyz';
const FAKE_TOKEN_PLAIN = 'EAAFakeTokenForTesting123456789';

// Template de exemplo — BODY TEXT simples POSITIONAL
const FAKE_TEMPLATE_SIMPLE = {
  id:               'tpl-001',
  name:             'hello_world',
  language:         'pt_BR',
  status:           'APPROVED',
  category:         'MARKETING',
  parameter_format: 'POSITIONAL',
  components: [
    {
      type: 'BODY',
      text: 'Olá, {{1}}! Bem-vindo.',
      example: {
        body_text: [['João']],
      },
    },
  ],
};

// Template POSITIONAL com HEADER TEXT
const FAKE_TEMPLATE_WITH_HEADER = {
  id:               'tpl-002',
  name:             'promo_basic',
  language:         'pt_BR',
  status:           'APPROVED',
  category:         'MARKETING',
  parameter_format: 'POSITIONAL',
  components: [
    {
      type:   'HEADER',
      format: 'TEXT',
      text:   '{{1}}',
      example: { header_text: ['LovooCRM'] },
    },
    {
      type: 'BODY',
      text: 'Olá, {{1}}! Veja nossa oferta.',
      example: { body_text: [['Maria']] },
    },
    {
      type: 'FOOTER',
      text: 'Responda STOP para cancelar.',
    },
  ],
};

// Template NAMED
const FAKE_TEMPLATE_NAMED = {
  id:               'tpl-003',
  name:             'order_confirmation',
  language:         'en_US',
  status:           'APPROVED',
  category:         'UTILITY',
  parameter_format: 'NAMED',
  components: [
    {
      type:   'HEADER',
      format: 'TEXT',
      text:   '{{company_name}}',
      example: {
        header_text_named_params: [{ param_name: 'company_name', example: 'LovooCRM' }],
      },
    },
    {
      type: 'BODY',
      text: 'Olá {{first_name}}, seu pedido {{order_id}} foi confirmado.',
      example: {
        body_text_named_params: [
          { param_name: 'first_name', example: 'Ana' },
          { param_name: 'order_id',  example: 'ORD-9999' },
        ],
      },
    },
  ],
};

// Template AUTHENTICATION
const FAKE_TEMPLATE_AUTH = {
  id:               'tpl-otp',
  name:             'otp_code',
  language:         'pt_BR',
  status:           'APPROVED',
  category:         'AUTHENTICATION',
  parameter_format: 'POSITIONAL',
  components: [
    {
      type: 'BODY',
      text: 'Seu código é {{1}}.',
      example: { body_text: [['123456']] },
    },
    {
      type: 'BUTTONS',
      buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }],
    },
  ],
};

// Template com HEADER IMAGE
const FAKE_TEMPLATE_IMAGE_HEADER = {
  id:               'tpl-img',
  name:             'promo_image',
  language:         'pt_BR',
  status:           'APPROVED',
  category:         'MARKETING',
  parameter_format: 'POSITIONAL',
  components: [
    {
      type:   'HEADER',
      format: 'IMAGE',
      example: { header_handle: ['https://example.com/img.jpg'] },
    },
    {
      type: 'BODY',
      text: 'Veja nossa promoção!',
    },
  ],
};

// =============================================================================
// Helpers de mock
// =============================================================================

function makeAuthOk(companyId = FAKE_COMPANY_ID) {
  return { ok: true, userId: FAKE_USER_ID, companyId, role: 'admin', accessPath: 'direct' };
}

function makeInstance(overrides = {}) {
  return {
    id:      FAKE_INSTANCE_ID,
    waba_id: FAKE_WABA_ID,
    status:  'connected',
    ...overrides,
  };
}

function makeCredential() {
  return { access_token_enc: FAKE_TOKEN_ENC };
}

function makeListResult(templates = [], nextCursor = null) {
  return { templates, nextCursor };
}

/**
 * Configura cadeia de mocks do Supabase para o handler de templates.
 *
 * Cadeia de instância:
 *   from('meta_whatsapp_instances')
 *     .select('id, waba_id, status')    ← selectInst → { eq: eqInst1 }
 *     .eq('id', instanceId)             ← eqInst1    → { eq: eqInst2 }
 *     .eq('company_id', auth.companyId) ← eqInst2    → { is: isInst }
 *     .is('deleted_at', null)           ← isInst     → { maybeSingle }
 *     .maybeSingle()
 *
 * Cadeia de credencial:
 *   from('meta_whatsapp_credentials')
 *     .select('access_token_enc')       ← selectCred → { eq: eqCred }
 *     .eq('instance_id', instance.id)   ← eqCred     → { maybeSingle }
 *     .maybeSingle()
 *
 * @param {object|null} instanceData  null → instância não encontrada
 * @param {object|null} credData      null → credencial não encontrada
 */
function setupDbMocks(instanceData = makeInstance(), credData = makeCredential()) {
  const maybeSingleInst = vi.fn().mockResolvedValue({ data: instanceData, error: null });
  const isInst          = vi.fn().mockReturnValue({ maybeSingle: maybeSingleInst });
  const eqInst2         = vi.fn().mockReturnValue({ is: isInst });        // ← .eq('company_id') → .is()
  const eqInst1         = vi.fn().mockReturnValue({ eq: eqInst2 });       // ← .eq('id')         → .eq()
  const selectInst      = vi.fn().mockReturnValue({ eq: eqInst1 });

  const maybeSingleCred = vi.fn().mockResolvedValue({ data: credData, error: null });
  const eqCred          = vi.fn().mockReturnValue({ maybeSingle: maybeSingleCred });
  const selectCred      = vi.fn().mockReturnValue({ eq: eqCred });

  mockSvc.from.mockImplementation(table => {
    if (table === 'meta_whatsapp_instances') return { select: selectInst };
    if (table === 'meta_whatsapp_credentials') return { select: selectCred };
    return { select: vi.fn().mockReturnValue({ eq: vi.fn() }) };
  });

  return {
    selectInst, eqInst1, eqInst2, isInst, maybeSingleInst,
    selectCred, eqCred, maybeSingleCred,
  };
}

function makeReq(overrides = {}) {
  return {
    method: 'GET',
    headers: { authorization: 'Bearer fake-token' },
    query: {
      company_id:  FAKE_COMPANY_ID,
      instance_id: FAKE_INSTANCE_ID,
      ...overrides.query,
    },
    ...overrides,
  };
}

function makeRes() {
  const res = {
    _status: null,
    _body:   null,
    _headers: {},
    status(code) { this._status = code; return this; },
    json(body)   { this._body   = body; return this; },
    setHeader(k, v) { this._headers[k] = v; },
  };
  return res;
}

// =============================================================================
// Setup
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  mockValidateMetaCaller.mockResolvedValue(makeAuthOk());
  mockDecryptMetaToken.mockReturnValue(FAKE_TOKEN_PLAIN);
  mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_SIMPLE]));
  setupDbMocks();
});

// =============================================================================
// TPL-01  GET happy path
// =============================================================================

describe('TPL-01 happy path', () => {
  it('retorna 200 com lista de templates sanitizados', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toHaveProperty('templates');
    expect(res._body).toHaveProperty('next_cursor');
    expect(Array.isArray(res._body.templates)).toBe(true);
    expect(res._body.templates).toHaveLength(1);

    const tpl = res._body.templates[0];
    expect(tpl.id).toBe('tpl-001');
    expect(tpl.status).toBe('APPROVED');
    expect(tpl.supported).toBe(true);
  });
});

// =============================================================================
// TPL-02  method guard
// =============================================================================

describe('TPL-02 method not allowed', () => {
  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])(
    '%s → 405 + Allow: GET',
    async (method) => {
      const req = makeReq({ method });
      const res = makeRes();
      await handler(req, res);
      expect(res._status).toBe(405);
      expect(res._body.error).toBe('Method not allowed');
      expect(res._headers['Allow']).toBe('GET');
    }
  );
});

// =============================================================================
// TPL-03  sem auth → 401
// =============================================================================

describe('TPL-03 sem Authorization', () => {
  it('sem header → 401', async () => {
    mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 401, error: 'Autenticação necessária' });
    const req = makeReq({ headers: {} });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(401);
    expect(res._body.error).toBe('Autenticação necessária');
  });

  it('JWT inválido → 401', async () => {
    mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 401, error: 'Sessão inválida ou expirada' });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(401);
  });
});

// =============================================================================
// TPL-04  role inválida → 403
// =============================================================================

describe('TPL-04 role inválida', () => {
  it('role sem permissão → 403', async () => {
    mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'Permissão insuficiente para esta operação' });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(403);
  });
});

// =============================================================================
// TPL-05  feature flag off → 403
// =============================================================================

describe('TPL-05 feature flag off', () => {
  it('meta_whatsapp_enabled=false → 403', async () => {
    mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'Meta WhatsApp não habilitado para esta empresa' });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(403);
    expect(res._body.error).toContain('Meta WhatsApp');
  });
});

// =============================================================================
// TPL-06  company_id inválido → 400
// =============================================================================

describe('TPL-06 company_id inválido', () => {
  it('ausente → 400', async () => {
    const req = makeReq({ query: { instance_id: FAKE_INSTANCE_ID } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
  });
});

// =============================================================================
// TPL-07  instance_id inválido → 400
// =============================================================================

describe('TPL-07 instance_id inválido', () => {
  it('ausente → 400', async () => {
    const req = makeReq({ query: { company_id: FAKE_COMPANY_ID } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
  });

  it('UUID inválido → 400', async () => {
    const req = makeReq({ query: { company_id: FAKE_COMPANY_ID, instance_id: 'not-a-uuid' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
  });
});

// =============================================================================
// TPL-08  instance inexistente → 404
// =============================================================================

describe('TPL-08 instance inexistente', () => {
  it('não encontrada → 404 instance_not_found', async () => {
    setupDbMocks(null);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('instance_not_found');
  });
});

// =============================================================================
// TPL-09  cross-tenant instance → 404 (mesmo que instância inexistente)
// =============================================================================

describe('TPL-09 cross-tenant instance', () => {
  it('instância de outra company → resposta opaca 404', async () => {
    // Simula: instância existe no banco mas pertence a outra company.
    // O lookup com auth.companyId não a encontra → null → 404 idêntico.
    setupDbMocks(null);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('instance_not_found');
    // Resposta não revela que a instância existe em outro tenant
    expect(JSON.stringify(res._body)).not.toContain('tenant');
    expect(JSON.stringify(res._body)).not.toContain('another');
  });
});

// =============================================================================
// TPL-10  instance não connected → 409
// =============================================================================

describe('TPL-10 instance não connected', () => {
  it.each(['disconnected', 'error', 'token_revoked', 'pending'])(
    'status %s → 409 instance_not_connected',
    async (status) => {
      setupDbMocks(makeInstance({ status }));
      const req = makeReq();
      const res = makeRes();
      await handler(req, res);
      expect(res._status).toBe(409);
      expect(res._body.error).toBe('instance_not_connected');
    }
  );
});

// =============================================================================
// TPL-11  credential ausente → erro sanitizado
// =============================================================================

describe('TPL-11 credential ausente', () => {
  it('sem credencial → 500 credentials_missing', async () => {
    setupDbMocks(makeInstance(), null);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('credentials_missing');
  });

  it('access_token_enc ausente na credencial → 500 credentials_missing', async () => {
    setupDbMocks(makeInstance(), { access_token_enc: null });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('credentials_missing');
  });
});

// =============================================================================
// TPL-12  decrypt failure → erro sanitizado
// =============================================================================

describe('TPL-12 decrypt failure', () => {
  it('decryptMetaToken lança → 500 credentials_missing', async () => {
    mockDecryptMetaToken.mockImplementation(() => { throw new Error('crypto failure'); });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('credentials_missing');
    // Mensagem do crypto não vaza
    expect(JSON.stringify(res._body)).not.toContain('crypto failure');
  });
});

// =============================================================================
// TPL-13  Graph failure → provider error sanitizado
// =============================================================================

describe('TPL-13 Graph failure', () => {
  it('graph_templates_failed → 502 provider_error', async () => {
    const graphErr = new Error('Graph API error');
    graphErr.code = 'graph_templates_failed';
    mockListMessageTemplates.mockRejectedValue(graphErr);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(502);
    expect(res._body.error).toBe('provider_error');
  });

  it('graph_timeout → 503 provider_unavailable', async () => {
    const graphErr = new Error('timeout');
    graphErr.code = 'graph_timeout';
    mockListMessageTemplates.mockRejectedValue(graphErr);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(503);
    expect(res._body.error).toBe('provider_unavailable');
  });

  it('graph_network_error → 503 provider_unavailable', async () => {
    const graphErr = new Error('network');
    graphErr.code = 'graph_network_error';
    mockListMessageTemplates.mockRejectedValue(graphErr);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(503);
    expect(res._body.error).toBe('provider_unavailable');
  });

  it('código desconhecido → 502 provider_error', async () => {
    const graphErr = new Error('unknown');
    graphErr.code = 'graph_unknown_error_xyz';
    mockListMessageTemplates.mockRejectedValue(graphErr);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(502);
    expect(res._body.error).toBe('provider_error');
  });
});

// =============================================================================
// TPL-14  lista vazia → 200 com templates: []
// =============================================================================

describe('TPL-14 lista vazia', () => {
  it('WABA sem templates aprovados → 200 com array vazio', async () => {
    mockListMessageTemplates.mockResolvedValue(makeListResult([]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body.templates).toEqual([]);
    expect(res._body.next_cursor).toBeNull();
  });
});

// =============================================================================
// TPL-15  nextCursor presente → retorna next_cursor
// =============================================================================

describe('TPL-15 paginação nextCursor', () => {
  it('nextCursor populado → retornado como next_cursor', async () => {
    const cursor = 'opaque-cursor-abc123==';
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_SIMPLE], cursor));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body.next_cursor).toBe(cursor);
  });

  it('nextCursor null → next_cursor é null', async () => {
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_SIMPLE], null));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._body.next_cursor).toBeNull();
  });
});

// =============================================================================
// TPL-16  after repassado ao graphClient
// =============================================================================

describe('TPL-16 after repassado ao graphClient', () => {
  it('after válido → repassado para listMessageTemplates', async () => {
    const after = 'some-cursor-value==';
    const req   = makeReq({ query: { company_id: FAKE_COMPANY_ID, instance_id: FAKE_INSTANCE_ID, after } });
    const res   = makeRes();
    await handler(req, res);
    expect(mockListMessageTemplates).toHaveBeenCalledOnce();
    const [, , options] = mockListMessageTemplates.mock.calls[0];
    expect(options.after).toBe(after);
  });

  it('sem after → options.after é undefined (não passa)', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    const [, , options] = mockListMessageTemplates.mock.calls[0];
    expect(options.after).toBeUndefined();
  });
});

// =============================================================================
// TPL-17  after inválido/grande → 400
// =============================================================================

describe('TPL-17 after inválido', () => {
  it('after vazio → 400', async () => {
    const req = makeReq({ query: { company_id: FAKE_COMPANY_ID, instance_id: FAKE_INSTANCE_ID, after: '' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
  });

  it('after somente espaços → 400', async () => {
    const req = makeReq({ query: { company_id: FAKE_COMPANY_ID, instance_id: FAKE_INSTANCE_ID, after: '   ' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
  });

  it('after com mais de 1024 chars → 400', async () => {
    const bigCursor = 'x'.repeat(1025);
    const req = makeReq({ query: { company_id: FAKE_COMPANY_ID, instance_id: FAKE_INSTANCE_ID, after: bigCursor } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
  });

  it('after com exatamente 1024 chars → aceito', async () => {
    const maxCursor = 'a'.repeat(1024);
    const req = makeReq({ query: { company_id: FAKE_COMPANY_ID, instance_id: FAKE_INSTANCE_ID, after: maxCursor } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });
});

// =============================================================================
// TPL-18  somente auth.companyId nos lookups de DB
// =============================================================================

describe('TPL-18 somente auth.companyId nos lookups', () => {
  it('lookups usam auth.companyId, não query company_id', async () => {
    // auth.companyId diferente de company_id da query — garante que usamos o do auth
    const authCompanyId = 'dddd0000-0000-0000-0000-000000000099';
    mockValidateMetaCaller.mockResolvedValue(makeAuthOk(authCompanyId));

    const mocks = setupDbMocks();
    const req   = makeReq();
    const res   = makeRes();
    await handler(req, res);

    // instance lookup deve usar authCompanyId, não FAKE_COMPANY_ID do query
    expect(mocks.eqInst2).toHaveBeenCalledWith('company_id', authCompanyId);
    expect(mocks.eqInst2).not.toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
  });
});

// =============================================================================
// TPL-19  Graph recebe waba_id somente do banco
// =============================================================================

describe('TPL-19 waba_id do banco para Graph', () => {
  it('waba_id vem de instance.waba_id, nunca do caller', async () => {
    const req = makeReq({ query: {
      company_id:  FAKE_COMPANY_ID,
      instance_id: FAKE_INSTANCE_ID,
      waba_id:     'HACKER_WABA_ID_XYZ',  // não deve ser usado
    }});
    const res = makeRes();
    await handler(req, res);

    expect(mockListMessageTemplates).toHaveBeenCalledOnce();
    const [, wabaId] = mockListMessageTemplates.mock.calls[0];
    expect(wabaId).toBe(FAKE_WABA_ID);
    expect(wabaId).not.toBe('HACKER_WABA_ID_XYZ');
  });
});

// =============================================================================
// TPL-20  Graph recebe token decriptado somente backend
// =============================================================================

describe('TPL-20 token decriptado no backend', () => {
  it('listMessageTemplates recebe token decriptado (não ciphertext)', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(mockListMessageTemplates).toHaveBeenCalledOnce();
    const [token] = mockListMessageTemplates.mock.calls[0];
    expect(token).toBe(FAKE_TOKEN_PLAIN);
    expect(token).not.toBe(FAKE_TOKEN_ENC);
  });

  it('token não aparece na resposta 200', async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const body = JSON.stringify(res._body);
    expect(body).not.toContain(FAKE_TOKEN_PLAIN);
    expect(body).not.toContain(FAKE_TOKEN_ENC);
  });
});

// =============================================================================
// TPL-21  status APPROVED hardcoded
// =============================================================================

describe('TPL-21 status APPROVED hardcoded', () => {
  it('listMessageTemplates sempre chamado com status=APPROVED', async () => {
    // Mesmo que caller tente passar status diferente via query
    const req = makeReq({ query: {
      company_id:  FAKE_COMPANY_ID,
      instance_id: FAKE_INSTANCE_ID,
      status:      'REJECTED',  // não deve ser usado
    }});
    const res = makeRes();
    await handler(req, res);

    const [, , options] = mockListMessageTemplates.mock.calls[0];
    expect(options.status).toBe('APPROVED');
  });
});

// =============================================================================
// TPL-22  limit 100 hardcoded
// =============================================================================

describe('TPL-22 limit 100 hardcoded', () => {
  it('listMessageTemplates sempre chamado com limit=100', async () => {
    const req = makeReq({ query: {
      company_id:  FAKE_COMPANY_ID,
      instance_id: FAKE_INSTANCE_ID,
      limit:       '5',  // não deve ser honrado
    }});
    const res = makeRes();
    await handler(req, res);

    const [, , options] = mockListMessageTemplates.mock.calls[0];
    expect(options.limit).toBe(100);
  });
});

// =============================================================================
// TPL-23  DTO não contém token/waba/phone_number_id
// =============================================================================

describe('TPL-23 DTO não vaza dados sensíveis', () => {
  it('resposta não contém access_token, waba_id nem phone_number_id', async () => {
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_SIMPLE]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const body = JSON.stringify(res._body);
    expect(body).not.toContain(FAKE_TOKEN_PLAIN);
    expect(body).not.toContain(FAKE_TOKEN_ENC);
    expect(body).not.toContain(FAKE_WABA_ID);
    // phone_number_id não é nem selecionado no lookup de instância
  });
});

// =============================================================================
// TPL-24  POSITIONAL body params
// =============================================================================

describe('TPL-24 POSITIONAL body params', () => {
  it('extrai parâmetros POSITIONAL do BODY corretamente', async () => {
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_SIMPLE]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const tpl = res._body.templates[0];
    const bodyParam = tpl.parameters.find(p => p.component === 'BODY' && p.key === '1');
    expect(bodyParam).toBeDefined();
    expect(bodyParam.position).toBe(1);
    expect(bodyParam.example).toBe('João');
  });

  it('múltiplos parâmetros POSITIONAL BODY numerados corretamente', async () => {
    const multiParam = {
      ...FAKE_TEMPLATE_SIMPLE,
      id: 'multi-001',
      components: [{
        type: 'BODY',
        text: '{{1}} e {{2}} e {{3}}',
        example: { body_text: [['Alpha', 'Beta', 'Gamma']] },
      }],
    };
    mockListMessageTemplates.mockResolvedValue(makeListResult([multiParam]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const params = res._body.templates[0].parameters;
    expect(params).toHaveLength(3);
    expect(params[0]).toMatchObject({ key: '1', position: 1, example: 'Alpha' });
    expect(params[1]).toMatchObject({ key: '2', position: 2, example: 'Beta' });
    expect(params[2]).toMatchObject({ key: '3', position: 3, example: 'Gamma' });
  });
});

// =============================================================================
// TPL-25  POSITIONAL header param
// =============================================================================

describe('TPL-25 POSITIONAL header param', () => {
  it('extrai parâmetro POSITIONAL do HEADER TEXT', async () => {
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_WITH_HEADER]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const tpl        = res._body.templates[0];
    const headerParam = tpl.parameters.find(p => p.component === 'HEADER');
    expect(headerParam).toBeDefined();
    expect(headerParam.key).toBe('1');
    expect(headerParam.position).toBe(1);
    expect(headerParam.example).toBe('LovooCRM');
  });
});

// =============================================================================
// TPL-26  NAMED body params
// =============================================================================

describe('TPL-26 NAMED body params', () => {
  it('extrai parâmetros NAMED do BODY com key = param_name', async () => {
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_NAMED]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const params = res._body.templates[0].parameters.filter(p => p.component === 'BODY');
    expect(params).toHaveLength(2);
    expect(params[0]).toMatchObject({ key: 'first_name', position: null, example: 'Ana' });
    expect(params[1]).toMatchObject({ key: 'order_id',   position: null, example: 'ORD-9999' });
  });
});

// =============================================================================
// TPL-27  NAMED header param
// =============================================================================

describe('TPL-27 NAMED header param', () => {
  it('extrai parâmetro NAMED do HEADER TEXT', async () => {
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_NAMED]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const params = res._body.templates[0].parameters.filter(p => p.component === 'HEADER');
    expect(params).toHaveLength(1);
    expect(params[0]).toMatchObject({ key: 'company_name', position: null, example: 'LovooCRM' });
  });
});

// =============================================================================
// TPL-28  parameter_format ausente → assume POSITIONAL
// =============================================================================

describe('TPL-28 parameter_format ausente → POSITIONAL', () => {
  it('template sem parameter_format → parameter_format=POSITIONAL no DTO', async () => {
    const tplNoFmt = {
      ...FAKE_TEMPLATE_SIMPLE,
      id: 'tpl-nofmt',
      parameter_format: undefined,
    };
    delete tplNoFmt.parameter_format;
    mockListMessageTemplates.mockResolvedValue(makeListResult([tplNoFmt]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const tpl = res._body.templates[0];
    expect(tpl.parameter_format).toBe('POSITIONAL');
  });
});

// =============================================================================
// TPL-29  BODY TEXT → supported=true
// =============================================================================

describe('TPL-29 BODY TEXT supported', () => {
  it('template com somente BODY TEXT → supported=true', async () => {
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_SIMPLE]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._body.templates[0].supported).toBe(true);
    expect(res._body.templates[0].unsupported_reason).toBeNull();
  });
});

// =============================================================================
// TPL-30  HEADER TEXT → supported=true
// =============================================================================

describe('TPL-30 HEADER TEXT supported', () => {
  it('template com HEADER TEXT + BODY → supported=true', async () => {
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_WITH_HEADER]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._body.templates[0].supported).toBe(true);
  });
});

// =============================================================================
// TPL-31  FOOTER → supported=true
// =============================================================================

describe('TPL-31 FOOTER supported', () => {
  it('template com BODY + FOOTER → supported=true', async () => {
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_WITH_HEADER]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    // FAKE_TEMPLATE_WITH_HEADER tem HEADER TEXT, BODY, FOOTER
    expect(res._body.templates[0].supported).toBe(true);
  });
});

// =============================================================================
// TPL-32  HEADER IMAGE → supported=false
// =============================================================================

describe('TPL-32 HEADER IMAGE unsupported', () => {
  it('HEADER format=IMAGE → supported=false', async () => {
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_IMAGE_HEADER]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    const tpl = res._body.templates[0];
    expect(tpl.supported).toBe(false);
    expect(tpl.unsupported_reason).toContain('IMAGE');
  });
});

// =============================================================================
// TPL-33  HEADER VIDEO → supported=false
// =============================================================================

describe('TPL-33 HEADER VIDEO unsupported', () => {
  it('HEADER format=VIDEO → supported=false', async () => {
    const tpl = {
      ...FAKE_TEMPLATE_SIMPLE,
      id: 'tpl-vid',
      components: [
        { type: 'HEADER', format: 'VIDEO', example: {} },
        { type: 'BODY', text: 'Vídeo aqui.', example: { body_text: [[]] } },
      ],
    };
    mockListMessageTemplates.mockResolvedValue(makeListResult([tpl]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._body.templates[0].supported).toBe(false);
    expect(res._body.templates[0].unsupported_reason).toContain('VIDEO');
  });
});

// =============================================================================
// TPL-34  HEADER DOCUMENT → supported=false
// =============================================================================

describe('TPL-34 HEADER DOCUMENT unsupported', () => {
  it('HEADER format=DOCUMENT → supported=false', async () => {
    const tpl = {
      ...FAKE_TEMPLATE_SIMPLE,
      id: 'tpl-doc',
      components: [
        { type: 'HEADER', format: 'DOCUMENT', example: {} },
        { type: 'BODY', text: 'Documento aqui.', example: { body_text: [[]] } },
      ],
    };
    mockListMessageTemplates.mockResolvedValue(makeListResult([tpl]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._body.templates[0].supported).toBe(false);
    expect(res._body.templates[0].unsupported_reason).toContain('DOCUMENT');
  });
});

// =============================================================================
// TPL-35  BUTTONS → supported=false
// =============================================================================

describe('TPL-35 BUTTONS unsupported', () => {
  it('componente BUTTONS → supported=false', async () => {
    const tpl = {
      ...FAKE_TEMPLATE_SIMPLE,
      id: 'tpl-btn',
      components: [
        { type: 'BODY', text: 'Clique!', example: { body_text: [[]] } },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Sim' }] },
      ],
    };
    mockListMessageTemplates.mockResolvedValue(makeListResult([tpl]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._body.templates[0].supported).toBe(false);
    expect(res._body.templates[0].unsupported_reason).toContain('BUTTONS');
  });
});

// =============================================================================
// TPL-36  CAROUSEL → supported=false
// =============================================================================

describe('TPL-36 CAROUSEL unsupported', () => {
  it('componente CAROUSEL → supported=false', async () => {
    const tpl = {
      ...FAKE_TEMPLATE_SIMPLE,
      id: 'tpl-carousel',
      components: [
        { type: 'BODY', text: 'Veja!', example: { body_text: [[]] } },
        { type: 'CAROUSEL', cards: [] },
      ],
    };
    mockListMessageTemplates.mockResolvedValue(makeListResult([tpl]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._body.templates[0].supported).toBe(false);
    expect(res._body.templates[0].unsupported_reason).toContain('CAROUSEL');
  });
});

// =============================================================================
// TPL-37  AUTHENTICATION → supported=false
// =============================================================================

describe('TPL-37 AUTHENTICATION unsupported', () => {
  it('category=AUTHENTICATION → supported=false com razão', async () => {
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_AUTH]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    const tpl = res._body.templates[0];
    expect(tpl).not.toBeNull();
    expect(tpl.supported).toBe(false);
    expect(tpl.unsupported_reason).toContain('AUTHENTICATION');
  });
});

// =============================================================================
// TPL-38  unknown parameter_format → supported=false
// =============================================================================

describe('TPL-38 unknown parameter_format unsupported', () => {
  it('parameter_format desconhecido → supported=false', async () => {
    const tpl = {
      ...FAKE_TEMPLATE_SIMPLE,
      id: 'tpl-unk-fmt',
      parameter_format: 'TEMPLATE_V2_CUSTOM',
    };
    mockListMessageTemplates.mockResolvedValue(makeListResult([tpl]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    const result = res._body.templates[0];
    expect(result.supported).toBe(false);
    expect(result.unsupported_reason).toContain('parameter_format');
  });
});

// =============================================================================
// TPL-39  components inválidos (não-array) → unsupported
// =============================================================================

describe('TPL-39 components inválidos', () => {
  it('components não-array → supported=false', async () => {
    const tpl = {
      ...FAKE_TEMPLATE_SIMPLE,
      id: 'tpl-badcomp',
      components: 'INVALID_STRING',
    };
    mockListMessageTemplates.mockResolvedValue(makeListResult([tpl]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    const result = res._body.templates[0];
    expect(result.supported).toBe(false);
  });
});

// =============================================================================
// TPL-40  template malformed não vira supported
// =============================================================================

describe('TPL-40 template malformed não vira supported', () => {
  it('template sem id → excluído do DTO (null)', async () => {
    const malformed = { name: 'broken', language: 'pt_BR', status: 'APPROVED', category: 'MARKETING' };
    mockListMessageTemplates.mockResolvedValue(makeListResult([malformed, FAKE_TEMPLATE_SIMPLE]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    // Malformed excluído; somente FAKE_TEMPLATE_SIMPLE retornado
    expect(res._body.templates).toHaveLength(1);
    expect(res._body.templates[0].id).toBe('tpl-001');
  });

  it('template com status=REJECTED → excluído do DTO', async () => {
    const rejected = { ...FAKE_TEMPLATE_SIMPLE, id: 'rejected-001', status: 'REJECTED' };
    mockListMessageTemplates.mockResolvedValue(makeListResult([rejected, FAKE_TEMPLATE_SIMPLE]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    const ids = res._body.templates.map(t => t.id);
    expect(ids).not.toContain('rejected-001');
    expect(ids).toContain('tpl-001');
  });

  it('template sem name → excluído do DTO', async () => {
    const noName = { id: 'no-name', language: 'pt_BR', status: 'APPROVED', category: 'MARKETING' };
    mockListMessageTemplates.mockResolvedValue(makeListResult([noName]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._body.templates).toHaveLength(0);
  });
});

// =============================================================================
// TPL-41  N+1: uma única chamada Graph por request
// =============================================================================

describe('TPL-41 sem N+1', () => {
  it('múltiplos templates → somente uma chamada Graph', async () => {
    const many = [
      FAKE_TEMPLATE_SIMPLE,
      FAKE_TEMPLATE_WITH_HEADER,
      FAKE_TEMPLATE_NAMED,
    ];
    mockListMessageTemplates.mockResolvedValue(makeListResult(many));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(mockListMessageTemplates).toHaveBeenCalledOnce();
    expect(res._body.templates).toHaveLength(3);
  });
});

// =============================================================================
// TPL-42  nenhuma query de banco usa tenant externo
// =============================================================================

describe('TPL-42 banco usa somente auth.companyId', () => {
  it('from.meta_whatsapp_instances filtrado por auth.companyId', async () => {
    const authCompanyId = 'eeee0000-0000-0000-0000-000000000088';
    mockValidateMetaCaller.mockResolvedValue(makeAuthOk(authCompanyId));
    const mocks = setupDbMocks();
    const req   = makeReq({ query: { company_id: FAKE_COMPANY_ID, instance_id: FAKE_INSTANCE_ID } });
    const res   = makeRes();
    await handler(req, res);

    // Verificar que o eq de company_id usou authCompanyId
    const companyIdCall = mocks.eqInst2.mock.calls.find(([field, val]) => field === 'company_id');
    expect(companyIdCall).toBeDefined();
    expect(companyIdCall[1]).toBe(authCompanyId);
    expect(companyIdCall[1]).not.toBe(FAKE_COMPANY_ID);
  });
});

// =============================================================================
// TPL-43  cursor nunca tratado como URL
// =============================================================================

describe('TPL-43 cursor não é URL', () => {
  it('after com URL injetada é passado como string opaca (não como URL de fetch)', async () => {
    // O graphClient reconstruirá URL internamente — o handler não faz fetch do cursor
    const urlCursor = 'https://evil.example.com/steal?data=secret';
    const req = makeReq({ query: {
      company_id:  FAKE_COMPANY_ID,
      instance_id: FAKE_INSTANCE_ID,
      after:       urlCursor,
    }});
    const res = makeRes();
    await handler(req, res);

    // Handler não falha (cursor tem tamanho válido)
    // graphClient recebe cursor como parâmetro — não como URL de fetch
    const [, , options] = mockListMessageTemplates.mock.calls[0];
    expect(options.after).toBe(urlCursor);
    // Não houve fetch do cursor como URL (graphClient está mockado)
    expect(res._status).toBe(200);
  });
});

// =============================================================================
// TPL-44  Graph raw error não vaza na resposta
// =============================================================================

describe('TPL-44 Graph raw error não vaza', () => {
  it('erro Graph com dados sensíveis → resposta não revela detalhes', async () => {
    const graphErr = new Error('{"error":{"code":190,"message":"Invalid OAuth access token","fbtrace_id":"ABC123"}}');
    graphErr.code = 'graph_templates_failed';
    mockListMessageTemplates.mockRejectedValue(graphErr);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const body = JSON.stringify(res._body);
    expect(body).not.toContain('OAuth');
    expect(body).not.toContain('fbtrace_id');
    expect(body).not.toContain('190');
    expect(body).not.toContain('ABC123');
    expect(res._status).toBe(502);
    expect(res._body.error).toBe('provider_error');
  });
});

// =============================================================================
// TPL-45  examples sensíveis não aparecem em logs de erro
// =============================================================================

describe('TPL-45 examples sensíveis não em logs', () => {
  it('sanitizeTemplate não lança mesmo com examples ausentes', async () => {
    // Se example está ausente, extração retorna [] sem lançar
    const noExample = {
      id:       'no-ex-001',
      name:     'simple_no_example',
      language: 'pt_BR',
      status:   'APPROVED',
      category: 'UTILITY',
      parameter_format: 'POSITIONAL',
      components: [
        { type: 'BODY', text: 'Olá!' },
        // sem example — parâmetros devem ser []
      ],
    };
    mockListMessageTemplates.mockResolvedValue(makeListResult([noExample]));
    const req = makeReq();
    const res = makeRes();

    // Não deve lançar (fail-closed por template)
    await expect(handler(req, res)).resolves.not.toThrow();
    expect(res._status).toBe(200);
    const tpl = res._body.templates[0];
    expect(tpl.parameters).toEqual([]);
  });

  it('console.error não é chamado em fluxo normal', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// =============================================================================
// FIX F-02 — BODY obrigatório: components: [] → supported=false
// =============================================================================

describe('FIX F-02 empty components → supported=false', () => {
  it('components: [] (array vazio) → supported=false', async () => {
    const tplEmptyComps = {
      id:               'tpl-empty-comps',
      name:             'empty_components',
      language:         'pt_BR',
      status:           'APPROVED',
      category:         'MARKETING',
      parameter_format: 'POSITIONAL',
      components:       [],   // sem BODY → não enviável
    };
    mockListMessageTemplates.mockResolvedValue(makeListResult([tplEmptyComps]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.templates).toHaveLength(1);
    const tpl = res._body.templates[0];
    expect(tpl.supported).toBe(false);
    expect(typeof tpl.unsupported_reason).toBe('string');
    expect(tpl.unsupported_reason.length).toBeGreaterThan(0);
  });

  it('components ausente (undefined) → tratado como [] → supported=false', async () => {
    const tplNoComps = {
      id:               'tpl-no-comps',
      name:             'no_components',
      language:         'pt_BR',
      status:           'APPROVED',
      category:         'UTILITY',
      parameter_format: 'POSITIONAL',
      // components: ausente — não enviável
    };
    mockListMessageTemplates.mockResolvedValue(makeListResult([tplNoComps]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.templates).toHaveLength(1);
    expect(res._body.templates[0].supported).toBe(false);
  });

  it('template com BODY presente continua supported=true (regressão F-02)', async () => {
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_SIMPLE]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._body.templates[0].supported).toBe(true);
  });
});

// =============================================================================
// FIX F-01 — strip de component.example: não expor example raw no DTO
// =============================================================================

describe('FIX F-01 component.example não exposto no DTO', () => {
  it('BODY com example POSITIONAL: components[*] não possui chave example', async () => {
    // FAKE_TEMPLATE_SIMPLE tem BODY com example.body_text
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_SIMPLE]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const tpl = res._body.templates[0];
    expect(tpl.components).toHaveLength(1);
    tpl.components.forEach(comp => {
      expect(comp).not.toHaveProperty('example');
    });
  });

  it('HEADER TEXT + BODY + FOOTER: nenhum componente expõe example', async () => {
    // FAKE_TEMPLATE_WITH_HEADER tem HEADER com example.header_text e BODY com example.body_text
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_WITH_HEADER]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const tpl = res._body.templates[0];
    expect(tpl.components.length).toBeGreaterThan(0);
    tpl.components.forEach(comp => {
      expect(comp).not.toHaveProperty('example');
    });
  });

  it('HEADER IMAGE (unsupported): components[*] também não possui example; header_handle não aparece', async () => {
    // FAKE_TEMPLATE_IMAGE_HEADER tem HEADER com example.header_handle (internal FB URL)
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_IMAGE_HEADER]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const tpl = res._body.templates[0];
    expect(tpl.supported).toBe(false);  // continua unsupported
    tpl.components.forEach(comp => {
      expect(comp).not.toHaveProperty('example');
    });
    // header_handle (referência interna Meta CDN) não deve aparecer em lugar nenhum da resposta
    const bodyStr = JSON.stringify(res._body);
    expect(bodyStr).not.toContain('header_handle');
  });

  it('parameters[].example continua disponível — não afetado pelo strip', async () => {
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_SIMPLE]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const tpl = res._body.templates[0];
    // components sem example
    expect(tpl.components[0]).not.toHaveProperty('example');
    // parameters preserva o example normalizado para o picker
    const bodyParam = tpl.parameters.find(p => p.component === 'BODY');
    expect(bodyParam).toBeDefined();
    expect(bodyParam.example).toBe('João');
  });

  it('NAMED template: components sem example; parameters com exemplos normalizados', async () => {
    mockListMessageTemplates.mockResolvedValue(makeListResult([FAKE_TEMPLATE_NAMED]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const tpl = res._body.templates[0];
    // Strip em components
    tpl.components.forEach(comp => {
      expect(comp).not.toHaveProperty('example');
    });
    // parameters preservados com exemplos
    const headerParam = tpl.parameters.find(p => p.component === 'HEADER');
    expect(headerParam?.example).toBe('LovooCRM');
    const firstBodyParam = tpl.parameters.find(p => p.component === 'BODY' && p.key === 'first_name');
    expect(firstBodyParam?.example).toBe('Ana');
  });

  it('objeto Graph original não é mutado — spread cria novo objeto', async () => {
    const original = {
      id:               'tpl-mutation-check',
      name:             'mutation_test',
      language:         'pt_BR',
      status:           'APPROVED',
      category:         'UTILITY',
      parameter_format: 'POSITIONAL',
      components: [
        {
          type:    'BODY',
          text:    'Olá {{1}}!',
          example: { body_text: [['TestValue']] },
        },
      ],
    };
    // Guardar referência ao example original antes de processar
    const originalExample = original.components[0].example;

    mockListMessageTemplates.mockResolvedValue(makeListResult([original]));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    // DTO não tem example
    expect(res._body.templates[0].components[0]).not.toHaveProperty('example');
    // Objeto original permanece intacto
    expect(original.components[0].example).toBe(originalExample);
    expect(original.components[0].example.body_text).toEqual([['TestValue']]);
  });
});

// =============================================================================
// Testes adicionais de integração de classificação
// =============================================================================

describe('Classificação supported — conjunto misto', () => {
  it('lista mista: suportados e não suportados retornam juntos com flag correta', async () => {
    const mixed = [
      FAKE_TEMPLATE_SIMPLE,       // supported
      FAKE_TEMPLATE_AUTH,         // unsupported (AUTHENTICATION)
      FAKE_TEMPLATE_IMAGE_HEADER, // unsupported (HEADER IMAGE)
      FAKE_TEMPLATE_WITH_HEADER,  // supported
    ];
    mockListMessageTemplates.mockResolvedValue(makeListResult(mixed));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    const results = res._body.templates;
    expect(results).toHaveLength(4);

    const supported   = results.filter(t => t.supported);
    const unsupported = results.filter(t => !t.supported);
    expect(supported).toHaveLength(2);
    expect(unsupported).toHaveLength(2);

    unsupported.forEach(t => {
      expect(typeof t.unsupported_reason).toBe('string');
      expect(t.unsupported_reason.length).toBeGreaterThan(0);
    });
  });
});

describe('Segurança adicional', () => {
  it('credential lookup NÃO ocorre antes de instance válida', async () => {
    setupDbMocks(null); // instance não encontrada
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
    // credentials NÃO devem ter sido consultadas
    const credCalls = mockSvc.from.mock.calls.filter(([t]) => t === 'meta_whatsapp_credentials');
    expect(credCalls).toHaveLength(0);
  });

  it('credential lookup NÃO ocorre antes de instance connected', async () => {
    setupDbMocks(makeInstance({ status: 'disconnected' }));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(409);
    const credCalls = mockSvc.from.mock.calls.filter(([t]) => t === 'meta_whatsapp_credentials');
    expect(credCalls).toHaveLength(0);
  });

  it('Graph NÃO é chamado em falha de auth', async () => {
    mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 401, error: 'Autenticação necessária' });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(mockListMessageTemplates).not.toHaveBeenCalled();
  });

  it('Graph NÃO é chamado em falha de decrypt', async () => {
    mockDecryptMetaToken.mockImplementation(() => { throw new Error('bad'); });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(mockListMessageTemplates).not.toHaveBeenCalled();
  });
});
