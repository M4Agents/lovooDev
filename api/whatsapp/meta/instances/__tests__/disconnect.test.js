// =============================================================================
// disconnect.test.js
//
// Testes unitários para api/whatsapp/meta/instances/disconnect.js
// Todos os testes usam mocks — sem banco, rede, Graph, SQL WRITE ou token real.
// Nenhum teste desconecta instância real, envia mensagem ou altera credencial.
//
// COBERTURA:
//   DC-01   desconexão autorizada (connected → disconnected)
//   DC-02   usuário não autenticado
//   DC-03   role sem permissão (seller / manager)
//   DC-04   partner sem assignment
//   DC-05   instância de outra empresa → 404 opaco
//   DC-06   instância inexistente → 404
//   DC-07   instância já desconectada → 200 idempotente
//   DC-08   payload inválido
//   DC-09   método HTTP inválido
//   DC-10   UPDATE filtrado por company_id = auth.companyId
//   DC-11   deleted_at não entra no UPDATE
//   DC-12   phone_number_id e waba_id não entram no UPDATE
//   DC-13   credenciais nunca lidas/escritas
//   DC-14   falha de banco
//   DC-15   concorrência / idempotência
//   DC-16   resposta sem segredos
//   DC-20   ausência de Graph / Uazapi no módulo
//   DC-21   token_revoked / error → 409 (não reativa)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// =============================================================================
// Mocks (antes dos imports do handler)
// =============================================================================

const mockSvc = { from: vi.fn(), rpc: vi.fn() };
const mockGetSupabaseAdmin = vi.fn(() => mockSvc);

vi.mock('../../../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: (...args) => mockGetSupabaseAdmin(...args),
}));

const mockValidateMetaCaller = vi.fn();
vi.mock('../../../../lib/meta-whatsapp/validateMetaCaller.js', () => ({
  META_CONNECT_ROLES: ['super_admin', 'system_admin', 'partner', 'admin'],
  META_VIEW_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  META_SEND_ROLES:    ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'],
  validateMetaCaller: (...args) => mockValidateMetaCaller(...args),
}));

import handler from '../disconnect.js';
import { META_CONNECT_ROLES } from '../../../../lib/meta-whatsapp/validateMetaCaller.js';

// =============================================================================
// Fixtures — todos fictícios
// =============================================================================

const FAKE_COMPANY_ID   = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_OTHER_CO     = 'dddd0000-0000-0000-0000-000000000099';
const FAKE_USER_ID      = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_INSTANCE_ID  = 'cccc0000-0000-0000-0000-000000000003';

const FAKE_CONNECTED = { id: FAKE_INSTANCE_ID, status: 'connected' };
const FAKE_DISCONNECTED = { id: FAKE_INSTANCE_ID, status: 'disconnected' };

const HAPPY_BODY = {
  company_id:  FAKE_COMPANY_ID,
  instance_id: FAKE_INSTANCE_ID,
};

const DISCONNECT_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../disconnect.js'),
  'utf8',
);

// =============================================================================
// Chain factories
// =============================================================================

function makeSelectChain(data, error = null) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    is:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function makeUpdateChain(rows, error = null) {
  return {
    update: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue({ data: rows, error }),
  };
}

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

function setupGuardOk(role = 'admin', companyId = FAKE_COMPANY_ID) {
  mockValidateMetaCaller.mockResolvedValue({
    ok: true, userId: FAKE_USER_ID, companyId, role, accessPath: 'direct',
  });
}

function setupGuardFail(status, error) {
  mockValidateMetaCaller.mockResolvedValue({ ok: false, status, error });
}

function setupHappyPath() {
  setupGuardOk();
  const updateChain = makeUpdateChain([{ id: FAKE_INSTANCE_ID, status: 'disconnected' }]);
  const selectChain = makeSelectChain(FAKE_CONNECTED);
  mockSvc.from = vi.fn()
    .mockReturnValueOnce(selectChain)
    .mockReturnValueOnce(updateChain);
  return { selectChain, updateChain };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSupabaseAdmin.mockReset();
  mockGetSupabaseAdmin.mockImplementation(() => mockSvc);
});

// =============================================================================
// DC-01 — Desconexão autorizada
// =============================================================================

describe('DC-01: desconexão autorizada', () => {
  it('connected → 200 { ok, instance_id, status: disconnected }', async () => {
    const { updateChain } = setupHappyPath();
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      ok:          true,
      instance_id: FAKE_INSTANCE_ID,
      status:      'disconnected',
    });
    expect(updateChain.update).toHaveBeenCalledWith({ status: 'disconnected' });
  });

  it('validateMetaCaller recebe META_CONNECT_ROLES e company_id do body', async () => {
    setupHappyPath();
    await handler(makeReq(), makeRes());
    expect(mockValidateMetaCaller).toHaveBeenCalledWith(
      expect.anything(),
      mockSvc,
      FAKE_COMPANY_ID,
      { roles: META_CONNECT_ROLES },
    );
  });
});

// =============================================================================
// DC-02 — Não autenticado
// =============================================================================

describe('DC-02: usuário não autenticado', () => {
  it('sem Authorization → 401', async () => {
    setupGuardFail(401, 'Autenticação necessária');
    const res = makeRes();
    await handler(makeReq({ headers: { authorization: undefined } }), res);
    expect(res._status).toBe(401);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('JWT inválido → 401', async () => {
    setupGuardFail(401, 'Sessão inválida ou expirada');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(401);
  });
});

// =============================================================================
// DC-03 — Role sem permissão
// =============================================================================

describe('DC-03: role sem permissão', () => {
  it('seller → 403', async () => {
    setupGuardFail(403, 'Permissão insuficiente para esta operação');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(mockSvc.from).not.toHaveBeenCalled();
  });

  it('manager → 403', async () => {
    setupGuardFail(403, 'Permissão insuficiente para esta operação');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
  });
});

// =============================================================================
// DC-04 — Partner sem assignment
// =============================================================================

describe('DC-04: partner sem assignment', () => {
  it('guard 403 → zero UPDATE', async () => {
    setupGuardFail(403, 'Partner sem assignment ativo para esta empresa');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(403);
    expect(res._body.error).toBe('Partner sem assignment ativo para esta empresa');
    expect(mockSvc.from).not.toHaveBeenCalled();
  });
});

// =============================================================================
// DC-05 / DC-06 — Isolamento
// =============================================================================

describe('Tenant isolation', () => {
  it('DC-05: instância de outra empresa → 404 opaco', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'instance_not_found' });
  });

  it('DC-06: instância inexistente → 404', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'instance_not_found' });
  });

  it('soft-deleted (filtro deleted_at IS NULL) → 404 opaco', async () => {
    setupGuardOk();
    const selectChain = makeSelectChain(null);
    mockSvc.from = vi.fn().mockReturnValue(selectChain);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(selectChain.is).toHaveBeenCalledWith('deleted_at', null);
  });
});

// =============================================================================
// DC-07 — Já desconectada
// =============================================================================

describe('DC-07: instância já desconectada', () => {
  it('retorna 200 idempotente sem UPDATE', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(FAKE_DISCONNECTED));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      ok:          true,
      instance_id: FAKE_INSTANCE_ID,
      status:      'disconnected',
    });
    expect(mockSvc.from).toHaveBeenCalledTimes(1);
    expect(mockSvc.from).toHaveBeenCalledWith('meta_whatsapp_instances');
  });
});

// =============================================================================
// DC-08 — Payload inválido
// =============================================================================

describe('DC-08: payload inválido', () => {
  it('instance_id ausente → 400 invalid_request', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { company_id: FAKE_COMPANY_ID } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
  });

  it('instance_id inválido → 400 invalid_request', async () => {
    setupGuardOk();
    const res = makeRes();
    await handler(makeReq({ body: { company_id: FAKE_COMPANY_ID, instance_id: 'not-a-uuid' } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_request');
  });

  it('company_id inválido → contrato do guard (400)', async () => {
    setupGuardFail(400, 'company_id inválido');
    const res = makeRes();
    await handler(makeReq({ body: { company_id: 'not-a-uuid', instance_id: FAKE_INSTANCE_ID } }), res);
    expect(res._status).toBe(400);
  });

  it('campos proibidos no body são ignorados', async () => {
    const { updateChain } = setupHappyPath();
    const res = makeRes();
    await handler(makeReq({
      body: {
        ...HAPPY_BODY,
        status:               'connected',
        deleted_at:           '2026-01-01T00:00:00.000Z',
        phone_number_id:      '999999999',
        waba_id:              '888888888',
        access_token:         'EAAAN_injected',
        registration_pin_enc: 'v1:injected',
      },
    }), res);
    expect(res._status).toBe(200);
    expect(updateChain.update).toHaveBeenCalledWith({ status: 'disconnected' });
  });
});

// =============================================================================
// DC-09 — Método HTTP
// =============================================================================

describe('DC-09: método HTTP inválido', () => {
  it.each(['GET', 'PUT', 'PATCH', 'DELETE'])('%s → 405 + Allow: POST', async (method) => {
    const res = makeRes();
    await handler(makeReq({ method }), res);
    expect(res._status).toBe(405);
    expect(res._headers['Allow']).toBe('POST');
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
  });
});

// =============================================================================
// DC-10 — Filtro company_id
// =============================================================================

describe('DC-10: atualização filtrada por company_id', () => {
  it('SELECT e UPDATE usam auth.companyId, não body.company_id', async () => {
    setupGuardOk('admin', FAKE_OTHER_CO);
    const selectChain = makeSelectChain(FAKE_CONNECTED);
    const updateChain = makeUpdateChain([{ id: FAKE_INSTANCE_ID, status: 'disconnected' }]);
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce(updateChain);

    const res = makeRes();
    await handler(makeReq({ body: { company_id: FAKE_COMPANY_ID, instance_id: FAKE_INSTANCE_ID } }), res);

    expect(res._status).toBe(200);
    expect(selectChain.eq).toHaveBeenCalledWith('company_id', FAKE_OTHER_CO);
    expect(updateChain.eq).toHaveBeenCalledWith('company_id', FAKE_OTHER_CO);
    expect(selectChain.eq).not.toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
    expect(updateChain.eq).not.toHaveBeenCalledWith('company_id', FAKE_COMPANY_ID);
  });

  it('UPDATE também filtra id + status connected + deleted_at IS NULL', async () => {
    const { updateChain } = setupHappyPath();
    await handler(makeReq(), makeRes());
    expect(updateChain.eq).toHaveBeenCalledWith('id', FAKE_INSTANCE_ID);
    expect(updateChain.eq).toHaveBeenCalledWith('status', 'connected');
    expect(updateChain.is).toHaveBeenCalledWith('deleted_at', null);
  });
});

// =============================================================================
// DC-11 / DC-12 / DC-13 — Preservação
// =============================================================================

describe('Preservação de campos', () => {
  it('DC-11: UPDATE não envia deleted_at', async () => {
    const { updateChain } = setupHappyPath();
    await handler(makeReq(), makeRes());
    const payload = updateChain.update.mock.calls[0][0];
    expect(payload).toEqual({ status: 'disconnected' });
    expect(payload).not.toHaveProperty('deleted_at');
  });

  it('DC-12: UPDATE não envia phone_number_id nem waba_id', async () => {
    const { updateChain } = setupHappyPath();
    await handler(makeReq(), makeRes());
    const payload = updateChain.update.mock.calls[0][0];
    expect(payload).not.toHaveProperty('phone_number_id');
    expect(payload).not.toHaveProperty('waba_id');
    expect(Object.keys(payload)).toEqual(['status']);
  });

  it('DC-13: meta_whatsapp_credentials nunca é consultada', async () => {
    setupHappyPath();
    await handler(makeReq(), makeRes());
    const tables = mockSvc.from.mock.calls.map((c) => c[0]);
    expect(tables).not.toContain('meta_whatsapp_credentials');
    expect(tables.every((t) => t === 'meta_whatsapp_instances')).toBe(true);
    expect(mockSvc.rpc).not.toHaveBeenCalled();
  });
});

// =============================================================================
// DC-14 — Falha de banco
// =============================================================================

describe('DC-14: falha de banco', () => {
  it('SELECT com erro → 500, não trata como sucesso', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn().mockReturnValue(makeSelectChain(null, { message: 'SECRET_SQL_CANARY' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(res._body)).not.toContain('SECRET_SQL_CANARY');
  });

  it('UPDATE com erro → 500, não trata como sucesso', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_CONNECTED))
      .mockReturnValueOnce(makeUpdateChain(null, { message: 'SECRET_UPDATE_CANARY' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(res._body)).not.toContain('SECRET_UPDATE_CANARY');
  });

  it('getSupabaseAdmin throw → 500', async () => {
    mockGetSupabaseAdmin.mockImplementation(() => { throw new Error('no env'); });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
    expect(mockValidateMetaCaller).not.toHaveBeenCalled();
  });
});

// =============================================================================
// DC-15 — Concorrência / idempotência
// =============================================================================

describe('DC-15: concorrência e idempotência', () => {
  it('UPDATE 0 rows + reload disconnected → 200 idempotente', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_CONNECTED))
      .mockReturnValueOnce(makeUpdateChain([]))
      .mockReturnValueOnce(makeSelectChain(FAKE_DISCONNECTED));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body.status).toBe('disconnected');
  });

  it('UPDATE 0 rows + reload token_revoked → 409', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_CONNECTED))
      .mockReturnValueOnce(makeUpdateChain([]))
      .mockReturnValueOnce(makeSelectChain({ id: FAKE_INSTANCE_ID, status: 'token_revoked' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(409);
    expect(res._body.error).toBe('instance_state_conflict');
  });

  it('UPDATE 0 rows + reload error → 409', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_CONNECTED))
      .mockReturnValueOnce(makeUpdateChain([]))
      .mockReturnValueOnce(makeSelectChain({ id: FAKE_INSTANCE_ID, status: 'error' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(409);
    expect(res._body.error).toBe('instance_state_conflict');
  });

  it('UPDATE 0 rows + reload DB error → 500', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_CONNECTED))
      .mockReturnValueOnce(makeUpdateChain([]))
      .mockReturnValueOnce(makeSelectChain(null, { message: 'reload fail' }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
  });

  it('UPDATE 0 rows + instância sumiu → 404', async () => {
    setupGuardOk();
    mockSvc.from = vi.fn()
      .mockReturnValueOnce(makeSelectChain(FAKE_CONNECTED))
      .mockReturnValueOnce(makeUpdateChain([]))
      .mockReturnValueOnce(makeSelectChain(null));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(404);
    expect(res._body.error).toBe('instance_not_found');
  });
});

// =============================================================================
// DC-16 — Resposta sem segredos
// =============================================================================

describe('DC-16: resposta sem segredos', () => {
  it('sucesso não contém token, PIN, ciphertext, company_id ou deleted_at', async () => {
    setupHappyPath();
    const res = makeRes();
    await handler(makeReq(), res);
    const serialized = JSON.stringify(res._body);
    expect(serialized).not.toMatch(/access_token|registration_pin|ciphertext|Bearer|EAAAN|deleted_at|company_id/i);
    expect(res._body).not.toHaveProperty('phone_number_id');
    expect(res._body).not.toHaveProperty('waba_id');
  });
});

// =============================================================================
// DC-21 — Estados inseguros
// =============================================================================

describe('DC-21: token_revoked e error não são desconectados', () => {
  it.each(['token_revoked', 'error', 'unknown_state'])(
    'status %s → 409 instance_state_conflict sem UPDATE',
    async (status) => {
      setupGuardOk();
      mockSvc.from = vi.fn().mockReturnValue(makeSelectChain({ id: FAKE_INSTANCE_ID, status }));
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(409);
      expect(res._body.error).toBe('instance_state_conflict');
      expect(mockSvc.from).toHaveBeenCalledTimes(1);
    },
  );
});

// =============================================================================
// DC-20 — Sem Graph / Uazapi / credenciais no módulo
// =============================================================================

describe('DC-20: isolamento do módulo', () => {
  it('não importa Graph, crypto, Uazapi nem credentials', () => {
    expect(DISCONNECT_SRC).not.toMatch(/from ['"][^'"]*(graphClient|tokenCrypto|pinCrypto)/);
    expect(DISCONNECT_SRC).not.toMatch(/from ['"][^'"]*uazapi/i);
    expect(DISCONNECT_SRC).not.toMatch(/whatsapp_life_instances/);
    expect(DISCONNECT_SRC).not.toMatch(/from\(['"]meta_whatsapp_credentials['"]\)/);
    expect(DISCONNECT_SRC).toContain('validateMetaCaller');
    expect(DISCONNECT_SRC).toContain('META_CONNECT_ROLES');
  });
});
