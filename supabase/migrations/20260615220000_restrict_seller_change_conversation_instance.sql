-- =============================================================================
-- FASE 5ZD — Guard duplo em change_conversation_instance para seller restrito
--
-- PROBLEMA:
--   A RPC change_conversation_instance não validava se o caller (seller restrito)
--   tinha permissão para:
--   1. modificar a conversa (assigned_to = auth.uid())
--   2. usar a nova instância (wli.assigned_user_id = auth.uid())
--   Um seller podia trocar a instância de qualquer conversa da empresa para
--   qualquer instância conectada, sem restrições.
--
-- CORREÇÃO:
--   Quando auth_chat_visibility_restricted(p_company_id) = true (seller restrito):
--   - Guard 1: a conversa deve estar atribuída ao caller (assigned_to = auth.uid())
--   - Guard 2: a nova instância deve pertencer ao caller (assigned_user_id = auth.uid())
--   Qualquer violação retorna erro 'Acesso negado'.
--
-- INVARIANTES:
--   - Admin / manager / system_admin / super_admin: sem restrição (restricted = false)
--   - Webhooks / service_role: auth.uid() = null → restricted = false → sem bloqueio
--   - Lógica de resolução de conflito: inalterada
--   - Regra de visibilidade de conversas (assigned_to): inalterada
--   - RLS: não alterado
--   - chat_get_conversations: não alterado
-- =============================================================================

CREATE OR REPLACE FUNCTION public.change_conversation_instance(
  p_conversation_id uuid,
  p_new_instance_id uuid,
  p_company_id      uuid,
  p_resolve_conflict boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_instance_name      TEXT;
  v_old_instance_id    uuid;
  v_contact_phone      TEXT;
  v_current_status     TEXT;
  v_conflict_id        uuid;
  v_caller_restricted  boolean;   -- FASE 5ZD: true = seller com flag ativa
  v_conv_assigned_to   uuid;      -- FASE 5ZD: assigned_to da conversa
  v_instance_owner     uuid;      -- FASE 5ZD: assigned_user_id da nova instância
BEGIN
  -- -----------------------------------------------------------------------
  -- Buscar dados atuais da conversa
  -- -----------------------------------------------------------------------
  SELECT instance_id, contact_phone, status, assigned_to
    INTO v_old_instance_id, v_contact_phone, v_current_status, v_conv_assigned_to
    FROM public.chat_conversations
   WHERE id         = p_conversation_id
     AND company_id = p_company_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Conversa não encontrada'
    );
  END IF;

  -- -----------------------------------------------------------------------
  -- Buscar dados da nova instância
  -- -----------------------------------------------------------------------
  SELECT instance_name, assigned_user_id
    INTO v_instance_name, v_instance_owner
    FROM public.whatsapp_life_instances
   WHERE id         = p_new_instance_id
     AND company_id = p_company_id
     AND status     = 'connected';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Instância não encontrada ou não conectada'
    );
  END IF;

  -- -----------------------------------------------------------------------
  -- FASE 5ZD: Guard duplo para seller restrito
  -- auth_chat_visibility_restricted usa auth.uid() internamente.
  -- Em contexto service_role (webhook), auth.uid() = null → retorna false → sem bloqueio.
  -- -----------------------------------------------------------------------
  v_caller_restricted := public.auth_chat_visibility_restricted(p_company_id);

  IF v_caller_restricted THEN
    -- Guard 1: a conversa deve pertencer ao seller (assigned_to = auth.uid())
    IF v_conv_assigned_to IS DISTINCT FROM auth.uid() THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Acesso negado: esta conversa não está atribuída a você'
      );
    END IF;

    -- Guard 2: a nova instância deve pertencer ao seller (assigned_user_id = auth.uid())
    IF v_instance_owner IS DISTINCT FROM auth.uid() THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Acesso negado: você não tem permissão para usar esta instância'
      );
    END IF;
  END IF;

  -- -----------------------------------------------------------------------
  -- Verificar conflito: outra conversa ativa com o mesmo contato na nova instância
  -- -----------------------------------------------------------------------
  SELECT id INTO v_conflict_id
    FROM public.chat_conversations
   WHERE company_id    = p_company_id
     AND instance_id   = p_new_instance_id
     AND contact_phone = v_contact_phone
     AND id            <> p_conversation_id
   LIMIT 1;

  IF v_conflict_id IS NOT NULL AND NOT p_resolve_conflict THEN
    RETURN jsonb_build_object(
      'success',                  false,
      'error',                    'Já existe uma conversa com este contato nesta instância. Use a conversa existente ou confirme o arquivamento da conversa conflitante.',
      'conflict_conversation_id', v_conflict_id
    );
  END IF;

  -- Arquivar conversa conflitante se resolução explícita foi solicitada
  IF v_conflict_id IS NOT NULL AND p_resolve_conflict THEN
    UPDATE public.chat_conversations
       SET status      = 'archived',
           instance_id = NULL,
           updated_at  = NOW()
     WHERE id          = v_conflict_id
       AND company_id  = p_company_id;
  END IF;

  -- -----------------------------------------------------------------------
  -- Alterar instância da conversa
  -- -----------------------------------------------------------------------
  UPDATE public.chat_conversations
     SET instance_id = p_new_instance_id,
         updated_at  = NOW()
   WHERE id         = p_conversation_id
     AND company_id = p_company_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Erro ao atualizar conversa'
    );
  END IF;

  RETURN jsonb_build_object(
    'success',                  true,
    'message',                  'Instância alterada com sucesso',
    'new_instance_name',        v_instance_name,
    'old_instance_id',          v_old_instance_id,
    'new_instance_id',          p_new_instance_id,
    'archived_conversation_id', v_conflict_id
  );
END;
$function$;
