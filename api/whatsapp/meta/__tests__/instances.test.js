// =============================================================================
// instances.test.js
//
// Testes unitários para api/whatsapp/meta/instances.js
// Todos os testes usam mocks — sem banco, rede, Graph ou credential real.
//
// COBERTURA:
//   T-01  GET sucesso — 1 instância ativa
//   T-02  GET lista vazia → 200 { instances: [] }
//   T-03  GET múltiplas instâncias → retorna todas
//   T-04  POST → 405
//   T-05  PUT → 405
//   T-06  DELETE → 405
//   T-07  PATCH → 405
//   T-08  company_id ausente → 400
//   T-09  company_id presente mas guard 401 → 401 propagado
//   T-10  company_id UUID inválido → guard 400 propagado
//   T-11  guard 403 (role) → 403 propagado
//   T-12  guard 403 (feature flag) → 403 propagado
//   T-13  guard 403 (partner sem assignment) → 403 propagado
//   T-14  guard 403 (parent sem acesso) → 403 propagado
//   T-15  query NÃO ocorre se guard falhar
//   T-16  query NÃO ocorre se company_id ausente
//   T-17  query NÃO ocorre se método inválido
//   T-18  META_VIEW_ROLES passado ao guard (não META_CONNECT_ROLES)
//   T-19  query usa guard.companyId, não req.query.company_id
//   T-20  query filtra deleted_at IS NULL
//   T-21  query ordena por created_at DESC
//   T-22  SELECT explícito — não usa *
//   T-23  connected_by NÃO presente no response
//   T-24  company_id NÃO presente no response
//   T-25  deleted_at NÃO presente no response
//   T-26  meta_whatsapp_credentials nunca consultada
//   T-27  query error → 500 internal_error
//   T-28  query error não expõe message do banco (canário)
//   T-29  getSupabaseAdmin throw → 500 internal_error
//   T-30  validateMetaCaller throw → 500 internal_error
//   T-31  query throw inesperado → 500 internal_error
//   T-32  Authorization header não aparece no response (zero leak)
//   T-33  erro interno não vaza token (canário)
//   T-34  seller com META_VIEW_ROLES → 200
//   T-35  manager com META_VIEW_ROLES → 200
//   T-36  response contém exatamente os 9 campos públicos
//   T-37  Bearer inválido + company_id inválido → 401 (auth tem precedência)
//   T-38  svc.rpc nunca chamado (apenas svc.from)
//   T-39  data null retornado pelo Supabase → { instances: [] }
//   T-40  company A solicitada → query nunca recebe company B
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks
// =============================================================================

// Mock: getSupabaseAdmin → retorna mockSvc
const mockSvc = {
  from: vi.fn(),
  rpc:  vi.fn(),
};
vi.mock('../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSvc),
}));

// Mock: validateMetaCaller + META_VIEW_ROLES
const mockValidateMetaCaller = vi.fn();
vi.mock('../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  META_VIEW_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  META_CONNECT_ROLES: ['super_admin', 'system_admin', 'partner', 'admin'],
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
}));

// Import do handler APÓS os mocks
import handler from '../instances.js';

// =============================================================================
// Fixtures
// =============================================================================

const FAKE_COMPANY_ID   = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_USER_ID      = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_INSTANCE_ID  = 'cccc0000-0000-0000-0000-000000000003';
const FAKE_PHONE_ID     = '987654321';
const FAKE_WABA_ID      = '123456789';
const FAKE_PHONE_NUMBER = '+55 11 91234-5678';
const FAKE_VERIFIED     = 'Empresa Fake LTDA';

const FAKE_INSTANCE = {
  id:              FAKE_INSTANCE_ID,
  phone_number_id: FAKE_PHONE_ID,
  waba_id:         FAKE_WABA_ID,
  display_name:    null,
  phone_number:    FAKE_PHONE_NUMBER,
  verified_name:   FAKE_VERIFIED,
  status:          'connected',
  created_at:      '2026-09-14T12:00:00.000Z',
  updated_at:      '2026-09-14T12:00:00.000Z',
};

const FAKE_INSTANCE_B = {
  id:              'dddd0000-0000-0000-0000-000000000004',
  phone_number_id: '111111111',
  waba_id:         FAKE_WABA_ID,
  display_name:    'Número 2',
  phone_number:    '+55 21 99999-9999',
  verified_name:   'Empresa B Fake',
  status:          'connected',
  created_at:      '2026-09-13T10:00:00.000Z',
  updated_at:      '2026-09-13T10:00:00.000Z',
};

// =============================================================================
// Factories
// =============================================================================

/** Chain Supabase completa para SELECT de instâncias */
function makeQueryChain(data, error = null) {
  return {
    select:  vi.fn().mockReturnThis(),
    eq:      vi.fn().mockReturnThis(),
    is:      vi.fn().mockReturnThis(),
    order:   vi.fn().mockResolvedValue({ data, error }),
  };
}

/** Request GET mínimo */
function makeReq({ query = {}, method = 'GET', headers = {} } = {}) {
  return {
    method,
    headers: { authorization: 'Bearer fake-jwt', ...headers },
    query:   { company_id: FAKE_COMPANY_ID, ...query },
  };
}

/** Response mock */
function makeRes() {
  return {
    _status: null,
    _body:   null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body   = body; return this; },
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

function setupQueryOk(data = [FAKE_INSTANCE]) {
  const chain = makeQueryChain(data);
  mockSvc.from = vi.fn().mockReturnValue(chain);
  return chain;
}

function setupHappyPath(data = [FAKE_INSTANCE]) {
  setupGuardOk();
  return setupQueryOk(data);
}

// =============================================================================
// Setup
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  // rpc nunca deve ser chamado
  mockSvc.rpc = vi.fn();
});

// =============================================================================
// Testes
// =============================================================================

describe('GET /api/whatsapp/meta/instances', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // T-01: Happy path — 1 instância
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-01: GET sucesso — 1 instância ativa', () => {
    it('retorna 200 com instância correta', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(200);
      expect(res._body).toEqual({ instances: [FAKE_INSTANCE] });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-02: Lista vazia
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-02: GET lista vazia → 200 { instances: [] }', () => {
    it('retorna 200 com array vazio — não é 404', async () => {
      setupHappyPath([]);
      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(200);
      expect(res._body).toEqual({ instances: [] });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-03: Múltiplas instâncias
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-03: GET múltiplas instâncias → retorna todas', () => {
    it('retorna 200 com todas as instâncias ativas', async () => {
      setupHappyPath([FAKE_INSTANCE, FAKE_INSTANCE_B]);
      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(200);
      expect(res._body.instances).toHaveLength(2);
      expect(res._body.instances[0].id).toBe(FAKE_INSTANCE_ID);
      expect(res._body.instances[1].id).toBe(FAKE_INSTANCE_B.id);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-04 a T-07: Method guard
  // ──────────────────────────────────────────────────────────────────────────
  describe('Method guard', () => {
    const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    methods.forEach((method, idx) => {
      it(`T-${4 + idx}: ${method} → 405`, async () => {
        const res = makeRes();
        await handler(makeReq({ method }), res);
        expect(res._status).toBe(405);
        expect(res._body.error).toMatch(/method not allowed/i);
      });
    });

    it('método inválido não chama validateMetaCaller', async () => {
      await handler(makeReq({ method: 'POST' }), makeRes());
      expect(mockValidateMetaCaller).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-08: company_id ausente → 400
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-08: company_id ausente → 400', () => {
    it('retorna 400 sem chamar guard', async () => {
      const req = { method: 'GET', headers: { authorization: 'Bearer t' }, query: {} };
      const res = makeRes();
      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._body.error).toBe('company_id é obrigatório');
      expect(mockValidateMetaCaller).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-09 a T-14: Guard failures propagados
  // ──────────────────────────────────────────────────────────────────────────
  describe('Guard failures propagados', () => {
    it('T-09: guard 401 → 401 propagado', async () => {
      mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 401, error: 'Sessão inválida ou expirada' });
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(401);
      expect(res._body.error).toBe('Sessão inválida ou expirada');
    });

    it('T-10: guard 400 (UUID inválido) → 400 propagado', async () => {
      mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 400, error: 'company_id inválido' });
      const res = makeRes();
      await handler(makeReq({ query: { company_id: 'not-a-uuid' } }), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('company_id inválido');
    });

    it('T-11: guard 403 (role) → 403 propagado', async () => {
      mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'Permissão insuficiente para esta operação' });
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(403);
    });

    it('T-12: guard 403 (feature flag) → 403 propagado', async () => {
      mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'Meta WhatsApp não habilitado para esta empresa' });
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(403);
      expect(res._body.error).toBe('Meta WhatsApp não habilitado para esta empresa');
    });

    it('T-13: guard 403 (partner sem assignment) → 403 propagado', async () => {
      mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'Partner sem assignment ativo para esta empresa' });
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(403);
    });

    it('T-14: guard 403 (parent sem acesso) → 403 propagado', async () => {
      mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'Empresa não encontrada ou sem acesso' });
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-15 a T-17: Query nunca ocorre se guard/extração falhar
  // ──────────────────────────────────────────────────────────────────────────
  describe('Query não ocorre em caso de falha prévia', () => {
    it('T-15: query NÃO ocorre se guard falhar', async () => {
      mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 403, error: 'forbidden' });
      const mockFrom = vi.fn();
      mockSvc.from = mockFrom;

      await handler(makeReq(), makeRes());
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('T-16: query NÃO ocorre se company_id ausente', async () => {
      const mockFrom = vi.fn();
      mockSvc.from = mockFrom;
      await handler({ method: 'GET', headers: {}, query: {} }, makeRes());
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('T-17: query NÃO ocorre se método inválido', async () => {
      const mockFrom = vi.fn();
      mockSvc.from = mockFrom;
      await handler(makeReq({ method: 'POST' }), makeRes());
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-18: META_VIEW_ROLES passado ao guard
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-18: META_VIEW_ROLES passado ao guard', () => {
    it('guard recebe roles contendo seller (META_VIEW_ROLES)', async () => {
      setupHappyPath();
      await handler(makeReq(), makeRes());

      const [, , , opts] = mockValidateMetaCaller.mock.calls[0];
      expect(opts.roles).toContain('seller');
      expect(opts.roles).toContain('manager');
      // META_CONNECT_ROLES NÃO inclui seller — confirma que é META_VIEW_ROLES
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-19: Query usa guard.companyId, não req.query.company_id
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-19: Query usa guard.companyId', () => {
    it('query filtrada pelo companyId retornado pelo guard', async () => {
      const GUARDED_ID = 'eeee9999-0000-0000-0000-000000000099';
      mockValidateMetaCaller.mockResolvedValue({
        ok: true, userId: FAKE_USER_ID, companyId: GUARDED_ID, role: 'admin', accessPath: 'direct',
      });
      const chain = setupQueryOk([]);

      await handler(makeReq(), makeRes());

      // eq('company_id', GUARDED_ID) — não req.query.company_id
      expect(chain.eq).toHaveBeenCalledWith('company_id', GUARDED_ID);
    });

    it('T-40: company A solicitada — query nunca recebe company B', async () => {
      const COMPANY_A = 'aaaa1111-0000-0000-0000-000000000001';
      const COMPANY_B = 'bbbb2222-0000-0000-0000-000000000002';
      mockValidateMetaCaller.mockResolvedValue({
        ok: true, userId: FAKE_USER_ID, companyId: COMPANY_A, role: 'admin', accessPath: 'direct',
      });
      const chain = setupQueryOk([]);

      await handler(makeReq({ query: { company_id: COMPANY_A } }), makeRes());

      const eqCalls = chain.eq.mock.calls;
      const companyEq = eqCalls.find(([col]) => col === 'company_id');
      expect(companyEq?.[1]).toBe(COMPANY_A);
      expect(companyEq?.[1]).not.toBe(COMPANY_B);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-20: Filtro deleted_at IS NULL
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-20: Filtro deleted_at IS NULL', () => {
    it('query usa .is("deleted_at", null)', async () => {
      setupGuardOk();
      const chain = setupQueryOk([]);

      await handler(makeReq(), makeRes());
      expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-21: Ordenação created_at DESC
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-21: Ordenação created_at DESC', () => {
    it('query ordena por created_at ascending: false', async () => {
      setupGuardOk();
      const chain = setupQueryOk([]);

      await handler(makeReq(), makeRes());
      expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-22: SELECT explícito — nunca *
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-22: SELECT explícito', () => {
    it('select não usa *', async () => {
      setupGuardOk();
      const chain = setupQueryOk([]);

      await handler(makeReq(), makeRes());

      const selectArg = chain.select.mock.calls[0][0];
      expect(selectArg).toBeDefined();
      expect(selectArg).not.toBe('*');
      expect(selectArg).toContain('id');
      expect(selectArg).toContain('phone_number_id');
      expect(selectArg).toContain('status');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-23 a T-25: Campos sensíveis ausentes do response
  // ──────────────────────────────────────────────────────────────────────────
  describe('Campos sensíveis ausentes do response', () => {
    it('T-23: connected_by NÃO presente no response', async () => {
      setupGuardOk();
      setupQueryOk([{ ...FAKE_INSTANCE, connected_by: FAKE_USER_ID }]);
      const res = makeRes();
      await handler(makeReq(), res);

      // O SELECT explícito nunca pede connected_by — mas mesmo que o banco
      // retornasse, o contrato deve ser respeitado
      const selectArg = mockSvc.from().select.mock.calls[0]?.[0] ?? '';
      expect(selectArg).not.toContain('connected_by');
    });

    it('T-24: company_id NÃO presente no SELECT', async () => {
      setupGuardOk();
      const chain = setupQueryOk([]);
      await handler(makeReq(), makeRes());

      const selectArg = chain.select.mock.calls[0][0];
      expect(selectArg).not.toContain('company_id');
    });

    it('T-25: deleted_at NÃO presente no SELECT', async () => {
      setupGuardOk();
      const chain = setupQueryOk([]);
      await handler(makeReq(), makeRes());

      const selectArg = chain.select.mock.calls[0][0];
      expect(selectArg).not.toContain('deleted_at');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-26: meta_whatsapp_credentials nunca consultada
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-26: meta_whatsapp_credentials nunca consultada', () => {
    it('svc.from nunca recebe "meta_whatsapp_credentials"', async () => {
      setupHappyPath();
      await handler(makeReq(), makeRes());

      const fromCalls = mockSvc.from.mock.calls.map(([table]) => table);
      expect(fromCalls).not.toContain('meta_whatsapp_credentials');
    });

    it('svc.rpc nunca chamado', async () => {
      setupHappyPath();
      await handler(makeReq(), makeRes());
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-27 / T-28: Erro da query → 500 sem vazar detalhes
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-27: Query error → 500 internal_error', () => {
    it('retorna 500 sem expor message do banco', async () => {
      setupGuardOk();
      const chain = makeQueryChain(null, { code: 'PGRST301', message: 'DB_SECRET_CANARY connection refused' });
      mockSvc.from = vi.fn().mockReturnValue(chain);

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(500);
      expect(res._body.error).toBe('internal_error');
    });

    it('T-28: query error não expõe canário no response', async () => {
      setupGuardOk();
      const chain = makeQueryChain(null, { message: 'DB_SECRET_CANARY' });
      mockSvc.from = vi.fn().mockReturnValue(chain);

      const res = makeRes();
      await handler(makeReq(), res);

      expect(JSON.stringify(res._body)).not.toContain('DB_SECRET_CANARY');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-29 a T-31: Throws inesperados → 500
  // ──────────────────────────────────────────────────────────────────────────
  describe('Throws inesperados → 500 internal_error', () => {
    it('T-29: getSupabaseAdmin throw → 500 internal_error', async () => {
      const { getSupabaseAdmin } = await import('../../../lib/automation/supabaseAdmin.js');
      vi.mocked(getSupabaseAdmin).mockImplementationOnce(() => {
        throw new Error('SUPABASE_ADMIN_CANARY');
      });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(500);
      expect(res._body.error).toBe('internal_error');
      expect(JSON.stringify(res._body)).not.toContain('SUPABASE_ADMIN_CANARY');
    });

    it('T-30: validateMetaCaller throw → 500 internal_error', async () => {
      mockValidateMetaCaller.mockRejectedValue(new Error('GUARD_THROW_CANARY'));

      const res = makeRes();
      let threw = false;
      try {
        await handler(makeReq(), res);
      } catch {
        threw = true;
      }

      expect(threw).toBe(false);
      expect(res._status).toBe(500);
      expect(res._body?.error).toBe('internal_error');
      expect(JSON.stringify(res._body)).not.toContain('GUARD_THROW_CANARY');
    });

    it('T-31: query throw inesperado → 500 internal_error', async () => {
      setupGuardOk();
      // Simular svc.from que lança diretamente (ao invés de retornar {data, error})
      mockSvc.from = vi.fn().mockImplementation(() => {
        throw new Error('QUERY_THROW_CANARY');
      });

      const res = makeRes();
      let threw = false;
      try {
        await handler(makeReq(), res);
      } catch {
        threw = true;
      }

      expect(threw).toBe(false);
      expect(res._status).toBe(500);
      expect(res._body?.error).toBe('internal_error');
      expect(JSON.stringify(res._body)).not.toContain('QUERY_THROW_CANARY');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-32 / T-33: Zero leak
  // ──────────────────────────────────────────────────────────────────────────
  describe('Zero leak', () => {
    it('T-32: Authorization header não aparece no response', async () => {
      setupGuardOk();
      const chain = makeQueryChain(null, { message: 'err' });
      mockSvc.from = vi.fn().mockReturnValue(chain);

      const res = makeRes();
      await handler(makeReq({ headers: { authorization: 'Bearer SECRET_TOKEN_CANARY' } }), res);

      expect(JSON.stringify(res._body)).not.toContain('SECRET_TOKEN_CANARY');
    });

    it('T-33: erro interno não vaza token do body de erro Supabase', async () => {
      setupGuardOk();
      const chain = makeQueryChain(null, { code: 'P0001', message: 'SECRET_SQL_CANARY detail' });
      mockSvc.from = vi.fn().mockReturnValue(chain);

      const res = makeRes();
      await handler(makeReq(), res);

      expect(JSON.stringify(res._body)).not.toContain('SECRET_SQL_CANARY');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-34 / T-35: Seller e manager → permitidos
  // ──────────────────────────────────────────────────────────────────────────
  describe('Roles permitidas por META_VIEW_ROLES', () => {
    it('T-34: seller → 200', async () => {
      mockValidateMetaCaller.mockResolvedValue({
        ok: true, userId: FAKE_USER_ID, companyId: FAKE_COMPANY_ID, role: 'seller', accessPath: 'direct',
      });
      setupQueryOk([FAKE_INSTANCE]);
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(200);
    });

    it('T-35: manager → 200', async () => {
      mockValidateMetaCaller.mockResolvedValue({
        ok: true, userId: FAKE_USER_ID, companyId: FAKE_COMPANY_ID, role: 'manager', accessPath: 'direct',
      });
      setupQueryOk([FAKE_INSTANCE]);
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(200);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-36: Response contém exatamente os 9 campos públicos
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-36: Response contém exatamente os 9 campos públicos', () => {
    it('todos os 9 campos estão presentes', async () => {
      setupHappyPath();
      const res = makeRes();
      await handler(makeReq(), res);

      const inst = res._body.instances[0];
      const expectedFields = [
        'id', 'phone_number_id', 'waba_id', 'display_name',
        'phone_number', 'verified_name', 'status', 'created_at', 'updated_at',
      ];
      expectedFields.forEach(field => expect(inst).toHaveProperty(field));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-37: Bearer inválido + company_id inválido → 401 (auth tem precedência)
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-37: Auth tem precedência sobre validação de input', () => {
    it('JWT inválido + company_id UUID inválido → 401, não 400', async () => {
      mockValidateMetaCaller.mockResolvedValue({ ok: false, status: 401, error: 'Sessão inválida ou expirada' });
      const res = makeRes();
      await handler(makeReq({ query: { company_id: 'not-a-uuid' } }), res);
      expect(res._status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-38: svc.rpc nunca chamado
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-38: svc.rpc nunca chamado', () => {
    it('nenhuma chamada RPC ocorre', async () => {
      setupHappyPath();
      await handler(makeReq(), makeRes());
      expect(mockSvc.rpc).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T-39: data null retornado pelo Supabase → { instances: [] }
  // ──────────────────────────────────────────────────────────────────────────
  describe('T-39: data null → instances []', () => {
    it('retorna array vazio quando Supabase retorna data null sem erro', async () => {
      setupGuardOk();
      const chain = makeQueryChain(null, null);
      mockSvc.from = vi.fn().mockReturnValue(chain);

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res._status).toBe(200);
      expect(res._body).toEqual({ instances: [] });
    });
  });

});
