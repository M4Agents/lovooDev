-- =====================================================================
-- ESTADO ATUAL: Policy SELECT de sales_funnels ANTES das migrations
-- Fonte: 20260414140000_fix_rls_funnels_phase3.sql
--
-- Esta é a definição ATUAL da policy "sf_select_member_or_parent_admin".
-- Usar como referência para rollback de M3.
-- =====================================================================

-- Policy atual (PRÉ M3):
-- USING: auth_user_is_company_member(company_id) — qualquer membro ativo
--        OR super_admin/system_admin da empresa pai (Trilha 2)
--
-- DIFERENÇA após M3:
-- M3 substitui auth_user_is_company_member por auth_user_can_access_funnel
-- adicionando controle granular por usuário (user_funnel_settings).

DROP POLICY IF EXISTS "sf_select_member_or_parent_admin" ON sales_funnels;

CREATE POLICY "sf_select_member_or_parent_admin"
ON sales_funnels FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR EXISTS (
    SELECT 1 FROM company_users cu
    JOIN companies child ON child.id = sales_funnels.company_id
    WHERE cu.user_id    = auth.uid()
      AND cu.is_active  = true
      AND cu.role       IN ('super_admin', 'system_admin')
      AND cu.company_id = child.parent_company_id
  )
);
