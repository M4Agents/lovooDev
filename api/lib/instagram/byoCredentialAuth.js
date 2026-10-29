// =============================================================================
// byoCredentialAuth — autorização de escrita da PoC Instagram BYO
//
// Reutiliza validateInstagramCaller. Não altera a trilha parent/client,
// não lê role do body e não consulta template de permissão.
// A role devolvida é conferida de novo contra a lista de escrita.
// Depois do helper autorizar, uma segunda leitura em lista comprova o
// vínculo direto ativo. Erro dessa leitura não é tratado como ausência.
// BYO_POC_ROLES continua sendo só a lista do GET.
// =============================================================================

import { validateInstagramCaller } from './validateInstagramCaller.js';

export const BYO_CREDENTIAL_WRITE_ROLES = ['super_admin', 'system_admin', 'admin'];

const PARENT_TRACK_ROLES = ['super_admin', 'system_admin'];

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

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @param {string} userId
 * @param {string} companyId
 * @returns {Promise<{ ok: true, roles: string[] } | { ok: false }>}
 */
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

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @param {string} companyId Empresa já aceita pelo gate
 * @returns {Promise<{ ok: true, userId: string, role: string } | { ok: false, status: number, error: string }>}
 */
export async function authorizeByoCredentialWrite(req, svc, companyId) {
  const auth = await validateInstagramCaller(req, svc, companyId, {
    roles: BYO_CREDENTIAL_WRITE_ROLES,
  });
  if (!auth.ok) return auth;
  if (!BYO_CREDENTIAL_WRITE_ROLES.includes(auth.role)) return { ...FORBIDDEN };

  const proof = await loadActiveDirectRoles(svc, auth.userId, companyId);
  if (!proof.ok) return { ...UNAVAILABLE };
  if (proof.roles.length > 1) return { ...FORBIDDEN };
  if (proof.roles.length === 1) {
    if (!BYO_CREDENTIAL_WRITE_ROLES.includes(proof.roles[0])) return { ...FORBIDDEN };
    return { ok: true, userId: auth.userId, role: proof.roles[0] };
  }
  if (PARENT_TRACK_ROLES.includes(auth.role)) {
    return { ok: true, userId: auth.userId, role: auth.role };
  }
  return { ...FORBIDDEN };
}
