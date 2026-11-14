import { describe, expect, it, vi } from 'vitest';
import { matchesTriggerConditions } from '../../automation/triggerEvaluator.js';
import { dispatchPopupSignup, startPopupAutomations } from '../welcomeAutomation.js';

const COMPANY = '3cbe5c11-d834-40d1-b1cf-425e6377f099';
const CAMPAIGN = '11111111-1111-4111-8111-111111111111';

function flow(config = {}) {
  return {
    id: 'flow-1',
    is_over_plan: false,
    nodes: [{
      type: 'start',
      data: {
        triggers: [{
          enabled: true,
          type: 'nuvemshop.popup_signup',
          config,
        }],
      },
    }],
  };
}

function signup(id = 'signup-1') {
  return {
    id,
    company_id: COMPANY,
    nuvemshop_store_id: '7680914',
    campaign_id: CAMPAIGN,
    utm: { utm_source: 'instagram' },
    visitor_id: 'visitor-1',
    session_id: 'session-1',
    coupon_consent: true,
    coupon_consent_version: '2026-11',
    coupon_consented_at: '2026-11-14T00:00:00Z',
    promo_consent: false,
    promo_consent_version: null,
    promo_consented_at: null,
  };
}

const grant = { coupon_code: 'CUPOM10', apply_url: 'https://valleron.store/discount/CUPOM10?redirect_to=/' };

function client(options) {
  return {
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        filter() { return api; },
        limit() { return api; },
        is() { return api; },
        update() { return api; },
        maybeSingle: async () => {
          if (table !== 'automation_executions') return { data: null, error: null };
          if (Array.isArray(options.executionReads) && options.executionReads.length > 0) {
            return options.executionReads.shift();
          }
          return { data: options.execution ?? null, error: options.executionError ?? null };
        },
        then(ok, fail) {
          if (table === 'automation_flows') {
            return Promise.resolve({ data: options.flows ?? [], error: null }).then(ok, fail);
          }
          if (table === 'nuvemshop_welcome_automation_claims') {
            return Promise.resolve({ data: options.link === false ? [] : [{ id: 'claim-1' }], error: null }).then(ok, fail);
          }
          return Promise.resolve({ data: [], error: null }).then(ok, fail);
        },
      };
      return api;
    },
    rpc: async (name) => {
      if (name === 'nuvemshop_welcome_bind_claim') {
        return { data: options.bind !== false, error: null };
      }
      return { data: options.claim, error: options.claimError ?? null };
    },
  };
}

describe('gatilho do pop-up', () => {
  it('filtra loja e campanha e distingue evento entregue de WhatsApp enviado', () => {
    const event = { type: 'nuvemshop.popup_signup', data: { store_id: '7680914', campaign_id: CAMPAIGN } };
    expect(matchesTriggerConditions(flow({ storeId: '7680914', campaignId: CAMPAIGN }), event)).toBe(true);
    expect(matchesTriggerConditions(flow({ storeId: '8047001' }), event)).toBe(false);
    expect(matchesTriggerConditions(flow({ campaignId: 'outra' }), event)).toBe(false);
  });

  it('reserva, recupera falha sem segunda execução e não repete efeito externo', async () => {
    const claims = new Map();
    const startExecution = vi.fn()
      .mockRejectedValueOnce(new Error('falha antes da execução'))
      .mockResolvedValueOnce({ id: 'exec-1' });
    const first = await dispatchPopupSignup({
      companyId: COMPANY, signup: signup(), grant, leadId: 4, flows: [{ id: 'flow-1', matches: true }], claims, startExecution, now: 0,
    });
    expect(first).toMatchObject({ event_delivered: false, whatsapp_sent: null });
    const soon = await dispatchPopupSignup({
      companyId: COMPANY, signup: signup(), grant, leadId: 4, flows: [{ id: 'flow-1', matches: true }], claims, startExecution, now: 1000,
    });
    expect(soon.results[0].reason).toBe('reserved');
    expect(startExecution).toHaveBeenCalledTimes(1);
    const recovered = await dispatchPopupSignup({
      companyId: COMPANY, signup: signup(), grant, leadId: 4, flows: [{ id: 'flow-1', matches: true }], claims, startExecution, now: 130000,
    });
    expect(recovered).toMatchObject({ event_delivered: true, whatsapp_sent: null });
    const again = await dispatchPopupSignup({
      companyId: COMPANY, signup: signup(), grant, leadId: 4, flows: [{ id: 'flow-1', matches: true }], claims, startExecution, now: 140000,
    });
    expect(again.results[0].resumed).toBe(true);
    expect(startExecution).toHaveBeenCalledTimes(2);
  });

  it('não cria execução quando nenhuma automação corresponde', async () => {
    const processFlowAsync = vi.fn();
    const createExecution = vi.fn();
    const result = await startPopupAutomations({
      supabase: client({ flows: [flow({ storeId: '8047001' })], claim: { action: 'create', claim_id: 'claim-1' } }),
      companyId: COMPANY,
      signup: signup(),
      grant,
      leadId: 9,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(result).toMatchObject({ event_delivered: false, whatsapp_sent: null, reason: 'no_automation' });
    expect(createExecution).not.toHaveBeenCalled();
    expect(processFlowAsync).not.toHaveBeenCalled();
  });

  it('entrega o evento para lead novo e existente e não reexecuta execução já existente', async () => {
    const processFlowAsync = vi.fn();
    const createExecution = vi.fn(async () => ({ id: 'exec-9' }));
    const created = await startPopupAutomations({
      supabase: client({ flows: [flow({ storeId: '7680914' })], claim: { action: 'create', claim_id: 'claim-1', lease_token: 'lease-1' } }),
      confirmLease: async () => true,
      companyId: COMPANY,
      signup: signup(),
      grant,
      leadId: 1,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(created.results[0]).toMatchObject({
      started: true,
      whatsapp_sent: null,
      event_delivered: false,
      execution_id: 'exec-9',
    });
    expect(createExecution).toHaveBeenCalledTimes(1);
    expect(processFlowAsync).toHaveBeenCalledTimes(1);
    const variables = createExecution.mock.calls[0][1].variables;
    expect(variables['nuvemshop.coupon_code']).toBe('CUPOM10');
    expect(variables['nuvemshop.coupon_url']).toContain('/discount/CUPOM10');
    expect(variables['nuvemshop.origin']).toBe('nuvemshop_popup');
    expect(variables['nuvemshop.promo_consent']).toBe('false');

    processFlowAsync.mockClear();
    createExecution.mockClear();
    const resumed = await startPopupAutomations({
      supabase: client({
        flows: [flow()],
        claim: { action: 'resume', claim_id: 'claim-1', execution_id: 'exec-9', lease_token: 'lease-1' },
        execution: { id: 'exec-9', status: 'running', executed_nodes: [] },
      }),
      companyId: COMPANY,
      signup: signup(),
      grant,
      leadId: 2,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(resumed.results[0]).toMatchObject({
      event_delivered: false,
      whatsapp_sent: null,
      reason: 'running_unconfirmed',
      execution_id: 'exec-9',
    });
    expect(createExecution).not.toHaveBeenCalled();
    expect(processFlowAsync).not.toHaveBeenCalled();

    const existingExecution = await startPopupAutomations({
      supabase: client({
        flows: [flow()],
        claim: { action: 'create', claim_id: 'claim-1', lease_token: 'lease-1', recovered: true },
        execution: { id: 'exec-abandoned', status: 'running', executed_nodes: [] },
      }),
      companyId: COMPANY,
      signup: signup('signup-2'),
      grant,
      leadId: 2,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(existingExecution.results[0]).toMatchObject({
      reason: 'running_unconfirmed',
      execution_id: 'exec-abandoned',
      event_delivered: false,
    });
    expect(createExecution).not.toHaveBeenCalled();
    expect(processFlowAsync).not.toHaveBeenCalled();
  });

  it('não inicia o processamento quando a reserva do trabalho já foi perdida', async () => {
    const processFlowAsync = vi.fn();
    const createExecution = vi.fn(async () => ({ id: 'exec-held' }));
    const result = await startPopupAutomations({
      supabase: client({
        flows: [flow({ storeId: '7680914' })],
        claim: { action: 'create', claim_id: 'claim-1', lease_token: 'lease-1' },
      }),
      confirmLease: async () => false,
      companyId: COMPANY,
      signup: signup(),
      grant,
      leadId: 1,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(result.results[0]).toMatchObject({
      reason: 'lease_lost',
      review: 'running_unconfirmed',
      execution_id: 'exec-held',
      event_delivered: false,
    });
    expect(processFlowAsync).not.toHaveBeenCalled();
  });

  it('recupera a execução existente quando a criação encontra o conflito', async () => {
    const processFlowAsync = vi.fn();
    const createExecution = vi.fn(async () => null);
    const result = await startPopupAutomations({
      supabase: client({
        flows: [flow({ storeId: '7680914' })],
        claim: { action: 'create', claim_id: 'claim-1', lease_token: 'lease-1', recovered: true },
        executionReads: [
          { data: null, error: null },
          { data: { id: 'exec-winner', status: 'running', executed_nodes: [] }, error: null },
        ],
      }),
      confirmLease: async () => true,
      companyId: COMPANY,
      signup: signup(),
      grant,
      leadId: 1,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(createExecution).toHaveBeenCalledTimes(1);
    expect(processFlowAsync).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({
      execution_id: 'exec-winner',
      reason: 'running_unconfirmed',
      event_delivered: false,
    });
  });

  it('não cria execução quando a leitura falha', async () => {
    const processFlowAsync = vi.fn();
    const createExecution = vi.fn(async () => ({ id: 'exec-unwanted' }));
    const missing = await startPopupAutomations({
      supabase: client({
        flows: [flow({ storeId: '7680914' })],
        claim: { action: 'create', claim_id: 'claim-1', lease_token: 'lease-1' },
        executionError: { message: 'timeout' },
      }),
      confirmLease: async () => true,
      companyId: COMPANY,
      signup: signup(),
      grant,
      leadId: 1,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(missing.results[0].reason).toBe('flow_lookup_failed');
    expect(createExecution).not.toHaveBeenCalled();

    const lostRecovery = await startPopupAutomations({
      supabase: client({
        flows: [flow({ storeId: '7680914' })],
        claim: { action: 'create', claim_id: 'claim-1', lease_token: 'lease-1' },
        executionReads: [
          { data: null, error: null },
          { data: null, error: { message: 'timeout' } },
        ],
      }),
      confirmLease: async () => true,
      companyId: COMPANY,
      signup: signup(),
      grant,
      leadId: 1,
      createExecution: async () => null,
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(lostRecovery.results[0].reason).toBe('flow_lookup_failed');
    expect(processFlowAsync).not.toHaveBeenCalled();
  });
});
