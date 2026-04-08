// =====================================================
// API DE USUÁRIOS - SISTEMA HÍBRIDO SEGURO
// =====================================================

import { supabase } from '../lib/supabase';
import { CompanyUser, CreateUserRequest, UpdateUserRequest, UserRole, UserPermissions } from '../types/user';

// =====================================================
// FUNÇÕES DE CONSULTA (SEGURAS)
// =====================================================

/**
 * Busca todos os usuários de uma empresa via RPC SECURITY DEFINER.
 * A RPC valida se o caller tem permissão sobre a empresa.
 * Retorna [] quando o acesso é negado (forbidden) — sem fallback direto em company_users,
 * pois isso anularia a validação de autorização adicionada na RPC.
 */
export const getCompanyUsers = async (companyId: string): Promise<CompanyUser[]> => {
  try {
    const { data, error } = await supabase
      .rpc('get_company_users_with_details', {
        p_company_id: companyId,
      });

    if (error) {
      // Erro de autorização (RPC lança 'forbidden') → retornar lista vazia de forma segura.
      // Não usar fallback direto em company_users: bypassa a validação da RPC.
      const isForbidden =
        error.message?.toLowerCase().includes('forbidden') ||
        error.code === 'P0001';

      if (isForbidden) {
        console.warn('UserAPI [getCompanyUsers]: access denied by RPC for company:', companyId);
        return [];
      }

      console.error('UserAPI: Error fetching company users:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('UserAPI: Error in getCompanyUsers:', error);
    throw error;
  }
};

/**
 * Busca usuários que o usuário atual pode gerenciar.
 * Usa RPC get_managed_users_with_details; retorna [] em caso de forbidden.
 * Fallback direto em company_users foi removido: bypassa a autorização da RPC.
 */
export const getManagedUsers = async (): Promise<CompanyUser[]> => {
  try {
    const { data, error } = await supabase
      .rpc('get_managed_users_with_details');

    if (error) {
      const isForbidden =
        error.message?.toLowerCase().includes('forbidden') ||
        error.code === 'P0001';

      if (isForbidden) {
        console.warn('UserAPI [getManagedUsers]: access denied by RPC');
        return [];
      }

      console.error('UserAPI: Error fetching managed users via RPC:', error);
      throw error;
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
 * Valida se o usuário atual pode criar usuários na empresa.
 * Usa caller_has_permission (lê company_users.permissions do banco).
 * Não depende do role — enforcement RBAC real.
 */
export const canCreateUser = async (companyId: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase
      .rpc('caller_has_permission', {
        p_company_id:     companyId,
        p_permission_key: 'create_users',
      });

    if (error) {
      console.warn('UserAPI: Error checking create_users permission:', error);
      return false;
    }

    return data === true;
  } catch (error) {
    console.error('UserAPI: Error in canCreateUser:', error);
    return false;
  }
};

/**
 * Valida se o role é válido para o tipo de empresa
 */
export const validateRoleForCompany = (role: UserRole, companyType: 'parent' | 'client'): boolean => {
  const parentRoles: UserRole[] = ['super_admin', 'system_admin', 'admin', 'partner'];
  const clientRoles: UserRole[] = ['admin', 'manager', 'seller'];

  if (companyType === 'parent') {
    return parentRoles.includes(role);
  } else {
    return clientRoles.includes(role);
  }
};

// =====================================================
// HIERARQUIA DE ROLES
// =====================================================

/**
 * Tier numérico de cada role.
 * Espelha exatamente o ROLE_TIERS do backend (update_company_user_safe).
 * Quanto maior o número, maior o privilégio.
 * Usado para: bloquear atribuição de role >= próprio tier.
 */
export const ROLE_TIER: Record<UserRole, number> = {
  seller:       1,
  manager:      2,
  admin:        3,
  partner:      4,
  system_admin: 5,
  super_admin:  6,
};

/**
 * Retorna os roles que um caller pode atribuir, considerando:
 *  - o próprio role do caller (tier)
 *  - o tipo de empresa (parent / client)
 *
 * Regra central: só pode atribuir roles com tier < próprio tier.
 * Exceção: super_admin pode atribuir qualquer role válido para o tipo.
 *
 * @param callerRole  Role atual do usuário que fará a atribuição
 * @param companyType Tipo da empresa onde a atribuição ocorrerá
 */
export const getAssignableRoles = (
  callerRole: UserRole | null | undefined,
  companyType: 'parent' | 'client',
): UserRole[] => {
  if (!callerRole) {
    console.warn('[UserAPI] getAssignableRoles: callerRole is null/undefined — retornando lista vazia');
    return [];
  }

  const callerTier = ROLE_TIER[callerRole];

  if (callerTier === undefined) {
    console.warn('[UserAPI] getAssignableRoles: role desconhecido:', callerRole);
    return [];
  }

  const allParentRoles: UserRole[] = ['super_admin', 'system_admin', 'partner', 'admin'];
  const allClientRoles: UserRole[] = ['admin', 'manager', 'seller'];
  const candidates = companyType === 'parent' ? allParentRoles : allClientRoles;

  // super_admin pode atribuir qualquer role válido para o tipo de empresa
  if (callerRole === 'super_admin') {
    return candidates;
  }

  // demais callers: apenas roles com tier estritamente menor que o próprio
  const assignable = candidates.filter(role => {
    const roleTier = ROLE_TIER[role];
    if (roleTier === undefined) {
      console.warn('[UserAPI] getAssignableRoles: tier desconhecido para role candidato:', role);
      return false;
    }
    return roleTier < callerTier;
  });

  if (assignable.length === 0) {
    console.warn('[UserAPI] getAssignableRoles: nenhum role atribuível para', callerRole, 'em', companyType);
  }

  return assignable;
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
    case 'system_admin':
      // Acesso total como super_admin, mas sem acesso a páginas SaaS (companies, financial SaaS)
      // O bloqueio das páginas SaaS é feito no frontend via isSystemAdmin flag.
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
        delete_users: true, // 🔧 CORREÇÃO: Admin deve poder excluir usuários da sua empresa
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
        settings: true, // PODE CONFIGURAR SUAS EMPRESAS
        companies: true, // PODE CRIAR EMPRESAS FILHAS
        users: true, // PODE GERENCIAR USUÁRIOS DAS SUAS EMPRESAS
        financial: false, // SEM ACESSO FINANCEIRO
        create_users: true, // PODE CRIAR USUÁRIOS
        edit_users: true, // PODE EDITAR USUÁRIOS
        delete_users: false, // NÃO PODE EXCLUIR USUÁRIOS
        impersonate: true, // PODE IMPERSONAR SUAS EMPRESAS
        view_all_leads: true,
        edit_all_leads: true,
        view_financial: false, // SEM ACESSO FINANCEIRO
        edit_financial: false  // SEM ACESSO FINANCEIRO
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
        
        // Importar authAdmin dinamicamente para evitar dependência circular
        const { inviteUser } = await import('./authAdmin');
        
        const inviteResult = await inviteUser({
          email: request.email,
          redirectTo: `https://app.lovoocrm.com/accept-invite`,
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
            inviteData = inviteResult.user.app_metadata;
          } else {
            // Convite simulado - usar user_id atual temporariamente (como empresas)
            finalUserId = currentUser.id;
            isRealUser = false;
            inviteData = inviteResult.user.app_metadata;
          }
          
        } else {
          throw new Error(inviteResult.error || 'Falha ao enviar convite');
        }
      } catch (authError) {
        console.error('UserAPI: Failed to create user:', authError);
        const originalMessage = authError instanceof Error ? authError.message : String(authError);
        throw new Error(originalMessage || 'Não foi possível criar usuário. Verifique os logs do servidor.');
      }
    } else {
      // Não solicitou convite - usar user_id atual (como empresas)
      finalUserId = currentUser.id;
      isRealUser = false;
    }

    // Criar registro usando função SECURITY DEFINER (bypassa RLS de forma segura)

    let { data: functionResult, error } = await supabase.rpc('create_company_user_safe', {
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


    // SISTEMA HÍBRIDO CORRIGIDO: NÃO criar empresas duplicadas
    // Usuários são apenas associados a empresas existentes
    // Empresas só podem ser criadas via Menu Empresas (M4 Digital)

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

    
    return result;
  } catch (error) {
    console.error('UserAPI: Error in createCompanyUser:', error);
    throw error;
  }
};

/**
 * Atualiza um usuário existente.
 * Usa update_company_user_safe (SECURITY DEFINER) para updates estruturais
 * (role, permissions, is_active). Atualizações de foto continuam via RPC dedicada.
 */
export const updateCompanyUser = async (request: UpdateUserRequest): Promise<CompanyUser> => {
  try {
    const hasStructuralChange =
      request.role !== undefined ||
      request.permissions !== undefined ||
      request.is_active !== undefined;

    const hasPhotoChange = request.profile_picture_url !== undefined;

    // ── Atualização estrutural via RPC segura ────────────────────────────────
    if (hasStructuralChange) {
      let newPermissions: Record<string, unknown> | undefined;

      if (request.role !== undefined) {
        // Role alterado: reset permissions para defaults do novo role
        newPermissions = getDefaultPermissions(request.role);
      }

      if (request.permissions !== undefined) {
        // Patch de permissions: mesclar com o estado atual
        const currentUser = await getUserById(request.id);
        newPermissions = {
          ...(currentUser?.permissions ?? {}),
          ...request.permissions,
        };
      }

      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        'update_company_user_safe',
        {
          p_record_id:   request.id,
          p_role:        request.role        ?? null,
          p_permissions: newPermissions      ?? null,
          p_is_active:   request.is_active   ?? null,
        }
      );

      if (rpcError) {
        console.error('UserAPI: RPC update_company_user_safe error:', rpcError);
        throw rpcError;
      }

      if (!rpcResult?.success) {
        console.error('UserAPI: update_company_user_safe retornou erro:', rpcResult?.error);
        throw new Error(rpcResult?.error ?? 'Erro ao atualizar usuário');
      }
    }

    // ── Atualização de foto (independente do update estrutural) ──────────────
    if (hasPhotoChange) {
      const { error: photoError } = await supabase.rpc(
        'update_user_profile_picture_simple',
        {
          p_user_record_id:     request.id,
          p_profile_picture_url: request.profile_picture_url,
        }
      );

      if (photoError) {
        console.error('UserAPI: Error updating profile picture:', photoError);
        throw photoError;
      }
    }

    // ── Re-fetch do registro atualizado com join de empresa ──────────────────
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
      .eq('id', request.id)
      .single();

    if (error) {
      console.error('UserAPI: Error fetching updated user:', error);
      throw error;
    }

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

    // Buscar user_id do usuário atual para permissões
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    
    if (!currentUser) {
      throw new Error('Usuário não autenticado');
    }

    // Usar função SECURITY DEFINER para desativação segura
    const { data: functionResult, error } = await supabase.rpc('deactivate_company_user_safe', {
      p_user_id: userId,
      p_deactivated_by: currentUser.id
    });

    if (error) {
      console.error('UserAPI: Error calling deactivate_company_user_safe:', error);
      throw error;
    }

    // Verificar se a função retornou sucesso
    if (!functionResult?.success) {
      console.error('UserAPI: Function returned error:', functionResult?.error);
      throw new Error(functionResult?.error || 'Erro na desativação do usuário');
    }

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
 * @deprecated Não usar em novos fluxos.
 * Legado: verificação de acesso via companies.user_id / companies.is_super_admin.
 * Substituir por caller_has_permission ou company_type === 'parent'.
 * Remoção planejada no Ciclo RBAC 2 / Fase 4.
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
