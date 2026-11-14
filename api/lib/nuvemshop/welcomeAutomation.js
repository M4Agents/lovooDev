const RECOVERY_MS = 2 * 60 * 1000;

function popupVariables(signup, grant) {
  const utm = signup.utm ?? {};
  return {
    'nuvemshop.store_id': String(signup.nuvemshop_store_id ?? ''),
    'nuvemshop.campaign_id': String(signup.campaign_id ?? ''),
    'nuvemshop.signup_id': String(signup.id ?? ''),
    'nuvemshop.coupon_code': String(grant?.coupon_code ?? ''),
    'nuvemshop.coupon_url': String(grant?.apply_url ?? ''),
    'nuvemshop.origin': 'nuvemshop_popup',
    'nuvemshop.utm_source': String(utm.utm_source ?? ''),
    'nuvemshop.utm_medium': String(utm.utm_medium ?? ''),
    'nuvemshop.utm_campaign': String(utm.utm_campaign ?? ''),
    'nuvemshop.visitor_id': String(signup.visitor_id ?? ''),
    'nuvemshop.session_id': String(signup.session_id ?? ''),
    'nuvemshop.coupon_consent': String(signup.coupon_consent === true),
    'nuvemshop.coupon_consent_version': String(signup.coupon_consent_version ?? ''),
    'nuvemshop.coupon_consented_at': String(signup.coupon_consented_at ?? ''),
    'nuvemshop.promo_consent': String(signup.promo_consent === true),
    'nuvemshop.promo_consent_version': String(signup.promo_consent_version ?? ''),
    'nuvemshop.promo_consented_at': String(signup.promo_consented_at ?? ''),
  };
}

function emptyNodes(execution) {
  const nodes = execution?.executed_nodes;
  return nodes == null || (Array.isArray(nodes) && nodes.length === 0);
}

// executed_nodes vazio com status running é indício de processamento incerto.
// Não prova que nenhum efeito externo ocorreu.
export function uncertainRunning(execution) {
  return execution?.status === 'running' && emptyNodes(execution);
}

export function popupDedupKey(signupId) {
  return `ns:nuvemshop.popup_signup:${signupId}`;
}

async function readPopupExecution(supabase, companyId, flowId, dedupKey) {
  const existing = await supabase
    .from('automation_executions')
    .select('id, status, executed_nodes')
    .eq('company_id', companyId)
    .eq('flow_id', flowId)
    .filter('trigger_data->>dedup_key', 'eq', dedupKey)
    .limit(1)
    .maybeSingle();
  if (!existing || existing.error) return { error: true, execution: null };
  return { error: false, execution: existing.data ?? null };
}

export async function startPopupAutomations({
  supabase,
  companyId,
  signup,
  grant,
  leadId,
  createExecution,
  processFlowAsync,
  matchesTriggerConditions,
  confirmLease,
}) {
  const { data: flows, error } = await supabase
    .from('automation_flows')
    .select('id, name, nodes, edges, trigger_operator, is_over_plan')
    .eq('company_id', companyId)
    .eq('is_active', true);
  if (error) return { event_delivered: false, whatsapp_sent: null, reason: 'flow_lookup_failed' };

  const event = {
    type: 'nuvemshop.popup_signup',
    data: {
      store_id: signup.nuvemshop_store_id,
      campaign_id: signup.campaign_id,
      lead_id: leadId,
    },
  };
  const matched = (flows ?? []).filter((flow) => (
    flow.is_over_plan !== true && matchesTriggerConditions(flow, event)
  ));
  if (matched.length === 0) {
    return { event_delivered: false, whatsapp_sent: null, reason: 'no_automation' };
  }

  const results = [];
  for (const flow of matched) {
    const { data: claim, error: claimError } = await supabase.rpc('nuvemshop_welcome_claim_automation', {
      p_company: companyId,
      p_flow: flow.id,
      p_signup: signup.id,
    });
    if (claimError || !claim) {
      results.push({ flow_id: flow.id, event_delivered: false, whatsapp_sent: null, reason: 'claim_failed' });
      continue;
    }
    if (claim.action === 'resume') {
      const observed = await supabase
        .from('automation_executions')
        .select('id, status, executed_nodes')
        .eq('id', claim.execution_id)
        .maybeSingle();
      if (observed?.error) {
        results.push({ flow_id: flow.id, event_delivered: false, whatsapp_sent: null, reason: 'flow_lookup_failed' });
        continue;
      }
      const execution = observed?.data;
      results.push({
        flow_id: flow.id,
        execution_id: claim.execution_id,
        event_delivered: false,
        whatsapp_sent: null,
        reason: uncertainRunning(execution) || !execution ? 'running_unconfirmed' : 'execution_present',
      });
      continue;
    }
    if (claim.action !== 'create') {
      results.push({ flow_id: flow.id, event_delivered: false, whatsapp_sent: null, reason: 'reserved' });
      continue;
    }

    const dedupKey = popupDedupKey(signup.id);
    const found = await readPopupExecution(supabase, companyId, flow.id, dedupKey);
    if (found.error) {
      results.push({ flow_id: flow.id, event_delivered: false, whatsapp_sent: null, reason: 'flow_lookup_failed' });
      continue;
    }
    let execution = found.execution;
    let createdHere = false;
    if (!execution) {
      execution = await createExecution(flow, {
        dedup_key: dedupKey,
        lead_id: leadId,
        source: 'nuvemshop_popup',
        variables: popupVariables(signup, grant),
      }, companyId, supabase);
      if (execution?.id) {
        createdHere = true;
      } else {
        // createExecution permanece inalterado e devolve null no conflito.
        // A segunda leitura recupera a execução vencedora. Se ela falhar,
        // não há outro INSERT.
        const recovered = await readPopupExecution(supabase, companyId, flow.id, dedupKey);
        if (recovered.error) {
          results.push({ flow_id: flow.id, event_delivered: false, whatsapp_sent: null, reason: 'flow_lookup_failed' });
          continue;
        }
        execution = recovered.execution;
      }
    }
    if (!execution?.id) {
      results.push({ flow_id: flow.id, event_delivered: false, whatsapp_sent: null, reason: 'delivery_failed' });
      continue;
    }

    const bound = await supabase.rpc('nuvemshop_welcome_bind_claim', {
      p_claim: claim.claim_id,
      p_token: claim.lease_token,
      p_execution: execution.id,
    });
    if (bound?.error || bound?.data !== true) {
      results.push({
        flow_id: flow.id,
        execution_id: execution.id,
        event_delivered: false,
        whatsapp_sent: null,
        reason: 'lease_lost',
      });
      continue;
    }
    if (!createdHere) {
      results.push({
        flow_id: flow.id,
        execution_id: execution.id,
        event_delivered: false,
        whatsapp_sent: null,
        reason: uncertainRunning(execution) ? 'running_unconfirmed' : 'execution_present',
      });
      continue;
    }

    const leased = typeof confirmLease === 'function' ? await confirmLease() : false;
    if (!leased) {
      results.push({
        flow_id: flow.id,
        execution_id: execution.id,
        event_delivered: false,
        whatsapp_sent: null,
        reason: 'lease_lost',
        review: 'running_unconfirmed',
      });
      continue;
    }

    // A reserva é conferida aqui, imediatamente antes da chamada. Uma leitura
    // anterior não autoriza o processamento. Depois que processFlowAsync
    // entrou, esta reserva não cancela a chamada em andamento.
    try {
      await processFlowAsync(flow, execution, supabase);
    } catch {
      // A chamada começou. Não repetir WhatsApp. O executor não é interrompido daqui.
    }
    results.push({
      flow_id: flow.id,
      execution_id: execution.id,
      event_delivered: false,
      whatsapp_sent: null,
      started: true,
    });
  }

  return {
    event_delivered: results.some((item) => item.event_delivered),
    whatsapp_sent: null,
    results,
  };
}

function claimKey(companyId, flowId, signupId) {
  return `${companyId}|${flowId}|${signupId}`;
}

export async function dispatchPopupSignup({
  companyId,
  signup,
  grant,
  leadId,
  flows = [],
  claims,
  startExecution,
  now = Date.now(),
}) {
  const matched = flows.filter((flow) => flow.matches !== false && flow.is_over_plan !== true);
  if (matched.length === 0) {
    return { event_delivered: false, whatsapp_sent: null, reason: 'no_automation' };
  }

  const results = [];
  for (const flow of matched) {
    const key = claimKey(companyId, flow.id, signup.id);
    let claim = claims.get(key);
    if (!claim) {
      claim = { status: 'reserved', execution_id: null, reserved_at: now, delivered_at: null };
      claims.set(key, claim);
    } else if (claim.execution_id) {
      results.push({ flow_id: flow.id, event_delivered: true, resumed: true, whatsapp_sent: null });
      continue;
    } else if (now - claim.reserved_at < RECOVERY_MS) {
      results.push({ flow_id: flow.id, event_delivered: false, reason: 'reserved', whatsapp_sent: null });
      continue;
    } else {
      claim.reserved_at = now;
    }

    try {
      const execution = await startExecution(flow, {
        dedup_key: `ns:nuvemshop.popup_signup:${signup.id}`,
        lead_id: leadId,
        source: 'nuvemshop_popup',
        variables: {
          store_id: signup.nuvemshop_store_id,
          campaign_id: signup.campaign_id,
          signup_id: signup.id,
          coupon_code: grant.coupon_code,
          coupon_url: grant.apply_url,
          origin: 'nuvemshop_popup',
          utm: signup.utm,
          coupon_consent: signup.coupon_consent,
          coupon_consent_version: signup.coupon_consent_version,
          promo_consent: signup.promo_consent,
          promo_consent_version: signup.promo_consent_version,
        },
      });
      if (!execution?.id) throw new Error('execution_missing');
      claim.execution_id = execution.id;
      claim.status = 'delivered';
      claim.delivered_at = now;
      results.push({ flow_id: flow.id, execution_id: execution.id, event_delivered: true, whatsapp_sent: null });
    } catch {
      claim.status = 'reserved';
      results.push({ flow_id: flow.id, event_delivered: false, reason: 'delivery_failed', whatsapp_sent: null });
    }
  }
  return { event_delivered: results.some((item) => item.event_delivered), whatsapp_sent: null, results };
}
