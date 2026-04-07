// =====================================================
// SISTEMA DE TEMPLATES DE USUÁRIO
// CRUD de templates personalizados desativado: tabela user_templates
// não existe no banco. Apenas system templates (em memória) estão ativos.
// =====================================================

import { 
  UserTemplate, 
  CreateTemplateRequest, 
  UpdateTemplateRequest, 
  UserRole, 
  UserPermissions 
} from '../types/user';
import { getDefaultPermissions } from './userApi';

// =====================================================
// TEMPLATES DO SISTEMA (PREDEFINIDOS)
// =====================================================

export const getSystemTemplates = (companyType?: 'parent' | 'client'): UserTemplate[] => {
  const now = new Date().toISOString();
  
  const allTemplates: UserTemplate[] = [
    // PERFIS DE ALTA HIERARQUIA (EMPRESA PAI)
    {
      id: 'system_super_admin',
      name: 'Super Administrador',
      description: 'Acesso total ao sistema - todas as funcionalidades e empresas',
      baseRole: 'super_admin',
      customPermissions: {
        ...getDefaultPermissions('super_admin'),
        // Todas as permissões possíveis
        impersonate: true,
        companies: true,
        users: true,
        financial: true,
        analytics: true,
        settings: true
      },
      companyId: '',
      createdBy: 'system',
      isActive: true,
      isSystem: true,
      visibleToChildCompanies: false, // APENAS empresa pai
      created_at: now,
      updated_at: now,
      tags: ['sistema', 'super_admin', 'total', 'empresa_pai']
    },
    {
      id: 'system_admin',
      name: 'Administrador',
      description: 'Gerencia empresas filhas e usuários - sem acesso financeiro',
      baseRole: 'admin',
      customPermissions: {
        ...getDefaultPermissions('admin'),
        // Permissões de administração geral
        create_users: true,
        edit_users: true,
        companies: true,
        settings: true,
        analytics: true
      },
      companyId: '',
      createdBy: 'system',
      isActive: true,
      isSystem: true,
      visibleToChildCompanies: false, // APENAS empresa pai
      created_at: now,
      updated_at: now,
      tags: ['sistema', 'admin', 'gestão', 'empresa_pai']
    },
    
    // PERFIS PARA VENDEDORES
    {
      id: 'system_vendedor_basico',
      name: 'Vendedor Básico',
      description: 'Perfil para vendedores iniciantes com permissões essenciais',
      baseRole: 'seller',
      customPermissions: {
        ...getDefaultPermissions('seller'),
        chat_own_leads: true,
        create_leads: true,
        edit_own_leads: true,
        max_leads_per_month: 500
      },
      companyId: '',
      createdBy: 'system',
      isActive: true,
      isSystem: true,
      visibleToChildCompanies: true, // VISÍVEL para empresas filhas
      created_at: now,
      updated_at: now,
      tags: ['vendedor', 'básico', 'iniciante']
    },
    {
      id: 'system_vendedor_senior',
      name: 'Vendedor Sênior',
      description: 'Perfil para vendedores experientes com mais autonomia',
      baseRole: 'seller',
      customPermissions: {
        ...getDefaultPermissions('seller'),
        analytics: true,
        chat_own_leads: true,
        chat_templates: true,
        create_leads: true,
        edit_own_leads: true,
        edit_team_leads: true,
        export_leads: true,
        view_own_analytics: true,
        max_leads_per_month: 1000,
        max_exports_per_day: 10
      },
      companyId: '',
      createdBy: 'system',
      isActive: true,
      isSystem: true,
      visibleToChildCompanies: true, // VISÍVEL para empresas filhas
      created_at: now,
      updated_at: now,
      tags: ['vendedor', 'sênior', 'experiente']
    },
    {
      id: 'system_gerente_vendas',
      name: 'Gerente de Vendas',
      description: 'Perfil para gerentes com gestão de equipe',
      baseRole: 'manager',
      customPermissions: {
        ...getDefaultPermissions('manager'),
        chat_all_leads: true,
        chat_templates: true,
        bulk_messaging: true,
        create_leads: true,
        edit_own_leads: true,
        edit_team_leads: true,
        edit_all_leads: true,
        export_leads: true,
        view_team_analytics: true,
        export_reports: true,
        max_leads_per_month: 2000,
        max_exports_per_day: 50
      },
      companyId: '',
      createdBy: 'system',
      isActive: true,
      isSystem: true,
      visibleToChildCompanies: true, // VISÍVEL para empresas filhas
      created_at: now,
      updated_at: now,
      tags: ['gerente', 'gestão', 'equipe']
    },
    {
      id: 'system_admin_empresa',
      name: 'Administrador da Empresa',
      description: 'Perfil para administradores com controle total da empresa',
      baseRole: 'admin',
      customPermissions: {
        ...getDefaultPermissions('admin'),
        // Todas as permissões de empresa
        edit_company_settings: true,
        edit_integrations: true,
        edit_webhooks: true,
        chat_all_leads: true,
        bulk_messaging: true,
        create_leads: true,
        edit_all_leads: true,
        delete_leads: true,
        export_leads: true,
        import_leads: true,
        view_company_analytics: true,
        export_reports: true
      },
      companyId: '',
      createdBy: 'system',
      isActive: true,
      isSystem: true,
      visibleToChildCompanies: true, // VISÍVEL para empresas filhas ✅
      created_at: now,
      updated_at: now,
      tags: ['admin', 'empresa', 'controle total']
    },
    {
      id: 'system_parceiro_limitado',
      name: 'Parceiro Limitado',
      description: 'Perfil para parceiros com acesso restrito',
      baseRole: 'partner',
      customPermissions: {
        ...getDefaultPermissions('partner'),
        view_own_analytics: true,
        export_reports: true,
        chat_own_leads: true,
        max_leads_per_month: 300,
        max_exports_per_day: 5,
        allowed_lead_sources: ['facebook', 'google']
      },
      companyId: '',
      createdBy: 'system',
      isActive: true,
      isSystem: true,
      visibleToChildCompanies: false, // APENAS empresa pai
      created_at: now,
      updated_at: now,
      tags: ['parceiro', 'limitado', 'restrito']
    }
  ];

  // FILTRAR POR TIPO DE EMPRESA (SEGURANÇA)
  if (!companyType) {
    // Se não especificado, retornar todos (compatibilidade)
    return allTemplates;
  }

  return allTemplates.filter(template => {
    if (companyType === 'parent') {
      // Empresa pai: pode ver todos os perfis
      return true;
    } else {
      // Empresa filha: usar configuração dinâmica de visibilidade
      // Se não configurado, usar fallback baseado no baseRole (compatibilidade)
      if (template.visibleToChildCompanies !== undefined) {
        return template.visibleToChildCompanies;
      }
      
      // Fallback para templates sem configuração (compatibilidade)
      return !['super_admin', 'admin', 'partner'].includes(template.baseRole);
    }
  });
};

// =====================================================
// TEMPLATES DISPONÍVEIS (apenas sistema — sem DB)
// =====================================================

/**
 * Retorna os templates disponíveis para uma empresa.
 * Apenas system templates em memória; CRUD personalizado desativado.
 */
export const getCompanyTemplates = async (
  companyId: string,
  companyType?: 'parent' | 'client'
): Promise<UserTemplate[]> => {
  return getSystemTemplates(companyType).map(template => ({
    ...template,
    companyId
  }));
};

/**
 * Buscar template específico por ID (apenas system templates).
 */
export const getTemplateById = async (templateId: string, companyId: string): Promise<UserTemplate | null> => {
  const systemTemplate = getSystemTemplates().find(t => t.id === templateId);
  return systemTemplate ? { ...systemTemplate, companyId } : null;
};

/**
 * Criação de templates personalizados desativada.
 * A tabela user_templates não existe no banco.
 */
export const createUserTemplate = async (_request: CreateTemplateRequest): Promise<UserTemplate> => {
  throw new Error('Templates personalizados não estão disponíveis nesta versão.');
};

/**
 * Atualização de templates personalizados desativada.
 */
export const updateUserTemplate = async (_request: UpdateTemplateRequest): Promise<UserTemplate> => {
  throw new Error('Templates personalizados não estão disponíveis nesta versão.');
};

/**
 * Desativação de templates personalizados desativada.
 */
export const deactivateTemplate = async (_templateId: string): Promise<void> => {
  throw new Error('Templates personalizados não estão disponíveis nesta versão.');
};

// =====================================================
// UTILITÁRIOS
// =====================================================

/**
 * Aplicar template a permissões de usuário
 */
export const applyTemplateToPermissions = (
  template: UserTemplate,
  basePermissions?: Partial<UserPermissions>
): UserPermissions => {
  // Começar com permissões padrão do role base
  const defaultPermissions = getDefaultPermissions(template.baseRole);
  
  // Aplicar permissões base se fornecidas
  const mergedBase = basePermissions ? { ...defaultPermissions, ...basePermissions } : defaultPermissions;
  
  // Aplicar customizações do template
  return { ...mergedBase, ...template.customPermissions } as UserPermissions;
};

/**
 * Validar se template pode ser usado para um role específico
 */
export const validateTemplateForRole = (template: UserTemplate, targetRole: UserRole): boolean => {
  // Template deve ter role base compatível ou inferior
  const roleHierarchy: Record<UserRole, number> = {
    'seller': 1,
    'manager': 2,
    'partner': 3,
    'admin': 4,
    'super_admin': 5
  };
  
  return roleHierarchy[template.baseRole] <= roleHierarchy[targetRole];
};

/**
 * Obter templates recomendados para um role
 */
export const getRecommendedTemplates = async (
  companyId: string, 
  role: UserRole
): Promise<UserTemplate[]> => {
  const allTemplates = await getCompanyTemplates(companyId);
  
  return allTemplates.filter(template => 
    validateTemplateForRole(template, role)
  ).sort((a, b) => {
    // Priorizar templates do sistema
    if (a.isSystem && !b.isSystem) return -1;
    if (!a.isSystem && b.isSystem) return 1;
    
    // Depois por nome
    return a.name.localeCompare(b.name);
  });
};
