// Recuperação do pop-up. O trabalho nasce na mesma transação da concessão.
// lock_token é a reserva do trabalho. Quem perde o token não grava o estado
// e não chama processFlowAsync.
//
// Limite que permanece sem alterar o executor: depois que processFlowAsync
// começou, esta reserva não consegue interromper a chamada. Um processamento
// que ultrapasse a validade da reserva pode continuar no worker antigo.
// O worker novo não inicia outro processamento quando a execução já existe.

import { startPopupAutomations } from './welcomeAutomation.js';

function outcomeOf(run) {
  if (run?.reason === 'flow_lookup_failed') {
    return { status: 'pending', result: 'lookup_failed', countFailure: true };
  }
  if (run?.reason === 'no_automation') {
    return { status: 'no_automation', result: 'no_automation', countFailure: false };
  }
  const results = run?.results ?? [];
  if (results.length === 0) {
    return { status: 'pending', result: 'lookup_failed', countFailure: true };
  }
  if (results.some((item) => item.reason === 'running_unconfirmed' || item.review === 'running_unconfirmed')) {
    return { status: 'needs_review', result: 'running_unconfirmed', countFailure: false };
  }
  if (results.some((item) => item.reason === 'lease_lost')) {
    return { status: 'pending', result: 'reserved', countFailure: false };
  }
  if (results.some((item) => item.reason === 'delivery_failed')) {
    return { status: 'pending', result: 'delivery_failed', countFailure: true };
  }
  if (results.some((item) => item.reason === 'flow_lookup_failed' || item.reason === 'claim_failed')) {
    return { status: 'pending', result: 'lookup_failed', countFailure: true };
  }
  if (results.some((item) => item.reason === 'reserved') && !results.some((item) => item.started)) {
    return { status: 'pending', result: 'reserved', countFailure: false };
  }
  if (results.some((item) => item.started)) {
    return { status: 'started', result: 'started', countFailure: false };
  }
  if (results.some((item) => item.reason === 'execution_present')) {
    return { status: 'needs_review', result: 'execution_present', countFailure: false };
  }
  return { status: 'needs_review', result: 'running_unconfirmed', countFailure: false };
}

async function loadRow(supabase, table, id) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return { error };
  return { data };
}

async function finishJob(supabase, job, outcome) {
  const { data, error } = await supabase.rpc('nuvemshop_welcome_finish_job', {
    p_id: job.id,
    p_token: job.lock_token,
    p_status: outcome.status,
    p_result: outcome.result,
    p_count_failure: outcome.countFailure === true,
  });
  if (error || !data?.applied) return false;
  return data;
}

export async function settleWelcomeJob(job, {
  supabase,
  createExecution,
  processFlowAsync,
  matchesTriggerConditions,
}) {
  const signup = await loadRow(supabase, 'nuvemshop_welcome_signups', job.signup_id);
  const grant = await loadRow(supabase, 'nuvemshop_welcome_grants', job.grant_id);
  if (signup.error || grant.error || !signup.data || !grant.data) {
    await finishJob(supabase, job, { status: 'pending', result: 'lookup_failed', countFailure: true });
    return 'pending';
  }

  let run;
  try {
    run = await startPopupAutomations({
      supabase,
      companyId: job.company_id,
      signup: signup.data,
      grant: grant.data,
      leadId: signup.data.lead_id,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
      confirmLease: async () => {
        const { data, error } = await supabase.rpc('nuvemshop_welcome_hold_job', {
          p_id: job.id,
          p_token: job.lock_token,
        });
        return !error && data === true;
      },
    });
  } catch {
    await finishJob(supabase, job, { status: 'pending', result: 'lookup_failed', countFailure: true });
    return 'pending';
  }

  const next = outcomeOf(run);
  const saved = await finishJob(supabase, job, next);
  if (!saved) return 'lost';
  return saved.status;
}

export async function processWelcomeAutomationJobs({
  supabase,
  signupId = null,
  limit = 20,
  createExecution,
  processFlowAsync,
  matchesTriggerConditions,
}) {
  const { data, error } = await supabase.rpc('nuvemshop_welcome_claim_jobs', {
    p_limit: limit,
    p_signup: signupId,
  });
  if (error) throw error;
  const jobs = Array.isArray(data) ? data : [];
  const summary = {
    claimed: jobs.length, pending: 0, no_automation: 0, needs_review: 0, started: 0, lost: 0,
  };
  for (const job of jobs) {
    const status = await settleWelcomeJob(job, {
      supabase,
      createExecution,
      processFlowAsync,
      matchesTriggerConditions,
    });
    if (summary[status] != null) summary[status] += 1;
  }
  return summary;
}
