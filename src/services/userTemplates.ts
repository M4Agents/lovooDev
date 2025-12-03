// =====================================================
// SISTEMA DE TEMPLATES DE USUÁRIO - COMPATÍVEL 100%
// =====================================================

import { supabase } from '../lib/supabase';
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
      // Empresa filha: NÃO pode ver super_admin e admin puro
      return !['super_admin', 'admin'].includes(template.baseRole);
    }
  });
};

// =====================================================
// CRUD DE TEMPLATES PERSONALIZADOS
// =====================================================

/**
 * Buscar todos os templates disponíveis para uma empresa
 */
export const getCompanyTemplates = async (
  companyId: string, 
  companyType?: 'parent' | 'client'
): Promise<UserTemplate[]> => {
  try {
    console.log('UserTemplates: Fetching templates for company:', companyId);
    
    // Buscar templates personalizados da empresa
    const { data: customTemplates, error } = await supabase
      .from('user_templates')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('name');
    
    if (error) {
      console.error('UserTemplates: Error fetching custom templates:', error);
      // Continuar mesmo com erro - retornar apenas templates do sistema
    }
    
    // Combinar templates do sistema com personalizados (COM FILTRAGEM)
    const systemTemplates = getSystemTemplates(companyType).map(template => ({
      ...template,
      companyId
    }));
    
    const allTemplates = [
      ...systemTemplates,
      ...(customTemplates || [])
    ];
    
    console.log('UserTemplates: Found templates:', allTemplates.length);
    return allTemplates;
    
  } catch (error) {
    console.error('UserTemplates: Error in getCompanyTemplates:', error);
    // Fallback: retornar apenas templates do sistema (COM FILTRAGEM)
    return getSystemTemplates(companyType).map(template => ({
      ...template,
      companyId
    }));
  }
};

/**
 * Buscar template específico por ID
 */
export const getTemplateById = async (templateId: string, companyId: string): Promise<UserTemplate | null> => {
  try {
    // Verificar se é template do sistema
    const systemTemplate = getSystemTemplates().find(t => t.id === templateId);
    if (systemTemplate) {
      return { ...systemTemplate, companyId };
    }
    
    // Buscar template personalizado
    const { data, error } = await supabase
      .from('user_templates')
      .select('*')
      .eq('id', templateId)
      .eq('company_id', companyId)
      .single();
    
    if (error || !data) {
      console.error('UserTemplates: Template not found:', templateId);
      return null;
    }
    
    return data;
    
  } catch (error) {
    console.error('UserTemplates: Error in getTemplateById:', error);
    return null;
  }
};

/**
 * Criar novo template personalizado
 */
export const createUserTemplate = async (request: CreateTemplateRequest): Promise<UserTemplate> => {
  try {
    console.log('UserTemplates: Creating template:', request.name);
    
    const templateData = {
      name: request.name,
      description: request.description,
      base_role: request.baseRole,
      custom_permissions: request.customPermissions,
      company_id: request.companyId,
      created_by: (await supabase.auth.getUser()).data.user?.id,
      is_active: true,
      is_system: false,
      tags: request.tags || []
    };
    
    const { data, error } = await supabase
      .from('user_templates')
      .insert([templateData])
      .select()
      .single();
    
    if (error) {
      throw new Error(`Erro ao criar template: ${error.message}`);
    }
    
    console.log('UserTemplates: Template created successfully:', data.id);
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      baseRole: data.base_role,
      customPermissions: data.custom_permissions,
      companyId: data.company_id,
      createdBy: data.created_by,
      isActive: data.is_active,
      isSystem: data.is_system,
      created_at: data.created_at,
      updated_at: data.updated_at,
      tags: data.tags
    };
    
  } catch (error) {
    console.error('UserTemplates: Error creating template:', error);
    throw error;
  }
};

/**
 * Atualizar template existente
 */
export const updateUserTemplate = async (request: UpdateTemplateRequest): Promise<UserTemplate> => {
  try {
    console.log('UserTemplates: Updating template:', request.id);
    
    // Verificar se não é template do sistema
    const systemTemplate = getSystemTemplates().find(t => t.id === request.id);
    if (systemTemplate) {
      throw new Error('Templates do sistema não podem ser editados');
    }
    
    const updateData: any = {
      updated_at: new Date().toISOString()
    };
    
    if (request.name !== undefined) updateData.name = request.name;
    if (request.description !== undefined) updateData.description = request.description;
    if (request.customPermissions !== undefined) updateData.custom_permissions = request.customPermissions;
    if (request.isActive !== undefined) updateData.is_active = request.isActive;
    if (request.tags !== undefined) updateData.tags = request.tags;
    
    const { data, error } = await supabase
      .from('user_templates')
      .update(updateData)
      .eq('id', request.id)
      .select()
      .single();
    
    if (error) {
      throw new Error(`Erro ao atualizar template: ${error.message}`);
    }
    
    console.log('UserTemplates: Template updated successfully');
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      baseRole: data.base_role,
      customPermissions: data.custom_permissions,
      companyId: data.company_id,
      createdBy: data.created_by,
      isActive: data.is_active,
      isSystem: data.is_system,
      created_at: data.created_at,
      updated_at: data.updated_at,
      tags: data.tags
    };
    
  } catch (error) {
    console.error('UserTemplates: Error updating template:', error);
    throw error;
  }
};

/**
 * Desativar template (soft delete)
 */
export const deactivateTemplate = async (templateId: string): Promise<void> => {
  try {
    console.log('UserTemplates: Deactivating template:', templateId);
    
    // Verificar se não é template do sistema
    const systemTemplate = getSystemTemplates().find(t => t.id === templateId);
    if (systemTemplate) {
      throw new Error('Templates do sistema não podem ser desativados');
    }
    
    const { error } = await supabase
      .from('user_templates')
      .update({ 
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', templateId);
    
    if (error) {
      throw new Error(`Erro ao desativar template: ${error.message}`);
    }
    
    console.log('UserTemplates: Template deactivated successfully');
    
  } catch (error) {
    console.error('UserTemplates: Error deactivating template:', error);
    throw error;
  }
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
