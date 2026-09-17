// =============================================================================
// complete.test.js
//
// Testes unitários para api/whatsapp/meta/onboarding/complete.js
// Todos os testes usam mocks — sem banco, rede, Graph real ou credential real.
//
// COBERTURA:
//   T-01  POST sucesso completo → 200
//   T-02  GET → 405
//   T-03  PUT → 405
//   T-04  DELETE → 405
//   T-05  Authorization ausente → 401
//   T-06  Authorization vazio → 401
//   T-07  Basic auth → 401
//   T-08  "Bearer" sem token → 401
//   T-09  "Bearer " sem token → 401
//   T-10  "bearer abc" minúsculo → 401
//   T-11  body inválido + JWT inválido → 401 (auth tem precedência)
//   T-12  [LACUNA] auth.getUser lança → DESEJADO 500, ATUAL: exception propaga
//   T-13  req.body undefined → 400 invalid_request
//   T-14  req.body null → 400 invalid_request
//   T-15  req.body string → 400 invalid_request
//   T-16  req.body array → 400 invalid_request
//   T-17  req.body number → 400 invalid_request
//   T-18  req.body {} → 400 invalid_request
//   T-19  company_id presente no body → 400 invalid_request sem claim
//   T-20  state ausente → 400 invalid_request
//   T-21  state não-string → 400 invalid_request
//   T-22  state UUID inválido → 400 invalid_request
//   T-23  code ausente → 400 invalid_request
//   T-24  code não-string → 400 invalid_request
//   T-25  code vazio → 400 invalid_request
//   T-26  code só whitespace → 400 invalid_request
//
//   T-27  REMOVIDO — contrato alterado pela F2:
//         { state, code } sem waba_id NÃO é mais 400.
//         Substituído por F2-T2 (caminho discovery).
//         Ver CONTRACT_TEST_REPLACED: T-27 → F2-T2.
//
//   T-28  waba_id number JS → 400 invalid_request
//   T-29  waba_id com letras → 400 invalid_request
//   T-30  phone_number_id number JS → 400 invalid_request
//   T-31  phone_number_id com letras → 400 invalid_request
//   T-32  phone_number_id null → 400 invalid_request
//   T-33  code com espaços preservado sem trim para exchangeCodeForToken
//   T-34  waba_id leading zeros preservado como string
//   T-35  phone_number_id leading zeros preservado como string na RPC
//   T-36  Claim: chain completa verificada
//   T-37  Claim: mesmo timestamp em used_at e gt('expires_at')
//   T-38  Claim: zero rows → 400 invalid_or_expired_state
//   T-39  Claim: erro operacional → 500 internal_error
//   T-40  [LACUNA] claim maybeSingle lança → DESEJADO 500, ATUAL: exception propaga
//   T-41  companyId vem do claim, não do body
//   T-42  companyId passado ao guard e à RPC
//   T-43  company_id no body → 400 sem tocar claim
//   T-44  Guard sucesso → fluxo prossegue para exchange
//   T-45  Guard 403 → 403 propagado, Graph não chamado; state já consumido
//   T-46  Guard 401 → 401 propagado
//   T-47  Guard 400 → 400 propagado
//   T-48  [LACUNA] guard lança → DESEJADO 500, ATUAL: exception propaga
//   T-49  Claim ocorre antes do guard (state consumido antes da autorização)
//   T-50  exchangeCodeForToken recebe code original (sem trim)
//   T-51  exchangeCodeForToken chamado exatamente uma vez
//   T-52  exchange code_exchange_failed → 500 internal_error
//   T-53  exchange code_exchange_no_token → 500 internal_error
//   T-54  exchange code_exchange_network_error → 500 internal_error
//   T-55  exchange graph_timeout → 500 internal_error
//   T-56  exchange graph_network_error → 500 internal_error
//   T-57  exchange graph_invalid_response → 500 internal_error
//   T-58  listWabaPhoneNumbers graph_waba_inaccessible → 422 waba_inaccessible
//   T-59  listWabaPhoneNumbers graph_timeout → 500 internal_error
//   T-60  listWabaPhoneNumbers graph_network_error → 500 internal_error
//   T-61  listWabaPhoneNumbers graph_invalid_response → 500 internal_error
//   T-62  phones [] sem hint → 422 no_phone_numbers
//   T-63  phones [] com hint → 422 no_phone_numbers
//   T-64  phones [A] sem hint → seleciona A
//   T-65  phones [A] com hint correto → seleciona A
//   T-66  phones [A] com hint errado → 422 requested_phone_not_in_waba
//   T-67  phones [A, B] sem hint → 422 ambiguous_phone_numbers (não phones[0])
//   T-68  phones [A, B] com hint B → seleciona B
//   T-69  phones [A, B] com hint inexistente → 422 requested_phone_not_in_waba
//   T-70  encryptMetaToken recebe accessToken (plaintext)
//   T-71  encryptMetaToken lança → 500 internal_error, RPC não chamada
//   T-72  RPC recebe todos os 9 parâmetros corretos
//   T-73  RPC recebe ciphertext, nunca plaintext
//   T-74  p_display_name: null e p_encryption_version: 1
//   T-75  RPC error 23505 → 409 phone_number_already_connected sem owner/SQL
//   T-76  RPC erro inesperado → 500 internal_error sem SQL/message
//   T-77  RPC data null → 500 internal_error
//   T-78  RPC data [] → 500 internal_error
//   T-79  Sucesso: response body exato
//   T-80  Sucesso: campos sensíveis ausentes do response
//   T-81  verified_name null preservado como null
//   T-82  Ordem: auth → claim → guard → exchange → list → crypto → rpc
//   T-83  Replay lógico: 1ª → 200, 2ª com mesmo state → 400
//   T-84  State de outro user → 400 invalid_or_expired_state (anti-oracle)
//   T-85  Zero leak: exchange failure não expõe canário
//   T-86  Zero leak: crypto failure não expõe canário
//   T-87  Zero leak: RPC failure não expõe canário
//   T-88  Zero leak: 23505 não expõe owner/canário
//
//   F2-T1   Normal path: discoverAuthorizedWabas NÃO chamado → 200
//   F2-T2   Discovery: 1 WABA → 200 (substitui T-27)
//   F2-T3   Discovery: 0 WABAs → 422 no_waba_authorized
//   F2-T4   Discovery: >1 WABAs → 422 ambiguous_waba
//   F2-T5   Discovery throws → 500 internal_error, sem leak
//   F2-T6   waba_id presente inválido → 400 (discover não chamado)
//   F2-T7   company_id + DISCOVERY_BODY → 400 (discover não chamado)
//   F2-T8   Discovery + phone_number_id pertencente → 200
//   F2-T9   Discovery + phone_number_id não pertencente → 422
//   F2-T10  Discovery + 0 phones → 422 no_phone_numbers
//   F2-T11  Discovery + >1 phones sem hint → 422 ambiguous_phone_numbers
//   F2-T12  State inválido → discover NÃO chamado
//   F2-T13  RBAC fail → discover NÃO chamado
//   F2-T14  Discovery + RPC 23505 → 409
//   F2-T15  Discovery success → 6 campos sanitizados exatos
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Mocks — declarados antes dos imports dinâmicos
// =============================================================================

// Mock: getSupabaseAdmin → retorna mockSvc (fechura por referência — não por valor)
const mockSvc = {
  auth: { getUser: vi.fn() },
  from:  vi.fn(),
  rpc:   vi.fn(),
};
vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

// Mock: validateMetaCaller + META_CONNECT_ROLES
const mockValidateMetaCaller = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  META_CONNECT_ROLES: ['super_admin', 'system_admin', 'partner', 'admin'],
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
}));

// Mock: graphClient
const mockExchangeCodeForToken    = vi.fn();
const mockListWabaPhoneNumbers    = vi.fn();
const mockDiscoverAuthorizedWabas = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/graphClient.js', () => ({
  exchangeCodeForToken:    (...args) => mockExchangeCodeForToken(...args),
  listWabaPhoneNumbers:    (...args) => mockListWabaPhoneNumbers(...args),
  discoverAuthorizedWabas: (...args) => mockDiscoverAuthorizedWabas(...args),
}));

// Mock: tokenCrypto
const mockEncryptMetaToken = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/tokenCrypto.js', () => ({
  encryptMetaToken: (...args) => mockEncryptMetaToken(...args),
}));

// Mock: selectionTokenCrypto
const mockEncryptSelectionPayload = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/selectionTokenCrypto.js', () => ({
  encryptSelectionPayload: (...args) => mockEncryptSelectionPayload(...args),
}));

// Import do handler APÓS os mocks
import handler from '../complete.js';

// =============================================================================
// Fixtures
// =============================================================================

const FAKE_USER_ID       = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_COMPANY_ID    = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_STATE         = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_INSTANCE_ID   = 'dddd0000-0000-0000-0000-000000000004';
const FAKE_WABA_ID       = '123456789';
const FAKE_PHONE_ID      = '987654321';
const FAKE_PHONE_NUMBER  = '+55 11 91234-5678';
const FAKE_VERIFIED_NAME = 'Empresa Fake LTDA';
const FAKE_CODE          = 'fake-auth-code';
const FAKE_ACCESS_TOKEN  = 'EAAxxxFAKE_ACCESS_TOKEN';
const FAKE_CIPHERTEXT    = 'v1:FAKECIPHERTEXT==';

// Phone objects no formato de graphClient.normalizePhone()
const PHONE_A = {
  id:                 FAKE_PHONE_ID,
  displayPhoneNumber: FAKE_PHONE_NUMBER,
  verifiedName:       FAKE_VERIFIED_NAME,
};
const PHONE_B = {
  id:                 '111111111',
  displayPhoneNumber: '+55 21 99999-9999',
  verifiedName:       'Empresa B Fake',
};

// PHONE_C: id distinto de PHONE_A, mas displayPhoneNumber e verifiedName idênticos.
// Usado exclusivamente nos testes S7.1 Case C (ambiguous_phone_display).
// Não usar em outros testes — introduziria ambiguidade de display não intencional.
const PHONE_C = {
  id:                 '555444333',
  displayPhoneNumber: FAKE_PHONE_NUMBER,   // = '+55 11 91234-5678' — igual a PHONE_A
  verifiedName:       FAKE_VERIFIED_NAME,  // = 'Empresa Fake LTDA' — igual a PHONE_A
};

const FAKE_RPC_ROW = {
  instance_id:     FAKE_INSTANCE_ID,
  phone_number_id: FAKE_PHONE_ID,
  waba_id:         FAKE_WABA_ID,
  phone_number:    FAKE_PHONE_NUMBER,
  verified_name:   FAKE_VERIFIED_NAME,
  status:          'connected',
};

// WABA ID adicional para testes com múltiplas WABAs (F2-T4)
const FAKE_WABA_ID_2 = '999888777666555';

// Body padrão do happy path (com waba_id — caminho normal)
const DEFAULT_BODY = {
  state:   FAKE_STATE,
  code:    FAKE_CODE,
  waba_id: FAKE_WABA_ID,
};

// Body do caminho discovery — waba_id intencionalmente ausente (F2)
const DISCOVERY_BODY = {
  state: FAKE_STATE,
  code:  FAKE_CODE,
};

// =============================================================================
// Factories
// =============================================================================

/**
 * Cria um req mock.
 * Se body não for passado, usa DEFAULT_BODY.
 * Para sobrescrever totalmente o body, passar { body: <valor> }.
 */
function makeReq({ method = 'POST', headers = {}, body } = {}) {
  return {
    method,
    headers: { authorization: 'Bearer fake-jwt-token', ...headers },
    body: body !== undefined ? body : { ...DEFAULT_BODY },
  };
}

/** Cria um res mock com captura de status e body. */
function makeRes() {
  return {
    _status: null,
    _body:   null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body   = body; return this; },
  };
}

/** Cria uma chain de claim UPDATE configurável. */
function makeClaimChain(data, error = null) {
  return {
    update:     vi.fn().mockReturnThis(),
    eq:         vi.fn().mockReturnThis(),
    is:         vi.fn().mockReturnThis(),
    gt:         vi.fn().mockReturnThis(),
    select:     vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

/** Cria um Error com err.code (padrão graphClient). */
function makeGraphError(code) {
  const err = new Error('graph error');
  err.code = code;
  return err;
}

// =============================================================================
// Helpers de setup
// =============================================================================

function setupAuthOk(userId = FAKE_USER_ID) {
  mockSvc.auth.getUser.mockResolvedValue({
    data: { user: { id: userId } }, error: null,
  });
}

function setupClaimOk(companyId = FAKE_COMPANY_ID) {
  const chain = makeClaimChain({ company_id: companyId });
  mockSvc.from = vi.fn().mockReturnValue(chain);
  return chain;
}

function setupGuardOk() {
  mockValidateMetaCaller.mockResolvedValue({
    ok: true, userId: FAKE_USER_ID, role: 'admin', accessPath: 'direct',
  });
}

function setupGraphOk(phones = [PHONE_A]) {
  mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
  mockListWabaPhoneNumbers.mockResolvedValue(phones);
}

function setupDiscoveryOk(wabaIds = [FAKE_WABA_ID]) {
  mockDiscoverAuthorizedWabas.mockResolvedValue(wabaIds);
}

function setupEncryptOk() {
  mockEncryptMetaToken.mockReturnValue(FAKE_CIPHERTEXT);
}

const FAKE_CONTINUATION_TOKEN = 'v1:FAKE_CONTINUATION_TOKEN_AEAD==';

function setupSelectionEncryptOk() {
  mockEncryptSelectionPayload.mockReturnValue(FAKE_CONTINUATION_TOKEN);
}

function setupRpcOk(rowOverrides = {}) {
  const row = { ...FAKE_RPC_ROW, ...rowOverrides };
  mockSvc.rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
  return row;
}

/** Setup completo do happy path. */
function setupHappyPath() {
  setupAuthOk();
  setupClaimOk();
  setupGuardOk();
  setupGraphOk();
  setupEncryptOk();
  setupRpcOk();
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// Testes
// =============================================================================

describe('POST /api/whatsapp/meta/onboarding/complete', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // T-01: Sucesso completo
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-01: POST sucesso completo → 200', () => {
    it('retorna 200 com estrutura instance correta', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(200);
      expect(res._body).toEqual({
        instance: {
          id:              FAKE_INSTANCE_ID,
          phone_number_id: FAKE_PHONE_ID,
          waba_id:         FAKE_WABA_ID,
          phone_number:    FAKE_PHONE_NUMBER,
          verified_name:   FAKE_VERIFIED_NAME,
          status:          'connected',
        },
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-02 / T-03 / T-04: Method guard
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-02: GET → 405', () => {
    it('retorna 405 sem chamar auth/claim/Graph/RPC', async () => {
      const res = makeRes();
      await handler(makeReq({ method: 'GET' }), res);
      expect(res._status).toBe(405);
      expect(res._body.error).toMatch(/method not allowed/i);
      expect(mockSvc.auth.getUser).not.toHaveBeenCalled();
      expect(mockValidateMetaCaller).not.toHaveBeenCalled();
      expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });
  });

  describe('T-03: PUT → 405', () => {
    it('retorna 405', async () => {
      const res = makeRes();
      await handler(makeReq({ method: 'PUT' }), res);
      expect(res._status).toBe(405);
    });
  });

  describe('T-04: DELETE → 405', () => {
    it('retorna 405', async () => {
      const res = makeRes();
      await handler(makeReq({ method: 'DELETE' }), res);
      expect(res._status).toBe(405);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-05 a T-10: Bearer / Authorization
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-05: Authorization ausente → 401', () => {
    it('retorna 401 sem tocar auth.getUser', async () => {
      const res = makeRes();
      await handler(
        { method: 'POST', headers: {}, body: { ...DEFAULT_BODY } },
        res,
      );
      expect(res._status).toBe(401);
      expect(res._body.error).toBe('unauthorized');
      expect(mockSvc.auth.getUser).not.toHaveBeenCalled();
    });
  });

  describe('T-06: Authorization vazio → 401', () => {
    it('retorna 401', async () => {
      const res = makeRes();
      await handler(makeReq({ headers: { authorization: '' } }), res);
      expect(res._status).toBe(401);
      expect(res._body.error).toBe('unauthorized');
    });
  });

  describe('T-07: Basic auth → 401', () => {
    it('retorna 401 para esquema Basic', async () => {
      const res = makeRes();
      await handler(makeReq({ headers: { authorization: 'Basic dXNlcjpwYXNz' } }), res);
      expect(res._status).toBe(401);
    });
  });

  describe('T-08: "Bearer" sem espaço/token → 401', () => {
    it('retorna 401 — apenas o prefixo "Bearer" sem espaço', async () => {
      const res = makeRes();
      await handler(makeReq({ headers: { authorization: 'Bearer' } }), res);
      expect(res._status).toBe(401);
    });
  });

  describe('T-09: "Bearer " com espaço mas sem token → 401', () => {
    it('retorna 401 — token vazio após Bearer', async () => {
      const res = makeRes();
      await handler(makeReq({ headers: { authorization: 'Bearer ' } }), res);
      expect(res._status).toBe(401);
    });
  });

  describe('T-10: "bearer abc" minúsculo → 401', () => {
    it('retorna 401 — Bearer é case-sensitive', async () => {
      const res = makeRes();
      await handler(makeReq({ headers: { authorization: 'bearer fake-jwt-token' } }), res);
      expect(res._status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-11: Precedência auth > body
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-11: JWT inválido + body inválido → 401 (auth tem precedência)', () => {
    it('retorna 401, não 400', async () => {
      mockSvc.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid jwt' } });
      const res = makeRes();
      // body propositalmente sem state/code/waba_id
      await handler(makeReq({ body: {} }), res);
      expect(res._status).toBe(401);
      expect(res._body.error).toBe('unauthorized');
    });

    it('meta_whatsapp_onboarding não é acessado quando JWT inválido', async () => {
      mockSvc.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
      const mockFrom = vi.fn();
      mockSvc.from = mockFrom;
      await handler(makeReq(), makeRes());
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-12: [LACUNA] auth.getUser lança inesperadamente
  // Documenta ausência de try/catch externo — FALHARÁ propositalmente.
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-12: [LACUNA] auth.getUser throws → DESEJADO 500 internal_error', () => {
    it('KNOWN GAP: handler propaga exception de auth.getUser (sem try/catch externo)', async () => {
      mockSvc.auth.getUser = vi.fn().mockRejectedValue(new Error('boom-auth-CANARY'));
      const res = makeRes();
      let threw = false;
      try {
        await handler(makeReq(), res);
      } catch {
        threw = true;
      }
      // COMPORTAMENTO DESEJADO: handler absorve e retorna 500.
      // Se threw===true → handler propagou → lacuna confirmada.
      expect(threw, 'LACUNA: handler propagou exception de auth.getUser sem try/catch externo').toBe(false);
      expect(res._status).toBe(500);
      expect(res._body?.error).toBe('internal_error');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-13 a T-32: Body validation (todos com JWT válido)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Body validation — todos com JWT válido pré-configurado', () => {
    beforeEach(() => {
      setupAuthOk();
      // claim NÃO deve ser chamado quando body é inválido
      mockSvc.from = vi.fn();
    });

    it('T-13: req.body undefined → 400 invalid_request', async () => {
      const res = makeRes();
      await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: undefined }, res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_request');
    });

    it('T-14: req.body null → 400 invalid_request', async () => {
      const res = makeRes();
      await handler(makeReq({ body: null }), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_request');
    });

    it('T-15: req.body string → 400 invalid_request', async () => {
      const res = makeRes();
      await handler(makeReq({ body: 'malicious-string' }), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_request');
    });

    it('T-16: req.body array → 400 invalid_request', async () => {
      const res = makeRes();
      await handler(makeReq({ body: [] }), res);
      expect(res._status).toBe(400);
    });

    it('T-17: req.body number → 400 invalid_request', async () => {
      const res = makeRes();
      await handler(makeReq({ body: 42 }), res);
      expect(res._status).toBe(400);
    });

    it('T-18: req.body {} vazio → 400 invalid_request', async () => {
      const res = makeRes();
      await handler(makeReq({ body: {} }), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_request');
    });

    it('T-19: company_id presente no body → 400 invalid_request sem claim', async () => {
      const mockFrom = vi.fn();
      mockSvc.from = mockFrom;
      const res = makeRes();
      await handler(makeReq({ body: { company_id: FAKE_COMPANY_ID, ...DEFAULT_BODY } }), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_request');
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('T-20: state ausente → 400 invalid_request', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { code: FAKE_CODE, waba_id: FAKE_WABA_ID } }), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_request');
    });

    it('T-21: state não-string (number) → 400 invalid_request', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { state: 12345, code: FAKE_CODE, waba_id: FAKE_WABA_ID } }), res);
      expect(res._status).toBe(400);
    });

    it('T-22: state UUID inválido → 400 invalid_request', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { state: 'not-a-uuid', code: FAKE_CODE, waba_id: FAKE_WABA_ID } }), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_request');
    });

    it('T-23: code ausente → 400 invalid_request', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { state: FAKE_STATE, waba_id: FAKE_WABA_ID } }), res);
      expect(res._status).toBe(400);
    });

    it('T-24: code não-string (number) → 400 invalid_request', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { state: FAKE_STATE, code: 42, waba_id: FAKE_WABA_ID } }), res);
      expect(res._status).toBe(400);
    });

    it('T-25: code vazio → 400 invalid_request', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { state: FAKE_STATE, code: '', waba_id: FAKE_WABA_ID } }), res);
      expect(res._status).toBe(400);
    });

    it('T-26: code só whitespace → 400 invalid_request', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { state: FAKE_STATE, code: '   ', waba_id: FAKE_WABA_ID } }), res);
      expect(res._status).toBe(400);
    });

    // T-27 REMOVIDO — ver cabeçalho do arquivo.
    // CONTRACT_TEST_REPLACED: T-27 → F2-T2.
    // { state, code } sem waba_id agora dispara caminho discovery (F2).

    it('T-28: waba_id number JS → 400 (sem coerção)', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { state: FAKE_STATE, code: FAKE_CODE, waba_id: 123456789 } }), res);
      expect(res._status).toBe(400);
    });

    it('T-29: waba_id com letras → 400 invalid_request', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { state: FAKE_STATE, code: FAKE_CODE, waba_id: 'abc123' } }), res);
      expect(res._status).toBe(400);
    });

    it('T-30: phone_number_id number JS → 400 invalid_request', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { ...DEFAULT_BODY, phone_number_id: 987654321 } }), res);
      expect(res._status).toBe(400);
    });

    it('T-31: phone_number_id com letras → 400 invalid_request', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { ...DEFAULT_BODY, phone_number_id: 'abc' } }), res);
      expect(res._status).toBe(400);
    });

    it('T-32: phone_number_id null → 400 (null !== undefined → entra branch → typeof null !== string)', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { ...DEFAULT_BODY, phone_number_id: null } }), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_request');
    });

    it('body inválido não acessa meta_whatsapp_onboarding', async () => {
      const mockFrom = vi.fn();
      mockSvc.from = mockFrom;
      await handler(makeReq({ body: { state: 'bad-uuid', code: FAKE_CODE, waba_id: FAKE_WABA_ID } }), makeRes());
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-33: code com whitespace preservado para exchangeCodeForToken
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-33: code com espaços preservado sem trim', () => {
    it('exchangeCodeForToken recebe o code original com espaços', async () => {
      setupHappyPath();
      const codeWithSpaces = '  abc-auth-code  ';
      await handler(makeReq({ body: { state: FAKE_STATE, code: codeWithSpaces, waba_id: FAKE_WABA_ID } }), makeRes());
      expect(mockExchangeCodeForToken).toHaveBeenCalledWith(codeWithSpaces);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-34 / T-35: Meta IDs como strings (leading zeros)
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-34 / T-35: Meta IDs preservados como strings (leading zeros)', () => {
    it('T-34: waba_id com zeros à esquerda passado como string para listWabaPhoneNumbers', async () => {
      setupHappyPath();
      const wabaLeadingZeros = '001234567890';
      await handler(makeReq({ body: { state: FAKE_STATE, code: FAKE_CODE, waba_id: wabaLeadingZeros } }), makeRes());
      expect(mockListWabaPhoneNumbers).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, wabaLeadingZeros);
    });

    it('T-35: phone_number_id com zeros à esquerda preservado como string na RPC', async () => {
      const phoneLeadingZeros  = '000987654321';
      const phoneLeadingObj    = { ...PHONE_A, id: phoneLeadingZeros };
      setupAuthOk();
      setupClaimOk();
      setupGuardOk();
      mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
      mockListWabaPhoneNumbers.mockResolvedValue([phoneLeadingObj]);
      setupEncryptOk();
      setupRpcOk();

      await handler(
        makeReq({ body: { ...DEFAULT_BODY, phone_number_id: phoneLeadingZeros } }),
        makeRes(),
      );

      const rpcParams = mockSvc.rpc.mock.calls[0][1];
      expect(rpcParams.p_phone_number_id).toBe(phoneLeadingZeros);
      expect(typeof rpcParams.p_phone_number_id).toBe('string');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-36 / T-37: Claim chain
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-36: Claim chain completa verificada', () => {
    it('chama .from / .update / .eq(id) / .eq(user_id) / .is(used_at,null) / .gt(expires_at) / .select / .maybeSingle', async () => {
      setupAuthOk();
      const chain = setupClaimOk();
      setupGuardOk();
      setupGraphOk();
      setupEncryptOk();
      setupRpcOk();

      await handler(makeReq(), makeRes());

      expect(mockSvc.from).toHaveBeenCalledWith('meta_whatsapp_onboarding');
      expect(chain.update).toHaveBeenCalledOnce();
      const updateArg = chain.update.mock.calls[0][0];
      expect(updateArg).toHaveProperty('used_at');
      expect(chain.eq).toHaveBeenCalledWith('id', FAKE_STATE);
      expect(chain.eq).toHaveBeenCalledWith('user_id', FAKE_USER_ID);
      expect(chain.is).toHaveBeenCalledWith('used_at', null);
      expect(chain.gt).toHaveBeenCalledWith('expires_at', expect.any(String));
      expect(chain.select).toHaveBeenCalledWith('company_id');
      expect(chain.maybeSingle).toHaveBeenCalledOnce();
    });
  });

  describe('T-37: Claim usa mesmo timestamp em used_at e gt("expires_at")', () => {
    it('timestamp de used_at === timestamp de gt("expires_at")', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-14T18:00:00.000Z'));

      setupAuthOk();
      const chain = setupClaimOk();
      setupGuardOk();
      setupGraphOk();
      setupEncryptOk();
      setupRpcOk();

      await handler(makeReq(), makeRes());

      const updateTimestamp = chain.update.mock.calls[0][0].used_at;
      const gtArgs          = chain.gt.mock.calls[0];

      expect(gtArgs[0]).toBe('expires_at');
      expect(gtArgs[1]).toBe(updateTimestamp); // mesmo valor exato

      vi.useRealTimers();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-38 / T-39: Claim failures
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-38: Claim zero rows → 400 invalid_or_expired_state', () => {
    it('retorna 400 sem chamar guard/Graph/crypto/RPC', async () => {
      setupAuthOk();
      mockSvc.from = vi.fn().mockReturnValue(makeClaimChain(null, null));

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_or_expired_state');
      expect(mockValidateMetaCaller).not.toHaveBeenCalled();
      expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
      expect(mockListWabaPhoneNumbers).not.toHaveBeenCalled();
      expect(mockEncryptMetaToken).not.toHaveBeenCalled();
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });
  });

  describe('T-39: Claim erro operacional → 500 internal_error', () => {
    it('retorna 500 sem expor message do banco', async () => {
      setupAuthOk();
      mockSvc.from = vi.fn().mockReturnValue(
        makeClaimChain(null, { code: 'PGRST301', message: 'connection-CANARY refused' }),
      );

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(500);
      expect(res._body.error).toBe('internal_error');
      expect(JSON.stringify(res._body)).not.toContain('connection-CANARY');
      expect(mockValidateMetaCaller).not.toHaveBeenCalled();
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-40: [LACUNA] claim maybeSingle lança inesperadamente
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-40: [LACUNA] claim maybeSingle throws → DESEJADO 500 internal_error', () => {
    it('KNOWN GAP: handler propaga exception do claim (sem try/catch externo)', async () => {
      setupAuthOk();
      const chain = {
        update:     vi.fn().mockReturnThis(),
        eq:         vi.fn().mockReturnThis(),
        is:         vi.fn().mockReturnThis(),
        gt:         vi.fn().mockReturnThis(),
        select:     vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockRejectedValue(new Error('boom-claim-CANARY')),
      };
      mockSvc.from = vi.fn().mockReturnValue(chain);

      const res = makeRes();
      let threw = false;
      try {
        await handler(makeReq(), res);
      } catch {
        threw = true;
      }
      expect(threw, 'LACUNA: handler propagou exception do claim sem try/catch externo').toBe(false);
      expect(res._status).toBe(500);
      expect(res._body?.error).toBe('internal_error');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-41 / T-42: Tenant authority
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-41: companyId vem exclusivamente do claim, não do body', () => {
    it('guard recebe o company_id do claim', async () => {
      const COMPANY_FROM_STATE = 'eeee1111-0000-0000-0000-000000000099';
      setupAuthOk();
      const chain = makeClaimChain({ company_id: COMPANY_FROM_STATE });
      mockSvc.from = vi.fn().mockReturnValue(chain);
      setupGuardOk();
      setupGraphOk();
      setupEncryptOk();
      setupRpcOk();

      await handler(makeReq(), makeRes());

      const guardCallArgs = mockValidateMetaCaller.mock.calls[0];
      expect(guardCallArgs[2]).toBe(COMPANY_FROM_STATE);
    });
  });

  describe('T-42: companyId passado à RPC via p_company_id', () => {
    it('RPC recebe o mesmo company_id do claim', async () => {
      const COMPANY_FROM_STATE = 'eeee2222-0000-0000-0000-000000000099';
      setupAuthOk();
      const chain = makeClaimChain({ company_id: COMPANY_FROM_STATE });
      mockSvc.from = vi.fn().mockReturnValue(chain);
      setupGuardOk();
      setupGraphOk();
      setupEncryptOk();
      setupRpcOk();

      await handler(makeReq(), makeRes());

      const rpcParams = mockSvc.rpc.mock.calls[0][1];
      expect(rpcParams.p_company_id).toBe(COMPANY_FROM_STATE);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-43: company_id no body → 400 sem claim
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-43: company_id no body → 400 invalid_request sem claim', () => {
    it('rejeita antes de acessar o banco quando body contém company_id', async () => {
      setupAuthOk();
      const mockFrom = vi.fn();
      mockSvc.from = mockFrom;

      const res = makeRes();
      await handler(makeReq({ body: { company_id: FAKE_COMPANY_ID, ...DEFAULT_BODY } }), res);

      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_request');
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-44: Guard sucesso
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-44: Guard ok → fluxo prossegue para exchange', () => {
    it('chama exchangeCodeForToken após guard aprovado', async () => {
      setupHappyPath();
      await handler(makeReq(), makeRes());
      expect(mockExchangeCodeForToken).toHaveBeenCalledOnce();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-45 / T-46 / T-47: Guard denial
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-45: Guard 403 → 403 propagado, Graph não chamado', () => {
    it('retorna 403 e não chama Graph/crypto/RPC', async () => {
      setupAuthOk();
      setupClaimOk();
      mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'Permissão insuficiente' });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(403);
      expect(res._body.error).toBe('Permissão insuficiente');
      expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
      expect(mockListWabaPhoneNumbers).not.toHaveBeenCalled();
      expect(mockEncryptMetaToken).not.toHaveBeenCalled();
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });

    it('state já foi consumido (claim ocorreu antes do guard)', async () => {
      setupAuthOk();
      const chain = setupClaimOk();
      mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'forbidden' });

      await handler(makeReq(), makeRes());

      expect(chain.maybeSingle).toHaveBeenCalledOnce(); // claim ocorreu
      expect(mockValidateMetaCaller).toHaveBeenCalledOnce(); // guard foi chamado
      expect(mockExchangeCodeForToken).not.toHaveBeenCalled(); // Graph não
    });
  });

  describe('T-46: Guard 401 → 401 propagado', () => {
    it('retorna 401 do guard', async () => {
      setupAuthOk();
      setupClaimOk();
      mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 401, error: 'Sessão inválida' });

      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(401);
      expect(res._body.error).toBe('Sessão inválida');
    });
  });

  describe('T-47: Guard 400 → 400 propagado', () => {
    it('retorna 400 do guard', async () => {
      setupAuthOk();
      setupClaimOk();
      mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 400, error: 'company_id inválido' });

      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('company_id inválido');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-48: [LACUNA] guard lança inesperadamente
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-48: [LACUNA] validateMetaCaller throws → DESEJADO 500 internal_error', () => {
    it('KNOWN GAP: handler propaga exception do guard (sem try/catch externo)', async () => {
      setupAuthOk();
      setupClaimOk();
      mockValidateMetaCaller.mockRejectedValue(new Error('boom-guard-CANARY'));

      const res = makeRes();
      let threw = false;
      try {
        await handler(makeReq(), res);
      } catch {
        threw = true;
      }
      expect(threw, 'LACUNA: handler propagou exception de validateMetaCaller sem try/catch externo').toBe(false);
      expect(res._status).toBe(500);
      expect(res._body?.error).toBe('internal_error');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-49: Claim antes do guard (state consumido antes da autorização)
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-49: Ordem claim → guard documentada por tracking de invocação', () => {
    it('claim é executado antes do guard', async () => {
      const order = [];
      setupAuthOk();

      const chain = {
        update:     vi.fn().mockReturnThis(),
        eq:         vi.fn().mockReturnThis(),
        is:         vi.fn().mockReturnThis(),
        gt:         vi.fn().mockReturnThis(),
        select:     vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          order.push('claim');
          return { data: { company_id: FAKE_COMPANY_ID }, error: null };
        }),
      };
      mockSvc.from = vi.fn().mockReturnValue(chain);

      mockValidateMetaCaller.mockImplementation(async () => {
        order.push('guard');
        return { ok: false, status: 403, error: 'denied' };
      });

      await handler(makeReq(), makeRes());
      expect(order).toEqual(['claim', 'guard']);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-50 / T-51: Exchange
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-50: exchangeCodeForToken recebe code original (sem trim)', () => {
    it('recebe exatamente o code do body, incluindo espaços se presentes', async () => {
      setupHappyPath();
      const originalCode = 'EmbeddedSignup_Code_Original';
      await handler(makeReq({ body: { state: FAKE_STATE, code: originalCode, waba_id: FAKE_WABA_ID } }), makeRes());
      expect(mockExchangeCodeForToken).toHaveBeenCalledWith(originalCode);
    });
  });

  describe('T-51: exchangeCodeForToken chamado exatamente uma vez por request', () => {
    it('uma única invocação', async () => {
      setupHappyPath();
      await handler(makeReq(), makeRes());
      expect(mockExchangeCodeForToken).toHaveBeenCalledOnce();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-52 a T-57: Exchange errors → 500 internal_error
  // ──────────────────────────────────────────────────────────────────────────
  describe('Exchange errors → 500 internal_error (listWabaPhoneNumbers não chamada)', () => {
    const exchangeErrorCodes = [
      'code_exchange_failed',
      'code_exchange_no_token',
      'code_exchange_network_error',
      'graph_timeout',
      'graph_network_error',
      'graph_invalid_response',
    ];

    exchangeErrorCodes.forEach((errorCode, idx) => {
      it(`T-${52 + idx}: exchange "${errorCode}" → 500 internal_error`, async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockRejectedValue(makeGraphError(errorCode));

        const res = makeRes();
        await handler(makeReq(), res);

        expect(res._status).toBe(500);
        expect(res._body.error).toBe('internal_error');
        expect(mockListWabaPhoneNumbers).not.toHaveBeenCalled();
        expect(mockEncryptMetaToken).not.toHaveBeenCalled();
        expect(mockSvc.rpc).not.toHaveBeenCalled();
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-58: WABA inaccessible → 422 waba_inaccessible
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-58: listWabaPhoneNumbers graph_waba_inaccessible → 422 waba_inaccessible', () => {
    it('retorna 422 sem chamar crypto/RPC', async () => {
      setupAuthOk();
      setupClaimOk();
      setupGuardOk();
      mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
      mockListWabaPhoneNumbers.mockRejectedValue(makeGraphError('graph_waba_inaccessible'));

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(422);
      expect(res._body.error).toBe('waba_inaccessible');
      expect(mockEncryptMetaToken).not.toHaveBeenCalled();
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-59 / T-60 / T-61: Outros erros de listagem → 500 internal_error
  // ──────────────────────────────────────────────────────────────────────────
  describe('Outros erros de listWabaPhoneNumbers → 500 internal_error', () => {
    ['graph_timeout', 'graph_network_error', 'graph_invalid_response'].forEach((code, idx) => {
      it(`T-${59 + idx}: listagem "${code}" → 500 internal_error`, async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        mockListWabaPhoneNumbers.mockRejectedValue(makeGraphError(code));

        const res = makeRes();
        await handler(makeReq(), res);

        expect(res._status).toBe(500);
        expect(res._body.error).toBe('internal_error');
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-62 a T-69: Phone selection
  // ──────────────────────────────────────────────────────────────────────────
  describe('Phone selection', () => {
    function setupUpToList(phones) {
      setupAuthOk();
      setupClaimOk();
      setupGuardOk();
      mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
      mockListWabaPhoneNumbers.mockResolvedValue(phones);
    }

    it('T-62: phones [] sem hint → 422 no_phone_numbers, crypto/RPC não chamados', async () => {
      setupUpToList([]);
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(422);
      expect(res._body.error).toBe('no_phone_numbers');
      expect(mockEncryptMetaToken).not.toHaveBeenCalled();
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });

    it('T-63: phones [] com hint → 422 no_phone_numbers', async () => {
      setupUpToList([]);
      const res = makeRes();
      await handler(makeReq({ body: { ...DEFAULT_BODY, phone_number_id: FAKE_PHONE_ID } }), res);
      expect(res._status).toBe(422);
      expect(res._body.error).toBe('no_phone_numbers');
    });

    it('T-64: phones [A] sem hint → seleciona A, RPC recebe campos de A', async () => {
      setupUpToList([PHONE_A]);
      setupEncryptOk();
      setupRpcOk();

      await handler(makeReq(), makeRes());

      const rpcParams = mockSvc.rpc.mock.calls[0][1];
      expect(rpcParams.p_phone_number_id).toBe(PHONE_A.id);
      expect(rpcParams.p_phone_number).toBe(PHONE_A.displayPhoneNumber);
      expect(rpcParams.p_verified_name).toBe(PHONE_A.verifiedName);
    });

    it('T-65: phones [A] com hint correto → seleciona A', async () => {
      setupUpToList([PHONE_A]);
      setupEncryptOk();
      setupRpcOk();

      await handler(makeReq({ body: { ...DEFAULT_BODY, phone_number_id: PHONE_A.id } }), makeRes());

      const rpcParams = mockSvc.rpc.mock.calls[0][1];
      expect(rpcParams.p_phone_number_id).toBe(PHONE_A.id);
    });

    it('T-66: phones [A] com hint errado → 422 requested_phone_not_in_waba', async () => {
      setupUpToList([PHONE_A]);
      const res = makeRes();
      await handler(makeReq({ body: { ...DEFAULT_BODY, phone_number_id: '999999999' } }), res);
      expect(res._status).toBe(422);
      expect(res._body.error).toBe('requested_phone_not_in_waba');
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });

    it('T-67: phones [A, B] sem hint → 422 ambiguous_phone_numbers (não phones[0])', async () => {
      setupUpToList([PHONE_A, PHONE_B]);
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(422);
      expect(res._body.error).toBe('ambiguous_phone_numbers');
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });

    it('T-68: phones [A, B] com hint B → seleciona B (não A)', async () => {
      setupUpToList([PHONE_A, PHONE_B]);
      setupEncryptOk();
      setupRpcOk();

      await handler(makeReq({ body: { ...DEFAULT_BODY, phone_number_id: PHONE_B.id } }), makeRes());

      const rpcParams = mockSvc.rpc.mock.calls[0][1];
      expect(rpcParams.p_phone_number_id).toBe(PHONE_B.id);
      expect(rpcParams.p_phone_number).toBe(PHONE_B.displayPhoneNumber);
      expect(rpcParams.p_phone_number_id).not.toBe(PHONE_A.id);
    });

    it('T-69: phones [A, B] com hint inexistente → 422 requested_phone_not_in_waba', async () => {
      setupUpToList([PHONE_A, PHONE_B]);
      const res = makeRes();
      await handler(makeReq({ body: { ...DEFAULT_BODY, phone_number_id: '000' } }), res);
      expect(res._status).toBe(422);
      expect(res._body.error).toBe('requested_phone_not_in_waba');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-70 / T-71: Crypto
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-70: encryptMetaToken recebe accessToken (plaintext)', () => {
    it('criptografia recebe exatamente o access token plaintext', async () => {
      setupAuthOk();
      setupClaimOk();
      setupGuardOk();
      mockExchangeCodeForToken.mockResolvedValue({ accessToken: 'REAL_PLAINTEXT_TOKEN' });
      mockListWabaPhoneNumbers.mockResolvedValue([PHONE_A]);
      mockEncryptMetaToken.mockReturnValue(FAKE_CIPHERTEXT);
      setupRpcOk();

      await handler(makeReq(), makeRes());

      expect(mockEncryptMetaToken).toHaveBeenCalledWith('REAL_PLAINTEXT_TOKEN');
    });
  });

  describe('T-71: encryptMetaToken lança → 500 internal_error, RPC não chamada', () => {
    it('retorna 500 sem expor message do erro de crypto', async () => {
      setupAuthOk();
      setupClaimOk();
      setupGuardOk();
      setupGraphOk();
      mockEncryptMetaToken.mockImplementation(() => {
        throw new Error('[meta/tokenCrypto] META_TOKEN_ENC_KEY_V1 não configurada — CANARY');
      });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(500);
      expect(res._body.error).toBe('internal_error');
      expect(JSON.stringify(res._body)).not.toContain('META_TOKEN_ENC_KEY');
      expect(JSON.stringify(res._body)).not.toContain('CANARY');
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-72 / T-73 / T-74: RPC params
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-72: RPC recebe todos os 9 parâmetros corretos', () => {
    it('todos os parâmetros com valores certos', async () => {
      setupHappyPath();
      await handler(makeReq(), makeRes());

      expect(mockSvc.rpc).toHaveBeenCalledOnce();
      const [rpcName, rpcParams] = mockSvc.rpc.mock.calls[0];
      expect(rpcName).toBe('rpc_create_meta_whatsapp_connection');
      expect(rpcParams.p_company_id).toBe(FAKE_COMPANY_ID);
      expect(rpcParams.p_connected_by).toBe(FAKE_USER_ID);
      expect(rpcParams.p_waba_id).toBe(FAKE_WABA_ID);
      expect(rpcParams.p_phone_number_id).toBe(FAKE_PHONE_ID);
      expect(rpcParams.p_phone_number).toBe(FAKE_PHONE_NUMBER);
      expect(rpcParams.p_verified_name).toBe(FAKE_VERIFIED_NAME);
      expect(rpcParams.p_display_name).toBeNull();
      expect(rpcParams.p_access_token_enc).toBe(FAKE_CIPHERTEXT);
      expect(rpcParams.p_encryption_version).toBe(1);
    });
  });

  describe('T-73: RPC recebe ciphertext, nunca plaintext', () => {
    it('p_access_token_enc é o ciphertext, não o access token', async () => {
      setupHappyPath();
      await handler(makeReq(), makeRes());

      const rpcParams = mockSvc.rpc.mock.calls[0][1];
      expect(rpcParams.p_access_token_enc).toBe(FAKE_CIPHERTEXT);
      expect(rpcParams.p_access_token_enc).not.toBe(FAKE_ACCESS_TOKEN);
    });
  });

  describe('T-74: p_display_name: null e p_encryption_version: 1 são literais', () => {
    it('constantes corretas na RPC', async () => {
      setupHappyPath();
      await handler(makeReq(), makeRes());

      const rpcParams = mockSvc.rpc.mock.calls[0][1];
      expect(rpcParams.p_display_name).toBeNull();
      expect(rpcParams.p_encryption_version).toBe(1);
      expect(typeof rpcParams.p_encryption_version).toBe('number');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-75: RPC 23505 → 409
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-75: RPC error 23505 → 409 phone_number_already_connected', () => {
    it('retorna 409 sem expor owner/SQL/message', async () => {
      setupHappyPath();
      mockSvc.rpc.mockResolvedValue({
        data:  null,
        error: { code: '23505', message: 'duplicate key — SECRET_SQL_CANARY', details: 'idx_mwi_phone_number_id' },
      });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(409);
      expect(res._body.error).toBe('phone_number_already_connected');
      const bodyStr = JSON.stringify(res._body);
      expect(bodyStr).not.toContain('SECRET_SQL_CANARY');
      expect(bodyStr).not.toContain('duplicate key');
      expect(bodyStr).not.toContain('idx_mwi');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-76: RPC erro inesperado → 500 sem detalhes
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-76: RPC erro inesperado → 500 internal_error sem SQL/message', () => {
    it('não expõe message/details/hint da RPC', async () => {
      setupHappyPath();
      mockSvc.rpc.mockResolvedValue({
        data:  null,
        error: { code: 'XX000', message: 'sensitive detail — CANARY', hint: 'check table' },
      });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(500);
      expect(res._body.error).toBe('internal_error');
      const bodyStr = JSON.stringify(res._body);
      expect(bodyStr).not.toContain('CANARY');
      expect(bodyStr).not.toContain('sensitive detail');
      expect(bodyStr).not.toContain('check table');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-77 / T-78: RPC data null / empty
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-77: RPC data null → 500 internal_error', () => {
    it('retorna 500 quando data é null', async () => {
      setupHappyPath();
      mockSvc.rpc.mockResolvedValue({ data: null, error: null });

      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(500);
      expect(res._body.error).toBe('internal_error');
    });
  });

  describe('T-78: RPC data [] → 500 internal_error', () => {
    it('retorna 500 quando data é array vazio', async () => {
      setupHappyPath();
      mockSvc.rpc.mockResolvedValue({ data: [], error: null });

      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(500);
      expect(res._body.error).toBe('internal_error');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-79 / T-80: Success response
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-79: Sucesso: response body contém exatamente os campos da instância', () => {
    it('body == { instance: { id, phone_number_id, waba_id, phone_number, verified_name, status } }', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._body).toEqual({
        instance: {
          id:              FAKE_INSTANCE_ID,
          phone_number_id: FAKE_PHONE_ID,
          waba_id:         FAKE_WABA_ID,
          phone_number:    FAKE_PHONE_NUMBER,
          verified_name:   FAKE_VERIFIED_NAME,
          status:          'connected',
        },
      });
    });
  });

  describe('T-80: Sucesso: campos sensíveis AUSENTES do response', () => {
    it('nenhum secret, token, company_id, connected_by ou encryption_version no response', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq(), res);

      const body = res._body;
      expect(body).not.toHaveProperty('accessToken');
      expect(body).not.toHaveProperty('access_token');
      expect(body).not.toHaveProperty('access_token_enc');
      expect(body).not.toHaveProperty('ciphertext');
      expect(body).not.toHaveProperty('company_id');
      expect(body).not.toHaveProperty('connected_by');
      expect(body).not.toHaveProperty('encryption_version');
      const inst = body.instance;
      expect(inst).not.toHaveProperty('connected_by');
      expect(inst).not.toHaveProperty('company_id');
      expect(inst).not.toHaveProperty('access_token_enc');
      expect(inst).not.toHaveProperty('encryption_version');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-81: verified_name null preservado
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-81: verified_name null preservado como null no response', () => {
    it('retorna verified_name: null quando RPC retorna null', async () => {
      setupHappyPath();
      mockSvc.rpc.mockResolvedValue({
        data:  [{ ...FAKE_RPC_ROW, verified_name: null }],
        error: null,
      });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(200);
      expect(res._body.instance.verified_name).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-82: Ordem de execução via call tracking
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-82: Ordem: auth → claim → guard → exchange → list → crypto → rpc', () => {
    it('respeita a ordem obrigatória do fluxo completo', async () => {
      const order = [];

      mockSvc.auth.getUser = vi.fn().mockImplementation(async () => {
        order.push('auth');
        return { data: { user: { id: FAKE_USER_ID } }, error: null };
      });

      const claimChain = {
        update:     vi.fn().mockReturnThis(),
        eq:         vi.fn().mockReturnThis(),
        is:         vi.fn().mockReturnThis(),
        gt:         vi.fn().mockReturnThis(),
        select:     vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          order.push('claim');
          return { data: { company_id: FAKE_COMPANY_ID }, error: null };
        }),
      };
      mockSvc.from = vi.fn().mockReturnValue(claimChain);

      mockValidateMetaCaller.mockImplementation(async () => {
        order.push('guard');
        return { ok: true, userId: FAKE_USER_ID, role: 'admin', accessPath: 'direct' };
      });

      mockExchangeCodeForToken.mockImplementation(async () => {
        order.push('exchange');
        return { accessToken: FAKE_ACCESS_TOKEN };
      });

      mockListWabaPhoneNumbers.mockImplementation(async () => {
        order.push('list');
        return [PHONE_A];
      });

      mockEncryptMetaToken.mockImplementation(() => {
        order.push('crypto');
        return FAKE_CIPHERTEXT;
      });

      mockSvc.rpc = vi.fn().mockImplementation(async () => {
        order.push('rpc');
        return { data: [FAKE_RPC_ROW], error: null };
      });

      await handler(makeReq(), makeRes());

      expect(order).toEqual(['auth', 'claim', 'guard', 'exchange', 'list', 'crypto', 'rpc']);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-83: Replay lógico
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-83: Replay lógico — 1ª → 200, 2ª com mesmo state → 400', () => {
    it('state consumido na 1ª chamada impede 2ª', async () => {
      // 1ª chamada — claim retorna row
      setupAuthOk();
      mockSvc.from = vi.fn().mockReturnValue(makeClaimChain({ company_id: FAKE_COMPANY_ID }));
      setupGuardOk();
      setupGraphOk();
      setupEncryptOk();
      setupRpcOk();

      const res1 = makeRes();
      await handler(makeReq(), res1);
      expect(res1._status).toBe(200);

      // 2ª chamada — claim retorna null (state consumido/expirado)
      vi.clearAllMocks();
      setupAuthOk();
      mockSvc.from = vi.fn().mockReturnValue(makeClaimChain(null, null));

      const res2 = makeRes();
      await handler(makeReq(), res2);
      expect(res2._status).toBe(400);
      expect(res2._body.error).toBe('invalid_or_expired_state');
      expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-84: State de outro usuário → mesmo erro público (anti-oracle)
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-84: State de outro user → 400 invalid_or_expired_state (anti-oracle)', () => {
    it('erro indistinguível de state inexistente — sem oracle de ownership', async () => {
      // Autenticamos como "attacker" mas o claim retorna null
      // (simulando que user_id no state pertence a outra pessoa)
      setupAuthOk('attacker-000-0000-0000-000000000000');
      mockSvc.from = vi.fn().mockReturnValue(makeClaimChain(null, null));

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_or_expired_state');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-85 a T-88: Zero leak — valores canário não aparecem no response
  // ──────────────────────────────────────────────────────────────────────────
  describe('Zero leak — canários não aparecem no response em nenhum cenário de erro', () => {
    it('T-85: Graph exchange failure não expõe canário', async () => {
      setupAuthOk();
      setupClaimOk();
      setupGuardOk();
      const err = new Error('SECRET_CODE_CANARY: code rejected');
      err.code = 'code_exchange_failed';
      mockExchangeCodeForToken.mockRejectedValue(err);

      const res = makeRes();
      await handler(makeReq(), res);

      expect(JSON.stringify(res._body)).not.toContain('SECRET_CODE_CANARY');
    });

    it('T-86: crypto failure não expõe canário', async () => {
      setupAuthOk();
      setupClaimOk();
      setupGuardOk();
      setupGraphOk();
      mockEncryptMetaToken.mockImplementation(() => {
        throw new Error('SECRET_CIPHERTEXT_CANARY: key config error');
      });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(JSON.stringify(res._body)).not.toContain('SECRET_CIPHERTEXT_CANARY');
    });

    it('T-87: RPC failure não expõe canário', async () => {
      setupHappyPath();
      mockSvc.rpc.mockResolvedValue({
        data:  null,
        error: { code: 'XX000', message: 'SECRET_SQL_CANARY internal detail' },
      });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(JSON.stringify(res._body)).not.toContain('SECRET_SQL_CANARY');
    });

    it('T-88: 23505 não expõe owner/canário do número', async () => {
      setupHappyPath();
      mockSvc.rpc.mockResolvedValue({
        data:  null,
        error: {
          code:    '23505',
          message: 'SECRET_TOKEN_CANARY company_id=evil-company',
          details: 'Key (phone_number_id)=(987654321) already exists',
        },
      });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(409);
      const bodyStr = JSON.stringify(res._body);
      expect(bodyStr).not.toContain('SECRET_TOKEN_CANARY');
      expect(bodyStr).not.toContain('company_id=evil-company');
      expect(bodyStr).not.toContain('already exists');
    });
  });

  // ============================================================================
  // F2 — WABA Discovery path
  // CONTRACT_TEST_REPLACED: T-27 → F2-T2
  // ============================================================================

  describe('F2 — caminho discovery (waba_id ausente)', () => {

    // ── F2-T1: Normal path não chama discoverAuthorizedWabas ─────────────────
    describe('F2-T1: waba_id presente → discoverAuthorizedWabas NÃO chamado → 200', () => {
      it('usa caminho normal sem acionar discovery', async () => {
        setupHappyPath(); // DEFAULT_BODY com waba_id
        const res = makeRes();
        await handler(makeReq(), res); // makeReq usa DEFAULT_BODY por padrão

        expect(res._status).toBe(200);
        expect(mockDiscoverAuthorizedWabas).not.toHaveBeenCalled();
        expect(mockListWabaPhoneNumbers).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, FAKE_WABA_ID);
      });
    });

    // ── F2-T2: Discovery 1 WABA → 200 (substitui T-27) ────────────────────────
    describe('F2-T2: waba_id ausente → discovery 1 WABA → 200', () => {
      it('troca code, descobre WABA, lista números e persiste', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID]);
        mockListWabaPhoneNumbers.mockResolvedValue([PHONE_A]);
        setupEncryptOk();
        setupRpcOk();

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(200);
        // Discovery chamado com accessToken correto
        expect(mockDiscoverAuthorizedWabas).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN);
        // listWabaPhoneNumbers chamado com WABA descoberta
        expect(mockListWabaPhoneNumbers).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, FAKE_WABA_ID);
        // RPC recebe resolvedWabaId (descoberto), não valor do body
        const rpcParams = mockSvc.rpc.mock.calls[0][1];
        expect(rpcParams.p_waba_id).toBe(FAKE_WABA_ID);
        expect(rpcParams.p_company_id).toBe(FAKE_COMPANY_ID); // vem do state
      });
    });

    // ── F2-T3: Discovery 0 WABAs → 422 no_waba_authorized ─────────────────────
    describe('F2-T3: discovery retorna [] → 422 no_waba_authorized', () => {
      it('retorna 422 sem chamar listWabaPhoneNumbers/crypto/RPC e sem leak', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([]);

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(422);
        expect(res._body.error).toBe('no_waba_authorized');
        expect(mockListWabaPhoneNumbers).not.toHaveBeenCalled();
        expect(mockEncryptMetaToken).not.toHaveBeenCalled();
        expect(mockSvc.rpc).not.toHaveBeenCalled();
        // WABA ID não exposto na resposta
        expect(JSON.stringify(res._body)).not.toContain(FAKE_WABA_ID);
      });
    });

    // ── F2-T4 / B4: Discovery >1 WABAs ambas acessíveis → 200 selection_required ─
    // Design alterado: ambiguous_waba deixou de ser erro terminal.
    // Backend gera continuation token AEAD e retorna seleção ao usuário.
    describe('F2-T4 / B4: discovery 2 WABAs ambas acessíveis → 200 selection_required', () => {
      it('B4: retorna 200 { status: selection_required } quando ambas WABAs acessíveis', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        // Cada WABA retorna um phone distinto (IDs e display diferentes) → Case D
        mockListWabaPhoneNumbers.mockImplementation((_tok, wabaId) => {
          if (wabaId === FAKE_WABA_ID) return Promise.resolve([PHONE_A]);
          return Promise.resolve([PHONE_B]);
        });
        setupEncryptOk();
        setupSelectionEncryptOk();

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(200);
        expect(res._body.status).toBe('selection_required');
        expect(res._body.continuation_token).toBe(FAKE_CONTINUATION_TOKEN);
        // listWabaPhoneNumbers chamado para ambas as WABAs (discriminação)
        expect(mockListWabaPhoneNumbers).toHaveBeenCalledTimes(2);
        // encryptMetaToken chamado para embutir access token no continuation
        expect(mockEncryptMetaToken).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN);
        // encryptSelectionPayload chamado com payload que inclui uid, cid e opts
        expect(mockEncryptSelectionPayload).toHaveBeenCalledTimes(1);
        const selPayload = mockEncryptSelectionPayload.mock.calls[0][0];
        expect(selPayload.v).toBe(1);
        expect(selPayload.uid).toBe(FAKE_USER_ID);
        expect(selPayload.cid).toBe(FAKE_COMPANY_ID);
        expect(selPayload.enc).toBe(FAKE_CIPHERTEXT);
        expect(Array.isArray(selPayload.opts)).toBe(true);
        // RPC NÃO chamada — nenhuma instance criada
        expect(mockSvc.rpc).not.toHaveBeenCalled();
      });

      it('B5: options públicas contêm somente index, label e name', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        mockListWabaPhoneNumbers.mockImplementation((_tok, wabaId) => {
          if (wabaId === FAKE_WABA_ID) return Promise.resolve([PHONE_A]);
          return Promise.resolve([PHONE_B]);
        });
        setupEncryptOk();
        setupSelectionEncryptOk();

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(200);
        const options = res._body.options;
        expect(Array.isArray(options)).toBe(true);
        expect(options.length).toBeGreaterThan(0);
        for (const opt of options) {
          // Somente estes três campos
          expect(Object.keys(opt).sort()).toEqual(['index', 'label', 'name'].sort());
          expect(typeof opt.index).toBe('number');
        }
      });

      it('B6: response não expõe waba_id, phone_number_id, ciphertext, accessToken', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        mockListWabaPhoneNumbers.mockImplementation((_tok, wabaId) => {
          if (wabaId === FAKE_WABA_ID) return Promise.resolve([PHONE_A]);
          return Promise.resolve([PHONE_B]);
        });
        setupEncryptOk();
        setupSelectionEncryptOk();

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        const bodyStr = JSON.stringify(res._body);
        expect(bodyStr).not.toContain(FAKE_WABA_ID);
        expect(bodyStr).not.toContain(FAKE_WABA_ID_2);
        expect(bodyStr).not.toContain(FAKE_PHONE_ID);
        expect(bodyStr).not.toContain(FAKE_ACCESS_TOKEN);
        // O continuation_token é o valor retornado pelo mock (opaco)
        expect(bodyStr).toContain(FAKE_CONTINUATION_TOKEN);
        // Mas o token em si não deve conter IDs em plaintext (opaco por design AEAD)
      });

      it('B7: opções são ordenadas deterministicamente (wabaId asc, phoneId asc)', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        // FAKE_WABA_ID = '123456789' < FAKE_WABA_ID_2 = '999888777666555'
        setupDiscoveryOk([FAKE_WABA_ID_2, FAKE_WABA_ID]); // ordem invertida intencional
        // Phones distintos por WABA (Case D) — WABA_1→PHONE_A, WABA_2→PHONE_B
        mockListWabaPhoneNumbers.mockImplementation((_tok, wabaId) => {
          if (wabaId === FAKE_WABA_ID) return Promise.resolve([PHONE_A]);
          return Promise.resolve([PHONE_B]);
        });
        setupEncryptOk();
        setupSelectionEncryptOk();

        await handler(makeReq({ body: DISCOVERY_BODY }), makeRes());

        const selPayload = mockEncryptSelectionPayload.mock.calls[0][0];
        // FAKE_WABA_ID ('123456789') deve vir antes de FAKE_WABA_ID_2 ('999888777666555')
        expect(selPayload.opts[0].w).toBe(FAKE_WABA_ID);
        expect(selPayload.opts[1].w).toBe(FAKE_WABA_ID_2);
      });

      it('B8: WABA_1 e WABA_2 retornam o mesmo phone_number_id (Case B) → 422 ambiguous_phone_ownership', async () => {
        // B8 ATUALIZADO — S7.1: antes documentava 3 opts como comportamento esperado,
        // mas o cenário descrito é Case B: mesmo phone_number_id (PHONE_A.id) em duas
        // WABAs distintas → ambiguous_phone_ownership fail-closed.
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        // WABA_1 → [PHONE_A, PHONE_B], WABA_2 → [PHONE_A]
        // PHONE_A.id aparece em duas WABAs distintas → Case B
        mockListWabaPhoneNumbers
          .mockImplementation((_tok, wabaId) => {
            if (wabaId === FAKE_WABA_ID) return Promise.resolve([PHONE_A, PHONE_B]);
            return Promise.resolve([PHONE_A]);
          });

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(422);
        expect(res._body.error).toBe('ambiguous_phone_ownership');
        // encryptMetaToken NÃO chamado — conflito detectado antes da crypto
        expect(mockEncryptMetaToken).not.toHaveBeenCalled();
        expect(mockEncryptSelectionPayload).not.toHaveBeenCalled();
        expect(mockSvc.rpc).not.toHaveBeenCalled();
      });

      it('B9: falha ao gerar continuation token (encryptSelectionPayload lança) → 500', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        // Phones distintos por WABA (Case D) para atingir a etapa de crypto
        mockListWabaPhoneNumbers.mockImplementation((_tok, wabaId) => {
          if (wabaId === FAKE_WABA_ID) return Promise.resolve([PHONE_A]);
          return Promise.resolve([PHONE_B]);
        });
        setupEncryptOk();
        mockEncryptSelectionPayload.mockImplementation(() => { throw new Error('crypto fail'); });

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(500);
        expect(res._body.error).toBe('internal_error');
        expect(mockSvc.rpc).not.toHaveBeenCalled();
      });

      it('B10: normal path (waba_id no body) NÃO gera continuation token', async () => {
        setupHappyPath();
        const res = makeRes();
        await handler(makeReq(), res); // DEFAULT_BODY tem waba_id

        expect(res._status).toBe(200);
        expect(res._body.instance).toBeDefined();
        expect(res._body.status).toBeUndefined();
        expect(res._body.continuation_token).toBeUndefined();
        expect(mockEncryptSelectionPayload).not.toHaveBeenCalled();
      });

      it('discovery 2 WABAs, nenhuma com phones → 422 no_waba_authorized', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        // Ambas retornam lista vazia → nenhuma acessível
        mockListWabaPhoneNumbers.mockResolvedValue([]);

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(422);
        expect(res._body.error).toBe('no_waba_authorized');
        expect(mockEncryptMetaToken).not.toHaveBeenCalled();
        expect(mockEncryptSelectionPayload).not.toHaveBeenCalled();
        expect(mockSvc.rpc).not.toHaveBeenCalled();
      });
    });

    // ── S7.1: Candidate identity validation (fail-closed) ────────────────────
    describe('S7.1: Candidate identity validation', () => {

      // ── T2: Case B — mesmo phone_number_id em WABAs distintas ───────────────
      it('T2: Case B — mesmo phone_number_id em WABAs distintas → 422 ambiguous_phone_ownership', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        // Ambas as WABAs retornam exatamente PHONE_A (mesmo phone_number_id)
        mockListWabaPhoneNumbers.mockResolvedValue([PHONE_A]);

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(422);
        expect(res._body.error).toBe('ambiguous_phone_ownership');
      });

      // ── T3: Case C — IDs distintos, representação pública idêntica ──────────
      it('T3: Case C — phone_number_ids diferentes, mesmo display+name → 422 ambiguous_phone_display', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        // WABA_1 → PHONE_A; WABA_2 → PHONE_C (id distinto, mesmo display+name)
        mockListWabaPhoneNumbers
          .mockImplementation((_tok, wabaId) => {
            if (wabaId === FAKE_WABA_ID) return Promise.resolve([PHONE_A]);
            return Promise.resolve([PHONE_C]);
          });

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(422);
        expect(res._body.error).toBe('ambiguous_phone_display');
      });

      // ── T4: Case D — phone_number_ids e displays distintos → selection_required
      it('T4: Case D — candidatos com IDs e display distintos → 200 selection_required com 2 opções', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        // WABA_1 → PHONE_A; WABA_2 → PHONE_B (id E display distintos)
        mockListWabaPhoneNumbers
          .mockImplementation((_tok, wabaId) => {
            if (wabaId === FAKE_WABA_ID) return Promise.resolve([PHONE_A]);
            return Promise.resolve([PHONE_B]);
          });
        setupEncryptOk();
        setupSelectionEncryptOk();

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(200);
        expect(res._body.status).toBe('selection_required');
        expect(res._body.options).toHaveLength(2);
        expect(res._body.continuation_token).toBe(FAKE_CONTINUATION_TOKEN);
      });

      // ── T5: Case B não chama crypto ──────────────────────────────────────────
      it('T5: Case B — encryptMetaToken e encryptSelectionPayload NÃO chamados', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        mockListWabaPhoneNumbers.mockResolvedValue([PHONE_A]);

        await handler(makeReq({ body: DISCOVERY_BODY }), makeRes());

        expect(mockEncryptMetaToken).not.toHaveBeenCalled();
        expect(mockEncryptSelectionPayload).not.toHaveBeenCalled();
      });

      // ── T6: Case B não chama RPC ──────────────────────────────────────────────
      it('T6: Case B — RPC NÃO chamado', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        mockListWabaPhoneNumbers.mockResolvedValue([PHONE_A]);

        await handler(makeReq({ body: DISCOVERY_BODY }), makeRes());

        expect(mockSvc.rpc).not.toHaveBeenCalled();
      });

      // ── T7–T9: Case B response não vaza IDs/número ────────────────────────────
      it('T7-T9: Case B response não expõe WABA IDs, phone_number_id nem número', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        mockListWabaPhoneNumbers.mockResolvedValue([PHONE_A]);

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        const bodyStr = JSON.stringify(res._body);
        expect(bodyStr).not.toContain(FAKE_WABA_ID);      // T7
        expect(bodyStr).not.toContain(FAKE_WABA_ID_2);    // T7
        expect(bodyStr).not.toContain(FAKE_PHONE_ID);     // T8
        expect(bodyStr).not.toContain(FAKE_PHONE_NUMBER); // T9
      });

      // ── T10: FINISH normal preservado ─────────────────────────────────────────
      it('T10: FINISH path (waba_id no body) não é afetado pelo S7.1', async () => {
        setupHappyPath();
        const res = makeRes();
        await handler(makeReq(), res); // DEFAULT_BODY tem waba_id

        expect(res._status).toBe(200);
        expect(res._body.instance).toBeDefined();
        expect(res._body.status).toBeUndefined();
        expect(res._body.continuation_token).toBeUndefined();
        expect(mockEncryptSelectionPayload).not.toHaveBeenCalled();
      });

      // ── T11: Case D discovery preservado ──────────────────────────────────────
      it('T11: Case D com 2 candidatos distinguíveis → selection_required preservado', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        mockListWabaPhoneNumbers
          .mockImplementation((_tok, wabaId) => {
            if (wabaId === FAKE_WABA_ID) return Promise.resolve([PHONE_A]);
            return Promise.resolve([PHONE_B]);
          });
        setupEncryptOk();
        setupSelectionEncryptOk();

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(200);
        expect(res._body.status).toBe('selection_required');
        // continuation_token presente e opaco
        expect(typeof res._body.continuation_token).toBe('string');
        expect(res._body.continuation_token.length).toBeGreaterThan(0);
        // RPC não chamada — nenhuma instância criada
        expect(mockSvc.rpc).not.toHaveBeenCalled();
      });

      // ── T12: Case C não chama crypto nem RPC ─────────────────────────────────
      it('T12: Case C — encryptMetaToken, encryptSelectionPayload e RPC NÃO chamados', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        mockListWabaPhoneNumbers
          .mockImplementation((_tok, wabaId) => {
            if (wabaId === FAKE_WABA_ID) return Promise.resolve([PHONE_A]);
            return Promise.resolve([PHONE_C]);
          });

        await handler(makeReq({ body: DISCOVERY_BODY }), makeRes());

        expect(mockEncryptMetaToken).not.toHaveBeenCalled();
        expect(mockEncryptSelectionPayload).not.toHaveBeenCalled();
        expect(mockSvc.rpc).not.toHaveBeenCalled();
      });

      // ── T13: Case C response não vaza IDs/número/name ────────────────────────
      it('T13: Case C response não expõe WABA IDs, phone_number_ids, número nem verifiedName', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        mockListWabaPhoneNumbers
          .mockImplementation((_tok, wabaId) => {
            if (wabaId === FAKE_WABA_ID) return Promise.resolve([PHONE_A]);
            return Promise.resolve([PHONE_C]);
          });

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        const bodyStr = JSON.stringify(res._body);
        expect(bodyStr).not.toContain(FAKE_WABA_ID);
        expect(bodyStr).not.toContain(FAKE_WABA_ID_2);
        expect(bodyStr).not.toContain(FAKE_PHONE_ID);
        expect(bodyStr).not.toContain(PHONE_C.id);
        expect(bodyStr).not.toContain(FAKE_PHONE_NUMBER);
        expect(bodyStr).not.toContain(FAKE_VERIFIED_NAME);
      });

      // ── T14: logs de conflito não contêm IDs/número/name ─────────────────────
      it('T14: logs de conflito (candidate_conflict_result) contêm somente safeErrorCategory — sem IDs', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);
        // Case B para exercitar o log de conflito
        mockListWabaPhoneNumbers.mockResolvedValue([PHONE_A]);

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
          await handler(makeReq({ body: DISCOVERY_BODY }), makeRes());

          // Filtrar apenas a linha de log do evento candidate_conflict_result
          const conflictLogCall = logSpy.mock.calls.find(
            (args) => typeof args[0] === 'string' && args[0].includes('candidate_conflict_result'),
          );
          expect(conflictLogCall).toBeDefined();

          const logContent = conflictLogCall[0];
          // Contém somente categoria segura fechada
          expect(logContent).toContain('cross_waba_same_phone');
          // Não expõe IDs técnicos nem números
          expect(logContent).not.toContain(FAKE_WABA_ID);
          expect(logContent).not.toContain(FAKE_WABA_ID_2);
          expect(logContent).not.toContain(FAKE_PHONE_ID);
          expect(logContent).not.toContain(FAKE_PHONE_NUMBER);
          expect(logContent).not.toContain(FAKE_VERIFIED_NAME);
        } finally {
          logSpy.mockRestore();
        }
      });
    }); // fim S7.1

    // ── F2-T16: Discovery 2 WABAs, 1 acessível → discriminação → 200 ──────────
    describe('F2-T16: discovery 2 WABAs, apenas 1 com phones acessíveis → 200', () => {
      it('discrimina pela acessibilidade de phones e persiste usando a WABA correta', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);

        // WABA_ID_2 retorna phones (inacessível via graph_waba_inaccessible),
        // FAKE_WABA_ID retorna [PHONE_A] → discriminador seleciona FAKE_WABA_ID.
        mockListWabaPhoneNumbers
          .mockImplementation((_token, wabaId) => {
            if (wabaId === FAKE_WABA_ID_2) {
              return Promise.reject(makeGraphError('graph_waba_inaccessible'));
            }
            return Promise.resolve([PHONE_A]);
          });

        setupEncryptOk();
        setupRpcOk();

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(200);
        // Deve ter tentado ambas as WABAs (discriminação)
        expect(mockListWabaPhoneNumbers).toHaveBeenCalledTimes(2);
        // RPC usa a WABA correta (a acessível)
        const rpcParams = mockSvc.rpc.mock.calls[0][1];
        expect(rpcParams.p_waba_id).toBe(FAKE_WABA_ID);
        expect(rpcParams.p_company_id).toBe(FAKE_COMPANY_ID);
      });

      it('WABA acessível com erro de rede no probe é ignorada (fail-safe)', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);

        // Uma WABA com network error (rejeitada), outra com phones → seleção correta
        mockListWabaPhoneNumbers
          .mockImplementation((_token, wabaId) => {
            if (wabaId === FAKE_WABA_ID_2) {
              return Promise.reject(makeGraphError('graph_network_error'));
            }
            return Promise.resolve([PHONE_A]);
          });

        setupEncryptOk();
        setupRpcOk();

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(200);
        const rpcParams = mockSvc.rpc.mock.calls[0][1];
        expect(rpcParams.p_waba_id).toBe(FAKE_WABA_ID);
      });
    });

    // ── F2-T5: Discovery throws Graph error → 500 sem leak ────────────────────
    describe('F2-T5: discoverAuthorizedWabas throws → 500 internal_error sem leak', () => {
      it('mapeia graph_debug_token_failed para 500 sem expor token', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        mockDiscoverAuthorizedWabas.mockRejectedValue(makeGraphError('graph_debug_token_failed'));

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(500);
        expect(res._body.error).toBe('internal_error');
        expect(mockListWabaPhoneNumbers).not.toHaveBeenCalled();
        expect(mockEncryptMetaToken).not.toHaveBeenCalled();
        expect(mockSvc.rpc).not.toHaveBeenCalled();
        // Sem leak de access token
        expect(JSON.stringify(res._body)).not.toContain(FAKE_ACCESS_TOKEN);
      });

      it('graph_timeout em discovery → 500 internal_error', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        mockDiscoverAuthorizedWabas.mockRejectedValue(makeGraphError('graph_timeout'));

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(500);
        expect(res._body.error).toBe('internal_error');
      });
    });

    // ── F2-T6: waba_id presente inválido → 400 (discover não chamado) ─────────
    describe('F2-T6: waba_id presente porém inválido → 400, discover não chamado', () => {
      it('rejeita na validação de body antes de qualquer Graph call', async () => {
        setupAuthOk();

        const res = makeRes();
        await handler(
          makeReq({ body: { state: FAKE_STATE, code: FAKE_CODE, waba_id: 'abc-invalid' } }),
          res,
        );

        expect(res._status).toBe(400);
        expect(res._body.error).toBe('invalid_request');
        expect(mockDiscoverAuthorizedWabas).not.toHaveBeenCalled();
        expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
      });

      it('waba_id number JS → 400 (regressão T-28 explícita)', async () => {
        setupAuthOk();
        const res = makeRes();
        await handler(
          makeReq({ body: { state: FAKE_STATE, code: FAKE_CODE, waba_id: 123456789 } }),
          res,
        );
        expect(res._status).toBe(400);
        expect(res._body.error).toBe('invalid_request');
        expect(mockDiscoverAuthorizedWabas).not.toHaveBeenCalled();
      });
    });

    // ── F2-T7: company_id + DISCOVERY_BODY → 400 (discover não chamado) ───────
    describe('F2-T7: company_id presente com body sem waba_id → 400, discover não chamado', () => {
      it('rejeita company_id antes de qualquer operação de banco ou Graph', async () => {
        setupAuthOk();
        const mockFrom = vi.fn();
        mockSvc.from = mockFrom;

        const res = makeRes();
        await handler(
          makeReq({ body: { company_id: FAKE_COMPANY_ID, ...DISCOVERY_BODY } }),
          res,
        );

        expect(res._status).toBe(400);
        expect(res._body.error).toBe('invalid_request');
        expect(mockFrom).not.toHaveBeenCalled();
        expect(mockDiscoverAuthorizedWabas).not.toHaveBeenCalled();
        expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
      });
    });

    // ── F2-T8: Discovery + phone_number_id pertencente → 200 ──────────────────
    describe('F2-T8: discovery + phone_number_id pertence à WABA descoberta → 200', () => {
      it('seleciona o número explicitamente e persiste com WABA descoberta', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID]);
        mockListWabaPhoneNumbers.mockResolvedValue([PHONE_A, PHONE_B]);
        setupEncryptOk();
        setupRpcOk();

        const res = makeRes();
        await handler(
          makeReq({ body: { ...DISCOVERY_BODY, phone_number_id: PHONE_B.id } }),
          res,
        );

        expect(res._status).toBe(200);
        const rpcParams = mockSvc.rpc.mock.calls[0][1];
        expect(rpcParams.p_waba_id).toBe(FAKE_WABA_ID); // WABA descoberta, não do body
        expect(rpcParams.p_phone_number_id).toBe(PHONE_B.id);
        expect(rpcParams.p_phone_number).toBe(PHONE_B.displayPhoneNumber);
      });
    });

    // ── F2-T9: Discovery + phone_number_id não pertencente → 422 ──────────────
    describe('F2-T9: discovery + phone_number_id não pertence à WABA → 422', () => {
      it('retorna requested_phone_not_in_waba sem chamar RPC', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID]);
        mockListWabaPhoneNumbers.mockResolvedValue([PHONE_A]);

        const res = makeRes();
        await handler(
          makeReq({ body: { ...DISCOVERY_BODY, phone_number_id: '000111222' } }),
          res,
        );

        expect(res._status).toBe(422);
        expect(res._body.error).toBe('requested_phone_not_in_waba');
        expect(mockSvc.rpc).not.toHaveBeenCalled();
      });
    });

    // ── F2-T10: Discovery + 0 phones → 422 no_phone_numbers ──────────────────
    describe('F2-T10: discovery path + WABA sem números → 422 no_phone_numbers', () => {
      it('retorna 422 sem chamar crypto/RPC', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID]);
        mockListWabaPhoneNumbers.mockResolvedValue([]);

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(422);
        expect(res._body.error).toBe('no_phone_numbers');
        expect(mockEncryptMetaToken).not.toHaveBeenCalled();
        expect(mockSvc.rpc).not.toHaveBeenCalled();
      });
    });

    // ── F2-T11: Discovery + >1 phones sem hint → 422 ambiguous_phone_numbers ──
    describe('F2-T11: discovery + >1 phones sem phone_number_id → 422 ambiguous_phone_numbers', () => {
      it('retorna 422 sem escolher phones[0] como fallback', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID]);
        mockListWabaPhoneNumbers.mockResolvedValue([PHONE_A, PHONE_B]);

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(422);
        expect(res._body.error).toBe('ambiguous_phone_numbers');
        expect(mockSvc.rpc).not.toHaveBeenCalled();
      });
    });

    // ── F2-T12: State inválido → discover NÃO chamado ────────────────────────
    describe('F2-T12: state inválido/expirado → discoverAuthorizedWabas NÃO chamado', () => {
      it('rejeita em 400 antes de chegar à etapa de WABA resolution', async () => {
        setupAuthOk();
        mockSvc.from = vi.fn().mockReturnValue(makeClaimChain(null, null));

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(400);
        expect(res._body.error).toBe('invalid_or_expired_state');
        expect(mockDiscoverAuthorizedWabas).not.toHaveBeenCalled();
        expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
      });
    });

    // ── F2-T13: RBAC fail → discover NÃO chamado ─────────────────────────────
    describe('F2-T13: validateMetaCaller falha → discoverAuthorizedWabas NÃO chamado', () => {
      it('guard bloqueia antes de exchange e discovery', async () => {
        setupAuthOk();
        setupClaimOk();
        mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'forbidden' });

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(403);
        expect(mockDiscoverAuthorizedWabas).not.toHaveBeenCalled();
        expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
        expect(mockListWabaPhoneNumbers).not.toHaveBeenCalled();
      });
    });

    // ── F2-T14: Discovery + RPC 23505 → 409 ──────────────────────────────────
    describe('F2-T14: discovery path + RPC 23505 → 409 phone_number_already_connected', () => {
      it('comportamento de conflito idêntico ao caminho normal', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID]);
        mockListWabaPhoneNumbers.mockResolvedValue([PHONE_A]);
        setupEncryptOk();
        mockSvc.rpc.mockResolvedValue({
          data:  null,
          error: { code: '23505', message: 'duplicate key — CANARY', details: 'idx_mwi_phone' },
        });

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(409);
        expect(res._body.error).toBe('phone_number_already_connected');
        expect(JSON.stringify(res._body)).not.toContain('CANARY');
        expect(JSON.stringify(res._body)).not.toContain('duplicate key');
      });
    });

    // ── F2-T15: Discovery success → 6 campos sanitizados exatos ──────────────
    describe('F2-T15: discovery path success → response com exatamente 6 campos sanitizados', () => {
      it('body contém somente os 6 campos públicos, sem secrets', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID]);
        mockListWabaPhoneNumbers.mockResolvedValue([PHONE_A]);
        setupEncryptOk();
        setupRpcOk();

        const res = makeRes();
        await handler(makeReq({ body: DISCOVERY_BODY }), res);

        expect(res._status).toBe(200);
        expect(res._body).toEqual({
          instance: {
            id:              FAKE_INSTANCE_ID,
            phone_number_id: FAKE_PHONE_ID,
            waba_id:         FAKE_WABA_ID,
            phone_number:    FAKE_PHONE_NUMBER,
            verified_name:   FAKE_VERIFIED_NAME,
            status:          'connected',
          },
        });
        // Campos sensíveis ausentes
        const body = res._body;
        expect(body).not.toHaveProperty('accessToken');
        expect(body).not.toHaveProperty('access_token');
        expect(body).not.toHaveProperty('company_id');
        expect(body.instance).not.toHaveProperty('connected_by');
        expect(body.instance).not.toHaveProperty('access_token_enc');
        expect(body.instance).not.toHaveProperty('encryption_version');
      });
    });

  }); // end F2 describe

  // ============================================================================
  // INSTR — Instrumentação diagnóstica temporária (T1–T12)
  //   Valida: eventos emitidos, allowlist, denylist e isolamento entre requests.
  //   console.log mockado de forma isolada e restaurado após cada teste.
  // ============================================================================

  describe('INSTR — logPhase diagnóstico temporário', () => {
    let consoleSpy;

    beforeEach(() => {
      // Silencia e captura console.log — sem poluir output do runner.
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    /** Parseia calls de console.log → objetos JSON com campo 'event'. */
    function getLogEvents() {
      return consoleSpy.mock.calls
        .map(([arg]) => { try { return JSON.parse(arg); } catch { return null; } })
        .filter(e => e !== null && typeof e.event === 'string');
    }

    // ── INSTR-T1: token exchange success ────────────────────────────────────
    describe('INSTR-T1: token exchange success → token_exchange_result success=true', () => {
      it('loga token_exchange_result com success=true e durationMs numérico', async () => {
        setupHappyPath();
        await handler(makeReq(), makeRes());

        const evt = getLogEvents().find(e => e.event === 'token_exchange_result');
        expect(evt).toBeDefined();
        expect(evt.success).toBe(true);
        expect(typeof evt.durationMs).toBe('number');
        expect(evt.durationMs).toBeGreaterThanOrEqual(0);
      });
    });

    // ── INSTR-T2: token exchange error sanitizado ────────────────────────────
    describe('INSTR-T2: token exchange error → safeErrorCategory sem err.message raw', () => {
      it('loga safeErrorCategory=code_exchange_failed sem expor mensagem interna', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        const err = new Error('CANARY_SECRET_MSG: token exchange internal detail');
        err.code = 'code_exchange_failed';
        mockExchangeCodeForToken.mockRejectedValue(err);

        await handler(makeReq(), makeRes());

        const evt = getLogEvents().find(e => e.event === 'token_exchange_result');
        expect(evt).toBeDefined();
        expect(evt.success).toBe(false);
        expect(evt.safeErrorCategory).toBe('code_exchange_failed');

        const allLogs = consoleSpy.mock.calls.map(([a]) => String(a)).join('');
        expect(allLogs).not.toContain('CANARY_SECRET_MSG');
      });
    });

    // ── INSTR-T3: discovery 1 WABA → count=1, nenhum ID nos logs ────────────
    describe('INSTR-T3: discovery 1 WABA → wabaCount=1, sem WABA ID nos logs', () => {
      it('loga wabaCount=1 e não expõe WABA ID', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID]);
        mockListWabaPhoneNumbers.mockResolvedValue([PHONE_A]);
        setupEncryptOk();
        setupRpcOk();

        await handler(makeReq({ body: DISCOVERY_BODY }), makeRes());

        const evt = getLogEvents().find(e => e.event === 'waba_discovery_result');
        expect(evt).toBeDefined();
        expect(evt.success).toBe(true);
        expect(evt.wabaCount).toBe(1);

        const allLogs = consoleSpy.mock.calls.map(([a]) => String(a)).join('');
        expect(allLogs).not.toContain(FAKE_WABA_ID);
      });
    });

    // ── INSTR-T4: discovery 0 WABAs → count=0 no log ────────────────────────
    describe('INSTR-T4: discovery retorna [] → waba_discovery_result wabaCount=0', () => {
      it('loga wabaCount=0 (sucesso da chamada, não do fluxo)', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([]);

        await handler(makeReq({ body: DISCOVERY_BODY }), makeRes());

        const evt = getLogEvents().find(e => e.event === 'waba_discovery_result');
        expect(evt).toBeDefined();
        expect(evt.success).toBe(true);
        expect(evt.wabaCount).toBe(0);
      });
    });

    // ── INSTR-T5: discovery >1 WABAs → somente count, sem IDs ──────────────
    describe('INSTR-T5: discovery 2 WABAs → wabaCount=2 sem WABA IDs nos logs', () => {
      it('loga wabaCount=2 e não expõe IDs das WABAs', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID, FAKE_WABA_ID_2]);

        await handler(makeReq({ body: DISCOVERY_BODY }), makeRes());

        const evt = getLogEvents().find(e => e.event === 'waba_discovery_result');
        expect(evt).toBeDefined();
        expect(evt.success).toBe(true);
        expect(evt.wabaCount).toBe(2);

        const allLogs = consoleSpy.mock.calls.map(([a]) => String(a)).join('');
        expect(allLogs).not.toContain(FAKE_WABA_ID);
        expect(allLogs).not.toContain(FAKE_WABA_ID_2);
      });
    });

    // ── INSTR-T6: phone list → somente phoneCount, sem IDs/números ──────────
    describe('INSTR-T6: phone list → phoneCount no log, sem phone IDs ou números', () => {
      it('loga phoneCount=1 sem expor phone ID ou número de telefone', async () => {
        setupHappyPath(); // 1 phone (PHONE_A)

        await handler(makeReq(), makeRes());

        const evt = getLogEvents().find(e => e.event === 'phone_list_result');
        expect(evt).toBeDefined();
        expect(evt.success).toBe(true);
        expect(evt.phoneCount).toBe(1);

        const allLogs = consoleSpy.mock.calls.map(([a]) => String(a)).join('');
        expect(allLogs).not.toContain(FAKE_PHONE_ID);
        expect(allLogs).not.toContain(FAKE_PHONE_NUMBER);
        expect(allLogs).not.toContain(FAKE_VERIFIED_NAME);
      });
    });

    // ── INSTR-T7: crypto failure → crypto_error sem secret/token ────────────
    describe('INSTR-T7: encryptMetaToken throws → token_encryption_result crypto_error sem dados sensíveis', () => {
      it('loga crypto_error sem expor token, key ou mensagem raw', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        mockListWabaPhoneNumbers.mockResolvedValue([PHONE_A]);
        mockEncryptMetaToken.mockImplementation(() => {
          throw new Error('META_TOKEN_ENC_KEY_CANARY: chave inválida');
        });

        await handler(makeReq(), makeRes());

        const evt = getLogEvents().find(e => e.event === 'token_encryption_result');
        expect(evt).toBeDefined();
        expect(evt.success).toBe(false);
        expect(evt.safeErrorCategory).toBe('crypto_error');

        const allLogs = consoleSpy.mock.calls.map(([a]) => String(a)).join('');
        expect(allLogs).not.toContain('META_TOKEN_ENC_KEY_CANARY');
        expect(allLogs).not.toContain(FAKE_ACCESS_TOKEN);
      });
    });

    // ── INSTR-T8: RPC failure → rpc_error sem payload/IDs ──────────────────
    describe('INSTR-T8: RPC failure → connection_rpc_result rpc_error sem payload nem IDs', () => {
      it('loga rpc_error sem expor company_id, waba_id, phone_number_id ou message', async () => {
        setupHappyPath();
        mockSvc.rpc.mockResolvedValue({
          data:  null,
          error: { code: 'XX000', message: 'CANARY_RPC_DETAIL internal', details: 'internal' },
        });

        await handler(makeReq(), makeRes());

        const evt = getLogEvents().find(e => e.event === 'connection_rpc_result');
        expect(evt).toBeDefined();
        expect(evt.success).toBe(false);
        expect(evt.safeErrorCategory).toBe('rpc_error');

        const allLogs = consoleSpy.mock.calls.map(([a]) => String(a)).join('');
        expect(allLogs).not.toContain('CANARY_RPC_DETAIL');
        expect(allLogs).not.toContain(FAKE_COMPANY_ID);
        expect(allLogs).not.toContain(FAKE_WABA_ID);
        expect(allLogs).not.toContain(FAKE_PHONE_ID);
      });
    });

    // ── INSTR-T9: fluxo completo → sequência esperada e denylist ausente ────
    describe('INSTR-T9: fluxo completo → eventos em sequência, nenhum dado sensível logado', () => {
      it('emite eventos na ordem correta e não vaza dados do negócio', async () => {
        setupHappyPath(); // normal path
        await handler(makeReq(), makeRes());

        const events    = getLogEvents();
        const eventNames = events.map(e => e.event);

        // Subconjunto ordenado obrigatório (caminho normal — sem discovery).
        const expectedSequence = [
          'request_start',
          'auth_check_result',
          'token_exchange_start',
          'token_exchange_result',
          'phone_list_start',
          'phone_list_result',
          'connection_rpc_start',
          'connection_rpc_result',
        ];
        let lastIdx = -1;
        for (const name of expectedSequence) {
          const idx = eventNames.indexOf(name);
          expect(idx, `evento '${name}' ausente ou fora de ordem`).toBeGreaterThan(lastIdx);
          lastIdx = idx;
        }

        // Denylist: IDs e tokens de negócio não devem aparecer em nenhum log.
        const allLogs = consoleSpy.mock.calls.map(([a]) => String(a)).join('\n');
        const denyItems = [
          FAKE_ACCESS_TOKEN,
          FAKE_CIPHERTEXT,
          FAKE_CODE,
          FAKE_STATE,
          FAKE_PHONE_NUMBER,
          FAKE_VERIFIED_NAME,
          'fake-jwt-token',
        ];
        for (const item of denyItems) {
          expect(allLogs, `denylist violado: '${item}' encontrado nos logs`).not.toContain(item);
        }
      });
    });

    // ── INSTR-T10: correlationId consistente por request, único entre requests
    describe('INSTR-T10: correlationId idêntico em todos os eventos da request, diferente entre requests', () => {
      it('todos os eventos da mesma request compartilham o mesmo correlationId', async () => {
        setupHappyPath();
        await handler(makeReq(), makeRes());

        const events = getLogEvents();
        expect(events.length).toBeGreaterThan(1);
        const uniqueCids = [...new Set(events.map(e => e.correlationId))];
        expect(uniqueCids).toHaveLength(1);
        expect(typeof uniqueCids[0]).toBe('string');
        expect(uniqueCids[0].length).toBeGreaterThan(0);
      });

      it('requests consecutivas têm correlationIds distintos', async () => {
        // Primeira request
        setupHappyPath();
        await handler(makeReq(), makeRes());
        const events1 = getLogEvents();
        const cid1    = events1.find(e => e.event === 'request_start')?.correlationId;

        // Reset: vi.clearAllMocks() limpa estado de todos os mocks (incluindo consoleSpy).
        vi.clearAllMocks();
        setupHappyPath();

        // Segunda request
        await handler(makeReq(), makeRes());
        const events2 = getLogEvents();
        const cid2    = events2.find(e => e.event === 'request_start')?.correlationId;

        expect(cid1).toBeDefined();
        expect(cid2).toBeDefined();
        expect(cid1).not.toBe(cid2);
      });
    });

    // ── INSTR-T11: normal mode → discovery events ausentes; wabaSource=body ─
    describe('INSTR-T11: mode=normal → waba_discovery events ausentes, wabaSource=body', () => {
      it('não emite eventos de discovery; phone_list usa wabaSource=body', async () => {
        setupHappyPath(); // DEFAULT_BODY com waba_id → mode=normal
        await handler(makeReq(), makeRes());

        const events = getLogEvents();

        // Eventos de discovery devem estar completamente ausentes.
        expect(events.find(e => e.event === 'waba_discovery_start')).toBeUndefined();
        expect(events.find(e => e.event === 'waba_discovery_result')).toBeUndefined();

        // request_start deve declarar mode=normal.
        const startEvt = events.find(e => e.event === 'request_start');
        expect(startEvt?.mode).toBe('normal');

        // phone_list_start deve declarar wabaSource=body.
        const listEvt = events.find(e => e.event === 'phone_list_start');
        expect(listEvt?.wabaSource).toBe('body');

        // phone_list_result deve declarar wabaSource=body.
        const listResultEvt = events.find(e => e.event === 'phone_list_result');
        expect(listResultEvt?.wabaSource).toBe('body');
      });
    });

    // ── INSTR-T12: discovery mode → discovery events presentes; wabaSource=discovery
    describe('INSTR-T12: mode=discovery → waba_discovery events presentes, wabaSource=discovery', () => {
      it('emite eventos de discovery; phone_list usa wabaSource=discovery', async () => {
        setupAuthOk();
        setupClaimOk();
        setupGuardOk();
        mockExchangeCodeForToken.mockResolvedValue({ accessToken: FAKE_ACCESS_TOKEN });
        setupDiscoveryOk([FAKE_WABA_ID]);
        mockListWabaPhoneNumbers.mockResolvedValue([PHONE_A]);
        setupEncryptOk();
        setupRpcOk();

        await handler(makeReq({ body: DISCOVERY_BODY }), makeRes());

        const events = getLogEvents();

        // Eventos de discovery devem estar presentes.
        expect(events.find(e => e.event === 'waba_discovery_start')).toBeDefined();
        expect(events.find(e => e.event === 'waba_discovery_result')).toBeDefined();

        // request_start deve declarar mode=discovery.
        const startEvt = events.find(e => e.event === 'request_start');
        expect(startEvt?.mode).toBe('discovery');

        // phone_list_start deve declarar wabaSource=discovery.
        const listEvt = events.find(e => e.event === 'phone_list_start');
        expect(listEvt?.wabaSource).toBe('discovery');

        // phone_list_result deve declarar wabaSource=discovery.
        const listResultEvt = events.find(e => e.event === 'phone_list_result');
        expect(listResultEvt?.wabaSource).toBe('discovery');
      });
    });

  }); // end INSTR describe

}); // end outer describe
