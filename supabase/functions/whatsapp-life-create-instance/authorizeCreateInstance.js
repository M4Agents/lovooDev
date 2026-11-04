// Autorização da criação administrativa de instância WhatsApp.
// A matriz é a mesma de api/lib/uazapi/qrAuthorization.js.
// A empresa do body não prova acesso. Partner não entra por papel.
// Seller entra na matriz, mas o handler encerra a operação antes de criar instância.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CREATE_DIRECT_ROLES = ['admin', 'manager', 'seller'];
export const CREATE_PARENT_ROLES = ['super_admin', 'system_admin'];

const FORBIDDEN = {
  ok: false,
  status: 403,
  error: 'Permissão insuficiente para esta operação',
};

const UNAVAILABLE = {
  ok: false,
  status: 503,
  error: 'Não foi possível validar o acesso',
};

function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

async function loadRoles(svc, userId, companyId, allowed) {
  let query = svc
    .from('company_users')
    .select('role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('is_active', true);
  if (allowed) query = query.in('role', allowed);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) return { ok: false };
  return { ok: true, roles: data.map((row) => row?.role).filter((role) => typeof role === 'string') };
}

async function loadCompany(svc, companyId) {
  const { data, error } = await svc
    .from('companies')
    .select('id, parent_company_id')
    .eq('id', companyId)
    .maybeSingle();
  if (error) return { ok: false };
  return { ok: true, company: data };
}

export async function authorizeCreateInstance(svc, userId, companyId) {
  if (!userId || !isUuid(companyId)) {
    return { ok: false, status: 400, error: 'Empresa inválida' };
  }

  const direct = await loadRoles(svc, userId, companyId);
  if (!direct.ok) return { ...UNAVAILABLE };
  if (direct.roles.length > 1) return { ...FORBIDDEN };

  const [directRole] = direct.roles;
  if (directRole && CREATE_DIRECT_ROLES.includes(directRole)) {
    const company = await loadCompany(svc, companyId);
    if (!company.ok) return { ...UNAVAILABLE };
    if (!company.company) return { ok: false, status: 404, error: 'Empresa não encontrada' };
    return { ok: true, userId, role: directRole, scope: 'company' };
  }

  const company = await loadCompany(svc, companyId);
  if (!company.ok) return { ...UNAVAILABLE };
  if (!company.company?.parent_company_id) return { ...FORBIDDEN };

  const parent = await loadRoles(svc, userId, company.company.parent_company_id, CREATE_PARENT_ROLES);
  if (!parent.ok) return { ...UNAVAILABLE };
  if (parent.roles.length !== 1 || !CREATE_PARENT_ROLES.includes(parent.roles[0])) return { ...FORBIDDEN };
  return { ok: true, userId, role: parent.roles[0], scope: 'parent' };
}
