// =============================================================================
// Autorização da troca de modalidade Instagram.
//
// A RPC exige exatamente um papel direto em super_admin, system_admin ou admin.
// Partner, manager, seller, papéis múltiplos e super_admin só da empresa pai
// não passam. O ator sai do JWT, nunca do corpo.
// =============================================================================

import { validateInstagramCaller } from './validateInstagramCaller.js';
import { BYO_CREDENTIAL_WRITE_ROLES } from './byoCredentialAuth.js';

const FORBIDDEN = {
  ok: false,
  status: 403,
  error: 'Permissão insuficiente para esta operação',
};

const UNAVAILABLE = {
  ok: false,
  status: 503,
  error: 'Serviço temporariamente indisponível',
};

async function loadActiveDirectRoles(svc, userId, companyId) {
  const { data, error } = await svc
    .from('company_users')
    .select('role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('is_active', true);

  if (error || !Array.isArray(data)) return { ok: false };
  return { ok: true, roles: data.map((row) => row?.role) };
}

export async function authorizeInstagramModalitySwitch(req, svc, companyId) {
  const auth = await validateInstagramCaller(req, svc, companyId, {
    roles: BYO_CREDENTIAL_WRITE_ROLES,
  });
  if (!auth.ok) return auth;
  if (!BYO_CREDENTIAL_WRITE_ROLES.includes(auth.role)) return { ...FORBIDDEN };

  const proof = await loadActiveDirectRoles(svc, auth.userId, companyId);
  if (!proof.ok) return { ...UNAVAILABLE };
  if (proof.roles.length !== 1) return { ...FORBIDDEN };
  if (!BYO_CREDENTIAL_WRITE_ROLES.includes(proof.roles[0])) return { ...FORBIDDEN };
  return { ok: true, userId: auth.userId, role: proof.roles[0] };
}
