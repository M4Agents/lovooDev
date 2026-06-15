-- =============================================================================
-- Fase 1: Helper function auth_user_is_company_manager_or_admin
-- Data: 2026-06-15
--
-- Objetivo:
--   Fornecer helper de autorização para policies RLS que precisam restringir
--   escrita (INSERT/UPDATE/DELETE) a roles de gestão, excluindo seller e partner.
--
-- Roles autorizados: super_admin, system_admin, admin, manager
-- Roles bloqueados:  seller, partner e qualquer outro
--
-- Validações internas:
--   - auth.uid()                             → usuário autenticado
--   - company_users.user_id = auth.uid()     → vínculo real na empresa
--   - company_users.company_id = p_company_id → sem cross-tenant
--   - company_users.is_active = true          → usuário inativo bloqueado
--   - role IN (...)                           → lista explícita, sem tier
--
-- NÃO usa template de permissão como fonte de autorização.
-- NÃO usa comparação por nível numérico (tier).
--
-- Diferença de auth_user_is_company_admin:
--   auth_user_is_company_admin      → admin, super_admin, system_admin (sem manager)
--   auth_user_is_company_manager_or_admin → + manager
--
-- Uso previsto (Fase 2):
--   Policies de INSERT/UPDATE/DELETE em: automation_flows, landing_pages,
--   products, services.
--
-- Idempotência: CREATE OR REPLACE
-- =============================================================================

CREATE OR REPLACE FUNCTION public.auth_user_is_company_manager_or_admin(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   company_users
    WHERE  user_id    = auth.uid()
      AND  company_id = p_company_id
      AND  is_active  = true
      AND  role       IN ('super_admin', 'system_admin', 'admin', 'manager')
  );
$$;

COMMENT ON FUNCTION public.auth_user_is_company_manager_or_admin(uuid) IS
'Trilha 1: retorna TRUE se o usuário autenticado for membro ativo da empresa com
role de gestão (super_admin, system_admin, admin ou manager). Seller e partner
retornam FALSE. Usado nas policies de escrita (INSERT/UPDATE/DELETE) de tabelas
cujo SELECT permanece aberto a todos os membros ativos. Não usa template de
permissão nem comparação por tier.';
