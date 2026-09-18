// =============================================================================
// set-pin.test.js
//
// Testes unitários para api/whatsapp/meta/instances/set-pin.js
// Todos os testes usam mocks — sem banco, rede, Graph, decrypt ou token real.
// Nenhum teste executa setTwoStepVerificationPin real nem chama a Meta.
//
// COBERTURA: STP-01 a STP-58
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks
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

const mockDecryptMetaToken  = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/tokenCrypto.js', () => ({
  decryptMetaToken: (...args) => mockDecryptMetaToken(...args),
}));

const mockGeneratePin  = vi.fn();
const mockEncryptPin   = vi.fn();
const mockDecryptPin   = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/pinCrypto.js', () => ({
  generateMetaRegistrationPin: (...args) => mockGeneratePin(...args),
  encryptMetaRegistrationPin:  (...args) => mockEncryptPin(...args),
  decryptMetaRegistrationPin:  (...args) => mockDecryptPin(...args),
}));

const mockSetTwoStepPin = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/graphClient.js', () => ({
  setTwoStepVerificationPin: (...args) => mockSetTwoStepPin(...args),
}));

import handler from '../set-pin.js';

// =============================================================================
// Fixtures — todos fictícios, nunca reais
// =============================================================================

const FAKE_COMPANY_ID  = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_USER_ID     = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_INSTANCE_ID = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_PHONE_ID    = '1065403522429220';  // phone_number_id fictício
const FAKE_ENC_TOKEN   = 'v1:FAKE_ENC_TOKEN_NOT_REAL';
const FAKE_PLAIN_TOKEN = 'EAAAN_fake_plain_token_not_real';
const FAKE_PIN         = '150954';            // PIN plaintext fictício
const FAKE_PIN_ENC     = 'v1:FAKE_ENC_PIN_NOT_REAL';
const FAKE_CONFIRMED   = '2026-09-18T12:00:00.000Z';

const FAKE_INSTANCE = { id: FAKE_INSTANCE_ID, phone_number_id: FAKE_PHONE_ID };

// Estados de credencial
const CRED_A = { access_token_enc: FAKE_ENC_TOKEN, registration_pin_enc: null,        registration_pin_confirmed_at: null };
const CRED_B = { access_token_enc: FAKE_ENC_TOKEN, registration_pin_enc: FAKE_PIN_ENC, registration_pin_confirmed_at: null };
const CRED_C = { access_token_enc: FAKE_ENC_TOKEN, registration_pin_enc: FAKE_PIN_ENC, registration_pin_confirmed_at: FAKE_CONFIRMED };
const CRED_INVALID = { access_token_enc: FAKE_ENC_TOKEN, registration_pin_enc: null, registration_pin_confirmed_at: FAKE_CONFIRMED };

const HAPPY_BODY = { company_id: FAKE_COMPANY_ID, instance_id: FAKE_INSTANCE_ID };

// =============================================================================
// Chain factories
// =============================================================================

/** SELECT chain: select().eq()...maybeSingle() */
function makeSelectChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    is:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

/** UPDATE chain: update().eq()...select() (terminal) */
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
    headers: { authorization: 'Bearer fake-jwt', ...headers },
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

function makeGraphError(code) {
  const e = new Error(`set_pin error: ${code}`);
  e.code = code;
  return e;
}

/**
 * Happy path Estado A (sem concorrência):
 * instances → cred_A → persist(ok) → [token decrypt] → graph → confirm(ok)
 */
function setupStateAHappy() {
  setupGuardOk();
  const persistChain  = makeUpdateChain([{ instance_id: FAKE_INSTANCE_ID }]);
  const confirmChain  = makeUpdateChain([{ instance_id: FAKE_INSTANCE_ID }]);
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
    .mockReturnValueOnce(makeSelectChain(CRED_A))
    .mockReturnValueOnce(persistChain)
    .mockReturnValueOnce(confirmChain);
  mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
  mockGeneratePin.mockReturnValue(FAKE_PIN);
  mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
  mockSetTwoStepPin.mockResolvedValue({ ok: true });
  return { persistChain, confirmChain };
}

/**
 * Happy path Estado B:
 * instances → cred_B → [pin decrypt] → [token decrypt] → graph → confirm(ok)
 */
function setupStateBHappy() {
  setupGuardOk();
  const confirmChain = makeUpdateChain([{ instance_id: FAKE_INSTANCE_ID }]);
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
    .mockReturnValueOnce(makeSelectChain(CRED_B))
    .mockReturnValueOnce(confirmChain);
  mockDecryptPin.mockReturnValue(FAKE_PIN);
  mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
  mockSetTwoStepPin.mockResolvedValue({ ok: true });
  return { confirmChain };
}

// =============================================================================
// Setup
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// STP-01 — Sucesso Estado A
// =============================================================================

it('STP-01: POST Estado A success → 200 { ok: true }', async () => {
  setupStateAHappy();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res._status).toBe(200);
  expect(res._body).toEqual({ ok: true });
});

// =============================================================================
// STP-02..03 — Method guard
// =============================================================================

it('STP-02: GET → 405 + Allow: POST', async () => {
  const res = makeRes();
  await handler(makeReq({ method: 'GET' }), res);
  expect(res._status).toBe(405);
  expect(res._headers['Allow']).toBe('POST');
  expect(mockValidateMetaCaller).not.toHaveBeenCalled();
});

it('STP-03: PATCH → 405', async () => {
  const res = makeRes();
  await handler(makeReq({ method: 'PATCH' }), res);
  expect(res._status).toBe(405);
});

// =============================================================================
// STP-04..05 — Auth / Feature flag
// =============================================================================

it('STP-04: sem JWT → 401', async () => {
  setupGuardFail(401, 'Autenticação necessária');
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res._status).toBe(401);
});

it('STP-05: feature flag false → 403', async () => {
  setupGuardFail(403, 'Meta WhatsApp não habilitado');
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res._status).toBe(403);
});

// =============================================================================
// STP-06..11 — RBAC
// =============================================================================

describe('RBAC', () => {
  it('STP-06: seller → 403', async () => {
    setupGuardFail(403, 'Permissão insuficiente');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
  });

  it('STP-07: manager → 403', async () => {
    setupGuardFail(403, 'Permissão insuficiente');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
  });

  it('STP-08: admin → permitido (chega ao instance lookup)', async () => {
    setupGuardOk('admin');
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
  });

  it('STP-09: super_admin → permitido', async () => {
    setupGuardOk('super_admin');
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
  });

  it('STP-10: system_admin → permitido', async () => {
    setupGuardOk('system_admin');
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
  });

  it('STP-11: partner permitido quando guard aprova', async () => {
    setupGuardOk('partner');
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
  });
});

// =============================================================================
// STP-12..14 — Tenant isolation
// =============================================================================

describe('Tenant isolation', () => {
  beforeEach(() => setupGuardOk());

  it('STP-12: cross-tenant → 404 instance_not_found', async () => {
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('instance_not_found');
  });

  it('STP-13: nonexistent → 404 instance_not_found', async () => {
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('instance_not_found');
  });

  it('STP-14: deleted (deleted_at IS NULL filter) → 404 instance_not_found', async () => {
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
  });
});

// =============================================================================
// STP-15..25 — Estado A
// =============================================================================

describe('Estado A (pin_enc NULL + confirmed_at NULL)', () => {
  it('STP-15: Estado A chama generateMetaRegistrationPin', async () => {
    setupStateAHappy();
    await handler(makeReq(), makeRes());
    expect(mockGeneratePin).toHaveBeenCalledTimes(1);
  });

  it('STP-16: PIN gerado é cifrado antes de persistir', async () => {
    setupStateAHappy();
    await handler(makeReq(), makeRes());
    expect(mockEncryptPin).toHaveBeenCalledWith(FAKE_PIN);
  });

  it('STP-17: PIN cifrado persiste ANTES do Graph', async () => {
    const { persistChain } = setupStateAHappy();
    await handler(makeReq(), makeRes());
    // persist deve ter sido chamado; graph só depois
    const persistCallOrder = persistChain.select.mock.invocationCallOrder[0];
    const graphCallOrder   = mockSetTwoStepPin.mock.invocationCallOrder[0];
    expect(persistCallOrder).toBeLessThan(graphCallOrder);
  });

  it('STP-18: confirmed_at permanece NULL na persist inicial', async () => {
    const { persistChain } = setupStateAHappy();
    await handler(makeReq(), makeRes());
    // persist update deve ter sido com { registration_pin_enc: FAKE_PIN_ENC } somente
    expect(persistChain.update).toHaveBeenCalledWith({ registration_pin_enc: FAKE_PIN_ENC });
    expect(persistChain.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ registration_pin_confirmed_at: expect.anything() })
    );
  });

  it('STP-19: falha na persist inicial → zero Graph calls', async () => {
    setupGuardOk();
    const persistChain = makeUpdateChain(null, new Error('DB error'));
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(CRED_A))
      .mockReturnValueOnce(persistChain);
    mockGeneratePin.mockReturnValue(FAKE_PIN);
    mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('pin_persistence_failed');
    expect(mockSetTwoStepPin).not.toHaveBeenCalled();
  });

  it('STP-20: Graph recebe PIN plaintext gerado (não ciphertext)', async () => {
    setupStateAHappy();
    await handler(makeReq(), makeRes());
    expect(mockSetTwoStepPin).toHaveBeenCalledWith(
      FAKE_PLAIN_TOKEN, FAKE_PHONE_ID, FAKE_PIN
    );
    // Confirmar que não recebe o ciphertext como pin
    expect(mockSetTwoStepPin).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), FAKE_PIN_ENC
    );
  });

  it('STP-21: Graph recebe phone_number_id do banco', async () => {
    setupStateAHappy();
    await handler(makeReq(), makeRes());
    const [, calledPhoneId] = mockSetTwoStepPin.mock.calls[0];
    expect(calledPhoneId).toBe(FAKE_PHONE_ID);
  });

  it('STP-22: Graph recebe token decryptado do banco', async () => {
    setupStateAHappy();
    await handler(makeReq(), makeRes());
    const [calledToken] = mockSetTwoStepPin.mock.calls[0];
    expect(calledToken).toBe(FAKE_PLAIN_TOKEN);
  });

  it('STP-23: campos proibidos do body não controlam PIN/phone/token', async () => {
    setupStateAHappy();
    const maliciousBody = {
      ...HAPPY_BODY,
      pin: '000000',
      phone_number_id: '999999999',
      access_token: 'evil-token',
    };
    await handler(makeReq({ body: maliciousBody }), makeRes());
    expect(mockSetTwoStepPin).toHaveBeenCalledWith(FAKE_PLAIN_TOKEN, FAKE_PHONE_ID, FAKE_PIN);
  });

  it('STP-24: Graph success → confirmed_at preenchido', async () => {
    const { confirmChain } = setupStateAHappy();
    await handler(makeReq(), makeRes());
    expect(confirmChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ registration_pin_confirmed_at: expect.any(String) })
    );
  });

  it('STP-25: response success não contém PIN', async () => {
    setupStateAHappy();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_PIN);
  });
});

// =============================================================================
// STP-26..30 — Estado B
// =============================================================================

describe('Estado B (pin_enc NOT NULL + confirmed_at NULL)', () => {
  it('STP-26: Estado B decripta PIN existente', async () => {
    setupStateBHappy();
    await handler(makeReq(), makeRes());
    expect(mockDecryptPin).toHaveBeenCalledWith(FAKE_PIN_ENC);
  });

  it('STP-27: Estado B NÃO chama generateMetaRegistrationPin', async () => {
    setupStateBHappy();
    await handler(makeReq(), makeRes());
    expect(mockGeneratePin).not.toHaveBeenCalled();
  });

  it('STP-28: Estado B NÃO sobrescreve registration_pin_enc (sem UPDATE de persist)', async () => {
    setupStateBHappy();
    await handler(makeReq(), makeRes());
    // from() só foi chamado 3 vezes: instances, cred, confirm — sem persist UPDATE
    // Verificar que nenhum update foi com registration_pin_enc = qualquer coisa
    const allCalls = mockSvc.from.mock.calls;
    expect(allCalls).toHaveLength(3);
  });

  it('STP-29: Estado B — Graph recebe exatamente o PIN do banco (decryptado)', async () => {
    setupStateBHappy();
    await handler(makeReq(), makeRes());
    const [, , calledPin] = mockSetTwoStepPin.mock.calls[0];
    expect(calledPin).toBe(FAKE_PIN);
  });

  it('STP-30: Estado B — success → confirmed_at preenchido', async () => {
    const { confirmChain } = setupStateBHappy();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(confirmChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ registration_pin_confirmed_at: expect.any(String) })
    );
    expect(res._status).toBe(200);
  });
});

// =============================================================================
// STP-31..32 — Estado C
// =============================================================================

describe('Estado C (pin_enc NOT NULL + confirmed_at NOT NULL)', () => {
  it('STP-31: Estado C → 409 pin_already_confirmed', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(CRED_C));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(409);
    expect(res._body.error).toBe('pin_already_confirmed');
  });

  it('STP-32: Estado C → zero Graph calls', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(CRED_C));
    await handler(makeReq(), makeRes());
    expect(mockSetTwoStepPin).not.toHaveBeenCalled();
  });
});

// =============================================================================
// STP-33..34 — Estado inválido
// =============================================================================

describe('Estado inválido (pin_enc NULL + confirmed_at NOT NULL)', () => {
  it('STP-33: Estado inválido → 500 pin_state_invalid', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(CRED_INVALID));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('pin_state_invalid');
  });

  it('STP-34: Estado inválido → zero Graph calls', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(CRED_INVALID));
    await handler(makeReq(), makeRes());
    expect(mockSetTwoStepPin).not.toHaveBeenCalled();
  });
});

// =============================================================================
// STP-35..36 — Erros de credencial
// =============================================================================

it('STP-35: credential ausente → 500 credential_unavailable + zero Graph', async () => {
  setupGuardOk();
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
    .mockReturnValueOnce(makeSelectChain(null)); // sem credencial
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res._status).toBe(500);
  expect(res._body.error).toBe('credential_unavailable');
  expect(mockSetTwoStepPin).not.toHaveBeenCalled();
});

it('STP-36: decrypt PIN falha (Estado B) → 500 pin_credential_unavailable', async () => {
  setupGuardOk();
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
    .mockReturnValueOnce(makeSelectChain(CRED_B));
  mockDecryptPin.mockImplementation(() => { throw new Error('decrypt fail'); });
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res._status).toBe(500);
  expect(res._body.error).toBe('pin_credential_unavailable');
  expect(mockSetTwoStepPin).not.toHaveBeenCalled();
});

// =============================================================================
// STP-37..41 — Graph errors
// =============================================================================

describe('Graph errors (Estado A)', () => {
  function setupForGraphError() {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(CRED_A))
      .mockReturnValueOnce(makeUpdateChain([{ instance_id: FAKE_INSTANCE_ID }])); // persist
    mockGeneratePin.mockReturnValue(FAKE_PIN);
    mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
  }

  it('STP-37: set_pin_timeout → 503 + PIN permanece (from chamado 3x, não 4x)', async () => {
    setupForGraphError();
    mockSetTwoStepPin.mockRejectedValue(makeGraphError('set_pin_timeout'));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(503);
    expect(res._body.error).toBe('provider_unavailable');
    // confirm update NOT called (from called only 3 times)
    expect(mockSvc.from).toHaveBeenCalledTimes(3);
  });

  it('STP-38: set_pin_network_error → 503 + PIN permanece', async () => {
    setupForGraphError();
    mockSetTwoStepPin.mockRejectedValue(makeGraphError('set_pin_network_error'));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(503);
    expect(res._body.error).toBe('provider_unavailable');
    expect(mockSvc.from).toHaveBeenCalledTimes(3);
  });

  it('STP-39: set_pin_failed → 502 + PIN permanece', async () => {
    setupForGraphError();
    mockSetTwoStepPin.mockRejectedValue(makeGraphError('set_pin_failed'));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(502);
    expect(res._body.error).toBe('set_pin_failed');
    expect(mockSvc.from).toHaveBeenCalledTimes(3);
  });

  it('STP-40: set_pin_invalid_response → 502 + PIN permanece', async () => {
    setupForGraphError();
    mockSetTwoStepPin.mockRejectedValue(makeGraphError('set_pin_invalid_response'));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(502);
    expect(res._body.error).toBe('set_pin_failed');
    expect(mockSvc.from).toHaveBeenCalledTimes(3);
  });

  it('STP-41: set_pin_invalid_input → 500 internal_error', async () => {
    setupForGraphError();
    mockSetTwoStepPin.mockRejectedValue(makeGraphError('set_pin_invalid_input'));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('internal_error');
  });
});

// =============================================================================
// STP-42..45 — Confirmation persistence
// =============================================================================

describe('Confirmação pós-Graph', () => {
  function setupForConfirmationTest(confirmResult) {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(CRED_A))
      .mockReturnValueOnce(makeUpdateChain([{ instance_id: FAKE_INSTANCE_ID }])) // persist ok
      .mockReturnValueOnce(confirmResult);
    mockGeneratePin.mockReturnValue(FAKE_PIN);
    mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockSetTwoStepPin.mockResolvedValue({ ok: true });
  }

  it('STP-42: DB failure após Graph success → pin_confirmation_persistence_failed', async () => {
    setupForConfirmationTest(makeUpdateChain(null, new Error('DB error')));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('pin_confirmation_persistence_failed');
  });

  it('STP-43: confirmation UPDATE retorna 0 rows → pin_confirmation_conflict', async () => {
    setupForConfirmationTest(makeUpdateChain([]));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('pin_confirmation_conflict');
  });

  it('STP-44: nenhuma segunda Graph call em falha de confirmação', async () => {
    setupForConfirmationTest(makeUpdateChain(null, new Error('DB error')));
    await handler(makeReq(), makeRes());
    expect(mockSetTwoStepPin).toHaveBeenCalledTimes(1);
  });

  it('STP-45: confirmed_at timestamp vem do backend (ISO string)', async () => {
    const confirmChain = makeUpdateChain([{ instance_id: FAKE_INSTANCE_ID }]);
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(CRED_A))
      .mockReturnValueOnce(makeUpdateChain([{ instance_id: FAKE_INSTANCE_ID }]))
      .mockReturnValueOnce(confirmChain);
    mockGeneratePin.mockReturnValue(FAKE_PIN);
    mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockSetTwoStepPin.mockResolvedValue({ ok: true });
    await handler(makeReq(), makeRes());
    const updateArg = confirmChain.update.mock.calls[0][0];
    // confirmed_at deve ser ISO string válida
    expect(typeof updateArg.registration_pin_confirmed_at).toBe('string');
    expect(() => new Date(updateArg.registration_pin_confirmed_at)).not.toThrow();
    // NÃO deve vir do request body
    expect(updateArg.registration_pin_confirmed_at).not.toBe(FAKE_CONFIRMED);
  });
});

// =============================================================================
// STP-46..51 — Concorrência (Estado A)
// =============================================================================

describe('Concorrência Estado A', () => {
  const CRED_B_RELOADED = { registration_pin_enc: FAKE_PIN_ENC, registration_pin_confirmed_at: null };

  it('STP-46: UPDATE condicional usa IS NULL em registration_pin_enc', async () => {
    const { persistChain } = setupStateAHappy();
    await handler(makeReq(), makeRes());
    expect(persistChain.is).toHaveBeenCalledWith('registration_pin_enc', null);
  });

  it('STP-47: loser (0 rows persist) → recarrega credential', async () => {
    setupGuardOk();
    const reloadChain  = makeSelectChain(CRED_B_RELOADED);
    const confirmChain = makeUpdateChain([{ instance_id: FAKE_INSTANCE_ID }]);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(CRED_A))
      .mockReturnValueOnce(makeUpdateChain([]))  // 0 rows — loser
      .mockReturnValueOnce(reloadChain)           // reload
      .mockReturnValueOnce(confirmChain);
    mockGeneratePin.mockReturnValue(FAKE_PIN);
    mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
    mockDecryptPin.mockReturnValue(FAKE_PIN);
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockSetTwoStepPin.mockResolvedValue({ ok: true });
    await handler(makeReq(), makeRes());
    expect(reloadChain.maybeSingle).toHaveBeenCalled();
  });

  it('STP-48: loser reutiliza PIN vencedor (chama decryptMetaRegistrationPin)', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(CRED_A))
      .mockReturnValueOnce(makeUpdateChain([]))
      .mockReturnValueOnce(makeSelectChain(CRED_B_RELOADED))
      .mockReturnValueOnce(makeUpdateChain([{ instance_id: FAKE_INSTANCE_ID }]));
    mockGeneratePin.mockReturnValue(FAKE_PIN);
    mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
    mockDecryptPin.mockReturnValue(FAKE_PIN);
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockSetTwoStepPin.mockResolvedValue({ ok: true });
    await handler(makeReq(), makeRes());
    expect(mockDecryptPin).toHaveBeenCalledWith(FAKE_PIN_ENC);
  });

  it('STP-49: loser NÃO usa o PIN que ele mesmo gerou — usa o do banco', async () => {
    const LOSER_PIN = '999999'; // PIN gerado pelo loser
    const WINNER_PIN = FAKE_PIN; // PIN do vencedor no banco
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(CRED_A))
      .mockReturnValueOnce(makeUpdateChain([]))
      .mockReturnValueOnce(makeSelectChain(CRED_B_RELOADED))
      .mockReturnValueOnce(makeUpdateChain([{ instance_id: FAKE_INSTANCE_ID }]));
    mockGeneratePin.mockReturnValue(LOSER_PIN);
    mockEncryptPin.mockReturnValue('v1:LOSER_ENC');
    mockDecryptPin.mockReturnValue(WINNER_PIN);
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    mockSetTwoStepPin.mockResolvedValue({ ok: true });
    await handler(makeReq(), makeRes());
    // Graph deve ter sido chamado com WINNER_PIN (do banco), não LOSER_PIN
    const [, , calledPin] = mockSetTwoStepPin.mock.calls[0];
    expect(calledPin).toBe(WINNER_PIN);
    expect(calledPin).not.toBe(LOSER_PIN);
  });

  it('STP-50: loser encontra confirmed_at preenchido após reload → 409', async () => {
    const CRED_C_RELOADED = { registration_pin_enc: FAKE_PIN_ENC, registration_pin_confirmed_at: FAKE_CONFIRMED };
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(CRED_A))
      .mockReturnValueOnce(makeUpdateChain([]))
      .mockReturnValueOnce(makeSelectChain(CRED_C_RELOADED));
    mockGeneratePin.mockReturnValue(FAKE_PIN);
    mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(409);
    expect(res._body.error).toBe('pin_already_confirmed');
    expect(mockSetTwoStepPin).not.toHaveBeenCalled();
  });

  it('STP-51: estado inválido após reload → 500 pin_state_invalid', async () => {
    const INVALID_RELOADED = { registration_pin_enc: null, registration_pin_confirmed_at: null };
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(CRED_A))
      .mockReturnValueOnce(makeUpdateChain([]))
      .mockReturnValueOnce(makeSelectChain(INVALID_RELOADED)); // pin_enc still null after reload
    mockGeneratePin.mockReturnValue(FAKE_PIN);
    mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('pin_state_invalid');
    expect(mockSetTwoStepPin).not.toHaveBeenCalled();
  });
});

// =============================================================================
// STP-52..58 — Segurança
// =============================================================================

describe('Segurança', () => {
  it('STP-52: PIN não aparece na response', async () => {
    setupStateAHappy();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_PIN);
  });

  it('STP-53: token não aparece na response', async () => {
    setupStateAHappy();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_PLAIN_TOKEN);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_ENC_TOKEN);
  });

  it('STP-54: phone_number_id não aparece na response', async () => {
    setupStateAHappy();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_PHONE_ID);
  });

  it('STP-55: ciphertext não aparece na response', async () => {
    setupStateAHappy();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(JSON.stringify(res._body)).not.toContain(FAKE_PIN_ENC);
  });

  it('STP-56: provider error body não aparece na response (502)', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_INSTANCE))
      .mockReturnValueOnce(makeSelectChain(CRED_A))
      .mockReturnValueOnce(makeUpdateChain([{ instance_id: FAKE_INSTANCE_ID }]));
    mockGeneratePin.mockReturnValue(FAKE_PIN);
    mockEncryptPin.mockReturnValue(FAKE_PIN_ENC);
    mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
    const err = makeGraphError('set_pin_failed');
    err.message = 'Sensitive Meta error message with PIN info';
    mockSetTwoStepPin.mockRejectedValue(err);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(JSON.stringify(res._body)).not.toContain('Sensitive Meta error');
  });

  it('STP-57: uma request faz no máximo um setTwoStepVerificationPin', async () => {
    setupStateAHappy();
    await handler(makeReq(), makeRes());
    expect(mockSetTwoStepPin).toHaveBeenCalledTimes(1);
  });

  it('STP-58: nenhum console.log chamado durante a request', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setupStateAHappy();
    await handler(makeReq(), makeRes());
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
