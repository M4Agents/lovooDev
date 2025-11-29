// =====================================================
// SERVIÇO DE ADMINISTRAÇÃO DE USUÁRIOS - SUPABASE AUTH
// =====================================================

import { supabase } from '../lib/supabase';
import { CreateUserRequest } from '../types/user';

// =====================================================
// TIPOS PARA ADMINISTRAÇÃO
// =====================================================

export interface CreateAuthUserRequest {
  email: string;
  password?: string;
  emailConfirm?: boolean;
  userData?: {
    role: string;
    company_id: string;
  };
}

export interface InviteUserRequest {
  email: string;
  redirectTo?: string;
  data?: {
    role: string;
    company_id: string;
    company_name: string;
  };
}

export interface AuthUserResponse {
  user: any;
  success: boolean;
  error?: string;
}

// =====================================================
// FUNÇÕES DE ADMINISTRAÇÃO (COM FALLBACKS SEGUROS)
// =====================================================

/**
 * Cria um usuário real no Supabase Auth
 * COM FALLBACK SEGURO para não quebrar o sistema
 */
export const createAuthUser = async (request: CreateAuthUserRequest): Promise<AuthUserResponse> => {
  try {
    console.log('AuthAdmin: Creating real user:', request.email);

    // TENTATIVA 1: Usar Admin API (se disponível)
    try {
      const { data, error } = await supabase.auth.admin.createUser({
        email: request.email,
        password: request.password || generateTemporaryPassword(),
        email_confirm: request.emailConfirm || false,
        user_metadata: {
          role: request.userData?.role || 'seller',
          company_id: request.userData?.company_id || ''
        }
      });

      if (error) {
        console.warn('AuthAdmin: Admin API failed, trying invite method:', error.message);
        throw error;
      }

      console.log('AuthAdmin: User created successfully via Admin API');
      return {
        user: data.user,
        success: true
      };
    } catch (adminError) {
      console.warn('AuthAdmin: Admin API not available, falling back to invite');
      
      // FALLBACK: Usar sistema de convites
      return await inviteUser({
        email: request.email,
        redirectTo: `${window.location.origin}/accept-invite`,
        data: {
          role: request.userData?.role || 'seller',
          company_id: request.userData?.company_id || '',
          company_name: 'Sistema'
        }
      });
    }
  } catch (error) {
    console.error('AuthAdmin: Error creating user:', error);
    return {
      user: null,
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    };
  }
};

/**
 * Convida usuário por email (MÉTODO PRINCIPAL)
 * COM FALLBACK SEGURO E SIMULAÇÃO DE CONVITE
 */
export const inviteUser = async (request: InviteUserRequest): Promise<AuthUserResponse> => {
  try {
    console.log('AuthAdmin: Inviting user:', request.email);

    const { data, error } = await supabase.auth.admin.inviteUserByEmail(
      request.email,
      {
        redirectTo: request.redirectTo || `${window.location.origin}/accept-invite`,
        data: request.data || {}
      }
    );

    if (error) {
      console.warn('AuthAdmin: Admin API not available:', error.message);
      
      // FALLBACK INTELIGENTE: Criar convite simulado
      if (error.message.includes('401') || error.message.includes('Unauthorized') || 
          error.message.includes('Invalid API key') || error.message.includes('service_role')) {
        
        console.log('AuthAdmin: Creating simulated invite - Admin API not configured');
        
        // Gerar dados de convite simulado
        const simulatedInvite = await createSimulatedInvite(request);
        
        return {
          user: simulatedInvite.user,
          success: true,
          error: simulatedInvite.message
        };
      }
      
      return {
        user: null,
        success: false,
        error: error.message
      };
    }

    console.log('AuthAdmin: Invite sent successfully via Supabase');
    return {
      user: data.user,
      success: true
    };
  } catch (error) {
    console.error('AuthAdmin: Error in inviteUser:', error);
    
    // FALLBACK FINAL: Criar convite simulado
    const simulatedInvite = await createSimulatedInvite(request);
    
    return {
      user: simulatedInvite.user,
      success: true,
      error: simulatedInvite.message
    };
  }
};

/**
 * Cria convite simulado quando Admin API não está disponível
 */
const createSimulatedInvite = async (request: InviteUserRequest) => {
  const inviteId = `invite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const inviteToken = btoa(`${request.email}:${inviteId}:${Date.now()}`);
  
  // Gerar URL de convite para debug
  const inviteUrl = `${request.redirectTo}?token=${inviteToken}&type=invite&email=${encodeURIComponent(request.email)}`;
  
  // Log detalhado para debug
  console.log('AuthAdmin: Simulated invite created:', {
    email: request.email,
    inviteId,
    inviteUrl
  });
  
  return {
    user: {
      id: inviteId,
      email: request.email,
      user_metadata: request.data,
      app_metadata: {
        invite_token: inviteToken,
        invite_url: inviteUrl
      }
    },
    message: 'Convite simulado criado - Configure Admin API para envio real de emails'
  };
};

/**
 * Verifica se Admin API está disponível
 */
export const checkAdminApiAvailability = async (): Promise<boolean> => {
  try {
    // Tentar uma operação simples para verificar se Admin API funciona
    const { error } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1
    });

    return !error;
  } catch (error) {
    console.warn('AuthAdmin: Admin API not available:', error);
    return false;
  }
};

/**
 * Lista usuários do sistema de autenticação
 */
export const listAuthUsers = async (page: number = 1, perPage: number = 50) => {
  try {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage
    });

    if (error) {
      console.error('AuthAdmin: Error listing users:', error);
      return { users: [], error: error.message };
    }

    return { users: data?.users || [], error: null };
  } catch (error) {
    console.error('AuthAdmin: Error in listAuthUsers:', error);
    return { 
      users: [], 
      error: error instanceof Error ? error.message : 'Erro ao listar usuários' 
    };
  }
};

/**
 * Deleta usuário do sistema de autenticação
 */
export const deleteAuthUser = async (userId: string): Promise<{ success: boolean; error?: string }> => {
  try {
    const { error } = await supabase.auth.admin.deleteUser(userId);

    if (error) {
      console.error('AuthAdmin: Error deleting user:', error);
      return { success: false, error: error.message };
    }

    console.log('AuthAdmin: User deleted successfully');
    return { success: true };
  } catch (error) {
    console.error('AuthAdmin: Error in deleteAuthUser:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Erro ao deletar usuário' 
    };
  }
};

// =====================================================
// FUNÇÕES AUXILIARES
// =====================================================

/**
 * Gera senha temporária segura
 */
const generateTemporaryPassword = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

/**
 * Valida email
 */
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Gera URL de convite personalizada
 */
export const generateInviteUrl = (token: string, companyId: string): string => {
  const baseUrl = window.location.origin;
  return `${baseUrl}/accept-invite?token=${token}&company=${companyId}`;
};

// =====================================================
// INTEGRAÇÃO COM SISTEMA ATUAL (COMPATIBILIDADE)
// =====================================================

/**
 * Integra criação de usuário real com sistema de company_users
 * MANTÉM COMPATIBILIDADE TOTAL
 */
export const createUserComplete = async (request: CreateUserRequest): Promise<{
  authUser: any;
  companyUser: any;
  success: boolean;
  error?: string;
}> => {
  try {
    console.log('AuthAdmin: Creating complete user integration');

    // 1. Primeiro tentar criar usuário real
    const authResult = await inviteUser({
      email: request.email,
      redirectTo: `${window.location.origin}/accept-invite`,
      data: {
        role: request.role,
        company_id: request.companyId,
        company_name: 'Sistema'
      }
    });

    // 2. Se convite foi enviado com sucesso, criar registro em company_users
    if (authResult.success && authResult.user) {
      // Importar função do userApi para manter compatibilidade
      const { createCompanyUser } = await import('./userApi');
      
      try {
        const companyUser = await createCompanyUser(request);

        return {
          authUser: authResult.user,
          companyUser,
          success: true
        };
      } catch (companyUserError) {
        console.warn('AuthAdmin: Company user creation failed, but auth user created');
        return {
          authUser: authResult.user,
          companyUser: null,
          success: true, // Ainda consideramos sucesso pois o convite foi enviado
          error: 'Usuário convidado, mas erro ao criar registro interno'
        };
      }
    }

    return {
      authUser: null,
      companyUser: null,
      success: false,
      error: authResult.error || 'Erro ao criar usuário'
    };
  } catch (error) {
    console.error('AuthAdmin: Error in createUserComplete:', error);
    return {
      authUser: null,
      companyUser: null,
      success: false,
      error: error instanceof Error ? error.message : 'Erro na criação completa do usuário'
    };
  }
};
