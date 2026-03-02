// =====================================================
// SERVIÇO DE CONTROLE DE VISIBILIDADE DE PERFIS
// =====================================================

import { supabase } from '../lib/supabase';

export interface ProfileVisibilityConfig {
  profile_id: string;
  visible_to_child_companies: boolean;
  configured_by: string;
  configured_at: string;
}

export interface ProfileVisibilityUpdate {
  profileId: string;
  visible: boolean;
  configuredBy: string;
}

// =====================================================
// FUNÇÕES DE CONFIGURAÇÃO (PREPARADAS PARA FUTURO)
// =====================================================

/**
 * Obter configuração de visibilidade para um perfil específico
 */
export const getProfileVisibility = async (profileId: string): Promise<boolean | null> => {
  try {
    // TODO: Implementar busca real no banco quando tabela for criada
    // const { data, error } = await supabase
    //   .from('system_profile_visibility')
    //   .select('visible_to_child_companies')
    //   .eq('profile_id', profileId)
    //   .single();
    
    // if (error && error.code !== 'PGRST116') { // PGRST116 = not found
    //   throw error;
    // }
    
    // return data?.visible_to_child_companies ?? null;
    
    // Por enquanto, retornar null para usar configuração padrão
    return null;
    
  } catch (error) {
    console.error('ProfileVisibility: Error getting visibility:', error);
    return null;
  }
};

/**
 * Obter todas as configurações de visibilidade
 */
export const getAllProfileVisibilities = async (): Promise<Record<string, boolean>> => {
  try {
    // TODO: Implementar busca real no banco quando tabela for criada
    // const { data, error } = await supabase
    //   .from('system_profile_visibility')
    //   .select('profile_id, visible_to_child_companies');
    
    // if (error) {
    //   throw error;
    // }
    
    // const visibilities: Record<string, boolean> = {};
    // data?.forEach(item => {
    //   visibilities[item.profile_id] = item.visible_to_child_companies;
    // });
    
    // return visibilities;
    
    // Por enquanto, retornar objeto vazio para usar configurações padrão
    return {};
    
  } catch (error) {
    console.error('ProfileVisibility: Error getting all visibilities:', error);
    return {};
  }
};

/**
 * Configurar visibilidade de um perfil (apenas Super Admin/Admin)
 */
export const setProfileVisibility = async (
  profileId: string, 
  visible: boolean,
  configuredBy: string
): Promise<void> => {
  try {
    // Validar permissões (será implementado quando integrar com auth real)
    console.log('ProfileVisibility: Setting visibility:', { profileId, visible, configuredBy });
    
    // TODO: Implementar salvamento real no banco quando tabela for criada
    // const { error } = await supabase
    //   .from('system_profile_visibility')
    //   .upsert({
    //     profile_id: profileId,
    //     visible_to_child_companies: visible,
    //     configured_by: configuredBy,
    //     configured_at: new Date().toISOString()
    //   });
    
    // if (error) {
    //   throw error;
    // }
    
    // Por enquanto, apenas simular salvamento
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('ProfileVisibility: Visibility updated successfully');
    
  } catch (error) {
    console.error('ProfileVisibility: Error setting visibility:', error);
    throw new Error('Erro ao salvar configuração de visibilidade');
  }
};

/**
 * Configurar múltiplas visibilidades em lote
 */
export const setBulkProfileVisibility = async (
  updates: ProfileVisibilityUpdate[]
): Promise<void> => {
  try {
    console.log('ProfileVisibility: Setting bulk visibility:', updates);
    
    // TODO: Implementar salvamento em lote quando tabela for criada
    // const upsertData = updates.map(update => ({
    //   profile_id: update.profileId,
    //   visible_to_child_companies: update.visible,
    //   configured_by: update.configuredBy,
    //   configured_at: new Date().toISOString()
    // }));
    
    // const { error } = await supabase
    //   .from('system_profile_visibility')
    //   .upsert(upsertData);
    
    // if (error) {
    //   throw error;
    // }
    
    // Por enquanto, simular salvamento em lote
    for (const update of updates) {
      await setProfileVisibility(update.profileId, update.visible, update.configuredBy);
    }
    
    console.log('ProfileVisibility: Bulk visibility updated successfully');
    
  } catch (error) {
    console.error('ProfileVisibility: Error setting bulk visibility:', error);
    throw new Error('Erro ao salvar configurações de visibilidade');
  }
};

/**
 * Obter histórico de alterações (para auditoria futura)
 */
export const getVisibilityHistory = async (profileId?: string): Promise<ProfileVisibilityConfig[]> => {
  try {
    // TODO: Implementar quando tabela de histórico for criada
    // let query = supabase
    //   .from('system_profile_visibility_history')
    //   .select(`
    //     profile_id,
    //     visible_to_child_companies,
    //     configured_by,
    //     configured_at,
    //     auth.users!configured_by(email)
    //   `)
    //   .order('configured_at', { ascending: false });
    
    // if (profileId) {
    //   query = query.eq('profile_id', profileId);
    // }
    
    // const { data, error } = await query;
    
    // if (error) {
    //   throw error;
    // }
    
    // return data || [];
    
    // Por enquanto, retornar array vazio
    return [];
    
  } catch (error) {
    console.error('ProfileVisibility: Error getting history:', error);
    return [];
  }
};

/**
 * Resetar todas as configurações para padrão
 */
export const resetToDefaultVisibility = async (configuredBy: string): Promise<void> => {
  try {
    console.log('ProfileVisibility: Resetting to default visibility');
    
    // TODO: Implementar reset quando tabela for criada
    // const { error } = await supabase
    //   .from('system_profile_visibility')
    //   .delete()
    //   .neq('profile_id', ''); // Deletar todos os registros
    
    // if (error) {
    //   throw error;
    // }
    
    // Por enquanto, apenas simular reset
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('ProfileVisibility: Reset completed successfully');
    
  } catch (error) {
    console.error('ProfileVisibility: Error resetting visibility:', error);
    throw new Error('Erro ao resetar configurações');
  }
};

// =====================================================
// UTILITÁRIOS
// =====================================================

/**
 * Validar se usuário pode configurar visibilidade
 */
export const canConfigureVisibility = (
  userRole?: string, 
  companyType?: string, 
  isSuperAdmin?: boolean
): boolean => {
  return companyType === 'parent' && 
    (isSuperAdmin || ['super_admin', 'admin'].includes(userRole || ''));
};

/**
 * Obter configurações padrão de visibilidade
 */
export const getDefaultVisibilityConfig = (): Record<string, boolean> => {
  return {
    'system_super_admin': false,        // Apenas empresa pai
    'system_admin': false,              // Apenas empresa pai
    'system_parceiro_limitado': false,  // Apenas empresa pai
    'system_admin_empresa': true,       // Visível para empresas filhas
    'system_gerente_vendas': true,      // Visível para empresas filhas
    'system_vendedor_basico': true,     // Visível para empresas filhas
    'system_vendedor_senior': true,     // Visível para empresas filhas
  };
};
