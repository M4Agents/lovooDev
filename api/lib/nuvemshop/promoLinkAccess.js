// Leitura dos links promocionais.
// O partner da empresa pai não tem company_users na filha.
// A cadeia abaixo é a mesma de nuvemshop_promo_partner_can_read.
// validateNuvemshopCaller permanece intacto e a gravação não usa esta exceção.

import { validateNuvemshopCaller } from './validateNuvemshopCaller.js';
import { PROMO_LINK_READ_ROLES, PROMO_LINK_WRITE_ROLES } from './promoLinkConfig.js';

async function parentAssignedPartner(req, svc, companyId) {
  const token = (req.headers?.authorization ?? '').slice('Bearer '.length);
  const { data: { user } = {}, error: authError } = await svc.auth.getUser(token);
  if (authError || !user) return false;

  const { data: target, error: targetError } = await svc
    .from('companies')
    .select('parent_company_id')
    .eq('id', companyId)
    .maybeSingle();
  if (targetError || !target?.parent_company_id) return false;

  const { data: membership, error: membershipError } = await svc
    .from('company_users')
    .select('company_id, companies!inner(company_type)')
    .eq('user_id', user.id)
    .eq('company_id', target.parent_company_id)
    .eq('role', 'partner')
    .eq('is_active', true)
    .maybeSingle();
  if (membershipError || membership?.companies?.company_type !== 'parent') return false;

  const { data: assignment, error: assignmentError } = await svc
    .from('partner_company_assignments')
    .select('id')
    .eq('partner_user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();
  if (assignmentError || !assignment) return false;
  return user.id;
}

export async function authorizePromoLinkCaller(req, svc, companyId, { write = false } = {}) {
  const auth = await validateNuvemshopCaller(req, svc, companyId, {
    roles: write ? PROMO_LINK_WRITE_ROLES : PROMO_LINK_READ_ROLES,
  });
  if (auth.ok || write || auth.status !== 403) return auth;

  const partnerId = await parentAssignedPartner(req, svc, companyId);
  if (!partnerId) return auth;
  return { ok: true, userId: partnerId, role: 'partner' };
}
