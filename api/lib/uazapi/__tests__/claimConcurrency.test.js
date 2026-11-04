import { describe, expect, it } from 'vitest';
import { createQrSession } from '../qrSession.js';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ADMIN = 'fixture-admin-not-real';
const INSTANCE = 'fixture-instance-not-real';
const BASE = 'https://uazapi.test';
const OPEN = ['creating', 'created', 'created_no_qr', 'connecting'];
const CLAIMABLE = ['reserved', 'unknown', 'confirmed'];

function memorySvc(options = {}) {
  const rows = options.rows ?? [];
  let claimTail = Promise.resolve();
  return {
    rows,
    rpc: async (name, args) => {
      if (name !== 'claim_whatsapp_temp_open') {
        return { data: { canAdd: true, currentCount: 0, maxAllowed: 3, remaining: 3 }, error: null };
      }
      if (options.claimEnabled === false) {
        return { data: null, error: { code: 'PGRST202', message: 'claim_whatsapp_temp_open' } };
      }
      const job = claimTail.then(() => {
        const existing = rows
          .filter((row) => row.company_id === args.p_company_id
            && row.instance_name === args.p_instance_name
            && OPEN.includes(row.status)
            && CLAIMABLE.includes(row.remote_init_state))
          .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))[0];
        if (existing) {
          return {
            data: {
              outcome: 'existing',
              temp_instance_id: existing.temp_instance_id,
              uazapi_name: existing.uazapi_name,
              status: existing.status,
              remote_init_state: existing.remote_init_state,
              company_id: existing.company_id,
              instance_name: existing.instance_name,
            },
            error: null,
          };
        }
        rows.push({
          temp_instance_id: args.p_temp_id,
          company_id: args.p_company_id,
          instance_name: args.p_instance_name,
          uazapi_name: args.p_uazapi_name,
          status: 'creating',
          remote_init_state: 'reserved',
          updated_at: new Date().toISOString(),
          uazapi_token: null,
          uazapi_instance_id: null,
          qrcode: null,
        });
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
      });
      claimTail = job.then(() => {}, () => {});
      return job;
    },
    from(table) {
      const filters = [];
      const builder = {
        select() { return builder; },
        eq(column, value) { filters.push(['eq', column, value]); return builder; },
        is() { return builder; },
        in(column, value) { filters.push(['in', column, value]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle: async () => {
          if (table !== 'whatsapp_temp_instances') return { data: null, error: null };
          const value = (column) => filters.find((item) => item[0] === 'eq' && item[1] === column)?.[2];
          const statuses = filters.find((item) => item[0] === 'in' && item[1] === 'status')?.[2];
          const found = rows
            .filter((row) => (
              (!value('company_id') || row.company_id === value('company_id'))
              && (!value('instance_name') || row.instance_name === value('instance_name'))
              && (!value('temp_instance_id') || row.temp_instance_id === value('temp_instance_id'))
              && (!statuses || statuses.includes(row.status))
            ))
            .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));
          return { data: found[0] ?? null, error: null };
        },
        insert(row) {
          rows.push({
            ...row,
            uazapi_token: null,
            uazapi_instance_id: null,
            qrcode: null,
          });
          return Promise.resolve({ error: null });
        },
        update(values) {
          const eqs = [];
          const updated = {
            eq(column, value) { eqs.push([column, value]); return updated; },
            select() { return updated; },
            then(resolve, reject) {
              const required = eqs.find(([column]) => column === 'remote_init_state')?.[1];
              const companyId = eqs.find(([column]) => column === 'company_id')?.[1];
              const tempId = eqs.find(([column]) => column === 'temp_instance_id')?.[1];
              const targets = rows.filter((row) => (
                (!companyId || row.company_id === companyId)
                && (!tempId || row.temp_instance_id === tempId)
                && (!required || row.remote_init_state === required)
              ));
              if (required) {
                if (targets.length !== 1) {
                  return Promise.resolve({ data: [], error: null }).then(resolve, reject);
                }
                Object.assign(targets[0], values);
                return Promise.resolve({
                  data: [{ temp_instance_id: targets[0].temp_instance_id }],
                  error: null,
                }).then(resolve, reject);
              }
              targets.forEach((row) => Object.assign(row, values));
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

function fetchImpl(inits) {
  return async (url) => {
    if (String(url).endsWith('/instance/init')) {
      inits.push(url);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        status: 200,
        text: async () => JSON.stringify({ token: INSTANCE, instance: { id: 'remote-1' } }),
      };
    }
    if (String(url).endsWith('/instance/connect')) {
      return { status: 200, text: async () => JSON.stringify({ qrcode: 'qr-fixture', paircode: null }) };
    }
    return { status: 200, text: async () => '{}' };
  };
}

function input(svc, fetch, companyId = COMPANY) {
  return {
    svc,
    companyId,
    instanceName: 'Comercial',
    fetchImpl: fetch,
    env: { UAZAPI_ADMIN_TOKEN: ADMIN, UAZAPI_BASE_URL: BASE },
  };
}

describe('posse da operação temporária', () => {
  it('duas requisições simultâneas criam uma linha e um único init', async () => {
    const svc = memorySvc();
    const inits = [];
    const fetch = fetchImpl(inits);
    const settled = await Promise.allSettled([
      createQrSession(input(svc, fetch)),
      createQrSession(input(svc, fetch)),
    ]);
    const open = svc.rows.filter((row) => row.instance_name === 'Comercial' && OPEN.includes(row.status));
    expect(open).toHaveLength(1);
    expect(inits).toHaveLength(1);
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const denied = settled.find((item) => item.status === 'rejected');
    expect(denied.reason.code).toBe('init_unknown');
    expect(denied.reason.extra.recovery.temp_instance_id).toBe(open[0].temp_instance_id);
    expect(JSON.stringify(settled)).not.toContain(ADMIN);
    expect(JSON.stringify(settled)).not.toContain(INSTANCE);
  });

  it('duplicidades antigas em unknown não geram outra linha nem outro init', async () => {
    const svc = memorySvc({
      rows: [
        {
          temp_instance_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          company_id: COMPANY,
          instance_name: 'Comercial',
          uazapi_name: 'antigo-1',
          status: 'connecting',
          remote_init_state: 'unknown',
          updated_at: '2026-05-01T00:00:00.000Z',
        },
        {
          temp_instance_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          company_id: COMPANY,
          instance_name: 'Comercial',
          uazapi_name: 'antigo-2',
          status: 'connecting',
          remote_init_state: 'unknown',
          updated_at: '2026-09-01T00:00:00.000Z',
        },
      ],
    });
    const inits = [];
    const settled = await Promise.allSettled([
      createQrSession(input(svc, fetchImpl(inits))),
      createQrSession(input(svc, fetchImpl(inits))),
    ]);
    expect(svc.rows).toHaveLength(2);
    expect(inits).toHaveLength(0);
    expect(settled.every((item) => item.status === 'rejected' && item.reason.code === 'init_unknown')).toBe(true);
    expect(settled.every((item) => item.reason.extra.recovery.temp_instance_id === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe(true);
  });

  it('isola empresa e nome', async () => {
    const svc = memorySvc();
    const inits = [];
    const fetch = fetchImpl(inits);
    const other = { ...input(svc, fetch, OTHER), instanceName: 'Outra' };
    const settled = await Promise.allSettled([
      createQrSession(input(svc, fetch)),
      createQrSession(other),
    ]);
    expect(settled.every((item) => item.status === 'fulfilled')).toBe(true);
    expect(inits).toHaveLength(2);
    expect(svc.rows.map((row) => row.company_id).sort()).toEqual([COMPANY, OTHER].sort());
  });

  it('sem a RPC e sem índice único não chama init', async () => {
    const svc = memorySvc({ claimEnabled: false });
    const inits = [];
    const fetch = fetchImpl(inits);
    const settled = await Promise.allSettled([
      createQrSession(input(svc, fetch)),
      createQrSession(input(svc, fetch)),
    ]);
    expect(svc.rows).toHaveLength(0);
    expect(inits).toHaveLength(0);
    expect(settled.every((item) => item.status === 'rejected' && item.reason.code === 'temp_claim_unavailable' && item.reason.status === 503)).toBe(true);
    expect(JSON.stringify(settled)).not.toContain(ADMIN);
    expect(JSON.stringify(settled)).not.toContain(INSTANCE);
  });
});
