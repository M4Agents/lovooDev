-- Migration: Adicionar deduplicação em process_webhook_message_safe
-- Data: 2026-04-29
-- Problema: Mensagens enviadas pelo agente de IA (e pelo painel) eram salvas duas vezes:
--   1. Pelo whatsappGateway (chat_create_message) no momento do envio
--   2. Pelo webhook Uazapi (echo de confirmação) via esta função
-- Solução: Verificar se já existe uma mensagem com o mesmo uazapi_message_id
--   antes de inserir. Se existir, retornar o registro existente sem duplicar.

CREATE OR REPLACE FUNCTION public.process_webhook_message_safe(
  p_company_id uuid,
  p_instance_id uuid,
  p_phone_number text,
  p_sender_name text,
  p_content text,
  p_message_type text,
  p_direction text,
  p_uazapi_message_id text DEFAULT NULL::text,
  p_profile_picture_url text DEFAULT NULL::text,
  p_media_url text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_contact_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
  v_lead_id INTEGER;
  v_lead_created BOOLEAN := false;
  v_result jsonb;
BEGIN
  RAISE LOG 'process_webhook_message_safe: Iniciando processamento para empresa % telefone %', p_company_id, p_phone_number;

  -- =====================================================
  -- DEDUPLICAÇÃO: verificar se mensagem já foi salva
  -- Ocorre quando o agente/painel salva primeiro (via chat_create_message)
  -- e o Uazapi dispara o echo de confirmação em seguida.
  -- Aplica apenas quando uazapi_message_id é fornecido.
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

      -- Atualizar last_message_at da conversa mesmo assim (mantém ordenação correta)
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
      created_at,
      updated_at
    ) VALUES (
      p_company_id,
      p_phone_number,
      p_sender_name,
      p_profile_picture_url,
      NOW(),
      NOW()
    ) RETURNING id INTO v_contact_id;

    RAISE LOG 'process_webhook_message_safe: Contato criado com ID %', v_contact_id;
  ELSE
    UPDATE chat_contacts
    SET
      name = COALESCE(NULLIF(p_sender_name, ''), name),
      profile_picture_url = CASE
        WHEN profile_picture_url IS NULL
          OR profile_picture_url ILIKE '%pps.whatsapp.net%'
          OR profile_picture_url ILIKE '%mmg.whatsapp.net%'
          THEN COALESCE(NULLIF(p_profile_picture_url, ''), profile_picture_url)
        ELSE profile_picture_url
      END,
      updated_at = NOW()
    WHERE id = v_contact_id;

    RAISE LOG 'process_webhook_message_safe: Contato atualizado com ID %', v_contact_id;
  END IF;

  -- =====================================================
  -- 2. BUSCAR OU CRIAR LEAD
  -- =====================================================

  SELECT id INTO v_lead_id
  FROM leads
  WHERE company_id = p_company_id
    AND deleted_at IS NULL
    AND (
      REGEXP_REPLACE(phone, '\D', '', 'g') = p_phone_number
      OR
      RIGHT(REGEXP_REPLACE(phone, '\D', '', 'g'), 11) = RIGHT(p_phone_number, 11)
      OR
      RIGHT(REGEXP_REPLACE(phone, '\D', '', 'g'), 10) = RIGHT(p_phone_number, 10)
    )
  LIMIT 1;

  IF v_lead_id IS NULL AND p_direction = 'inbound' THEN
    BEGIN
      INSERT INTO leads (
        company_id,
        phone,
        name,
        origin,
        status,
        created_at,
        updated_at
      ) VALUES (
        p_company_id,
        p_phone_number,
        p_sender_name,
        'whatsapp',
        'novo',
        NOW(),
        NOW()
      ) RETURNING id INTO v_lead_id;

      v_lead_created := true;
      RAISE LOG 'process_webhook_message_safe: Lead criado automaticamente com ID %', v_lead_id;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE LOG 'process_webhook_message_safe: Erro ao criar lead: % - Continuando sem lead_id', SQLERRM;
        v_lead_id := NULL;
    END;
  ELSE
    IF v_lead_id IS NOT NULL THEN
      RAISE LOG 'process_webhook_message_safe: Lead existente encontrado com ID %', v_lead_id;
    ELSE
      RAISE LOG 'process_webhook_message_safe: Mensagem outbound - nao cria lead automaticamente';
    END IF;
  END IF;

  -- =====================================================
  -- 3. CRIAR OU BUSCAR CONVERSA
  -- =====================================================

  SELECT id INTO v_conversation_id
  FROM chat_conversations
  WHERE contact_phone = p_phone_number
    AND company_id    = p_company_id
    AND instance_id   = p_instance_id;

  IF v_conversation_id IS NULL THEN
    INSERT INTO chat_conversations (
      company_id,
      instance_id,
      contact_phone,
      contact_name,
      lead_id,
      last_message_at,
      unread_count,
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
  -- 4. INSERIR MENSAGEM (sem duplicata garantido pelo bloco acima)
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
    NOW(),
    NOW(),
    NOW()
  ) RETURNING id INTO v_message_id;

  RAISE LOG 'process_webhook_message_safe: Mensagem criada com ID %', v_message_id;

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
'2026-04-29: Adicionada deduplicação por uazapi_message_id. Se a mensagem já foi salva pelo gateway do agente (chat_create_message), o echo do Uazapi é ignorado e o ID existente é retornado.';
