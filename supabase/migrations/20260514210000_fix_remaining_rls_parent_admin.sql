-- Migration: adiciona suporte à Trilha 2 (parent admin) nas políticas RLS
-- das tabelas que ainda não tinham o fallback auth_user_is_parent_admin.
--
-- Tabelas corrigidas:
--   1. chat_conversations
--   2. chat_messages
--   3. chat_contacts
--   4. lead_activities  (política "Users can view public activities")
--   5. agent_conversation_sessions
--   6. agent_handoff_events
--   7. agent_routing_rules
--   8. company_agent_assignments
--
-- Nenhum comportamento existente é alterado para usuários com membership
-- direto — o fallback só é ativado quando auth_user_is_parent_admin retorna true.

-- ─── 1. chat_conversations ────────────────────────────────────────────────────

DROP POLICY IF EXISTS chat_conversations_secure_hybrid_isolation ON chat_conversations;

CREATE POLICY chat_conversations_secure_hybrid_isolation ON chat_conversations
  FOR ALL
  USING (
    auth.uid() IS NOT NULL
    AND (
      company_id IN (
        SELECT companies.id FROM companies WHERE companies.user_id = auth.uid()
        UNION
        SELECT company_users.company_id FROM company_users
        WHERE company_users.user_id = auth.uid() AND company_users.is_active = true
      )
      OR auth_user_is_parent_admin(company_id)
    )
  );

-- ─── 2. chat_messages ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS chat_messages_secure_hybrid_isolation ON chat_messages;

CREATE POLICY chat_messages_secure_hybrid_isolation ON chat_messages
  FOR ALL
  USING (
    auth.uid() IS NOT NULL
    AND (
      company_id IN (
        SELECT companies.id FROM companies WHERE companies.user_id = auth.uid()
        UNION
        SELECT company_users.company_id FROM company_users
        WHERE company_users.user_id = auth.uid() AND company_users.is_active = true
      )
      OR auth_user_is_parent_admin(company_id)
    )
  );

-- ─── 3. chat_contacts ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS chat_contacts_secure_hybrid_isolation ON chat_contacts;

CREATE POLICY chat_contacts_secure_hybrid_isolation ON chat_contacts
  FOR ALL
  USING (
    auth.uid() IS NOT NULL
    AND (
      company_id IN (
        SELECT companies.id FROM companies WHERE companies.user_id = auth.uid()
        UNION
        SELECT company_users.company_id FROM company_users
        WHERE company_users.user_id = auth.uid() AND company_users.is_active = true
      )
      OR auth_user_is_parent_admin(company_id)
    )
  );

-- ─── 4. lead_activities — "Users can view public activities" ──────────────────

DROP POLICY IF EXISTS "Users can view public activities" ON lead_activities;

CREATE POLICY "Users can view public activities" ON lead_activities
  FOR SELECT
  USING (
    (visibility)::text = 'public'::text
    AND (
      company_id IN (
        SELECT company_users.company_id FROM company_users
        WHERE company_users.user_id = auth.uid()
      )
      OR auth_user_is_parent_admin(company_id)
    )
  );

-- ─── 5. agent_conversation_sessions ──────────────────────────────────────────

DROP POLICY IF EXISTS sessions_select ON agent_conversation_sessions;

CREATE POLICY sessions_select ON agent_conversation_sessions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = agent_conversation_sessions.company_id
        AND cu.is_active  IS NOT FALSE
    )
    OR auth_user_is_parent_admin(company_id)
  );

-- ─── 6. agent_handoff_events ──────────────────────────────────────────────────

DROP POLICY IF EXISTS handoff_events_select ON agent_handoff_events;

CREATE POLICY handoff_events_select ON agent_handoff_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = agent_handoff_events.company_id
        AND cu.is_active  IS NOT FALSE
    )
    OR auth_user_is_parent_admin(company_id)
  );

-- ─── 7. agent_routing_rules ───────────────────────────────────────────────────

DROP POLICY IF EXISTS routing_rules_select ON agent_routing_rules;

CREATE POLICY routing_rules_select ON agent_routing_rules
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = agent_routing_rules.company_id
        AND cu.is_active  IS NOT FALSE
    )
    OR auth_user_is_parent_admin(company_id)
  );

DROP POLICY IF EXISTS routing_rules_insert ON agent_routing_rules;

CREATE POLICY routing_rules_insert ON agent_routing_rules
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = agent_routing_rules.company_id
        AND cu.role       = ANY (ARRAY['super_admin'::text, 'system_admin'::text, 'admin'::text])
        AND cu.is_active  IS NOT FALSE
    )
    OR auth_user_is_parent_admin(company_id)
  );

DROP POLICY IF EXISTS routing_rules_update ON agent_routing_rules;

CREATE POLICY routing_rules_update ON agent_routing_rules
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = agent_routing_rules.company_id
        AND cu.role       = ANY (ARRAY['super_admin'::text, 'system_admin'::text, 'admin'::text])
        AND cu.is_active  IS NOT FALSE
    )
    OR auth_user_is_parent_admin(company_id)
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = agent_routing_rules.company_id
        AND cu.role       = ANY (ARRAY['super_admin'::text, 'system_admin'::text, 'admin'::text])
        AND cu.is_active  IS NOT FALSE
    )
    OR auth_user_is_parent_admin(company_id)
  );

-- ─── 8. company_agent_assignments ─────────────────────────────────────────────

DROP POLICY IF EXISTS assignments_select ON company_agent_assignments;

CREATE POLICY assignments_select ON company_agent_assignments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = company_agent_assignments.company_id
        AND cu.is_active  IS NOT FALSE
    )
    OR auth_user_is_parent_admin(company_id)
  );

DROP POLICY IF EXISTS assignments_insert ON company_agent_assignments;

CREATE POLICY assignments_insert ON company_agent_assignments
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = company_agent_assignments.company_id
        AND cu.role       = ANY (ARRAY['super_admin'::text, 'system_admin'::text, 'admin'::text])
        AND cu.is_active  IS NOT FALSE
    )
    OR auth_user_is_parent_admin(company_id)
  );

DROP POLICY IF EXISTS assignments_update ON company_agent_assignments;

CREATE POLICY assignments_update ON company_agent_assignments
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = company_agent_assignments.company_id
        AND cu.role       = ANY (ARRAY['super_admin'::text, 'system_admin'::text, 'admin'::text])
        AND cu.is_active  IS NOT FALSE
    )
    OR auth_user_is_parent_admin(company_id)
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = company_agent_assignments.company_id
        AND cu.role       = ANY (ARRAY['super_admin'::text, 'system_admin'::text, 'admin'::text])
        AND cu.is_active  IS NOT FALSE
    )
    OR auth_user_is_parent_admin(company_id)
  );
