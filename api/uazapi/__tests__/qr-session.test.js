import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminCredentialError } from '../../lib/uazapi/adminCredential.js';
import handler from '../qr-session.js';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const USER = { id: 'user-1' };

const state = {
  user: { user: USER, error: null },
  access: { ok: true, userId: USER.id, role: 'admin', scope: 'company' },
  session: async () => ({
    success: true,
    data: {
      temp_instance_id: 'temp-1',
      qrcode: 'qr-fixture',
      expires_at: '2026-11-04T12:02:00.000Z',
      instance_name: 'Comercial',
      company_id: COMPANY,
    },
  }),
};

vi.mock('../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => ({ from() { return {}; } }),
}));

vi.mock('../../lib/dashboard/auth.js', () => ({
  extractToken: (header) => (typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null),
  getUserFromToken: async () => state.user,
}));

vi.mock('../../lib/uazapi/qrAuthorization.js', () => ({
  authorizeQrSession: async () => state.access,
}));

const { sessionError } = vi.hoisted(() => {
  class QrSessionError extends Error {
    constructor(code, status, publicMessage, extra) {
      super(publicMessage);
      this.code = code;
      this.status = status;
      this.publicMessage = publicMessage;
      this.extra = extra;
    }
  }
  return { sessionError: QrSessionError };
});

vi.mock('../../lib/uazapi/qrSession.js', () => ({
  createQrSession: (...args) => state.session(...args),
  QrSessionError: sessionError,
}));

function response() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
    end() {},
  };
}

function request(patch = {}) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer session-token' },
    body: { company_id: COMPANY, instance_name: 'Comercial', user_id: 'intruso' },
    ...patch,
  };
}

describe('POST /api/uazapi/qr-session', () => {
  beforeEach(() => {
    state.user = { user: USER, error: null };
    state.access = { ok: true, userId: USER.id, role: 'admin', scope: 'company' };
    state.session = async () => ({
      success: true,
      data: {
        temp_instance_id: 'temp-1',
        qrcode: 'qr-fixture',
        expires_at: '2026-11-04T12:02:00.000Z',
        instance_name: 'Comercial',
        company_id: COMPANY,
      },
    });
    vi.stubGlobal('fetch', () => {
      throw new Error('chamada de rede bloqueada no teste');
    });
  });

  it('responde 401 com JWT ausente ou inválido e não cria a sessão', async () => {
    state.session = async () => { throw new Error('não deveria criar'); };
    const missing = response();
    await handler(request({ headers: {} }), missing);
    expect(missing.statusCode).toBe(401);

    state.user = { user: null, error: new Error('jwt expirado') };
    const invalid = response();
    await handler(request(), invalid);
    expect(invalid.statusCode).toBe(401);
    expect(JSON.stringify(invalid.body)).not.toContain('jwt');
  });

  it('responde 403 para empresa não relacionada', async () => {
    state.access = { ok: false, status: 403, error: 'Permissão insuficiente para esta operação' };
    state.session = async () => { throw new Error('não deveria criar'); };
    const res = response();
    await handler(request({ body: { company_id: '33333333-3333-4333-8333-333333333333', instance_name: 'Comercial' } }), res);
    expect(res.statusCode).toBe(403);
  });

  it('responde 401 sem autenticação', async () => {
    const res = response();
    await handler(request({ headers: {} }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ success: false, error: 'Não autenticado' });
  });

  it('responde 403 sem autorização e não inicia o QR', async () => {
    state.access = { ok: false, status: 403, error: 'Permissão insuficiente para esta operação' };
    state.session = async () => { throw new Error('não deveria criar'); };
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(403);
  });

  it('responde 503 quando a credencial administrativa não está disponível', async () => {
    state.session = async () => { throw new AdminCredentialError(); };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('fixture-admin-not-real');
    expect(JSON.stringify(error.mock.calls)).not.toContain('UAZAPI_ADMIN_TOKEN');
  });

  it('devolve o contrato público do QR', async () => {
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      temp_instance_id: 'temp-1',
      qrcode: 'qr-fixture',
      company_id: COMPANY,
    });
    expect(res.body.data.uazapi_token).toBeUndefined();
    expect(res.body.data.token).toBeUndefined();
  });

  it('recuperação não devolve credencial', async () => {
    state.session = async () => {
      throw new sessionError('in_progress', 409, 'A geração desta instância já está em andamento. Tente novamente em instantes.', {
        recovery: {
          temp_instance_id: 'temp-1',
          instance_name: 'Comercial',
          company_id: COMPANY,
          status: 'creating',
          uazapi_token: 'fixture-instance-not-real',
          admintoken: 'fixture-admin-not-real',
        },
      });
    };
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.data).toEqual({
      temp_instance_id: 'temp-1',
      instance_name: 'Comercial',
      company_id: COMPANY,
      status: 'creating',
    });
    expect(JSON.stringify(res.body)).not.toContain('fixture-instance-not-real');
    expect(JSON.stringify(res.body)).not.toContain('fixture-admin-not-real');
  });
});
