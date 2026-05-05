// =====================================================
// useAccessControl — camada centralizada de acesso
//
// Centraliza todas as regras de autorização do sistema,
// delegando para AuthContext e utilitários existentes.
// NÃO duplica lógica — apenas expõe nomes semânticos.
//
// Hierarquia de roles em empresa parent:
//   super_admin  → dono da plataforma, acesso total + páginas SaaS
//   system_admin → acesso total, SEM acesso às páginas SaaS
//   partner      → visão apenas das empresas atribuídas
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

  // ── Primitivas de identidade ────────────────────────────────

  // Dono da plataforma — único com acesso às páginas SaaS (Companies, Plans, etc.)
  const isSaaSAdmin =
    currentRole === 'super_admin' && company?.company_type === 'parent'

  // Administrador de sistema — acesso total de operação, mas SEM páginas SaaS
  const isSystemAdmin =
    currentRole === 'system_admin' && company?.company_type === 'parent'

  // Partner — opera apenas as empresas que foram explicitamente atribuídas
  const isPartner =
    currentRole === 'partner' && company?.company_type === 'parent'

  // Acesso privilegiado para operação interna (notificações, dados globais)
  // Inclui super_admin, system_admin e admin
  const isMaster =
    currentRole === 'super_admin' ||
    currentRole === 'system_admin' ||
    currentRole === 'admin'

  // Tem role super_admin em qualquer empresa — usado em fórmula de isManager no Sales Funnel
  const hasPlatformElevatedRole =
    userRoles.some(r => r.role === 'super_admin' || r.role === 'system_admin')

  // ── Navegação / páginas SaaS ───────────────────────────────
  // super_admin e system_admin acessam a gestão de empresas (Governância Lovoo).
  // Apenas super_admin acessa planos e analytics SaaS.
  const canAccessCompanies     = isSaaSAdmin || isSystemAdmin
  const canAccessPlans         = isSaaSAdmin
  const canAccessSaaSAnalytics = isSaaSAdmin

  // ── Integrações SaaS ───────────────────────────────────────
  const canManageOpenAI     = canManageOpenAIIntegration(company, currentRole)
  const canManageElevenLabs = canManageOpenAI
  const canManageAgents     = canManageOpenAI

  // ── Agentes conversacionais (por empresa) ──────────────────
  // Permite admin, system_admin ou super_admin de qualquer empresa
  // gerenciar assignments e routing rules da sua própria empresa.
  // Independente de company_type — não restrito à empresa-pai.
  // Durante impersonação: currentRole é null (super_admin não tem membership
  // na empresa filha), mas o acesso deve ser mantido — o backend valida.
  const canManageConversationalAgents =
    currentRole === 'admin' ||
    currentRole === 'system_admin' ||
    currentRole === 'super_admin' ||
    isImpersonating

  // ── Compra de créditos de IA ───────────────────────────────
  // Funcionalidade financeira/comercial: somente admin e acima podem
  // autorizar a compra de pacotes de créditos adicionais.
  // Mesma hierarquia de canManageConversationalAgents por design, mas
  // com semântica explícita de billing — NÃO usar canManageConversationalAgents
  // para proteger features financeiras.
  const canPurchaseAiCredits =
    currentRole === 'admin' ||
    currentRole === 'system_admin' ||
    currentRole === 'super_admin' ||
    isImpersonating

  // ── Governança global de IA ────────────────────────────────
  // Restrito à empresa-pai + super_admin.
  // Permite criar e editar as diretrizes globais aplicadas a TODOS os agentes.
  const canManageAiGovernance = isSaaSAdmin

  // ── Notificações automáticas ───────────────────────────────
  // super_admin e system_admin da empresa pai podem configurar canais
  // e editar templates de notificações automáticas (ex: trial alerts).
  // system_admin tem acesso aqui diferente de canManageAiGovernance (só isSaaSAdmin).
  const canManageNotifications = isSaaSAdmin || isSystemAdmin

  // ── Histórico de importações via API ──────────────────────
  // Restrito a admin+: quem configura a API key também pode ver o histórico.
  // manager e seller não operam a API de importação.
  const canViewImportHistory =
    currentRole === 'admin' ||
    currentRole === 'system_admin' ||
    currentRole === 'super_admin' ||
    isImpersonating

  // ── Consultoria ────────────────────────────────────────────
  // Compra de pacotes consultivos: mesma hierarquia de canPurchaseAiCredits
  const canPurchaseConsulting =
    currentRole === 'admin' ||
    currentRole === 'system_admin' ||
    currentRole === 'super_admin' ||
    isImpersonating

  // Catálogo de consultoria: apenas platform admin (empresa pai)
  const canManageConsultingCatalog = isSaaSAdmin || isSystemAdmin

  // Lançamento de horas: apenas platform admin (equipe interna)
  const canLogConsultingHours = isSaaSAdmin || isSystemAdmin

  // ── Impersonação ───────────────────────────────────────────
  // super_admin e system_admin podem impersonar empresas para suporte
  const canImpersonate = isSaaSAdmin || isSystemAdmin

  // ── Usuários ───────────────────────────────────────────────
  const canViewUsers   = hasPermission('users')
  const canCreateUsers = hasPermission('create_users')
  const canEditUsers   = hasPermission('edit_users')
  const canDeleteUsers = hasPermission('delete_users')

  // ── Permissões críticas ────────────────────────────────────
  const canAccessCriticalPerms = canAccessCriticalPermissions(
    company?.company_type,
    currentRole ?? undefined,
    isSaaSAdmin
  )

  // ── Landing pages ──────────────────────────────────────────
  const canSeeLandingPageOwner = currentRole === 'super_admin'

  // ── Leads ───────────────────────────────────────────────────
  const canViewLeads    = hasPermission('leads')
  const canViewAllLeads = hasPermission('view_all_leads')
  const canEditAllLeads = hasPermission('edit_all_leads')

  return {
    // Identidade
    isSaaSAdmin,
    isSystemAdmin,
    isPartner,
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

    // Agentes conversacionais por empresa
    canManageConversationalAgents,

    // Compra de créditos de IA (billing/comercial)
    canPurchaseAiCredits,

    // Governança global de IA
    canManageAiGovernance,

    // Notificações automáticas
    canManageNotifications,

    // Pacotes de consultoria
    canPurchaseConsulting,
    canManageConsultingCatalog,
    canLogConsultingHours,

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

    // Histórico de importações via API
    canViewImportHistory,
  }
}
