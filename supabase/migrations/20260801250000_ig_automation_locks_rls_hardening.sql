-- =====================================================================
-- Migration I — Hardening RLS: bloquear mutações diretas em
--   automation_conversation_locks para usuários authenticated
--
-- Problema identificado na homologação:
--   As policies de INSERT, UPDATE e DELETE criadas na Migration E
--   permitem que qualquer membro autenticado realize mutações diretas
--   via PostgREST, contornando a atomicidade das RPCs de lease.
--
-- Impacto do problema original:
--   - Membro pode inserir lock falso → bloqueia cron indefinidamente
--   - Membro pode deletar lock ativo → permite duas execuções simultâneas
--   - Membro pode atualizar expires_at → estende lease arbitrariamente
--   Não exige acesso ao frontend; chamada curl autenticada é suficiente.
--
-- Solução:
--   Substituir as policies permissivas por policies que bloqueiam
--   completamente INSERT, UPDATE e DELETE para authenticated.
--   SELECT mantido (monitoramento é legítimo).
--   service_role bypassa RLS inteiramente → RPCs (SECURITY DEFINER)
--   continuam funcionando normalmente.
-- =====================================================================

-- Remover policies permissivas de mutação
DROP POLICY IF EXISTS acl_insert_member_or_parent_admin ON public.automation_conversation_locks;
DROP POLICY IF EXISTS acl_update_member_or_parent_admin ON public.automation_conversation_locks;
DROP POLICY IF EXISTS acl_delete_member_or_parent_admin ON public.automation_conversation_locks;

-- INSERT bloqueado para authenticated — apenas service_role via RPC
CREATE POLICY acl_insert_service_role_only
  ON public.automation_conversation_locks
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- UPDATE bloqueado para authenticated — apenas service_role via RPC
CREATE POLICY acl_update_service_role_only
  ON public.automation_conversation_locks
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- DELETE bloqueado para authenticated — apenas service_role via RPC
CREATE POLICY acl_delete_service_role_only
  ON public.automation_conversation_locks
  FOR DELETE
  TO authenticated
  USING (false);

COMMENT ON TABLE public.automation_conversation_locks IS
  'Lease atômica por conversa para o motor de automação.
   Serializa processamento de mensagens da mesma conversation_id.
   Mutações (INSERT/UPDATE/DELETE) permitidas APENAS via service_role
   (através das RPCs claim_automation_conversation_lock_v1 e
   release_automation_conversation_lock_v1).
   Usuários authenticated podem apenas ler (SELECT) para monitoramento.';
