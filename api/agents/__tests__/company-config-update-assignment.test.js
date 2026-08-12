// =============================================================================
// api/agents/__tests__/company-config-update-assignment.test.js
//
// Validação específica do endpoint:
//   POST /api/agents/company-config-update-assignment
//
// COBERTURA (6 casos):
//   TC-HM-01  history_mode = 'mem_block'  → HTTP 200
//   TC-HM-02  history_mode = 'multi_turn' → HTTP 200
//   TC-HM-03  history_mode = 'invalid'    → HTTP 400
//   TC-HM-04  history_mode ausente        → HTTP 200 (update normal sem alterar o campo)
//   TC-HM-05  role não autorizada (manager) → HTTP 403
//   TC-HM-06  company_id de outro tenant  → HTTP 404 (assignment não encontrado)
//
// PRINCÍPIOS:
//   - vi.hoisted define env vars e mocks antes da importação do módulo.
//   - Supabase completamente mockado — sem chamadas reais de rede ou banco.
//   - validateOperatingSchedule mockado para isolar lógica de schedule.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisting ──────────────────────────────────────────────────────────────────

const {
  mockAdminFrom,
  mockAdminClient,
  mockCallerGetUser,
  mockCallerFrom,
  mockCallerClient,
} = vi.hoisted(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-svc-key';
  process.env.VITE_SUPABASE_ANON_KEY    = 'test-anon-key';

  const mockAdminFrom    = vi.fn();
  const mockAdminClient  = { from: mockAdminFrom };
  const mockCallerGetUser = vi.fn();
  const mockCallerFrom   = vi.fn();
  const mockCallerClient = {
    auth: { getUser: mockCallerGetUser },
    from:  mockCallerFrom,
  };
  return { mockAdminFrom, mockAdminClient, mockCallerGetUser, mockCallerFrom, mockCallerClient };
});

// ── Mocks de módulos ──────────────────────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockImplementation((_url, key) =>
    key === 'test-svc-key' ? mockAdminClient : mockCallerClient
  ),
}));

vi.mock('../../lib/agents/scheduleValidator.js', () => ({
  validateOperatingSchedule: vi.fn().mockReturnValue({ valid: true }),
}));

// ── Imports (após mocks) ──────────────────────────────────────────────────────

import handler from '../company-config-update-assignment.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(body = {}) {
  return {
    method:  'POST',
    headers: { authorization: 'Bearer test-jwt-token' },
    body,
  };
}

function makeRes() {
  const res = {
    _status: null,
    _body:   null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(code)    { this._status = code; return this; },
    json(body)      { this._body = body;   return this; },
    end()           { return this; },
  };
  return res;
}

function makeChain(data, error = null) {
  const self = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    update:      vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    single:      vi.fn().mockResolvedValue({ data, error }),
  };
  return self;
}

// Entidades mock reutilizáveis
const COMPANY_ID    = 'company-aaa';
const ASSIGNMENT_ID = 'assign-bbb';
const USER_ID       = 'user-ccc';

const MOCK_USER       = { id: USER_ID };
const MOCK_ASSIGNMENT = { id: ASSIGNMENT_ID, company_id: COMPANY_ID, agent_id: 'agent-ddd' };
const MOCK_UPDATED    = {
  id: ASSIGNMENT_ID, is_active: true, agent_id: 'agent-ddd',
  capabilities: {}, price_display_policy: 'disabled',
  operating_schedule: null,
  follow_up_enabled: false, follow_up_absence_hours: 2,
  follow_up_max_attempts: 3, follow_up_interval_hours: 24,
  completion_triggers: [], respond_on_activation: false,
  history_mode: 'mem_block', updated_at: '2026-08-12T00:00:00Z',
};

// Configura auth: usuário válido + membership com role fornecida
function setupAuth(role = 'admin') {
  mockCallerGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
  mockCallerFrom.mockReturnValue(makeChain({ role }));
}

// Configura admin client: assignment encontrado + update bem-sucedido
function setupAdminSuccess(historyMode = 'mem_block') {
  const updated = { ...MOCK_UPDATED, history_mode: historyMode };
  // chamada 1: verificar que assignment pertence à empresa
  // chamada 2: update (retorna updated)
  let call = 0;
  mockAdminFrom.mockImplementation(() => {
    call++;
    if (call === 1) return makeChain(MOCK_ASSIGNMENT);   // select cross-tenant guard
    return makeChain(updated);                            // update
  });
}

// =============================================================================
// Testes
// =============================================================================

describe('TC-HM: company-config-update-assignment — history_mode', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── TC-HM-01: mem_block aceito ─────────────────────────────────────────────
  it('TC-HM-01 history_mode = mem_block → HTTP 200', async () => {
    setupAuth('admin');
    setupAdminSuccess('mem_block');

    const res = makeRes();
    await handler(makeReq({ company_id: COMPANY_ID, assignment_id: ASSIGNMENT_ID, history_mode: 'mem_block' }), res);

    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.data.history_mode).toBe('mem_block');
  });

  // ── TC-HM-02: multi_turn aceito ────────────────────────────────────────────
  it('TC-HM-02 history_mode = multi_turn → HTTP 200', async () => {
    setupAuth('admin');
    setupAdminSuccess('multi_turn');

    const res = makeRes();
    await handler(makeReq({ company_id: COMPANY_ID, assignment_id: ASSIGNMENT_ID, history_mode: 'multi_turn' }), res);

    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.data.history_mode).toBe('multi_turn');
  });

  // ── TC-HM-03: valor inválido → 400 ────────────────────────────────────────
  it('TC-HM-03 history_mode = invalid → HTTP 400', async () => {
    setupAuth('admin');

    const res = makeRes();
    await handler(makeReq({ company_id: COMPANY_ID, assignment_id: ASSIGNMENT_ID, history_mode: 'invalid' }), res);

    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/history_mode/i);
    // garante que o banco NÃO foi acionado
    expect(mockAdminFrom).not.toHaveBeenCalled();
  });

  // ── TC-HM-04: ausente → update normal sem tocar history_mode ─────────────
  it('TC-HM-04 history_mode ausente → HTTP 200, campo não incluído no payload', async () => {
    setupAuth('admin');
    setupAdminSuccess('mem_block');

    const res = makeRes();
    await handler(makeReq({ company_id: COMPANY_ID, assignment_id: ASSIGNMENT_ID, is_active: true }), res);

    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);

    // Verifica que o update chamado não enviou history_mode (whitelist não incluiu)
    const updateChain = mockAdminFrom.mock.results[1]?.value;
    const updateCall  = updateChain?.update?.mock?.calls?.[0]?.[0] ?? {};
    expect(updateCall).not.toHaveProperty('history_mode');
  });

  // ── TC-HM-05: role não autorizada → 403 ───────────────────────────────────
  it('TC-HM-05 role = manager → HTTP 403', async () => {
    setupAuth('manager');
    // admin client não precisa ser configurado — deve ser bloqueado antes

    const res = makeRes();
    await handler(makeReq({ company_id: COMPANY_ID, assignment_id: ASSIGNMENT_ID, history_mode: 'mem_block' }), res);

    expect(res._status).toBe(403);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/permiss/i);
  });

  // ── TC-HM-06: company_id de outro tenant → 404 ────────────────────────────
  it('TC-HM-06 assignment de outro tenant → HTTP 404', async () => {
    setupAuth('admin');
    // cross-tenant: assignment não encontrado nesta empresa
    mockAdminFrom.mockReturnValue(makeChain(null));

    const res = makeRes();
    await handler(makeReq({ company_id: 'company-OUTRO', assignment_id: ASSIGNMENT_ID, history_mode: 'mem_block' }), res);

    expect(res._status).toBe(404);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/assignment/i);
  });

});
