-- =====================================================================
-- Migration: Atualizar process_webhook_message_safe com suporte a reply
-- Data: 2026-05-06
--
-- Objetivo:
--   Aceitar p_reply_to_uazapi_message_id opcional e resolver para o UUID
--   interno (reply_to_message_id) antes de inserir a mensagem.
--
-- Segurança multi-tenant:
--   A resolução do uazapi_message_id → UUID interno filtra por company_id,
--   garantindo que nunca se cria uma FK para mensagem de outra empresa.
--   Se o ID não for encontrado na mesma empresa, reply é ignorado (fail-safe).
--
-- Compatibilidade retroativa:
--   p_reply_to_uazapi_message_id DEFAULT NULL — nenhum caller existente quebra.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.process_webhook_message_safe(
  p_company_id                 uuid,
  p_instance_id                uuid,
  p_phone_number               text,
  p_sender_name                text,
  p_content                    text,
  p_message_type               text,
  p_direction                  text,
  p_uazapi_message_id          text DEFAULT NULL::text,
  p_profile_picture_url        text DEFAULT NULL::text,
  p_media_url                  text DEFAULT NULL::text,
  p_reply_to_uazapi_message_id text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_contact_id        uuid;
  v_conversation_id   uuid;
  v_message_id        uuid;
  v_lead_id           INTEGER;
  v_lead_created      BOOLEAN := false;
  v_reply_message_id  uuid    := NULL;
  v_result            jsonb;
BEGIN
  RAISE LOG 'process_webhook_message_safe: Iniciando processamento para empresa % telefone %', p_company_id, p_phone_number;

  -- =====================================================
  -- DEDUPLICAÇÃO: verificar se mensagem já foi salva
  -- =====================================================
  IF p_uazapi_message_id IS NOT NULL THEN
    SELECT cm.id, cc.id, cc.lead_id
    INTO v_message_id, v_conversation_id, v_lead_id
    FROM chat_messages cm
    JOIN chat_conversations cc ON cc.id = cm.conversation_id
    WHERE cm.uazapi_message_id = p_uazapi_message_id
      AND cm.company_id        = p_company_id
    LIMIT 1;

    IF v_message_id IS NOT NULL THEN
      RAISE LOG 'process_webhook_message_safe: Mensagem duplicata detectada (uazapi_message_id=%) — retornando existente %', p_uazapi_message_id, v_message_id;

      UPDATE chat_conversations
      SET last_message_at = NOW(), updated_at = NOW()
      WHERE id = v_conversation_id;

      RETURN jsonb_build_object(
        'success',         true,
        'message',         'Mensagem já registrada (deduplicada)',
        'contact_id',      NULL,
        'conversation_id', v_conversation_id,
        'message_id',      v_message_id,
        'lead_id',         v_lead_id,
        'lead_created',    false,
        'media_url',       p_media_url,
        'deduplicated',    true
      );
    END IF;
  END IF;

  -- =====================================================
  -- Resolver reply_to_uazapi_message_id → UUID interno
  -- Filtra por company_id — isolamento multi-tenant garantido
  -- =====================================================
  IF p_reply_to_uazapi_message_id IS NOT NULL THEN
    SELECT id INTO v_reply_message_id
    FROM chat_messages
    WHERE uazapi_message_id = p_reply_to_uazapi_message_id
      AND company_id        = p_company_id
    LIMIT 1;
    -- Se não encontrar, v_reply_message_id permanece NULL (fail-safe)
    RAISE LOG 'process_webhook_message_safe: reply_to resolvido: % → %', p_reply_to_uazapi_message_id, v_reply_message_id;
  END IF;

  -- =====================================================
  -- 1. CRIAR OU BUSCAR CONTATO
  -- =====================================================

  SELECT id INTO v_contact_id
  FROM chat_contacts
  WHERE phone_number = p_phone_number
    AND company_id   = p_company_id;

  IF v_contact_id IS NULL THEN
    INSERT INTO chat_contacts (
      company_id,
      phone_number,
      name,
      profile_picture_url,
      total_messages,
      tags,
      custom_fields,
      created_at,
      updated_at
    ) VALUES (
      p_company_id,
      p_phone_number,
      p_sender_name,
      p_profile_picture_url,
      0,
      '{}',
      '{}',
      NOW(),
      NOW()
    ) RETURNING id INTO v_contact_id;

    RAISE LOG 'process_webhook_message_safe: Contato criado com ID %', v_contact_id;
  ELSE
    UPDATE chat_contacts
    SET
      name                = COALESCE(NULLIF(p_sender_name, ''), name),
      profile_picture_url = COALESCE(p_profile_picture_url, profile_picture_url),
      updated_at          = NOW()
    WHERE id = v_contact_id;

    RAISE LOG 'process_webhook_message_safe: Contato atualizado com ID %', v_contact_id;
  END IF;

  -- =====================================================
  -- 2. BUSCAR LEAD ASSOCIADO
  -- =====================================================

  SELECT id INTO v_lead_id
  FROM leads
  WHERE phone     = p_phone_number
    AND company_id = p_company_id
    AND deleted_at IS NULL
  LIMIT 1;

  -- =====================================================
  -- 3. CRIAR OU ATUALIZAR CONVERSA
  -- =====================================================

  SELECT id INTO v_conversation_id
  FROM chat_conversations
  WHERE company_id   = p_company_id
    AND instance_id  = p_instance_id
    AND contact_phone = p_phone_number;

  IF v_conversation_id IS NULL THEN
    INSERT INTO chat_conversations (
      company_id,
      instance_id,
      contact_phone,
      contact_name,
      lead_id,
      last_message_at,
      unread_count,
      status,
      created_at,
      updated_at
    ) VALUES (
      p_company_id,
      p_instance_id,
      p_phone_number,
      p_sender_name,
      v_lead_id,
      NOW(),
      CASE WHEN p_direction = 'inbound' THEN 1 ELSE 0 END,
      'active',
      NOW(),
      NOW()
    ) RETURNING id INTO v_conversation_id;

    RAISE LOG 'process_webhook_message_safe: Conversa criada com ID % e lead_id %', v_conversation_id, COALESCE(v_lead_id::text, 'NULL');
  ELSE
    UPDATE chat_conversations
    SET
      contact_name    = COALESCE(NULLIF(p_sender_name, ''), contact_name),
      lead_id         = COALESCE(lead_id, v_lead_id),
      last_message_at = NOW(),
      unread_count    = CASE
        WHEN p_direction = 'inbound' THEN unread_count + 1
        ELSE unread_count
      END,
      updated_at = NOW()
    WHERE id = v_conversation_id;

    RAISE LOG 'process_webhook_message_safe: Conversa atualizada com ID % e lead_id %', v_conversation_id, COALESCE(v_lead_id::text, 'NULL');
  END IF;

  -- =====================================================
  -- 4. INSERIR MENSAGEM
  -- =====================================================

  INSERT INTO chat_messages (
    conversation_id,
    company_id,
    instance_id,
    message_type,
    content,
    media_url,
    direction,
    status,
    uazapi_message_id,
    reply_to_message_id,
    timestamp,
    created_at,
    updated_at
  ) VALUES (
    v_conversation_id,
    p_company_id,
    p_instance_id,
    p_message_type,
    p_content,
    p_media_url,
    p_direction,
    'sent',
    p_uazapi_message_id,
    v_reply_message_id,
    NOW(),
    NOW(),
    NOW()
  ) RETURNING id INTO v_message_id;

  RAISE LOG 'process_webhook_message_safe: Mensagem criada com ID % reply_to=%', v_message_id, COALESCE(v_reply_message_id::text, 'NULL');

  -- =====================================================
  -- 5. RETORNAR RESULTADO
  -- =====================================================

  v_result := jsonb_build_object(
    'success',         true,
    'message',         'Mensagem processada com sucesso via webhook seguro',
    'contact_id',      v_contact_id,
    'conversation_id', v_conversation_id,
    'message_id',      v_message_id,
    'lead_id',         v_lead_id,
    'lead_created',    v_lead_created,
    'media_url',       p_media_url
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'process_webhook_message_safe: ERRO - %', SQLERRM;
    RETURN jsonb_build_object(
      'success', false,
      'error',   SQLERRM,
      'message', 'Erro ao processar mensagem via webhook seguro'
    );
END;
$function$;

COMMENT ON FUNCTION public.process_webhook_message_safe IS
'2026-05-06: Adicionado suporte a reply. p_reply_to_uazapi_message_id é resolvido para '
'reply_to_message_id (UUID interno) com isolamento por company_id. '
'2026-04-29: Adicionada deduplicação por uazapi_message_id.';
