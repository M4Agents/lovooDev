import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAdminToken } from '../adminCredential.js';
import { authorizeQrSession } from '../qrAuthorization.js';
import { INIT_CAP_MS, QR_BUDGET_MS, WEBHOOK_CAP_MS, timeoutForStep } from '../qrBudget.js';
import { isBlockingOpen } from '../qrClaim.js';
import { createQrSession } from '../qrSession.js';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const PARENT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const USER = 'user-1';
const ADMIN = 'fixture-admin-not-real';
const INSTANCE = 'fixture-instance-not-real';
const BASE = 'https://uazapi.test';

function roleQuery(rows) {
  const filters = [];
  const builder = {
    select() { return builder; },
    eq(column, value) { filters.push([column, value]); return builder; },
    in(column, value) { filters.push([column, value]); return builder; },
    then(resolve, reject) {
      return Promise.resolve(rows(filters)).then(resolve, reject);
    },
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
        if (state.roleError) return { data: null, error: { message: 'falha' } };
        if (state.byCompany && Object.prototype.hasOwnProperty.call(state.byCompany, companyId)) {
          return { data: state.byCompany[companyId], error: null };
        }
        if (companyId === COMPANY) return { data: state.direct, error: null };
        if (companyId === PARENT) return { data: state.parent, error: null };
        return { data: [], error: null };
      });
    },
  };
}

function sessionSvc(options = {}) {
  const state = { inserts: [], updates: [], open: options.open ?? null };
  return {
    state,
    rpc: async (name, args) => {
      if (name !== 'claim_whatsapp_temp_open') {
        return { data: { canAdd: true, currentCount: 0, maxAllowed: 3, remaining: 3 }, error: null };
      }
      if (options.claimResult) return options.claimResult;
      const row = {
        temp_instance_id: args.p_temp_id,
        company_id: args.p_company_id,
        instance_name: args.p_instance_name,
        uazapi_name: args.p_uazapi_name,
        status: 'creating',
        remote_init_state: 'reserved',
      };
      state.inserts.push({ table: 'whatsapp_temp_instances', row });
      state.held = row;
      return {
        data: {
          outcome: 'created',
          temp_instance_id: args.p_temp_id,
          uazapi_name: args.p_uazapi_name,
          remote_init_state: 'reserved',
          company_id: args.p_company_id,
          instance_name: args.p_instance_name,
        },
        error: null,
      };
    },
    from(table) {
      const filters = [];
      const builder = {
        select() { return builder; },
        eq(column, value) { filters.push(['eq', column, value]); return builder; },
        is() { return builder; },
        in(column, value) { filters.push(['in', column, value]); return builder; },
        or() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle: async () => {
          if (table !== 'whatsapp_temp_instances') return { data: null, error: null };
          const companyId = filters.find((item) => item[0] === 'eq' && item[1] === 'company_id')?.[2];
          const statuses = filters.find((item) => item[0] === 'in' && item[1] === 'status')?.[2];
          if (!state.open) return { data: null, error: null };
          if (companyId && state.open.company_id !== companyId) return { data: null, error: null };
          if (statuses && !statuses.includes(state.open.status)) return { data: null, error: null };
          if (!isBlockingOpen(state.open)) return { data: null, error: null };
          return { data: state.open, error: null };
        },
        insert(row) {
          const stored = { ...row, remote_init_state: row.remote_init_state || 'reserved' };
          state.inserts.push({ table, row: stored });
          state.held = stored;
          return Promise.resolve({ error: options.insertError || null });
        },
        update(row) {
          const eqs = [];
          const updated = {
            eq(column, value) { eqs.push([column, value]); return updated; },
            select() { return updated; },
            then(resolve, reject) {
              state.updates.push({ table, row, eqs });
              const claimsInit = eqs.some(([column, value]) => column === 'remote_init_state' && value === 'reserved');
              if (claimsInit) {
                const companyId = eqs.find(([column]) => column === 'company_id')?.[1];
                const tempId = eqs.find(([column]) => column === 'temp_instance_id')?.[1];
                const candidate = state.held || state.open;
                const won = candidate
                  && candidate.remote_init_state === 'reserved'
                  && candidate.company_id === companyId
                  && candidate.temp_instance_id === tempId;
                if (won) {
                  candidate.remote_init_state = 'unknown';
                  state.held = candidate;
                  return Promise.resolve({ data: [{ temp_instance_id: tempId }], error: null }).then(resolve, reject);
                }
                return Promise.resolve({ data: [], error: null }).then(resolve, reject);
              }
              if (state.held) Object.assign(state.held, row);
              return Promise.resolve({ data: null, error: null }).then(resolve, reject);
            },
          };
          return updated;
        },
      };
      return builder;
    },
  };
}

function fetchMock() {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, headers: options.headers });
    if (String(url).endsWith('/instance/init')) {
      return { status: 200, text: async () => JSON.stringify({ token: INSTANCE, instance: { id: 'remote-1' } }) };
    }
    if (String(url).endsWith('/instance/connect')) {
      return { status: 200, text: async () => JSON.stringify({ qrcode: 'qr-fixture', paircode: 'pair-fixture' }) };
    }
    return { status: 200, text: async () => '{}' };
  };
  return { impl, calls };
}

describe('credencial administrativa', () => {
  it('falha sem variável e com o placeholder do exemplo', () => {
    expect(() => readAdminToken({})).toThrow(/indisponível/);
    expect(() => readAdminToken({ UAZAPI_ADMIN_TOKEN: 'your-uazapi-admin-token' })).toThrow(/indisponível/);
  });
});

describe('autorização do QR', () => {
  async function decide(state) {
    return authorizeQrSession(authorizeSvc(state), USER, COMPANY);
  }

  it('permite admin, manager e seller da própria empresa', async () => {
    const company = { data: { id: COMPANY, parent_company_id: PARENT }, error: null };
    await expect(decide({ company, direct: [{ role: 'admin' }], parent: [] })).resolves.toMatchObject({ ok: true, role: 'admin' });
    await expect(decide({ company, direct: [{ role: 'manager' }], parent: [] })).resolves.toMatchObject({ ok: true, role: 'manager' });
    await expect(decide({ company, direct: [{ role: 'seller' }], parent: [] })).resolves.toMatchObject({ ok: true, role: 'seller', scope: 'company' });
  });

  it('permite super_admin e system_admin da empresa mãe', async () => {
    const company = { data: { id: COMPANY, parent_company_id: PARENT }, error: null };
    await expect(decide({ company, direct: [], parent: [{ role: 'super_admin' }] })).resolves.toMatchObject({ ok: true, scope: 'parent' });
    await expect(decide({ company, direct: [], parent: [{ role: 'system_admin' }] })).resolves.toMatchObject({ ok: true, role: 'system_admin' });
  });

  it('permite super_admin e system_admin com vínculo único na própria empresa pai', async () => {
    const company = { data: { id: COMPANY, parent_company_id: null }, error: null };
    await expect(decide({ company, direct: [{ role: 'super_admin' }], parent: [] })).resolves.toMatchObject({
      ok: true,
      role: 'super_admin',
      scope: 'company',
    });
    await expect(decide({ company, direct: [{ role: 'system_admin' }], parent: [] })).resolves.toMatchObject({
      ok: true,
      role: 'system_admin',
      scope: 'company',
    });
  });

  it('preserva admin, manager e seller na empresa pai', async () => {
    const company = { data: { id: COMPANY, parent_company_id: null }, error: null };
    await expect(decide({ company, direct: [{ role: 'admin' }], parent: [] })).resolves.toMatchObject({ ok: true, role: 'admin', scope: 'company' });
    await expect(decide({ company, direct: [{ role: 'manager' }], parent: [] })).resolves.toMatchObject({ ok: true, role: 'manager', scope: 'company' });
    await expect(decide({ company, direct: [{ role: 'seller' }], parent: [] })).resolves.toMatchObject({ ok: true, role: 'seller', scope: 'company' });
  });

  it('nega o papel sem vínculo na empresa alvo e em outra empresa pai', async () => {
    const parentCompany = { data: { id: COMPANY, parent_company_id: null }, error: null };
    await expect(decide({
      company: parentCompany,
      direct: [],
      parent: [{ role: 'super_admin' }],
    })).resolves.toMatchObject({ status: 403 });
    await expect(decide({
      company: parentCompany,
      direct: [],
      parent: [{ role: 'system_admin' }],
    })).resolves.toMatchObject({ status: 403 });

    const otherParent = { data: { id: OTHER, parent_company_id: null }, error: null };
    await expect(authorizeQrSession(authorizeSvc({
      company: otherParent,
      byCompany: { [PARENT]: [{ role: 'super_admin' }], [OTHER]: [] },
    }), USER, OTHER)).resolves.toMatchObject({ status: 403 });
    await expect(authorizeQrSession(authorizeSvc({
      company: otherParent,
      byCompany: { [PARENT]: [{ role: 'system_admin' }], [OTHER]: [] },
    }), USER, OTHER)).resolves.toMatchObject({ status: 403 });
  });

  it('nega vínculos diretos ambíguos mesmo com papel válido na empresa mãe', async () => {
    const company = { data: { id: COMPANY, parent_company_id: PARENT }, error: null };
    await expect(decide({
      company,
      direct: [{ role: 'admin' }, { role: 'seller' }],
      parent: [{ role: 'super_admin' }],
    })).resolves.toMatchObject({ status: 403 });
    await expect(decide({
      company,
      direct: [{ role: 'super_admin' }, { role: 'system_admin' }],
      parent: [{ role: 'super_admin' }],
    })).resolves.toMatchObject({ status: 403 });
    await expect(decide({
      company,
      direct: [{ role: 'partner' }, { role: 'manager' }],
      parent: [{ role: 'system_admin' }],
    })).resolves.toMatchObject({ status: 403 });
  });

  it('nega partner e papéis múltiplos na empresa pai', async () => {
    const company = { data: { id: COMPANY, parent_company_id: null }, error: null };
    await expect(decide({ company, direct: [{ role: 'partner' }], parent: [] })).resolves.toMatchObject({ status: 403 });
    await expect(decide({
      company,
      direct: [{ role: 'super_admin' }, { role: 'admin' }],
      parent: [],
    })).resolves.toMatchObject({ status: 403 });
    await expect(decide({
      company,
      direct: [{ role: 'system_admin' }, { role: 'seller' }],
      parent: [],
    })).resolves.toMatchObject({ status: 403 });
  });

  it('não reserva nem inicia quando a autorização nega', async () => {
    const access = await authorizeQrSession(authorizeSvc({
      company: { data: { id: COMPANY, parent_company_id: null }, error: null },
      direct: [{ role: 'super_admin' }, { role: 'system_admin' }],
      parent: [],
    }), USER, COMPANY);
    expect(access).toMatchObject({
      ok: false,
      status: 403,
      error: 'Permissão insuficiente para esta operação',
    });

    const fetchImpl = vi.fn(async () => ({ status: 500, text: async () => '' }));
    const svc = sessionSvc();
    if (access.ok) {
      await createQrSession({
        svc,
        companyId: COMPANY,
        instanceName: 'teste4',
        fetchImpl,
        env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
      });
    }
    expect(svc.state.inserts).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('nega empresa não relacionada, partner, seller inativo, papéis duplicados e admin da mãe', async () => {
    const company = { data: { id: COMPANY, parent_company_id: PARENT }, error: null };
    await expect(decide({ company, direct: [], parent: [] })).resolves.toMatchObject({ status: 403 });
    await expect(decide({ company, direct: [{ role: 'partner' }], parent: [] })).resolves.toMatchObject({ status: 403 });
    await expect(decide({ company, direct: [{ role: 'seller' }, { role: 'admin' }], parent: [] })).resolves.toMatchObject({ status: 403 });
    await expect(decide({ company, direct: [], parent: [{ role: 'admin' }] })).resolves.toMatchObject({ status: 403 });
    await expect(authorizeQrSession(authorizeSvc({
      company: { data: { id: OTHER, parent_company_id: PARENT }, error: null },
      direct: [{ role: 'seller' }],
      parent: [],
    }), USER, OTHER)).resolves.toMatchObject({ status: 403 });
    await expect(authorizeQrSession(authorizeSvc({
      company: { data: { id: OTHER, parent_company_id: null }, error: null },
      direct: [],
      parent: [{ role: 'super_admin' }],
    }), USER, OTHER)).resolves.toMatchObject({ status: 403 });
  });

  it('não trata erro de consulta como ausência de acesso', async () => {
    const result = await decide({
      company: { data: { id: COMPANY, parent_company_id: PARENT }, error: null },
      direct: [],
      parent: [],
      roleError: true,
    });
    expect(result).toMatchObject({ status: 503 });
  });
});

describe('sessão de QR', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('não devolve credencial e não a registra em log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const svc = sessionSvc();
    const fetchImpl = fetchMock();
    const result = await createQrSession({
      svc,
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl: fetchImpl.impl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE, VITE_SUPABASE_URL: 'https://example.supabase.co' },
      now: () => new Date('2026-11-04T12:00:00.000Z'),
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(ADMIN);
    expect(serialized).not.toContain(INSTANCE);
    expect(result.data).toMatchObject({
      qrcode: 'qr-fixture',
      instance_name: 'Comercial',
      company_id: COMPANY,
      expires_at: '2026-11-04T12:02:00.000Z',
    });
    expect(result.data.temp_instance_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fetchImpl.calls[0].url).toBe(`${BASE}/instance/init`);
    expect(fetchImpl.calls[0].headers.admintoken).toBe(ADMIN);
    expect(fetchImpl.calls.some((call) => call.url.endsWith('/instance/connect') && call.headers.admintoken)).toBe(false);
    expect(fetchImpl.calls.some((call) => call.headers.token === INSTANCE)).toBe(true);
    const logs = [error, log, info].flatMap((spy) => spy.mock.calls).flat().join('\n');
    expect(logs).not.toContain(ADMIN);
    expect(logs).not.toContain(INSTANCE);
    expect(svc.state.updates.some((item) => item.row.uazapi_token === INSTANCE)).toBe(true);
    expect(svc.state.updates.every((item) => item.eqs.some((eq) => eq[0] === 'company_id' && eq[1] === COMPANY))).toBe(true);
  });

  it('não chama a UAZAPI quando a credencial não existe', async () => {
    const fetchImpl = vi.fn();
    await expect(createQrSession({
      svc: sessionSvc(),
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl,
      env: { UAZAPI_BASE_URL: BASE },
    })).rejects.toMatchObject({ code: 'admin_credential_unavailable' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('não ecoa o corpo da UAZAPI quando a criação falha', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = async () => ({
      status: 500,
      text: async () => JSON.stringify({ token: INSTANCE, admintoken: ADMIN }),
    });
    await expect(createQrSession({
      svc: sessionSvc(),
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
    })).rejects.toMatchObject({
      code: 'init_unknown',
      publicMessage: 'O resultado da criação anterior ainda não foi confirmado. A mesma operação foi preservada.',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(ADMIN);
    expect(JSON.stringify(error.mock.calls)).not.toContain(INSTANCE);
  });

  it('mantém a soma das etapas dentro do limite da função', () => {
    const init = timeoutForStep(0, INIT_CAP_MS);
    const webhook = timeoutForStep(init, WEBHOOK_CAP_MS);
    const connect = timeoutForStep(init + webhook, QR_BUDGET_MS);
    expect(init + webhook + connect).toBe(QR_BUDGET_MS);
    expect(QR_BUDGET_MS).toBeLessThan(60_000);
    expect(timeoutForStep(QR_BUDGET_MS - 500, QR_BUDGET_MS)).toBe(0);
  });

  it('calcula a expiração quando o QR fica disponível', async () => {
    let qrReady = false;
    const network = fetchMock();
    const result = await createQrSession({
      svc: sessionSvc(),
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl: async (url, options) => {
        const response = await network.impl(url, options);
        if (String(url).endsWith('/instance/connect')) qrReady = true;
        return response;
      },
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
      now: () => new Date(qrReady ? '2026-11-04T12:00:40.000Z' : '2026-11-04T12:00:00.000Z'),
    });
    expect(result.data.expires_at).toBe('2026-11-04T12:02:40.000Z');
  });

  it('devolve o identificador temporário quando o init estoura o tempo', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const pending = createQrSession({
      svc: sessionSvc(),
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
      budgetMs: INIT_CAP_MS,
    }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(INIT_CAP_MS);
    const error = await pending;
    expect(error.code).toBe('init_unknown');
    expect(error.extra.recovery.temp_instance_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(error.extra)).not.toContain(ADMIN);
    expect(JSON.stringify(error.extra)).not.toContain(INSTANCE);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('repete a tentativa na mesma instância temporária, sem novo init', async () => {
    const fetchImpl = fetchMock();
    const open = {
      temp_instance_id: '44444444-4444-4444-8444-444444444444',
      instance_name: 'Comercial',
      company_id: COMPANY,
      uazapi_name: '11111111_Comercial_44444444',
      uazapi_instance_id: 'remote-1',
      uazapi_token: INSTANCE,
      remote_init_state: 'confirmed',
      status: 'created_no_qr',
      qrcode: null,
      paircode: null,
      updated_at: '2026-11-04T11:00:00.000Z',
    };
    const svc = sessionSvc({ open });
    const result = await createQrSession({
      svc,
      companyId: COMPANY,
      instanceName: 'Comercial',
      tempInstanceId: open.temp_instance_id,
      fetchImpl: fetchImpl.impl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE, VITE_SUPABASE_URL: 'https://example.supabase.co' },
      now: () => new Date('2026-11-04T12:00:40.000Z'),
    });
    expect(result.data.temp_instance_id).toBe(open.temp_instance_id);
    expect(result.data.expires_at).toBe('2026-11-04T12:02:40.000Z');
    expect(fetchImpl.calls.some((call) => call.url.endsWith('/instance/init'))).toBe(false);
    expect(fetchImpl.calls.some((call) => call.url.endsWith('/instance/connect'))).toBe(true);
    expect(svc.state.inserts).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(INSTANCE);
    expect(JSON.stringify(result)).not.toContain(ADMIN);
  });

  it('permanente ativa com o mesmo nome não chama init', async () => {
    const fetchImpl = vi.fn();
    const svc = sessionSvc();
    const originalFrom = svc.from.bind(svc);
    svc.from = (table) => {
      if (table !== 'whatsapp_life_instances') return originalFrom(table);
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        is() { return builder; },
        maybeSingle: async () => ({ data: { id: 'perm-1' }, error: null }),
      };
      return builder;
    };
    await expect(createQrSession({
      svc,
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
    })).rejects.toMatchObject({ code: 'duplicate_name', status: 409 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('não inicia outra criação enquanto a primeira ainda está em andamento', async () => {
    const fetchImpl = vi.fn();
    const open = {
      temp_instance_id: '44444444-4444-4444-8444-444444444444',
      instance_name: 'Comercial',
      company_id: COMPANY,
      uazapi_name: '11111111_Comercial_44444444',
      uazapi_instance_id: null,
      uazapi_token: null,
      status: 'creating',
      remote_init_state: 'unknown',
      init_started_at: '2026-11-04T11:00:00.000Z',
      qrcode: null,
      updated_at: new Date().toISOString(),
    };
    await expect(createQrSession({
      svc: sessionSvc({ open }),
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
    })).rejects.toMatchObject({
      code: 'init_unknown',
      extra: { recovery: { temp_instance_id: open.temp_instance_id, status: 'unknown' } },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sem a posse da operação não cria linha e não chama init', async () => {
    const inits = [];
    const svc = {
      rpc: async () => ({ data: { canAdd: true, currentCount: 0, maxAllowed: 3, remaining: 3 }, error: null }),
      from(table) {
        const builder = {
          select() { return builder; },
          eq() { return builder; },
          is() { return builder; },
          in() { return builder; },
          or() { return builder; },
          order() { return builder; },
          limit() { return builder; },
          maybeSingle: async () => ({ data: table === 'whatsapp_temp_instances' ? null : null, error: null }),
          insert() { throw new Error('insert direto não é permitido'); },
          update() { throw new Error('update não é permitido'); },
        };
        return builder;
      },
    };
    const settled = await Promise.allSettled([
      createQrSession({
        svc,
        companyId: COMPANY,
        instanceName: 'Comercial',
        fetchImpl: async (url) => { inits.push(url); return { status: 500, text: async () => '' }; },
        env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
      }),
      createQrSession({
        svc,
        companyId: COMPANY,
        instanceName: 'Comercial',
        fetchImpl: async (url) => { inits.push(url); return { status: 500, text: async () => '' }; },
        env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
      }),
    ]);
    expect(inits).toHaveLength(0);
    expect(settled.every((item) => item.status === 'rejected' && item.reason.code === 'temp_claim_unavailable' && item.reason.status === 503)).toBe(true);
    expect(JSON.stringify(settled)).not.toContain(ADMIN);
    expect(JSON.stringify(settled)).not.toContain('claim_whatsapp_temp_open');
  });

  it.each([
    ['ausente', { data: null, error: { code: 'PGRST202', message: 'claim_whatsapp_temp_open' } }],
    ['sem permissão', { data: null, error: { code: '42501', message: 'permission denied for function claim_whatsapp_temp_open' } }],
    ['expirada', { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }],
  ])('responde 503 quando a posse está %s', async (_label, claimResult) => {
    const fetchImpl = vi.fn();
    await expect(createQrSession({
      svc: sessionSvc({ claimResult }),
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
    })).rejects.toMatchObject({
      code: 'temp_claim_unavailable',
      status: 503,
      publicMessage: 'Não foi possível preparar a conexão',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('responde 503 quando a posse falha de forma inesperada', async () => {
    const fetchImpl = vi.fn();
    const svc = sessionSvc();
    svc.rpc = async (name) => {
      if (name === 'claim_whatsapp_temp_open') throw new Error('socket hang up');
      return { data: { canAdd: true, currentCount: 0, maxAllowed: 3, remaining: 3 }, error: null };
    };
    await expect(createQrSession({
      svc,
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
    })).rejects.toMatchObject({
      code: 'temp_claim_unavailable',
      status: 503,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('conflito de unicidade sem token remoto não inicia outra criação', async () => {
    let lookups = 0;
    const winner = {
      temp_instance_id: '44444444-4444-4444-8444-444444444444',
      instance_name: 'Comercial',
      company_id: COMPANY,
      uazapi_name: '11111111_Comercial_44444444',
      uazapi_instance_id: null,
      uazapi_token: null,
      status: 'creating',
      remote_init_state: 'unknown',
      init_started_at: '2026-11-04T11:00:00.000Z',
      qrcode: null,
      updated_at: new Date().toISOString(),
    };
    const fetchImpl = vi.fn();
    const svc = {
      rpc: async (name) => {
        if (name !== 'claim_whatsapp_temp_open') {
          return { data: { canAdd: true, currentCount: 0, maxAllowed: 3, remaining: 3 }, error: null };
        }
        return {
          data: {
            outcome: 'existing',
            temp_instance_id: winner.temp_instance_id,
            uazapi_name: winner.uazapi_name,
            remote_init_state: 'unknown',
            company_id: COMPANY,
            instance_name: 'Comercial',
          },
          error: null,
        };
      },
      from(table) {
        const builder = {
          select() { return builder; },
          eq() { return builder; },
          is() { return builder; },
          in() { return builder; },
          or() { return builder; },
          order() { return builder; },
          limit() { return builder; },
          maybeSingle: async () => {
            if (table !== 'whatsapp_temp_instances') return { data: null, error: null };
            lookups += 1;
            return { data: lookups === 1 ? null : winner, error: null };
          },
          insert() { return Promise.resolve({ error: { code: '23505' } }); },
          update() { throw new Error('não deveria atualizar'); },
        };
        return builder;
      },
    };
    await expect(createQrSession({
      svc,
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
    })).rejects.toMatchObject({
      code: 'init_unknown',
      extra: { recovery: { temp_instance_id: winner.temp_instance_id, company_id: COMPANY, status: 'unknown' } },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('não reutiliza operação encerrada nem instância de outra empresa', async () => {
    const closed = sessionSvc({
      open: {
        temp_instance_id: '55555555-5555-4555-8555-555555555555',
        instance_name: 'Comercial',
        company_id: COMPANY,
        uazapi_token: INSTANCE,
        uazapi_instance_id: 'remote-old',
        status: 'connected',
        qrcode: 'qr-antigo',
        updated_at: new Date().toISOString(),
      },
    });
    const closedFetch = fetchMock();
    const closedResult = await createQrSession({
      svc: closed,
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl: closedFetch.impl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE, VITE_SUPABASE_URL: 'https://example.supabase.co' },
    });
    expect(closed.state.inserts).toHaveLength(1);
    expect(closedFetch.calls.filter((call) => call.url.endsWith('/instance/init'))).toHaveLength(1);
    expect(closedResult.data.temp_instance_id).not.toBe('55555555-5555-4555-8555-555555555555');
    expect(JSON.stringify(closedResult)).not.toContain(INSTANCE);

    const foreign = sessionSvc({
      open: {
        temp_instance_id: '66666666-6666-4666-8666-666666666666',
        instance_name: 'Comercial',
        company_id: OTHER,
        uazapi_token: 'token-de-outra-empresa',
        uazapi_instance_id: 'remote-other',
        status: 'connecting',
        qrcode: 'qr-outra',
        updated_at: new Date().toISOString(),
      },
    });
    const foreignFetch = fetchMock();
    const foreignResult = await createQrSession({
      svc: foreign,
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl: foreignFetch.impl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE, VITE_SUPABASE_URL: 'https://example.supabase.co' },
    });
    expect(foreign.state.inserts).toHaveLength(1);
    expect(foreign.state.inserts[0].row.company_id).toBe(COMPANY);
    expect(JSON.stringify(foreignResult)).not.toContain('token-de-outra-empresa');
    expect(JSON.stringify(foreignResult)).not.toContain(ADMIN);
  });

  it('depois do timeout repete a mesma operação sem abrir outra linha', async () => {
    vi.useFakeTimers();
    const first = sessionSvc();
    const hanging = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const pending = createQrSession({
      svc: first,
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl: hanging,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
      budgetMs: INIT_CAP_MS,
    }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(INIT_CAP_MS);
    const error = await pending;
    vi.useRealTimers();
    const tempId = error.extra.recovery.temp_instance_id;
    expect(error.code).toBe('init_unknown');
    expect(first.state.inserts).toHaveLength(1);
    expect(first.state.updates.some((item) => item.row.remote_init_state === 'unknown' && item.eqs.some((eq) => eq[0] === 'company_id'))).toBe(true);

    const retry = sessionSvc({
      open: {
        temp_instance_id: tempId,
        instance_name: 'Comercial',
        company_id: COMPANY,
        uazapi_name: '11111111_Comercial_retry',
        uazapi_instance_id: null,
        uazapi_token: null,
        status: 'created_no_qr',
        remote_init_state: 'unknown',
        init_started_at: '2026-11-04T10:59:00.000Z',
        qrcode: null,
        updated_at: '2026-11-04T11:00:00.000Z',
      },
    });
    const network = fetchMock();
    await expect(createQrSession({
      svc: retry,
      companyId: COMPANY,
      instanceName: 'Comercial',
      tempInstanceId: tempId,
      fetchImpl: network.impl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE, VITE_SUPABASE_URL: 'https://example.supabase.co' },
      now: () => new Date('2026-11-04T12:00:40.000Z'),
    })).rejects.toMatchObject({
      code: 'init_unknown',
      extra: { recovery: { temp_instance_id: tempId, status: 'unknown' } },
    });
    expect(retry.state.inserts).toHaveLength(0);
    expect(network.calls.filter((call) => String(call.url).endsWith('/instance/init'))).toHaveLength(0);
    expect(JSON.stringify(network.calls)).not.toContain(ADMIN);
  });

  it('a posse da operação faz um único init e a outra requisição recupera a vencedora', async () => {
    let winner = null;
    let readWinner = false;
    const inits = [];
    const svc = {
      rpc: async (name, args) => {
        if (name !== 'claim_whatsapp_temp_open') {
          return { data: { canAdd: true, currentCount: 0, maxAllowed: 3, remaining: 3 }, error: null };
        }
        if (!winner) {
          winner = {
            temp_instance_id: args.p_temp_id,
            instance_name: 'Comercial',
            company_id: COMPANY,
            uazapi_name: args.p_uazapi_name,
            uazapi_instance_id: null,
            uazapi_token: null,
            status: 'creating',
            remote_init_state: 'reserved',
            qrcode: null,
            updated_at: new Date().toISOString(),
          };
          return { data: { outcome: 'created', temp_instance_id: args.p_temp_id, uazapi_name: args.p_uazapi_name }, error: null };
        }
        readWinner = true;
        return { data: { outcome: 'existing', temp_instance_id: winner.temp_instance_id }, error: null };
      },
      from(table) {
        const builder = {
          select() { return builder; },
          eq() { return builder; },
          is() { return builder; },
          in() { return builder; },
          or() { return builder; },
          order() { return builder; },
          limit() { return builder; },
          maybeSingle: async () => {
            if (table !== 'whatsapp_temp_instances' || !readWinner) return { data: null, error: null };
            return { data: winner, error: null };
          },
          insert() { throw new Error('a posse já inseriu a linha'); },
          update() {
            const eqs = [];
            const updated = {
              eq(column, value) { eqs.push([column, value]); return updated; },
              select() { return updated; },
              then(resolve, reject) {
                const claims = eqs.some(([column, value]) => column === 'remote_init_state' && value === 'reserved');
                if (claims) {
                  if (winner?.remote_init_state === 'reserved') {
                    winner.remote_init_state = 'unknown';
                    return Promise.resolve({ data: [{ temp_instance_id: winner.temp_instance_id }], error: null }).then(resolve, reject);
                  }
                  return Promise.resolve({ data: [], error: null }).then(resolve, reject);
                }
                if (winner) Object.assign(winner, {});
                return Promise.resolve({ data: null, error: null }).then(resolve, reject);
              },
            };
            return updated;
          },
        };
        return builder;
      },
    };
    const fetchImpl = async (url) => {
      if (String(url).endsWith('/instance/init')) {
        inits.push(url);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { status: 200, text: async () => JSON.stringify({ token: INSTANCE, instance: { id: 'remote-1' } }) };
      }
      if (String(url).endsWith('/instance/connect')) {
        return { status: 200, text: async () => JSON.stringify({ qrcode: 'qr-fixture', paircode: null }) };
      }
      return { status: 200, text: async () => '{}' };
    };
    const input = {
      svc,
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE, VITE_SUPABASE_URL: 'https://example.supabase.co' },
    };
    const settled = await Promise.allSettled([createQrSession(input), createQrSession(input)]);
    const ok = settled.find((item) => item.status === 'fulfilled');
    const denied = settled.find((item) => item.status === 'rejected');
    expect(inits).toHaveLength(1);
    expect(ok.value.data.temp_instance_id).toBe(winner.temp_instance_id);
    expect(denied.reason.code).toBe('init_unknown');
    expect(denied.reason.extra.recovery.temp_instance_id).toBe(winner.temp_instance_id);
    expect(JSON.stringify(ok.value)).not.toContain(INSTANCE);
    expect(JSON.stringify(denied.reason.extra)).not.toContain(INSTANCE);
    expect(JSON.stringify(denied.reason.extra)).not.toContain(ADMIN);
  });

  it('timeout antes do envio não chama init e preserva a reserva', async () => {
    const fetchImpl = vi.fn();
    const svc = sessionSvc();
    await expect(createQrSession({
      svc,
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
      budgetMs: 0,
    })).rejects.toMatchObject({
      code: 'budget_exceeded',
      extra: { recovery: { status: 'reserved' } },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(svc.state.held.remote_init_state).toBe('reserved');
    expect(JSON.stringify(svc.state.held)).not.toContain(ADMIN);
  });

  it('resposta ausente e repetição após 50 segundos não chamam init de novo', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 500, text: async () => '' }));
    const first = sessionSvc();
    const error = await createQrSession({
      svc: first,
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
    }).catch((failure) => failure);
    expect(error.code).toBe('init_unknown');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const tempId = error.extra.recovery.temp_instance_id;

    const retry = sessionSvc({
      open: {
        temp_instance_id: tempId,
        instance_name: 'Comercial',
        company_id: COMPANY,
        uazapi_name: 'nome-remoto',
        uazapi_instance_id: null,
        uazapi_token: null,
        status: 'creating',
        remote_init_state: 'unknown',
        init_started_at: '2026-11-04T10:00:00.000Z',
        qrcode: null,
        updated_at: '2026-11-04T10:00:00.000Z',
      },
    });
    const again = vi.fn();
    await expect(createQrSession({
      svc: retry,
      companyId: COMPANY,
      instanceName: 'Comercial',
      tempInstanceId: tempId,
      fetchImpl: again,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
      now: () => new Date('2026-11-04T12:00:00.000Z'),
    })).rejects.toMatchObject({
      code: 'init_unknown',
      extra: { recovery: { temp_instance_id: tempId, company_id: COMPANY } },
    });
    expect(again).not.toHaveBeenCalled();
    expect(retry.state.inserts).toHaveLength(0);
    expect(JSON.stringify(error.extra)).not.toContain(ADMIN);
    expect(JSON.stringify(error.extra)).not.toContain(INSTANCE);
  });

  it('recusa comprovada encerra a operação e não devolve credencial', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 400, text: async () => JSON.stringify({ token: INSTANCE, error: 'recusada' }) }));
    const error = await createQrSession({
      svc: sessionSvc(),
      companyId: COMPANY,
      instanceName: 'Comercial',
      fetchImpl,
      env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
    }).catch((failure) => failure);
    expect(error.code).toBe('init_failed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.extra)).not.toContain(INSTANCE);
    expect(JSON.stringify(error.extra)).not.toContain(ADMIN);
  });
});
