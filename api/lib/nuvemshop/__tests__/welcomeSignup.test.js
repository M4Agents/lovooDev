import { describe, expect, it, vi } from 'vitest';
import { handleWelcomePublic, hashRateKey } from '../welcomePublic.js';
import { applySignupCommit } from '../welcomeSignup.js';

const COMPANY = '3cbe5c11-d834-40d1-b1cf-425e6377f099';
const OTHER = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413';
const CAMPAIGN = '11111111-1111-4111-8111-111111111111';
const ATTEMPT = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_2 = '33333333-3333-4333-8333-333333333333';

function state() {
  return { leads: [], signups: [], grants: [], jobs: [], opportunities: [], nextLeadId: 1 };
}

function database(current, extras = {}) {
  const campaign = {
    id: CAMPAIGN,
    enabled: extras.enabled !== false,
    title: 'Bem-vindo',
    description: 'Primeira compra',
    image_url: null,
    button_label: 'Quero',
    background_color: '#ffffff',
    text_color: '#111111',
    button_color: '#000000',
    consent_text: 'Aceito receber o cupom',
    consent_version: '2026-11',
    promo_consent_text: 'Aceito promoções',
    promo_consent_version: 'promo-1',
    coupon_code: 'CUPOM10',
    delay_seconds: 10,
    resurface_days: 7,
    allowed_origins: ['https://valleron.store'],
    ...extras.campaign,
  };
  return {
    signupState: current,
    rateBuckets: extras.buckets ?? new Map(),
    claims: extras.claims ?? new Map(),
    flows: extras.flows ?? [],
    startExecution: extras.startExecution ?? vi.fn(async () => ({ id: 'exec-1' })),
    dispatch: extras.dispatch,
    from(table) {
      const filters = [];
      const api = {
        select() { return api; },
        eq(column, value) { filters.push([column, value]); return api; },
        maybeSingle: async () => ({ data: table === 'nuvemshop_welcome_campaigns' ? campaign : null, error: null }),
        then(ok, fail) {
          const connections = extras.connections ?? [{
            company_id: COMPANY,
            nuvemshop_store_id: '7680914',
            status: 'active',
          }];
          const matched = connections.filter((row) => filters.every(([column, value]) => row[column] === value));
          return Promise.resolve({ data: matched, error: null }).then(ok, fail);
        },
      };
      return api;
    },
  };
}

function post(body, extra = {}) {
  return {
    method: 'POST',
    headers: { origin: 'https://valleron.store' },
    query: {},
    ip: '203.0.113.10',
    body: {
      store_id: '7680914',
      attempt_id: ATTEMPT,
      name: 'Ana',
      email: 'ana@valleron.store',
      phone: '11999999999',
      coupon_consent: true,
      promo_consent: false,
      ...body,
    },
    ...extra,
  };
}

describe('cadastro real do pop-up', () => {
  it('cria lead novo, concede cupom e não afirma desconto aplicado', async () => {
    const current = state();
    const result = await handleWelcomePublic(post(), database(current));
    expect(result.status).toBe(200);
    expect(result.body.code).toBe('coupon_granted');
    expect(result.body.apply_url).toBe('https://valleron.store/discount/CUPOM10?redirect_to=/');
    expect(result.body.discount_applied).toBe(false);
    expect(result.body.lead_id).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toMatch(/lead_id|ineligible|paid/);
    expect(current.leads[0]).toMatchObject({ origin: 'nuvemshop_popup', email: 'ana@valleron.store', responsible_user_id: null });
  });

  it('reutiliza lead e preserva origem, responsável e dados preenchidos', async () => {
    const current = state();
    current.leads.push({
      id: 9,
      company_id: COMPANY,
      name: 'Ana Original',
      email: 'ana@valleron.store',
      phone: '5511999999999',
      phone_normalized: '5511999999999',
      origin: 'manual',
      responsible_user_id: 'seller-1',
      visitor_id: null,
      deleted_at: null,
    });
    current.nextLeadId = 10;
    const result = await handleWelcomePublic(post({ name: 'Outro Nome', visitor_id: 'visitor-1' }), database(current));
    expect(result.body.coupon_revealed).toBe(true);
    expect(current.leads).toHaveLength(1);
    expect(current.leads[0]).toMatchObject({
      name: 'Ana Original',
      origin: 'manual',
      responsible_user_id: 'seller-1',
      visitor_id: 'visitor-1',
    });
  });

  it('não mescla e-mail e telefone de leads diferentes', async () => {
    const current = state();
    current.leads.push(
      { id: 1, company_id: COMPANY, email: 'ana@valleron.store', phone_normalized: '5511888888888', phone: '5511888888888', deleted_at: null },
      { id: 2, company_id: COMPANY, email: 'outra@valleron.store', phone_normalized: '5511999999999', phone: '5511999999999', deleted_at: null },
    );
    const result = await handleWelcomePublic(post(), database(current));
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('identity_conflict');
    expect(result.body.coupon_revealed).toBe(false);
    expect(current.leads).toHaveLength(2);
    expect(current.grants).toHaveLength(0);
  });

  it('nega compra paga, reembolso e pagamento inconclusivo; concede sem pedidos', async () => {
    const paid = state();
    paid.leads.push({ id: 4, company_id: COMPANY, email: 'ana@valleron.store', phone_normalized: '5511999999999', phone: '5511999999999', origin: 'manual', deleted_at: null });
    paid.opportunities.push({ company_id: COMPANY, lead_id: 4, nuvemshop_store_id: '7680914', nuvemshop_order_id: '10', nuvemshop_payment_data: { payment_status: 'paid' }, status: 'won' });
    expect((await handleWelcomePublic(post(), database(paid))).body).toMatchObject({ code: 'coupon_not_granted', coupon_revealed: false });

    const refunded = state();
    refunded.leads.push({ id: 4, company_id: COMPANY, email: 'ana@valleron.store', phone_normalized: '5511999999999', phone: '5511999999999', deleted_at: null });
    refunded.opportunities.push({ company_id: COMPANY, lead_id: 4, nuvemshop_store_id: '7680914', nuvemshop_order_id: '11', nuvemshop_payment_data: { payment_status: 'refunded' } });
    const refund = await handleWelcomePublic(post(), database(refunded));
    expect(refund.body.coupon_revealed).toBe(false);
    expect(JSON.stringify(refund.body)).not.toMatch(/pending_refund_rule/);
    expect(refunded.signups[0].eligibility_result).toBe('pending_refund_rule');

    const pending = state();
    pending.leads.push({ id: 4, company_id: COMPANY, email: 'ana@valleron.store', phone_normalized: '5511999999999', phone: '5511999999999', deleted_at: null });
    pending.opportunities.push({ company_id: COMPANY, lead_id: 4, nuvemshop_store_id: '7680914', nuvemshop_order_id: '12', nuvemshop_payment_data: { payment_status: 'pending' }, status: 'won' });
    expect((await handleWelcomePublic(post(), database(pending))).body.code).toBe('eligibility_unavailable');

    const empty = state();
    empty.leads.push({ id: 4, company_id: COMPANY, email: 'ana@valleron.store', phone_normalized: '5511999999999', phone: '5511999999999', name: 'Ana', deleted_at: null });
    expect((await handleWelcomePublic(post(), database(empty))).body.code).toBe('coupon_granted');
  });

  it('isola empresa e loja, e reavalia uma nova tentativa antes de repetir o benefício', async () => {
    const current = state();
    current.leads.push({ id: 8, company_id: OTHER, email: 'ana@valleron.store', phone_normalized: '5511999999999', phone: '5511999999999', deleted_at: null });
    const first = await handleWelcomePublic(post(), database(current));
    expect(first.body.coupon_revealed).toBe(true);
    expect(current.leads.filter((lead) => lead.company_id === COMPANY)).toHaveLength(1);

    current.leads[1].id = 15;
    current.opportunities.push({
      company_id: COMPANY,
      lead_id: 15,
      nuvemshop_store_id: '999',
      nuvemshop_order_id: '77',
      nuvemshop_payment_data: { payment_status: 'paid' },
    });
    const otherStore = await handleWelcomePublic(post({ attempt_id: ATTEMPT_2 }), database(current));
    expect(otherStore.body.coupon_revealed).toBe(true);

    current.opportunities.push({
      company_id: COMPANY,
      lead_id: 15,
      nuvemshop_store_id: '7680914',
      nuvemshop_order_id: '78',
      nuvemshop_payment_data: { payment_status: 'paid' },
    });
    const again = await handleWelcomePublic(post({ attempt_id: '44444444-4444-4444-8444-444444444444' }), database(current));
    expect(again.body.coupon_revealed).toBe(false);
    expect(current.grants).toHaveLength(1);
  });

  it('repete o mesmo attempt e conflita quando o payload muda', async () => {
    const current = state();
    const db = database(current);
    const first = await handleWelcomePublic(post(), db);
    const retry = await handleWelcomePublic(post(), db);
    expect(retry.body.coupon_code).toBe(first.body.coupon_code);
    expect(current.signups).toHaveLength(1);
    expect(current.grants).toHaveLength(1);
    const changed = await handleWelcomePublic(post({ name: 'Ana Maria' }), db);
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe('attempt_conflict');
  });

  it('mantém o cadastro fechado com a campanha desativada e o promo opcional', async () => {
    const current = state();
    const closed = await handleWelcomePublic(post({ enabled: true }), database(current, { enabled: false }));
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe('publication_blocked');
    expect(JSON.stringify(closed.body)).not.toMatch(/CUPOM10/);
    expect(current.signups).toHaveLength(0);

    const open = await handleWelcomePublic(post({ promo_consent: false }), database(state()));
    expect(open.body.coupon_revealed).toBe(true);
    expect(open.body.coupon_code).toBe('CUPOM10');
  });

  it('dispara a automação só na concessão nova, para lead novo e existente', async () => {
    const calls = [];
    const current = state();
    const startExecution = vi.fn(async (flow) => {
      calls.push(flow.id);
      return { id: `exec-${flow.id}` };
    });
    const flows = [{ id: 'flow-1', matches: true }];
    await handleWelcomePublic(post(), database(current, { flows, startExecution }));
    expect(calls).toEqual(['flow-1']);
    await handleWelcomePublic(post({ attempt_id: ATTEMPT_2 }), database(current, { flows, startExecution, claims: new Map() }));
    expect(calls).toEqual(['flow-1']);

    const existing = state();
    existing.leads.push({ id: 3, company_id: COMPANY, email: 'ana@valleron.store', phone_normalized: '5511999999999', phone: '5511999999999', name: 'Ana', origin: 'manual', deleted_at: null });
    await handleWelcomePublic(post({ attempt_id: ATTEMPT }), database(existing, { flows, startExecution }));
    expect(calls).toEqual(['flow-1', 'flow-1']);
  });

  it('não escolhe conexão ambígua nem aceita company_id do navegador', async () => {
    const ambiguous = await handleWelcomePublic(post(), database(state(), {
      connections: [
        { company_id: COMPANY, nuvemshop_store_id: '7680914', status: 'active' },
        { company_id: OTHER, nuvemshop_store_id: '7680914', status: 'active' },
      ],
    }));
    expect(ambiguous.status).toBe(404);
    const spoofed = await handleWelcomePublic(post({ company_id: OTHER }), database(state()));
    expect(spoofed.status).toBe(400);
  });

  it('aplica limite e honeypot sem gravar o IP', async () => {
    const current = state();
    const buckets = new Map();
    const db = database(current, { buckets });
    expect((await handleWelcomePublic(post({ company_website: 'https://spam.example' }), db)).status).toBe(400);
    const attempts = [
      '55555555-5555-4555-8555-555555555551',
      '55555555-5555-4555-8555-555555555552',
      '55555555-5555-4555-8555-555555555553',
      '55555555-5555-4555-8555-555555555554',
      '55555555-5555-4555-8555-555555555555',
      '55555555-5555-4555-8555-555555555556',
    ];
    for (const attemptId of attempts) {
      await handleWelcomePublic(post({ attempt_id: attemptId }, { ip: '198.51.100.8' }), db);
    }
    expect(current.signups).toHaveLength(5);
    expect(JSON.stringify(current.signups)).not.toMatch(/198\.51\.100\.8/);
  });

  it('recusa origem, payload grande, limite da loja e falha do limitador', async () => {
    const current = state();
    const foreign = await handleWelcomePublic(post({}, {
      headers: { origin: 'https://evil.example' },
    }), database(current));
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('origin_not_allowed');
    expect(JSON.stringify(foreign.body)).not.toMatch(/ana@|11999999999|5511999999999/);

    const huge = await handleWelcomePublic(post({ name: 'A'.repeat(9000) }), database(current));
    expect(huge.status).toBe(413);
    expect(huge.body.code).toBe('payload_too_large');
    expect(current.signups).toHaveLength(0);

    const buckets = new Map();
    buckets.set(hashRateKey(['store', COMPANY, '7680914']), { start: Date.now(), hits: 60 });
    const limited = await handleWelcomePublic(post({
      attempt_id: '55555555-5555-4555-8555-555555555557',
      email: 'loja@valleron.store',
    }), database(state(), { buckets }));
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('rate_limited');
    expect(JSON.stringify(limited.body)).not.toMatch(/loja@|11999999999/);
    expect([...buckets.keys()].join(' ')).not.toMatch(/loja@|11999999999|5511999999999/);

    const broken = {
      get() { throw new Error('limiter down'); },
      set() { throw new Error('limiter down'); },
    };
    const empty = state();
    const unavailable = await handleWelcomePublic(post(), database(empty, { buckets: broken }));
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.code).toBe('signup_unavailable');
    expect(empty.signups).toHaveLength(0);
  });

  it('não concede de novo ao trocar só um contato e não mescla leads', async () => {
    const current = state();
    const first = await handleWelcomePublic(post(), database(current));
    expect(first.body.coupon_revealed).toBe(true);
    expect(current.jobs).toHaveLength(1);
    expect(current.jobs[0].status).toBe('pending');

    const otherPhone = await handleWelcomePublic(post({
      attempt_id: ATTEMPT_2,
      phone: '11988888888',
    }), database(current));
    expect(otherPhone.body.coupon_revealed).toBe(true);
    expect(otherPhone.body.repeated).toBe(true);
    expect(current.grants).toHaveLength(1);
    expect(current.jobs).toHaveLength(1);

    const otherEmail = await handleWelcomePublic(post({
      attempt_id: '44444444-4444-4444-8444-444444444445',
      email: 'novo@valleron.store',
    }), database(current));
    expect(otherEmail.body.coupon_code).toBe('CUPOM10');
    expect(current.grants).toHaveLength(1);
    expect(current.jobs).toHaveLength(1);

    current.leads.push({
      id: 90,
      company_id: COMPANY,
      email: 'outro@valleron.store',
      phone: '5511977777777',
      phone_normalized: '5511977777777',
      deleted_at: null,
    });
    const before = current.leads.map((lead) => ({ ...lead }));
    const conflict = await handleWelcomePublic(post({
      attempt_id: '44444444-4444-4444-8444-444444444446',
      email: 'ana@valleron.store',
      phone: '11977777777',
    }), database(current));
    expect(conflict.body.code).toBe('identity_conflict');
    expect(conflict.body.coupon_revealed).toBe(false);
    expect(current.leads.map((lead) => lead.email)).toEqual(before.map((lead) => lead.email));
    expect(current.grants).toHaveLength(1);
  });

  it('mantém o trabalho pendente quando o despacho falha', async () => {
    const current = state();
    const result = await handleWelcomePublic(post(), database(current, {
      dispatch: async () => { throw new Error('worker down'); },
    }));
    expect(result.body.coupon_revealed).toBe(true);
    expect(current.jobs).toHaveLength(1);
    expect(current.jobs[0].status).toBe('pending');
    expect(JSON.stringify(result.body)).not.toMatch(/worker down|ana@/);
  });

  it('não revela o cupom na configuração pública', async () => {
    const result = await handleWelcomePublic({
      method: 'GET',
      headers: { origin: 'https://valleron.store' },
      query: { store_id: '7680914' },
    }, database(state()));
    expect(result.status).toBe(200);
    expect(result.body.config.title).toBe('Bem-vindo');
    expect(result.body.config.coupon_code).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toMatch(/CUPOM10|api_key|token/);
  });
});

describe('commit em memória', () => {
  it('não lê a tabela de ensaio', () => {
    const source = applySignupCommit.toString();
    expect(source).not.toMatch(/welcome_test_submissions/);
  });
});
