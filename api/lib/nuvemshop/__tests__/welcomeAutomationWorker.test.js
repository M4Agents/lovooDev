import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processWelcomeAutomationJobs } from '../welcomeAutomationWorker.js';
import handler from '../../../cron/process-welcome-popup-jobs.js';

const COMPANY = '3cbe5c11-d834-40d1-b1cf-425e6377f099';
const SIGNUP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const GRANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const FLOW = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const BACKOFF_MINUTES = [1, 2, 4, 8, 16, 32, 60];

function finishJob(job, args) {
  if (job.lock_token !== args.p_token || job.status !== 'dispatching') {
    return { applied: false };
  }
  let attempts = job.attempts;
  let status = args.p_status;
  let result = args.p_result;
  let nextAttemptAt = null;
  if (args.p_count_failure) {
    attempts += 1;
    if (attempts >= 8) {
      status = 'needs_review';
      result = 'retry_exhausted';
    } else {
      status = 'pending';
      nextAttemptAt = new Date(Date.now() + BACKOFF_MINUTES[attempts - 1] * 60_000).toISOString();
    }
  } else if (status === 'pending') {
    nextAttemptAt = new Date(Date.now() + 2 * 60_000).toISOString();
  }
  Object.assign(job, {
    status,
    result,
    attempts,
    next_attempt_at: nextAttemptAt,
    lock_token: null,
    locked_at: null,
  });
  return { applied: true, status, result, attempts };
}

function database(seed) {
  const jobs = seed.jobs.map((job) => ({ ...job }));
  const claims = (seed.claims ?? []).map((claim) => ({ ...claim }));
  const state = {
    execution: seed.execution ?? null,
    beforeHold: seed.beforeHold ?? null,
    beforeFinish: seed.beforeFinish ?? null,
  };
  return {
    jobs,
    claims,
    state,
    rpc(name, args) {
      if (name === 'nuvemshop_welcome_claim_automation') {
        const existing = claims.find((row) => (
          row.company_id === args.p_company && row.flow_id === args.p_flow && row.signup_id === args.p_signup
        ));
        if (existing?.execution_id) {
          return {
            data: {
              action: 'resume',
              claim_id: existing.id,
              execution_id: existing.execution_id,
              lease_token: existing.lease_token,
            },
            error: null,
          };
        }
        if (existing) return { data: { action: 'wait', claim_id: existing.id }, error: null };
        const row = {
          id: `claim-${claims.length + 1}`,
          company_id: args.p_company,
          flow_id: args.p_flow,
          signup_id: args.p_signup,
          execution_id: null,
          lease_token: `lease-${claims.length + 1}`,
          status: 'reserved',
          delivered_at: null,
        };
        claims.push(row);
        return { data: { action: 'create', claim_id: row.id, lease_token: row.lease_token }, error: null };
      }
      if (name === 'nuvemshop_welcome_bind_claim') {
        const claim = claims.find((row) => row.id === args.p_claim && row.lease_token === args.p_token);
        if (!claim || (claim.execution_id && claim.execution_id !== args.p_execution)) {
          return { data: false, error: null };
        }
        claim.execution_id = args.p_execution;
        return { data: true, error: null };
      }
      if (name === 'nuvemshop_welcome_hold_job') {
        if (typeof state.beforeHold === 'function') state.beforeHold(jobs);
        const job = jobs.find((row) => (
          row.id === args.p_id && row.lock_token === args.p_token && row.status === 'dispatching'
        ));
        return { data: Boolean(job), error: null };
      }
      if (name === 'nuvemshop_welcome_finish_job') {
        if (typeof state.beforeFinish === 'function') state.beforeFinish(jobs);
        const job = jobs.find((row) => row.id === args.p_id);
        return { data: job ? finishJob(job, args) : { applied: false }, error: null };
      }
      if (name !== 'nuvemshop_welcome_claim_jobs') return { data: null, error: { message: 'rpc' } };
      const now = Date.now();
      const claimed = jobs
        .filter((job) => {
          if (args.p_signup && job.signup_id !== args.p_signup) return false;
          if (job.status !== 'pending') return false;
          return !job.next_attempt_at || Date.parse(job.next_attempt_at) <= now;
        })
        .map((job) => {
          job.status = 'dispatching';
          job.lock_token = `lock-${job.id}-${job.attempts}`;
          job.locked_at = new Date().toISOString();
          return { ...job };
        });
      return { data: claimed, error: null };
    },
    from(table) {
      const builder = {
        select() { return builder; },
        eq(column, value) {
          builder.filters.push([column, value]);
          return builder;
        },
        filter() { return builder; },
        is() { return builder; },
        limit() { return builder; },
        maybeSingle: async () => {
          if (seed.flowError && table === 'automation_flows') return { data: null, error: seed.flowError };
          if (table === 'nuvemshop_welcome_signups') return { data: seed.signup, error: null };
          if (table === 'nuvemshop_welcome_grants') return { data: seed.grant, error: null };
          if (table === 'automation_executions') {
            if (state.executionError) return { data: null, error: state.executionError };
            return { data: state.execution ?? null, error: null };
          }
          return { data: null, error: null };
        },
        update(patch) {
          const filters = [];
          const chain = {
            eq(column, value) { filters.push([column, value]); return chain; },
            is() { return chain; },
            select: async () => {
              if (table === 'nuvemshop_welcome_automation_claims') {
                const claim = claims.find((row) => filters.every(([column, value]) => row[column] === value));
                if (claim && claim.execution_id == null) Object.assign(claim, patch);
                return { data: claim ? [{ id: claim.id }] : [], error: null };
              }
              return { data: [{ id: 'ok' }], error: null };
            },
          };
          if (table === 'nuvemshop_welcome_automation_jobs') {
            chain.eq = (column, value) => {
              const job = jobs.find((row) => row[column] === value);
              if (job) Object.assign(job, patch);
              return Promise.resolve({ data: null, error: null });
            };
          }
          return chain;
        },
        filters: [],
        then(resolve, reject) {
          if (table === 'automation_flows') {
            const result = seed.flowError
              ? { data: null, error: seed.flowError }
              : { data: seed.flows ?? [], error: null };
            return Promise.resolve(result).then(resolve, reject);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function seed(overrides = {}) {
  return {
    jobs: [{
      id: 'job-1',
      company_id: COMPANY,
      signup_id: SIGNUP,
      grant_id: GRANT,
      status: 'pending',
      attempts: 0,
    }],
    signup: {
      id: SIGNUP,
      company_id: COMPANY,
      campaign_id: 'camp',
      nuvemshop_store_id: '7680914',
      lead_id: 4,
      utm: {},
      coupon_consent: true,
      promo_consent: false,
    },
    grant: { id: GRANT, coupon_code: 'CUPOM10', apply_url: 'https://valleron.store/discount/CUPOM10?redirect_to=/' },
    flows: [{ id: FLOW, is_active: true, is_over_plan: false }],
    claims: [],
    ...overrides,
  };
}

describe('recuperação da automação do pop-up', () => {
  const matchesTriggerConditions = vi.fn(() => true);

  beforeEach(() => {
    matchesTriggerConditions.mockClear();
  });

  it('grava ausência de automação e deixa falha de leitura pendente', async () => {
    const none = database(seed({ flows: [] }));
    const createExecution = vi.fn();
    const processFlowAsync = vi.fn();
    await processWelcomeAutomationJobs({
      supabase: none,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(none.jobs[0].status).toBe('no_automation');
    expect(createExecution).not.toHaveBeenCalled();

    const failed = database(seed({ flowError: { message: 'timeout' } }));
    await processWelcomeAutomationJobs({
      supabase: failed,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(failed.jobs[0].status).toBe('pending');
    expect(failed.jobs[0].result).toBe('lookup_failed');
    expect(failed.jobs[0].attempts).toBe(1);
    expect(processFlowAsync).not.toHaveBeenCalled();
  });

  it('não reprocessa execução running já gravada nem repete o envio', async () => {
    const running = database(seed({
      execution: { id: 'exec-running', status: 'running', executed_nodes: [] },
      claims: [],
    }));
    const createExecution = vi.fn(async () => ({ id: 'exec-new' }));
    const processFlowAsync = vi.fn();
    await processWelcomeAutomationJobs({
      supabase: running,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(createExecution).not.toHaveBeenCalled();
    expect(processFlowAsync).not.toHaveBeenCalled();
    expect(running.jobs[0]).toMatchObject({
      status: 'needs_review',
      result: 'running_unconfirmed',
      attempts: 0,
    });
    expect(running.claims[0].execution_id).toBe('exec-running');
    expect(running.claims[0].delivered_at).toBeNull();
    expect(running.claims[0].status).toBe('reserved');

    const fresh = database(seed());
    await processWelcomeAutomationJobs({
      supabase: fresh,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(processFlowAsync).toHaveBeenCalledTimes(1);
    expect(fresh.jobs[0].status).toBe('started');
    expect(fresh.jobs[0].attempts).toBe(0);

    fresh.jobs[0].status = 'pending';
    fresh.jobs[0].next_attempt_at = null;
    fresh.state.execution = { id: 'exec-new', status: 'running', executed_nodes: [] };
    await processWelcomeAutomationJobs({
      supabase: fresh,
      signupId: SIGNUP,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(processFlowAsync).toHaveBeenCalledTimes(1);
    expect(fresh.jobs[0]).toMatchObject({ status: 'needs_review', result: 'running_unconfirmed' });

    const missing = database(seed());
    await processWelcomeAutomationJobs({
      supabase: missing,
      createExecution: async () => null,
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(missing.jobs[0]).toMatchObject({ status: 'pending', result: 'delivery_failed', attempts: 1 });
    expect(processFlowAsync).toHaveBeenCalledTimes(1);
  });

  it('não cria execução quando a leitura da execução falha', async () => {
    const db = database(seed());
    db.state.executionError = { message: 'timeout' };
    const createExecution = vi.fn(async () => ({ id: 'exec-unwanted' }));
    const processFlowAsync = vi.fn();
    await processWelcomeAutomationJobs({
      supabase: db,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(createExecution).not.toHaveBeenCalled();
    expect(processFlowAsync).not.toHaveBeenCalled();
    expect(db.jobs[0]).toMatchObject({ status: 'pending', result: 'lookup_failed', attempts: 1 });
  });

  it('impede o worker antigo de gravar depois de uma nova reserva', async () => {
    const db = database(seed({
      beforeFinish(jobs) {
        jobs[0].lock_token = 'reserva-nova';
      },
    }));
    const processFlowAsync = vi.fn();
    await processWelcomeAutomationJobs({
      supabase: db,
      createExecution: async () => ({ id: 'exec-late' }),
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(processFlowAsync).toHaveBeenCalledTimes(1);
    expect(db.jobs[0]).toMatchObject({
      status: 'dispatching',
      lock_token: 'reserva-nova',
      attempts: 0,
    });
    expect(db.jobs[0].result).toBeUndefined();
  });

  it('não inicia o processamento quando perde a reserva antes da chamada', async () => {
    const processFlowAsync = vi.fn();
    const db = database(seed({
      beforeHold(jobs) {
        jobs[0].lock_token = 'reserva-nova';
      },
    }));
    await processWelcomeAutomationJobs({
      supabase: db,
      createExecution: async () => ({ id: 'exec-held' }),
      processFlowAsync,
      matchesTriggerConditions,
    });
    expect(processFlowAsync).not.toHaveBeenCalled();
    expect(db.jobs[0]).toMatchObject({
      status: 'dispatching',
      lock_token: 'reserva-nova',
      attempts: 0,
    });
  });

  it('aplica backoff e esgota na oitava falha efetiva', async () => {
    const db = database(seed({ flowError: { message: 'timeout' } }));
    const expected = [1, 2, 4, 8, 16, 32, 60];
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      db.jobs[0].status = 'pending';
      db.jobs[0].next_attempt_at = new Date(Date.now() - 1000).toISOString();
      await processWelcomeAutomationJobs({
        supabase: db,
        createExecution: vi.fn(),
        processFlowAsync: vi.fn(),
        matchesTriggerConditions,
      });
      const delay = Date.parse(db.jobs[0].next_attempt_at) - Date.now();
      expect(db.jobs[0]).toMatchObject({ status: 'pending', result: 'lookup_failed', attempts: attempt });
      expect(delay).toBeGreaterThan((expected[attempt - 1] * 60 - 5) * 1000);
      expect(delay).toBeLessThan((expected[attempt - 1] * 60 + 5) * 1000);
    }
    db.jobs[0].status = 'pending';
    db.jobs[0].next_attempt_at = new Date(Date.now() - 1000).toISOString();
    await processWelcomeAutomationJobs({
      supabase: db,
      createExecution: vi.fn(),
      processFlowAsync: vi.fn(),
      matchesTriggerConditions,
    });
    expect(db.jobs[0]).toMatchObject({
      status: 'needs_review',
      result: 'retry_exhausted',
      attempts: 8,
      next_attempt_at: null,
    });
  });

  it('não consome tentativa quando a reserva do fluxo está ocupada', async () => {
    const db = database(seed({
      claims: [{
        id: 'claim-busy',
        company_id: COMPANY,
        flow_id: FLOW,
        signup_id: SIGNUP,
        execution_id: null,
        lease_token: 'lease-busy',
      }],
    }));
    const processFlowAsync = vi.fn();
    await processWelcomeAutomationJobs({
      supabase: db,
      createExecution: vi.fn(),
      processFlowAsync,
      matchesTriggerConditions,
    });
    const delay = Date.parse(db.jobs[0].next_attempt_at) - Date.now();
    expect(processFlowAsync).not.toHaveBeenCalled();
    expect(db.jobs[0]).toMatchObject({ status: 'pending', result: 'reserved', attempts: 0 });
    expect(delay).toBeGreaterThan(90_000);
    expect(delay).toBeLessThan(130_000);
  });

  it('bloqueia o cron sem segredo ou com bearer inválido e ignora quando desligado', async () => {
    const enabled = process.env.CRON_ENABLED;
    const secret = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_ENABLED;
      delete process.env.CRON_SECRET;
      const skipped = response();
      await handler({ url: '/api/cron/process-welcome-popup-jobs', headers: {} }, skipped);
      expect(skipped.statusCode).toBe(200);
      expect(skipped.body.skipped).toBe(true);

      process.env.CRON_ENABLED = 'true';
      const missingSecret = response();
      await handler({
        url: '/api/cron/process-welcome-popup-jobs',
        headers: { authorization: 'Bearer qualquer' },
      }, missingSecret);
      expect(missingSecret.statusCode).toBe(401);

      process.env.CRON_SECRET = 'segredo-de-teste';
      const missingBearer = response();
      await handler({ url: '/api/cron/process-welcome-popup-jobs', headers: {} }, missingBearer);
      expect(missingBearer.statusCode).toBe(401);

      const wrongBearer = response();
      await handler({
        url: '/api/cron/process-welcome-popup-jobs',
        headers: { authorization: 'Bearer outro' },
      }, wrongBearer);
      expect(wrongBearer.statusCode).toBe(401);
      expect(JSON.stringify(wrongBearer.body)).not.toContain('segredo-de-teste');
    } finally {
      if (enabled === undefined) delete process.env.CRON_ENABLED;
      else process.env.CRON_ENABLED = enabled;
      if (secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secret;
    }
  });
});
