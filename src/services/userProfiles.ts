// =====================================================
// SISTEMA UNIFICADO DE PERFIS DE USUÁRIO
// =====================================================

import { UserProfile, UserRole, UserTemplate, UserPermissions } from '../types/user';
import { getDefaultPermissions, getAssignableRoles } from './userApi';
import { getCompanyTemplates } from './userTemplates';

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
// CONVERSÃO DE TEMPLATES EM PERFIS
// =====================================================

/**
 * Converter UserTemplate em UserProfile
 */
export const templateToProfile = (template: UserTemplate): UserProfile => {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    permissions: {
      // Começar com permissões padrão do role base
      ...getDefaultPermissions(template.baseRole),
      // Aplicar customizações do template
      ...template.customPermissions
    } as UserPermissions,
    isSystem: template.isSystem,
    isEditable: !template.isSystem, // Templates do sistema não são editáveis
    companyId: template.companyId,
    createdBy: template.createdBy,
    created_at: template.created_at,
    updated_at: template.updated_at,
    baseRole: template.baseRole,
    usage_count: template.usage_count,
    last_used: template.last_used,
    tags: template.tags,
    isActive: template.isActive
  };
};

/**
 * Converter UserProfile em UserTemplate (para compatibilidade)
 */
export const profileToTemplate = (profile: UserProfile): UserTemplate | null => {
  // Apenas perfis personalizados podem ser convertidos em templates
  if (profile.isSystem || !profile.baseRole || !profile.companyId) {
    return null;
  }

  // Extrair apenas as permissões customizadas (diferentes do padrão)
  const defaultPermissions = getDefaultPermissions(profile.baseRole);
  const customPermissions: Partial<UserPermissions> = {};
  
  Object.entries(profile.permissions).forEach(([key, value]) => {
    const defaultValue = defaultPermissions[key as keyof UserPermissions];
    if (value !== defaultValue) {
      (customPermissions as any)[key] = value;
    }
  });

  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    baseRole: profile.baseRole,
    customPermissions,
    companyId: profile.companyId,
    createdBy: profile.createdBy || '',
    isActive: profile.isActive ?? true,
    isSystem: profile.isSystem,
    created_at: profile.created_at || new Date().toISOString(),
    updated_at: profile.updated_at || new Date().toISOString(),
    usage_count: profile.usage_count,
    last_used: profile.last_used,
    tags: profile.tags
  };
};

// =====================================================
// FUNÇÃO PRINCIPAL - OBTER TODOS OS PERFIS
// =====================================================

/**
 * Obter todos os perfis disponíveis (sistema + personalizados)
 */
export const getAllUserProfiles = async (companyId: string): Promise<UserProfile[]> => {
  try {
    console.log('UserProfiles: Fetching all profiles for company:', companyId);
    
    // Perfis do sistema (ex-roles)
    const systemProfiles = getSystemProfiles();
    
    // Perfis personalizados (ex-templates convertidos)
    let customProfiles: UserProfile[] = [];
    
    try {
      const templates = await getCompanyTemplates(companyId);
      customProfiles = templates
        .filter(template => template.isActive !== false) // Apenas templates ativos
        .map(templateToProfile);
    } catch (error) {
      console.warn('UserProfiles: Could not load custom profiles:', error);
      // Continuar apenas com perfis do sistema
    }
    
    // Combinar todos os perfis
    const allProfiles = [...systemProfiles, ...customProfiles];
    
    console.log('UserProfiles: Found profiles:', {
      system: systemProfiles.length,
      custom: customProfiles.length,
      total: allProfiles.length
    });
    
    return allProfiles;
    
  } catch (error) {
    console.error('UserProfiles: Error in getAllUserProfiles:', error);
    // Fallback: retornar apenas perfis do sistema
    return getSystemProfiles();
  }
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
