-- ============================================================
-- BLOCO 3: Correções de Alto Impacto — RLS Multi-Tenant
-- Tabelas: whatsapp_life_instances, lovoo_agents, lovoo_agent_documents,
--          ai_agent_execution_logs, agent_use_bindings, integration_settings,
--          automation_flows, automation_schedules, automation_templates
-- Nota: automation_executions e automation_logs já foram corrigidos no Bloco 1
-- Helpers usados:
--   auth_user_is_company_member(company_id)  — Trilha 1: qualquer membro ativo
--   auth_user_is_company_admin(company_id)   — Trilha 1: admin-level
--   auth_user_is_parent_admin(company_id)    — Trilha 2: super_admin/system_admin da parent
-- Idempotente: DROP POLICY IF EXISTS + CREATE POLICY
-- ============================================================

-- ============================================================
-- SEÇÃO 1: whatsapp_life_instances
-- Removendo:
--   whatsapp_life_instances_company_isolation (ALL, ownership companies.user_id)
--   webhook_access_whatsapp_instances (SELECT, anônimo + ownership)
--   whatsapp_instances_member_select (SELECT, hybrid ownership + member)
-- Criando:
--   SELECT autenticado: Trilha 1 (qualquer membro) + Trilha 2 (parent admin)
--   SELECT anônimo: preservado estritamente para leitura de webhook sem JWT
--   INSERT/UPDATE/DELETE: Trilha 1 (qualquer membro) + Trilha 2 (parent admin)
-- ============================================================

DROP POLICY IF EXISTS "whatsapp_life_instances_company_isolation" ON whatsapp_life_instances;
DROP POLICY IF EXISTS "webhook_access_whatsapp_instances"          ON whatsapp_life_instances;
DROP POLICY IF EXISTS "whatsapp_instances_member_select"           ON whatsapp_life_instances;

-- SELECT para usuários autenticados: Trilha 1 + Trilha 2
CREATE POLICY "wli_select_member_or_parent_admin"
ON whatsapp_life_instances FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- SELECT anônimo: preservado para webhooks que consultam instâncias sem JWT
-- (service_role já bypassa RLS; esta policy cobre apenas processos anon)
CREATE POLICY "wli_select_anonymous_webhook"
ON whatsapp_life_instances FOR SELECT TO anon
USING (auth.uid() IS NULL);

-- INSERT: qualquer membro ativo da empresa ou parent admin
CREATE POLICY "wli_insert_member_or_parent_admin"
ON whatsapp_life_instances FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- UPDATE: Trilha 1 + Trilha 2 com WITH CHECK para impedir troca de company_id
CREATE POLICY "wli_update_member_or_parent_admin"
ON whatsapp_life_instances FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- DELETE: Trilha 1 + Trilha 2
CREATE POLICY "wli_delete_member_or_parent_admin"
ON whatsapp_life_instances FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 2: lovoo_agents
-- Tem company_id direto na tabela
-- Removendo: UUID hardcoded + companies.is_super_admin em todas as 4 policies
-- Criando: admin-level da empresa do agente (Trilha 1 admin)
-- Nota: esses são agentes da plataforma — company_id aponta para a empresa parent
--       auth_user_is_parent_admin não se aplica (parent não tem parent acima dela)
-- ============================================================

DROP POLICY IF EXISTS "lovoo_agents_select" ON lovoo_agents;
DROP POLICY IF EXISTS "lovoo_agents_insert" ON lovoo_agents;
DROP POLICY IF EXISTS "lovoo_agents_update" ON lovoo_agents;
DROP POLICY IF EXISTS "lovoo_agents_delete" ON lovoo_agents;

CREATE POLICY "la_select_company_admin"
ON lovoo_agents FOR SELECT TO authenticated
USING (
  auth_user_is_company_admin(company_id)
);

CREATE POLICY "la_insert_company_admin"
ON lovoo_agents FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_admin(company_id)
);

CREATE POLICY "la_update_company_admin"
ON lovoo_agents FOR UPDATE TO authenticated
USING (
  auth_user_is_company_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_admin(company_id)
);

CREATE POLICY "la_delete_company_admin"
ON lovoo_agents FOR DELETE TO authenticated
USING (
  auth_user_is_company_admin(company_id)
);

-- ============================================================
-- SEÇÃO 3: lovoo_agent_documents
-- Sem company_id direto — derivado via lovoo_agents.company_id usando agent_id
-- Removendo: UUID hardcoded + companies.is_super_admin em todas as 4 policies
-- Criando: admin-level da empresa do agente via subquery
-- ============================================================

DROP POLICY IF EXISTS "lovoo_agent_documents_select" ON lovoo_agent_documents;
DROP POLICY IF EXISTS "lovoo_agent_documents_insert" ON lovoo_agent_documents;
DROP POLICY IF EXISTS "lovoo_agent_documents_update" ON lovoo_agent_documents;
DROP POLICY IF EXISTS "lovoo_agent_documents_delete" ON lovoo_agent_documents;

CREATE POLICY "lad_select_company_admin"
ON lovoo_agent_documents FOR SELECT TO authenticated
USING (
  auth_user_is_company_admin(
    (SELECT la.company_id FROM lovoo_agents la WHERE la.id = lovoo_agent_documents.agent_id)
  )
);

CREATE POLICY "lad_insert_company_admin"
ON lovoo_agent_documents FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_admin(
    (SELECT la.company_id FROM lovoo_agents la WHERE la.id = lovoo_agent_documents.agent_id)
  )
);

CREATE POLICY "lad_update_company_admin"
ON lovoo_agent_documents FOR UPDATE TO authenticated
USING (
  auth_user_is_company_admin(
    (SELECT la.company_id FROM lovoo_agents la WHERE la.id = lovoo_agent_documents.agent_id)
  )
)
WITH CHECK (
  auth_user_is_company_admin(
    (SELECT la.company_id FROM lovoo_agents la WHERE la.id = lovoo_agent_documents.agent_id)
  )
);

CREATE POLICY "lad_delete_company_admin"
ON lovoo_agent_documents FOR DELETE TO authenticated
USING (
  auth_user_is_company_admin(
    (SELECT la.company_id FROM lovoo_agents la WHERE la.id = lovoo_agent_documents.agent_id)
  )
);

-- ============================================================
-- SEÇÃO 4: ai_agent_execution_logs
-- Sem company_id — derivado via lovoo_agents.company_id usando agent_id
-- Somente SELECT (INSERT é feito por service_role)
-- Removendo: UUID hardcoded + companies.is_super_admin
-- Criando: admin-level via subquery
-- ============================================================

DROP POLICY IF EXISTS "ai_agent_logs_select" ON ai_agent_execution_logs;

CREATE POLICY "aael_select_company_admin"
ON ai_agent_execution_logs FOR SELECT TO authenticated
USING (
  auth_user_is_company_admin(
    (SELECT la.company_id FROM lovoo_agents la WHERE la.id = ai_agent_execution_logs.agent_id)
  )
);

-- ============================================================
-- SEÇÃO 5: agent_use_bindings
-- Sem company_id — derivado via lovoo_agents.company_id usando agent_id
-- Removendo:
--   SELECT = true (qualquer autenticado — cross-tenant risk)
--   DML: UUID hardcoded + companies.is_super_admin
-- Criando:
--   SELECT: qualquer membro ativo da empresa do agente
--   INSERT/UPDATE/DELETE: admin-level da empresa do agente
-- ============================================================

DROP POLICY IF EXISTS "agent_use_bindings_select" ON agent_use_bindings;
DROP POLICY IF EXISTS "agent_use_bindings_insert" ON agent_use_bindings;
DROP POLICY IF EXISTS "agent_use_bindings_update" ON agent_use_bindings;
DROP POLICY IF EXISTS "agent_use_bindings_delete" ON agent_use_bindings;

CREATE POLICY "aub_select_company_member"
ON agent_use_bindings FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(
    (SELECT la.company_id FROM lovoo_agents la WHERE la.id = agent_use_bindings.agent_id)
  )
);

CREATE POLICY "aub_insert_company_admin"
ON agent_use_bindings FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_admin(
    (SELECT la.company_id FROM lovoo_agents la WHERE la.id = agent_use_bindings.agent_id)
  )
);

CREATE POLICY "aub_update_company_admin"
ON agent_use_bindings FOR UPDATE TO authenticated
USING (
  auth_user_is_company_admin(
    (SELECT la.company_id FROM lovoo_agents la WHERE la.id = agent_use_bindings.agent_id)
  )
)
WITH CHECK (
  auth_user_is_company_admin(
    (SELECT la.company_id FROM lovoo_agents la WHERE la.id = agent_use_bindings.agent_id)
  )
);

CREATE POLICY "aub_delete_company_admin"
ON agent_use_bindings FOR DELETE TO authenticated
USING (
  auth_user_is_company_admin(
    (SELECT la.company_id FROM lovoo_agents la WHERE la.id = agent_use_bindings.agent_id)
  )
);

-- ============================================================
-- SEÇÃO 6: integration_settings
-- Tem company_id direto
-- Removendo: UUID hardcoded + companies.is_super_admin (SELECT, INSERT, UPDATE)
-- Criando: admin-level da empresa (system_admin agora incluso via helper atualizado)
-- Nota: sem DELETE policy — service_role ou ausência de policy bloqueia DELETE para authenticated
-- ============================================================

DROP POLICY IF EXISTS "integration_settings_select_parent_admins" ON integration_settings;
DROP POLICY IF EXISTS "integration_settings_insert_parent_admins" ON integration_settings;
DROP POLICY IF EXISTS "integration_settings_update_parent_admins" ON integration_settings;

CREATE POLICY "is_select_company_admin"
ON integration_settings FOR SELECT TO authenticated
USING (
  auth_user_is_company_admin(company_id)
);

CREATE POLICY "is_insert_company_admin"
ON integration_settings FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_admin(company_id)
);

CREATE POLICY "is_update_company_admin"
ON integration_settings FOR UPDATE TO authenticated
USING (
  auth_user_is_company_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_admin(company_id)
);

-- ============================================================
-- SEÇÃO 7: automation_flows
-- Removendo: 8 policies duplicadas sem is_active (2 por operação)
-- Criando: 4 policies limpas com Trilha 1 + Trilha 2
-- auth_user_is_company_member já filtra is_active internamente
-- ============================================================

DROP POLICY IF EXISTS "Users can delete flows from their company" ON automation_flows;
DROP POLICY IF EXISTS "automation_flows_delete_policy"            ON automation_flows;
DROP POLICY IF EXISTS "Users can create flows for their company"  ON automation_flows;
DROP POLICY IF EXISTS "automation_flows_insert_policy"            ON automation_flows;
DROP POLICY IF EXISTS "Users can view flows from their company"   ON automation_flows;
DROP POLICY IF EXISTS "automation_flows_select_policy"            ON automation_flows;
DROP POLICY IF EXISTS "Users can update flows from their company" ON automation_flows;
DROP POLICY IF EXISTS "automation_flows_update_policy"            ON automation_flows;

CREATE POLICY "af_select_member_or_parent_admin"
ON automation_flows FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "af_insert_member_or_parent_admin"
ON automation_flows FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "af_update_member_or_parent_admin"
ON automation_flows FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "af_delete_member_or_parent_admin"
ON automation_flows FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 8: automation_schedules
-- Removendo:
--   "System can create schedules" — WITH CHECK true (qualquer autenticado cria cross-tenant)
--   "System can update schedules" — USING/WITH CHECK true (idem para UPDATE)
--   "Users can view schedules from their company"   — sem is_active
--   "Users can delete schedules from their company" — sem is_active
-- Criando: 4 policies limpas com Trilha 1 + Trilha 2
-- ============================================================

DROP POLICY IF EXISTS "System can create schedules"                  ON automation_schedules;
DROP POLICY IF EXISTS "System can update schedules"                  ON automation_schedules;
DROP POLICY IF EXISTS "Users can view schedules from their company"  ON automation_schedules;
DROP POLICY IF EXISTS "Users can delete schedules from their company" ON automation_schedules;

CREATE POLICY "as_select_member_or_parent_admin"
ON automation_schedules FOR SELECT TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "as_insert_member_or_parent_admin"
ON automation_schedules FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "as_update_member_or_parent_admin"
ON automation_schedules FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "as_delete_member_or_parent_admin"
ON automation_schedules FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

-- ============================================================
-- SEÇÃO 9: automation_templates
-- Removendo: 4 policies sem is_active
-- Criando: 4 policies com Trilha 1 + Trilha 2
-- SELECT preserva lógica de templates públicos e de sistema (is_public, is_system)
-- ============================================================

DROP POLICY IF EXISTS "Users can delete templates from their company"          ON automation_templates;
DROP POLICY IF EXISTS "Users can create templates for their company"            ON automation_templates;
DROP POLICY IF EXISTS "Users can view public, system or company templates"      ON automation_templates;
DROP POLICY IF EXISTS "Users can update templates from their company"           ON automation_templates;

-- SELECT: templates públicos/sistema são visíveis para qualquer autenticado;
--         templates de empresa requerem membership ativo ou parent admin
CREATE POLICY "at_select_public_or_member_or_parent_admin"
ON automation_templates FOR SELECT TO authenticated
USING (
  is_public = true
  OR is_system = true
  OR auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "at_insert_member_or_parent_admin"
ON automation_templates FOR INSERT TO authenticated
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "at_update_member_or_parent_admin"
ON automation_templates FOR UPDATE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
)
WITH CHECK (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);

CREATE POLICY "at_delete_member_or_parent_admin"
ON automation_templates FOR DELETE TO authenticated
USING (
  auth_user_is_company_member(company_id)
  OR auth_user_is_parent_admin(company_id)
);
