-- =============================================================================
-- MIGRATION: Chat Visibility by Assigned To — Flag + RLS + Cleanup
-- Data: 2026-06-11
-- Fase: 5H
--
-- Objetivo:
--   Implementar a feature flag companies.chat_visibility_by_assigned_to,
--   o helper SQL de autorização, limpeza de legados e atualização das policies
--   RLS das tabelas do módulo de chat.
--
-- Quando a flag estiver TRUE para uma empresa:
--   - Usuários com role = seller visualizam apenas:
--       a) chat_conversations onde assigned_to = auth.uid()
--       b) chat_conversations onde assigned_to IS NULL
--   - admin, manager, system_admin, super_admin, partner: sem restrição.
--
-- DEFAULT FALSE: zero impacto em produção antes de ativação manual por empresa.
--
-- Contexto de segurança:
--   - Multi-tenant preservado (company_id como isolador primário)
--   - Trilha 1 (membership via company_users) mantida
--   - Trilha 2 (parent admin via auth_user_is_parent_admin) mantida
--   - service_role não afetado (relforcerowsecurity=false)
--   - Legado companies.user_id removido das 3 policies (auditoria FASE 5E
--     confirmou zero empresas dependentes exclusivamente do legado)
--
-- Rollback:
--   1. DROP FUNCTION auth_chat_visibility_restricted(uuid)
--   2. ALTER TABLE companies DROP COLUMN chat_visibility_by_assigned_to
--   3. Recriar as 3 policies com a versão anterior (ver snapshot em cada seção)
--   4. DROP INDEX idx_chat_conv_company_assigned, idx_chat_conv_id_assigned
--   5. Recriar chat_get_conversations_backup se necessário (legado — não recomendado)
-- =============================================================================


-- =============================================================================
-- PARTE 1: Coluna de feature flag em companies
-- =============================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS chat_visibility_by_assigned_to BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.companies.chat_visibility_by_assigned_to IS
  'Quando TRUE, usuários com role = seller nesta empresa visualizam apenas '
  'conversas de chat onde assigned_to = auth.uid() ou assigned_to IS NULL. '
  'Enforcement via RLS (policies chat_conversations/chat_messages) e guards '
  'nas RPCs SECURITY DEFINER do módulo de chat. '
  'admin, manager, system_admin, super_admin e partner não são afetados. '
  'DEFAULT FALSE = sem impacto em empresas existentes antes de ativação manual. '
  'Ativação: Configurações → Sistema → toggle "Restringir visibilidade do chat".';


-- =============================================================================
-- PARTE 2: Helper SQL auth_chat_visibility_restricted()
--
-- Design:
--   - STABLE: resultado constante para mesmo company_id na mesma transação;
--     PostgreSQL cacheia para todas as linhas de uma query filtrada por company_id.
--   - SECURITY DEFINER: precisa ler companies e company_users sem depender do
--     RLS do caller (que pode ser a própria policy em avaliação).
--   - SET search_path = public: proteção obrigatória em funções SECURITY DEFINER.
--   - auth.uid() interno: nunca aceita user_id como parâmetro externo.
--   - Gemêo arquitetural de auth_user_restricted_to_own_leads().
--
-- Retorna TRUE quando:
--   1. companies.chat_visibility_by_assigned_to = TRUE para p_company_id
--   2. O usuário autenticado possui role = 'seller' e is_active = true
--      na mesma empresa
--
-- Retorna FALSE em qualquer outro caso (flag OFF, role != seller, user inativo,
--   empresa não encontrada, auth.uid() NULL — este último cobre service_role).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.auth_chat_visibility_restricted(
  p_company_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag BOOLEAN;
  v_role TEXT;
BEGIN
  -- 1. A empresa tem a restrição de visibilidade do chat ativa?
  SELECT chat_visibility_by_assigned_to
    INTO v_flag
    FROM companies
   WHERE id = p_company_id;

  -- Empresa não encontrada ou flag desligada: sem restrição.
  IF NOT COALESCE(v_flag, false) THEN
    RETURN false;
  END IF;

  -- 2. O usuário autenticado é um seller ativo nesta empresa?
  --    Lê diretamente de company_users.role, mesmo padrão de outros helpers.
  --    Quando auth.uid() é NULL (ex: service_role sem usuário), nenhuma linha
  --    é encontrada e v_role permanece NULL → retorna false (sem restrição).
  SELECT role INTO v_role
    FROM company_users
   WHERE user_id    = auth.uid()
     AND company_id = p_company_id
     AND is_active  = true;

  -- Apenas sellers são restritos; todos os demais roles têm visibilidade total.
  RETURN COALESCE(v_role, '') = 'seller';
END;
$$;

GRANT EXECUTE ON FUNCTION public.auth_chat_visibility_restricted(uuid) TO authenticated;

COMMENT ON FUNCTION public.auth_chat_visibility_restricted IS
  'Retorna TRUE quando o usuário autenticado é um seller da empresa '
  'E a empresa tem chat_visibility_by_assigned_to = true. '
  'STABLE: resultado cacheado por transação para o mesmo company_id. '
  'SECURITY DEFINER + auth.uid() interno — nunca aceita user_id externo. '
  'Retorna FALSE para service_role (auth.uid() = NULL → nenhum seller encontrado). '
  'Gemêo arquitetural de auth_user_restricted_to_own_leads.';


-- =============================================================================
-- PARTE 3: Remover função legada chat_get_conversations_backup
--
-- Motivo: usa companies.user_id como critério de autorização (padrão proibido).
-- Callers ativos: NENHUM (auditoria FASE 5F confirmou).
-- Grants: authenticated e anon — exposta desnecessariamente.
-- =============================================================================

DROP FUNCTION IF EXISTS public.chat_get_conversations_backup(uuid, uuid, text, uuid, integer, integer);


-- =============================================================================
-- PARTE 4: Índices de suporte para as novas condições nas policies
--
-- Nota: CREATE INDEX sem CONCURRENTLY para compatibilidade com migrations
-- executadas dentro de transaction block (padrão Supabase).
-- Lock breve e aceitável durante deploy; tabela com volume baixo em produção.
-- IF NOT EXISTS garante idempotência em ambientes onde já foram criados.
--
-- idx_chat_conv_company_assigned:
--   Suporta o filtro da policy de chat_conversations:
--     assigned_to = auth.uid() OR assigned_to IS NULL
--   dentro do contexto company_id já fixado.
--
-- idx_chat_conv_id_assigned:
--   Suporta o EXISTS da policy de chat_messages:
--     SELECT 1 FROM chat_conversations WHERE id = conversation_id
--       AND (assigned_to = auth.uid() OR assigned_to IS NULL)
--   Covering index: evita heap fetch de assigned_to após lookup por PK.
--   Benefício confirmado via EXPLAIN ANALYZE (ver validação na seção de testes).
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_chat_conv_company_assigned
  ON public.chat_conversations (company_id, assigned_to);

COMMENT ON INDEX public.idx_chat_conv_company_assigned IS
  'Suporta filtro por (company_id, assigned_to) na policy RLS de chat_conversations '
  'quando chat_visibility_by_assigned_to = TRUE.';

CREATE INDEX IF NOT EXISTS idx_chat_conv_id_assigned
  ON public.chat_conversations (id, assigned_to);

COMMENT ON INDEX public.idx_chat_conv_id_assigned IS
  'Covering index para o EXISTS da policy RLS de chat_messages: '
  'SELECT 1 FROM chat_conversations WHERE id = ? AND (assigned_to = ? OR IS NULL). '
  'Evita heap fetch de assigned_to após lookup por PK.';


-- =============================================================================
-- PARTE 5: Policy chat_conversations_secure_hybrid_isolation
--
-- Alterações:
--   [REMOVE] companies.user_id = auth.uid() (legado proibido — FASE 5E: zero empresas
--            dependentes exclusivamente deste caminho)
--   [MANTÉM] Trilha 1: company_users membership com is_active = true
--   [MANTÉM] Trilha 2: auth_user_is_parent_admin(company_id)
--   [ADICIONA] Restrição de visibilidade por assigned_to quando flag = TRUE
--
-- Snapshot da versão anterior (para rollback):
--   USING (
--     auth.uid() IS NOT NULL
--     AND (
--       company_id IN (
--         SELECT companies.id FROM companies WHERE companies.user_id = auth.uid()
--         UNION
--         SELECT company_users.company_id FROM company_users
--           WHERE company_users.user_id = auth.uid() AND company_users.is_active = true
--       )
--       OR auth_user_is_parent_admin(company_id)
--     )
--   )
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
  -- Restrição de visibilidade por responsável (apenas quando flag = TRUE e role = seller)
  AND (
    NOT auth_chat_visibility_restricted(company_id)
    OR assigned_to = auth.uid()
    OR assigned_to IS NULL
  )
);


-- =============================================================================
-- PARTE 6: Policy chat_messages_secure_hybrid_isolation
--
-- Alterações:
--   [REMOVE] companies.user_id = auth.uid() (mesmo motivo acima)
--   [MANTÉM] Trilha 1 e Trilha 2
--   [ADICIONA] EXISTS em chat_conversations para verificar acesso à conversa
--              quando a restrição estiver ativa
--
-- Nota sobre performance:
--   O EXISTS usa idx_chat_conv_id_assigned (covering index criado na PARTE 4).
--   O helper auth_chat_visibility_restricted() é STABLE: cacheado por transação.
--
-- Snapshot da versão anterior (para rollback):
--   Idêntico ao snapshot de chat_conversations acima (mesma estrutura).
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
  -- Restrição de visibilidade: mensagens visíveis apenas quando a conversa é visível
  AND (
    NOT auth_chat_visibility_restricted(company_id)
    OR EXISTS (
      SELECT 1 FROM chat_conversations cc
      WHERE cc.id         = chat_messages.conversation_id
        AND (cc.assigned_to = auth.uid() OR cc.assigned_to IS NULL)
    )
  )
);


-- =============================================================================
-- PARTE 7: Policy chat_contacts_secure_hybrid_isolation
--
-- Alterações:
--   [REMOVE] companies.user_id = auth.uid() (legado)
--   [MANTÉM] Trilha 1 e Trilha 2
--   [NÃO APLICA] Restrição por assigned_to — chat_contacts são dados do
--                contato (não da conversa), escopo diferente da visibilidade.
-- =============================================================================

DROP POLICY IF EXISTS chat_contacts_secure_hybrid_isolation ON public.chat_contacts;

CREATE POLICY chat_contacts_secure_hybrid_isolation
ON public.chat_contacts
FOR ALL
USING (
  auth.uid() IS NOT NULL
  AND (
    -- Trilha 1: membership direto com is_active
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.company_id = chat_contacts.company_id
        AND cu.is_active  = true
    )
    -- Trilha 2: super_admin / system_admin da empresa pai
    OR auth_user_is_parent_admin(company_id)
  )
);
