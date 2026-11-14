import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../tokenCrypto.js', () => ({
  decryptNuvemshopToken: (value) => {
    if (value !== 'enc') throw new Error('token inválido');
    return 'access-token-de-teste';
  },
}));

vi.mock('../nuvemshopClient.js', () => ({
  createNuvemshopClient: vi.fn(() => client),
}));

import { createNuvemshopClient } from '../nuvemshopClient.js';
import { COUPON_LOOKUP_PAGE_LIMIT, findCouponByCode } from '../couponSync.js';

const COMPANY_A = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413';
const COMPANY_B = '3cbe5c11-d834-40d1-b1cf-425e6377f099';
const STORE = '7680914';

function activeStore() {
  return svc([{
    company_id: COMPANY_A,
    nuvemshop_store_id: STORE,
    status: 'active',
    access_token_enc: 'enc',
  }]);
}

function fullPage(prefix) {
  return Array.from({ length: 50 }, (_, index) => ({
    id: index + 1,
    code: `${prefix}${index}`,
    valid: true,
  }));
}

function svc(connections) {
  return {
    from(table) {
      const filters = [];
      const api = {
        select() { return api; },
        eq(column, value) { filters.push([column, value]); return api; },
        maybeSingle() {
          const rows = connections.filter((row) => (
            table === 'nuvemshop_connections'
            && filters.every(([column, value]) => row[column] === value)
          ));
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
      };
      return api;
    },
  };
}

describe('consulta de cupom existente', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('usa somente GET na loja da conexão ativa e exige o código exato', async () => {
    client.get.mockResolvedValue([
      { id: 1, code: 'BEMVINDO100', valid: true, type: 'percentage', value: '10.00' },
      { id: 2, code: 'bemvindo10', valid: true, type: 'percentage', value: '10.00' },
    ]);

    const found = await findCouponByCode({
      companyId: COMPANY_A,
      storeId: STORE,
      code: 'bemvindo10',
      svc: svc([{
        company_id: COMPANY_A,
        nuvemshop_store_id: STORE,
        status: 'active',
        access_token_enc: 'enc',
      }]),
    });

    expect(found.ok).toBe(true);
    expect(found.coupon.code).toBe('bemvindo10');
    expect(client.get).toHaveBeenCalledWith('coupons', {
      q: 'BEMVINDO10',
      page: 1,
      per_page: 50,
    });
    expect(client.post).not.toHaveBeenCalled();
    expect(client.put).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
    expect(createNuvemshopClient).toHaveBeenCalledWith(expect.objectContaining({
      storeId: STORE,
      accessToken: 'access-token-de-teste',
    }));
  });

  it('não chama a Nuvemshop com a conexão de outra empresa', async () => {
    const found = await findCouponByCode({
      companyId: COMPANY_A,
      storeId: STORE,
      code: 'CUPOM10',
      svc: svc([{
        company_id: COMPANY_B,
        nuvemshop_store_id: STORE,
        status: 'active',
        access_token_enc: 'enc',
      }]),
    });

    expect(found.error.status).toBe(404);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
  });

  it('recusa cupom inativo ou apagado sem alterá-lo', async () => {
    client.get.mockResolvedValueOnce([
      { id: 3, code: 'CUPOM10', valid: false, deleted_at: null },
    ]);
    const inactive = await findCouponByCode({
      companyId: COMPANY_A,
      storeId: STORE,
      code: 'CUPOM10',
      svc: svc([{
        company_id: COMPANY_A,
        nuvemshop_store_id: STORE,
        status: 'active',
        access_token_enc: 'enc',
      }]),
    });

    client.get.mockResolvedValueOnce([
      { id: 4, code: 'CUPOM10', valid: true, deleted_at: '2026-11-01T00:00:00.000Z' },
    ]);
    const removed = await findCouponByCode({
      companyId: COMPANY_A,
      storeId: STORE,
      code: 'CUPOM10',
      svc: svc([{
        company_id: COMPANY_A,
        nuvemshop_store_id: STORE,
        status: 'active',
        access_token_enc: 'enc',
      }]),
    });

    expect(inactive.error.code).toBe('coupon_inactive');
    expect(removed.error.code).toBe('coupon_not_found');
    expect(client.post).not.toHaveBeenCalled();
    expect(client.put).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
  });

  it('encontra o código exato na página seguinte', async () => {
    client.get
      .mockResolvedValueOnce(fullPage('OUTRO'))
      .mockResolvedValueOnce([
        { id: 99, code: 'CUPOM10', valid: true, type: 'percentage', value: '10.00' },
      ]);

    const found = await findCouponByCode({
      companyId: COMPANY_A,
      storeId: STORE,
      code: 'CUPOM10',
      svc: activeStore(),
    });

    expect(found.ok).toBe(true);
    expect(found.coupon.code).toBe('CUPOM10');
    expect(client.get).toHaveBeenNthCalledWith(1, 'coupons', { q: 'CUPOM10', page: 1, per_page: 50 });
    expect(client.get).toHaveBeenNthCalledWith(2, 'coupons', { q: 'CUPOM10', page: 2, per_page: 50 });
    expect(client.post).not.toHaveBeenCalled();
  });

  it('não afirma que o cupom não existe quando atinge o teto de páginas', async () => {
    client.get.mockImplementation(async () => fullPage('PAGINA'));

    const found = await findCouponByCode({
      companyId: COMPANY_A,
      storeId: STORE,
      code: 'CUPOM10',
      svc: activeStore(),
    });

    expect(found.error).toMatchObject({
      status: 503,
      code: 'coupon_search_incomplete',
      field: 'coupon_code',
    });
    expect(found.error.message).not.toMatch(/não existe/);
    expect(client.get).toHaveBeenCalledTimes(COUPON_LOOKUP_PAGE_LIMIT);
    expect(client.post).not.toHaveBeenCalled();
    expect(client.put).not.toHaveBeenCalled();
  });

  it('trata resposta que não é lista como consulta inconclusiva', async () => {
    client.get.mockResolvedValueOnce({ error: 'inesperado' });
    const found = await findCouponByCode({
      companyId: COMPANY_A,
      storeId: STORE,
      code: 'CUPOM10',
      svc: activeStore(),
    });

    expect(found.error.code).toBe('coupon_search_incomplete');
    expect(found.error.status).toBe(503);
  });
});
