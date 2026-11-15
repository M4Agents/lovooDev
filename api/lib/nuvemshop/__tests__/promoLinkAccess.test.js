import { describe, expect, it } from 'vitest';
import { authorizePromoLinkCaller } from '../promoLinkAccess.js';

const PARENT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CHILD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PARTNER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INACTIVE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const UNASSIGNED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const FOREIGN = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const SELLER = '99999999-9999-4999-8999-999999999999';
const MANAGER = '88888888-8888-4888-8888-888888888888';
const PARENT_ADMIN = '77777777-7777-4777-8777-777777777777';

function request(userId) {
  return { headers: { authorization: `Bearer ${userId}` } };
}

function client() {
  const companies = [
    { id: PARENT, parent_company_id: null, company_type: 'parent' },
    { id: OTHER, parent_company_id: null, company_type: 'parent' },
    { id: CHILD, parent_company_id: PARENT, company_type: 'client' },
  ];
  const companyUsers = [
    { user_id: PARTNER, company_id: PARENT, role: 'partner', is_active: true, companies: { company_type: 'parent' } },
    { user_id: INACTIVE, company_id: PARENT, role: 'partner', is_active: true, companies: { company_type: 'parent' } },
    { user_id: UNASSIGNED, company_id: PARENT, role: 'partner', is_active: true, companies: { company_type: 'parent' } },
    { user_id: FOREIGN, company_id: OTHER, role: 'partner', is_active: true, companies: { company_type: 'parent' } },
    { user_id: SELLER, company_id: CHILD, role: 'seller', is_active: true, companies: { company_type: 'client' } },
    { user_id: MANAGER, company_id: CHILD, role: 'manager', is_active: true, companies: { company_type: 'client' } },
    { user_id: PARENT_ADMIN, company_id: PARENT, role: 'super_admin', is_active: true, companies: { company_type: 'parent' } },
  ];
  const assignments = [
    { id: 'a1', partner_user_id: PARTNER, company_id: CHILD, is_active: true },
    { id: 'a2', partner_user_id: INACTIVE, company_id: CHILD, is_active: false },
    { id: 'a3', partner_user_id: FOREIGN, company_id: CHILD, is_active: true },
  ];
  const tables = {
    companies,
    company_users: companyUsers,
    partner_company_assignments: assignments,
  };

  return {
    auth: {
      getUser: async (token) => ({ data: { user: { id: token } }, error: null }),
    },
    from(table) {
      const filters = [];
      const api = {
        select() { return api; },
        eq(column, value) {
          filters.push((row) => row[column] === value);
          return api;
        },
        in(column, values) {
          filters.push((row) => values.includes(row[column]));
          return api;
        },
        maybeSingle() {
          const rows = (tables[table] ?? []).filter((row) => filters.every((match) => match(row)));
          return Promise.resolve({ data: rows[0] ?? null, error: rows.length > 1 ? { message: 'multiple' } : null });
        },
      };
      return api;
    },
  };
}

describe('leitura do partner nos links promocionais', () => {
  const svc = client();

  it('permite ler o partner atribuído e nega a gravação', async () => {
    const read = await authorizePromoLinkCaller(request(PARTNER), svc, CHILD);
    const write = await authorizePromoLinkCaller(request(PARTNER), svc, CHILD, { write: true });
    expect(read).toMatchObject({ ok: true, userId: PARTNER, role: 'partner' });
    expect(write.ok).toBe(false);
    expect(write.status).toBe(403);
  });

  it('nega partner sem atribuição, com atribuição inativa ou de outra pai', async () => {
    const missing = await authorizePromoLinkCaller(request(UNASSIGNED), svc, CHILD);
    const inactive = await authorizePromoLinkCaller(request(INACTIVE), svc, CHILD);
    const foreign = await authorizePromoLinkCaller(request(FOREIGN), svc, CHILD);
    expect(missing.ok).toBe(false);
    expect(inactive.ok).toBe(false);
    expect(foreign.ok).toBe(false);
  });

  it('nega seller e mantém manager e administrador da pai', async () => {
    const seller = await authorizePromoLinkCaller(request(SELLER), svc, CHILD);
    const manager = await authorizePromoLinkCaller(request(MANAGER), svc, CHILD);
    const parentAdmin = await authorizePromoLinkCaller(request(PARENT_ADMIN), svc, CHILD);
    expect(seller.ok).toBe(false);
    expect(manager).toMatchObject({ ok: true, role: 'manager' });
    expect(parentAdmin).toMatchObject({ ok: true, role: 'super_admin' });
  });
});
