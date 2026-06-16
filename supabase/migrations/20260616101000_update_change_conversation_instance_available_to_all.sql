-- =============================================================================
-- FASE 5ZE — Atualiza change_conversation_instance para respeitar available_to_all
--
-- VERSÃO ANTERIOR: FASE 5ZD (20260615220000)
--   Guard 2: nova instância deve ter assigned_user_id = auth.uid()
--
-- ESTA VERSÃO (FASE 5ZE):
--   Guard 2: nova instância deve ter:
--     assigned_user_id = auth.uid()  (instância própria do seller)
--     OR available_to_all = true     (instância compartilhada)
--
-- MUDANÇA CIRÚRGICA:
--   - Adicionado v_instance_available_to_all na DECLARE
--   - Adicionado available_to_all no SELECT da nova instância
--   - Guard 2 atualizado: AND NOT v_instance_available_to_all
--   Tudo o mais é idêntico à versão FASE 5ZD.
--
-- INVARIANTES PRESERVADOS:
--   - Guard 1 (conversa = auth.uid()): inalterado
--   - Admin/manager/system_admin/super_admin: sem restrição
--   - Webhooks (service_role): auth.uid() = null → restricted = false → sem bloqueio
--   - Lógica de conflito: inalterada
--   - status = 'connected' na busca de instância: preservado
--   - RLS: não alterado
--   - chat_get_conversations: não alterado
--   - auth_chat_visibility_restricted: não alterado
-- =============================================================================

CREATE OR REPLACE FUNCTION public.change_conversation_instance(
  p_conversation_id  uuid,
  p_new_instance_id  uuid,
  p_company_id       uuid,
  p_resolve_conflict boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_instance_name             TEXT;
  v_old_instance_id           uuid;
  v_contact_phone             TEXT;
  v_current_status            TEXT;
  v_conflict_id               uuid;
  v_caller_restricted         boolean;
  v_conv_assigned_to          uuid;
  v_instance_owner            uuid;
  v_instance_available_to_all boolean;   -- FASE 5ZE
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
  -- (FASE 5ZE: inclui available_to_all — status = 'connected' preservado)
  -- -----------------------------------------------------------------------
  SELECT instance_name, assigned_user_id, available_to_all
    INTO v_instance_name, v_instance_owner, v_instance_available_to_all
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
  -- FASE 5ZE: Guard duplo para seller restrito
  -- auth_chat_visibility_restricted usa auth.uid() internamente.
  -- Em contexto service_role (webhook), auth.uid() = null → retorna false → sem bloqueio.
  -- -----------------------------------------------------------------------
  v_caller_restricted := public.auth_chat_visibility_restricted(p_company_id);

  IF v_caller_restricted THEN
    -- Guard 1: a conversa deve pertencer ao seller (unchanged from FASE 5ZD)
    IF v_conv_assigned_to IS DISTINCT FROM auth.uid() THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Acesso negado: esta conversa não está atribuída a você'
      );
    END IF;

    -- Guard 2 (FASE 5ZE): instância própria OU available_to_all = true
    IF v_instance_owner IS DISTINCT FROM auth.uid() AND NOT v_instance_available_to_all THEN
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
