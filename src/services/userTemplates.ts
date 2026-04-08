// =====================================================
// SISTEMA DE TEMPLATES DE USUÁRIO — CAMADA DE PRESETS DE UI
//
// Responsabilidade: oferecer configurações de permissão prontas
// (modelos recomendados) para preenchimento no UserModal.
//
// NÃO é fonte de verdade de RBAC — essa função cabe a userProfiles.ts.
// Presets não definem comportamento de segurança; apenas sugerem
// combinações de permissões para uso como ponto de partida.
//
// CRUD de templates personalizados desativado: tabela user_templates
// não existe no banco. Apenas system templates (em memória) estão ativos.
//
// Permissões presentes nos presets:
//   - Permissões ATIVAS: verificadas em gates reais do sistema.
//   - Permissões FUTURAS (opcionais, sufixo _own/_team/_all, granulares):
//     tipo definido em UserPermissions, mas SEM enforcement atual.
//     Serão ativadas no ciclo de permissões granulares.
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
      visibleToChildCompanies: false,
      created_at: now,
      updated_at: now,
      tags: ['sistema', 'super_admin', 'total', 'empresa_pai']
    },
    {
      id: 'system_admin_saas',
      name: 'Administrador de Sistema',
      description: 'Visão global operacional - sem acesso a páginas SaaS (empresas, planos)',
      baseRole: 'system_admin',
      customPermissions: {
        ...getDefaultPermissions('system_admin')
      },
      companyId: '',
      createdBy: 'system',
      isActive: true,
      isSystem: true,
      visibleToChildCompanies: false,
      created_at: now,
      updated_at: now,
      tags: ['sistema', 'system_admin', 'operação', 'empresa_pai']
    },
    // PERFIS PARA VENDEDORES
    {
      id: 'system_vendedor_basico',
      name: 'SDR',
      description: 'Prospecção e qualificação de leads - foco em geração e primeiro contato',
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
      visibleToChildCompanies: true,
      created_at: now,
      updated_at: now,
      tags: ['SDR', 'prospecção', 'qualificação']
    },
    {
      id: 'system_vendedor_senior',
      name: 'Closer',
      description: 'Negociação e fechamento de deals - foco em conversão e autonomia operacional',
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
      visibleToChildCompanies: true,
      created_at: now,
      updated_at: now,
      tags: ['Closer', 'negociação', 'fechamento']
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
    'system_admin': 5,
    'super_admin': 6
  };
  
  return roleHierarchy[template.baseRole] <= roleHierarchy[targetRole];
};

/**
 * ID interno do template sintetizado para o role partner.
 * Derivado de system_admin_empresa com baseRole sobrescrito para 'partner'.
 * Não aparece em getSystemTemplates() — apenas em getDefaultTemplateForRole
 * e getRecommendedTemplates quando role === 'partner'.
 */
export const PARTNER_DEFAULT_TEMPLATE_ID = 'system_parceiro_adm_empresa';

/**
 * Mapeamento fixo: role → ID do template padrão do sistema.
 * Para partner: sintetizado em runtime (não está no catálogo permanente).
 */
const DEFAULT_TEMPLATE_IDS: Partial<Record<UserRole, string>> = {
  super_admin:  'system_super_admin',
  system_admin: 'system_admin_saas',
  admin:        'system_admin_empresa',
  manager:      'system_gerente_vendas',
  seller:       'system_vendedor_basico',
};

/**
 * Retorna o template padrão para um dado role.
 *
 * Para roles não-partner: busca no catálogo pelo ID fixo.
 * Para partner: sintetiza em runtime um objeto derivado de system_admin_empresa
 *   com baseRole: 'partner'. Esse objeto não faz parte de getSystemTemplates()
 *   e não é persistido. Garante que o guard `selectedTemplate.baseRole === role`
 *   seja satisfeito sem criar um novo preset fixo no catálogo.
 */
export const getDefaultTemplateForRole = (role: UserRole): UserTemplate | undefined => {
  const now = new Date().toISOString();

  if (role === 'partner') {
    const adminEmpresa = getSystemTemplates().find(t => t.id === 'system_admin_empresa');
    if (!adminEmpresa) return undefined;
    return {
      ...adminEmpresa,
      id: PARTNER_DEFAULT_TEMPLATE_ID,
      name: 'Administrador da Empresa',
      baseRole: 'partner',
      companyId: '',
      created_at: now,
      updated_at: now,
    };
  }

  const templateId = DEFAULT_TEMPLATE_IDS[role];
  if (!templateId) return undefined;
  return getSystemTemplates().find(t => t.id === templateId);
};

/**
 * Obter templates recomendados para um role
 */
export const getRecommendedTemplates = async (
  companyId: string, 
  role: UserRole
): Promise<UserTemplate[]> => {
  const allTemplates = await getCompanyTemplates(companyId);
  
  let result = allTemplates.filter(template =>
    validateTemplateForRole(template, role)
  );

  // Para partner: incluir o template sintetizado como primeira opção
  // (system_admin_empresa com baseRole 'partner' não está em getSystemTemplates)
  if (role === 'partner') {
    const partnerDefault = getDefaultTemplateForRole('partner');
    if (partnerDefault && !result.find(t => t.id === partnerDefault.id)) {
      result = [{ ...partnerDefault, companyId }, ...result];
    }
  }

  return result.sort((a, b) => {
    // Priorizar templates do sistema
    if (a.isSystem && !b.isSystem) return -1;
    if (!a.isSystem && b.isSystem) return 1;
    return a.name.localeCompare(b.name);
  });
};
