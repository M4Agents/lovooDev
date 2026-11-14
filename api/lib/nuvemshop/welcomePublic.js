import { createHash } from 'node:crypto';
import { brMobilePhoneLookupValues } from '../phone/canonicalizeBrMobile.js';
import { publicSignupClosed } from './welcomePopupAccess.js';
import {
  EMAIL_FORMAT_MESSAGE,
  MOBILE_FORMAT_MESSAGE,
  normalizeWelcomeEmail,
  normalizeWelcomeMobile,
} from './welcomeContact.js';
import { matchesTriggerConditions } from '../automation/triggerEvaluator.js';
import { flowHasCertainWhatsappSend } from './welcomeFlowNotice.js';
import { applySignupCommit, signupPayloadHash, toPublicSignupResult } from './welcomeSignup.js';

const MAX_BODY_BYTES = 8_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(status, code, message, origin) {
  return {
    status,
    ...(origin ? { origin } : {}),
    body: { error: message, code, coupon_revealed: false, redirect: false },
  };
}

export function requestOrigin(header) {
  if (typeof header !== 'string' || !header.trim()) return null;
  try {
    const url = new URL(header.trim());
    if (url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function hashRateKey(parts) {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export function welcomeRateLimited(buckets, { ip, companyId, storeId, email, phone }) {
  const checks = [];
  if (ip) checks.push([hashRateKey(['ip', storeId, ip]), 10]);
  checks.push([hashRateKey(['id', companyId, email, phone]), 5]);
  checks.push([hashRateKey(['store', companyId, storeId]), 60]);
  return checks.some(([key, limit]) => hitRateLimit(buckets, key, limit));
}

export function hitRateLimit(buckets, key, limit, now = Date.now(), windowMs = 60 * 60 * 1000) {
  const current = buckets.get(key);
  if (!current || now - current.start >= windowMs) {
    buckets.set(key, { start: now, hits: 1 });
    return false;
  }
  current.hits += 1;
  return current.hits > limit;
}

function publicConfig(campaign) {
  return {
    campaign_id: campaign.id,
    title: campaign.title,
    description: campaign.description,
    image_url: campaign.image_url,
    button_label: campaign.button_label,
    background_color: campaign.background_color,
    text_color: campaign.text_color,
    button_color: campaign.button_color,
    consent_text: campaign.consent_text,
    consent_version: campaign.consent_version,
    promo_consent_text: campaign.promo_consent_text,
    promo_consent_version: campaign.promo_consent_version,
    delay_seconds: campaign.delay_seconds ?? 10,
    resurface_days: campaign.resurface_days ?? 7,
  };
}

async function resolveStore(db, storeId) {
  const { data, error } = await db
    .from('nuvemshop_connections')
    .select('company_id, nuvemshop_store_id, status')
    .eq('nuvemshop_store_id', storeId)
    .eq('status', 'active');
  if (error) return fail(503, 'store_unavailable', 'A loja não está disponível agora.');
  const rows = data ?? [];
  if (rows.length !== 1) return fail(404, 'store_not_found', 'Loja não encontrada.');
  return { ok: true, companyId: rows[0].company_id, storeId: rows[0].nuvemshop_store_id };
}

async function loadCampaign(db, companyId, storeId) {
  const { data, error } = await db
    .from('nuvemshop_welcome_campaigns')
    .select('id, company_id, nuvemshop_store_id, enabled, title, description, image_url, button_label, background_color, text_color, button_color, consent_text, consent_version, promo_consent_text, promo_consent_version, coupon_code, delay_seconds, resurface_days, allowed_origins')
    .eq('company_id', companyId)
    .eq('nuvemshop_store_id', storeId)
    .maybeSingle();
  if (error || !data) return fail(503, 'campaign_unavailable', 'A configuração não está disponível agora.');
  return { ok: true, campaign: data };
}

export function classifyWelcomeNotice({ job, flows, signup, leadId, matches = matchesTriggerConditions }) {
  if (!job || job.status !== 'pending' || String(job.signup_id) !== String(signup?.id)) return 'unknown';
  if (!Array.isArray(flows)) return 'unknown';
  try {
    const event = {
      type: 'nuvemshop.popup_signup',
      data: {
        store_id: signup.nuvemshop_store_id,
        campaign_id: signup.campaign_id,
        lead_id: leadId ?? signup.lead_id ?? null,
      },
    };
    const matched = flows.filter((flow) => (
      flow.is_active !== false
      && flow.is_over_plan !== true
      && matches(flow, event)
    ));
    if (matched.length === 0) return 'none';
    return matched.some((flow) => flowHasCertainWhatsappSend(flow)) ? 'scheduled' : 'none';
  } catch {
    return 'unknown';
  }
}

async function readPendingWelcomeJob(db, signupId) {
  if (db.signupState) {
    return (db.signupState.jobs ?? []).find((job) => (
      job.signup_id === signupId && job.status === 'pending'
    )) ?? null;
  }
  const { data, error } = await db
    .from('nuvemshop_welcome_automation_jobs')
    .select('id, signup_id, grant_id, status')
    .eq('signup_id', signupId)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) return { error: true };
  return data ?? null;
}

async function readWelcomeFlows(db, companyId) {
  if (typeof db.readWelcomeFlows === 'function') return db.readWelcomeFlows(companyId);
  if (Array.isArray(db.flows)) return db.flows;
  const { data, error } = await db
    .from('automation_flows')
    .select('id, nodes, edges, trigger_operator, is_over_plan, is_active')
    .eq('company_id', companyId)
    .eq('is_active', true);
  if (error) return { error: true };
  return data ?? [];
}

export async function handleWelcomePublic(req, db, options = {}) {
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'OPTIONS') {
    return fail(405, 'method_not_allowed', 'Método não permitido.');
  }
  const storeId = String(req.query?.store_id ?? req.body?.store_id ?? '');
  if (!/^\d+$/.test(storeId)) return fail(400, 'validation_error', 'Informe a loja.');
  if ('company_id' in (req.body ?? {}) || 'company_id' in (req.query ?? {})) {
    return fail(400, 'validation_error', 'A empresa é resolvida pela loja.');
  }

  const store = await resolveStore(db, storeId);
  if (!store.ok) return store;
  const loaded = await loadCampaign(db, store.companyId, store.storeId);
  if (!loaded.ok) return loaded;
  const closed = publicSignupClosed(loaded.campaign);
  if (closed) return { status: closed.status, body: { error: closed.message, code: closed.code, coupon_revealed: false, redirect: false } };

  const origin = requestOrigin(req.headers?.origin ?? req.headers?.Origin);
  if (!origin || !(loaded.campaign.allowed_origins ?? []).includes(origin)) {
    return fail(403, 'origin_not_allowed', 'Origem não autorizada.');
  }
  if (req.method === 'OPTIONS' || req.method === 'GET') {
    return { status: 200, origin, body: req.method === 'GET' ? { config: publicConfig(loaded.campaign) } : { ok: true } };
  }

  try {
    const raw = JSON.stringify(req.body ?? {});
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
      return fail(413, 'payload_too_large', 'Os dados enviados são grandes demais.', origin);
    }
    if (req.body?.company_website) return fail(400, 'validation_error', 'Não foi possível enviar o formulário.', origin);

    const buckets = options.buckets ?? db.rateBuckets;
    const email = normalizeWelcomeEmail(req.body?.email);
    const phone = normalizeWelcomeMobile(req.body?.phone);
    if (!email) return fail(400, 'validation_error', EMAIL_FORMAT_MESSAGE, origin);
    if (!phone) return fail(400, 'validation_error', MOBILE_FORMAT_MESSAGE, origin);
    if (welcomeRateLimited(buckets, {
      ip: String(req.ip ?? '').trim(),
      companyId: store.companyId,
      storeId: store.storeId,
      email,
      phone,
    })) {
      return fail(429, 'rate_limited', 'Muitas tentativas. Aguarde para tentar novamente.', origin);
    }
    if (req.body?.coupon_consent !== true) return fail(400, 'validation_error', 'O aceite do cupom é obrigatório.', origin);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (name.length < 1 || name.length > 80) return fail(400, 'validation_error', 'Informe o nome.', origin);
    if (!UUID_RE.test(String(req.body?.attempt_id ?? ''))) return fail(400, 'validation_error', 'Tentativa inválida.', origin);

    const host = new URL(origin).host;
    const input = {
      companyId: store.companyId,
      storeId: store.storeId,
      campaignId: loaded.campaign.id,
      attemptId: req.body.attempt_id,
      name,
      email,
      phone,
      couponConsent: true,
      couponConsentVersion: loaded.campaign.consent_version,
      promoConsent: req.body?.promo_consent === true,
      promoConsentVersion: loaded.campaign.promo_consent_version,
      couponCode: loaded.campaign.coupon_code,
      applyUrl: `https://${host}/discount/${encodeURIComponent(loaded.campaign.coupon_code)}?redirect_to=/`,
      visitorId: req.body?.visitor_id || null,
      sessionId: req.body?.session_id || null,
      utm: req.body?.utm && typeof req.body.utm === 'object' ? req.body.utm : {},
      phones: brMobilePhoneLookupValues(phone),
      origin,
    };
    input.payloadHash = signupPayloadHash(input);
    const committed = db.commitSignup
      ? await db.commitSignup(input)
      : applySignupCommit(db.signupState, input);
    if (!committed) return fail(503, 'signup_unavailable', 'O cadastro não está disponível agora.', origin);
    const response = toPublicSignupResult(committed, input);
    if (response.body?.coupon_revealed === true && committed.signup?.id) {
      response.body.whatsapp_notice = await pendingAutomationNotice(db, committed, store.companyId);
    }
    return { ...response, origin };
  } catch {
    return fail(503, 'signup_unavailable', 'O cadastro não está disponível agora.', origin);
  }
}

async function pendingAutomationNotice(db, committed, companyId) {
  try {
    const job = await readPendingWelcomeJob(db, committed.signup.id);
    if (!job || job.error) return 'unknown';
    const flows = await readWelcomeFlows(db, companyId);
    if (!flows || flows.error) return 'unknown';
    return classifyWelcomeNotice({
      job,
      flows,
      signup: committed.signup,
      leadId: committed.leadId,
    });
  } catch {
    return 'unknown';
  }
}
