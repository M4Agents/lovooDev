-- =====================================================
-- MIGRATION: REVERT COMPANY_USERS RLS SELECT POLICY
-- Data: 21/03/2026
-- Objetivo: Reverter política RLS que causou problemas no sistema
-- =====================================================

-- Remover política que causou problemas
DROP POLICY IF EXISTS "company_users_select_same_company" ON company_users;

-- Recriar política original
CREATE POLICY "company_users_select_own"
ON company_users
FOR SELECT
USING (
  (current_setting('role'::text) = 'service_role'::text) 
  OR 
  ((auth.uid() IS NOT NULL) AND (user_id = auth.uid()))
);

-- Comentário
COMMENT ON POLICY "company_users_select_own" ON company_users IS 
'Política original restaurada - permite que usuários vejam apenas seu próprio registro';
