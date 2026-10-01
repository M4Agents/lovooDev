import type { CompanyUser, UserRole } from '../types/user';

/** Ignora pontuação para "Vox2you Santana" ficar antes de "Vox2you | Tatuapé". */
export function companySortKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

const PLATFORM_ROLES: UserRole[] = ['super_admin', 'system_admin'];

type RoleWithCompany = Pick<CompanyUser, 'role' | 'companies' | 'company'>;

/**
 * super_admin e system_admin da empresa pai recebem a lista global de empresas
 * e entram nas unidades pelo fluxo de impersonação. O seletor é só para
 * membership direto em mais de uma empresa.
 */
export function hasPlatformWideCompanyAccess(roles: RoleWithCompany[]): boolean {
  return roles.some((role) => {
    if (!PLATFORM_ROLES.includes(role.role)) return false;
    const companyType = role.companies?.company_type ?? role.company?.company_type;
    return companyType === 'parent';
  });
}

export function shouldShowCompanySwitcher(input: {
  rolesLoaded: boolean;
  isImpersonating: boolean;
  hasPlatformWideAccess: boolean;
  companyCount: number;
}): boolean {
  return (
    input.rolesLoaded &&
    !input.isImpersonating &&
    !input.hasPlatformWideAccess &&
    input.companyCount > 1
  );
}

/**
 * Rotas cujo identificador pertence à empresa anterior.
 * Retorna o caminho seguro, ou null para permanecer na tela atual.
 */
export function pathAfterCompanySwitch(pathname: string, search: string): string | null {
  if (/^\/automations\/[^/]+\/edit\/?$/.test(pathname)) return '/automations';
  if (/^\/analytics\/[^/]+\/?$/.test(pathname)) return '/dashboard';
  if (/^\/advanced-analytics\/[^/]+\/?$/.test(pathname)) return '/dashboard';
  if (pathname === '/chat' && search.length > 0) return '/chat';
  return null;
}
