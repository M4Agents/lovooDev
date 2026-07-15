// =============================================================================
// api/agents/__tests__/company-agents-grouping.test.js
//
// Testes de validação de message_grouping_window_s nos endpoints de agentes.
//
// COBERTURA (30 casos):
//   TC-V01–TC-V08  validateMessageGroupingWindowS — função pura
//   TC-C01–TC-C09  company-agents-create handler
//   TC-U01–TC-U09  company-agents-update handler
//   TC-R01–TC-R04  Regressão: roles + multi-tenant (handler)
//
// PRINCÍPIOS:
//   - TC-V*: testam apenas a função pura exportada — sem mocks de Supabase.
//   - TC-C* / TC-U*: testam o handler com supabase e deps completamente mockados.
//   - vi.hoisted define env vars ANTES que os módulos sejam importados.
//   - Nenhuma chamada real a banco, LLM ou rede.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisting: env vars e mocks de supabase devem estar prontos antes dos imports ─

const {
  mockAdminFrom,
  mockAdminClient,
  mockCallerGetUser,
  mockCallerFrom,
  mockCallerClient,
} = vi.hoisted(() => {
  // Env vars necessárias antes da importação dos handlers
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-svc-key';
  process.env.VITE_SUPABASE_ANON_KEY    = 'test-anon-key';

  function makeChain(data, error = null) {
    const chain = {
      _data: { data, error },
      select:     vi.fn().mockReturnThis(),
      eq:         vi.fn().mockReturnThis(),
      insert:     vi.fn().mockReturnThis(),
      update:     vi.fn().mockReturnThis(),
      count:      vi.fn().mockReturnThis(),
      head:       vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
      single:      vi.fn(),
    };
    chain.maybeSingle.mockResolvedValue({ data, error });
    chain.single.mockResolvedValue({ data, error });
    return chain;
  }

  const mockAdminFrom = vi.fn();
  const mockAdminClient = { from: mockAdminFrom, rpc: vi.fn() };

  const mockCallerGetUser = vi.fn();
  const mockCallerFrom    = vi.fn();
  const mockCallerClient  = {
    auth: { getUser: mockCallerGetUser },
    from: mockCallerFrom,
  };

  return { mockAdminFrom, mockAdminClient, mockCallerGetUser, mockCallerFrom, mockCallerClient, makeChain };
});

// ── Mocks de módulos ──────────────────────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockImplementation((_url, key) =>
    key === 'test-svc-key' ? mockAdminClient : mockCallerClient
  ),
}));

vi.mock('../../lib/plans/limitChecker.js', () => ({
  getPlanLimits: vi.fn().mockResolvedValue({ features: { multiple_agents_enabled: true } }),
  checkFeature:  vi.fn().mockReturnValue(true),
}));

vi.mock('../../lib/agents/promptConfigValidator.js', () => ({
  validatePromptConfig: vi.fn().mockReturnValue({ ok: true }),
}));

vi.mock('../../lib/agents/promptAssembler.js', () => ({
  assemblePrompt: vi.fn().mockReturnValue({ ok: true, result: { prompt: 'test-prompt' } }),
}));

vi.mock('../../lib/agents/validTools.js', () => ({
  VALID_TOOL_NAMES: new Set(['send_message', 'send_media']),
}));

vi.mock('../../lib/agents/promptTemplate.js', () => ({
  validatePromptConfig: vi.fn().mockReturnValue({ valid: true }),
  buildPromptFromConfig: vi.fn().mockReturnValue('test-prompt'),
}));

vi.mock('../../lib/agents/kbContentValidator.js', () => ({
  detectOperationalContent:  vi.fn().mockReturnValue({ score: 0, flags: [] }),
  OPERATIONAL_SCORE_THRESHOLD: 5,
}));

// ── Imports (após mocks) ──────────────────────────────────────────────────────

import { validateMessageGroupingWindowS } from '../../lib/agents/modelConfigValidator.js';
import createHandler from '../company-agents-create.js';
import updateHandler from '../company-agents-update.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(body = {}, method = 'POST') {
  return {
    method,
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
  const chain = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    insert:      vi.fn().mockReturnThis(),
    update:      vi.fn().mockReturnThis(),
    count:       vi.fn().mockReturnThis(),
    head:        vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    single:      vi.fn().mockResolvedValue({ data, error }),
  };
  return chain;
}

// Usuário admin válido (para testes que precisam passar pela auth)
const MOCK_USER       = { id: 'user-uuid-001' };
const MOCK_MEMBERSHIP = { role: 'admin', company_id: 'company-uuid-001' };
const MOCK_AGENT      = {
  id: 'agent-uuid-001', company_id: 'company-uuid-001', agent_type: 'conversational',
  prompt_version: 1, name: 'Test Agent', model_config: { media_max_per_call: 1 },
};

function setupAdminAuth() {
  mockCallerGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
  mockCallerFrom.mockReturnValue(makeChain(MOCK_MEMBERSHIP));
}

// =============================================================================
// Bloco 1: validateMessageGroupingWindowS — função pura
// =============================================================================

describe('TC-V01–TC-V08: validateMessageGroupingWindowS (função pura)', () => {

  it('TC-V01 ausente (undefined) → null (permitido)', () => {
    expect(validateMessageGroupingWindowS(undefined)).toBeNull();
  });

  it('TC-V02 null → null (permitido)', () => {
    expect(validateMessageGroupingWindowS(null)).toBeNull();
  });

  it('TC-V03 0 → null (permitido — desabilitado explicitamente)', () => {
    expect(validateMessageGroupingWindowS(0)).toBeNull();
  });

  it('TC-V04 1 → null (mínimo válido)', () => {
    expect(validateMessageGroupingWindowS(1)).toBeNull();
  });

  it('TC-V05 120 → null (máximo válido)', () => {
    expect(validateMessageGroupingWindowS(120)).toBeNull();
  });

  it('TC-V06 121 → erro (acima do máximo)', () => {
    expect(validateMessageGroupingWindowS(121)).toMatch(/120/);
  });

  it('TC-V07 -1 → erro (negativo)', () => {
    expect(validateMessageGroupingWindowS(-1)).toMatch(/0/);
  });

  it('TC-V08 string → erro (tipo inválido)', () => {
    expect(validateMessageGroupingWindowS('30')).toMatch(/inteiro/);
  });

  it('TC-V09 decimal 1.5 → erro (não inteiro)', () => {
    expect(validateMessageGroupingWindowS(1.5)).toMatch(/inteiro/);
  });
});

// =============================================================================
// Bloco 2: company-agents-create — validação via handler
// =============================================================================

describe('TC-C01–TC-C09: company-agents-create — validação de model_config', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('TC-C01 window=121 → 400 antes da auth (sem mock de auth necessário)', async () => {
    const req = makeReq({
      company_id:   'company-uuid-001',
      name:         'Agente Teste',
      prompt:       'Você é um assistente.',
      model_config: { message_grouping_window_s: 121 },
    });
    const res = makeRes();
    await createHandler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/120/);
  });

  it('TC-C02 window=-1 → 400', async () => {
    const req = makeReq({
      company_id: 'company-uuid-001', name: 'A', prompt: 'P',
      model_config: { message_grouping_window_s: -1 },
    });
    const res = makeRes();
    await createHandler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/inteiro/);
  });

  it('TC-C03 window="abc" → 400', async () => {
    const req = makeReq({
      company_id: 'company-uuid-001', name: 'A', prompt: 'P',
      model_config: { message_grouping_window_s: 'abc' },
    });
    const res = makeRes();
    await createHandler(req, res);
    expect(res._status).toBe(400);
  });

  it('TC-C04 window=1.5 → 400 (decimal)', async () => {
    const req = makeReq({
      company_id: 'company-uuid-001', name: 'A', prompt: 'P',
      model_config: { message_grouping_window_s: 1.5 },
    });
    const res = makeRes();
    await createHandler(req, res);
    expect(res._status).toBe(400);
  });

  it('TC-C05 window=0 → passa validação e chega na auth (401 sem token válido)', async () => {
    // Sem mock de auth → validateCaller retorna 401 (anonKey vazio → token inválido)
    // O importante é que o status NÃO é 400 (a validação passou)
    mockCallerGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    const req = makeReq({
      company_id: 'company-uuid-001', name: 'A', prompt: 'P',
      model_config: { message_grouping_window_s: 0 },
    });
    const res = makeRes();
    await createHandler(req, res);
    expect(res._status).not.toBe(400); // validação passou
  });

  it('TC-C06 window=30 → passa validação (não retorna 400)', async () => {
    mockCallerGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    const req = makeReq({
      company_id: 'company-uuid-001', name: 'A', prompt: 'P',
      model_config: { message_grouping_window_s: 30 },
    });
    const res = makeRes();
    await createHandler(req, res);
    expect(res._status).not.toBe(400);
  });

  it('TC-C07 window ausente → passa validação (não retorna 400)', async () => {
    mockCallerGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    const req = makeReq({
      company_id: 'company-uuid-001', name: 'A', prompt: 'P',
      model_config: {},
    });
    const res = makeRes();
    await createHandler(req, res);
    expect(res._status).not.toBe(400);
  });

  it('TC-C08 role manager → 403 (regressão de role)', async () => {
    mockCallerGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
    mockCallerFrom.mockReturnValue(makeChain({ role: 'manager', company_id: 'company-uuid-001' }));
    const req = makeReq({
      company_id: 'company-uuid-001', name: 'A', prompt: 'P',
    });
    const res = makeRes();
    await createHandler(req, res);
    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/Permissão/);
  });

  it('TC-C09 role seller → 403 (regressão de role)', async () => {
    mockCallerGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
    mockCallerFrom.mockReturnValue(makeChain({ role: 'seller', company_id: 'company-uuid-001' }));
    const req = makeReq({
      company_id: 'company-uuid-001', name: 'A', prompt: 'P',
    });
    const res = makeRes();
    await createHandler(req, res);
    expect(res._status).toBe(403);
  });
});

// =============================================================================
// Bloco 3: company-agents-update — validação via handler
// =============================================================================

describe('TC-U01–TC-U09: company-agents-update — validação de model_config', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('TC-U01 window=121 → 400 antes da auth', async () => {
    const req = makeReq({
      company_id:   'company-uuid-001',
      agent_id:     'agent-uuid-001',
      prompt:       'P',
      model_config: { message_grouping_window_s: 121 },
    });
    const res = makeRes();
    await updateHandler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/120/);
  });

  it('TC-U02 window=-1 → 400', async () => {
    const req = makeReq({
      company_id: 'c', agent_id: 'a', prompt: 'P',
      model_config: { message_grouping_window_s: -1 },
    });
    const res = makeRes();
    await updateHandler(req, res);
    expect(res._status).toBe(400);
  });

  it('TC-U03 window="abc" → 400', async () => {
    const req = makeReq({
      company_id: 'c', agent_id: 'a', prompt: 'P',
      model_config: { message_grouping_window_s: 'abc' },
    });
    const res = makeRes();
    await updateHandler(req, res);
    expect(res._status).toBe(400);
  });

  it('TC-U04 window=1.5 → 400', async () => {
    const req = makeReq({
      company_id: 'c', agent_id: 'a', prompt: 'P',
      model_config: { message_grouping_window_s: 1.5 },
    });
    const res = makeRes();
    await updateHandler(req, res);
    expect(res._status).toBe(400);
  });

  it('TC-U05 window=0 → passa validação (não retorna 400)', async () => {
    mockCallerGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    const req = makeReq({
      company_id: 'c', agent_id: 'a', prompt: 'P',
      model_config: { message_grouping_window_s: 0 },
    });
    const res = makeRes();
    await updateHandler(req, res);
    expect(res._status).not.toBe(400);
  });

  it('TC-U06 window=120 → passa validação (não retorna 400)', async () => {
    mockCallerGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    const req = makeReq({
      company_id: 'c', agent_id: 'a', prompt: 'P',
      model_config: { message_grouping_window_s: 120 },
    });
    const res = makeRes();
    await updateHandler(req, res);
    expect(res._status).not.toBe(400);
  });

  it('TC-U07 window ausente → passa validação (não retorna 400)', async () => {
    mockCallerGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    const req = makeReq({
      company_id: 'c', agent_id: 'a', prompt: 'P',
      model_config: {},
    });
    const res = makeRes();
    await updateHandler(req, res);
    expect(res._status).not.toBe(400);
  });

  it('TC-U08 role manager → 403 (regressão de role)', async () => {
    mockCallerGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
    mockCallerFrom.mockReturnValue(makeChain({ role: 'manager', company_id: 'company-uuid-001' }));
    const req = makeReq({
      company_id: 'company-uuid-001', agent_id: 'agent-uuid-001', prompt: 'P',
    });
    const res = makeRes();
    await updateHandler(req, res);
    expect(res._status).toBe(403);
  });

  it('TC-U09 agente de outra empresa → 404 (regressão multi-tenant)', async () => {
    setupAdminAuth();
    // supabaseAdmin retorna null para lovoo_agents (agente não pertence a esta empresa)
    mockAdminFrom.mockReturnValue(makeChain(null));
    const req = makeReq({
      company_id: 'company-uuid-001',
      agent_id:   'agent-outra-empresa',
      prompt:     'P',
    });
    const res = makeRes();
    await updateHandler(req, res);
    expect(res._status).toBe(404);
    expect(res._body.error).toMatch(/não encontrado/);
  });
});
