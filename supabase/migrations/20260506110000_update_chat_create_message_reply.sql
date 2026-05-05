-- =====================================================================
-- Migration: Atualizar chat_create_message com suporte a reply
-- Data: 2026-05-06
--
-- Objetivo:
--   Adicionar p_reply_to_message_id opcional à RPC chat_create_message.
--
-- Segurança multi-tenant (obrigatório):
--   1. Verificar que a mensagem referenciada pertence à mesma company_id.
--   2. Verificar que pertence à mesma conversation_id.
--   3. Se não validar, reply_to_message_id fica NULL (fail-safe).
--
-- Compatibilidade retroativa:
--   p_reply_to_message_id DEFAULT NULL — nenhum caller existente quebra.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chat_create_message(
  p_conversation_id   uuid,
  p_company_id        uuid,
  p_content           text,
  p_message_type      text,
  p_direction         text,
  p_sent_by           uuid     DEFAULT NULL,
  p_media_url         text     DEFAULT NULL,
  p_is_ai_generated   boolean  DEFAULT false,
  p_ai_run_id         uuid     DEFAULT NULL,
  p_ai_block_index    smallint DEFAULT NULL,
  p_ai_block_type     text     DEFAULT NULL,
  p_reply_to_message_id uuid   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_message_id        UUID;
  v_instance_id       UUID;
  v_exists            BOOLEAN := FALSE;
  v_validated_reply   UUID    := NULL;
BEGIN
  -- Verificar existência da conversa e obter instance_id efetivo.
  SELECT TRUE, COALESCE(cc.instance_id, cc.last_instance_id)
    INTO v_exists, v_instance_id
  FROM chat_conversations cc
  WHERE cc.id = p_conversation_id
    AND cc.company_id = p_company_id;

  IF NOT v_exists OR v_instance_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Conversa não encontrada ou acesso negado'
    );
  END IF;

  -- Validar reply_to_message_id (multi-tenant + mesma conversa + anti-self-reply)
  -- Nota: self-reply é prevenido porque o INSERT ainda não ocorreu e o ID ainda
  -- não existe, portanto qualquer UUID passado não pode ser o da mensagem a ser criada.
  -- A checagem explícita abaixo garante a invariante mesmo em casos teóricos.
  IF p_reply_to_message_id IS NOT NULL THEN
    SELECT rm.id INTO v_validated_reply
    FROM chat_messages rm
    WHERE rm.id              = p_reply_to_message_id
      AND rm.company_id      = p_company_id
      AND rm.conversation_id = p_conversation_id;
    -- Se não encontrar, v_validated_reply permanece NULL (fail-safe)
  END IF;

  INSERT INTO chat_messages (
    conversation_id,
    company_id,
    instance_id,
    message_type,
    content,
    media_url,
    direction,
    status,
    sent_by,
    is_ai_generated,
    ai_run_id,
    ai_block_index,
    ai_block_type,
    reply_to_message_id
  )
  VALUES (
    p_conversation_id,
    p_company_id,
    v_instance_id,
    p_message_type,
    p_content,
    p_media_url,
    p_direction,
    CASE
      WHEN p_direction = 'outbound' THEN 'sending'
      ELSE 'read'
    END,
    p_sent_by,
    p_is_ai_generated,
    p_ai_run_id,
    p_ai_block_index,
    p_ai_block_type,
    v_validated_reply
  )
  RETURNING id INTO v_message_id;

  -- Proteção anti-self-reply: garante que a mensagem não referencia a si mesma.
  -- Situação teoricamente impossível com UUID gerado no INSERT, mas garantia explícita.
  IF v_validated_reply IS NOT NULL AND v_validated_reply = v_message_id THEN
    UPDATE chat_messages SET reply_to_message_id = NULL WHERE id = v_message_id;
    v_validated_reply := NULL;
  END IF;

  UPDATE chat_conversations
  SET
    last_message_at        = now(),
    last_message_content   = p_content,
    last_message_direction = p_direction,
    unread_count           = CASE
      WHEN p_direction = 'inbound' THEN unread_count + 1
      ELSE unread_count
    END,
    updated_at             = now()
  WHERE id = p_conversation_id;

  UPDATE chat_contacts
  SET
    last_activity_at = now(),
    total_messages   = total_messages + 1
  WHERE company_id = p_company_id
    AND phone_number = (
      SELECT contact_phone FROM chat_conversations
      WHERE id = p_conversation_id
    );

  RETURN jsonb_build_object(
    'success',             true,
    'message_id',          v_message_id,
    'reply_to_message_id', v_validated_reply,
    'message',             'Mensagem criada com sucesso'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   SQLERRM
  );
END;
$$;
