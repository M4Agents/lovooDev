// =============================================================================
// send.test.js
//
// Testes unitários para api/whatsapp/meta/messages/send.js
// Todos os testes usam mocks — sem banco, rede, Graph, decrypt ou token real.
//
// COBERTURA:
//   HTTP-01  não-POST → 405 + Allow: POST
//
//   AUTH-01  sem Authorization → 401
//   AUTH-02  JWT inválido → 401
//
//   RBAC-01  role não autorizada → 403
//
//   FEAT-01  feature flag off → 403
//
//   BODY-01  body ausente → guard falha (company_id undefined → 400 ou 401)
//   BODY-02  company_id UUID inválido → 400 (guard)
//   BODY-03  instance_id inválido/ausente → 400
//   BODY-04  message.type != "text" → 400
//   BODY-05  message.text.body vazio → 400
//   BODY-06  to inválido (espaços/letras) → 400
//
//   TENANT-01  instance inexistente → 404 instance_not_found
//   TENANT-02  instance de outra company → 404 instance_not_found
//   TENANT-03  instance deleted → 404 instance_not_found
//
//   INST-01  status disconnected → 409 instance_not_connected
//   INST-02  status error → 409 instance_not_connected
//   INST-03  status token_revoked → 409 instance_not_connected
//
//   CRED-01  credential ausente → 500 credential_unavailable
//   CRED-02  decrypt falha → 500 credential_unavailable
//
//   SEND-01  sendTextMessage recebe token decriptado (não ciphertext)
//   SEND-02  sendTextMessage recebe phone_number_id do BANCO
//   SEND-03  phone_number_id do body não substitui o do banco
//   SEND-04  sucesso → 200 { ok: true, message_id }
//
//   GRAPH-01  send_invalid_input → 400 invalid_message
//   GRAPH-02  send_timeout → 503 provider_unavailable
//   GRAPH-03  send_network_error → 503 provider_unavailable
//   GRAPH-04  send_failed → 502 provider_error
//   GRAPH-05  send_invalid_response → 502 provider_error
//   GRAPH-06  código inesperado → 500 internal_error
//
//   SEC-01  token nunca aparece na resposta
//   SEC-02  Graph raw error nunca aparece
//   SEC-03  message body nunca aparece em erro
//   SEC-04  to nunca aparece em erro
//   SEC-05  credential lookup NÃO ocorre antes de instance válida
//   SEC-06  decrypt NÃO ocorre antes de credential válida
//   SEC-07  send NÃO ocorre antes de todas as validações
//   SEC-08  sem lookup global fallback de instance
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks (antes dos imports do handler)
// =============================================================================

const mockSvc = { from: vi.fn(), rpc: vi.fn() };

vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

const mockValidateMetaCaller = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  META_SEND_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  META_VIEW_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  META_CONNECT_ROLES: ['super_admin', 'system_admin', 'partner', 'admin'],
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
}));

const mockDecryptMetaToken = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/tokenCrypto.js', () => ({
  decryptMetaToken: (...args) => mockDecryptMetaToken(...args),
}));

const mockSendTextMessage = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/graphClient.js', () => ({
  sendTextMessage: (...args) => mockSendTextMessage(...args),
}));

import handler from '../send.js';

// =============================================================================
// Fixtures — todos fictícios, nunca reais
// =============================================================================

const FAKE_COMPANY_ID    = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_USER_ID       = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_INSTANCE_ID   = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_PHONE_NUM_ID  = '106540352242922';   // phone_number_id NO BANCO (fictício)
const FAKE_TO            = '5511987654321';      // dígitos apenas, sem '+'
const FAKE_TEXT          = 'Olá, MVP2 Meta test';
const FAKE_ENC_TOKEN     = 'v1:FAKE_ENCRYPTED_NOT_REAL_CIPHERTEXT_FOR_TESTS';
const FAKE_PLAIN_TOKEN   = 'EAAAN_fake_plain_token_not_real_for_tests_only';
const FAKE_WAMID         = 'wamid.HBgLNTU1MTk4NzY1NDMyMQIVAgARGBI4NzY1NDMyMQ==';

// Instância conectada (dados do banco — nunca do body)
const FAKE_INSTANCE = {
  id:              FAKE_INSTANCE_ID,
  company_id:      FAKE_COMPANY_ID,
  phone_number_id: FAKE_PHONE_NUM_ID,
  status:          'connected',
};

// Credencial (acesso exclusivo service_role, pós-auth)
const FAKE_CRED = { access_token_enc: FAKE_ENC_TOKEN };

// Body HTTP padrão (happy path)
const HAPPY_BODY = {
  company_id:  FAKE_COMPANY_ID,
  instance_id: FAKE_INSTANCE_ID,
  to:          FAKE_TO,
  message:     { type: 'text', text: { body: FAKE_TEXT } },
};

// =============================================================================
// Factories
// =============================================================================

/** Chain para meta_whatsapp_instances: select().eq().eq().is().maybeSingle() */
function makeInstChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    is:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

/** Chain para meta_whatsapp_credentials: select().eq().maybeSingle() */
function makeCredChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

/** Request POST mínimo */
function makeReq({ body = HAPPY_BODY, method = 'POST', headers = {} } = {}) {
  return {
    method,
    headers: { authorization: 'Bearer fake-jwt-fixture', ...headers },
    body,
  };
}

/** Response mock com rastreamento de setHeader */
function makeRes() {
  return {
    _status:  null,
    _body:    null,
    _headers: {},
    status(code) { this._status = code; return this; },
    json(body)   { this._body   = body; return this; },
    setHeader(k, v) { this._headers[k] = v; return this; },
  };
}

// =============================================================================
// Helpers de setup
// =============================================================================

function setupGuardOk(companyId = FAKE_COMPANY_ID, role = 'admin') {
  mockValidateMetaCaller.mockResolvedValue({
    ok: true, userId: FAKE_USER_ID, companyId, role, accessPath: 'direct',
  });
}

function setupGuardFail(status, error) {
  mockValidateMetaCaller.mockResolvedValue({ ok: false, status, error });
}

/** Configura happy path completo: guard + instance + credential + decrypt + send */
function setupHappyPath() {
  setupGuardOk();
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))   // meta_whatsapp_instances
    .mockReturnValueOnce(makeCredChain(FAKE_CRED));      // meta_whatsapp_credentials
  mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
  mockSendTextMessage.mockResolvedValue({ messageId: FAKE_WAMID });
}

// =============================================================================
// Setup
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  mockSvc.rpc = vi.fn(); // rpc nunca deve ser chamado
});

// =============================================================================
// Testes
// =============================================================================

describe('POST /api/whatsapp/meta/messages/send', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // HTTP-01: método inválido
  // ──────────────────────────────────────────────────────────────────────────
  describe('HTTP-01: não-POST → 405', () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      it(`${method} → 405`, async () => {
        const res = makeRes();
        await handler(makeReq({ method }), res);
        expect(res._status).toBe(405);
      });
    }

    it('GET → header Allow: POST', async () => {
      const res = makeRes();
      await handler(makeReq({ method: 'GET' }), res);
      expect(res._headers['Allow']).toBe('POST');
    });

    it('método inválido não chama guard', async () => {
      const res = makeRes();
      await handler(makeReq({ method: 'DELETE' }), res);
      expect(mockValidateMetaCaller).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AUTH: 401
  // ──────────────────────────────────────────────────────────────────────────
  describe('AUTH-01: sem Authorization → 401', () => {
    it('retorna 401 propagado pelo guard', async () => {
      setupGuardFail(401, 'Autenticação necessária');
      const res = makeRes();
      await handler(makeReq({ headers: { authorization: '' } }), res);
      expect(res._status).toBe(401);
    });
  });

  describe('AUTH-02: JWT inválido → 401', () => {
    it('retorna 401 propagado pelo guard', async () => {
      setupGuardFail(401, 'Sessão inválida ou expirada');
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(401);
    });

    it('lookup de instance não ocorre após 401', async () => {
      setupGuardFail(401, 'Sessão inválida ou expirada');
      mockSvc.from = vi.fn();
      const res = makeRes();
      await handler(makeReq(), res);
      expect(mockSvc.from).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // RBAC-01: role não autorizada → 403
  // ──────────────────────────────────────────────────────────────────────────
  describe('RBAC-01: role não autorizada → 403', () => {
    it('retorna 403 propagado pelo guard', async () => {
      setupGuardFail(403, 'Permissão insuficiente para esta operação');
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // FEAT-01: feature flag off → 403
  // ──────────────────────────────────────────────────────────────────────────
  describe('FEAT-01: feature flag off → 403', () => {
    it('retorna 403 propagado pelo guard', async () => {
      setupGuardFail(403, 'Meta WhatsApp não habilitado para esta empresa');
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BODY: validação de contrato
  // ──────────────────────────────────────────────────────────────────────────
  describe('BODY-01: body ausente → guard trata company_id undefined', () => {
    it('guard retorna 400 (UUID inválido) ou 401 (sem auth) conforme cenário', async () => {
      // Sem body: company_id = undefined → UUID format falha → 400
      setupGuardFail(400, 'company_id inválido');
      const res = makeRes();
      await handler(makeReq({ body: undefined }), res);
      expect(res._status).toBe(400);
    });

    it('lookup de instance não ocorre quando body ausente', async () => {
      setupGuardFail(400, 'company_id inválido');
      mockSvc.from = vi.fn();
      const res = makeRes();
      await handler(makeReq({ body: undefined }), res);
      expect(mockSvc.from).not.toHaveBeenCalled();
    });
  });

  describe('BODY-02: company_id UUID inválido → guard retorna 400', () => {
    it('retorna 400 propagado pelo guard', async () => {
      setupGuardFail(400, 'company_id inválido');
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, company_id: 'not-a-uuid' } }), res);
      expect(res._status).toBe(400);
    });
  });

  describe('BODY-03: instance_id inválido/ausente → 400', () => {
    it('instance_id ausente → 400', async () => {
      setupGuardOk();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, instance_id: undefined } }), res);
      expect(res._status).toBe(400);
    });

    it('instance_id string não-UUID → 400', async () => {
      setupGuardOk();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, instance_id: 'not-a-uuid' } }), res);
      expect(res._status).toBe(400);
    });

    it('instance_id inválido não realiza lookup de instance', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, instance_id: 'bad' } }), res);
      expect(mockSvc.from).not.toHaveBeenCalled();
    });
  });

  describe('BODY-04: message.type != "text" → 400', () => {
    it('type ausente → 400', async () => {
      setupGuardOk();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, message: { text: { body: FAKE_TEXT } } } }), res);
      expect(res._status).toBe(400);
    });

    it('type "image" → 400', async () => {
      setupGuardOk();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, message: { type: 'image', text: { body: FAKE_TEXT } } } }), res);
      expect(res._status).toBe(400);
    });
  });

  describe('BODY-05: message.text.body vazio/ausente → 400', () => {
    it('body vazio string → 400', async () => {
      setupGuardOk();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, message: { type: 'text', text: { body: '' } } } }), res);
      expect(res._status).toBe(400);
    });

    it('body somente espaços → 400', async () => {
      setupGuardOk();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, message: { type: 'text', text: { body: '   ' } } } }), res);
      expect(res._status).toBe(400);
    });

    it('message.text ausente → 400', async () => {
      setupGuardOk();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, message: { type: 'text' } } }), res);
      expect(res._status).toBe(400);
    });
  });

  describe('BODY-06: to inválido → 400', () => {
    it('to ausente → 400', async () => {
      setupGuardOk();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, to: undefined } }), res);
      expect(res._status).toBe(400);
    });

    it('to com letras → 400', async () => {
      setupGuardOk();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, to: 'abc55119876' } }), res);
      expect(res._status).toBe(400);
    });

    it('to com hífen → 400', async () => {
      setupGuardOk();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, to: '55-11-987654321' } }), res);
      expect(res._status).toBe(400);
    });

    it('to com espaços → 400', async () => {
      setupGuardOk();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, to: '+55 11 987654321' } }), res);
      expect(res._status).toBe(400);
    });

    it('to com "+" aceito: normalizado para dígitos antes do primitive', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, to: '+5511987654321' } }), res);
      expect(res._status).toBe(200);
      // Verify primitive recebeu versão normalizada (sem '+')
      expect(mockSendTextMessage.mock.calls[0][2]).toBe('5511987654321');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TENANT: instance não encontrada
  // ──────────────────────────────────────────────────────────────────────────
  describe('TENANT-01: instance inexistente → 404', () => {
    it('retorna 404 instance_not_found', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn().mockReturnValue(makeInstChain(null));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(404);
      expect(res._body).toEqual({ error: 'instance_not_found' });
    });
  });

  describe('TENANT-02: instance de outra company → 404 genérico', () => {
    it('retorna 404 instance_not_found (indistinguível de não existir)', async () => {
      // Guard autoriza company A; query inclui company_id=A → não encontra instância da company B
      setupGuardOk();
      mockSvc.from = vi.fn().mockReturnValue(makeInstChain(null));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(404);
      expect(res._body).toEqual({ error: 'instance_not_found' });
    });

    it('SEC-08: query sempre inclui auth.companyId — sem fallback global', async () => {
      setupGuardOk(FAKE_COMPANY_ID);
      const instChain = makeInstChain(null);
      mockSvc.from = vi.fn().mockReturnValue(instChain);
      const res = makeRes();
      await handler(makeReq(), res);
      // Verificar que eq foi chamado com FAKE_COMPANY_ID (auth.companyId)
      const eqCalls = instChain.eq.mock.calls;
      const companyEqCall = eqCalls.find(([col, val]) => col === 'company_id' && val === FAKE_COMPANY_ID);
      expect(companyEqCall).toBeDefined();
    });
  });

  describe('TENANT-03: instance deleted → 404', () => {
    it('retorna 404 instance_not_found (deleted_at filtrado pelo banco)', async () => {
      setupGuardOk();
      // O banco retorna null porque deleted_at IS NULL filtrou a linha
      mockSvc.from = vi.fn().mockReturnValue(makeInstChain(null));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(404);
      expect(res._body).toEqual({ error: 'instance_not_found' });
    });

    it('query inclui filtro deleted_at IS NULL', async () => {
      setupGuardOk();
      const instChain = makeInstChain(null);
      mockSvc.from = vi.fn().mockReturnValue(instChain);
      const res = makeRes();
      await handler(makeReq(), res);
      // .is() deve ter sido chamado com ('deleted_at', null)
      expect(instChain.is).toHaveBeenCalledWith('deleted_at', null);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // INST: status não-connected
  // ──────────────────────────────────────────────────────────────────────────
  describe('INST-01: status disconnected → 409', () => {
    it('retorna 409 instance_not_connected', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn().mockReturnValue(makeInstChain({ ...FAKE_INSTANCE, status: 'disconnected' }));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(409);
      expect(res._body).toEqual({ error: 'instance_not_connected' });
    });
  });

  describe('INST-02: status error → 409', () => {
    it('retorna 409 instance_not_connected', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn().mockReturnValue(makeInstChain({ ...FAKE_INSTANCE, status: 'error' }));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(409);
      expect(res._body).toEqual({ error: 'instance_not_connected' });
    });
  });

  describe('INST-03: status token_revoked → 409', () => {
    it('retorna 409 instance_not_connected', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn().mockReturnValue(makeInstChain({ ...FAKE_INSTANCE, status: 'token_revoked' }));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(409);
      expect(res._body).toEqual({ error: 'instance_not_connected' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CRED: credential ausente ou decrypt falha
  // ──────────────────────────────────────────────────────────────────────────
  describe('CRED-01: credential ausente → 500 credential_unavailable', () => {
    it('retorna 500 credential_unavailable quando credential é null', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(null));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(500);
      expect(res._body).toEqual({ error: 'credential_unavailable' });
    });

    it('retorna 500 credential_unavailable quando access_token_enc ausente', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain({ access_token_enc: null }));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(500);
      expect(res._body).toEqual({ error: 'credential_unavailable' });
    });

    it('retorna 500 credential_unavailable quando query de credential falha', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(null, new Error('db error')));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(500);
      expect(res._body).toEqual({ error: 'credential_unavailable' });
    });
  });

  describe('CRED-02: decrypt falha → 500 credential_unavailable', () => {
    it('retorna 500 credential_unavailable quando decryptMetaToken lança', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(FAKE_CRED));
      mockDecryptMetaToken.mockImplementation(() => { throw new Error('decrypt failed'); });
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(500);
      expect(res._body).toEqual({ error: 'credential_unavailable' });
    });

    it('sendTextMessage não é chamado quando decrypt falha', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(FAKE_CRED));
      mockDecryptMetaToken.mockImplementation(() => { throw new Error('decrypt failed'); });
      const res = makeRes();
      await handler(makeReq(), res);
      expect(mockSendTextMessage).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SEND: primitive recebe args corretos
  // ──────────────────────────────────────────────────────────────────────────
  describe('SEND-01: sendTextMessage recebe token decriptado', () => {
    it('primeiro arg de sendTextMessage é o plainToken (não o ciphertext)', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq(), res);
      const [firstArg] = mockSendTextMessage.mock.calls[0];
      expect(firstArg).toBe(FAKE_PLAIN_TOKEN);
      expect(firstArg).not.toBe(FAKE_ENC_TOKEN);
    });
  });

  describe('SEND-02: sendTextMessage recebe phone_number_id do BANCO', () => {
    it('segundo arg de sendTextMessage é instance.phone_number_id (do banco)', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq(), res);
      const [, secondArg] = mockSendTextMessage.mock.calls[0];
      expect(secondArg).toBe(FAKE_PHONE_NUM_ID);
    });
  });

  describe('SEND-03: phone_number_id do body NÃO substitui o do banco', () => {
    it('body com phone_number_id: "999999" — sendTextMessage usa o do banco', async () => {
      setupHappyPath();
      const res = makeRes();
      // Enviar phone_number_id invasor no body
      await handler(makeReq({ body: { ...HAPPY_BODY, phone_number_id: '999999' } }), res);
      const [, secondArg] = mockSendTextMessage.mock.calls[0];
      expect(secondArg).toBe(FAKE_PHONE_NUM_ID);    // do banco
      expect(secondArg).not.toBe('999999');          // NÃO do body
    });
  });

  describe('SEND-04: sucesso → 200 { ok: true, message_id }', () => {
    it('retorna 200 com message_id correto', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(200);
      expect(res._body).toEqual({ ok: true, message_id: FAKE_WAMID });
    });

    it('resposta contém somente ok e message_id', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq(), res);
      expect(Object.keys(res._body).sort()).toEqual(['message_id', 'ok'].sort());
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GRAPH: mapeamento de erros do primitive
  // ──────────────────────────────────────────────────────────────────────────
  function makeGraphError(code) {
    const err = new Error('graph error');
    err.code = code;
    return err;
  }

  describe('GRAPH-01: send_invalid_input → 400 invalid_message', () => {
    it('retorna 400 invalid_message', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(FAKE_CRED));
      mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
      mockSendTextMessage.mockRejectedValue(makeGraphError('send_invalid_input'));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(400);
      expect(res._body).toEqual({ error: 'invalid_message' });
    });
  });

  describe('GRAPH-02: send_timeout → 503 provider_unavailable', () => {
    it('retorna 503 provider_unavailable', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(FAKE_CRED));
      mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
      mockSendTextMessage.mockRejectedValue(makeGraphError('send_timeout'));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(503);
      expect(res._body).toEqual({ error: 'provider_unavailable' });
    });
  });

  describe('GRAPH-03: send_network_error → 503 provider_unavailable', () => {
    it('retorna 503 provider_unavailable', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(FAKE_CRED));
      mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
      mockSendTextMessage.mockRejectedValue(makeGraphError('send_network_error'));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(503);
      expect(res._body).toEqual({ error: 'provider_unavailable' });
    });
  });

  describe('GRAPH-04: send_failed → 502 provider_error', () => {
    it('retorna 502 provider_error', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(FAKE_CRED));
      mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
      mockSendTextMessage.mockRejectedValue(makeGraphError('send_failed'));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(502);
      expect(res._body).toEqual({ error: 'provider_error' });
    });
  });

  describe('GRAPH-05: send_invalid_response → 502 provider_error', () => {
    it('retorna 502 provider_error', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(FAKE_CRED));
      mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
      mockSendTextMessage.mockRejectedValue(makeGraphError('send_invalid_response'));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(502);
      expect(res._body).toEqual({ error: 'provider_error' });
    });
  });

  describe('GRAPH-06: código inesperado → 500 internal_error', () => {
    it('retorna 500 internal_error para erro sem código conhecido', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(FAKE_CRED));
      mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
      mockSendTextMessage.mockRejectedValue(new Error('unexpected error without known code'));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(500);
      expect(res._body).toEqual({ error: 'internal_error' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SEC: assertions de segurança
  // ──────────────────────────────────────────────────────────────────────────
  describe('SEC-01: token nunca aparece na resposta', () => {
    it('plainToken não está em nenhuma resposta de sucesso', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq(), res);
      const bodyStr = JSON.stringify(res._body);
      expect(bodyStr).not.toContain(FAKE_PLAIN_TOKEN);
      expect(bodyStr).not.toContain(FAKE_ENC_TOKEN);
    });

    it('plainToken não aparece em resposta de erro', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(FAKE_CRED));
      mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
      mockSendTextMessage.mockRejectedValue(makeGraphError('send_failed'));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(JSON.stringify(res._body)).not.toContain(FAKE_PLAIN_TOKEN);
    });
  });

  describe('SEC-02: Graph raw error nunca aparece na resposta', () => {
    it('mensagem de erro do primitive não exposta', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(FAKE_CRED));
      mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
      const rawErr = makeGraphError('send_failed');
      rawErr.message = 'INTERNAL_GRAPH_RAW_ERROR_SENTINEL';
      mockSendTextMessage.mockRejectedValue(rawErr);
      const res = makeRes();
      await handler(makeReq(), res);
      expect(JSON.stringify(res._body)).not.toContain('INTERNAL_GRAPH_RAW_ERROR_SENTINEL');
    });
  });

  describe('SEC-03: message body nunca aparece em erro', () => {
    it('conteúdo da mensagem não exposto na resposta de erro', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(FAKE_CRED));
      mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
      mockSendTextMessage.mockRejectedValue(makeGraphError('send_failed'));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(JSON.stringify(res._body)).not.toContain(FAKE_TEXT);
    });
  });

  describe('SEC-04: to nunca aparece em erro', () => {
    it('número de destino não exposto na resposta de erro', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(FAKE_CRED));
      mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
      mockSendTextMessage.mockRejectedValue(makeGraphError('send_failed'));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(JSON.stringify(res._body)).not.toContain(FAKE_TO);
    });
  });

  describe('SEC-05: credential lookup NÃO ocorre antes de instance válida', () => {
    it('quando instance não encontrada, from é chamado somente 1 vez (instances)', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn().mockReturnValue(makeInstChain(null));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(mockSvc.from).toHaveBeenCalledTimes(1);
      expect(mockSvc.from.mock.calls[0][0]).toBe('meta_whatsapp_instances');
    });

    it('quando status disconnected, credential lookup não ocorre', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn().mockReturnValue(makeInstChain({ ...FAKE_INSTANCE, status: 'disconnected' }));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(mockSvc.from).toHaveBeenCalledTimes(1);
    });
  });

  describe('SEC-06: decrypt NÃO ocorre antes de credential válida', () => {
    it('quando credential ausente, decryptMetaToken não é chamado', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(null));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(mockDecryptMetaToken).not.toHaveBeenCalled();
    });
  });

  describe('SEC-07: send NÃO ocorre antes de todas as validações', () => {
    it('quando instance não encontrada, sendTextMessage não é chamado', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn().mockReturnValue(makeInstChain(null));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(mockSendTextMessage).not.toHaveBeenCalled();
    });

    it('quando guard falha, sendTextMessage não é chamado', async () => {
      setupGuardFail(403, 'Permissão insuficiente');
      const res = makeRes();
      await handler(makeReq(), res);
      expect(mockSendTextMessage).not.toHaveBeenCalled();
    });

    it('quando body inválido (instance_id), sendTextMessage não é chamado', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, instance_id: 'bad' } }), res);
      expect(mockSendTextMessage).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Assertions de query (query structure verification)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Query structure: instance lookup', () => {
    it('lookup de instance inclui id=instanceId', async () => {
      setupGuardOk();
      const instChain = makeInstChain(null);
      mockSvc.from = vi.fn().mockReturnValue(instChain);
      const res = makeRes();
      await handler(makeReq(), res);
      const idEqCall = instChain.eq.mock.calls.find(([col]) => col === 'id');
      expect(idEqCall).toBeDefined();
      expect(idEqCall[1]).toBe(FAKE_INSTANCE_ID);
    });

    it('lookup de instance inclui company_id=auth.companyId', async () => {
      setupGuardOk(FAKE_COMPANY_ID);
      const instChain = makeInstChain(null);
      mockSvc.from = vi.fn().mockReturnValue(instChain);
      const res = makeRes();
      await handler(makeReq(), res);
      const companyEqCall = instChain.eq.mock.calls.find(([col]) => col === 'company_id');
      expect(companyEqCall).toBeDefined();
      expect(companyEqCall[1]).toBe(FAKE_COMPANY_ID);
    });

    it('lookup de instance inclui deleted_at IS NULL', async () => {
      setupGuardOk();
      const instChain = makeInstChain(null);
      mockSvc.from = vi.fn().mockReturnValue(instChain);
      const res = makeRes();
      await handler(makeReq(), res);
      expect(instChain.is).toHaveBeenCalledWith('deleted_at', null);
    });
  });

  describe('Query structure: credential lookup', () => {
    it('credential lookup usa instance.id (do banco, não do body)', async () => {
      setupGuardOk();
      const credChain = makeCredChain(FAKE_CRED);
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(credChain);
      mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
      mockSendTextMessage.mockResolvedValue({ messageId: FAKE_WAMID });
      const res = makeRes();
      await handler(makeReq(), res);
      // eq deve ter sido chamado com ('instance_id', FAKE_INSTANCE_ID)
      const instanceIdCall = credChain.eq.mock.calls.find(([col]) => col === 'instance_id');
      expect(instanceIdCall).toBeDefined();
      expect(instanceIdCall[1]).toBe(FAKE_INSTANCE_ID);
    });

    it('credential lookup ocorre SOMENTE na tabela correta', async () => {
      setupGuardOk();
      mockSvc.from = vi.fn()
        .mockReturnValueOnce(makeInstChain(FAKE_INSTANCE))
        .mockReturnValueOnce(makeCredChain(FAKE_CRED));
      mockDecryptMetaToken.mockReturnValue(FAKE_PLAIN_TOKEN);
      mockSendTextMessage.mockResolvedValue({ messageId: FAKE_WAMID });
      const res = makeRes();
      await handler(makeReq(), res);
      const tables = mockSvc.from.mock.calls.map(([t]) => t);
      expect(tables).toEqual(['meta_whatsapp_instances', 'meta_whatsapp_credentials']);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Normalization de `to`
  // ──────────────────────────────────────────────────────────────────────────
  describe('Normalização de to', () => {
    it('"+" inicial é removido antes de sendTextMessage', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, to: '+5511987654321' } }), res);
      expect(mockSendTextMessage.mock.calls[0][2]).toBe('5511987654321');
    });

    it('sem "+" o valor é passado diretamente', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq({ body: { ...HAPPY_BODY, to: '5511987654321' } }), res);
      expect(mockSendTextMessage.mock.calls[0][2]).toBe('5511987654321');
    });
  });
});
