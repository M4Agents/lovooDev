// =====================================================
// SISTEMA DE MÓDULOS DINÂMICOS - REGISTRO E GESTÃO
// =====================================================

import { supabase } from '../lib/supabase';
import { 
  AppModule, 
  ModulePermissionDefinition, 
  ModuleCategory,
  DynamicPermissions,
  UserPermissions,
  MigrationResult
} from '../types/user';

// =====================================================
// MÓDULOS DO SISTEMA (CORE)
// =====================================================

const getCoreModules = (): AppModule[] => {
  const now = new Date().toISOString();
  
  return [
    {
      id: 'dashboard',
      name: 'Dashboard',
      description: 'Painel principal com métricas e visão geral',
      version: '1.0.0',
      category: 'core',
      permissions: [
        {
          id: 'access',
          name: 'Acessar Dashboard',
          description: 'Permite visualizar o dashboard principal',
          category: 'access',
          dataType: 'boolean',
          defaultValue: true
        },
        {
          id: 'view_metrics',
          name: 'Ver Métricas',
          description: 'Permite visualizar métricas e KPIs',
          category: 'action',
          dataType: 'boolean',
          defaultValue: true
        }
      ],
      isActive: true,
      isSystem: true,
      created_at: now,
      updated_at: now,
      icon: '📊',
      color: '#3B82F6',
      order: 1
    },
    {
      id: 'leads',
      name: 'Gestão de Leads',
      description: 'Sistema completo de gestão de leads e prospects',
      version: '1.0.0',
      category: 'sales',
      permissions: [
        {
          id: 'access',
          name: 'Acessar Leads',
          description: 'Permite acessar o módulo de leads',
          category: 'access',
          dataType: 'boolean',
          defaultValue: true
        },
        {
          id: 'create',
          name: 'Criar Leads',
          description: 'Permite criar novos leads',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'edit_own',
          name: 'Editar Próprios Leads',
          description: 'Permite editar leads próprios',
          category: 'action',
          dataType: 'boolean',
          defaultValue: true
        },
        {
          id: 'edit_team',
          name: 'Editar Leads da Equipe',
          description: 'Permite editar leads de outros membros da equipe',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'edit_all',
          name: 'Editar Todos os Leads',
          description: 'Permite editar qualquer lead da empresa',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'delete',
          name: 'Excluir Leads',
          description: 'Permite excluir leads',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'export',
          name: 'Exportar Leads',
          description: 'Permite exportar dados de leads',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'import',
          name: 'Importar Leads',
          description: 'Permite importar leads em massa',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'max_per_month',
          name: 'Limite de Leads por Mês',
          description: 'Máximo de leads que pode gerenciar por mês',
          category: 'limit',
          dataType: 'number',
          defaultValue: 1000,
          validation: { min: 0, max: 10000 }
        }
      ],
      isActive: true,
      isSystem: true,
      created_at: now,
      updated_at: now,
      icon: '🎯',
      color: '#10B981',
      order: 2
    },
    {
      id: 'chat',
      name: 'Chat e Comunicação',
      description: 'Sistema de chat e comunicação com leads',
      version: '1.0.0',
      category: 'sales',
      permissions: [
        {
          id: 'access',
          name: 'Acessar Chat',
          description: 'Permite acessar o sistema de chat',
          category: 'access',
          dataType: 'boolean',
          defaultValue: true
        },
        {
          id: 'chat_own_leads',
          name: 'Chat com Próprios Leads',
          description: 'Permite conversar com próprios leads',
          category: 'action',
          dataType: 'boolean',
          defaultValue: true
        },
        {
          id: 'chat_all_leads',
          name: 'Chat com Todos os Leads',
          description: 'Permite conversar com qualquer lead',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'use_templates',
          name: 'Usar Templates',
          description: 'Permite usar templates de mensagem',
          category: 'action',
          dataType: 'boolean',
          defaultValue: true
        },
        {
          id: 'bulk_messaging',
          name: 'Mensagens em Massa',
          description: 'Permite enviar mensagens para múltiplos leads',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false
        }
      ],
      dependencies: ['leads'],
      isActive: true,
      isSystem: true,
      created_at: now,
      updated_at: now,
      icon: '💬',
      color: '#8B5CF6',
      order: 3
    },
    {
      id: 'analytics',
      name: 'Analytics e Relatórios',
      description: 'Sistema de análise e relatórios avançados',
      version: '1.0.0',
      category: 'analytics',
      permissions: [
        {
          id: 'access',
          name: 'Acessar Analytics',
          description: 'Permite acessar módulo de analytics',
          category: 'access',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'view_own',
          name: 'Ver Próprios Dados',
          description: 'Permite ver analytics dos próprios leads',
          category: 'action',
          dataType: 'boolean',
          defaultValue: true
        },
        {
          id: 'view_team',
          name: 'Ver Dados da Equipe',
          description: 'Permite ver analytics da equipe',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'view_company',
          name: 'Ver Dados da Empresa',
          description: 'Permite ver analytics de toda a empresa',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'export_reports',
          name: 'Exportar Relatórios',
          description: 'Permite exportar relatórios',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'max_exports_per_day',
          name: 'Limite de Exportações por Dia',
          description: 'Máximo de relatórios que pode exportar por dia',
          category: 'limit',
          dataType: 'number',
          defaultValue: 10,
          validation: { min: 0, max: 100 }
        }
      ],
      dependencies: ['leads'],
      isActive: true,
      isSystem: true,
      created_at: now,
      updated_at: now,
      icon: '📈',
      color: '#F59E0B',
      order: 4
    }
  ];
};

// =====================================================
// MÓDULOS FUTUROS (EXEMPLOS)
// =====================================================

const getFutureModules = (): AppModule[] => {
  const now = new Date().toISOString();
  
  return [
    {
      id: 'email_marketing',
      name: 'Email Marketing',
      description: 'Sistema de campanhas de email marketing',
      version: '1.0.0',
      category: 'marketing',
      permissions: [
        {
          id: 'access',
          name: 'Acessar Email Marketing',
          description: 'Permite acessar o módulo de email marketing',
          category: 'access',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'create_campaign',
          name: 'Criar Campanhas',
          description: 'Permite criar campanhas de email',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'send_campaign',
          name: 'Enviar Campanhas',
          description: 'Permite enviar campanhas criadas',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false,
          requiredFor: ['create_campaign']
        },
        {
          id: 'max_emails_per_day',
          name: 'Limite de Emails por Dia',
          description: 'Máximo de emails que pode enviar por dia',
          category: 'limit',
          dataType: 'number',
          defaultValue: 1000,
          validation: { min: 0, max: 10000 }
        }
      ],
      dependencies: ['leads', 'analytics'],
      isActive: false, // Módulo futuro - desabilitado
      isSystem: false,
      created_at: now,
      updated_at: now,
      icon: '📧',
      color: '#EF4444',
      order: 10
    },
    {
      id: 'sms_campaigns',
      name: 'SMS Campaigns',
      description: 'Sistema de campanhas SMS',
      version: '1.0.0',
      category: 'marketing',
      permissions: [
        {
          id: 'access',
          name: 'Acessar SMS',
          description: 'Permite acessar campanhas SMS',
          category: 'access',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'send_sms',
          name: 'Enviar SMS',
          description: 'Permite enviar SMS para leads',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'max_sms_per_day',
          name: 'Limite de SMS por Dia',
          description: 'Máximo de SMS que pode enviar por dia',
          category: 'limit',
          dataType: 'number',
          defaultValue: 100,
          validation: { min: 0, max: 1000 }
        }
      ],
      dependencies: ['leads'],
      isActive: false, // Módulo futuro - desabilitado
      isSystem: false,
      created_at: now,
      updated_at: now,
      icon: '📱',
      color: '#06B6D4',
      order: 11
    },
    {
      id: 'automations',
      name: 'Automações',
      description: 'Sistema de automação de processos',
      version: '1.0.0',
      category: 'automation',
      permissions: [
        {
          id: 'access',
          name: 'Acessar Automações',
          description: 'Permite acessar sistema de automações',
          category: 'access',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'create_automation',
          name: 'Criar Automações',
          description: 'Permite criar fluxos de automação',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false
        },
        {
          id: 'manage_triggers',
          name: 'Gerenciar Triggers',
          description: 'Permite configurar gatilhos de automação',
          category: 'action',
          dataType: 'boolean',
          defaultValue: false
        }
      ],
      dependencies: ['leads', 'chat'],
      isActive: false, // Módulo futuro - desabilitado
      isSystem: false,
      created_at: now,
      updated_at: now,
      icon: '🤖',
      color: '#8B5CF6',
      order: 12
    }
  ];
};

// =====================================================
// REGISTRY SINGLETON
// =====================================================

class ModuleRegistry {
  private static instance: ModuleRegistry;
  private modules = new Map<string, AppModule>();
  private initialized = false;

  private constructor() {}

  public static getInstance(): ModuleRegistry {
    if (!ModuleRegistry.instance) {
      ModuleRegistry.instance = new ModuleRegistry();
    }
    return ModuleRegistry.instance;
  }

  /**
   * Inicializar registry com módulos do sistema
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('ModuleRegistry: Initializing...');
    
    // Carregar módulos do sistema
    const coreModules = getCoreModules();
    const futureModules = getFutureModules();
    
    [...coreModules, ...futureModules].forEach(module => {
      this.modules.set(module.id, module);
    });

    // Carregar módulos personalizados do banco (se existir tabela)
    try {
      const { data: customModules } = await supabase
        .from('app_modules')
        .select('*')
        .eq('is_active', true);
      
      if (customModules) {
        customModules.forEach((moduleData: any) => {
          const module: AppModule = {
            id: moduleData.id,
            name: moduleData.name,
            description: moduleData.description,
            version: moduleData.version,
            category: moduleData.category,
            permissions: moduleData.permissions_schema,
            dependencies: moduleData.dependencies || [],
            isActive: moduleData.is_active,
            isSystem: moduleData.is_system,
            created_at: moduleData.created_at,
            updated_at: moduleData.updated_at,
            icon: moduleData.icon,
            color: moduleData.color,
            order: moduleData.order
          };
          
          this.modules.set(module.id, module);
        });
      }
    } catch (error) {
      console.warn('ModuleRegistry: Could not load custom modules (table may not exist):', error);
      // Continuar com módulos do sistema apenas
    }

    this.initialized = true;
    console.log('ModuleRegistry: Initialized with', this.modules.size, 'modules');
  }

  /**
   * Registrar novo módulo
   */
  public registerModule(module: AppModule): void {
    console.log('ModuleRegistry: Registering module:', module.id);
    this.modules.set(module.id, module);
  }

  /**
   * Obter módulo por ID
   */
  public getModule(moduleId: string): AppModule | undefined {
    return this.modules.get(moduleId);
  }

  /**
   * Obter todos os módulos
   */
  public getAllModules(): AppModule[] {
    return Array.from(this.modules.values()).sort((a, b) => (a.order || 999) - (b.order || 999));
  }

  /**
   * Obter módulos ativos
   */
  public getActiveModules(): AppModule[] {
    return this.getAllModules().filter(module => module.isActive);
  }

  /**
   * Obter módulos por categoria
   */
  public getModulesByCategory(category: ModuleCategory): AppModule[] {
    return this.getAllModules().filter(module => module.category === category);
  }

  /**
   * Obter todas as permissões disponíveis
   */
  public getAllPermissions(): ModulePermissionDefinition[] {
    const permissions: ModulePermissionDefinition[] = [];
    
    this.getAllModules().forEach(module => {
      module.permissions.forEach(permission => {
        permissions.push({
          ...permission,
          id: `${module.id}.${permission.id}` // Namespace com ID do módulo
        });
      });
    });
    
    return permissions;
  }

  /**
   * Validar dependências de módulo
   */
  public validateDependencies(moduleId: string): { valid: boolean; missing: string[] } {
    const module = this.getModule(moduleId);
    if (!module || !module.dependencies) {
      return { valid: true, missing: [] };
    }

    const missing = module.dependencies.filter(depId => {
      const depModule = this.getModule(depId);
      return !depModule || !depModule.isActive;
    });

    return {
      valid: missing.length === 0,
      missing
    };
  }
}

// =====================================================
// FUNÇÕES PÚBLICAS
// =====================================================

/**
 * Obter instância do registry (inicializar se necessário)
 */
export const getModuleRegistry = async (): Promise<ModuleRegistry> => {
  const registry = ModuleRegistry.getInstance();
  await registry.initialize();
  return registry;
};

/**
 * Converter permissões atuais para formato dinâmico
 */
export const convertToModulePermissions = (
  currentPermissions: UserPermissions
): DynamicPermissions => {
  const modulePermissions: Record<string, any> = {};
  
  // Mapear permissões atuais para módulos
  const moduleMapping = {
    'dashboard': {
      access: currentPermissions.dashboard,
      actions: {
        view_metrics: currentPermissions.dashboard
      }
    },
    'leads': {
      access: currentPermissions.leads,
      actions: {
        create: currentPermissions.create_leads || false,
        edit_own: currentPermissions.edit_own_leads || currentPermissions.leads,
        edit_team: currentPermissions.edit_team_leads || false,
        edit_all: currentPermissions.edit_all_leads || false,
        delete: currentPermissions.delete_leads || false,
        export: currentPermissions.export_leads || false,
        import: currentPermissions.import_leads || false
      },
      limits: {
        max_per_month: currentPermissions.max_leads_per_month || 1000
      }
    },
    'chat': {
      access: currentPermissions.chat,
      actions: {
        chat_own_leads: currentPermissions.chat_own_leads || currentPermissions.chat,
        chat_all_leads: currentPermissions.chat_all_leads || false,
        use_templates: currentPermissions.chat_templates || currentPermissions.chat,
        bulk_messaging: currentPermissions.bulk_messaging || false
      }
    },
    'analytics': {
      access: currentPermissions.analytics,
      actions: {
        view_own: currentPermissions.view_own_analytics || currentPermissions.analytics,
        view_team: currentPermissions.view_team_analytics || false,
        view_company: currentPermissions.view_company_analytics || false,
        export_reports: currentPermissions.export_reports || false
      },
      limits: {
        max_exports_per_day: currentPermissions.max_exports_per_day || 10
      }
    }
  };

  // Adicionar módulos futuros como desabilitados
  const futureModules = ['email_marketing', 'sms_campaigns', 'automations'];
  futureModules.forEach(moduleId => {
    modulePermissions[moduleId] = {
      access: false,
      actions: {},
      limits: {}
    };
  });

  Object.entries(moduleMapping).forEach(([moduleId, permissions]) => {
    modulePermissions[moduleId] = permissions;
  });

  return {
    modules: modulePermissions,
    global: currentPermissions,
    version: '1.0.0',
    lastUpdated: new Date().toISOString()
  };
};

/**
 * Aplicar migração automática quando novo módulo é adicionado
 */
export const migrateUsersForNewModule = async (
  moduleId: string,
  defaultEnabled: boolean = false
): Promise<MigrationResult> => {
  console.log(`ModuleRegistry: Migrating users for new module: ${moduleId}`);
  
  try {
    // Buscar todos os usuários
    const { data: users, error } = await supabase
      .from('company_users')
      .select('id, permissions');
    
    if (error) {
      throw new Error(`Erro ao buscar usuários: ${error.message}`);
    }

    let affectedUsers = 0;
    const errors: string[] = [];

    // Atualizar cada usuário
    for (const user of users || []) {
      try {
        const currentPermissions = user.permissions as UserPermissions;
        
        // Adicionar permissões do novo módulo (desabilitadas por padrão)
        const updatedPermissions = {
          ...currentPermissions,
          [moduleId]: defaultEnabled
        };

        const { error: updateError } = await supabase
          .from('company_users')
          .update({ permissions: updatedPermissions })
          .eq('id', user.id);

        if (updateError) {
          errors.push(`Usuário ${user.id}: ${updateError.message}`);
        } else {
          affectedUsers++;
        }
      } catch (userError) {
        errors.push(`Usuário ${user.id}: ${userError}`);
      }
    }

    const result: MigrationResult = {
      success: errors.length === 0,
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      affectedUsers,
      errors: errors.length > 0 ? errors : undefined
    };

    console.log('ModuleRegistry: Migration completed:', result);
    return result;

  } catch (error) {
    console.error('ModuleRegistry: Migration failed:', error);
    return {
      success: false,
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      affectedUsers: 0,
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
};

// Inicializar registry automaticamente
getModuleRegistry().catch(console.error);
