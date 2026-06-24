-- =====================================================================
-- ROLLBACK: M3 — Restaurar policy SELECT original de sales_funnels
--
-- O que é revertido:
--   M3 substitui a policy "sf_select_member_or_parent_admin" por uma versão
--   que usa auth_user_can_access_funnel() para controle granular por usuário.
--
--   Este rollback restaura a policy original (pré-M3) que usa:
--     auth_user_is_company_member(company_id)
--     OR super_admin/system_admin da empresa pai (Trilha 2)
--
-- Fonte: 20260414140000_fix_rls_funnels_phase3.sql
--
-- ⚠️  ATENÇÃO: Executar ANTES do rollback 06 (tabelas) e 05 (helpers),
--     pois a policy atual (M3) referencia auth_user_can_access_funnel.
--     Restaurar esta policy ANTES de remover o helper garante que
--     sales_funnels não fique sem policy SELECT entre os passos.
--
-- Ordem correta do rollback completo: 11 → 10 → 09 → 08 → 07 → 06 → 05
-- =====================================================================

-- Remover policy atual (criada/substituída por M3)
DROP POLICY IF EXISTS "sf_select_member_or_parent_admin" ON sales_funnels;

-- Restaurar policy original (pré-M3)
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
