import type { CompanyUser, UserRole } from '../../types/user';

/**
 * Filtro visual da prévia Instagram BYO.
 * Não autoriza API, não substitui company_users nem a allowlist do servidor.
 */
export const INSTAGRAM_BYO_PILOT_COMPANY_ID = '3cbe5c11-d834-40d1-b1cf-425e6377f099';

const DIRECT_VIEW_ROLES: UserRole[] = ['admin', 'manager', 'super_admin', 'system_admin'];

type RoleRow = Pick<CompanyUser, 'company_id' | 'role' | 'companies' | 'company'>;

function companyTypeOf(role: RoleRow): string | undefined {
  return role.companies?.company_type ?? role.company?.company_type;
}

function isParentOperator(role: RoleRow, parentCompanyId: string, allowed: UserRole[]): boolean {
  return (
    role.company_id === parentCompanyId &&
    companyTypeOf(role) === 'parent' &&
    allowed.includes(role.role)
  );
}

export function canViewInstagramByoMeta(input: {
  companyId?: string | null;
  parentCompanyId?: string | null;
  roles: RoleRow[];
  /**
   * Empresas já filtradas por get_partner_assigned_companies.
   * Omitir quando a sessão não for de partner: a atribuição não fica confirmada.
   */
  partnerAssignedCompanyIds?: readonly string[] | null;
}): boolean {
  if (!input.companyId || input.companyId !== INSTAGRAM_BYO_PILOT_COMPANY_ID) return false;

  const direct = input.roles.find((role) => role.company_id === input.companyId);
  if (direct?.role === 'seller') return false;
  if (direct && DIRECT_VIEW_ROLES.includes(direct.role)) return true;

  const parentCompanyId = input.parentCompanyId ?? '';
  if (
    parentCompanyId &&
    input.roles.some((role) => isParentOperator(role, parentCompanyId, ['super_admin', 'system_admin']))
  ) {
    return true;
  }

  const assigned = input.partnerAssignedCompanyIds;
  if (!assigned || !assigned.includes(input.companyId)) return false;

  return input.roles.some((role) => isParentOperator(role, role.company_id, ['partner']));
}
