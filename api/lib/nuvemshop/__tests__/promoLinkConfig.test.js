import { describe, expect, it } from 'vitest';
import { listPromoLinks, promoLinkUrl, savePromoLink } from '../promoLinkConfig.js';

const COMPANY = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413';
const OTHER = '3cbe5c11-d834-40d1-b1cf-425e6377f099';
const STORE = '7680914';

function database(state) {
  return {
    from(table) {
      const filters = [];
      const api = {
        select() { return api; },
        eq(column, value) { filters.push([column, value]); return api; },
        order() {
          return Promise.resolve({
            data: state.links.filter((row) => filters.every(([column, value]) => row[column] === value)),
            error: null,
          });
        },
        maybeSingle() {
          if (table === 'nuvemshop_connections') {
            const company = filters.find(([column]) => column === 'company_id')?.[1];
            const store = filters.find(([column]) => column === 'nuvemshop_store_id')?.[1];
            const status = filters.find(([column]) => column === 'status')?.[1];
            const found = state.connections.find((row) => (
              row.company_id === company && row.nuvemshop_store_id === store && row.status === status
            ));
            return Promise.resolve({ data: found ? { id: found.id } : null, error: null });
          }
          const row = state.links.find((item) => filters.every(([column, value]) => item[column] === value));
          return Promise.resolve({ data: row ?? null, error: null });
        },
        insert(row) {
          return {
            select() {
              return {
                single() {
                  const duplicate = state.links.some((item) => (
                    item.company_id === row.company_id
                    && item.nuvemshop_store_id === row.nuvemshop_store_id
                    && item.name.toLowerCase() === row.name.toLowerCase()
                  ));
                  if (duplicate) return Promise.resolve({ data: null, error: { code: '23505' } });
                  const saved = {
                    id: '11111111-1111-4111-8111-111111111111',
                    created_at: '2026-11-15T00:00:00.000Z',
                    name: row.name,
                    coupon_code: row.coupon_code,
                    coupon_type: row.coupon_type,
                    destination_path: row.destination_path,
                    company_id: row.company_id,
                    nuvemshop_store_id: row.nuvemshop_store_id,
                  };
                  state.links.push(saved);
                  state.tables.push(table);
                  return Promise.resolve({ data: saved, error: null });
                },
              };
            },
          };
        },
        update() { state.updates.push(table); return api; },
      };
      return api;
    },
  };
}

function state() {
  return {
    connections: [{ id: 'conn', company_id: COMPANY, nuvemshop_store_id: STORE, status: 'active', store_domain: 'valentro.lojavirtualnuvem.com.br' }],
    links: [],
    tables: [],
    updates: [],
  };
}

describe('links promocionais', () => {
  it('salva a definição sem URL e isola a outra empresa', async () => {
    const current = state();
    const saved = await savePromoLink({
      svc: database(current),
      companyId: COMPANY,
      storeId: STORE,
      userId: 'user-1',
      payload: { name: 'Live', benefit: 'shipping', coupon_code: 'frete', destination: '/live?utm=1' },
      findCoupon: async () => ({ ok: true, coupon: { type: 'shipping', code: 'FRETE' } }),
    });
    expect(saved.ok).toBe(true);
    expect(saved.link.destination_path).toBe('/live');
    expect(saved.link.coupon_code).toBe('FRETE');
    expect(saved.link.url).toBeUndefined();
    expect(current.tables).toEqual(['nuvemshop_promo_links']);
    expect(current.updates).toEqual([]);

    const foreign = await listPromoLinks({ svc: database(current), companyId: OTHER, storeId: STORE });
    expect(foreign.ok).toBe(false);
    expect(foreign.error.status).toBe(404);
    const own = await listPromoLinks({ svc: database(current), companyId: COMPANY, storeId: STORE });
    expect(own.links).toHaveLength(1);
  });

  it('não grava cupom inativo nem consulta incompleta', async () => {
    const current = state();
    const inactive = await savePromoLink({
      svc: database(current),
      companyId: COMPANY,
      storeId: STORE,
      payload: { name: 'Live', benefit: 'discount', coupon_code: 'BEMVINDO10', destination: '/live' },
      findCoupon: async () => ({ ok: false, error: { status: 422, code: 'coupon_inactive', message: 'inativo' } }),
    });
    expect(inactive.error.code).toBe('coupon_inactive');
    const missing = await savePromoLink({
      svc: database(current),
      companyId: COMPANY,
      storeId: STORE,
      payload: { name: 'Live', benefit: 'discount', coupon_code: 'NAOEXISTE', destination: '/live' },
      findCoupon: async () => ({ ok: false, error: { status: 503, code: 'coupon_search_incomplete', message: 'falha' } }),
    });
    expect(missing.error.code).toBe('coupon_search_incomplete');
    expect(current.links).toHaveLength(0);
  });

  it('monta a URL com o domínio público e não com o host antigo', async () => {
    const current = state();
    current.links.push({
      id: '11111111-1111-4111-8111-111111111111',
      company_id: COMPANY,
      nuvemshop_store_id: STORE,
      coupon_code: 'FRETE',
      destination_path: '/live',
    });
    const result = await promoLinkUrl({
      svc: database(current),
      companyId: COMPANY,
      storeId: STORE,
      linkId: '11111111-1111-4111-8111-111111111111',
      loadOrigin: async () => ({ ok: true, origin: 'https://valleron.store', host: 'valleron.store', allowedHosts: ['valleron.store'] }),
    });
    expect(result.url).toBe('https://valleron.store/discount/FRETE?redirect_to=/live');
    expect(result.url).not.toContain('lojavirtualnuvem');
  });
});
