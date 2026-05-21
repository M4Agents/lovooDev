-- ============================================================
-- Fix: Trilha 2 (auth_user_is_parent_admin) em tabelas administrativas
--
-- Tabelas: integration_settings, lovoo_agents,
--          lovoo_agent_documents, ai_agent_execution_logs
--
-- Problema: super_admin / system_admin da empresa pai sem registro
-- direto na empresa filha não conseguia acessar essas tabelas.
--
-- Padrão aplicado em todas as policies:
--   ANTES: auth_user_is_company_admin(company_id)
--   DEPOIS: auth_user_is_company_admin(company_id)
--           OR auth_user_is_parent_admin(company_id)
--
-- auth_user_is_company_admin já inclui: admin, super_admin, system_admin com is_active
-- auth_user_is_parent_admin cobre: super_admin, system_admin da empresa pai com is_active
--
-- NÃO alterado: catalog_categories (já correto), triggers, grants, índices
-- ============================================================


-- ──────────────────────────────────────────────────────────────
-- 1. integration_settings
--    Policies existentes: is_select_company_admin, is_insert_company_admin,
--                         is_update_company_admin
--    (sem DELETE — preservado)
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS is_select_company_admin ON public.integration_settings;
CREATE POLICY is_select_company_admin ON public.integration_settings
  FOR SELECT USING (
    auth_user_is_company_admin(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

DROP POLICY IF EXISTS is_insert_company_admin ON public.integration_settings;
CREATE POLICY is_insert_company_admin ON public.integration_settings
  FOR INSERT WITH CHECK (
    auth_user_is_company_admin(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

DROP POLICY IF EXISTS is_update_company_admin ON public.integration_settings;
CREATE POLICY is_update_company_admin ON public.integration_settings
  FOR UPDATE
  USING (
    auth_user_is_company_admin(company_id)
    OR auth_user_is_parent_admin(company_id)
  )
  WITH CHECK (
    auth_user_is_company_admin(company_id)
    OR auth_user_is_parent_admin(company_id)
  );


-- ──────────────────────────────────────────────────────────────
-- 2. lovoo_agents
--    Policies existentes: la_select_company_admin, la_insert_company_admin,
--                         la_update_company_admin, la_delete_company_admin
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS la_select_company_admin ON public.lovoo_agents;
CREATE POLICY la_select_company_admin ON public.lovoo_agents
  FOR SELECT USING (
    auth_user_is_company_admin(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

DROP POLICY IF EXISTS la_insert_company_admin ON public.lovoo_agents;
CREATE POLICY la_insert_company_admin ON public.lovoo_agents
  FOR INSERT WITH CHECK (
    auth_user_is_company_admin(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

DROP POLICY IF EXISTS la_update_company_admin ON public.lovoo_agents;
CREATE POLICY la_update_company_admin ON public.lovoo_agents
  FOR UPDATE
  USING (
    auth_user_is_company_admin(company_id)
    OR auth_user_is_parent_admin(company_id)
  )
  WITH CHECK (
    auth_user_is_company_admin(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

DROP POLICY IF EXISTS la_delete_company_admin ON public.lovoo_agents;
CREATE POLICY la_delete_company_admin ON public.lovoo_agents
  FOR DELETE USING (
    auth_user_is_company_admin(company_id)
    OR auth_user_is_parent_admin(company_id)
  );


-- ──────────────────────────────────────────────────────────────
-- 3. lovoo_agent_documents
--    Policies existentes: lad_select_company_admin, lad_insert_company_admin,
--                         lad_update_company_admin, lad_delete_company_admin
--    company_id é resolvido via: (SELECT la.company_id FROM lovoo_agents la
--                                  WHERE la.id = lovoo_agent_documents.agent_id)
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS lad_select_company_admin ON public.lovoo_agent_documents;
CREATE POLICY lad_select_company_admin ON public.lovoo_agent_documents
  FOR SELECT USING (
    auth_user_is_company_admin(
      (SELECT la.company_id FROM lovoo_agents la WHERE la.id = lovoo_agent_documents.agent_id)
    )
    OR auth_user_is_parent_admin(
      (SELECT la.company_id FROM lovoo_agents la WHERE la.id = lovoo_agent_documents.agent_id)
    )
  );

DROP POLICY IF EXISTS lad_insert_company_admin ON public.lovoo_agent_documents;
CREATE POLICY lad_insert_company_admin ON public.lovoo_agent_documents
  FOR INSERT WITH CHECK (
    auth_user_is_company_admin(
      (SELECT la.company_id FROM lovoo_agents la WHERE la.id = lovoo_agent_documents.agent_id)
    )
    OR auth_user_is_parent_admin(
      (SELECT la.company_id FROM lovoo_agents la WHERE la.id = lovoo_agent_documents.agent_id)
    )
  );

DROP POLICY IF EXISTS lad_update_company_admin ON public.lovoo_agent_documents;
CREATE POLICY lad_update_company_admin ON public.lovoo_agent_documents
  FOR UPDATE
  USING (
    auth_user_is_company_admin(
      (SELECT la.company_id FROM lovoo_agents la WHERE la.id = lovoo_agent_documents.agent_id)
    )
    OR auth_user_is_parent_admin(
      (SELECT la.company_id FROM lovoo_agents la WHERE la.id = lovoo_agent_documents.agent_id)
    )
  )
  WITH CHECK (
    auth_user_is_company_admin(
      (SELECT la.company_id FROM lovoo_agents la WHERE la.id = lovoo_agent_documents.agent_id)
    )
    OR auth_user_is_parent_admin(
      (SELECT la.company_id FROM lovoo_agents la WHERE la.id = lovoo_agent_documents.agent_id)
    )
  );

DROP POLICY IF EXISTS lad_delete_company_admin ON public.lovoo_agent_documents;
CREATE POLICY lad_delete_company_admin ON public.lovoo_agent_documents
  FOR DELETE USING (
    auth_user_is_company_admin(
      (SELECT la.company_id FROM lovoo_agents la WHERE la.id = lovoo_agent_documents.agent_id)
    )
    OR auth_user_is_parent_admin(
      (SELECT la.company_id FROM lovoo_agents la WHERE la.id = lovoo_agent_documents.agent_id)
    )
  );


-- ──────────────────────────────────────────────────────────────
-- 4. ai_agent_execution_logs
--    Policy existente: aael_select_company_admin (SELECT apenas)
--    INSERT/UPDATE/DELETE: sem policy RLS — operações via service_role (backend)
--    company_id é resolvido via: (SELECT la.company_id FROM lovoo_agents la
--                                  WHERE la.id = ai_agent_execution_logs.agent_id)
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS aael_select_company_admin ON public.ai_agent_execution_logs;
CREATE POLICY aael_select_company_admin ON public.ai_agent_execution_logs
  FOR SELECT USING (
    auth_user_is_company_admin(
      (SELECT la.company_id FROM lovoo_agents la WHERE la.id = ai_agent_execution_logs.agent_id)
    )
    OR auth_user_is_parent_admin(
      (SELECT la.company_id FROM lovoo_agents la WHERE la.id = ai_agent_execution_logs.agent_id)
    )
  );
