import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/automation/supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: { message: 'ausente' } }) },
    from() {
      const api = {
        select() { return api; },
        eq() { return api; },
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return api;
    },
  }),
}));

vi.mock('../../lib/nuvemshop/validateNuvemshopCaller.js', async () => {
  const actual = await vi.importActual('../../lib/nuvemshop/validateNuvemshopCaller.js');
  return { ...actual, validateNuvemshopCaller: vi.fn() };
});

vi.mock('../../lib/nuvemshop/promoLinkConfig.js', async () => {
  const actual = await vi.importActual('../../lib/nuvemshop/promoLinkConfig.js');
  return {
    ...actual,
    listPromoLinks: vi.fn(),
    savePromoLink: vi.fn(),
    promoLinkUrl: vi.fn(),
  };
});

import handler from '../promo-links.js';
import urlHandler from '../promo-links/url.js';
import { validateNuvemshopCaller } from '../../lib/nuvemshop/validateNuvemshopCaller.js';
import { listPromoLinks, promoLinkUrl, savePromoLink } from '../../lib/nuvemshop/promoLinkConfig.js';

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

function request(method, { query, body, token = 'sessao', role } = {}) {
  return {
    method,
    query,
    body,
    role,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  validateNuvemshopCaller.mockImplementation(async (req, _svc, companyId, options) => {
    if (!(req.headers?.authorization ?? '').startsWith('Bearer ')) {
      return { ok: false, status: 401, error: 'Autenticação necessária' };
    }
    if (companyId !== COMPANY_A) return { ok: false, status: 403, error: 'Acesso negado a esta empresa' };
    if (!options.roles.includes('manager') && !options.roles.includes('partner')) {
      return { ok: false, status: 403, error: 'Permissão insuficiente para esta operação' };
    }
    const role = req.role ?? 'manager';
    if (!options.roles.includes(role)) {
      return { ok: false, status: 403, error: 'Permissão insuficiente para esta operação' };
    }
    return { ok: true, userId: 'user-1', role };
  });
  listPromoLinks.mockResolvedValue({ ok: true, links: [] });
  savePromoLink.mockResolvedValue({ ok: true, link: { id: '1', name: 'Live' } });
  promoLinkUrl.mockResolvedValue({ ok: true, url: 'https://valleron.store/discount/FRETE?redirect_to=/live', host: 'valleron.store' });
});

describe('API dos links promocionais', () => {
  it('exige sessão, isola a empresa e separa leitura de gravação', async () => {
    const anonymous = response();
    await handler(request('GET', { query: { company_id: COMPANY_A, store_id: STORE }, token: '' }), anonymous);
    expect(anonymous.statusCode).toBe(401);

    const foreign = response();
    await handler(request('GET', { query: { company_id: COMPANY_B, store_id: STORE } }), foreign);
    expect(foreign.statusCode).toBe(403);
    expect(listPromoLinks).not.toHaveBeenCalled();

    const partner = response();
    await handler(request('POST', { body: { company_id: COMPANY_A, store_id: STORE }, role: 'partner' }), partner);
    expect(partner.statusCode).toBe(403);
    expect(savePromoLink).not.toHaveBeenCalled();

    const listed = response();
    await handler(request('GET', { query: { company_id: COMPANY_A, store_id: STORE }, role: 'partner' }), listed);
    expect(listed.statusCode).toBe(200);

    const created = response();
    await handler(request('POST', { body: { company_id: COMPANY_A, store_id: STORE } }), created);
    expect(created.statusCode).toBe(201);
    expect(savePromoLink).toHaveBeenCalledWith(expect.objectContaining({
      companyId: COMPANY_A,
      storeId: STORE,
    }));
  });

  it('monta a URL só para a empresa autorizada', async () => {
    const copied = response();
    await urlHandler(request('POST', {
      body: { company_id: COMPANY_A, store_id: STORE, id: '11111111-1111-4111-8111-111111111111' },
      role: 'partner',
    }), copied);
    expect(copied.statusCode).toBe(200);
    expect(copied.body.url).toContain('/discount/');
    expect(promoLinkUrl).toHaveBeenCalledWith(expect.objectContaining({ companyId: COMPANY_A, storeId: STORE }));
  });
});
