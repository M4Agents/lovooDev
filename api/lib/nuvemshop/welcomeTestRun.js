// =============================================================================
// Teste autenticado do pop-up.
//
// Grava só em nuvemshop_welcome_test_submissions.
// Não cria nem altera lead, não revela cupom, não redireciona e não emite evento.
// Automações futuras não devem ler esta tabela.
// =============================================================================

import { brMobilePhoneLookupValues } from '../phone/canonicalizeBrMobile.js';
import { assertWelcomeScope } from './welcomePopupDraft.js';
import { classifyIdentity, evaluateSyncedPurchases } from './welcomeEligibility.js';
import {
  EMAIL_FORMAT_MESSAGE,
  MOBILE_FORMAT_MESSAGE,
  normalizeWelcomeEmail,
  normalizeWelcomeMobile,
} from './welcomeContact.js';

function exactEmailPattern(email) {
  return email.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function fail(status, code, message, field) {
  return { ok: false, error: { status, code, message, ...(field ? { field } : {}) } };
}

function unavailable(message) {
  return fail(503, 'history_unavailable', message);
}

async function activeConnection(svc, companyId, storeId) {
  const { data, error } = await svc
    .from('nuvemshop_connections')
    .select('id')
    .eq('company_id', companyId)
    .eq('nuvemshop_store_id', storeId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) return fail(500, 'db_error', 'Erro ao consultar a conexão da loja.');
  if (!data) {
    return fail(404, 'connection_not_found', 'Integração Nuvemshop não encontrada ou inativa para esta empresa.');
  }
  return { ok: true };
}

async function loadCampaign(svc, companyId, storeId) {
  const { data, error } = await svc
    .from('nuvemshop_welcome_campaigns')
    .select('id, consent_text, consent_version, test_contacts, enabled')
    .eq('company_id', companyId)
    .eq('nuvemshop_store_id', storeId)
    .maybeSingle();
  if (error) return fail(500, 'db_error', 'Erro ao consultar a configuração do pop-up.');
  if (!data) return fail(404, 'campaign_not_found', 'Salve a configuração antes de registrar um teste.');
  return { ok: true, campaign: data };
}

function authorizedContact(contacts, email, phone) {
  return (Array.isArray(contacts) ? contacts : []).some((contact) => (
    contact?.email === email && contact?.phone === phone
  ));
}

function readIds(result) {
  if (result?.error) return { ok: false };
  const rows = result?.data ?? [];
  return { ok: true, ids: rows.map((row) => row.id) };
}

async function readIdentity(svc, companyId, email, phone) {
  const phones = brMobilePhoneLookupValues(phone);
  const byPhone = await svc
    .from('leads')
    .select('id')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .in('phone_normalized', phones.length ? phones : ['__none__'])
    .limit(2);
  const byEmail = await svc
    .from('leads')
    .select('id')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .ilike('email', exactEmailPattern(email))
    .limit(2);
  const phoneIds = readIds(byPhone);
  const emailIds = readIds(byEmail);
  if (!phoneIds.ok || !emailIds.ok) return { ok: false };
  return { ok: true, ...classifyIdentity(phoneIds.ids, emailIds.ids) };
}

async function readPurchases(svc, companyId, storeId, leadId) {
  const { data, error } = await svc
    .from('opportunities')
    .select('status, nuvemshop_payment_data, nuvemshop_order_id, nuvemshop_store_id, lead_id, company_id')
    .eq('company_id', companyId)
    .eq('lead_id', leadId)
    .eq('nuvemshop_store_id', storeId);
  if (error) return { ok: false };
  const rows = (data ?? []).filter((row) => row.nuvemshop_order_id);
  return { ok: true, rows };
}

function publicResult(row) {
  return {
    identity: row.identity_result,
    eligibility: row.eligibility_result,
    limitation: row.limitation_note,
    coupon_revealed: false,
    redirect: false,
    lead_changed: false,
  };
}

export async function runWelcomeTest({ svc, companyId, storeId, userId, payload }) {
  const scope = assertWelcomeScope(companyId, storeId);
  if (!scope.ok) return scope;
  const connection = await activeConnection(svc, scope.companyId, scope.storeId);
  if (!connection.ok) return connection;
  const loaded = await loadCampaign(svc, scope.companyId, scope.storeId);
  if (!loaded.ok) return loaded;

  const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
  const email = normalizeWelcomeEmail(payload?.email);
  const phone = normalizeWelcomeMobile(payload?.phone);
  if (name.length < 1 || name.length > 80) {
    return fail(400, 'validation_error', 'Informe o nome do contato de teste.', 'name');
  }
  if (!email) return fail(400, 'validation_error', EMAIL_FORMAT_MESSAGE, 'email');
  if (!phone) return fail(400, 'validation_error', MOBILE_FORMAT_MESSAGE, 'phone');
  if (payload?.coupon_consent !== true) {
    return fail(400, 'validation_error', 'O aceite para receber o cupom é obrigatório no teste.', 'coupon_consent');
  }
  if (!authorizedContact(loaded.campaign.test_contacts, email, phone)) {
    return fail(403, 'contact_not_authorized', 'Este contato não está na lista autorizada para teste.', 'email');
  }

  const identity = await readIdentity(svc, scope.companyId, email, phone);
  let identityResult = 'unavailable';
  let leadId = null;
  let decision = { eligibility: 'unavailable', limitation: null };

  if (!identity.ok) {
    decision = { eligibility: 'unavailable', limitation: null };
  } else if (identity.identity === 'conflict') {
    identityResult = 'conflict';
    decision = { eligibility: 'not_evaluated', limitation: null };
  } else {
    identityResult = identity.identity;
    leadId = identity.leadId;
    if (leadId == null) {
      decision = evaluateSyncedPurchases([]);
    } else {
      const purchases = await readPurchases(svc, scope.companyId, scope.storeId, leadId);
      decision = purchases.ok
        ? evaluateSyncedPurchases(purchases.rows)
        : { eligibility: 'unavailable', limitation: null };
    }
  }

  const row = {
    company_id: scope.companyId,
    nuvemshop_store_id: scope.storeId,
    campaign_id: loaded.campaign.id,
    name,
    email_normalized: email,
    phone_normalized: phone,
    coupon_consent: true,
    coupon_consent_version: loaded.campaign.consent_version ?? null,
    promo_consent: payload?.promo_consent === true,
    identity_result: identityResult,
    eligibility_result: decision.eligibility,
    limitation_note: decision.limitation,
    observed_lead_id: leadId,
    created_by: userId ?? null,
  };

  const inserted = await svc
    .from('nuvemshop_welcome_test_submissions')
    .insert(row)
    .select('identity_result, eligibility_result, limitation_note')
    .single();
  if (inserted.error || !inserted.data) {
    return unavailable('Não foi possível registrar o resultado do teste.');
  }
  return { ok: true, result: publicResult(inserted.data) };
}

export async function clearWelcomeTests({ svc, companyId, storeId }) {
  const scope = assertWelcomeScope(companyId, storeId);
  if (!scope.ok) return scope;
  const connection = await activeConnection(svc, scope.companyId, scope.storeId);
  if (!connection.ok) return connection;

  const deleted = await svc
    .from('nuvemshop_welcome_test_submissions')
    .delete()
    .eq('company_id', scope.companyId)
    .eq('nuvemshop_store_id', scope.storeId);
  if (deleted.error) return fail(500, 'db_error', 'Não foi possível limpar os testes.');
  return { ok: true, deleted: deleted.count ?? deleted.data?.length ?? 0 };
}
