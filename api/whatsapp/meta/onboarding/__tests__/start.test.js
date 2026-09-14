// =============================================================================
// start.test.js
//
// Testes unitários para api/whatsapp/meta/onboarding/start.js
//
// Cobertura:
//   T-01  POST sucesso
//   T-02  GET → 405
//   T-03  PUT → 405
//   T-04  body ausente → 400
//   T-05  body null → 400
//   T-06  body {} → 400
//   T-07  company_id malformado → guard retorna 400, endpoint propaga
//   T-08  guard retorna 401 → endpoint propaga
//   T-09  guard retorna 403 (role) → endpoint propaga
//   T-10  guard retorna 403 (partner) → endpoint propaga
//   T-11  guard retorna 403 (feature flag) → endpoint propaga
//   T-12  getMetaPublicConfig lança → 500 genérico
//   T-13  INSERT DB error → 500 genérico
//   T-14  INSERT sem id → 500 genérico
//   T-15  state vem de session.id (banco)
//   T-16  user_id inserido vem de auth.userId (JWT)
//   T-17  req.body.user_id malicioso é ignorado
//   T-18  id NÃO aparece no objeto enviado ao insert
//   T-19  expires_at ≈ now + 10 min (fake timers)
//   T-20  response usa session.expires_at retornado pelo DB
//   T-21  response não contém app_secret
//   T-22  response não contém user_id
//   T-23  response não contém company_id
//   T-24  response não contém role
//   T-25  campos extras do body são ignorados
//   T-26  validateMetaCaller recebe req, svc, companyId, META_CONNECT_ROLES
//   T-27  getMetaPublicConfig chamado somente após auth bem-sucedida
//   T-28  INSERT só acontece após auth bem-sucedida
//   T-29  getMetaServerConfig NÃO é utilizado
//   T-30  exception inesperada do guard → 500 genérico, sem refletir erro
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Mocks — declarados antes dos imports dinâmicos
// =============================================================================

// Mock: getSupabaseAdmin
const mockSvc = {};
vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

// Mock: validateMetaCaller + META_CONNECT_ROLES
const mockValidateMetaCaller = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  META_CONNECT_ROLES: ['super_admin', 'system_admin', 'partner', 'admin'],
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
}));

// Mock: getMetaPublicConfig + getMetaServerConfig
const mockGetMetaPublicConfig = vi.fn();
const mockGetMetaServerConfig = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/config.js', () => ({
  getMetaPublicConfig: (...args) => mockGetMetaPublicConfig(...args),
  getMetaServerConfig: (...args) => mockGetMetaServerConfig(...args),
}));

// Import do handler APÓS mocks
import handler from '../start.js';
import { getSupabaseAdmin } from '../../../../lib/automation/supabaseAdmin.js';
import { META_CONNECT_ROLES } from '../../../../lib/meta-whatsapp/validateMetaCaller.js';

// =============================================================================
// Factories de request / response
// =============================================================================

function makeReq(method = 'POST', body = { company_id: 'aaaabbbb-0000-0000-0000-000000000001' }, headers = {}) {
  return {
    method,
    body,
    headers: { authorization: 'Bearer fake-jwt-token', ...headers },
  };
}

function makeRes() {
  const res = {
    _status: null,
    _body:   null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };
  return res;
}

// =============================================================================
// Fixtures
// =============================================================================

const FAKE_COMPANY_ID  = 'aaaabbbb-0000-0000-0000-000000000001';
const FAKE_USER_ID     = 'ccccdddd-0000-0000-0000-000000000002';
const FAKE_SESSION_ID  = 'eeeeffff-0000-0000-0000-000000000003';
const FAKE_EXPIRES_AT  = '2026-09-14T18:00:00.000Z';
const FAKE_APP_ID      = '111111111111111';
const FAKE_CONFIG_ID   = '222222222222222';

// =============================================================================
// Helpers de setup padrão (auth ok + config ok + insert ok)
// =============================================================================

function setupAuthOk(overrides = {}) {
  mockValidateMetaCaller.mockResolvedValue({
    ok:         true,
    userId:     FAKE_USER_ID,
    companyId:  FAKE_COMPANY_ID,
    role:       'admin',
    accessPath: 'direct',
    ...overrides,
  });
}

function setupConfigOk() {
  mockGetMetaPublicConfig.mockReturnValue({
    appId:    FAKE_APP_ID,
    configId: FAKE_CONFIG_ID,
  });
}

function setupInsertOk(sessionOverrides = {}) {
  const session = {
    id:         FAKE_SESSION_ID,
    expires_at: FAKE_EXPIRES_AT,
    ...sessionOverrides,
  };

  // Chain: .from().insert().select().single() → { data: session, error: null }
  const mockSingle = vi.fn().mockResolvedValue({ data: session, error: null });
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
  const mockFrom   = vi.fn().mockReturnValue({ insert: mockInsert });

  mockSvc.from = mockFrom;

  return { mockFrom, mockInsert, mockSelect, mockSingle, session };
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

describe('POST /api/whatsapp/meta/onboarding/start', () => {

  // ─────────────────────────────────────────────────────────────────────────
  // T-01: Sucesso completo
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-01: POST sucesso', () => {
    it('retorna 200 com state, app_id, config_id, expires_at', async () => {
      setupAuthOk();
      setupConfigOk();
      const { session } = setupInsertOk();

      const req = makeReq();
      const res = makeRes();

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._body).toEqual({
        state:      session.id,
        app_id:     FAKE_APP_ID,
        config_id:  FAKE_CONFIG_ID,
        expires_at: session.expires_at,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-02 / T-03: Method guard
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-02: GET → 405', () => {
    it('retorna 405 para método GET', async () => {
      const res = makeRes();
      await handler(makeReq('GET'), res);
      expect(res._status).toBe(405);
      expect(res._body.error).toMatch(/method not allowed/i);
    });
  });

  describe('T-03: PUT → 405', () => {
    it('retorna 405 para método PUT', async () => {
      const res = makeRes();
      await handler(makeReq('PUT'), res);
      expect(res._status).toBe(405);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-04 / T-05 / T-06: Body validation
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-04: body ausente → 400', () => {
    it('retorna 400 quando req.body é undefined', async () => {
      // Nota: makeReq não pode ser usado aqui — default parameters do JS
      // substituem `undefined` pelo valor padrão. Construir req diretamente.
      const res = makeRes();
      await handler(
        { method: 'POST', body: undefined, headers: { authorization: 'Bearer fake-jwt-token' } },
        res,
      );
      expect(res._status).toBe(400);
      expect(res._body.error).toMatch(/company_id/i);
    });
  });

  describe('T-05: body null → 400', () => {
    it('retorna 400 quando req.body é null', async () => {
      const res = makeRes();
      await handler(makeReq('POST', null), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toMatch(/company_id/i);
    });
  });

  describe('T-06: body {} → 400', () => {
    it('retorna 400 quando company_id está ausente do body', async () => {
      const res = makeRes();
      await handler(makeReq('POST', {}), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toMatch(/company_id/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-07: company_id malformado — guard retorna 400
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-07: company_id malformado → guard 400, endpoint propaga', () => {
    it('propaga status 400 e mensagem do guard', async () => {
      mockValidateMetaCaller.mockResolvedValue({
        ok: false, status: 400, error: 'company_id inválido',
      });
      setupInsertOk(); // não deve ser chamado

      const res = makeRes();
      await handler(makeReq('POST', { company_id: 'not-a-uuid' }), res);

      expect(res._status).toBe(400);
      expect(res._body.error).toBe('company_id inválido');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-08: guard 401
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-08: guard 401 → endpoint propaga', () => {
    it('retorna 401 com mensagem do guard', async () => {
      mockValidateMetaCaller.mockResolvedValue({
        ok: false, status: 401, error: 'Sessão inválida ou expirada',
      });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(401);
      expect(res._body.error).toBe('Sessão inválida ou expirada');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-09 / T-10 / T-11: guard 403 (role / partner / feature flag)
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-09: guard 403 (role) → endpoint propaga', () => {
    it('retorna 403 com mensagem do guard', async () => {
      mockValidateMetaCaller.mockResolvedValue({
        ok: false, status: 403, error: 'Permissão insuficiente para esta operação',
      });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(403);
      expect(res._body.error).toBe('Permissão insuficiente para esta operação');
    });
  });

  describe('T-10: guard 403 (partner sem assignment) → endpoint propaga', () => {
    it('retorna 403 com mensagem do guard', async () => {
      mockValidateMetaCaller.mockResolvedValue({
        ok: false, status: 403, error: 'Partner sem assignment ativo para esta empresa',
      });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(403);
      expect(res._body.error).toBe('Partner sem assignment ativo para esta empresa');
    });
  });

  describe('T-11: guard 403 (feature flag off) → endpoint propaga', () => {
    it('retorna 403 com mensagem do guard', async () => {
      mockValidateMetaCaller.mockResolvedValue({
        ok: false, status: 403, error: 'Meta WhatsApp não habilitado para esta empresa',
      });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(403);
      expect(res._body.error).toBe('Meta WhatsApp não habilitado para esta empresa');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-12: getMetaPublicConfig lança → 500 genérico
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-12: getMetaPublicConfig lança → 500 genérico', () => {
    it('retorna 500 sem refletir a mensagem interna', async () => {
      setupAuthOk();
      mockGetMetaPublicConfig.mockImplementation(() => {
        throw new Error('[meta/config] META_APP_ID não configurada');
      });
      setupInsertOk(); // não deve ser chamado

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(500);
      expect(res._body.error).toBe('Configuração Meta incompleta');
      // mensagem interna não vazou
      expect(res._body.error).not.toContain('META_APP_ID');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-13: INSERT DB error → 500 genérico
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-13: INSERT DB error → 500 genérico', () => {
    it('retorna 500 sem refletir erro do banco', async () => {
      setupAuthOk();
      setupConfigOk();

      // Simular erro do INSERT
      const mockSingle = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'foreign key violation' },
      });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      mockSvc.from = vi.fn().mockReturnValue({ insert: mockInsert });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(500);
      expect(res._body.error).toBe('Erro ao criar sessão de onboarding');
      // erro do banco não vazou
      expect(res._body.error).not.toContain('foreign key');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-14: INSERT sem id → 500
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-14: INSERT retorna data sem id → 500', () => {
    it('retorna 500 quando session não possui id', async () => {
      setupAuthOk();
      setupConfigOk();

      const mockSingle = vi.fn().mockResolvedValue({
        data: { expires_at: FAKE_EXPIRES_AT },  // sem id
        error: null,
      });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      mockSvc.from = vi.fn().mockReturnValue({ insert: mockInsert });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(500);
      expect(res._body.error).toBe('Erro ao criar sessão de onboarding');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-15: state vem de session.id (banco)
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-15: state vem exatamente de session.id', () => {
    it('response.state é o uuid retornado pelo banco', async () => {
      setupAuthOk();
      setupConfigOk();
      const { session } = setupInsertOk({ id: 'db-generated-uuid-fixture' });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._body.state).toBe('db-generated-uuid-fixture');
      expect(res._body.state).toBe(session.id);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-16: user_id no INSERT vem de auth.userId (JWT)
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-16: user_id inserido vem de auth.userId', () => {
    it('o objeto inserido contém user_id = auth.userId', async () => {
      setupAuthOk({ userId: FAKE_USER_ID });
      setupConfigOk();
      const { mockInsert } = setupInsertOk();

      await handler(makeReq(), makeRes());

      const insertedObj = mockInsert.mock.calls[0][0];
      expect(insertedObj.user_id).toBe(FAKE_USER_ID);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-17: req.body.user_id malicioso é ignorado
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-17: req.body.user_id malicioso é ignorado', () => {
    it('user_id do body não influencia o que é inserido', async () => {
      const MALICIOUS_USER_ID = 'attacker-00000-0000-0000-000000000000';
      setupAuthOk({ userId: FAKE_USER_ID });
      setupConfigOk();
      const { mockInsert } = setupInsertOk();

      const req = makeReq('POST', {
        company_id: FAKE_COMPANY_ID,
        user_id:    MALICIOUS_USER_ID,  // tentativa de injeção
      });

      await handler(req, makeRes());

      const insertedObj = mockInsert.mock.calls[0][0];
      expect(insertedObj.user_id).toBe(FAKE_USER_ID);          // valor correto do JWT
      expect(insertedObj.user_id).not.toBe(MALICIOUS_USER_ID); // injeção ignorada
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-18: id NÃO aparece no objeto enviado ao INSERT
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-18: id não aparece no objeto do INSERT', () => {
    it('o objeto inserido não contém campo id', async () => {
      setupAuthOk();
      setupConfigOk();
      const { mockInsert } = setupInsertOk();

      await handler(makeReq(), makeRes());

      const insertedObj = mockInsert.mock.calls[0][0];
      expect(insertedObj).not.toHaveProperty('id');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-19: expires_at ≈ now + 10min (fake timers)
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-19: expires_at ≈ now + 10 minutos (fake timers)', () => {
    it('expires_at inserido é now + 600000ms', async () => {
      const FIXED_NOW = new Date('2026-09-14T17:45:00.000Z').getTime();
      vi.useFakeTimers();
      vi.setSystemTime(FIXED_NOW);

      setupAuthOk();
      setupConfigOk();
      const { mockInsert } = setupInsertOk();

      await handler(makeReq(), makeRes());

      const insertedObj   = mockInsert.mock.calls[0][0];
      const expectedExpiry = new Date(FIXED_NOW + 10 * 60 * 1000).toISOString();

      expect(insertedObj.expires_at).toBe(expectedExpiry);

      vi.useRealTimers();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-20: response usa session.expires_at do banco
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-20: response usa session.expires_at retornado pelo banco', () => {
    it('response.expires_at é o valor do banco, não a variável local', async () => {
      const DB_EXPIRES_AT = '2026-09-14T17:55:30.123Z'; // banco pode ter precisão diferente
      setupAuthOk();
      setupConfigOk();
      setupInsertOk({ expires_at: DB_EXPIRES_AT });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._body.expires_at).toBe(DB_EXPIRES_AT);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-21 / T-22 / T-23 / T-24: response não contém campos sensíveis/internos
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-21: response não contém app_secret', () => {
    it('response.body não possui propriedade app_secret', async () => {
      setupAuthOk();
      setupConfigOk();
      setupInsertOk();

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._body).not.toHaveProperty('app_secret');
    });
  });

  describe('T-22: response não contém user_id', () => {
    it('response.body não possui propriedade user_id', async () => {
      setupAuthOk();
      setupConfigOk();
      setupInsertOk();

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._body).not.toHaveProperty('user_id');
    });
  });

  describe('T-23: response não contém company_id', () => {
    it('response.body não possui propriedade company_id', async () => {
      setupAuthOk();
      setupConfigOk();
      setupInsertOk();

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._body).not.toHaveProperty('company_id');
    });
  });

  describe('T-24: response não contém role', () => {
    it('response.body não possui propriedade role', async () => {
      setupAuthOk();
      setupConfigOk();
      setupInsertOk();

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._body).not.toHaveProperty('role');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-25: campos extras do body são ignorados
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-25: campos extras do body são ignorados', () => {
    it('body com campos extras não influencia auth, insert ou response', async () => {
      setupAuthOk({ userId: FAKE_USER_ID });
      setupConfigOk();
      const { mockInsert } = setupInsertOk();

      const req = makeReq('POST', {
        company_id:          FAKE_COMPANY_ID,
        role:                'super_admin',     // ignorado
        state:               'fake-state',      // ignorado
        feature_flag:        true,              // ignorado
        meta_whatsapp_enabled: true,            // ignorado
        app_secret:          'leaked-secret',   // ignorado
      });

      const res = makeRes();
      await handler(req, res);

      expect(res._status).toBe(200);

      const insertedObj = mockInsert.mock.calls[0][0];
      // Apenas os campos corretos no INSERT
      expect(Object.keys(insertedObj).sort()).toEqual(['company_id', 'expires_at', 'user_id'].sort());
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-26: validateMetaCaller recebe req, svc, companyId, META_CONNECT_ROLES
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-26: validateMetaCaller chamado com argumentos corretos', () => {
    it('recebe (req, svc, companyId, { roles: META_CONNECT_ROLES })', async () => {
      setupAuthOk();
      setupConfigOk();
      setupInsertOk();

      const req = makeReq('POST', { company_id: FAKE_COMPANY_ID });
      await handler(req, makeRes());

      expect(mockValidateMetaCaller).toHaveBeenCalledOnce();
      const [passedReq, passedSvc, passedCompanyId, passedOptions] =
        mockValidateMetaCaller.mock.calls[0];

      expect(passedReq).toBe(req);
      expect(passedSvc).toBe(mockSvc);
      expect(passedCompanyId).toBe(FAKE_COMPANY_ID);
      expect(passedOptions).toEqual({ roles: META_CONNECT_ROLES });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-27: getMetaPublicConfig chamado somente após auth bem-sucedida
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-27: getMetaPublicConfig chamado somente após auth OK', () => {
    it('não chama getMetaPublicConfig quando guard retorna 403', async () => {
      mockValidateMetaCaller.mockResolvedValue({
        ok: false, status: 403, error: 'Permissão insuficiente para esta operação',
      });

      await handler(makeReq(), makeRes());

      expect(mockGetMetaPublicConfig).not.toHaveBeenCalled();
    });

    it('chama getMetaPublicConfig quando guard retorna ok=true', async () => {
      setupAuthOk();
      setupConfigOk();
      setupInsertOk();

      await handler(makeReq(), makeRes());

      expect(mockGetMetaPublicConfig).toHaveBeenCalledOnce();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-28: INSERT só acontece após auth bem-sucedida
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-28: INSERT não acontece quando auth falha', () => {
    it('não acessa mockSvc.from quando guard retorna 401', async () => {
      mockValidateMetaCaller.mockResolvedValue({
        ok: false, status: 401, error: 'Sessão inválida ou expirada',
      });
      const mockFrom = vi.fn();
      mockSvc.from = mockFrom;

      await handler(makeReq(), makeRes());

      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-29: getMetaServerConfig NÃO é utilizado
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-29: getMetaServerConfig não é chamado', () => {
    it('nunca chama getMetaServerConfig (não precisa de APP_SECRET)', async () => {
      setupAuthOk();
      setupConfigOk();
      setupInsertOk();

      await handler(makeReq(), makeRes());

      expect(mockGetMetaServerConfig).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T-30: exception inesperada → 500 genérico sem refletir erro interno
  // ─────────────────────────────────────────────────────────────────────────
  describe('T-30: exception inesperada → 500 genérico', () => {
    it('retorna 500 quando validateMetaCaller lança exception', async () => {
      mockValidateMetaCaller.mockRejectedValue(
        new Error('ECONNREFUSED: Supabase unreachable — secret internal detail'),
      );

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(500);
      expect(res._body.error).toBe('Erro interno do servidor');
      expect(res._body.error).not.toContain('ECONNREFUSED');
      expect(res._body.error).not.toContain('Supabase');
      expect(res._body.error).not.toContain('secret internal detail');
    });

    it('retorna 500 quando getSupabaseAdmin lança exception', async () => {
      // Forçar getSupabaseAdmin a lançar (dentro do try/catch geral)
      const { getSupabaseAdmin: mockGetSvc } = await import('../../../../lib/automation/supabaseAdmin.js');
      mockGetSvc.mockImplementationOnce(() => {
        throw new Error('[supabaseAdmin] Variáveis ausentes — secret internal');
      });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(500);
      expect(res._body.error).toBe('Erro interno do servidor');
      expect(res._body.error).not.toContain('supabaseAdmin');
      expect(res._body.error).not.toContain('secret internal');
    });
  });

});
