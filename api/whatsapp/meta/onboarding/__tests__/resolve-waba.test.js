// =============================================================================
// resolve-waba.test.js
//
// Testes unitários para api/whatsapp/meta/onboarding/resolve-waba.js
// Todos os testes usam mocks — sem banco, rede, Graph real ou credential real.
//
// COBERTURA (R1–R21):
//   R1   método inválido (GET, PUT, DELETE) → 405
//   R2   JWT ausente/inválido → 401
//   R3   body inválido (campos ausentes, tipos errados) → 400
//   R4   campos proibidos no body → 400 invalid_request
//   R5   continuation_token adulterado → 400 invalid_continuation
//   R6   continuation_token expirado → 400 invalid_continuation
//   R7   uid mismatch → 400 invalid_continuation
//   R8   RBAC negado → 403
//   R9   feature flag negada → 403
//   R10  selected_index negativo → 400 invalid_request
//   R11  selected_index decimal/string → 400 invalid_request
//   R12  selected_index out of bounds → 400 invalid_selection
//   R13  index válido → RPC parâmetros corretos
//   R14  company_id vem de payload.cid (token AEAD), nunca do body
//   R15  connected_by vem do JWT user.id, nunca do body
//   R16  sucesso → shape exato de 6 campos (mesmo que /complete)
//   R17  23505 → 409 phone_number_already_connected
//   R18  RPC erro genérico → 500 internal_error
//   R19  replay mesmo index → 409 (segundo call acerta 23505)
//   R20  indexes diferentes → comportamento stateless documentado (MVP)
//   R21  response não contém secrets/IDs sensíveis
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks — declarados antes dos imports dinâmicos
// =============================================================================

const mockSvc = {
  auth: { getUser: vi.fn() },
  from:  vi.fn(),
  rpc:   vi.fn(),
};
vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

const mockValidateMetaCaller = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  META_CONNECT_ROLES: ['super_admin', 'system_admin', 'partner', 'admin'],
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
}));

const mockDecryptSelectionPayload = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/selectionTokenCrypto.js', () => ({
  decryptSelectionPayload: (...args) => mockDecryptSelectionPayload(...args),
}));

import handler from '../resolve-waba.js';

// =============================================================================
// Fixtures
// =============================================================================

const FAKE_USER_ID       = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_USER_ID_OTHER = 'aaaa0000-0000-0000-0000-000000000099';
const FAKE_COMPANY_ID    = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_INSTANCE_ID   = 'dddd0000-0000-0000-0000-000000000004';
const FAKE_WABA_ID       = '123456789';
const FAKE_WABA_ID_2     = '999888777666555';
const FAKE_PHONE_ID      = '987654321';
const FAKE_PHONE_ID_2    = '111222333';
const FAKE_PHONE_NUMBER  = '+55 11 91234-5678';
const FAKE_VERIFIED_NAME = 'Empresa Fake LTDA';
const FAKE_CIPHERTEXT    = 'v1:FAKECIPHERTEXT==';
const FAKE_TOKEN         = 'v1:FAKE_AEAD_TOKEN==';

const FAKE_RPC_ROW = {
  instance_id:     FAKE_INSTANCE_ID,
  phone_number_id: FAKE_PHONE_ID,
  waba_id:         FAKE_WABA_ID,
  phone_number:    FAKE_PHONE_NUMBER,
  verified_name:   FAKE_VERIFIED_NAME,
  status:          'connected',
};

// Payload decriptado típico (dois candidatos)
const makePayload = (overrides = {}) => ({
  v:    1,
  uid:  FAKE_USER_ID,
  cid:  FAKE_COMPANY_ID,
  exp:  Date.now() + 10 * 60 * 1000,
  opts: [
    { w: FAKE_WABA_ID,   p: FAKE_PHONE_ID,   d: FAKE_PHONE_NUMBER, n: FAKE_VERIFIED_NAME },
    { w: FAKE_WABA_ID_2, p: FAKE_PHONE_ID_2, d: '+55 21 99999-9999', n: 'Empresa B' },
  ],
  enc: FAKE_CIPHERTEXT,
  ...overrides,
});

// =============================================================================
// Factories
// =============================================================================

function makeReq(overrides = {}) {
  return {
    method:  'POST',
    headers: { authorization: `Bearer FAKE_JWT_TOKEN` },
    body:    { continuation_token: FAKE_TOKEN, selected_index: 0 },
    ...overrides,
  };
}

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = (s) => { res._status = s; return res; };
  res.json   = (b) => { res._body   = b; return res; };
  return res;
}

// =============================================================================
// Setup helpers
// =============================================================================

function setupAuthOk(userId = FAKE_USER_ID) {
  mockSvc.auth.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
}

function setupAuthFail() {
  mockSvc.auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error('invalid') });
}

function setupDecryptOk(payloadOverrides = {}) {
  mockDecryptSelectionPayload.mockReturnValue(makePayload(payloadOverrides));
}

function setupDecryptThrow(msg = 'token invalid') {
  mockDecryptSelectionPayload.mockImplementation(() => { throw new Error(msg); });
}

function setupGuardOk() {
  mockValidateMetaCaller.mockResolvedValue({
    ok: true, userId: FAKE_USER_ID, companyId: FAKE_COMPANY_ID, role: 'admin', accessPath: 'direct',
  });
}

function setupGuardFail(status = 403, error = 'Acesso negado') {
  mockValidateMetaCaller.mockResolvedValue({ ok: false, status, error });
}

function setupRpcOk(rowOverrides = {}) {
  const row = { ...FAKE_RPC_ROW, ...rowOverrides };
  mockSvc.rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
  return row;
}

function setupRpcError(code = null, message = 'rpc error') {
  const err = { message, ...(code ? { code } : {}) };
  mockSvc.rpc = vi.fn().mockResolvedValue({ data: null, error: err });
}

function setupHappyPath() {
  setupAuthOk();
  setupDecryptOk();
  setupGuardOk();
  setupRpcOk();
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Testes
// =============================================================================

describe('POST /api/whatsapp/meta/onboarding/resolve-waba', () => {

  // ── R1: Método inválido ────────────────────────────────────────────────────
  describe('R1: método inválido → 405', () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      it(`${method} → 405`, async () => {
        const res = makeRes();
        await handler(makeReq({ method }), res);
        expect(res._status).toBe(405);
        expect(res._body.error).toBe('Method not allowed');
      });
    }
  });

  // ── R2: JWT ausente/inválido → 401 ────────────────────────────────────────
  describe('R2: JWT ausente/inválido → 401', () => {
    it('Authorization ausente → 401', async () => {
      const res = makeRes();
      await handler(makeReq({ headers: {} }), res);
      expect(res._status).toBe(401);
    });

    it('Authorization sem Bearer → 401', async () => {
      const res = makeRes();
      await handler(makeReq({ headers: { authorization: 'Basic abc' } }), res);
      expect(res._status).toBe(401);
    });

    it('Bearer vazio → 401', async () => {
      const res = makeRes();
      await handler(makeReq({ headers: { authorization: 'Bearer ' } }), res);
      expect(res._status).toBe(401);
    });

    it('JWT inválido (getUser retorna null) → 401', async () => {
      setupAuthFail();
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(401);
      expect(res._body.error).toBe('unauthorized');
    });
  });

  // ── R3: Body inválido → 400 ────────────────────────────────────────────────
  describe('R3: body inválido → 400', () => {
    it('continuation_token ausente → 400', async () => {
      setupAuthOk();
      const res = makeRes();
      await handler(makeReq({ body: { selected_index: 0 } }), res);
      expect(res._status).toBe(400);
    });

    it('continuation_token número → 400', async () => {
      setupAuthOk();
      const res = makeRes();
      await handler(makeReq({ body: { continuation_token: 42, selected_index: 0 } }), res);
      expect(res._status).toBe(400);
    });

    it('continuation_token vazio → 400', async () => {
      setupAuthOk();
      const res = makeRes();
      await handler(makeReq({ body: { continuation_token: '   ', selected_index: 0 } }), res);
      expect(res._status).toBe(400);
    });

    it('selected_index ausente → 400', async () => {
      setupAuthOk();
      const res = makeRes();
      await handler(makeReq({ body: { continuation_token: FAKE_TOKEN } }), res);
      expect(res._status).toBe(400);
    });

    it('selected_index undefined → 400', async () => {
      setupAuthOk();
      const res = makeRes();
      await handler(makeReq({ body: { continuation_token: FAKE_TOKEN, selected_index: undefined } }), res);
      expect(res._status).toBe(400);
    });
  });

  // ── R4: Campos proibidos no body → 400 ────────────────────────────────────
  describe('R4: campos proibidos → 400 invalid_request', () => {
    const forbidden = ['company_id', 'user_id', 'waba_id', 'phone_number_id', 'access_token'];

    for (const field of forbidden) {
      it(`${field} no body → 400`, async () => {
        setupAuthOk();
        const res = makeRes();
        const body = { continuation_token: FAKE_TOKEN, selected_index: 0, [field]: 'some-value' };
        await handler(makeReq({ body }), res);
        expect(res._status).toBe(400);
        expect(res._body.error).toBe('invalid_request');
      });
    }
  });

  // ── R5: Token adulterado → 400 invalid_continuation ───────────────────────
  describe('R5: continuation_token adulterado → 400 invalid_continuation', () => {
    it('decryptSelectionPayload lança → 400 invalid_continuation', async () => {
      setupAuthOk();
      setupDecryptThrow('auth tag mismatch');
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_continuation');
    });

    it('erro de adulteração não vaza stack/detalhes', async () => {
      setupAuthOk();
      setupDecryptThrow('auth tag mismatch');
      const res = makeRes();
      await handler(makeReq(), res);
      expect(JSON.stringify(res._body)).not.toContain('auth tag');
      expect(JSON.stringify(res._body)).not.toContain('stack');
    });
  });

  // ── R6: Token expirado → 400 invalid_continuation ─────────────────────────
  describe('R6: continuation_token expirado → 400 invalid_continuation', () => {
    it('decryptSelectionPayload lança "expirado" → 400', async () => {
      setupAuthOk();
      setupDecryptThrow('Token expirado');
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_continuation');
    });
  });

  // ── R7: uid mismatch → 400 invalid_continuation ───────────────────────────
  describe('R7: uid mismatch → 400 invalid_continuation', () => {
    it('token.uid !== user.id → 400 invalid_continuation', async () => {
      setupAuthOk(FAKE_USER_ID_OTHER); // JWT de outro usuário
      setupDecryptOk({ uid: FAKE_USER_ID }); // token de FAKE_USER_ID
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_continuation');
      // RPC não deve ser chamada
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });
  });

  // ── R8: RBAC negado → 403 ─────────────────────────────────────────────────
  describe('R8: RBAC negado → 403', () => {
    it('role insuficiente → 403', async () => {
      setupAuthOk();
      setupDecryptOk();
      setupGuardFail(403, 'Permissão insuficiente para esta operação');
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(403);
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });

    it('membership inativa → 403', async () => {
      setupAuthOk();
      setupDecryptOk();
      setupGuardFail(403, 'Acesso negado a esta empresa');
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(403);
    });
  });

  // ── R9: Feature flag desligada → 403 ──────────────────────────────────────
  describe('R9: feature flag negada → 403', () => {
    it('meta_whatsapp_enabled=false → 403', async () => {
      setupAuthOk();
      setupDecryptOk();
      setupGuardFail(403, 'Meta WhatsApp não habilitado para esta empresa');
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(403);
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });
  });

  // ── R10: selected_index negativo → 400 ────────────────────────────────────
  describe('R10: selected_index negativo → 400 invalid_request', () => {
    it('selected_index = -1 → 400', async () => {
      setupAuthOk();
      const res = makeRes();
      await handler(makeReq({ body: { continuation_token: FAKE_TOKEN, selected_index: -1 } }), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_request');
    });
  });

  // ── R11: selected_index decimal/string → 400 ──────────────────────────────
  describe('R11: selected_index decimal ou string → 400', () => {
    it('selected_index 0.5 → 400', async () => {
      setupAuthOk();
      const res = makeRes();
      await handler(makeReq({ body: { continuation_token: FAKE_TOKEN, selected_index: 0.5 } }), res);
      expect(res._status).toBe(400);
    });

    it('selected_index "0" (string) → 400', async () => {
      setupAuthOk();
      const res = makeRes();
      await handler(makeReq({ body: { continuation_token: FAKE_TOKEN, selected_index: '0' } }), res);
      expect(res._status).toBe(400);
    });

    it('selected_index NaN → 400', async () => {
      setupAuthOk();
      const res = makeRes();
      await handler(makeReq({ body: { continuation_token: FAKE_TOKEN, selected_index: NaN } }), res);
      expect(res._status).toBe(400);
    });
  });

  // ── R12: selected_index out of bounds → 400 invalid_selection ─────────────
  describe('R12: selected_index out of bounds → 400 invalid_selection', () => {
    it('selected_index === opts.length → 400 invalid_selection', async () => {
      setupAuthOk();
      setupDecryptOk(); // 2 opts → válidos: 0, 1
      setupGuardOk();
      const res = makeRes();
      await handler(makeReq({ body: { continuation_token: FAKE_TOKEN, selected_index: 2 } }), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_selection');
    });

    it('selected_index 99 com 2 opts → 400 invalid_selection', async () => {
      setupAuthOk();
      setupDecryptOk();
      setupGuardOk();
      const res = makeRes();
      await handler(makeReq({ body: { continuation_token: FAKE_TOKEN, selected_index: 99 } }), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('invalid_selection');
    });
  });

  // ── R13: index válido → RPC parâmetros corretos ────────────────────────────
  describe('R13: index válido → RPC recebe parâmetros corretos', () => {
    it('index 0 → RPC usa opts[0] com todos os 9 parâmetros', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq({ body: { continuation_token: FAKE_TOKEN, selected_index: 0 } }), res);

      expect(res._status).toBe(200);
      expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
      const [rpcName, rpcParams] = mockSvc.rpc.mock.calls[0];
      expect(rpcName).toBe('rpc_create_meta_whatsapp_connection');
      expect(rpcParams.p_waba_id).toBe(FAKE_WABA_ID);
      expect(rpcParams.p_phone_number_id).toBe(FAKE_PHONE_ID);
      expect(rpcParams.p_phone_number).toBe(FAKE_PHONE_NUMBER);
      expect(rpcParams.p_verified_name).toBe(FAKE_VERIFIED_NAME);
      expect(rpcParams.p_display_name).toBeNull();
      expect(rpcParams.p_access_token_enc).toBe(FAKE_CIPHERTEXT);
      expect(rpcParams.p_encryption_version).toBe(1);
    });

    it('index 1 → RPC usa opts[1]', async () => {
      setupAuthOk();
      setupDecryptOk();
      setupGuardOk();
      const rpcRow2 = { ...FAKE_RPC_ROW, phone_number_id: FAKE_PHONE_ID_2, waba_id: FAKE_WABA_ID_2 };
      mockSvc.rpc = vi.fn().mockResolvedValue({ data: [rpcRow2], error: null });

      const res = makeRes();
      await handler(makeReq({ body: { continuation_token: FAKE_TOKEN, selected_index: 1 } }), res);

      expect(res._status).toBe(200);
      const rpcParams = mockSvc.rpc.mock.calls[0][1];
      expect(rpcParams.p_waba_id).toBe(FAKE_WABA_ID_2);
      expect(rpcParams.p_phone_number_id).toBe(FAKE_PHONE_ID_2);
    });
  });

  // ── R14: company_id do token, nunca do body ────────────────────────────────
  describe('R14: company_id vem de payload.cid, nunca do body', () => {
    it('p_company_id na RPC é payload.cid (não do body)', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq(), res);

      const rpcParams = mockSvc.rpc.mock.calls[0][1];
      expect(rpcParams.p_company_id).toBe(FAKE_COMPANY_ID);
    });

    it('mesmo que body tivesse company_id seria rejeitado antes (R4)', async () => {
      setupAuthOk();
      const res = makeRes();
      await handler(makeReq({
        body: { continuation_token: FAKE_TOKEN, selected_index: 0, company_id: 'injected' },
      }), res);
      expect(res._status).toBe(400);
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });
  });

  // ── R15: connected_by do JWT ──────────────────────────────────────────────
  describe('R15: connected_by vem do JWT user.id, nunca do body', () => {
    it('p_connected_by === user.id do JWT', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq(), res);

      const rpcParams = mockSvc.rpc.mock.calls[0][1];
      expect(rpcParams.p_connected_by).toBe(FAKE_USER_ID);
    });
  });

  // ── R16: sucesso → shape exato de 6 campos ────────────────────────────────
  describe('R16: sucesso → shape público idêntico ao de /complete', () => {
    it('retorna os 6 campos exatos sem dados extras', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(200);
      expect(res._body).toHaveProperty('instance');
      const { instance } = res._body;
      expect(Object.keys(instance).sort()).toEqual(
        ['id', 'phone_number_id', 'waba_id', 'phone_number', 'verified_name', 'status'].sort(),
      );
      expect(instance.id).toBe(FAKE_INSTANCE_ID);
      expect(instance.phone_number_id).toBe(FAKE_PHONE_ID);
      expect(instance.waba_id).toBe(FAKE_WABA_ID);
      expect(instance.phone_number).toBe(FAKE_PHONE_NUMBER);
      expect(instance.verified_name).toBe(FAKE_VERIFIED_NAME);
      expect(instance.status).toBe('connected');
    });

    it('verified_name null → preservado como null', async () => {
      setupAuthOk();
      setupDecryptOk();
      setupGuardOk();
      const rowNull = { ...FAKE_RPC_ROW, verified_name: null };
      mockSvc.rpc = vi.fn().mockResolvedValue({ data: [rowNull], error: null });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._body.instance.verified_name).toBeNull();
    });
  });

  // ── R17: 23505 → 409 ──────────────────────────────────────────────────────
  describe('R17: 23505 → 409 phone_number_already_connected', () => {
    it('unique violation → 409 sem owner/detalhe SQL', async () => {
      setupAuthOk();
      setupDecryptOk();
      setupGuardOk();
      setupRpcError('23505');

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(409);
      expect(res._body.error).toBe('phone_number_already_connected');
      expect(JSON.stringify(res._body)).not.toContain('23505');
    });
  });

  // ── R18: RPC erro genérico → 500 ──────────────────────────────────────────
  describe('R18: RPC erro genérico → 500', () => {
    it('rpc error inesperado → 500 internal_error', async () => {
      setupAuthOk();
      setupDecryptOk();
      setupGuardOk();
      setupRpcError(null, 'connection reset');

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(500);
      expect(res._body.error).toBe('internal_error');
      expect(JSON.stringify(res._body)).not.toContain('connection reset');
    });

    it('rpc data null → 500 internal_error', async () => {
      setupAuthOk();
      setupDecryptOk();
      setupGuardOk();
      mockSvc.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(500);
    });

    it('rpc data [] → 500 internal_error', async () => {
      setupAuthOk();
      setupDecryptOk();
      setupGuardOk();
      mockSvc.rpc = vi.fn().mockResolvedValue({ data: [], error: null });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(500);
    });
  });

  // ── R19: Replay mesmo index → 409 ────────────────────────────────────────
  describe('R19: replay com mesmo index → 409 (DB constraint)', () => {
    it('1ª chamada: 200; 2ª com mesmo token+index: 409', async () => {
      // 1ª chamada
      setupAuthOk();
      setupDecryptOk();
      setupGuardOk();
      setupRpcOk();
      const res1 = makeRes();
      await handler(makeReq(), res1);
      expect(res1._status).toBe(200);

      // 2ª chamada com mesmo token e index — RPC retorna 23505
      vi.clearAllMocks();
      setupAuthOk();
      setupDecryptOk();
      setupGuardOk();
      setupRpcError('23505');
      const res2 = makeRes();
      await handler(makeReq(), res2);
      expect(res2._status).toBe(409);
      expect(res2._body.error).toBe('phone_number_already_connected');
    });
  });

  // ── R20: Indexes diferentes → stateless MVP ───────────────────────────────
  describe('R20: indexes diferentes — comportamento stateless (MVP)', () => {
    // O token stateless não é single-use. Usar index 0 e depois index 1
    // com phone_number_ids distintos pode criar duas instâncias.
    // Isso é uma limitação de produto conhecida e documentada do MVP.
    // True single-use requer migration de tabela de nonce server-side.
    it('índice 0 seguido de índice 1 com phone_ids distintos: ambas chamadas chegam ao RPC', async () => {
      // Chamada com index 0
      setupAuthOk();
      setupDecryptOk();
      setupGuardOk();
      setupRpcOk();
      const res1 = makeRes();
      await handler(makeReq({ body: { continuation_token: FAKE_TOKEN, selected_index: 0 } }), res1);
      expect(res1._status).toBe(200);

      // Chamada com index 1 — phone_id diferente → RPC seria chamado novamente
      // (em produção: pode criar segunda instância se phone_number_id for único no DB)
      vi.clearAllMocks();
      setupAuthOk();
      setupDecryptOk(); // payload tem 2 opts com phone_ids distintos
      setupGuardOk();
      const rpcRow2 = { ...FAKE_RPC_ROW, phone_number_id: FAKE_PHONE_ID_2, waba_id: FAKE_WABA_ID_2 };
      mockSvc.rpc = vi.fn().mockResolvedValue({ data: [rpcRow2], error: null });
      const res2 = makeRes();
      await handler(makeReq({ body: { continuation_token: FAKE_TOKEN, selected_index: 1 } }), res2);

      // Backend não bloqueia — limitação stateless MVP
      expect(res2._status).toBe(200);
      expect(mockSvc.rpc).toHaveBeenCalledTimes(1);
      const rpcParams = mockSvc.rpc.mock.calls[0][1];
      expect(rpcParams.p_waba_id).toBe(FAKE_WABA_ID_2);
      expect(rpcParams.p_phone_number_id).toBe(FAKE_PHONE_ID_2);
    });
  });

  // ── R21: Nenhum segredo/ID sensível em response ───────────────────────────
  describe('R21: response não contém secrets/IDs sensíveis', () => {
    it('sucesso: response body não contém continuation_token', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq(), res);

      const bodyStr = JSON.stringify(res._body);
      expect(bodyStr).not.toContain(FAKE_TOKEN);
      expect(bodyStr).not.toContain(FAKE_CIPHERTEXT);
    });

    it('erro: body não contém detalhes internos (stack, SQL, message)', async () => {
      setupAuthOk();
      setupDecryptOk();
      setupGuardOk();
      setupRpcError(null, 'connection refused to 10.0.0.1:5432');

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(500);
      expect(JSON.stringify(res._body)).not.toContain('10.0.0.1');
      expect(JSON.stringify(res._body)).not.toContain('connection refused');
    });

    it('resolve-waba não emite logs por design (sem logPhase)', async () => {
      // O endpoint não possui chamadas a console.log/warn/error por design —
      // minimiza superfície de vazamento acidental de secrets.
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      setupHappyPath();
      await handler(makeReq(), makeRes());
      expect(logSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });
  });

  // ── Ordem de validação ─────────────────────────────────────────────────────
  describe('Ordem das validações', () => {
    it('JWT validado ANTES de decryptSelectionPayload', async () => {
      // Auth falha → decrypt nunca chamado
      setupAuthFail();
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(401);
      expect(mockDecryptSelectionPayload).not.toHaveBeenCalled();
    });

    it('campos proibidos verificados ANTES do decrypt', async () => {
      setupAuthOk();
      const res = makeRes();
      await handler(makeReq({
        body: { continuation_token: FAKE_TOKEN, selected_index: 0, waba_id: 'injected' },
      }), res);
      expect(res._status).toBe(400);
      expect(mockDecryptSelectionPayload).not.toHaveBeenCalled();
    });

    it('uid binding verificado ANTES do validateMetaCaller', async () => {
      setupAuthOk(FAKE_USER_ID_OTHER); // JWT de outro user
      setupDecryptOk({ uid: FAKE_USER_ID }); // token do user original
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(400);
      expect(mockValidateMetaCaller).not.toHaveBeenCalled();
    });

    it('validateMetaCaller usa payload.cid como companyId', async () => {
      setupAuthOk();
      setupDecryptOk({ cid: FAKE_COMPANY_ID });
      setupGuardOk();
      setupRpcOk();
      await handler(makeReq(), makeRes());
      expect(mockValidateMetaCaller).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        FAKE_COMPANY_ID,
        expect.objectContaining({ roles: expect.arrayContaining(['admin']) }),
      );
    });
  });
});
