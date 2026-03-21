-- =====================================================
-- MIGRATION: FIX COMPANY_USERS RLS SELECT POLICY
-- Data: 21/03/2026
-- Objetivo: Permitir que usuários vejam outros usuários da mesma empresa
-- =====================================================

-- Remover política restritiva antiga que só permitia ver próprio registro
DROP POLICY IF EXISTS "company_users_select_own" ON company_users;

-- Criar nova política que permite ver todos os usuários da mesma empresa
CREATE POLICY "company_users_select_same_company"
ON company_users
FOR SELECT
USING (
  -- Service role tem acesso total
  current_setting('role'::text) = 'service_role'::text
  OR
  -- Usuários podem ver outros usuários das empresas onde estão vinculados
  company_id IN (
    SELECT company_id 
    FROM company_users 
    WHERE user_id = auth.uid()
  )
);

-- Comentário
COMMENT ON POLICY "company_users_select_same_company" ON company_users IS 
'Permite que usuários vejam todos os usuários da mesma empresa para funcionalidades como distribuição de leads e atribuição de responsáveis';
