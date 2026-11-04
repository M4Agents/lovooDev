import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CREATE_DIRECT_ROLES, CREATE_PARENT_ROLES, authorizeCreateInstance } from '../authorizeCreateInstance.js';
import { handleCreateInstance } from '../handleCreateInstance.js';
import { QR_DIRECT_ROLES, QR_PARENT_ROLES } from '../../../../api/lib/uazapi/qrAuthorization.js';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const PARENT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const USER = 'user-1';
const ADMIN = 'fixture-admin-not-real';
const INSTANCE = 'fixture-instance-not-real';
const INSTANCE_ID = '44444444-4444-4444-8444-444444444444';

function roleQuery(rows) {
  const filters = [];
  const builder = {
    select() { return builder; },
    eq(column, value) { filters.push([column, value]); return builder; },
    in(column, value) { filters.push([column, value]); return builder; },
    then(resolve, reject) { return Promise.resolve(rows(filters)).then(resolve, reject); },
  };
  return builder;
}

function authorizeSvc(state) {
  return {
    from(table) {
      if (table === 'companies') {
        const builder = {
          select() { return builder; },
          eq() { return builder; },
          maybeSingle: async () => state.company,
        };
        return builder;
      }
      return roleQuery((filters) => {
        const companyId = filters.find((item) => item[0] === 'company_id')?.[1];
        if (companyId === COMPANY) return { data: state.direct, error: null };
        if (companyId === PARENT) return { data: state.parent, error: null };
        return { data: [], error: null };
      });
    },
  };
}

function request(headers = { authorization: 'Bearer header.payload.signature' }) {
  return new Request('https://example.test/functions/v1/whatsapp-life-create-instance', {
    method: 'POST',
    headers,
    body: JSON.stringify({ company_id: COMPANY, instance_name: 'Comercial' }),
  });
}

function adminClient(events) {
  return {
    rpc: async (name) => {
      events.push(`rpc:${name}`);
      if (name === 'check_whatsapp_life_plan_limit') return { data: { canAdd: true, currentCount: 0, maxAllowed: 3 }, error: null };
      if (name === 'create_whatsapp_life_instance') return { data: { success: true, instanceId: INSTANCE_ID }, error: null };
      return { data: { success: true }, error: null };
    },
    from() {
      const builder = {
        select(columns) { events.push(`select:${columns}`); return builder; },
        eq() { return builder; },
        single: async () => ({
          data: {
            id: INSTANCE_ID,
            company_id: COMPANY,
            instance_name: 'Comercial',
            status: 'qr_pending',
            provider_type: 'uazapi',
            provider_token: INSTANCE,
            provider_instance_id: 'remote-1',
            profile_name: null,
            phone_number: null,
            connected_at: null,
            created_at: '2026-11-04T12:00:00.000Z',
            updated_at: '2026-11-04T12:00:00.000Z',
          },
          error: null,
        }),
      };
      return builder;
    },
  };
}

function depsFor(state, events = []) {
  return {
    events,
    getUser: async () => ({ user: { id: USER }, error: null }),
    authorize: (userId, companyId) => authorizeCreateInstance(authorizeSvc(state), userId, companyId),
    admin: () => {
      events.push('admin');
      return adminClient(events);
    },
    fetchImpl: async (url) => {
      events.push(`fetch:${url}`);
      return {
        ok: true,
        json: async () => ({ success: true, data: { id: 'remote-1', token: INSTANCE, name: 'x', status: 'qr_pending' } }),
      };
    },
    env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: 'https://uazapi.test' },
  };
}

describe('autorização da edge function', () => {
  it('usa a mesma matriz de papéis do QR', () => {
    expect(CREATE_DIRECT_ROLES).toEqual(QR_DIRECT_ROLES);
    expect(CREATE_PARENT_ROLES).toEqual(QR_PARENT_ROLES);
  });

  it('permite admin, manager, seller e o administrador da mãe correspondente', async () => {
    const company = { data: { id: COMPANY, parent_company_id: PARENT }, error: null };
    await expect(authorizeCreateInstance(authorizeSvc({ company, direct: [{ role: 'admin' }], parent: [] }), USER, COMPANY)).resolves.toMatchObject({ ok: true, role: 'admin' });
    await expect(authorizeCreateInstance(authorizeSvc({ company, direct: [{ role: 'manager' }], parent: [] }), USER, COMPANY)).resolves.toMatchObject({ ok: true, role: 'manager' });
    await expect(authorizeCreateInstance(authorizeSvc({ company, direct: [{ role: 'seller' }], parent: [] }), USER, COMPANY)).resolves.toMatchObject({ ok: true, role: 'seller' });
    await expect(authorizeCreateInstance(authorizeSvc({ company, direct: [], parent: [{ role: 'super_admin' }] }), USER, COMPANY)).resolves.toMatchObject({ ok: true, scope: 'parent' });
    await expect(authorizeCreateInstance(authorizeSvc({ company, direct: [], parent: [{ role: 'system_admin' }] }), USER, COMPANY)).resolves.toMatchObject({ ok: true, role: 'system_admin' });
  });

  it('nega partner sem atribuição e empresa não relacionada', async () => {
    const company = { data: { id: COMPANY, parent_company_id: PARENT }, error: null };
    await expect(authorizeCreateInstance(authorizeSvc({ company, direct: [{ role: 'partner' }], parent: [] }), USER, COMPANY)).resolves.toMatchObject({ status: 403 });
    await expect(authorizeCreateInstance(authorizeSvc({ company, direct: [], parent: [] }), USER, COMPANY)).resolves.toMatchObject({ status: 403 });
    await expect(authorizeCreateInstance(authorizeSvc({
      company: { data: { id: OTHER, parent_company_id: null }, error: null },
      direct: [],
      parent: [{ role: 'super_admin' }],
    }), USER, OTHER)).resolves.toMatchObject({ status: 403 });
  });
});

describe('POST whatsapp-life-create-instance', () => {
  it('responde 401 sem JWT e não chama autorização nem a UAZAPI', async () => {
    const events = [];
    const response = await handleCreateInstance(request({}), {
      getUser: async () => { events.push('user'); return { user: null }; },
      authorize: async () => { events.push('authorize'); return { ok: true }; },
      admin: () => { events.push('admin'); throw new Error('admin'); },
      fetchImpl: async () => { events.push('fetch'); throw new Error('fetch'); },
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: 'https://uazapi.test' },
    });
    expect(response.status).toBe(401);
    expect(events).toEqual([]);
  });

  it('responde 401 com JWT inválido antes de qualquer chamada administrativa', async () => {
    const events = [];
    const response = await handleCreateInstance(request(), {
      getUser: async () => { events.push('user'); return { user: null, error: new Error('expirado') }; },
      authorize: async () => { events.push('authorize'); return { ok: true }; },
      admin: () => { events.push('admin'); },
      fetchImpl: async () => { events.push('fetch'); },
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: 'https://uazapi.test' },
    });
    expect(response.status).toBe(401);
    expect(events).toEqual(['user']);
    expect(JSON.stringify(await response.json())).not.toContain('expirado');
  });

  it('responde 403 sem permissão e para empresa não relacionada, sem UAZAPI', async () => {
    const company = { data: { id: COMPANY, parent_company_id: PARENT }, error: null };
    for (const state of [
      { company, direct: [{ role: 'seller' }], parent: [] },
      { company, direct: [{ role: 'partner' }], parent: [] },
      { company, direct: [], parent: [] },
    ]) {
      const events = [];
      const response = await handleCreateInstance(request(), depsFor(state, events));
      expect(response.status).toBe(403);
      expect(events.some((item) => item === 'admin' || item.startsWith('fetch') || item.startsWith('rpc'))).toBe(false);
    }
  });

  it('não cria instância para admin autenticado e não chama a UAZAPI', async () => {
    const company = { data: { id: COMPANY, parent_company_id: PARENT }, error: null };
    const events = [];
    const response = await handleCreateInstance(request(), depsFor({
      company,
      direct: [{ role: 'admin' }],
      parent: [],
    }, events));
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.error).toBe('Esta operação foi encerrada. Use a conexão por QR Code.');
    expect(events.some((item) => item === 'admin' || item.startsWith('fetch') || item.startsWith('rpc'))).toBe(false);
    expect(JSON.stringify(body)).not.toContain(ADMIN);
    expect(JSON.stringify(body)).not.toContain(INSTANCE);
  });

  it('rejeita Authorization que não é um JWT de usuário', async () => {
    const events = [];
    const response = await handleCreateInstance(request({ authorization: 'Bearer session-token' }), {
      getUser: async () => { events.push('user'); return { user: { id: USER } }; },
      authorize: async () => { events.push('authorize'); return { ok: true }; },
      admin: () => { events.push('admin'); },
      fetchImpl: async () => { events.push('fetch'); },
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: 'https://uazapi.test' },
    });
    expect(response.status).toBe(401);
    expect(events).toEqual([]);
  });

  it('mantém a validação própria e o verify_jwt ligado', () => {
    const root = resolve(import.meta.dirname, '../../../..');
    const source = readFileSync(resolve(root, 'supabase/functions/whatsapp-life-create-instance/index.ts'), 'utf8');
    const config = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8');
    expect(source).toContain('auth.getUser');
    expect(source).not.toContain("select('*')");
    expect(source).not.toContain('410');
    expect(source).not.toContain('UAZAPI_ADMIN_TOKEN');
    expect(config).toMatch(/\[functions\.whatsapp-life-create-instance\]\r?\nverify_jwt = true/);
  });
});
