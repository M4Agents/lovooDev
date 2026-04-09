-- =====================================================
-- MIGRATION: Novo overload de chat_create_message com campos de IA
-- Data: 2026-04-09
-- Etapa: 11/13
--
-- Propósito:
--   Adicionar um overload de 11 parâmetros para chat_create_message
--   que suporta campos de rastreabilidade de mensagens de IA.
--
-- Estratégia de compatibilidade retroativa:
--   O overload original de 7 parâmetros é MANTIDO INTACTO.
--   CREATE OR REPLACE com assinatura DIFERENTE cria um novo overload.
--   O PostgreSQL resolve qual overload usar em tempo de chamada
--   baseado nos parâmetros fornecidos.
--
--   Overload existente (7 params) — NÃO TOCADO:
--     chat_create_message(uuid, uuid, text, text, text, uuid, text DEFAULT NULL)
--
--   Novo overload (11 params) — CRIADO AQUI:
--     chat_create_message(uuid, uuid, text, text, text, uuid, text DEFAULT NULL,
--                         boolean DEFAULT false, uuid DEFAULT NULL,
--                         smallint DEFAULT NULL, text DEFAULT NULL)
--
-- Quem usa o novo overload:
--   - WhatsAppGateway (backend, service_role)
--   - chat_create_message chamado com p_is_ai_generated = true
--
-- Dependências:
--   Migration 2 (is_ai_generated, ai_run_id, ai_block_index, ai_block_type em chat_messages)
--   Migration 11 depende que esses campos existam em chat_messages.
--
-- Rollback:
--   DROP FUNCTION public.chat_create_message(uuid, uuid, text, text, text, uuid, text, boolean, uuid, smallint, text);
--   (Remove apenas o novo overload; o original de 7 params fica intacto)
-- =====================================================

CREATE OR REPLACE FUNCTION public.chat_create_message(
  -- Parâmetros originais (mantidos idênticos ao overload de 7 params)
  p_conversation_id   UUID,
  p_company_id        UUID,
  p_content           TEXT,
  p_message_type      TEXT,
  p_direction         TEXT,
  p_sent_by           UUID,
  p_media_url         TEXT     DEFAULT NULL,
  -- Novos parâmetros de IA (opcionais, com DEFAULT seguro)
  p_is_ai_generated   BOOLEAN  DEFAULT false,
  p_ai_run_id         UUID     DEFAULT NULL,
  p_ai_block_index    SMALLINT DEFAULT NULL,
  p_ai_block_type     TEXT     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_message_id  UUID;
  v_instance_id UUID;
BEGIN
  -- Verificar se a conversa pertence à empresa (validação multi-tenant)
  SELECT instance_id INTO v_instance_id
  FROM chat_conversations
  WHERE id = p_conversation_id AND company_id = p_company_id;

  IF v_instance_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Conversa não encontrada ou acesso negado'
    );
  END IF;

  -- Criar mensagem com campos de IA quando fornecidos
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
    -- Campos de IA — presentes apenas neste overload
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
    -- Campos de IA
    p_is_ai_generated,
    p_ai_run_id,
    p_ai_block_index,
    p_ai_block_type
  )
  RETURNING id INTO v_message_id;

  -- Atualizar conversa (mesmo comportamento do overload original)
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

  -- Atualizar contato (mesmo comportamento do overload original)
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
$function$;

COMMENT ON FUNCTION public.chat_create_message(uuid, uuid, text, text, text, uuid, text, boolean, uuid, smallint, text) IS
  'Overload estendido de chat_create_message com suporte a campos de IA. '
  'Parâmetros p_is_ai_generated, p_ai_run_id, p_ai_block_index e p_ai_block_type '
  'são opcionais e têm defaults seguros. '
  'O overload original de 7 parâmetros não foi modificado — compatibilidade total.';
