// =====================================================
// partnerApi.ts — operações de atribuição de empresas a partners
// Todas as operações passam por RPCs SECURITY DEFINER.
// =====================================================

import { supabase } from '../lib/supabase';

export interface PartnerAssignment {
  partner_user_id: string;
  email: string;
  display_name: string;
  assigned_at: string;
  assigned_by: string;
}

export interface PartnerUser {
  user_id: string;
  email: string;
  display_name: string;
}

/**
 * Retorna todos os partners atribuídos a uma empresa client.
 * Requer role super_admin ou system_admin.
 */
export const getCompanyPartnerAssignments = async (
  companyId: string
): Promise<PartnerAssignment[]> => {
  const { data, error } = await supabase.rpc('get_company_partner_assignments', {
    p_company_id: companyId,
  });

  if (error) throw error;
  return (data ?? []) as PartnerAssignment[];
};

/**
 * Retorna todos os partners da empresa parent (para seleção no modal).
 * Usa get_company_users_with_details filtrando role = 'partner'.
 */
export const getParentPartnerUsers = async (
  parentCompanyId: string
): Promise<PartnerUser[]> => {
  const { data, error } = await supabase.rpc('get_company_users_with_details', {
    p_company_id: parentCompanyId,
  });

  if (error) throw error;

  return ((data ?? []) as { user_id: string; role: string; email: string; display_name: string }[])
    .filter(u => u.role === 'partner')
    .map(u => ({
      user_id: u.user_id,
      email:   u.email,
      display_name: u.display_name,
    }));
};

/**
 * Atribui um partner a uma empresa client.
 * Requer role super_admin ou system_admin.
 */
export const assignCompanyToPartner = async (
  partnerUserId: string,
  companyId: string
): Promise<void> => {
  const { data, error } = await supabase.rpc('assign_company_to_partner', {
    p_partner_user_id: partnerUserId,
    p_company_id:      companyId,
  });

  if (error) throw error;
  if (!data?.success) throw new Error(data?.error ?? 'Falha ao atribuir empresa ao partner');
};

/**
 * Revoga a atribuição de um partner a uma empresa client (soft delete).
 * Requer role super_admin ou system_admin.
 */
export const revokeCompanyFromPartner = async (
  partnerUserId: string,
  companyId: string
): Promise<void> => {
  const { data, error } = await supabase.rpc('revoke_company_from_partner', {
    p_partner_user_id: partnerUserId,
    p_company_id:      companyId,
  });

  if (error) throw error;
  if (!data?.success) throw new Error(data?.error ?? 'Falha ao revogar atribuição');
};
