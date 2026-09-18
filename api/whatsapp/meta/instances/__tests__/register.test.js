// =============================================================================
// register.test.js
//
// Testes unitários para api/whatsapp/meta/instances/register.js
// Todos os testes usam mocks — sem banco, rede, Graph, decrypt ou token real.
// Nenhum teste executa registerPhoneNumber real, chaama Meta ou envia mensagem.
//
// COBERTURA:
//   HTTP    RG-02..RG-03   method guard
//   AUTH    RG-04          sem JWT / JWT inválido
//   RBAC    RG-06..RG-11   matrix de roles
//   FLAG    RG-05          feature flag
//   BODY    RG-12..RG-14   validação de body
//   TENANT  RG-15..RG-17   isolamento de tenant
//   CRED    RG-18..RG-19   credential lookup e decrypt
//   GUARD   RG-20          já registrado → 409
//   SEC     RG-21..RG-23   campos proibidos no body não influenciam Graph
//   GRAPH   RG-24..RG-28   erros do Graph mapeados corretamente
//   SUCCESS RG-01,RG-29    sucesso completo + persistência
//   PARTIAL RG-30..RG-38   segurança de PIN, token, partial failure, corrida
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks (antes dos imports do handler)
// =============================================================================

const mockSvc = { from: vi.fn() };

vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

const mockValidateMetaCaller = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  META_CONNECT_ROLES: ['super_admin', 'system_admin', 'partner', 'admin'],
  META_VIEW_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  META_SEND_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
}));

const mockDecryptMetaToken = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/tokenCrypto.js', () => ({
  decryptMetaToken: (...args) => mockDecryptMetaToken(...args),
}));

const mockGeneratePin       = vi.fn();
const mockEncryptPin        = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/pinCrypto.js', () => ({
  generateMetaRegistrationPin: (...args) => mockGeneratePin(...args),
  encryptMetaRegistrationPin:  (...args) => mockEncryptPin(...args),
}));

const mockRegisterPhoneNumber = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/graphClient.js', () => ({
  registerPhoneNumber: (...args) => mockRegisterPhoneNumber(...args),
}));

import handler from '../register.js';

// =============================================================================
// Fixtures — todos fictícios, nunca reais
// =============================================================================

const FAKE_COMPANY_ID  = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_USER_ID     = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_INSTANCE_ID = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_PHONE_ID    = '106540352242922';  // phone_number_id do banco (fictício)
const FAKE_ENC_TOKEN   = 'v1:FAKE_ENCRYPTED_TOKEN_NOT_REAL';
const FAKE_PLAIN_TOKEN = 'EAAAN_fake_plain_token_not_real';
const FAKE_PIN         = '042731';
const FAKE_PIN_ENC     = 'v1:FAKE_ENCRYPTED_PIN_NOT_REAL';

const FAKE_INSTANCE = {
  id:             FAKE_INSTANCE_ID,
  phone_number_id: FAKE_PHONE_ID,
};

const FAKE_CRED_UNREGISTERED = {
  access_token_enc:    FAKE_ENC_TOKEN,
  registration_pin_enc: null,
};

const FAKE_CRED_ALREADY_REGISTERED = {
  access_token_enc:    FAKE_ENC_TOKEN,
  registration_pin_enc: FAKE_PIN_ENC,
};

const HAPPY_BODY = {
  company_id:  FAKE_COMPANY_ID,
  instance_id: FAKE_INSTANCE_ID,
};

// =============================================================================
// Chain factories
// =============================================================================

/** Chain para SELECT: select().eq()...maybeSingle() */
function makeSelectChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    is:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

/** Chain para UPDATE: update().eq().is().select() */
function makeUpdateChain(rows, error = null) {
  return {
    update: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue({ data: rows, error }),
  };
}

// =============================================================================
// Request / Response helpers
// =============================================================================

function makeReq({ body = HAPPY_BODY, method = 'POST', headers = {} } = {}) {
  return {
    method,
    headers: { authorization: 'Bearer fake-jwt-fixture', ...headers },
    body,
  };
}

function makeRes() {
  return {
    _status: null, _body: null, _headers: {},
    status(code) { this._status = code; return this; },
    json(body)   { this._body   = body; return this; },
    setHeader(k, v) { this._headers[k] = v; return this; },
  };
}

// =============================================================================
// Setup helpers
// =============================================================================

function setupGuardOk(role = 'admin') {
  mockValidateMetaCaller.mockResolvedValue({
    ok: true, userId: FAKE_USER_ID, companyId: FAKE_COMPANY_ID, role, accessPath: 'direct',
  });
}

function setupGuardFail(status, error) {
  mockValidateMetaCaller.mockResolvedValue({ ok: false, status, error });
}

/** Happy path completo */
function setupHappyPath() {
  setupGuardOk();
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))            // instances
    .mockReturnValueOnce(makeSelectChain(FAKE_CRED_UNREGISTERED))   // credentials select
    .mockReturnValueOnce(makeUpdateChain([{ instance_id: FAKE_INSTANCE_ID }])); // update
  mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
  mockGeneratePin.mockReturnValue(FAKE_PIN);
  mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
  mockRegisterPhoneNumber.mockResolvedValue({ ok: true });
}

function makeGraphError(code, extras = {}) {
  const err = new Error(`Meta: ${code}`);
  err.code = code;
  Object.assign(err, extras);
  return err;
}

// =============================================================================
// Setup
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// RG-01 — Sucesso completo
// =============================================================================

describe('RG-01: POST válido + Graph success + DB persistence → 200', () => {
  it('retorna { ok: true }', async () => {
    setupHappyPath();
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true });
  });
});

// =============================================================================
// RG-02..03 — Method guard
// =============================================================================

describe('Method guard', () => {
  it('RG-02: GET → 405 + Allow: POST', async () => {
    const req = makeReq({ method: 'GET' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
    expect(res._headers['Allow']).toBe('POST');
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
  });

  it('RG-03: PATCH → 405', async () => {
    const req = makeReq({ method: 'PATCH' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
  });
});

// =============================================================================
// RG-04 — Auth
// =============================================================================

describe('RG-04: sem JWT / JWT inválido → auth failure', () => {
  it('sem Authorization → 401', async () => {
    setupGuardFail(401, 'Autenticação necessária');
    const req = makeReq({ headers: { authorization: undefined } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(401);
  });

  it('JWT inválido → 401', async () => {
    setupGuardFail(401, 'Sessão inválida ou expirada');
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(401);
  });
});

// =============================================================================
// RG-05 — Feature flag
// =============================================================================

it('RG-05: feature flag disabled → 403', async () => {
  setupGuardFail(403, 'Meta WhatsApp não habilitado para esta empresa');
  const req = makeReq();
  const res = makeRes();
  await handler(req, res);
  expect(res._status).toBe(403);
});

// =============================================================================
// RG-06..11 — RBAC
// =============================================================================

describe('RBAC', () => {
  it('RG-06: seller → 403', async () => {
    setupGuardFail(403, 'Permissão insuficiente para esta operação');
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(403);
  });

  it('RG-07: manager → 403', async () => {
    setupGuardFail(403, 'Permissão insuficiente para esta operação');
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(403);
  });

  it('RG-08: admin → permitido (chega ao instance lookup)', async () => {
    setupGuardOk('admin');
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null)); // instance not found
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    // 404 significa que passou da auth
    expect(res._status).toBe(404);
  });

  it('RG-09: super_admin → permitido', async () => {
    setupGuardOk('super_admin');
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
  });

  it('RG-10: system_admin → permitido', async () => {
    setupGuardOk('system_admin');
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
  });

  it('RG-11: partner → permitido quando guard aprova (assignment validado internamente)', async () => {
    setupGuardOk('partner');
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
  });
});

// =============================================================================
// RG-12..14 — Body validation
// =============================================================================

describe('Body validation', () => {
  it('RG-12: company_id UUID inválido → contrato do validateMetaCaller (400/401)', async () => {
    setupGuardFail(400, 'company_id inválido');
    const req = makeReq({ body: { company_id: 'not-a-uuid', instance_id: FAKE_INSTANCE_ID } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
  });

  it('RG-13: instance_id ausente → 400', async () => {
    setupGuardOk();
    const req = makeReq({ body: { company_id: FAKE_COMPANY_ID } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
  });

  it('RG-14: instance_id inválido → 400', async () => {
    setupGuardOk();
    const req = makeReq({ body: { company_id: FAKE_COMPANY_ID, instance_id: 'not-a-uuid' } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
  });
});

// =============================================================================
// RG-15..17 — Isolamento de tenant
// =============================================================================

describe('Tenant isolation', () => {
  beforeEach(() => setupGuardOk());

  it('RG-15: cross-tenant → 404 instance_not_found', async () => {
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null)); // query retorna null
    const req = makeReq({ body: { company_id: FAKE_COMPANY_ID, instance_id: FAKE_INSTANCE_ID } });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('instance_not_found');
  });

  it('RG-16: inexistente → 404 instance_not_found', async () => {
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('instance_not_found');
  });

  it('RG-17: deleted (filtro deleted_at IS NULL) → 404 instance_not_found', async () => {
    // O filtro .is('deleted_at', null) é aplicado na query — instância deletada não retorna
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('instance_not_found');
  });

  it('RG-17b: query de instance usa auth.companyId, não body.company_id', async () => {
    setupGuardOk();
    // Guard retorna companyId diferente do body — o lookup deve usar o do guard
    mockValidateMetaCaller.mockResolvedValue({
      ok: true, userId: FAKE_USER_ID,
      companyId: 'dddd0000-0000-0000-0000-000000000099', // diferente do body
      role: 'admin', accessPath: 'direct',
    });
    const instChain = makeSelectChain(null); // não encontra (companyId diferente)
    mockSvc.from = vi.fn().mockReturnValue(instChain);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    // Verifica que .eq('company_id', ...) foi chamado (implícito pela chain)
    expect(res._status).toBe(404);
    expect(instChain.eq).toHaveBeenCalledWith('company_id', 'dddd0000-0000-0000-0000-000000000099');
  });
});

// =============================================================================
// RG-18..19 — Credential lookup e decrypt
// =============================================================================

describe('Credential lookup and decrypt', () => {
  beforeEach(() => {
    setupGuardOk();
  });

  it('RG-18: credential ausente → 500 credential_unavailable', async () => {
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(null)); // sem credencial
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('credential_unavailable');
  });

  it('RG-19: decrypt token falha → 500 credential_unavailable', async () => {
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(FAKE_CRED_UNREGISTERED));
    mockDecryptMetaToken.mockImplementation(() => { throw new Error('decrypt fail'); });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('credential_unavailable');
  });
});

// =============================================================================
// RG-20 — Já registrado
// =============================================================================

it('RG-20: registration_pin_enc já preenchido → 409 already_registered + ZERO Graph calls', async () => {
  setupGuardOk();
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
    .mockReturnValueOnce(makeSelectChain(FAKE_CRED_ALREADY_REGISTERED));
  const req = makeReq();
  const res = makeRes();
  await handler(req, res);
  expect(res._status).toBe(409);
  expect(res._body.error).toBe('already_registered');
  expect(mockRegisterPhoneNumber).not.toHaveBeenCalled();
});

// =============================================================================
// RG-21..23 — Campos proibidos no body não influenciam Graph
// =============================================================================

describe('Campos proibidos no body não controlam Graph', () => {
  it('RG-21: phone_number_id do body é ignorado; Graph usa o do banco', async () => {
    setupHappyPath();
    const req = makeReq({ body: { ...HAPPY_BODY, phone_number_id: '999999999' } });
    const res = makeRes();
    await handler(req, res);
    // registerPhoneNumber deve ter sido chamado com o phone_number_id do banco
    expect(mockRegisterPhoneNumber).toHaveBeenCalledWith(
      FAKE_PLAIN_TOKEN,
      FAKE_PHONE_ID,   // do banco, não do body
      FAKE_PIN,
    );
  });

  it('RG-22: access_token do body é ignorado; Graph usa o decryptado', async () => {
    setupHappyPath();
    const req = makeReq({ body: { ...HAPPY_BODY, access_token: 'evil-token' } });
    const res = makeRes();
    await handler(req, res);
    expect(mockRegisterPhoneNumber).toHaveBeenCalledWith(
      FAKE_PLAIN_TOKEN,  // token do decrypt, não do body
      FAKE_PHONE_ID,
      FAKE_PIN,
    );
  });

  it('RG-23: pin do body é ignorado; PIN gerado internamente', async () => {
    setupHappyPath();
    const req = makeReq({ body: { ...HAPPY_BODY, pin: '000000' } });
    const res = makeRes();
    await handler(req, res);
    // PIN deve ser o gerado pelo mock (FAKE_PIN), não o do body
    expect(mockRegisterPhoneNumber).toHaveBeenCalledWith(
      FAKE_PLAIN_TOKEN,
      FAKE_PHONE_ID,
      FAKE_PIN,   // gerado internamente
    );
  });
});

// =============================================================================
// RG-24..28 — Graph error mapping
// =============================================================================

describe('Graph error mapping', () => {
  beforeEach(() => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(FAKE_CRED_UNREGISTERED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockGeneratePin.mockReturnValue(FAKE_PIN);
    mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
  });

  it('RG-24: register_failed → 502 registration_failed + zero persist PIN', async () => {
    mockRegisterPhoneNumber.mockRejectedValue(makeGraphError('register_failed'));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(502);
    expect(res._body.error).toBe('registration_failed');
    // UPDATE não deve ter sido chamado (3ª chamada ao from)
    expect(mockSvc.from).toHaveBeenCalledTimes(2);
  });

  it('RG-25: register_invalid_response → 502 registration_failed + zero persist PIN', async () => {
    mockRegisterPhoneNumber.mockRejectedValue(makeGraphError('register_invalid_response'));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(502);
    expect(res._body.error).toBe('registration_failed');
    expect(mockSvc.from).toHaveBeenCalledTimes(2);
  });

  it('RG-26: register_timeout → 503 provider_unavailable', async () => {
    mockRegisterPhoneNumber.mockRejectedValue(makeGraphError('register_timeout'));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(503);
    expect(res._body.error).toBe('provider_unavailable');
  });

  it('RG-27: register_network_error → 503 provider_unavailable', async () => {
    mockRegisterPhoneNumber.mockRejectedValue(makeGraphError('register_network_error'));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(503);
    expect(res._body.error).toBe('provider_unavailable');
  });

  it('RG-28: register_invalid_input → 500 internal_error', async () => {
    mockRegisterPhoneNumber.mockRejectedValue(makeGraphError('register_invalid_input'));
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('internal_error');
  });
});

// =============================================================================
// RG-29..38 — Segurança e casos avançados
// =============================================================================

describe('Segurança e partial failure', () => {
  it('RG-29: Graph success → registration_pin_enc cifrado persistido no UPDATE', async () => {
    setupHappyPath();
    const updateChain = makeUpdateChain([{ instance_id: FAKE_INSTANCE_ID }]);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(FAKE_CRED_UNREGISTERED))
      .mockReturnValueOnce(updateChain);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    // UPDATE deve ter sido chamado com o PIN cifrado
    expect(updateChain.update).toHaveBeenCalledWith({ registration_pin_enc: FAKE_PIN_ENC });
    expect(res._status).toBe(200);
  });

  it('RG-30: PIN plaintext nunca persistido (somente pinEnc vai ao UPDATE)', async () => {
    setupHappyPath();
    const updateChain = makeUpdateChain([{ instance_id: FAKE_INSTANCE_ID }]);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(FAKE_CRED_UNREGISTERED))
      .mockReturnValueOnce(updateChain);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    const updateArg = updateChain.update.mock.calls[0][0];
    // O objeto de UPDATE deve conter registration_pin_enc (cifrado), não o PIN plaintext
    expect(updateArg).not.toHaveProperty('pin');
    expect(JSON.stringify(updateArg)).not.toContain(FAKE_PIN);
    expect(JSON.stringify(updateArg)).toContain('registration_pin_enc');
  });

  it('RG-31: PIN nunca aparece na resposta', async () => {
    setupHappyPath();
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_PIN);
    expect(JSON.stringify(res._body)).not.toContain('pin');
  });

  it('RG-32: token nunca aparece na resposta', async () => {
    setupHappyPath();
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_PLAIN_TOKEN);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_ENC_TOKEN);
  });

  it('RG-33: provider message nunca aparece na resposta (register_failed)', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(FAKE_CRED_UNREGISTERED));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockGeneratePin.mockReturnValue(FAKE_PIN);
    mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
    const errWithMsg = makeGraphError('register_failed');
    errWithMsg.message = 'Sensitive provider info: PIN required for 2FA';
    mockRegisterPhoneNumber.mockRejectedValue(errWithMsg);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(JSON.stringify(res._body)).not.toContain('Sensitive provider info');
    expect(JSON.stringify(res._body)).not.toContain('PIN required');
  });

  it('RG-34: Graph success + DB UPDATE failure → 500 registration_persistence_failed + zero segunda Graph call', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(FAKE_CRED_UNREGISTERED))
      .mockReturnValueOnce(makeUpdateChain(null, new Error('DB connection lost')));
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockGeneratePin.mockReturnValue(FAKE_PIN);
    mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
    mockRegisterPhoneNumber.mockResolvedValue({ ok: true });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('registration_persistence_failed');
    // registerPhoneNumber deve ter sido chamado SOMENTE 1 vez
    expect(mockRegisterPhoneNumber).toHaveBeenCalledTimes(1);
  });

  it('RG-35: UPDATE condicionado a IS NULL — não sobrescreve pin existente', async () => {
    setupGuardOk();
    const updateChain = makeUpdateChain([{ instance_id: FAKE_INSTANCE_ID }]);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(FAKE_CRED_UNREGISTERED))
      .mockReturnValueOnce(updateChain);
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockGeneratePin.mockReturnValue(FAKE_PIN);
    mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
    mockRegisterPhoneNumber.mockResolvedValue({ ok: true });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    // .is() deve ter sido chamado com ('registration_pin_enc', null)
    expect(updateChain.is).toHaveBeenCalledWith('registration_pin_enc', null);
  });

  it('RG-36: corrida detectada após Graph success (UPDATE retorna 0 rows) → 409 already_registered', async () => {
    setupGuardOk();
    // UPDATE retorna array vazio (outra request ganhou a corrida)
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(FAKE_CRED_UNREGISTERED))
      .mockReturnValueOnce(makeUpdateChain([])); // 0 rows atualizadas
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockGeneratePin.mockReturnValue(FAKE_PIN);
    mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
    mockRegisterPhoneNumber.mockResolvedValue({ ok: true });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(409);
    expect(res._body.error).toBe('already_registered');
  });

  it('RG-37: uma request nunca chama registerPhoneNumber mais de uma vez', async () => {
    setupHappyPath();
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(mockRegisterPhoneNumber).toHaveBeenCalledTimes(1);
  });

  it('RG-38: nenhum console.log é chamado durante a request', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setupHappyPath();
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
