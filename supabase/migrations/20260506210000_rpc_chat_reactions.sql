-- =====================================================================
-- Migration: RPCs para gerenciar reações em mensagens do chat
-- Data: 2026-05-06
--
-- Funções:
--   chat_upsert_reaction  — cria ou atualiza reação ativa
--   chat_remove_reaction  — marca reação como removida (soft delete)
--
-- Segurança multi-tenant (obrigatório em ambas):
--   1. Validar que message_id pertence à mesma company_id
--   2. Validar que message_id pertence à mesma conversation_id
--   3. Validar que direction = 'inbound' (só reagir a mensagens recebidas)
--   Sem essas validações, um usuário malicioso poderia referenciar
--   mensagens de outra empresa apenas conhecendo o UUID.
-- =====================================================================


-- =====================================================================
-- 1. chat_upsert_reaction
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chat_upsert_reaction(
  p_company_id        uuid,
  p_conversation_id   uuid,
  p_message_id        uuid,
  p_user_id           uuid,
  p_emoji             text,
  p_provider_response jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reaction_id  uuid;
  v_msg          RECORD;
BEGIN
  -- 1. Validar que a mensagem pertence à empresa + conversa (multi-tenant)
  SELECT id, direction INTO v_msg
  FROM chat_messages
  WHERE id              = p_message_id
    AND company_id      = p_company_id
    AND conversation_id = p_conversation_id;

  IF v_msg.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Mensagem não encontrada ou acesso negado'
    );
  END IF;

  -- 2. Garantir que só é possível reagir a mensagens inbound
  IF v_msg.direction <> 'inbound' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Reação só é permitida em mensagens recebidas (inbound)'
    );
  END IF;

  -- 3. Upsert: se já existe reação ativa do mesmo usuário na mesma mensagem,
  --    atualizar emoji; caso contrário, inserir.
  --    Usa o índice único uq_chat_reaction_active_per_user_message.
  INSERT INTO chat_message_reactions (
    company_id,
    conversation_id,
    message_id,
    user_id,
    emoji,
    status,
    provider,
    provider_response,
    created_at,
    updated_at,
    removed_at
  )
  VALUES (
    p_company_id,
    p_conversation_id,
    p_message_id,
    p_user_id,
    p_emoji,
    'sent',
    'uazapi',
    p_provider_response,
    now(),
    now(),
    NULL
  )
  ON CONFLICT (company_id, message_id, user_id) WHERE removed_at IS NULL
  -- O índice parcial (WHERE removed_at IS NULL) é a base do CONFLICT.
  -- O CONFLICT só dispara para reações ativas — safe para re-inserir após remoção.
  DO UPDATE SET
    emoji             = EXCLUDED.emoji,
    provider_response = COALESCE(EXCLUDED.provider_response, chat_message_reactions.provider_response),
    updated_at        = now()
  RETURNING id INTO v_reaction_id;

  RETURN jsonb_build_object(
    'success',         true,
    'reaction_id',     v_reaction_id,
    'message_id',      p_message_id,
    'emoji',           p_emoji,
    'updated_at',      now()
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- =====================================================================
-- 2. chat_remove_reaction
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chat_remove_reaction(
  p_company_id      uuid,
  p_conversation_id uuid,
  p_message_id      uuid,
  p_user_id         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_updated_count integer;
BEGIN
  -- Validar que a mensagem pertence à empresa + conversa antes de remover
  IF NOT EXISTS (
    SELECT 1 FROM chat_messages
    WHERE id              = p_message_id
      AND company_id      = p_company_id
      AND conversation_id = p_conversation_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Mensagem não encontrada ou acesso negado'
    );
  END IF;

  -- Soft delete: marcar removed_at e zerar emoji
  UPDATE chat_message_reactions
  SET
    removed_at = now(),
    emoji      = NULL,
    updated_at = now()
  WHERE message_id      = p_message_id
    AND company_id      = p_company_id
    AND conversation_id = p_conversation_id
    AND user_id         = p_user_id
    AND removed_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success',       true,
    'removed_count', v_updated_count,
    'message_id',    p_message_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- =====================================================================
-- Grants — acessíveis por service_role e anon (via SECURITY DEFINER)
-- =====================================================================

GRANT EXECUTE ON FUNCTION public.chat_upsert_reaction(uuid, uuid, uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_upsert_reaction(uuid, uuid, uuid, uuid, text, jsonb) TO anon;

GRANT EXECUTE ON FUNCTION public.chat_remove_reaction(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_remove_reaction(uuid, uuid, uuid, uuid) TO anon;

COMMENT ON FUNCTION public.chat_upsert_reaction IS
'Cria ou atualiza reação ativa de um usuário em uma mensagem inbound. '
'Valida company_id + conversation_id + direction = inbound antes de persistir.';

COMMENT ON FUNCTION public.chat_remove_reaction IS
'Marca reação ativa como removida (soft delete). '
'Valida company_id + conversation_id antes de atualizar.';
