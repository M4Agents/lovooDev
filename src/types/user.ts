// =====================================================
// TIPOS PARA SISTEMA DE USUÁRIOS
// =====================================================

export type UserRole = 
  | 'super_admin'  // Super usuário M4 Digital
  | 'support'      // Suporte M4 Digital (novo perfil)
  | 'admin'        // Admin M4 Digital ou Cliente
  | 'partner'      // Partner M4 Digital
  | 'manager'      // Gerente Cliente
  | 'seller';      // Vendedor Cliente

export interface UserPermissions {
  // Módulos principais (MANTIDOS - compatibilidade 100%)
  dashboard: boolean;
  leads: boolean;
  chat: boolean;
  analytics: boolean;
  settings: boolean;
  companies: boolean;
  users: boolean;
  financial: boolean;
  
  // Ações específicas (MANTIDAS - compatibilidade 100%)
  create_users: boolean;
  edit_users: boolean;
  delete_users: boolean;
  impersonate: boolean;
  view_all_leads: boolean;
  edit_all_leads: boolean;
  view_financial: boolean;
  edit_financial: boolean;
  
  // Limitações (MANTIDAS - compatibilidade 100%)
  max_companies?: number;
  max_users?: number;
  restricted_companies?: string[];
  
  // NOVOS MÓDULOS (opcionais - não quebram sistema atual)
  email_marketing?: boolean;
  sms_campaigns?: boolean;
  automations?: boolean;
  reports?: boolean;
  integrations?: boolean;
  api_access?: boolean;
  webhooks?: boolean;
  
  // NOVAS AÇÕES GRANULARES (opcionais)
  create_leads?: boolean;
  edit_own_leads?: boolean;
  edit_team_leads?: boolean;
  delete_leads?: boolean;
  export_leads?: boolean;
  import_leads?: boolean;
  
  // CHAT GRANULAR (opcional)
  chat_all_leads?: boolean;
  chat_own_leads?: boolean;
  chat_templates?: boolean;
  bulk_messaging?: boolean;
  
  // ANALYTICS GRANULAR (opcional)
  view_own_analytics?: boolean;
  view_team_analytics?: boolean;
  view_company_analytics?: boolean;
  export_reports?: boolean;
  
  // CONFIGURAÇÕES GRANULARES (opcional)
  edit_company_settings?: boolean;
  edit_integrations?: boolean;
  edit_webhooks?: boolean;
  
  // LIMITAÇÕES AVANÇADAS (opcionais)
  max_leads_per_month?: number;
  max_exports_per_day?: number;
  allowed_lead_sources?: string[];
  restricted_hours?: { start: string; end: string };
  allowed_ip_addresses?: string[];
}

export interface CompanyUser {
  id: string;
  company_id: string;
  user_id: string;
  role: UserRole;
  permissions: UserPermissions;
  created_by?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  
  // 🔧 NOVO: Campo para foto de perfil
  profile_picture_url?: string | null;
  
  // Dados relacionados (joins)
  company?: {
    id: string;
    name: string;
    company_type: 'parent' | 'client';
  };
  companies?: {
    id: string;
    name: string;
    company_type: 'parent' | 'client';
  };
  user?: {
    id: string;
    email: string;
  };
  
  // Campos para exibição de nome
  display_name?: string;  // Nome real do usuário extraído do metadata
  email?: string;         // Email do usuário para exibição
  
  // Propriedades auxiliares para compatibilidade
  _isRealUser?: boolean;
  _email?: string;
}

export interface CreateUserRequest {
  companyId: string;
  email: string;
  role: UserRole;
  permissions?: Partial<UserPermissions>;
  sendInvite?: boolean;
}

export interface UpdateUserRequest {
  id: string;
  role?: UserRole;
  permissions?: Partial<UserPermissions>;
  is_active?: boolean;
  profile_picture_url?: string | null; // 🔧 NOVO: Campo para foto de perfil
}

export interface UserInvitation {
  id: string;
  company_id: string;
  email: string;
  role: UserRole;
  invited_by: string;
  expires_at: string;
  accepted_at?: string;
  created_at: string;
}

// =====================================================
// TIPOS PARA COMPATIBILIDADE COM SISTEMA ATUAL
// =====================================================

export interface LegacyUserInfo {
  hasLegacyRole: boolean;
  legacyRole?: 'super_admin' | 'admin';
  newRoles?: CompanyUser[];
  primaryRole?: UserRole;
  canImpersonate: boolean;
}

// =====================================================
// TIPOS PARA VALIDAÇÃO DE PERMISSÕES
// =====================================================

export interface PermissionCheck {
  hasPermission: boolean;
  reason?: string;
  requiredRole?: UserRole;
  currentRole?: UserRole;
}

export interface ImpersonationValidation {
  canImpersonate: boolean;
  targetCompanyId: string;
  reason?: string;
  method: 'legacy' | 'new_system' | 'hybrid';
}

// =====================================================
// NOVOS TIPOS - SISTEMA UNIFICADO DE PERFIS DE USUÁRIO
// =====================================================

// NOVO: Tipo unificado que substitui UserTemplate + Roles
export interface UserProfile {
  id: string;
  name: string;
  description: string;
  permissions: UserPermissions;
  isSystem: boolean;        // Perfil do sistema (ex-role) ou personalizado (ex-template)
  isEditable: boolean;      // Pode ser editado pelo usuário
  
  // Para perfis personalizados (ex-templates)
  companyId?: string;
  createdBy?: string;
  created_at?: string;
  updated_at?: string;
  
  // Para compatibilidade com sistema atual
  baseRole?: UserRole;      // Role base (para perfis personalizados)
  legacyRole?: UserRole;    // Role original (para perfis do sistema)
  
  // Metadados
  usage_count?: number;
  last_used?: string;
  tags?: string[];
  isActive?: boolean;
}

// MANTIDO: UserTemplate para compatibilidade (será deprecado gradualmente)
export interface UserTemplate {
  id: string;
  name: string;
  description: string;
  baseRole: UserRole;
  customPermissions: Partial<UserPermissions>;
  companyId: string;
  createdBy: string;
  isActive: boolean;
  isSystem: boolean; // Templates do sistema (não podem ser editados)
  created_at: string;
  updated_at: string;
  
  // NOVO: Controle de visibilidade para empresas filhas
  visibleToChildCompanies?: boolean; // Se deve aparecer para empresas filhas
  
  // Metadados
  usage_count?: number;
  last_used?: string;
  tags?: string[];
}

export interface CreateTemplateRequest {
  name: string;
  description: string;
  baseRole: UserRole;
  customPermissions: Partial<UserPermissions>;
  companyId: string;
  tags?: string[];
}

export interface UpdateTemplateRequest {
  id: string;
  name?: string;
  description?: string;
  customPermissions?: Partial<UserPermissions>;
  isActive?: boolean;
  tags?: string[];
}

// =====================================================
// TIPOS PARA MÓDULOS DINÂMICOS
// =====================================================

export type ModuleCategory = 'core' | 'marketing' | 'sales' | 'analytics' | 'integration' | 'automation';

export interface AppModule {
  id: string;
  name: string;
  description: string;
  version: string;
  category: ModuleCategory;
  permissions: ModulePermissionDefinition[];
  dependencies?: string[];
  isActive: boolean;
  isSystem: boolean; // Módulos do sistema (não podem ser desabilitados)
  created_at: string;
  updated_at: string;
  
  // Metadados
  icon?: string;
  color?: string;
  order?: number;
}

export interface ModulePermissionDefinition {
  id: string;
  name: string;
  description: string;
  category: 'access' | 'action' | 'limit';
  dataType: 'boolean' | 'number' | 'string' | 'array';
  defaultValue: boolean | number | string | string[];
  requiredFor?: string[]; // Outras permissões que dependem desta
  
  // Validação
  validation?: {
    min?: number;
    max?: number;
    options?: string[];
    pattern?: string;
  };
}

export interface ModulePermissions {
  access: boolean;
  actions: Record<string, boolean | number | string>;
  limits?: Record<string, number | string | boolean>;
}

export interface DynamicPermissions {
  // Permissões por módulo
  modules: Record<string, ModulePermissions>;
  
  // Permissões globais (mantém compatibilidade)
  global: UserPermissions;
  
  // Metadados
  version: string;
  lastUpdated: string;
  migratedFrom?: string;
}

// =====================================================
// TIPOS PARA MIGRAÇÃO E VERSIONAMENTO
// =====================================================

export interface PermissionMigration {
  fromVersion: string;
  toVersion: string;
  description: string;
  moduleId?: string;
  
  apply(permissions: DynamicPermissions): Promise<DynamicPermissions>;
  rollback?(permissions: DynamicPermissions): Promise<DynamicPermissions>;
}

export interface MigrationResult {
  success: boolean;
  fromVersion: string;
  toVersion: string;
  affectedUsers: number;
  errors?: string[];
  warnings?: string[];
}

// =====================================================
// TIPOS PARA INTERFACE AVANÇADA
// =====================================================

export interface PermissionGroup {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  icon?: string;
  color?: string;
}

export interface PermissionPreset {
  id: string;
  name: string;
  description: string;
  role: UserRole;
  permissions: Partial<UserPermissions>;
  isRecommended?: boolean;
}

export interface UserCreationWizardData {
  // Etapa 1: Dados básicos
  basicInfo: {
    email: string;
    displayName?: string;
    phone?: string;
    department?: string;
    position?: string;
    startDate?: string;
  };
  
  // Etapa 2: Role e template
  roleInfo: {
    role: UserRole;
    templateId?: string;
    useCustomPermissions: boolean;
  };
  
  // Etapa 3: Permissões personalizadas
  customPermissions?: Partial<UserPermissions>;
  
  // Etapa 4: Limitações
  limitations?: {
    maxLeadsPerMonth?: number;
    allowedSources?: string[];
    restrictedHours?: { start: string; end: string };
    expirationDate?: string;
  };
  
  // Etapa 5: Convite
  inviteSettings: {
    sendInvite: boolean;
    inviteMethod: 'email' | 'whatsapp' | 'link';
    customMessage?: string;
    requirePasswordChange: boolean;
  };
}
