-- =============================================================================
-- Fase 2: Restrição de escrita RLS para role seller
-- Data: 2026-06-15
-- Tabelas: automation_flows, landing_pages, products, services
--
-- Objetivo:
--   Impedir que seller (e partner) escrevam em tabelas administrativas.
--   automation_flows e landing_pages: seller bloqueado também no SELECT.
--   products e services: seller mantém SELECT (leitura do catálogo).
--
-- Helpers usados:
--   auth_user_is_company_manager_or_admin(company_id) [criado na Fase 1]
--   → super_admin, system_admin, admin, manager ativos na empresa (Trilha 1)
--   auth_user_is_parent_admin(company_id) [pré-existente]
--   → super_admin, system_admin da empresa pai (Trilha 2)
--   auth_user_is_company_member(company_id) [pré-existente]
--   → qualquer membro ativo (Trilha 1 — usado apenas no SELECT de products/services)
--
-- Policies removidas (16): todas *_member_or_parent_admin das 4 tabelas
-- Policies criadas (18):   *_manager_or_admin + SELECT member para products/services
--
-- NÃO alterada: "Anonymous users can view landing pages by tracking code"
-- Idempotência: DROP POLICY IF EXISTS + CREATE POLICY
-- =============================================================================

-- ── automation_flows ─────────────────────────────────────────────────────────
-- Seller bloqueado em todas as operações, incluindo SELECT
-- Manager, admin, super_admin, system_admin da empresa: acesso total
-- Super_admin, system_admin da empresa pai (Trilha 2): acesso total

DROP POLICY IF EXISTS "af_select_member_or_parent_admin" ON automation_flows;
DROP POLICY IF EXISTS "af_insert_member_or_parent_admin" ON automation_flows;
DROP POLICY IF EXISTS "af_update_member_or_parent_admin" ON automation_flows;
DROP POLICY IF EXISTS "af_delete_member_or_parent_admin" ON automation_flows;

CREATE POLICY "af_select_manager_or_admin"
ON automation_flows FOR SELECT TO authenticated
USING (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "af_insert_manager_or_admin"
ON automation_flows FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "af_update_manager_or_admin"
ON automation_flows FOR UPDATE TO authenticated
USING (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "af_delete_manager_or_admin"
ON automation_flows FOR DELETE TO authenticated
USING (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ── landing_pages ─────────────────────────────────────────────────────────────
-- Seller bloqueado em todas as operações, incluindo SELECT
-- Policy anon "Anonymous users can view landing pages by tracking code" NÃO removida

DROP POLICY IF EXISTS "lp_select_member_or_parent_admin" ON landing_pages;
DROP POLICY IF EXISTS "lp_insert_member_or_parent_admin" ON landing_pages;
DROP POLICY IF EXISTS "lp_update_member_or_parent_admin" ON landing_pages;
DROP POLICY IF EXISTS "lp_delete_member_or_parent_admin" ON landing_pages;

CREATE POLICY "lp_select_manager_or_admin"
ON landing_pages FOR SELECT TO authenticated
USING (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "lp_insert_manager_or_admin"
ON landing_pages FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "lp_update_manager_or_admin"
ON landing_pages FOR UPDATE TO authenticated
USING (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "lp_delete_manager_or_admin"
ON landing_pages FOR DELETE TO authenticated
USING (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ── products ──────────────────────────────────────────────────────────────────
-- Seller pode ler catálogo (SELECT aberto para membros ativos)
-- Seller bloqueado em INSERT/UPDATE/DELETE

DROP POLICY IF EXISTS "prod_select_member_or_parent_admin" ON products;
DROP POLICY IF EXISTS "prod_insert_member_or_parent_admin" ON products;
DROP POLICY IF EXISTS "prod_update_member_or_parent_admin" ON products;
DROP POLICY IF EXISTS "prod_delete_member_or_parent_admin" ON products;

CREATE POLICY "prod_select_member"
ON products FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "prod_insert_manager_or_admin"
ON products FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "prod_update_manager_or_admin"
ON products FOR UPDATE TO authenticated
USING (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "prod_delete_manager_or_admin"
ON products FOR DELETE TO authenticated
USING (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ── services ──────────────────────────────────────────────────────────────────
-- Seller pode ler catálogo (SELECT aberto para membros ativos)
-- Seller bloqueado em INSERT/UPDATE/DELETE

DROP POLICY IF EXISTS "svc_select_member_or_parent_admin" ON services;
DROP POLICY IF EXISTS "svc_insert_member_or_parent_admin" ON services;
DROP POLICY IF EXISTS "svc_update_member_or_parent_admin" ON services;
DROP POLICY IF EXISTS "svc_delete_member_or_parent_admin" ON services;

CREATE POLICY "svc_select_member"
ON services FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "svc_insert_manager_or_admin"
ON services FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "svc_update_manager_or_admin"
ON services FOR UPDATE TO authenticated
USING (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "svc_delete_manager_or_admin"
ON services FOR DELETE TO authenticated
USING (
  auth_user_is_company_manager_or_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);
