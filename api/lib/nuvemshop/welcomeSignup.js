import { createHash } from 'node:crypto';
import { classifyIdentity, evaluateSyncedPurchases, LIMITED_VERIFICATION_NOTE } from './welcomeEligibility.js';

export function signupPayloadHash(input) {
  return createHash('sha256').update(JSON.stringify({
    campaignId: input.campaignId,
    name: input.name.trim(),
    email: input.email,
    phone: input.phone,
    couponConsent: input.couponConsent === true,
    promoConsent: input.promoConsent === true,
  })).digest('hex');
}

function identityKey(email, phone) {
  return `${email}|${phone}`;
}

function findLeads(state, companyId, email, phone, phones = [phone]) {
  const accepted = new Set(phones);
  return state.leads.filter((lead) => (
    lead.company_id === companyId
    && lead.deleted_at == null
    && (
      String(lead.email ?? '').toLowerCase() === email
      || accepted.has(lead.phone_normalized)
      || accepted.has(lead.phone)
    )
  ));
}

function fillEmpty(lead, input) {
  if (!lead.name) lead.name = input.name;
  if (!lead.email) lead.email = input.email;
  if (!lead.phone) lead.phone = input.phone;
  if (!lead.phone_normalized) lead.phone_normalized = input.phone;
  if (!lead.visitor_id && input.visitorId) lead.visitor_id = input.visitorId;
}

export function applySignupCommit(state, input) {
  const hash = signupPayloadHash(input);
  const attempt = state.signups.find((row) => (
    row.company_id === input.companyId
    && row.nuvemshop_store_id === input.storeId
    && row.attempt_id === input.attemptId
  ));
  if (attempt && attempt.payload_hash !== hash) {
    return { ok: false, status: 409, code: 'attempt_conflict' };
  }
  if (attempt) {
    return previousResult(state, attempt, input);
  }

  const leads = findLeads(state, input.companyId, input.email, input.phone, input.phones);
  const identity = classifyIdentity(
    leads.filter((lead) => lead.phone_normalized === input.phone || lead.phone === input.phone).map((lead) => lead.id),
    leads.filter((lead) => String(lead.email ?? '').toLowerCase() === input.email).map((lead) => lead.id),
  );
  if (identity.identity === 'conflict') {
    return storeAttempt(state, input, hash, { identity: 'conflict', eligibility: 'not_evaluated', lead: null, grant: false });
  }

  const orders = identity.leadId == null ? [] : state.opportunities.filter((row) => (
    row.company_id === input.companyId
    && row.nuvemshop_store_id === input.storeId
    && row.lead_id === identity.leadId
    && row.nuvemshop_order_id
  ));
  const decision = identity.leadId == null
    ? { eligibility: 'eligible_limited', limitation: LIMITED_VERIFICATION_NOTE }
    : evaluateSyncedPurchases(orders);
  const lead = identity.leadId == null ? null : state.leads.find((row) => row.id === identity.leadId);
  return storeAttempt(state, input, hash, {
    identity: identity.identity,
    eligibility: decision.eligibility,
    limitation: decision.limitation,
    lead,
    grant: decision.eligibility === 'eligible_limited',
  });
}

function contactGrants(state, input) {
  const seen = new Set();
  return state.grants.filter((row) => {
    if (row.campaign_id !== input.campaignId) return false;
    if (row.email_key !== input.email && row.phone_key !== input.phone) return false;
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function ordersFor(state, input, leadId) {
  if (leadId == null) return [];
  return state.opportunities.filter((row) => (
    row.company_id === input.companyId
    && row.nuvemshop_store_id === input.storeId
    && row.lead_id === leadId
    && row.nuvemshop_order_id
  ));
}

function previousResult(state, attempt, input) {
  const found = contactGrants(state, {
    campaignId: attempt.campaign_id,
    email: input.email,
    phone: input.phone,
  }).filter((row) => row.signup_id === attempt.id || row.email_key === input.email || row.phone_key === input.phone);
  const stillEligible = attempt.lead_id != null
    && evaluateSyncedPurchases(ordersFor(state, input, attempt.lead_id)).eligibility === 'eligible_limited';
  return {
    ok: true,
    repeated: true,
    grantCreated: false,
    signup: attempt,
    grant: found.length === 1 && stillEligible ? found[0] : null,
    leadId: attempt.lead_id,
  };
}

function rememberJob(state, input, signup, grant) {
  if (!state.jobs) state.jobs = [];
  state.jobs.push({
    id: `job-${state.jobs.length + 1}`,
    company_id: input.companyId,
    signup_id: signup.id,
    grant_id: grant.id,
    status: 'pending',
    result: null,
    attempts: 0,
  });
}

function storeAttempt(state, input, hash, decision) {
  const found = contactGrants(state, input);
  let identity = decision.identity;
  let eligibility = decision.eligibility;
  let limitation = decision.limitation;
  let lead = decision.lead;
  let grant = null;
  let reveal = false;

  if (found.length > 1 || identity === 'conflict') {
    identity = 'conflict';
    eligibility = 'not_evaluated';
    limitation = null;
    lead = null;
  } else if (found.length === 1) {
    const owner = state.leads.find((row) => row.id === found[0].lead_id && row.deleted_at == null);
    if (identity === 'reuse' && owner && lead && String(owner.id) !== String(lead.id)) {
      identity = 'conflict';
      eligibility = 'not_evaluated';
      limitation = null;
      lead = null;
    } else if (identity === 'none' && !owner) {
      identity = 'conflict';
      eligibility = 'not_evaluated';
      limitation = null;
      lead = null;
    } else {
      if (!lead && owner) lead = owner;
      identity = 'reuse';
      const fresh = evaluateSyncedPurchases(ordersFor(state, input, lead?.id));
      eligibility = fresh.eligibility;
      limitation = fresh.limitation;
      if (eligibility === 'eligible_limited') {
        grant = found[0];
        reveal = true;
      }
      if (lead) fillEmpty(lead, input);
    }
  } else if (identity === 'none' && decision.grant) {
    lead = {
      id: state.nextLeadId++,
      company_id: input.companyId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      phone_normalized: input.phone,
      origin: 'nuvemshop_popup',
      status: 'novo',
      visitor_id: input.visitorId ?? null,
      nuvemshop_store_id: input.storeId,
      responsible_user_id: null,
      deleted_at: null,
    };
    state.leads.push(lead);
  } else if (identity === 'reuse' && lead) {
    fillEmpty(lead, input);
  }

  const signup = {
    id: `signup-${state.signups.length + 1}`,
    company_id: input.companyId,
    nuvemshop_store_id: input.storeId,
    campaign_id: input.campaignId,
    attempt_id: input.attemptId,
    payload_hash: hash,
    identity_key: identityKey(input.email, input.phone),
    identity_result: identity,
    eligibility_result: eligibility,
    limitation_note: limitation ?? null,
    lead_id: lead?.id ?? null,
    visitor_id: input.visitorId ?? null,
    session_id: input.sessionId ?? null,
    utm: input.utm ?? {},
    coupon_consent: true,
    coupon_consent_version: input.couponConsentVersion,
    promo_consent: input.promoConsent === true,
    promo_consent_version: input.promoConsent ? input.promoConsentVersion : null,
  };
  state.signups.push(signup);

  let grantCreated = false;
  if (!grant && found.length === 0 && eligibility === 'eligible_limited' && lead) {
    grant = {
      id: `grant-${state.grants.length + 1}`,
      company_id: input.companyId,
      campaign_id: input.campaignId,
      signup_id: signup.id,
      lead_id: lead.id,
      identity_key: signup.identity_key,
      email_key: input.email,
      phone_key: input.phone,
      coupon_code: input.couponCode,
      apply_url: input.applyUrl,
    };
    state.grants.push(grant);
    grantCreated = true;
    reveal = true;
    rememberJob(state, input, signup, grant);
  }

  return {
    ok: true,
    repeated: false,
    grantCreated,
    signup,
    grant: reveal ? grant : null,
    leadId: lead?.id ?? null,
  };
}

export function toPublicSignupResult(result, input) {
  if (!result.ok) {
    const errors = {
      attempt_conflict: 'Esta tentativa já foi registrada com outros dados.',
      rate_limited: 'Muitas tentativas. Aguarde para tentar novamente.',
      publication_blocked: 'O pop-up ainda não pode ser publicado. O formulário público não está disponível.',
    };
    return {
      status: result.status,
      body: {
        code: result.code,
        error: errors[result.code] ?? 'Não foi possível concluir o cadastro.',
        coupon_revealed: false,
        redirect: false,
      },
    };
  }
  if (result.signup.identity_result === 'conflict') {
    return {
      status: 409,
      body: {
        code: 'identity_conflict',
        error: 'Não foi possível concluir o cadastro com estes dados.',
        coupon_revealed: false,
        redirect: false,
      },
    };
  }
  if (!result.grant || result.signup.eligibility_result !== 'eligible_limited') {
    const unavailable = result.signup.eligibility_result === 'payment_inconclusive'
      || result.signup.eligibility_result === 'unavailable';
    return {
      status: 200,
      body: {
        code: unavailable ? 'eligibility_unavailable' : 'coupon_not_granted',
        error: unavailable
          ? 'Não foi possível confirmar a elegibilidade agora.'
          : 'Não foi possível conceder o cupom para este cadastro.',
        coupon_revealed: false,
        redirect: false,
        discount_applied: false,
      },
    };
  }
  return {
    status: 200,
    body: {
      code: 'coupon_granted',
      coupon_code: result.grant.coupon_code,
      apply_url: result.grant.apply_url,
      coupon_revealed: true,
      redirect: true,
      discount_applied: false,
      repeated: result.repeated || !result.grantCreated,
      limitation: result.signup.limitation_note,
      campaign_id: input.campaignId,
    },
  };
}
