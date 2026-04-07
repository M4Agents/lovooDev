import { useAuth } from '../contexts/AuthContext';

interface Lead {
  id: number;
  responsible_user_id?: string;
  company_id?: string;
}

interface LeadPermissions {
  canViewLead: (lead: Lead) => boolean;
  canEditLead: (lead: Lead) => boolean;
  canDeleteLead: () => boolean;
  canAssignLead: () => boolean;
  canViewAllLeads: () => boolean;
}

/**
 * Hook para gerenciar permissões de leads.
 *
 * Permissões de visibilidade e edição leem company_users.permissions via hasPermission()
 * (RBAC real, sem bypass por role).
 *
 * canDeleteLead permanece role-based pois não existe chave delete_leads em UserPermissions.
 *
 * Hierarquia resultante (equivalente ao comportamento anterior):
 * - super_admin / admin / partner : view_all_leads + edit_all_leads = acesso total
 * - manager  : view_all_leads = true, edit_all_leads = false → edita apenas próprios
 * - seller   : view_all_leads = false → vê e edita apenas próprios
 */
export const useLeadPermissions = (): LeadPermissions => {
  const { hasPermission, currentRole, userRoles, company } = useAuth();

  // ID do registro company_users do usuário na empresa ativa
  // (usado para comparar com lead.responsible_user_id)
  const currentUserId = userRoles.find(r => r.company_id === company?.id)?.id;

  // Fallback para role (usado apenas em canDeleteLead, que não tem chave de permissão)
  const currentUserRole =
    currentRole || userRoles.find(r => r.company_id === company?.id)?.role;

  /**
   * Verifica se o usuário pode visualizar um lead.
   * view_all_leads: true → acesso a qualquer lead da empresa.
   * view_all_leads: false → apenas leads atribuídos ao próprio usuário.
   */
  const canViewLead = (lead: Lead): boolean => {
    if (hasPermission('view_all_leads')) return true;
    return lead.responsible_user_id === currentUserId;
  };

  /**
   * Verifica se o usuário pode editar um lead.
   * edit_all_leads: true → pode editar qualquer lead.
   * edit_all_leads: false → apenas leads próprios (manager e seller).
   */
  const canEditLead = (lead: Lead): boolean => {
    if (hasPermission('edit_all_leads')) return true;
    return lead.responsible_user_id === currentUserId;
  };

  /**
   * Verifica se o usuário pode deletar um lead.
   * Mantido role-based: não existe chave delete_leads em UserPermissions.
   */
  const canDeleteLead = (): boolean => {
    return (
      currentUserRole === 'super_admin' ||
      currentUserRole === 'admin' ||
      currentUserRole === 'partner'
    );
  };

  /**
   * Verifica se o usuário pode atribuir leads a outros usuários.
   * Equivalente a canViewAllLeads — quem vê tudo pode redistribuir.
   */
  const canAssignLead = (): boolean => hasPermission('view_all_leads');

  /**
   * Verifica se o usuário pode ver todos os leads (não apenas próprios).
   */
  const canViewAllLeads = (): boolean => hasPermission('view_all_leads');

  return {
    canViewLead,
    canEditLead,
    canDeleteLead,
    canAssignLead,
    canViewAllLeads,
  };
};
