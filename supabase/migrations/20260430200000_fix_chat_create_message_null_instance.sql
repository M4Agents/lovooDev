-- =====================================================================
-- Fix: chat_create_message — suporte a conversas com instance_id = NULL
--
-- Problema: a função usava `instance_id IS NULL` para detectar tanto
-- "conversa não encontrada" quanto "instance_id não preenchido".
-- Conversas criadas por chat_create_or_get_conversation têm instance_id = NULL
-- mas last_instance_id preenchido — causando falso negativo.
--
-- Solução: separar a verificação de existência da obtenção do instance_id,
-- usando COALESCE(instance_id, last_instance_id) para cobrir ambos os casos.
--
-- Impacto: backward compatible — fluxos existentes não são afetados pois
-- suas conversas já têm instance_id preenchido (COALESCE retorna o mesmo valor).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chat_create_message(
  p_conversation_id uuid,
  p_company_id      uuid,
  p_content         text,
  p_message_type    varchar,
  p_direction       varchar,
  p_sent_by         uuid    DEFAULT NULL,
  p_media_url       text    DEFAULT NULL,
  p_is_ai_generated boolean DEFAULT false,
  p_ai_run_id       uuid    DEFAULT NULL,
  p_ai_block_index  integer DEFAULT NULL,
  p_ai_block_type   varchar DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_message_id  UUID;
  v_instance_id UUID;
  v_exists      BOOLEAN := FALSE;
BEGIN
  -- Verificar existência da conversa e obter instance_id efetivo.
  -- COALESCE(instance_id, last_instance_id) cobre conversas criadas por
  -- chat_create_or_get_conversation (instance_id = NULL, last_instance_id preenchido).
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
    ai_block_type
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
    p_ai_block_type
  )
  RETURNING id INTO v_message_id;

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
    'success',    true,
    'message_id', v_message_id,
    'message',    'Mensagem criada com sucesso'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   SQLERRM
  );
END;
$$;
