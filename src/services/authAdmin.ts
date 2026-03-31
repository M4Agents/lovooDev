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
  inviteLink?: string | null;
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

    // Usar sistema de convites via API route server-side
    return await inviteUser({
      email: request.email,
      redirectTo: `https://app.lovoocrm.com/accept-invite`,
      data: {
        role: request.userData?.role || 'seller',
        company_id: request.userData?.company_id || '',
        company_name: 'Sistema'
      }
    });
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
 * Cria usuário no CRM via API route server-side (MÉTODO PRINCIPAL)
 * Fluxo: createUser + generateLink — sem envio de email, sem SMTP
 * Retorna inviteLink para o admin compartilhar manualmente
 */
export const inviteUser = async (request: InviteUserRequest): Promise<AuthUserResponse> => {
  try {
    console.log('AuthAdmin: Creating user:', request.email);

    const response = await fetch('/api/auth/invite-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: request.email,
        redirectTo: request.redirectTo || `https://app.lovoocrm.com/accept-invite`,
        data: request.data || {}
      })
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      console.error('AuthAdmin: API route failed:', result.error);

      return {
        user: null,
        success: false,
        error: result.error || 'Erro ao criar usuário. Verifique se Service Role Key está configurada no Vercel.'
      };
    }

    console.log('AuthAdmin: User created successfully via API route');
    return {
      user: result.user,
      success: true,
      inviteLink: result.inviteLink ?? null
    };
  } catch (error) {
    console.error('AuthAdmin: Error in inviteUser:', error);

    return {
      user: null,
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao criar usuário'
    };
  }
};

/**
 * Gera magic link manual para quando email não chegar
 */
export const generateMagicLink = async (email: string) => {
  try {
    const response = await fetch('/api/auth/generate-magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    
    const result = await response.json();
    
    if (result.success) {
      return {
        success: true,
        magicLink: result.magicLink,
        expiresIn: '1 hora'
      };
    }
    
    return { success: false, error: result.error };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Erro ao gerar link'
    };
  }
};

/**
 * Confirma usuário manualmente (fallback quando email não chega)
 */
export const confirmUserManually = async (email: string) => {
  try {
    const response = await fetch('/api/auth/confirm-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    
    const result = await response.json();
    
    if (result.success) {
      return { success: true };
    }
    
    return { success: false, error: result.error };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Erro ao confirmar usuário'
    };
  }
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
  const baseUrl = 'https://app.lovoocrm.com';
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
      redirectTo: `https://app.lovoocrm.com/accept-invite`,
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
