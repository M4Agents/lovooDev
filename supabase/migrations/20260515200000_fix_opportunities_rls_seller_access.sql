-- Migration: corrige regressão de acesso a opportunities para seller e demais membros.
--
-- Problema: a migration 20260514200000_fix_opportunities_rls_parent_admin.sql
-- adicionou suporte à Trilha 2 (parent admin) com a restrição correta, mas
-- introduziu uma whitelist de roles no segundo bloco que excluiu 'seller'
-- (e 'system_admin') do SELECT/INSERT/UPDATE. Com isso, vendedores passaram a
-- ver apenas as oportunidades de que são owner, e as demais sumiam no chat e
-- no funil.
--
-- Solução: substituir a whitelist por auth_user_is_company_member(company_id),
-- que já valida membership ativo (is_active = true) sem discriminar por role —
-- padrão consolidado em opportunity_funnel_positions, leads e outras tabelas.
-- Trilha 2 (auth_user_is_parent_admin) é preservada em todas as operações.

-- ─── SELECT ──────────────────────────────────────────────────────────────────
-- Qualquer membro ativo da empresa pode visualizar oportunidades da empresa.

DROP POLICY IF EXISTS opportunities_select_policy ON opportunities;

CREATE POLICY opportunities_select_policy ON opportunities
  FOR SELECT
  USING (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

-- ─── INSERT ──────────────────────────────────────────────────────────────────
-- Qualquer membro ativo pode criar oportunidades para a sua empresa.

DROP POLICY IF EXISTS opportunities_insert_policy ON opportunities;

CREATE POLICY opportunities_insert_policy ON opportunities
  FOR INSERT
  WITH CHECK (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

-- ─── UPDATE ──────────────────────────────────────────────────────────────────
-- Qualquer membro ativo pode atualizar oportunidades da empresa.

DROP POLICY IF EXISTS opportunities_update_policy ON opportunities;

CREATE POLICY opportunities_update_policy ON opportunities
  FOR UPDATE
  USING (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

-- ─── DELETE ──────────────────────────────────────────────────────────────────
-- Apenas roles com permissão elevada ou dono da oportunidade podem excluir.
-- seller não pode deletar oportunidades que não são suas.

DROP POLICY IF EXISTS opportunities_delete_policy ON opportunities;

CREATE POLICY opportunities_delete_policy ON opportunities
  FOR DELETE
  USING (
    (
      auth_user_is_company_member(company_id)
      AND EXISTS (
        SELECT 1 FROM company_users cu
        WHERE cu.user_id    = auth.uid()
          AND cu.company_id = opportunities.company_id
          AND cu.is_active  = true
          AND cu.role       = ANY (ARRAY[
            'super_admin'::text, 'system_admin'::text, 'admin'::text,
            'manager'::text
          ])
      )
    )
    OR owner_user_id = auth.uid()
    OR auth_user_is_parent_admin(company_id)
  );
