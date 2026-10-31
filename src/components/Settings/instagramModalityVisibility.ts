import type { CompanyUser, UserRole } from '../../types/user';

const DIRECT_SWITCH_ROLES: UserRole[] = ['admin', 'super_admin', 'system_admin'];

type RoleRow = Pick<CompanyUser, 'company_id' | 'role'>;

/**
 * Só a apresentação do botão. A API exige o mesmo papel direto único.
 * Empresa pai, partner, manager e seller não confirmam a troca.
 */
export function canSwitchInstagramModality(input: {
  companyId?: string | null;
  roles: RoleRow[];
}): boolean {
  if (!input.companyId) return false;
  const direct = input.roles.filter((role) => role.company_id === input.companyId);
  if (direct.length !== 1) return false;
  return DIRECT_SWITCH_ROLES.includes(direct[0].role);
}
