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
 * Hook para gerenciar permissões de leads baseado no role do usuário
 * 
 * Hierarquia de permissões:
 * - super_admin: Acesso total a tudo
 * - admin: Acesso total aos leads da empresa
 * - partner: Acesso total aos leads da empresa
 * - manager: Visualiza todos, edita apenas próprios
 * - seller: Visualiza e edita apenas próprios
 */
export const useLeadPermissions = (): LeadPermissions => {
  const { currentRole, userRoles, company } = useAuth();

  // Pegar o role atual do usuário na empresa ativa
  const currentUserRole = currentRole || userRoles.find(r => r.company_id === company?.id)?.role;

  // Pegar o ID do usuário atual
  const currentUserId = userRoles.find(r => r.company_id === company?.id)?.id;

  // Super admin e admin têm acesso total
  const isAdmin = currentUserRole === 'super_admin' || currentUserRole === 'admin' || currentUserRole === 'partner';

  // Manager pode ver todos mas editar apenas próprios
  const isManager = currentUserRole === 'manager';

  // Seller vê apenas próprios
  const isSeller = currentUserRole === 'seller';

  /**
   * Verifica se usuário pode visualizar um lead
   */
  const canViewLead = (lead: Lead): boolean => {
    // Admin vê tudo
    if (isAdmin) return true;

    // Manager vê todos os leads da empresa
    if (isManager) return true;

    // Seller vê apenas leads atribuídos a ele
    if (isSeller) {
      return lead.responsible_user_id === currentUserId;
    }

    // Default: não pode ver
    return false;
  };

  /**
   * Verifica se usuário pode editar um lead
   */
  const canEditLead = (lead: Lead): boolean => {
    // Admin pode editar tudo
    if (isAdmin) return true;

    // Manager e Seller podem editar apenas leads próprios
    if (isManager || isSeller) {
      return lead.responsible_user_id === currentUserId;
    }

    // Default: não pode editar
    return false;
  };

  /**
   * Verifica se usuário pode deletar um lead
   */
  const canDeleteLead = (): boolean => {
    // Apenas admin pode deletar
    if (isAdmin) return true;

    // Outros roles não podem deletar
    return false;
  };

  /**
   * Verifica se usuário pode atribuir leads a outros usuários
   */
  const canAssignLead = (): boolean => {
    // Admin e Manager podem atribuir
    return isAdmin || isManager;
  };

  /**
   * Verifica se usuário pode ver todos os leads (não apenas próprios)
   */
  const canViewAllLeads = (): boolean => {
    // Admin e Manager veem todos
    return isAdmin || isManager;
  };

  return {
    canViewLead,
    canEditLead,
    canDeleteLead,
    canAssignLead,
    canViewAllLeads
  };
};
