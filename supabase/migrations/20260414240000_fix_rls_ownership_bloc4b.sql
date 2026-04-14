-- ============================================================
-- BLOCO 4B: Saneamento de Ownership Legado (companies.user_id / is_super_admin)
-- Tabelas: landing_pages, analytics_cache, behavior_events, conversions, visitors,
--          webhook_logs, aws_credentials, chat_scheduled_messages (legado),
--          plans, instance_webhook_configs
-- Helpers usados:
--   auth_user_is_company_member(uuid)  — Trilha 1: qualquer membro ativo
--   auth_user_is_company_admin(uuid)   — Trilha 1: admin-level
--   auth_user_is_parent_admin(uuid)    — Trilha 2: super_admin/system_admin da parent
--   auth_user_is_platform_admin()      — platform-level: super_admin/system_admin na parent
-- Para tabelas sem company_id direto: EXISTS com JOIN via landing_pages / whatsapp_life_instances
-- Idempotente: DROP POLICY IF EXISTS + CREATE POLICY
-- ============================================================

-- ============================================================
-- SEÇÃO 1: landing_pages
-- Removendo: 4 policies com companies.user_id ownership
-- Mantendo: SELECT anon por status = 'active' (necessário para páginas públicas)
-- Criando: 4 policies com Trilha 1 + Trilha 2
-- ============================================================

DROP POLICY IF EXISTS "Users can delete own landing pages"  ON landing_pages;
DROP POLICY IF EXISTS "Users can insert own landing pages"  ON landing_pages;
DROP POLICY IF EXISTS "Users can view own landing pages"    ON landing_pages;
DROP POLICY IF EXISTS "Users can update own landing pages"  ON landing_pages;

CREATE POLICY "lp_select_member_or_parent_admin"
ON landing_pages FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "lp_insert_member_or_parent_admin"
ON landing_pages FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "lp_update_member_or_parent_admin"
ON landing_pages FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "lp_delete_member_or_parent_admin"
ON landing_pages FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 2: analytics_cache
-- Sem company_id direto — derivado via landing_pages.company_id
-- Removendo: SELECT com companies.user_id chain
-- Criando: SELECT via EXISTS JOIN landing_pages + Trilha 1/2
-- ============================================================

DROP POLICY IF EXISTS "Users can view own analytics cache" ON analytics_cache;

CREATE POLICY "ac_select_member_or_parent_admin"
ON analytics_cache FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM landing_pages lp
    WHERE lp.id = analytics_cache.landing_page_id
      AND (
        auth_user_is_company_member(lp.company_id)
        OR auth_user_is_parent_admin(lp.company_id)
      )
  )
);

-- ============================================================
-- SEÇÃO 3: behavior_events
-- Sem company_id direto — derivado via visitors → landing_pages
-- Removendo: SELECT com companies.user_id chain de 3 nívels
-- Mantendo: INSERT anon WITH CHECK true (necessário para tracking)
-- Criando: SELECT via EXISTS JOIN visitors + landing_pages + Trilha 1/2
-- ============================================================

DROP POLICY IF EXISTS "Users can view behavior events of own visitors" ON behavior_events;

CREATE POLICY "be_select_member_or_parent_admin"
ON behavior_events FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM visitors v
    JOIN landing_pages lp ON lp.id = v.landing_page_id
    WHERE v.id = behavior_events.visitor_id
      AND (
        auth_user_is_company_member(lp.company_id)
        OR auth_user_is_parent_admin(lp.company_id)
      )
  )
);

-- ============================================================
-- SEÇÃO 4: conversions
-- Sem company_id direto — derivado via landing_pages
-- Removendo: SELECT com companies.user_id chain
-- Mantendo: INSERT anon WITH CHECK true (necessário para tracking)
-- Criando: SELECT via EXISTS JOIN landing_pages + Trilha 1/2
-- ============================================================

DROP POLICY IF EXISTS "Users can view own conversions" ON conversions;

CREATE POLICY "cv_select_member_or_parent_admin"
ON conversions FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM landing_pages lp
    WHERE lp.id = conversions.landing_page_id
      AND (
        auth_user_is_company_member(lp.company_id)
        OR auth_user_is_parent_admin(lp.company_id)
      )
  )
);

-- ============================================================
-- SEÇÃO 5: visitors
-- Sem company_id direto — derivado via landing_pages
-- Removendo:
--   SELECT autenticado com companies.user_id chain
--   SELECT anon com qual: true (expõe TODOS os visitantes publicamente)
-- Mantendo: INSERT anon WITH CHECK true (necessário para tracking)
-- Criando: SELECT autenticado via EXISTS JOIN landing_pages + Trilha 1/2
-- Nota: anon SELECT bloqueado intencionalmente — tracking script só precisa de INSERT
-- ============================================================

DROP POLICY IF EXISTS "Users can view visitors of own landing pages" ON visitors;
DROP POLICY IF EXISTS "Anonymous users can view visitors"            ON visitors;

CREATE POLICY "vis_select_member_or_parent_admin"
ON visitors FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM landing_pages lp
    WHERE lp.id = visitors.landing_page_id
      AND (
        auth_user_is_company_member(lp.company_id)
        OR auth_user_is_parent_admin(lp.company_id)
      )
  )
);

-- ============================================================
-- SEÇÃO 6: webhook_logs
-- Tem company_id direto
-- Removendo: SELECT com companies.user_id ownership
-- Criando: SELECT com Trilha 1 + Trilha 2
-- ============================================================

DROP POLICY IF EXISTS "Users can view own webhook logs" ON webhook_logs;

CREATE POLICY "wl_select_member_or_parent_admin"
ON webhook_logs FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 7: aws_credentials
-- Tem company_id direto — configuração sensível (credenciais S3)
-- Removendo: ALL com companies.user_id ownership
-- Criando: ALL restrito a admin-level (Trilha 1 admin) + Trilha 2
-- Razão: credenciais AWS são configuração crítica; membro comum não deve acessar
-- ============================================================

DROP POLICY IF EXISTS "aws_credentials_company_isolation" ON aws_credentials;

CREATE POLICY "awscred_all_admin_or_parent_admin"
ON aws_credentials FOR ALL TO authenticated
USING (
  auth_user_is_company_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_admin(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 8: chat_scheduled_messages — remover policies legadas
-- As 2 policies com companies.user_id ownership são removidas aqui
-- As 4 policies com company_users (sem is_active) serão corrigidas no Bloco 4C
-- ============================================================

DROP POLICY IF EXISTS "Users can manage scheduled messages for their companies" ON chat_scheduled_messages;
DROP POLICY IF EXISTS "Users can view scheduled messages from their companies"  ON chat_scheduled_messages;

-- ============================================================
-- SEÇÃO 9: plans
-- Sem company_id — tabela da plataforma (planos SaaS)
-- Removendo: ALL com companies.is_super_admin = true (legado)
-- Criando: ALL restrito a auth_user_is_platform_admin()
--   (super_admin ou system_admin ativos em empresa do tipo parent)
-- ============================================================

DROP POLICY IF EXISTS "Super admins can manage plans" ON plans;

CREATE POLICY "plans_all_platform_admin"
ON plans FOR ALL TO authenticated
USING (auth_user_is_platform_admin())
WITH CHECK (auth_user_is_platform_admin());

-- ============================================================
-- SEÇÃO 10: instance_webhook_configs
-- Sem company_id direto — derivado via whatsapp_life_instances
-- Removendo: policy com subquery corroída (lógica quebrada — efetivamente permissiva)
-- Criando: ALL via EXISTS JOIN whatsapp_life_instances + Trilha 1/2
-- ============================================================

DROP POLICY IF EXISTS "instance_webhook_configs_company_isolation" ON instance_webhook_configs;

CREATE POLICY "iwc_all_member_or_parent_admin"
ON instance_webhook_configs FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM whatsapp_life_instances wli
    WHERE wli.id = instance_webhook_configs.instance_id
      AND (
        auth_user_is_company_member(wli.company_id)
        OR auth_user_is_parent_admin(wli.company_id)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM whatsapp_life_instances wli
    WHERE wli.id = instance_webhook_configs.instance_id
      AND (
        auth_user_is_company_member(wli.company_id)
        OR auth_user_is_parent_admin(wli.company_id)
      )
  )
);
