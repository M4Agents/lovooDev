// =============================================================================
// welcomePopupConfig — leitura e gravação da configuração por loja
//
// company_id e store_id vêm do caller já autenticado.
// A loja precisa ser a conexão ativa daquela empresa.
// enabled permanece false. Cupom preenchido é só consultado (GET).
//
// Publicar este módulo só depois da migration aditiva 20261114130000.
// Sem as colunas novas, a leitura responde recurso indisponível e
// a gravação não substitui o rascunho existente.
// =============================================================================

import { findCouponByCode } from './couponSync.js';
import {
  assertWelcomeScope,
  mergeWelcomeDraft,
  normalizeWelcomeDraft,
  toPublicCampaign,
} from './welcomePopupDraft.js';

export {
  activationRequested,
  assertWelcomeScope,
  WELCOME_WRITE_ROLES,
} from './welcomePopupDraft.js';

const CAMPAIGN_COLUMNS = [
  'id',
  'title',
  'description',
  'button_label',
  'consent_text',
  'consent_version',
  'image_url',
  'background_color',
  'text_color',
  'button_color',
  'coupon_code',
  'delay_seconds',
  'resurface_days',
  'promo_consent_text',
  'promo_consent_version',
  'allowed_origins',
  'test_contacts',
  'updated_at',
].join(', ');

function fail(status, code, message) {
  return { ok: false, error: { status, code, message } };
}

const READ_ERROR = 'Erro ao consultar a configuração do pop-up.';
const WRITE_ERROR = 'Erro ao salvar a configuração do pop-up.';
const UNAVAILABLE = 'A configuração do pop-up ainda não está disponível neste ambiente.';

const WELCOME_TABLES = ['nuvemshop_welcome_campaigns', 'nuvemshop_welcome_test_submissions'];
const WELCOME_COLUMNS = ['promo_consent_text', 'promo_consent_version', 'allowed_origins', 'test_contacts'];

function mentionsWelcome(message, names) {
  const text = message.toLowerCase();
  return names.some((name) => text.includes(name));
}

function missingCampaignShape(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const code = error?.code;
  const table = mentionsWelcome(message, WELCOME_TABLES);
  const column = mentionsWelcome(message, WELCOME_COLUMNS);
  if (code === 'PGRST205' || code === '42P01') return table;
  if (code === 'PGRST204' || code === '42703') return table && column;
  return false;
}

function campaignStoreError(error, fallbackMessage) {
  if (missingCampaignShape(error)) {
    return fail(503, 'resource_unavailable', UNAVAILABLE);
  }
  return fail(500, 'db_error', fallbackMessage);
}

async function assertActiveConnection(svc, companyId, storeId) {
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

export async function getWelcomeCampaign({ svc, companyId, storeId }) {
  const scope = assertWelcomeScope(companyId, storeId);
  if (!scope.ok) return scope;

  const connection = await assertActiveConnection(svc, scope.companyId, scope.storeId);
  if (!connection.ok) return connection;

  const { data, error } = await svc
    .from('nuvemshop_welcome_campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('company_id', scope.companyId)
    .eq('nuvemshop_store_id', scope.storeId)
    .maybeSingle();

  if (error) return campaignStoreError(error, READ_ERROR);
  return { ok: true, campaign: toPublicCampaign(data, scope.companyId, scope.storeId) };
}

export async function saveWelcomeCampaign({
  svc,
  companyId,
  storeId,
  userId,
  payload,
  findCoupon = findCouponByCode,
}) {
  const scope = assertWelcomeScope(companyId, storeId);
  if (!scope.ok) return scope;

  const draft = normalizeWelcomeDraft(payload ?? {});
  if (!draft.ok) return draft;

  const connection = await assertActiveConnection(svc, scope.companyId, scope.storeId);
  if (!connection.ok) return connection;

  if (draft.value.coupon_code) {
    const found = await findCoupon({
      companyId: scope.companyId,
      storeId: scope.storeId,
      code: draft.value.coupon_code,
      svc,
    });
    if (!found.ok) return found;
  }

  const existing = await svc
    .from('nuvemshop_welcome_campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('company_id', scope.companyId)
    .eq('nuvemshop_store_id', scope.storeId)
    .maybeSingle();

  if (existing.error) {
    // Falha de leitura não segue para insert/update. O rascunho permanece.
    return campaignStoreError(existing.error, WRITE_ERROR);
  }

  const write = {
    ...mergeWelcomeDraft(existing.data, draft.value),
    enabled: false,
    page_rule: 'home',
    updated_by: userId ?? null,
  };

  if (existing.data?.id) {
    const updated = await svc
      .from('nuvemshop_welcome_campaigns')
      .update(write)
      .eq('id', existing.data.id)
      .eq('company_id', scope.companyId)
      .eq('nuvemshop_store_id', scope.storeId)
      .select(CAMPAIGN_COLUMNS)
      .single();

    if (updated.error || !updated.data) {
      return campaignStoreError(updated.error, WRITE_ERROR);
    }
    return { ok: true, campaign: toPublicCampaign(updated.data, scope.companyId, scope.storeId) };
  }

  const inserted = await svc
    .from('nuvemshop_welcome_campaigns')
    .insert({
      ...write,
      company_id: scope.companyId,
      nuvemshop_store_id: scope.storeId,
      created_by: userId ?? null,
    })
    .select(CAMPAIGN_COLUMNS)
    .single();

  if (inserted.error || !inserted.data) {
    return campaignStoreError(inserted.error, WRITE_ERROR);
  }
  return { ok: true, campaign: toPublicCampaign(inserted.data, scope.companyId, scope.storeId) };
}
