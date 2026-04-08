// =====================================================
// SERVIÇO DE ADMINISTRAÇÃO DE USUÁRIOS - SUPABASE AUTH
// =====================================================

import { supabase } from '../lib/supabase';

// =====================================================
// TIPOS
// =====================================================

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
// FUNÇÕES ATIVAS
// =====================================================

/**
 * Convida usuário por email — cria conta no Auth e retorna magic link.
 * Toda operação sensível ocorre no backend via /api/auth/invite-user.
 */
export const inviteUser = async (request: InviteUserRequest): Promise<AuthUserResponse> => {
  try {
    console.log('AuthAdmin: Inviting user:', request.email);

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
        error: result.error || 'Erro ao enviar convite. Verifique se Service Role Key está configurada no Vercel.'
      };
    }

    console.log('AuthAdmin: User invited successfully via API route');
    return {
      user: result.user,
      success: true,
      inviteLink: result.inviteLink
    };
  } catch (error) {
    console.error('AuthAdmin: Error in inviteUser:', error);

    return {
      user: null,
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao enviar convite'
    };
  }
};

/**
 * Gera magic link manual para reenvio de acesso.
 * Utilizado pelo UserModal na aba "Senha & Acesso".
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
 * Atualiza display_name de um usuário via rota backend segura.
 * Valida JWT, role admin+ e isolamento multi-tenant no servidor.
 */
export const updateDisplayName = async (
  targetUserId: string,
  displayName: string,
  companyId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { success: false, error: 'Não autenticado' };

    const response = await fetch('/api/auth/update-display-name', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ targetUserId, displayName, companyId })
    });

    const result = await response.json();
    if (!response.ok || result.error) {
      return { success: false, error: result.error || 'Erro ao atualizar nome' };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao atualizar nome'
    };
  }
};

/**
 * Altera a senha de um usuário via rota backend segura.
 * Valida JWT, role admin+ e isolamento multi-tenant no servidor.
 * password_changed_by é derivado do JWT no backend — nunca do frontend.
 */
export const changePassword = async (
  targetUserId: string,
  newPassword: string,
  companyId: string,
  forcePasswordChange: boolean
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { success: false, error: 'Não autenticado' };

    const response = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ targetUserId, newPassword, companyId, forcePasswordChange })
    });

    const result = await response.json();
    if (!response.ok || result.error) {
      return { success: false, error: result.error || 'Erro ao alterar senha' };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao alterar senha'
    };
  }
};
