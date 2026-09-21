-- =============================================================================
-- MVP3E: Enable Meta WhatsApp Realtime
-- Migration: 20260921200000_enable_meta_whatsapp_realtime.sql
-- =============================================================================
--
-- ESCOPO:
--   Habilita Supabase Realtime para meta_conversations e meta_messages.
--
-- OPERAÇÕES (nesta ordem deliberada):
--   1. CREATE POLICY SELECT em meta_conversations
--   2. CREATE POLICY SELECT em meta_messages
--   3. GRANT SELECT TO authenticated
--   4. ALTER TABLE meta_conversations REPLICA IDENTITY FULL
--   5. ALTER PUBLICATION supabase_realtime ADD TABLE (idempotente)
--
-- ORDEM JUSTIFICADA:
--   Policies → GRANT → REPLICA IDENTITY → Publication.
--   Garante que toda proteção RLS esteja configurada antes de qualquer
--   evento Realtime começar a fluir. Não existe janela em que a publication
--   esteja ativa sem policy ou sem grant.
--
-- AUTORIZAÇÃO IMPLEMENTADA:
--   Replica fielmente o validateMetaCaller (viewMode / META_VIEW_ROLES).
--
--   Trilha 1 — membros diretos (não-partner):
--     company_users: user_id=auth.uid(), company_id=row.company_id, is_active=true
--     role ∈ {super_admin, system_admin, admin, manager, seller}
--     Fonte: company_users_role_check constraint
--
--   Trilha 1 — partner:
--     company_users: user_id=auth.uid(), company_id=row.company_id,
--                    is_active=true, role='partner'
--     + partner_company_assignments: partner_user_id=auth.uid(),
--                                    company_id=row.company_id, is_active=true
--     AMBOS obrigatórios — role partner sozinho não concede acesso.
--
--   Trilha 2 — parent → child:
--     auth_user_is_parent_admin(row.company_id)
--     Limita-se a super_admin/system_admin da empresa pai direta.
--
--   Feature flag (obrigatória, alinhada com validateMetaCaller):
--     companies.meta_whatsapp_enabled = true para a empresa da row.
--     Condição aplicada ANTES da verificação de roles (AND estrutural).
--
-- ÍNDICES RELEVANTES (verificados — não criar nada nesta migration):
--   company_users:
--     idx_company_users_company_user (company_id, user_id) ✅
--     idx_company_users_role (role) ✅
--     idx_company_users_active (is_active) ✅
--   partner_company_assignments:
--     idx_pca_partner_active (partner_user_id, company_id, is_active) ✅
--   companies:
--     PK (id) ✅ — lookup por PK, sem índice em meta_whatsapp_enabled necessário
--
-- NÃO ALTERADO:
--   Uazapi / chat_conversations / chat_messages
--   Instagram / instagram_conversations / instagram_messages
--   Nenhum RPC existente
--   Nenhum webhook
--   Nenhuma policy existente removida
--   RLS não desabilitado em nenhum momento
--   service_role não alterado
--   anon sem acesso
--
-- EXPOSIÇÃO ADICIONAL CONHECIDA (consequência do GRANT SELECT):
--   SELECT direto pelo frontend autenticado (sob RLS) passará a expor:
--     meta_conversations.company_id
--     meta_messages.company_id
--     meta_messages.meta_message_id   (wamid — identificador Meta opaco)
--     meta_messages.updated_at
--   Esses campos não são retornados pelos endpoints GET hoje.
--   São aceitos como consequência necessária do Realtime.
--   Nenhum campo de credencial, secret ou token é exposto.
--
-- IMPACTO EM PRODUÇÃO:
--   Banco compartilhado entre LovooDev e LovooCRM.
--   Esta migration afeta ambos imediatamente após aplicação (Etapa A do rollout).
--   Etapa B (frontend Realtime) só ocorrerá após validação do banco.
-- =============================================================================


-- =============================================================================
-- SEÇÃO 1: RLS POLICY — meta_conversations
-- =============================================================================

-- Garantia defensiva: não falha se a policy já existir por reruns de migration.
DROP POLICY IF EXISTS "meta_conversations_select_meta_view" ON public.meta_conversations;

CREATE POLICY "meta_conversations_select_meta_view"
  ON public.meta_conversations
  FOR SELECT
  TO authenticated
  USING (
    -- ── Feature flag (obrigatória — alinha com validateMetaCaller) ────────────
    --    Verificada primeiro: se flag=false, short-circuit → deny.
    --    Evita que SELECT direto ou Realtime seja mais permissivo que os GETs.
    (
      EXISTS (
        SELECT 1
        FROM public.companies c
        WHERE c.id                    = meta_conversations.company_id
          AND c.meta_whatsapp_enabled = true
      )
    )

    AND

    -- ── Autorização: pelo menos uma trilha deve ser verdadeira ────────────────
    (
      -- Trilha 1a: membership direta — roles não-partner
      --   company_users ativo com role explícito na matriz META_VIEW_ROLES (exceto 'partner').
      --   Uso de meta_conversations.company_id elimina ambiguidade da referência.
      (
        EXISTS (
          SELECT 1
          FROM public.company_users cu
          WHERE cu.user_id    = auth.uid()
            AND cu.company_id = meta_conversations.company_id
            AND cu.is_active  = true
            AND cu.role       IN ('super_admin', 'system_admin', 'admin', 'manager', 'seller')
        )
      )

      OR

      -- Trilha 1b: membership direta — partner com assignment ativo
      --   Role 'partner' exige ADICIONALMENTE vínculo ativo em
      --   partner_company_assignments. Role sozinho não é suficiente.
      --   idx_pca_partner_active (partner_user_id, company_id, is_active) cobre o JOIN.
      (
        EXISTS (
          SELECT 1
          FROM public.company_users cu
          JOIN public.partner_company_assignments pca
            ON  pca.partner_user_id = cu.user_id
            AND pca.company_id      = cu.company_id
            AND pca.is_active       = true
          WHERE cu.user_id    = auth.uid()
            AND cu.company_id = meta_conversations.company_id
            AND cu.is_active  = true
            AND cu.role       = 'partner'
        )
      )

      OR

      -- Trilha 2: super_admin / system_admin de empresa pai → empresa filha
      --   auth_user_is_parent_admin verifica: child.parent_company_id IS NOT NULL
      --   + company_users da parent com role IN ('super_admin','system_admin') + is_active=true.
      --   Um super_admin de Parent A não acessa empresas de Parent B.
      (
        public.auth_user_is_parent_admin(meta_conversations.company_id)
      )
    )
  );

COMMENT ON POLICY "meta_conversations_select_meta_view" ON public.meta_conversations IS
'MVP3E Realtime: SELECT para authenticated alinhado com META_VIEW_ROLES.
Exige feature flag ON + (membership ativa | partner com assignment | parent admin).
Replica fielmente validateMetaCaller exceto pela ausência de validação de JWT Bearer
(auth JWT do Supabase substitui essa camada).';


-- =============================================================================
-- SEÇÃO 2: RLS POLICY — meta_messages
-- =============================================================================

-- Garantia defensiva: não falha se a policy já existir por reruns de migration.
DROP POLICY IF EXISTS "meta_messages_select_meta_view" ON public.meta_messages;

CREATE POLICY "meta_messages_select_meta_view"
  ON public.meta_messages
  FOR SELECT
  TO authenticated
  USING (
    -- ── Feature flag (obrigatória — idêntica à policy de meta_conversations) ──
    --    Fronteira de segurança pelo company_id da própria row de mensagem.
    --    conversation_id NÃO é usado como fronteira de tenant aqui.
    (
      EXISTS (
        SELECT 1
        FROM public.companies c
        WHERE c.id                    = meta_messages.company_id
          AND c.meta_whatsapp_enabled = true
      )
    )

    AND

    -- ── Autorização: pelo menos uma trilha deve ser verdadeira ────────────────
    (
      -- Trilha 1a: membership direta — roles não-partner
      (
        EXISTS (
          SELECT 1
          FROM public.company_users cu
          WHERE cu.user_id    = auth.uid()
            AND cu.company_id = meta_messages.company_id
            AND cu.is_active  = true
            AND cu.role       IN ('super_admin', 'system_admin', 'admin', 'manager', 'seller')
        )
      )

      OR

      -- Trilha 1b: partner com assignment ativo
      (
        EXISTS (
          SELECT 1
          FROM public.company_users cu
          JOIN public.partner_company_assignments pca
            ON  pca.partner_user_id = cu.user_id
            AND pca.company_id      = cu.company_id
            AND pca.is_active       = true
          WHERE cu.user_id    = auth.uid()
            AND cu.company_id = meta_messages.company_id
            AND cu.is_active  = true
            AND cu.role       = 'partner'
        )
      )

      OR

      -- Trilha 2: super_admin / system_admin de empresa pai → empresa filha
      (
        public.auth_user_is_parent_admin(meta_messages.company_id)
      )
    )
  );

COMMENT ON POLICY "meta_messages_select_meta_view" ON public.meta_messages IS
'MVP3E Realtime: SELECT para authenticated alinhado com META_VIEW_ROLES.
Exige feature flag ON + (membership ativa | partner com assignment | parent admin).
Isolamento de tenant pelo company_id da própria row — conversation_id não é
fronteira de segurança. Idêntica em estrutura a meta_conversations_select_meta_view.';


-- =============================================================================
-- SEÇÃO 3: GRANT SELECT TO authenticated
-- =============================================================================
--
-- GRANT SELECT é necessário para:
--   a) Supabase Realtime entregar eventos ao frontend (channel subscription)
--   b) Frontend Supabase client realizar SELECT direto (sob RLS)
--
-- CONCEDIDO APENAS:
--   SELECT — leitura somente
--   authenticated — usuários com JWT válido
--
-- NÃO CONCEDIDO:
--   INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   anon (nenhum acesso)
--
-- Grants do service_role e postgres não são alterados.
--
-- CONSEQUÊNCIA CONHECIDA (documentada no cabeçalho):
--   SELECT direto expõe company_id, meta_message_id e updated_at
--   além dos campos retornados pelos endpoints GET.
--   Aceito como necessidade do Realtime.
-- =============================================================================

GRANT SELECT ON public.meta_conversations TO authenticated;
GRANT SELECT ON public.meta_messages      TO authenticated;


-- =============================================================================
-- SEÇÃO 4: REPLICA IDENTITY
-- =============================================================================
--
-- meta_conversations: FULL obrigatório.
--   Motivo: eventos UPDATE precisam incluir company_id no payload WAL
--   para que o filtro "company_id=eq.<id>" do postgres_changes funcione
--   corretamente. Com DEFAULT replica identity, company_id pode estar
--   ausente do payload UPDATE (apenas PK + colunas alteradas), causando
--   falha silenciosa de filtragem.
--
-- meta_messages: DEFAULT mantido.
--   Motivo: MVP3E usa somente eventos INSERT em meta_messages. Para INSERT,
--   DEFAULT replica identity já inclui todas as colunas no payload WAL.
--   O filtro "conversation_id=eq.<id>" funciona corretamente para INSERT.
--   Não aplicar FULL desnecessariamente — minimiza impacto no banco.
-- =============================================================================

ALTER TABLE public.meta_conversations REPLICA IDENTITY FULL;

-- meta_messages: NENHUMA alteração de replica identity (permanece DEFAULT).


-- =============================================================================
-- SEÇÃO 5: SUPABASE REALTIME PUBLICATION (idempotente)
-- =============================================================================
--
-- Usa bloco DO/IF NOT EXISTS para evitar erro se tabela já estiver
-- na publication. Garante que a operação seja segura em reruns.
--
-- Verificado antes da execução:
--   supabase_realtime atualmente contém:
--     chat_conversations, chat_messages,
--     instagram_comments, instagram_connections, instagram_conversations,
--     instagram_message_reactions, instagram_messages,
--     opportunity_funnel_positions
--   meta_conversations e meta_messages: NÃO estão na publication.
--
-- Este bloco NÃO remove nenhuma tabela existente.
-- =============================================================================

DO $$
BEGIN
  -- Adicionar meta_conversations à publication, se ainda não estiver.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname    = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'meta_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.meta_conversations;
  END IF;

  -- Adicionar meta_messages à publication, se ainda não estiver.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname    = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'meta_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.meta_messages;
  END IF;
END $$;


-- =============================================================================
-- FIM DA MIGRATION
-- =============================================================================
--
-- VALIDAÇÃO ESPERADA PÓS-APLICAÇÃO (Etapa A do rollout):
--
--   SELECT via authenticated JWT de admin própria company + flag ON  → rows ✅
--   SELECT via authenticated JWT de seller própria company + flag ON → rows ✅
--   SELECT via authenticated JWT de partner + assignment + flag ON   → rows ✅
--   SELECT via authenticated JWT de partner SEM assignment           → sem rows ✅
--   SELECT via authenticated JWT de usuário company diferente        → sem rows ✅
--   SELECT via authenticated JWT + flag OFF                          → sem rows ✅
--   SELECT via anon / sem JWT                                        → erro 401 ✅
--
--   pg_publication_tables deve conter meta_conversations e meta_messages ✅
--   pg_class.relreplident para meta_conversations deve ser 'f' (FULL) ✅
--   pg_class.relreplident para meta_messages permanece 'd' (DEFAULT) ✅
--   pg_policies deve conter as duas novas policies ✅
--   information_schema.role_table_grants deve conter SELECT para authenticated ✅
-- =============================================================================
