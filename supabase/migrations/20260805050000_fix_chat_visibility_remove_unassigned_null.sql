-- =============================================================================
-- MIGRATION: Remover OR assigned_to IS NULL das policies RLS do chat
-- Data: 2026-08-05
--
-- Contexto:
--   A policy chat_conversations_secure_hybrid_isolation (e sua contraparte
--   em chat_messages) permitia que sellers vissem conversas com assigned_to IS NULL
--   mesmo quando a empresa tem chat_visibility_by_assigned_to = TRUE.
--   Isso criava uma brecha: o lead estava protegido pelo restrict_leads_to_owner,
--   mas era acessível pelo módulo de chat via conversa não atribuída.
--
-- Mudança:
--   Remover a cláusula OR assigned_to IS NULL de ambas as policies.
--   Sellers em empresas com chat_visibility_by_assigned_to = TRUE passam a ver
--   APENAS conversas onde assigned_to = auth.uid().
--
-- Impacto:
--   - Empresas com chat_visibility_by_assigned_to = FALSE: sem impacto (flag OFF
--     faz auth_chat_visibility_restricted retornar FALSE → sem restrição aplicada).
--   - Empresas com chat_visibility_by_assigned_to = TRUE: sellers não visualizam
--     mais conversas sem responsável (assigned_to IS NULL).
--   - admin, manager, super_admin, system_admin, partner: sem impacto (a função
--     auth_chat_visibility_restricted retorna FALSE para esses roles).
--
-- Empresas afetadas no momento da migration:
--   - IC | Campo Limpo (restrict_leads_to_owner = true)
--   - M4 Digital       (restrict_leads_to_owner = true)
--
-- Rollback:
--   Recriar as policies abaixo com OR assigned_to IS NULL e
--   OR cc.assigned_to IS NULL restaurados.
-- =============================================================================


-- =============================================================================
-- POLICY 1: chat_conversations_secure_hybrid_isolation
-- =============================================================================

DROP POLICY IF EXISTS chat_conversations_secure_hybrid_isolation ON public.chat_conversations;

CREATE POLICY chat_conversations_secure_hybrid_isolation
ON public.chat_conversations
FOR ALL
USING (
  auth.uid() IS NOT NULL
  AND (
    -- Trilha 1: membership direto com is_active
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = chat_conversations.company_id
        AND cu.is_active  = true
    )
    -- Trilha 2: super_admin / system_admin da empresa pai
    OR auth_user_is_parent_admin(company_id)
  )
  -- Restrição de visibilidade: quando flag = TRUE e role = seller,
  -- apenas conversas atribuídas ao próprio usuário são visíveis.
  -- Conversas com assigned_to IS NULL não são mais expostas a sellers restritos.
  AND (
    NOT auth_chat_visibility_restricted(company_id)
    OR assigned_to = auth.uid()
  )
);


-- =============================================================================
-- POLICY 2: chat_messages_secure_hybrid_isolation
-- =============================================================================

DROP POLICY IF EXISTS chat_messages_secure_hybrid_isolation ON public.chat_messages;

CREATE POLICY chat_messages_secure_hybrid_isolation
ON public.chat_messages
FOR ALL
USING (
  auth.uid() IS NOT NULL
  AND (
    -- Trilha 1: membership direto com is_active
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = chat_messages.company_id
        AND cu.is_active  = true
    )
    -- Trilha 2: super_admin / system_admin da empresa pai
    OR auth_user_is_parent_admin(company_id)
  )
  -- Mensagens visíveis apenas quando a conversa é visível para o usuário.
  -- Alinhado com chat_conversations: sem OR cc.assigned_to IS NULL.
  AND (
    NOT auth_chat_visibility_restricted(company_id)
    OR EXISTS (
      SELECT 1 FROM chat_conversations cc
      WHERE cc.id         = chat_messages.conversation_id
        AND cc.assigned_to = auth.uid()
    )
  )
);
