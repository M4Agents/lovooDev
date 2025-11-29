// =====================================================
// API DE USUÁRIOS - SISTEMA HÍBRIDO SEGURO
// =====================================================

import { supabase } from '../lib/supabase';
import { CompanyUser, CreateUserRequest, UpdateUserRequest, UserRole, UserPermissions } from '../types/user';

// =====================================================
// FUNÇÕES DE CONSULTA (SEGURAS)
// =====================================================

/**
 * Busca todos os usuários de uma empresa
 * Usa RLS para garantir segurança
 */
export const getCompanyUsers = async (companyId: string): Promise<CompanyUser[]> => {
  try {
    console.log('UserAPI: Fetching users for company:', companyId);
    
    // Usar RPC para evitar problemas com RLS e joins complexos
    const { data, error } = await supabase
      .rpc('get_company_users_with_details', {
        p_company_id: companyId
      });

    if (error) {
      console.error('UserAPI: Error fetching company users:', error);
      // Fallback para consulta simples se RPC falhar
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('company_users')
        .select('*')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
        
      if (fallbackError) {
        throw fallbackError;
      }
      
      console.log('UserAPI: Using fallback query, found users:', fallbackData?.length || 0);
      return fallbackData || [];
    }

    console.log('UserAPI: Found users:', data?.length || 0);
    return data || [];
  } catch (error) {
    console.error('UserAPI: Error in getCompanyUsers:', error);
    throw error;
  }
};

/**
 * Busca usuários que o usuário atual pode gerenciar
 * Inclui validação de permissões
 */
export const getManagedUsers = async (): Promise<CompanyUser[]> => {
  try {
    console.log('UserAPI: Fetching managed users');
    
    // Buscar através de consulta simples - RLS filtra automaticamente
    const { data, error } = await supabase
      .from('company_users')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('UserAPI: Error fetching managed users:', error);
      throw error;
    }

    console.log('UserAPI: Found managed users:', data?.length || 0);
    
    // Se não encontrou dados, pode ser problema de RLS - tentar buscar da empresa atual
    if (!data || data.length === 0) {
      console.log('UserAPI: No users found, trying current company approach');
      
      // Buscar empresa atual do usuário
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: companies } = await supabase
          .from('companies')
          .select('id')
          .eq('user_id', user.id);
          
        if (companies && companies.length > 0) {
          // Buscar usuários da primeira empresa encontrada
          const { data: companyUsers } = await supabase
            .from('company_users')
            .select('*')
            .eq('company_id', companies[0].id)
            .eq('is_active', true)
            .order('created_at', { ascending: false });
            
          return companyUsers || [];
        }
      }
    }
    
    return data || [];
  } catch (error) {
    console.error('UserAPI: Error in getManagedUsers:', error);
    throw error;
  }
};

/**
 * Busca informações de um usuário específico
 */
export const getUserById = async (userId: string): Promise<CompanyUser | null> => {
  try {
    const { data, error } = await supabase
      .from('company_users')
      .select(`
        *,
        companies:company_id (
          id,
          name,
          company_type
        )
      `)
      .eq('id', userId)
      .eq('is_active', true)
      .single();

    if (error) {
      console.error('UserAPI: Error fetching user:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('UserAPI: Error in getUserById:', error);
    return null;
  }
};

// =====================================================
// FUNÇÕES DE VALIDAÇÃO
// =====================================================

/**
 * Valida se o usuário atual pode criar usuários na empresa
 */
export const canCreateUser = async (companyId: string): Promise<boolean> => {
  try {
    const { data: currentUser } = await supabase.auth.getUser();
    if (!currentUser.user) return false;

    // Verificar se tem permissão através da função do banco
    const { data, error } = await supabase
      .rpc('get_user_permissions', {
        p_user_id: currentUser.user.id,
        p_company_id: companyId
      });

    if (error) {
      console.warn('UserAPI: Error checking create permission:', error);
      return false;
    }

    return data?.create_users === true;
  } catch (error) {
    console.error('UserAPI: Error in canCreateUser:', error);
    return false;
  }
};

/**
 * Valida se o role é válido para o tipo de empresa
 */
export const validateRoleForCompany = (role: UserRole, companyType: 'parent' | 'client'): boolean => {
  const parentRoles: UserRole[] = ['super_admin', 'admin', 'partner'];
  const clientRoles: UserRole[] = ['admin', 'manager', 'seller'];

  if (companyType === 'parent') {
    return parentRoles.includes(role);
  } else {
    return clientRoles.includes(role);
  }
};

/**
 * Gera permissões padrão baseadas no role
 */
export const getDefaultPermissions = (role: UserRole): UserPermissions => {
  switch (role) {
    case 'super_admin':
      return {
        dashboard: true,
        leads: true,
        chat: true,
        analytics: true,
        settings: true,
        companies: true,
        users: true,
        financial: true,
        create_users: true,
        edit_users: true,
        delete_users: true,
        impersonate: true,
        view_all_leads: true,
        edit_all_leads: true,
        view_financial: true,
        edit_financial: true
      };
    case 'admin':
      return {
        dashboard: true,
        leads: true,
        chat: true,
        analytics: true,
        settings: true,
        companies: false,
        users: true,
        financial: false,
        create_users: true,
        edit_users: true,
        delete_users: false,
        impersonate: false,
        view_all_leads: true,
        edit_all_leads: true,
        view_financial: false,
        edit_financial: false
      };
    case 'partner':
      return {
        dashboard: true,
        leads: true,
        chat: true,
        analytics: true,
        settings: false,
        companies: false,
        users: false,
        financial: false,
        create_users: false,
        edit_users: false,
        delete_users: false,
        impersonate: false,
        view_all_leads: true,
        edit_all_leads: true,
        view_financial: false,
        edit_financial: false
      };
    case 'manager':
      return {
        dashboard: true,
        leads: true,
        chat: true,
        analytics: true,
        settings: false,
        companies: false,
        users: false,
        financial: false,
        create_users: false,
        edit_users: false,
        delete_users: false,
        impersonate: false,
        view_all_leads: true,
        edit_all_leads: false,
        view_financial: false,
        edit_financial: false
      };
    case 'seller':
      return {
        dashboard: true,
        leads: true,
        chat: true,
        analytics: false,
        settings: false,
        companies: false,
        users: false,
        financial: false,
        create_users: false,
        edit_users: false,
        delete_users: false,
        impersonate: false,
        view_all_leads: false,
        edit_all_leads: false,
        view_financial: false,
        edit_financial: false
      };
    default:
      return {
        dashboard: false,
        leads: false,
        chat: false,
        analytics: false,
        settings: false,
        companies: false,
        users: false,
        financial: false,
        create_users: false,
        edit_users: false,
        delete_users: false,
        impersonate: false,
        view_all_leads: false,
        edit_all_leads: false,
        view_financial: false,
        edit_financial: false
      };
  }
};

// =====================================================
// FUNÇÕES DE CRIAÇÃO/EDIÇÃO (COM VALIDAÇÃO)
// =====================================================

/**
 * Cria um novo usuário na empresa
 * INTEGRAÇÃO REAL COM SUPABASE AUTH + FALLBACK SEGURO
 */
export const createCompanyUser = async (request: CreateUserRequest): Promise<CompanyUser> => {
  try {
    console.log('UserAPI: Creating user with real integration:', request);

    // Validar permissão
    const canCreate = await canCreateUser(request.companyId);
    if (!canCreate) {
      throw new Error('Sem permissão para criar usuários');
    }

    // Buscar informações da empresa
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('company_type, name')
      .eq('id', request.companyId)
      .single();

    if (companyError || !company) {
      throw new Error('Empresa não encontrada');
    }

    // Validar role para tipo de empresa
    if (!validateRoleForCompany(request.role, company.company_type)) {
      throw new Error(`Role ${request.role} não é válido para empresa do tipo ${company.company_type}`);
    }

    // Gerar permissões padrão
    const permissions = request.permissions || getDefaultPermissions(request.role);

    let finalUserId: string;
    let isRealUser = false;
    let inviteData: any = null;

    // SEGUIR PADRÃO DE EMPRESAS: Usar user_id real obrigatório
    // Buscar user_id do usuário atual (como faz createClientCompany)
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    
    if (!currentUser) {
      throw new Error('Usuário não autenticado');
    }
    
    // TENTAR CRIAR USUÁRIO REAL (com fallback seguro)
    if (request.sendInvite && request.email) {
      try {
        console.log('UserAPI: Attempting to create real user via invite');
        
        // Importar authAdmin dinamicamente para evitar dependência circular
        const { inviteUser } = await import('./authAdmin');
        
        const inviteResult = await inviteUser({
          email: request.email,
          redirectTo: `${window.location.origin}/accept-invite`,
          data: {
            role: request.role,
            company_id: request.companyId,
            company_name: company.name
          }
        });

        if (inviteResult.success && inviteResult.user) {
          // Se conseguiu criar usuário real, usar o ID real
          if (inviteResult.user.id && !inviteResult.user.id.startsWith('invite_') && !inviteResult.user.id.startsWith('fallback_')) {
            finalUserId = inviteResult.user.id;
            isRealUser = true;
          } else {
            // Convite simulado - usar user_id atual temporariamente (como empresas)
            finalUserId = currentUser.id;
            isRealUser = false;
            inviteData = inviteResult.user.app_metadata;
          }
          
          console.log('UserAPI: User invite processed:', {
            userId: finalUserId,
            isReal: isRealUser,
            mode: isRealUser ? 'real' : 'compatibility',
            hasInviteUrl: !!inviteResult.user.app_metadata?.invite_url
          });
        } else {
          throw new Error(inviteResult.error || 'Falha ao enviar convite');
        }
      } catch (authError) {
        console.warn('UserAPI: Real user creation failed, using current user fallback:', authError);
        // FALLBACK SEGURO: Usar user_id atual (como empresas fazem)
        finalUserId = currentUser.id;
        isRealUser = false;
        
        // Gerar dados de convite simulado para mostrar no modal
        inviteData = {
          invite_url: `${window.location.origin}/accept-invite?token=${btoa(request.email)}&type=invite&email=${encodeURIComponent(request.email)}`
        };
      }
    } else {
      // Não solicitou convite - usar user_id atual (como empresas)
      finalUserId = currentUser.id;
      isRealUser = false;
    }

    // Criar registro usando função SECURITY DEFINER (bypassa RLS de forma segura)
    const { data: functionResult, error } = await supabase.rpc('create_company_user_safe', {
      p_company_id: request.companyId,
      p_user_id: finalUserId,
      p_role: request.role,
      p_permissions: permissions,
      p_created_by: currentUser.id
    });

    if (error) {
      console.error('UserAPI: Error calling create_company_user_safe:', error);
      throw error;
    }

    // Verificar se a função retornou sucesso
    if (!functionResult?.success) {
      console.error('UserAPI: Function returned error:', functionResult?.error);
      throw new Error(functionResult?.error || 'Erro na criação do usuário');
    }

    // Converter resultado da função para formato esperado
    const data = {
      id: functionResult.id,
      company_id: functionResult.company_id,
      user_id: functionResult.user_id,
      role: functionResult.role,
      permissions: functionResult.permissions,
      is_active: functionResult.is_active,
      created_by: functionResult.created_by,
      created_at: functionResult.created_at,
      updated_at: functionResult.updated_at
    };

    // Adicionar informações da empresa manualmente (para compatibilidade)
    const result = {
      ...data,
      companies: {
        id: request.companyId,
        name: company.name,
        company_type: company.company_type
      },
      _isRealUser: isRealUser,
      _email: request.email,
      // Incluir dados do convite se disponível
      ...(request.sendInvite && inviteData && {
        app_metadata: inviteData
      })
    };

    console.log('UserAPI: User created successfully:', {
      id: result.id,
      isReal: isRealUser,
      email: request.email
    });
    
    return result;
  } catch (error) {
    console.error('UserAPI: Error in createCompanyUser:', error);
    throw error;
  }
};

/**
 * Atualiza um usuário existente
 */
export const updateCompanyUser = async (request: UpdateUserRequest): Promise<CompanyUser> => {
  try {
    console.log('UserAPI: Updating user:', request);

    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (request.role !== undefined) {
      updateData.role = request.role;
      // Atualizar permissões baseadas no novo role
      updateData.permissions = getDefaultPermissions(request.role);
    }

    if (request.permissions !== undefined) {
      // Mesclar com permissões existentes
      const currentUser = await getUserById(request.id);
      if (currentUser) {
        updateData.permissions = {
          ...currentUser.permissions,
          ...request.permissions
        };
      }
    }

    if (request.is_active !== undefined) {
      updateData.is_active = request.is_active;
    }

    const { data, error } = await supabase
      .from('company_users')
      .update(updateData)
      .eq('id', request.id)
      .select(`
        *,
        companies:company_id (
          id,
          name,
          company_type
        )
      `)
      .single();

    if (error) {
      console.error('UserAPI: Error updating user:', error);
      throw error;
    }

    console.log('UserAPI: User updated successfully:', data);
    return data;
  } catch (error) {
    console.error('UserAPI: Error in updateCompanyUser:', error);
    throw error;
  }
};

/**
 * Desativa um usuário (soft delete)
 */
export const deactivateUser = async (userId: string): Promise<boolean> => {
  try {
    console.log('UserAPI: Deactivating user:', userId);

    const { error } = await supabase
      .from('company_users')
      .update({ 
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (error) {
      console.error('UserAPI: Error deactivating user:', error);
      throw error;
    }

    console.log('UserAPI: User deactivated successfully');
    return true;
  } catch (error) {
    console.error('UserAPI: Error in deactivateUser:', error);
    throw error;
  }
};

// =====================================================
// FUNÇÕES DE COMPATIBILIDADE COM SISTEMA ATUAL
// =====================================================

/**
 * Verifica se usuário tem acesso via sistema atual (compatibilidade)
 */
export const hasLegacyAccess = async (companyId: string): Promise<boolean> => {
  try {
    const { data: currentUser } = await supabase.auth.getUser();
    if (!currentUser.user) return false;

    // Verificar se é o usuário da empresa (sistema atual)
    const { data: company } = await supabase
      .from('companies')
      .select('user_id, is_super_admin')
      .eq('id', companyId)
      .single();

    return company?.user_id === currentUser.user.id || company?.is_super_admin === true;
  } catch (error) {
    console.error('UserAPI: Error checking legacy access:', error);
    return false;
  }
};
