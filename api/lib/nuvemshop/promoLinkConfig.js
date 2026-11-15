// Definição dos links promocionais.
// A URL não é gravada. O cupom é conferido na Nuvemshop só ao salvar.

import { findCouponByCode } from './couponSync.js';
import { assertWelcomeScope } from './welcomePopupDraft.js';
import { normalizePromoDestination, buildPromoDiscountUrl } from './promoLinkDestination.js';
import { loadPublicStoreOrigin } from './promoStoreOrigin.js';

export const PROMO_LINK_READ_ROLES = ['super_admin', 'system_admin', 'partner', 'admin', 'manager'];
export const PROMO_LINK_WRITE_ROLES = ['super_admin', 'system_admin', 'admin', 'manager'];

const COLUMNS = 'id, name, coupon_code, coupon_type, destination_path, created_at';

function fail(status, code, message, field) {
  return { ok: false, error: { status, code, message, ...(field ? { field } : {}) } };
}

function unavailable(error) {
  const message = `${error?.message ?? ''} ${error?.details ?? ''}`;
  return error?.code === 'PGRST205'
    || error?.code === '42P01'
    || message.includes('nuvemshop_promo_links');
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
  if (!data) return fail(404, 'connection_not_found', 'Integração Nuvemshop não encontrada ou inativa para esta empresa.');
  return { ok: true };
}

function benefitAllows(benefit, couponType) {
  if (benefit === 'discount') return couponType === 'percentage' || couponType === 'absolute';
  if (benefit === 'shipping') return couponType === 'shipping';
  return false;
}

export async function listPromoLinks({ svc, companyId, storeId }) {
  const scope = assertWelcomeScope(companyId, storeId);
  if (!scope.ok) return scope;
  const connection = await activeConnection(svc, scope.companyId, scope.storeId);
  if (!connection.ok) return connection;

  const { data, error } = await svc
    .from('nuvemshop_promo_links')
    .select(COLUMNS)
    .eq('company_id', scope.companyId)
    .eq('nuvemshop_store_id', scope.storeId)
    .order('created_at', { ascending: false });

  if (error) {
    if (unavailable(error)) return fail(503, 'resource_unavailable', 'Os links promocionais ainda não estão disponíveis neste ambiente.');
    return fail(500, 'db_error', 'Erro ao consultar os links promocionais.');
  }
  return { ok: true, links: data ?? [] };
}

export async function savePromoLink({
  svc,
  companyId,
  storeId,
  userId,
  payload,
  findCoupon = findCouponByCode,
  loadOrigin = loadPublicStoreOrigin,
}) {
  const scope = assertWelcomeScope(companyId, storeId);
  if (!scope.ok) return scope;
  const connection = await activeConnection(svc, scope.companyId, scope.storeId);
  if (!connection.ok) return connection;

  const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
  if (name.length < 1 || name.length > 80) {
    return fail(400, 'validation_error', 'Informe o nome da campanha, com até 80 caracteres.', 'name');
  }
  const benefit = payload?.benefit;
  if (benefit !== 'discount' && benefit !== 'shipping') {
    return fail(400, 'validation_error', 'Escolha desconto ou frete grátis.', 'benefit');
  }
  const code = typeof payload?.coupon_code === 'string' ? payload.coupon_code.trim().toUpperCase() : '';
  if (!code) return fail(400, 'validation_error', 'Selecione um cupom.', 'coupon_code');

  const needsHost = typeof payload?.destination === 'string' && /^https?:\/\//i.test(payload.destination.trim());
  let allowedHosts = [];
  if (needsHost) {
    const origin = await loadOrigin({
      companyId: scope.companyId,
      storeId: scope.storeId,
      svc,
      requestedHost: payload?.host,
    });
    if (!origin.ok && origin.error?.code !== 'public_domain_choice') return origin;
    allowedHosts = origin.ok ? origin.allowedHosts : (origin.error?.hosts ?? []);
    if (!origin.ok && allowedHosts.length === 0) return origin;
  }

  const destination = normalizePromoDestination(payload?.destination, allowedHosts);
  if (!destination.ok) return destination;

  const found = await findCoupon({
    companyId: scope.companyId,
    storeId: scope.storeId,
    code,
    svc,
  });
  if (!found.ok) return found;
  if (!benefitAllows(benefit, found.coupon.type)) {
    return fail(400, 'validation_error', 'O cupom escolhido não corresponde ao tipo de benefício.', 'coupon_code');
  }

  const { data, error } = await svc
    .from('nuvemshop_promo_links')
    .insert({
      company_id: scope.companyId,
      nuvemshop_store_id: scope.storeId,
      name,
      coupon_code: code,
      coupon_type: found.coupon.type,
      destination_path: destination.path,
      created_by: userId ?? null,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') {
      return fail(409, 'name_taken', 'Já existe uma campanha com este nome nesta loja.', 'name');
    }
    if (unavailable(error)) return fail(503, 'resource_unavailable', 'Os links promocionais ainda não estão disponíveis neste ambiente.');
    return fail(500, 'db_error', 'Erro ao salvar o link promocional.');
  }
  return { ok: true, link: data };
}

export async function promoLinkUrl({
  svc,
  companyId,
  storeId,
  linkId,
  requestedHost,
  loadOrigin = loadPublicStoreOrigin,
}) {
  const scope = assertWelcomeScope(companyId, storeId);
  if (!scope.ok) return scope;
  if (typeof linkId !== 'string' || !/^[0-9a-f-]{36}$/i.test(linkId)) {
    return fail(400, 'validation_error', 'Campanha inválida.', 'id');
  }
  const connection = await activeConnection(svc, scope.companyId, scope.storeId);
  if (!connection.ok) return connection;

  const { data, error } = await svc
    .from('nuvemshop_promo_links')
    .select('coupon_code, destination_path')
    .eq('id', linkId)
    .eq('company_id', scope.companyId)
    .eq('nuvemshop_store_id', scope.storeId)
    .maybeSingle();
  if (error) {
    if (unavailable(error)) return fail(503, 'resource_unavailable', 'Os links promocionais ainda não estão disponíveis neste ambiente.');
    return fail(500, 'db_error', 'Erro ao consultar o link promocional.');
  }
  if (!data) return fail(404, 'not_found', 'Campanha não encontrada nesta loja.');

  const origin = await loadOrigin({
    companyId: scope.companyId,
    storeId: scope.storeId,
    svc,
    requestedHost,
  });
  if (!origin.ok) return origin;

  return {
    ok: true,
    url: buildPromoDiscountUrl(origin.origin, data.coupon_code, data.destination_path),
    host: origin.host,
  };
}
