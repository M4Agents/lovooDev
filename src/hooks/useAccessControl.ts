// =====================================================
// useAccessControl — camada centralizada de acesso
//
// Centraliza todas as regras de autorização do sistema,
// delegando para AuthContext e utilitários existentes.
// NÃO duplica lógica — apenas expõe nomes semânticos.
//
// Adoção gradual: os componentes ainda podem usar as
// expressões originais; migrar um arquivo por vez.
// =====================================================

import { useAuth } from '../contexts/AuthContext'
import { canManageOpenAIIntegration } from '../utils/openaiIntegrationAccess'
import { canAccessCriticalPermissions } from '../utils/permissionUtils'

export function useAccessControl() {
  const {
    company,
    currentRole,
    userRoles,
    isImpersonating,
    hasPermission,
  } = useAuth()

  // ── Primitivas ─────────────────────────────────────────────
  // super_admin ativo na empresa pai — gate de todas as telas SaaS
  const isSaaSAdmin =
    currentRole === 'super_admin' && company?.company_type === 'parent'

  // super_admin ou admin — acesso privilegiado dentro da empresa ativa
  // (notificações, dados globais de empresa)
  const isMaster =
    currentRole === 'super_admin' || currentRole === 'admin'

  // tem role super_admin em qualquer empresa vinculada ao usuário
  // (usado em sales funnel para hasPlatformElevatedRole)
  const hasPlatformElevatedRole =
    userRoles.some(r => r.role === 'super_admin')

  // ── Navegação / páginas SaaS ───────────────────────────────
  const canAccessCompanies     = isSaaSAdmin
  const canAccessPlans         = isSaaSAdmin
  const canAccessSaaSAnalytics = isSaaSAdmin

  // ── Integrações SaaS ───────────────────────────────────────
  // Delega ao utilitário existente (company_type + super_admin)
  const canManageOpenAI     = canManageOpenAIIntegration(company, currentRole)
  const canManageElevenLabs = canManageOpenAI
  const canManageAgents     = canManageOpenAI

  // ── Impersonação ───────────────────────────────────────────
  const canImpersonate = isSaaSAdmin

  // ── Usuários ───────────────────────────────────────────────
  const canViewUsers   = hasPermission('users')
  const canCreateUsers = hasPermission('create_users')
  const canEditUsers   = hasPermission('edit_users')
  const canDeleteUsers = hasPermission('delete_users')

  // ── Permissões críticas ────────────────────────────────────
  // Delega ao utilitário existente (empresas, impersonar, etc.)
  const canAccessCriticalPerms = canAccessCriticalPermissions(
    company?.company_type,
    currentRole ?? undefined,
    isSaaSAdmin
  )

  // ── Landing pages ──────────────────────────────────────────
  // super_admin vê o nome da empresa dona no card
  const canSeeLandingPageOwner = currentRole === 'super_admin'

  // ── Leads ───────────────────────────────────────────────────
  // Lê diretamente de company_users.permissions (RBAC real).
  // canViewAllLeads é usado também na fórmula de isManager nos Sales Funnel.
  const canViewLeads    = hasPermission('leads')
  const canViewAllLeads = hasPermission('view_all_leads')
  const canEditAllLeads = hasPermission('edit_all_leads')

  return {
    // Primitivas (úteis para casos não cobertos pelas chaves semânticas)
    isSaaSAdmin,
    isMaster,
    hasPlatformElevatedRole,
    isImpersonating,

    // Navegação / páginas SaaS
    canAccessCompanies,
    canAccessPlans,
    canAccessSaaSAnalytics,

    // Integrações
    canManageOpenAI,
    canManageElevenLabs,
    canManageAgents,

    // Impersonação
    canImpersonate,

    // Usuários
    canViewUsers,
    canCreateUsers,
    canEditUsers,
    canDeleteUsers,

    // Permissões críticas
    canAccessCriticalPerms,

    // Landing pages
    canSeeLandingPageOwner,

    // Leads
    canViewLeads,
    canViewAllLeads,
    canEditAllLeads,
  }
}
