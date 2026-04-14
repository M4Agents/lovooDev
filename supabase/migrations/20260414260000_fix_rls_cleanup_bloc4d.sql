-- ============================================================
-- BLOCO 4D: Limpeza estrutural — company_users policies
-- Problema: 4 policies com role = {public} (deveria ser {authenticated})
--           Usuário anon tecnicamente "entra" na lógica do USING mas auth.uid()
--           retorna null, então não é exploração real. Porém é má prática e
--           pode gerar comportamentos inesperados com permissões futuras.
-- Ação: recriar as 4 policies com role = authenticated
-- Idempotente: DROP POLICY IF EXISTS + CREATE POLICY
-- Nota: company_users_insert_safe (WITH CHECK false) e
--       company_users_delete_service (service_role only) permanecem intocados
-- ============================================================

DROP POLICY IF EXISTS "company_users_admin_select"  ON company_users;
DROP POLICY IF EXISTS "company_users_select_own"    ON company_users;
DROP POLICY IF EXISTS "company_users_admin_update"  ON company_users;
DROP POLICY IF EXISTS "company_users_update_own"    ON company_users;

-- SELECT: service_role OU próprio usuário OU admin da empresa
CREATE POLICY "company_users_admin_select"
ON company_users FOR SELECT TO authenticated
USING (
  (current_setting('role'::text) = 'service_role'::text)
  OR (user_id = auth.uid())
  OR auth_user_is_company_admin(company_id)
);

-- SELECT próprio: service_role OU usuário autenticado vê seus próprios registros
CREATE POLICY "company_users_select_own"
ON company_users FOR SELECT TO authenticated
USING (
  (current_setting('role'::text) = 'service_role'::text)
  OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
);

-- UPDATE: service_role OU próprio usuário OU admin da empresa
CREATE POLICY "company_users_admin_update"
ON company_users FOR UPDATE TO authenticated
USING (
  (current_setting('role'::text) = 'service_role'::text)
  OR (user_id = auth.uid())
  OR auth_user_is_company_admin(company_id)
)
WITH CHECK (
  (current_setting('role'::text) = 'service_role'::text)
  OR (user_id = auth.uid())
  OR auth_user_is_company_admin(company_id)
);

-- UPDATE próprio: service_role OU usuário autenticado atualiza seu próprio registro
CREATE POLICY "company_users_update_own"
ON company_users FOR UPDATE TO authenticated
USING (
  (current_setting('role'::text) = 'service_role'::text)
  OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
)
WITH CHECK (
  (current_setting('role'::text) = 'service_role'::text)
  OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
);
