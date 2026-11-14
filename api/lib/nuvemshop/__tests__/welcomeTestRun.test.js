import { describe, expect, it } from 'vitest';
import { clearWelcomeTests, runWelcomeTest } from '../welcomeTestRun.js';

const COMPANY = '3cbe5c11-d834-40d1-b1cf-425e6377f099';
const STORE = '7680914';
const CONTACT = { email: 'teste@valleron.store', phone: '5511999999999' };

function ilikeExact(pattern, value) {
  let expression = '';
  const source = String(pattern);
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\' && index + 1 < source.length) {
      expression += source[index + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      index += 1;
      continue;
    }
    if (char === '%') {
      expression += '.*';
      continue;
    }
    if (char === '_') {
      expression += '.';
      continue;
    }
    expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${expression}$`, 'i').test(String(value ?? ''));
}

function fake(seed = {}) {
  const state = {
    leads: (seed.leads ?? []).map((row) => ({ ...row })),
    opportunities: (seed.opportunities ?? []).map((row) => ({ ...row })),
    submissions: [],
    leadWrites: 0,
  };

  function from(table) {
    const filters = [];
    const api = {
      select() { return api; },
      eq(column, value) { filters.push(['eq', column, value]); return api; },
      is() { return api; },
      in(column, values) { filters.push(['in', column, values]); return api; },
      ilike(column, value) { filters.push(['ilike', column, String(value)]); return api; },
      limit() { return api; },
      maybeSingle() {
        if (table === 'nuvemshop_connections') {
          const ok = seed.connection !== false;
          return Promise.resolve({ data: ok ? { id: 'conn' } : null, error: null });
        }
        if (table === 'nuvemshop_welcome_campaigns') {
          return Promise.resolve({
            data: seed.campaign === null ? null : {
              id: 'camp',
              consent_version: '2026-11',
              test_contacts: seed.contacts ?? [CONTACT],
              enabled: false,
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: { message: 'tabela inesperada' } });
      },
      insert(row) {
        if (table === 'leads') state.leadWrites += 1;
        if (table !== 'nuvemshop_welcome_test_submissions') {
          return { select: () => ({ single: async () => ({ data: null, error: { message: 'insert indevido' } }) }) };
        }
        state.submissions.push(row);
        return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
      },
      delete() {
        const removed = state.submissions.length;
        state.submissions = [];
        const chain = {
          eq() { return chain; },
          then(resolve, reject) {
            return Promise.resolve({ error: null, count: removed }).then(resolve, reject);
          },
        };
        return chain;
      },
      then(resolve, reject) {
        if (table === 'leads' && seed.leadError) {
          return Promise.resolve({ data: null, error: seed.leadError }).then(resolve, reject);
        }
        if (table === 'opportunities' && seed.purchaseError) {
          return Promise.resolve({ data: null, error: seed.purchaseError }).then(resolve, reject);
        }
        const rows = table === 'leads' ? state.leads : state.opportunities;
        const data = rows.filter((row) => filters.every(([op, column, value]) => {
          if (op === 'in') return value.includes(row[column]);
          if (op === 'ilike') return ilikeExact(value, row[column]);
          return row[column] === value;
        }));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return api;
  }

  return { from, state };
}

function payload(overrides = {}) {
  return {
    name: 'Teste Valleron',
    email: 'teste@valleron.store',
    phone: '11999999999',
    coupon_consent: true,
    promo_consent: false,
    ...overrides,
  };
}

describe('teste autenticado', () => {
  it('registra elegibilidade limitada sem criar lead nem revelar cupom', async () => {
    const db = fake();
    const result = await runWelcomeTest({
      svc: db, companyId: COMPANY, storeId: STORE, userId: 'user-1', payload: payload(),
    });

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      identity: 'none',
      eligibility: 'eligible_limited',
      coupon_revealed: false,
      redirect: false,
      lead_changed: false,
    });
    expect(result.result.limitation).toMatch(/não comprova primeira compra/);
    expect(db.state.leadWrites).toBe(0);
    expect(db.state.submissions).toHaveLength(1);
    expect(db.state.submissions[0].coupon_code).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/BEMVINDO10/);
  });

  it('não concede compra paga e não trata won isolado como pagamento', async () => {
    const paid = fake({
      leads: [{ id: 7, company_id: COMPANY, phone_normalized: '5511999999999', email: CONTACT.email, deleted_at: null }],
      opportunities: [{
        company_id: COMPANY,
        lead_id: 7,
        nuvemshop_store_id: STORE,
        nuvemshop_order_id: '1',
        status: 'won',
        nuvemshop_payment_data: { payment_status: 'paid' },
      }],
    });
    const won = fake({
      leads: [{ id: 7, company_id: COMPANY, phone_normalized: '5511999999999', email: CONTACT.email, deleted_at: null }],
      opportunities: [{
        company_id: COMPANY,
        lead_id: 7,
        nuvemshop_store_id: STORE,
        nuvemshop_order_id: '2',
        status: 'won',
        nuvemshop_payment_data: null,
      }],
    });

    const paidResult = await runWelcomeTest({
      svc: paid, companyId: COMPANY, storeId: STORE, payload: payload(),
    });
    const wonResult = await runWelcomeTest({
      svc: won, companyId: COMPANY, storeId: STORE, payload: payload(),
    });

    expect(paidResult.result.eligibility).toBe('ineligible_paid');
    expect(wonResult.result.eligibility).toBe('payment_inconclusive');
    expect(wonResult.result.eligibility).not.toBe('eligible_limited');
    expect(paid.state.leads).toHaveLength(1);
    expect(won.state.leads).toHaveLength(1);
  });

  it('falha de leitura não vira elegibilidade por ausência', async () => {
    const db = fake({
      leads: [{ id: 7, company_id: COMPANY, phone_normalized: '5511999999999', email: CONTACT.email, deleted_at: null }],
      purchaseError: { message: 'timeout' },
    });
    const result = await runWelcomeTest({
      svc: db, companyId: COMPANY, storeId: STORE, payload: payload(),
    });

    expect(result.result.eligibility).toBe('unavailable');
    expect(result.result.eligibility).not.toBe('eligible_limited');
  });

  it('não casa underscore como curinga e não escolhe entre vários e-mails', async () => {
    const literal = 'ana_b@valleron.store';
    const widened = fake({
      contacts: [{ email: literal, phone: CONTACT.phone }],
      leads: [{
        id: 4,
        company_id: COMPANY,
        phone_normalized: '5511888888888',
        email: 'anaxb@valleron.store',
        deleted_at: null,
      }],
    });
    const several = fake({
      contacts: [{ email: literal, phone: CONTACT.phone }],
      leads: [
        { id: 8, company_id: COMPANY, phone_normalized: CONTACT.phone, email: 'Ana_B@valleron.store', deleted_at: null },
        { id: 9, company_id: COMPANY, phone_normalized: '5511888888888', email: 'ana_b@valleron.store', deleted_at: null },
        { id: 10, company_id: COMPANY, phone_normalized: '5511777777777', email: 'anaxb@valleron.store', deleted_at: null },
      ],
    });

    const missed = await runWelcomeTest({
      svc: widened,
      companyId: COMPANY,
      storeId: STORE,
      payload: payload({ email: literal }),
    });
    const conflict = await runWelcomeTest({
      svc: several,
      companyId: COMPANY,
      storeId: STORE,
      payload: payload({ email: literal }),
    });

    expect(missed.result).toMatchObject({ identity: 'none', eligibility: 'eligible_limited' });
    expect(missed.result.observed_lead_id).toBeUndefined();
    expect(widened.state.submissions[0].observed_lead_id).toBeNull();
    expect(conflict.result).toMatchObject({ identity: 'conflict', eligibility: 'not_evaluated' });
    expect(several.state.submissions[0].observed_lead_id).toBeNull();
    expect(several.state.submissions[0].observed_lead_id).not.toBe(8);
  });

  it('reconhece o mesmo e-mail com caixa diferente sem usar curinga', async () => {
    const db = fake({
      contacts: [{ email: 'ana_b@valleron.store', phone: CONTACT.phone }],
      leads: [{
        id: 6,
        company_id: COMPANY,
        phone_normalized: CONTACT.phone,
        email: 'Ana_B@Valleron.store',
        deleted_at: null,
      }],
    });
    const result = await runWelcomeTest({
      svc: db,
      companyId: COMPANY,
      storeId: STORE,
      payload: payload({ email: 'ana_b@valleron.store' }),
    });

    expect(result.result.identity).toBe('reuse');
    expect(db.state.submissions[0].observed_lead_id).toBe(6);
    expect(db.state.leadWrites).toBe(0);
  });

  it('não mescla leads diferentes nem grava sem contato autorizado', async () => {
    const db = fake({
      leads: [
        { id: 1, company_id: COMPANY, phone_normalized: '5511999999999', email: 'outro@valleron.store', deleted_at: null },
        { id: 2, company_id: COMPANY, phone_normalized: '5511888888888', email: CONTACT.email, deleted_at: null },
      ],
    });
    const conflict = await runWelcomeTest({
      svc: db, companyId: COMPANY, storeId: STORE, payload: payload(),
    });
    const denied = await runWelcomeTest({
      svc: db,
      companyId: COMPANY,
      storeId: STORE,
      payload: payload({ email: 'fora@valleron.store' }),
    });

    expect(conflict.result).toMatchObject({ identity: 'conflict', eligibility: 'not_evaluated' });
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe('contact_not_authorized');
    expect(db.state.submissions).toHaveLength(1);
    expect(db.state.leadWrites).toBe(0);
  });

  it('autoriza o contato depois de normalizar e-mail e celular', async () => {
    const db = fake({
      contacts: [{ email: 'ana_b@valleron.store', phone: '5555999999999' }],
    });
    const result = await runWelcomeTest({
      svc: db,
      companyId: COMPANY,
      storeId: STORE,
      payload: payload({
        email: ' Ana_B@Valleron.store ',
        phone: '+55 (55) 99999-9999',
      }),
    });
    const duplicated = await runWelcomeTest({
      svc: db,
      companyId: COMPANY,
      storeId: STORE,
      payload: payload({ email: 'ana_b@valleron.store', phone: '555559999999999' }),
    });

    expect(result.ok).toBe(true);
    expect(db.state.submissions[0].email_normalized).toBe('ana_b@valleron.store');
    expect(db.state.submissions[0].phone_normalized).toBe('5555999999999');
    expect(db.state.leadWrites).toBe(0);
    expect(duplicated.ok).toBe(false);
    expect(duplicated.error.field).toBe('phone');
    expect(db.state.submissions).toHaveLength(1);
  });

  it('limpa só os resultados de teste', async () => {
    const db = fake();
    await runWelcomeTest({ svc: db, companyId: COMPANY, storeId: STORE, payload: payload() });
    const cleared = await clearWelcomeTests({ svc: db, companyId: COMPANY, storeId: STORE });

    expect(cleared).toEqual({ ok: true, deleted: 1 });
    expect(db.state.submissions).toHaveLength(0);
    expect(db.state.leadWrites).toBe(0);
  });
});
