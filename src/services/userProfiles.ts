// =====================================================
// SISTEMA UNIFICADO DE PERFIS DE USUÁRIO
// =====================================================

import { UserProfile, UserRole } from '../types/user';
import { getDefaultPermissions, getAssignableRoles } from './userApi';

// =====================================================
// PERFIS DO SISTEMA (EX-ROLES)
// =====================================================

export const getSystemProfiles = (): UserProfile[] => {
  const systemProfiles: UserProfile[] = [
    {
      id: 'system_super_admin',
      name: 'Super Administrador',
      description: 'Acesso total ao sistema - todas as funcionalidades',
      permissions: getDefaultPermissions('super_admin'),
      isSystem: true,
      isEditable: false,
      legacyRole: 'super_admin',
      tags: ['sistema', 'super_admin', 'total']
    },
    {
      id: 'system_system_admin',
      name: 'Administrador de Sistema',
      description: 'Visão global operacional - sem acesso a páginas SaaS (empresas, planos)',
      permissions: getDefaultPermissions('system_admin'),
      isSystem: true,
      isEditable: false,
      legacyRole: 'system_admin',
      tags: ['sistema', 'system_admin', 'operação']
    },
    {
      id: 'system_admin',
      name: 'Administrador',
      description: 'Gerencia empresa e usuários - sem acesso financeiro',
      permissions: getDefaultPermissions('admin'),
      isSystem: true,
      isEditable: false,
      legacyRole: 'admin',
      tags: ['sistema', 'admin', 'gestão']
    },
    {
      id: 'system_partner',
      name: 'Parceiro',
      description: 'Gerencia próprias contas e subcontas',
      permissions: getDefaultPermissions('partner'),
      isSystem: true,
      isEditable: false,
      legacyRole: 'partner',
      tags: ['sistema', 'partner', 'contas']
    },
    {
      id: 'system_manager',
      name: 'Gerente',
      description: 'Gestão de leads, vendas e relatórios da equipe',
      permissions: getDefaultPermissions('manager'),
      isSystem: true,
      isEditable: false,
      legacyRole: 'manager',
      tags: ['sistema', 'manager', 'equipe']
    },
    {
      id: 'system_seller',
      name: 'Vendedor',
      description: 'Gestão de leads próprios e chat básico',
      permissions: getDefaultPermissions('seller'),
      isSystem: true,
      isEditable: false,
      legacyRole: 'seller',
      tags: ['sistema', 'seller', 'vendas']
    }
  ];

  return systemProfiles;
};

// =====================================================
// FUNÇÃO PRINCIPAL - OBTER TODOS OS PERFIS
// =====================================================

/**
 * Obter todos os perfis disponíveis.
 *
 * Retorna apenas os 6 perfis oficiais do sistema (fonte canônica de RBAC).
 * Presets de UI (userTemplates.ts) são uma camada separada — não são misturados aqui.
 *
 * @param _companyId  Mantido para compatibilidade com assinatura anterior.
 */
export const getAllUserProfiles = async (_companyId: string): Promise<UserProfile[]> => {
  return getSystemProfiles();
};

/**
 * Obter perfil por ID
 */
export const getUserProfileById = async (profileId: string, companyId: string): Promise<UserProfile | null> => {
  try {
    const allProfiles = await getAllUserProfiles(companyId);
    return allProfiles.find(profile => profile.id === profileId) || null;
  } catch (error) {
    console.error('UserProfiles: Error getting profile by ID:', error);
    return null;
  }
};

/**
 * Obter perfis compatíveis com tipo de empresa e, opcionalmente,
 * filtrados pela hierarquia do caller (via getAssignableRoles).
 *
 * @param companyId   ID da empresa (para buscar perfis personalizados)
 * @param companyType Tipo da empresa (parent | client)
 * @param callerRole  Role do usuário que vai criar/editar — filtra perfis acima do tier do caller.
 *                    Quando omitido, retorna todos os perfis compatíveis com o tipo de empresa.
 */
export const getProfilesForCompanyType = async (
  companyId: string,
  companyType: 'parent' | 'client',
  callerRole?: UserRole
): Promise<UserProfile[]> => {
  const allProfiles = await getAllUserProfiles(companyId);

  // Roles atribuíveis pelo caller (espelha a lógica de getAvailableRoles no UserModal)
  const assignableRoles: UserRole[] | null = callerRole
    ? getAssignableRoles(callerRole, companyType)
    : null;

  return allProfiles.filter(profile => {
    const role: UserRole | undefined = profile.isSystem ? profile.legacyRole : profile.baseRole;

    // Se não conseguimos determinar o role, incluir (permissivo)
    if (!role) return true;

    // 1. Filtro por tipo de empresa
    const validForType =
      companyType === 'parent'
        ? (['super_admin', 'system_admin', 'admin', 'partner'] as UserRole[]).includes(role)
        : (['admin', 'manager', 'seller'] as UserRole[]).includes(role);

    if (!validForType) return false;

    // 2. Filtro por hierarquia do caller (quando callerRole foi fornecido)
    if (assignableRoles !== null) {
      return assignableRoles.includes(role);
    }

    return true;
  });
};

// =====================================================
// UTILITÁRIOS DE COMPATIBILIDADE
// =====================================================

/**
 * Converter perfil em role para compatibilidade com sistema atual
 */
export const getProfileRole = (profile: UserProfile): UserRole => {
  // Para perfis do sistema, usar o role legado
  if (profile.isSystem && profile.legacyRole) {
    return profile.legacyRole;
  }
  
  // Para perfis personalizados, usar o role base
  if (!profile.isSystem && profile.baseRole) {
    return profile.baseRole;
  }
  
  // Fallback: tentar inferir do ID
  if (profile.id.includes('super_admin')) return 'super_admin';
  if (profile.id.includes('admin')) return 'admin';
  if (profile.id.includes('partner')) return 'partner';
  if (profile.id.includes('manager')) return 'manager';
  
  // Fallback final
  return 'seller';
};

/**
 * Verificar se perfil é válido para tipo de empresa
 */
export const validateProfileForCompany = (
  profile: UserProfile, 
  companyType: 'parent' | 'client'
): boolean => {
  const role = getProfileRole(profile);
  
  if (companyType === 'parent') {
    return ['super_admin', 'system_admin', 'admin', 'partner'].includes(role);
  } else {
    return ['admin', 'manager', 'seller'].includes(role);
  }
};
