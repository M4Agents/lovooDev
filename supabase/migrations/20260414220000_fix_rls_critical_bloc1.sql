-- ============================================================
-- BLOCO 1: Correções Críticas de Autorização Multi-Tenant
-- Tabelas: automation_executions, automation_logs, leads, webhook_trigger_configs
-- Helpers usados:
--   auth_user_is_company_member(company_id) — Trilha 1: qualquer membro ativo
--   auth_user_is_company_admin(company_id)  — Trilha 1: admin-level
--   auth_user_is_parent_admin(company_id)   — Trilha 2: super_admin/system_admin da parent
-- Idempotente: DROP POLICY IF EXISTS + CREATE POLICY
-- ============================================================

-- ============================================================
-- SEÇÃO 1: automation_executions
-- Removendo:
--   "System can create executions" — WITH CHECK true (qualquer autenticado escreve cross-tenant)
--   "System can update executions" — USING/WITH CHECK true (idem para UPDATE)
--   "Users can view executions from their company" — duplicata sem is_active
--   "automation_executions_select_policy"          — duplicata sem is_active
--   "automation_executions_insert_policy"          — sem is_active, sem WITH CHECK no UPDATE par
--   "automation_executions_update_policy"          — sem WITH CHECK
--   "Users can delete executions from their company" — sem is_active
-- Criando: 4 policies limpas com Trilha 1 + Trilha 2
-- Nota: service_role já bypassa RLS — as "System can..." eram inúteis e perigosas
-- ============================================================

DROP POLICY IF EXISTS "System can create executions"                ON automation_executions;
DROP POLICY IF EXISTS "System can update executions"                ON automation_executions;
DROP POLICY IF EXISTS "Users can view executions from their company" ON automation_executions;
DROP POLICY IF EXISTS "Users can delete executions from their company" ON automation_executions;
DROP POLICY IF EXISTS "automation_executions_select_policy"         ON automation_executions;
DROP POLICY IF EXISTS "automation_executions_insert_policy"         ON automation_executions;
DROP POLICY IF EXISTS "automation_executions_update_policy"         ON automation_executions;

CREATE POLICY "ae_select_member_or_parent_admin"
ON automation_executions FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "ae_insert_member_or_parent_admin"
ON automation_executions FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "ae_update_member_or_parent_admin"
ON automation_executions FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "ae_delete_member_or_parent_admin"
ON automation_executions FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 2: automation_logs
-- Removendo:
--   "System can create logs" — WITH CHECK true (qualquer autenticado insere log cross-tenant)
--   "Users can view logs from their company"   — sem is_active
--   "Users can delete logs from their company" — sem is_active
-- Criando: 3 policies limpas (sem UPDATE — log é imutável por design)
-- ============================================================

DROP POLICY IF EXISTS "System can create logs"                    ON automation_logs;
DROP POLICY IF EXISTS "Users can view logs from their company"    ON automation_logs;
DROP POLICY IF EXISTS "Users can delete logs from their company"  ON automation_logs;

CREATE POLICY "al_select_member_or_parent_admin"
ON automation_logs FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "al_insert_member_or_parent_admin"
ON automation_logs FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "al_delete_member_or_parent_admin"
ON automation_logs FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 3: leads
-- Removendo:
--   "leads_secure_hybrid_isolation" — UUID hardcoded + companies.user_id ownership
-- Mantendo:
--   "leads_support_partner_access" — fora do escopo (contém lógica partner)
-- Criando: policy ALL com Trilha 1 + Trilha 2 + service_role pass-through
-- ============================================================

DROP POLICY IF EXISTS "leads_secure_hybrid_isolation" ON leads;

CREATE POLICY "leads_member_or_parent_admin"
ON leads FOR ALL TO authenticated
USING (
  (current_setting('role'::text) = 'service_role'::text)
  OR (
    auth.uid() IS NOT NULL
    AND (
      auth_user_is_company_member(company_id)
      OR auth_user_is_parent_admin(company_id)
    )
  )
)
WITH CHECK (
  (current_setting('role'::text) = 'service_role'::text)
  OR (
    auth.uid() IS NOT NULL
    AND (
      auth_user_is_company_member(company_id)
      OR auth_user_is_parent_admin(company_id)
    )
  )
);

-- ============================================================
-- SEÇÃO 4: webhook_trigger_configs
-- Removendo:
--   "Company isolation for webhook configs" — auth.jwt() ->> 'company_id' sem membership
--   "Users can view their company webhook configs"       — companies.user_id ownership
--   "Users can insert webhook configs for their company" — companies.user_id ownership
--   "Users can update their company webhook configs"     — companies.user_id ownership
--   "Users can delete their company webhook configs"     — companies.user_id ownership
-- Criando:
--   SELECT: qualquer membro ativo (Trilha 1) + parent admin (Trilha 2)
--   INSERT/UPDATE/DELETE: admin-level (Trilha 1) + parent admin (Trilha 2)
--   Razão: webhook configs são configuração sensível — DML restrito a admin
-- ============================================================

DROP POLICY IF EXISTS "Company isolation for webhook configs"              ON webhook_trigger_configs;
DROP POLICY IF EXISTS "Users can view their company webhook configs"        ON webhook_trigger_configs;
DROP POLICY IF EXISTS "Users can insert webhook configs for their company"  ON webhook_trigger_configs;
DROP POLICY IF EXISTS "Users can update their company webhook configs"      ON webhook_trigger_configs;
DROP POLICY IF EXISTS "Users can delete their company webhook configs"      ON webhook_trigger_configs;

CREATE POLICY "wtc_select_member_or_parent_admin"
ON webhook_trigger_configs FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "wtc_insert_admin_or_parent_admin"
ON webhook_trigger_configs FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "wtc_update_admin_or_parent_admin"
ON webhook_trigger_configs FOR UPDATE TO authenticated
USING (
  auth_user_is_company_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "wtc_delete_admin_or_parent_admin"
ON webhook_trigger_configs FOR DELETE TO authenticated
USING (
  auth_user_is_company_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);
