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
  isRestrictedToOwnLeads: () => boolean;
  /** auth.users.id do usuário na empresa ativa. Undefined enquanto userRoles ainda carrega. */
  currentUserId: string | undefined;
}

/**
 * UI HELPER ONLY — não é camada de segurança.
 *
 * O enforcement real da restrição de leads ocorre em RLS via
 * auth_user_restricted_to_own_leads(company_id) no banco.
 * Este hook replica a mesma lógica apenas para decisões de UI:
 * ocultar/mostrar botões, indicadores visuais, dropdown de responsável.
 *
 * Hierarquia resultante (espelha o comportamento do RLS):
 *   - super_admin / admin / partner : view_all_leads = true → acesso total
 *   - manager  : view_all_leads = true → acesso total
 *   - seller (empresa sem restrict_leads_to_owner) : vê tudo
 *   - seller (empresa com restrict_leads_to_owner) : vê apenas próprios leads
 */
export const useLeadPermissions = (): LeadPermissions => {
  const { hasPermission, currentRole, userRoles, company } = useAuth();

  // auth.users.id do usuário na empresa ativa.
  // CORRETO: usa user_id (auth.users.id), que é o valor armazenado
  // em leads.responsible_user_id — NÃO usa company_users.id.
  const currentUserId = userRoles.find(r => r.company_id === company?.id)?.user_id;

  const currentUserRole =
    currentRole || userRoles.find(r => r.company_id === company?.id)?.role;

  /**
   * UI: verifica se o usuário pode visualizar um lead.
   * Espelha a lógica da RLS policy leads_member_or_parent_admin.
   * A decisão de segurança real cabe ao banco — este método é
   * usado apenas para ocultar ações na interface.
   */
  const canViewLead = (lead: Lead): boolean => {
    if (hasPermission('view_all_leads')) return true;
    if (!company?.restrict_leads_to_owner) return true;
    return lead.responsible_user_id === currentUserId;
  };

  /**
   * Verifica se o usuário pode editar um lead.
   * edit_all_leads: true → pode editar qualquer lead.
   * edit_all_leads: false → leads próprios OU sem responsável.
   */
  const canEditLead = (lead: Lead): boolean => {
    if (hasPermission('edit_all_leads')) return true;
    return !lead.responsible_user_id || lead.responsible_user_id === currentUserId;
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

  /**
   * Retorna true quando a empresa tem restrict_leads_to_owner ativo
   * e o usuário não tem view_all_leads — espelha auth_user_restricted_to_own_leads().
   * Usado para decisões de UX (ocultar dropdown, mostrar indicador).
   */
  const isRestrictedToOwnLeads = (): boolean => {
    return Boolean(company?.restrict_leads_to_owner) && !hasPermission('view_all_leads');
  };

  return {
    canViewLead,
    canEditLead,
    canDeleteLead,
    canAssignLead,
    canViewAllLeads,
    isRestrictedToOwnLeads,
    currentUserId,
  };
};
