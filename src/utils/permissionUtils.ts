// =====================================================
// UTILITÁRIOS DE CONTROLE DE PERMISSÕES CRÍTICAS
// =====================================================

import { UserRole } from '../types/user';

/**
 * Permissões críticas que requerem controle rigoroso
 * Estas permissões só devem ser visíveis para Super Admin/Admin da empresa pai
 */
export const CRITICAL_PERMISSIONS = [
  'companies',           // Gestão de Empresas
  'impersonate',        // Impersonar Usuários
  'create_companies',   // Criar Empresas
  'manage_companies',   // Gerenciar Empresas
  'view_all_companies', // Ver Todas Empresas
  'delete_companies',   // Deletar Empresas
  'edit_companies',     // Editar Empresas
] as const;

/**
 * Verifica se o usuário pode acessar permissões críticas
 * 
 * REGRAS IMPLEMENTADAS:
 * - Empresa Pai: Apenas Super Admin e Admin
 * - Empresas Filhas: NUNCA
 * - Parceiros: NUNCA (implementação conservadora)
 */
export const canAccessCriticalPermissions = (
  companyType?: string,
  userRole?: UserRole | string,
  isSuperAdmin?: boolean
): boolean => {
  // Se não temos informações suficientes, negar acesso
  if (!companyType || !userRole) {
    return false;
  }

  // Empresas Filhas: NUNCA podem acessar permissões críticas
  if (companyType === 'client') {
    return false;
  }

  // Empresa Pai: Apenas Super Admin e Admin
  if (companyType === 'parent') {
    return isSuperAdmin || ['super_admin', 'admin'].includes(userRole);
  }

  // Parceiros: NUNCA (implementação conservadora)
  // TODO: Definir regra específica para parceiros no futuro
  if (userRole === 'partner') {
    return false;
  }

  // Por padrão, negar acesso
  return false;
};

/**
 * Filtra permissões removendo as críticas quando não autorizado
 */
export const filterCriticalPermissions = <T extends Record<string, any>>(
  permissions: T,
  companyType?: string,
  userRole?: UserRole | string,
  isSuperAdmin?: boolean
): T => {
  // Se pode acessar permissões críticas, retornar todas
  if (canAccessCriticalPermissions(companyType, userRole, isSuperAdmin)) {
    return permissions;
  }

  // Criar cópia das permissões sem as críticas
  const filteredPermissions = { ...permissions };
  
  CRITICAL_PERMISSIONS.forEach(criticalPermission => {
    if (criticalPermission in filteredPermissions) {
      delete filteredPermissions[criticalPermission];
    }
  });

  return filteredPermissions;
};

/**
 * Filtra lista de chaves de permissões removendo as críticas
 */
export const filterCriticalPermissionKeys = (
  permissionKeys: string[],
  companyType?: string,
  userRole?: UserRole | string,
  isSuperAdmin?: boolean
): string[] => {
  // Se pode acessar permissões críticas, retornar todas
  if (canAccessCriticalPermissions(companyType, userRole, isSuperAdmin)) {
    return permissionKeys;
  }

  // Filtrar permissões críticas
  return permissionKeys.filter(
    permission => !CRITICAL_PERMISSIONS.includes(permission as any)
  );
};

/**
 * Verifica se uma permissão específica é crítica
 */
export const isCriticalPermission = (permission: string): boolean => {
  return CRITICAL_PERMISSIONS.includes(permission as any);
};

/**
 * Obtém lista de permissões críticas (para debug/logs)
 */
export const getCriticalPermissions = (): readonly string[] => {
  return CRITICAL_PERMISSIONS;
};

/**
 * Valida se um usuário pode conceder uma permissão específica
 */
export const canGrantPermission = (
  permission: string,
  companyType?: string,
  userRole?: UserRole | string,
  isSuperAdmin?: boolean
): boolean => {
  // Se não é permissão crítica, pode conceder
  if (!isCriticalPermission(permission)) {
    return true;
  }

  // Se é permissão crítica, verificar autorização
  return canAccessCriticalPermissions(companyType, userRole, isSuperAdmin);
};

/**
 * Obtém mensagem explicativa sobre restrição de permissões
 */
export const getCriticalPermissionMessage = (
  companyType?: string
): string => {
  if (companyType === 'client') {
    return 'Empresas filhas não têm acesso a permissões de gestão de empresas e impersonação.';
  }
  
  if (companyType === 'parent') {
    return 'Apenas Super Administradores e Administradores podem acessar permissões críticas.';
  }
  
  return 'Acesso a permissões críticas restrito por política de segurança.';
};

/**
 * Log de auditoria para tentativas de acesso a permissões críticas
 */
export const logCriticalPermissionAccess = (
  action: 'granted' | 'denied',
  permission: string,
  userRole?: string,
  companyType?: string
): void => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[CRITICAL_PERMISSION] ${action.toUpperCase()}: ${permission}`, {
      userRole,
      companyType,
      timestamp: new Date().toISOString()
    });
  }
};
