// =====================================================
// TIPOS PARA SISTEMA DE USUÁRIOS
// =====================================================

export type UserRole = 
  | 'super_admin'  // Super usuário M4 Digital
  | 'admin'        // Admin M4 Digital ou Cliente
  | 'partner'      // Partner M4 Digital
  | 'manager'      // Gerente Cliente
  | 'seller';      // Vendedor Cliente

export interface UserPermissions {
  // Módulos principais
  dashboard: boolean;
  leads: boolean;
  chat: boolean;
  analytics: boolean;
  settings: boolean;
  companies: boolean;
  users: boolean;
  financial: boolean;
  
  // Ações específicas
  create_users: boolean;
  edit_users: boolean;
  delete_users: boolean;
  impersonate: boolean;
  view_all_leads: boolean;
  edit_all_leads: boolean;
  view_financial: boolean;
  edit_financial: boolean;
  
  // Limitações
  max_companies?: number;
  max_users?: number;
  restricted_companies?: string[];
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
