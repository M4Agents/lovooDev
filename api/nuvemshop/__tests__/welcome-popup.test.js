import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ role: 'manager' }));

vi.mock('../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => ({ tag: 'svc' }),
}));

vi.mock('../../lib/nuvemshop/validateNuvemshopCaller.js', async () => {
  const actual = await vi.importActual('../../lib/nuvemshop/validateNuvemshopCaller.js');
  return { ...actual, validateNuvemshopCaller: vi.fn() };
});

vi.mock('../../lib/nuvemshop/welcomePopupConfig.js', async () => {
  const actual = await vi.importActual('../../lib/nuvemshop/welcomePopupConfig.js');
  return {
    ...actual,
    getWelcomeCampaign: vi.fn(),
    saveWelcomeCampaign: vi.fn(),
  };
});

import handler from '../welcome-popup.js';
import { ALLOWED_ROLES, validateNuvemshopCaller } from '../../lib/nuvemshop/validateNuvemshopCaller.js';
import {
  getWelcomeCampaign,
  saveWelcomeCampaign,
  WELCOME_WRITE_ROLES,
} from '../../lib/nuvemshop/welcomePopupConfig.js';

const COMPANY_A = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413';
const COMPANY_B = '3cbe5c11-d834-40d1-b1cf-425e6377f099';
const STORE = '7680914';

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function request(method, { query, body, token = 'sessao' } = {}) {
  return {
    method,
    query,
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

beforeEach(() => {
  session.role = 'manager';
  vi.clearAllMocks();
  validateNuvemshopCaller.mockImplementation(async (req, _svc, companyId, options) => {
    if (!(req.headers?.authorization ?? '').startsWith('Bearer ')) {
      return { ok: false, status: 401, error: 'Autenticação necessária' };
    }
    if (companyId !== COMPANY_A) {
      return { ok: false, status: 403, error: 'Acesso negado a esta empresa' };
    }
    if (!options.roles.includes(session.role)) {
      return { ok: false, status: 403, error: 'Permissão insuficiente para esta operação' };
    }
    return { ok: true, userId: 'user-1', role: session.role };
  });
  getWelcomeCampaign.mockResolvedValue({
    ok: true,
    campaign: { company_id: COMPANY_A, nuvemshop_store_id: STORE, enabled: false },
  });
  saveWelcomeCampaign.mockResolvedValue({
    ok: true,
    campaign: { company_id: COMPANY_A, nuvemshop_store_id: STORE, enabled: false, title: null },
  });
});

describe('API autenticada do pop-up', () => {
  it('exige sessão e bloqueia outra empresa', async () => {
    const anonymous = response();
    await handler(request('GET', {
      query: { company_id: COMPANY_A, store_id: STORE },
      token: null,
    }), anonymous);
    expect(anonymous.statusCode).toBe(401);
    expect(getWelcomeCampaign).not.toHaveBeenCalled();

    const foreign = response();
    await handler(request('GET', { query: { company_id: COMPANY_B, store_id: STORE } }), foreign);
    expect(foreign.statusCode).toBe(403);
    expect(getWelcomeCampaign).not.toHaveBeenCalled();
  });

  it('separa leitura e gravação pelos papéis da integração', async () => {
    session.role = 'seller';
    const read = response();
    await handler(request('GET', { query: { company_id: COMPANY_A, store_id: STORE } }), read);
    expect(read.statusCode).toBe(403);
    expect(validateNuvemshopCaller).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      COMPANY_A,
      { roles: ALLOWED_ROLES },
    );

    session.role = 'partner';
    const write = response();
    await handler(request('PUT', {
      body: { company_id: COMPANY_A, store_id: STORE, title: 'Rascunho' },
    }), write);
    expect(write.statusCode).toBe(403);
    expect(saveWelcomeCampaign).not.toHaveBeenCalled();
    expect(validateNuvemshopCaller).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      COMPANY_A,
      { roles: WELCOME_WRITE_ROLES },
    );
    expect(WELCOME_WRITE_ROLES).not.toContain('partner');
    expect(WELCOME_WRITE_ROLES).not.toContain('seller');
  });

  it('bloqueia ativação mesmo para quem pode gravar', async () => {
    const blocked = response();
    await handler(request('PUT', {
      body: { company_id: COMPANY_A, store_id: STORE, enabled: 'true', title: 'Agora' },
    }), blocked);

    expect(blocked.statusCode).toBe(409);
    expect(blocked.body.code).toBe('publication_blocked');
    expect(saveWelcomeCampaign).not.toHaveBeenCalled();
  });

  it('grava o rascunho na empresa e na loja autenticadas', async () => {
    const res = response();
    await handler(request('PUT', {
      body: {
        company_id: COMPANY_A,
        store_id: STORE,
        title: 'Olá',
        enabled: false,
        outra_empresa: COMPANY_B,
      },
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.campaign.enabled).toBe(false);
    expect(saveWelcomeCampaign).toHaveBeenCalledWith(expect.objectContaining({
      companyId: COMPANY_A,
      storeId: STORE,
      userId: 'user-1',
    }));
    expect(saveWelcomeCampaign.mock.calls[0][0].companyId).not.toBe(COMPANY_B);
  });

  it('não autentica identificador ausente ou malformado', async () => {
    const res = response();
    await handler(request('PUT', { body: { company_id: 'nao-uuid', store_id: STORE } }), res);
    expect(res.statusCode).toBe(400);
    expect(validateNuvemshopCaller).not.toHaveBeenCalled();
    expect(saveWelcomeCampaign).not.toHaveBeenCalled();
  });
});
