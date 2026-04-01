-- Migration: Proteger profile_picture_url estável de ser sobrescrita por URL CDN
-- Data: 2026-04-01
-- Problema: O RPC process_webhook_message_safe sobrescrevia URLs estáveis do Storage
--           com URLs temporárias do CDN do WhatsApp a cada nova mensagem recebida.
-- Solução: O UPDATE em chat_contacts só altera profile_picture_url se o valor atual
--          for NULL ou for uma URL CDN do WhatsApp (pps.whatsapp.net / mmg.whatsapp.net).
--          URLs estáveis do Supabase Storage (contact-avatars) são preservadas.

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
  
  SELECT id INTO v_contact_id
  FROM chat_contacts
  WHERE phone_number = p_phone_number 
    AND company_id = p_company_id;
  
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
      -- Só sobrescreve profile_picture_url se o valor atual for NULL ou uma URL CDN do WhatsApp.
      -- URLs estáveis do Supabase Storage são preservadas.
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
  
  SELECT id INTO v_conversation_id
  FROM chat_conversations
  WHERE contact_phone = p_phone_number 
    AND company_id = p_company_id
    AND instance_id = p_instance_id;
  
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
      contact_name = COALESCE(NULLIF(p_sender_name, ''), contact_name),
      lead_id = COALESCE(lead_id, v_lead_id),
      last_message_at = NOW(),
      unread_count = CASE 
        WHEN p_direction = 'inbound' THEN unread_count + 1 
        ELSE unread_count 
      END,
      updated_at = NOW()
    WHERE id = v_conversation_id;
    
    RAISE LOG 'process_webhook_message_safe: Conversa atualizada com ID % e lead_id %', v_conversation_id, COALESCE(v_lead_id::text, 'NULL');
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
  
  v_result := jsonb_build_object(
    'success', true,
    'message', 'Mensagem processada com sucesso via webhook seguro',
    'contact_id', v_contact_id,
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'lead_id', v_lead_id,
    'lead_created', v_lead_created,
    'media_url', p_media_url
  );
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'process_webhook_message_safe: ERRO - %', SQLERRM;
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'message', 'Erro ao processar mensagem via webhook seguro'
    );
END;
$function$;
