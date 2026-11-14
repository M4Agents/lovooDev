import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getWelcomeCampaign, saveWelcomeCampaign } from '../welcomePopupConfig.js';

const COMPANY_A = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413';
const COMPANY_B = '3cbe5c11-d834-40d1-b1cf-425e6377f099';
const STORE = '7680914';
const OTHER_STORE = '8047001';

function memory(seed = {}) {
  const tables = {
    nuvemshop_connections: (seed.connections ?? []).map((row) => ({ ...row })),
    nuvemshop_welcome_campaigns: (seed.campaigns ?? []).map((row) => ({ ...row })),
  };

  function matched(table, filters) {
    return tables[table].filter((row) => filters.every(([column, value]) => row[column] === value));
  }

  function storedError(table) {
    if (table === 'nuvemshop_welcome_campaigns' && seed.campaignError) {
      return seed.campaignError;
    }
    return null;
  }

  function from(table) {
    const filters = [];
    const api = {
      select() { return api; },
      eq(column, value) { filters.push([column, value]); return api; },
      maybeSingle() {
        const failure = storedError(table);
        if (failure) return Promise.resolve({ data: null, error: failure });
        const rows = matched(table, filters);
        if (rows.length > 1) return Promise.resolve({ data: null, error: { message: 'muitas linhas' } });
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      update(patch) {
        const updateFilters = [];
        const chain = {
          eq(column, value) { updateFilters.push([column, value]); return chain; },
          select() {
            return {
              single: async () => {
                const rows = matched(table, updateFilters);
                if (rows.length !== 1) return { data: null, error: { message: 'muitas linhas' } };
                Object.assign(rows[0], patch, { updated_at: '2026-11-14T13:00:00.000Z' });
                return { data: { ...rows[0] }, error: null };
              },
            };
          },
        };
        return chain;
      },
      insert(row) {
        const stored = {
          id: `id-${tables[table].length + 1}`,
          updated_at: '2026-11-14T13:00:00.000Z',
          ...row,
        };
        tables[table].push(stored);
        return {
          select() {
            return { single: async () => ({ data: { ...stored }, error: null }) };
          },
        };
      },
    };
    return api;
  }

  return { from, tables };
}

function connected(companyId, storeId = STORE, status = 'active') {
  return { id: `conn-${companyId}`, company_id: companyId, nuvemshop_store_id: storeId, status };
}

describe('configuração do pop-up por loja', () => {
  it('salva rascunho incompleto desativado e preserva o que já existia', async () => {
    const db = memory({
      connections: [connected(COMPANY_A)],
      campaigns: [{
        id: 'camp-a',
        company_id: COMPANY_A,
        nuvemshop_store_id: STORE,
        enabled: false,
        page_rule: 'home',
        title: 'Olá',
        coupon_code: null,
      }],
    });
    const findCoupon = vi.fn();

    const saved = await saveWelcomeCampaign({
      svc: db,
      companyId: COMPANY_A,
      storeId: STORE,
      userId: 'user-1',
      payload: { delay_seconds: '10' },
      findCoupon,
    });

    expect(saved.ok).toBe(true);
    expect(saved.campaign.enabled).toBe(false);
    expect(saved.campaign.title).toBe('Olá');
    expect(saved.campaign.delay_seconds).toBe(10);
    expect(saved.campaign.company_id).toBe(COMPANY_A);
    expect(findCoupon).not.toHaveBeenCalled();
    expect(db.tables.nuvemshop_welcome_campaigns).toHaveLength(1);
    expect(db.tables.nuvemshop_welcome_campaigns[0].enabled).toBe(false);
    expect(db.tables.nuvemshop_welcome_campaigns[0].updated_by).toBe('user-1');
  });

  it('cria rascunho vazio sem consultar cupom', async () => {
    const db = memory({ connections: [connected(COMPANY_A)] });
    const findCoupon = vi.fn();
    const saved = await saveWelcomeCampaign({
      svc: db,
      companyId: COMPANY_A,
      storeId: STORE,
      userId: 'user-1',
      payload: {},
      findCoupon,
    });

    expect(saved.ok).toBe(true);
    expect(saved.campaign.title).toBeNull();
    expect(saved.campaign.coupon_code).toBeNull();
    expect(saved.campaign.enabled).toBe(false);
    expect(findCoupon).not.toHaveBeenCalled();
  });

  it('recusa enabled verdadeiro antes de gravar ou consultar cupom', async () => {
    const db = memory({ connections: [connected(COMPANY_A)] });
    const findCoupon = vi.fn();
    const saved = await saveWelcomeCampaign({
      svc: db,
      companyId: COMPANY_A,
      storeId: STORE,
      userId: 'user-1',
      payload: { enabled: true, title: 'Publicar', coupon_code: 'CUPOM10' },
      findCoupon,
    });

    expect(saved.ok).toBe(false);
    expect(saved.error.status).toBe(409);
    expect(saved.error.code).toBe('publication_blocked');
    expect(findCoupon).not.toHaveBeenCalled();
    expect(db.tables.nuvemshop_welcome_campaigns).toHaveLength(0);
  });

  it('valida valor preenchido e não grava cor ou cupom inválidos', async () => {
    const db = memory({ connections: [connected(COMPANY_A)] });
    const findCoupon = vi.fn();
    const color = await saveWelcomeCampaign({
      svc: db,
      companyId: COMPANY_A,
      storeId: STORE,
      payload: { background_color: 'azul' },
      findCoupon,
    });
    const coupon = await saveWelcomeCampaign({
      svc: db,
      companyId: COMPANY_A,
      storeId: STORE,
      payload: { coupon_code: 'inválido' },
      findCoupon,
    });

    expect(color.error.field).toBe('background_color');
    expect(coupon.error.field).toBe('coupon_code');
    expect(findCoupon).not.toHaveBeenCalled();
    expect(db.tables.nuvemshop_welcome_campaigns).toHaveLength(0);
  });

  it('consulta o cupom só na conexão ativa da empresa e não grava se ele não existe', async () => {
    const db = memory({ connections: [connected(COMPANY_A)] });
    const findCoupon = vi.fn(async () => ({
      ok: false,
      error: { status: 422, code: 'coupon_not_found', message: 'ausente', field: 'coupon_code' },
    }));

    const saved = await saveWelcomeCampaign({
      svc: db,
      companyId: COMPANY_A,
      storeId: STORE,
      payload: { company_id: COMPANY_B, store_id: OTHER_STORE, coupon_code: 'cupom10' },
      findCoupon,
    });

    expect(saved.error.code).toBe('coupon_not_found');
    expect(findCoupon).toHaveBeenCalledWith(expect.objectContaining({
      companyId: COMPANY_A,
      storeId: STORE,
      code: 'CUPOM10',
    }));
    expect(db.tables.nuvemshop_welcome_campaigns).toHaveLength(0);
  });

  it('não consulta cupom nem grava quando a loja não é a conexão ativa', async () => {
    const db = memory({ connections: [connected(COMPANY_B, STORE), connected(COMPANY_A, STORE, 'disconnected')] });
    const findCoupon = vi.fn();
    const saved = await saveWelcomeCampaign({
      svc: db,
      companyId: COMPANY_A,
      storeId: STORE,
      payload: { coupon_code: 'CUPOM10' },
      findCoupon,
    });

    expect(saved.error.status).toBe(404);
    expect(findCoupon).not.toHaveBeenCalled();
  });

  it('isola a leitura e a atualização entre empresas com o mesmo número de loja', async () => {
    const db = memory({
      connections: [connected(COMPANY_A), connected(COMPANY_B)],
      campaigns: [{
        id: 'camp-b',
        company_id: COMPANY_B,
        nuvemshop_store_id: STORE,
        enabled: true,
        title: 'Segredo',
        coupon_code: 'OUTRO',
      }],
    });

    const seen = await getWelcomeCampaign({ svc: db, companyId: COMPANY_A, storeId: STORE });
    expect(seen.campaign.company_id).toBe(COMPANY_A);
    expect(seen.campaign.title).toBeNull();
    expect(seen.campaign.enabled).toBe(false);

    const saved = await saveWelcomeCampaign({
      svc: db,
      companyId: COMPANY_A,
      storeId: STORE,
      userId: 'user-a',
      payload: { title: 'Público A' },
      findCoupon: vi.fn(),
    });

    expect(saved.campaign.title).toBe('Público A');
    expect(saved.campaign.enabled).toBe(false);
    const foreign = db.tables.nuvemshop_welcome_campaigns.find((row) => row.company_id === COMPANY_B);
    expect(foreign.title).toBe('Segredo');
    expect(foreign.coupon_code).toBe('OUTRO');
  });

  it('não lê campanha de outra loja da mesma empresa', async () => {
    const db = memory({ connections: [connected(COMPANY_A, OTHER_STORE)] });
    const seen = await getWelcomeCampaign({ svc: db, companyId: COMPANY_A, storeId: STORE });
    expect(seen.error.status).toBe(404);
  });

  it.each(['PGRST205', '42P01'])('responde recurso indisponível quando a tabela ainda não existe (%s)', async (code) => {
    const db = memory({
      connections: [connected(COMPANY_A)],
      campaignError: { code, message: 'relation missing' },
    });
    const seen = await getWelcomeCampaign({ svc: db, companyId: COMPANY_A, storeId: STORE });
    const saved = await saveWelcomeCampaign({
      svc: db,
      companyId: COMPANY_A,
      storeId: STORE,
      payload: { title: 'Rascunho' },
      findCoupon: vi.fn(),
    });

    expect(seen.error).toMatchObject({ status: 503, code: 'resource_unavailable' });
    expect(saved.error).toMatchObject({ status: 503, code: 'resource_unavailable' });
    expect(seen.error.message).toMatch(/ainda não está disponível/);
    expect(db.tables.nuvemshop_welcome_campaigns).toHaveLength(0);
  });

  it('não trata outro erro de banco como migration pendente', async () => {
    const db = memory({
      connections: [connected(COMPANY_A)],
      campaignError: { code: '57014', message: 'canceling statement due to statement timeout' },
    });
    const seen = await getWelcomeCampaign({ svc: db, companyId: COMPANY_A, storeId: STORE });

    expect(seen.error).toMatchObject({ status: 500, code: 'db_error' });
    expect(seen.error.message).not.toMatch(/ainda não está disponível/);
  });

  it('não grava quando a consulta do cupom fica inconclusiva', async () => {
    const db = memory({ connections: [connected(COMPANY_A)] });
    const findCoupon = vi.fn(async () => ({
      ok: false,
      error: {
        status: 503,
        code: 'coupon_search_incomplete',
        message: 'A consulta de cupons não foi concluída. Tente novamente em instantes.',
        field: 'coupon_code',
      },
    }));
    const saved = await saveWelcomeCampaign({
      svc: db,
      companyId: COMPANY_A,
      storeId: STORE,
      payload: { coupon_code: 'CUPOM10' },
      findCoupon,
    });

    expect(saved.error.code).toBe('coupon_search_incomplete');
    expect(saved.error.status).toBe(503);
    expect(db.tables.nuvemshop_welcome_campaigns).toHaveLength(0);
  });
});

describe('migration do pop-up', () => {
  const sql = readFileSync(
    resolve(import.meta.dirname, '../../../../supabase/migrations/20261114110000_nuvemshop_welcome_campaigns.sql'),
    'utf8',
  );

  it('nasce desativada, isola por empresa e não abre escrita ao browser', () => {
    expect(sql).toContain('CREATE TABLE public.nuvemshop_welcome_campaigns');
    expect(sql).toContain('enabled               BOOLEAN     NOT NULL DEFAULT false');
    expect(sql).toContain('CHECK (enabled = false)');
    expect(sql).toContain('UNIQUE (company_id, nuvemshop_store_id)');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('public.auth_user_is_company_member(company_id)');
    expect(sql).toContain('FOR SELECT');
    expect(sql).not.toMatch(/FOR INSERT|FOR UPDATE|FOR DELETE/);
    expect(sql).toContain('REVOKE ALL ON TABLE public.nuvemshop_welcome_campaigns FROM anon');
    expect(sql).toContain('REVOKE ALL ON TABLE public.nuvemshop_welcome_campaigns FROM authenticated');
    expect(sql).toContain('GRANT SELECT ON TABLE public.nuvemshop_welcome_campaigns TO authenticated');
    expect(sql).toContain('GRANT ALL ON TABLE public.nuvemshop_welcome_campaigns TO service_role');
    expect(sql).not.toMatch(/cashback|m4track|9213|Cashing/i);
  });
});
