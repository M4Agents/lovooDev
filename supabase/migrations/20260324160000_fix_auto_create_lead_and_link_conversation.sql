-- Migration: Corrigir criação automática de leads e vínculo com conversas
-- Data: 2026-03-24
-- Problema 1: Conversas criadas sem lead_id (NULL)
-- Problema 2: Leads novos do WhatsApp não sendo criados automaticamente
-- Solução: Atualizar process_webhook_message_safe para criar/buscar lead e vincular automaticamente

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
  -- Log de entrada
  RAISE LOG 'process_webhook_message_safe: Iniciando processamento para empresa % telefone %', p_company_id, p_phone_number;
  
  -- =====================================================
  -- 1. CRIAR OU BUSCAR CONTATO
  -- =====================================================
  
  -- Buscar contato existente
  SELECT id INTO v_contact_id
  FROM chat_contacts
  WHERE phone_number = p_phone_number 
    AND company_id = p_company_id;
  
  -- Se não existe, criar novo contato
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
    -- Atualizar informações do contato existente se necessário
    UPDATE chat_contacts 
    SET 
      name = COALESCE(NULLIF(p_sender_name, ''), name),
      profile_picture_url = COALESCE(NULLIF(p_profile_picture_url, ''), profile_picture_url),
      updated_at = NOW()
    WHERE id = v_contact_id;
    
    RAISE LOG 'process_webhook_message_safe: Contato atualizado com ID %', v_contact_id;
  END IF;
  
  -- =====================================================
  -- 2. BUSCAR OU CRIAR LEAD AUTOMATICAMENTE
  -- =====================================================
  
  -- Buscar lead existente pelo telefone (sem formatação)
  SELECT id INTO v_lead_id
  FROM leads
  WHERE company_id = p_company_id
    AND REGEXP_REPLACE(phone, '\D', '', 'g') = p_phone_number
    AND deleted_at IS NULL
  LIMIT 1;
  
  -- Se não existe e é mensagem inbound, criar lead automaticamente
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
      RAISE LOG 'process_webhook_message_safe: ✅ Lead criado automaticamente com ID %', v_lead_id;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE LOG 'process_webhook_message_safe: ⚠️ Erro ao criar lead: % - Continuando sem lead_id', SQLERRM;
        v_lead_id := NULL;
    END;
  ELSE
    IF v_lead_id IS NOT NULL THEN
      RAISE LOG 'process_webhook_message_safe: ✅ Lead existente encontrado com ID %', v_lead_id;
    ELSE
      RAISE LOG 'process_webhook_message_safe: ℹ️ Mensagem outbound - não cria lead automaticamente';
    END IF;
  END IF;
  
  -- =====================================================
  -- 3. CRIAR OU BUSCAR CONVERSA (COM LEAD_ID)
  -- =====================================================
  
  -- Buscar conversa existente
  SELECT id INTO v_conversation_id
  FROM chat_conversations
  WHERE contact_phone = p_phone_number 
    AND company_id = p_company_id
    AND instance_id = p_instance_id;
  
  -- Se não existe, criar nova conversa COM lead_id vinculado
  IF v_conversation_id IS NULL THEN
    INSERT INTO chat_conversations (
      company_id,
      instance_id,
      contact_phone,
      contact_name,
      lead_id,           -- ✅ VINCULAR LEAD AUTOMATICAMENTE
      last_message_at,
      unread_count,
      created_at,
      updated_at
    ) VALUES (
      p_company_id,
      p_instance_id,
      p_phone_number,
      p_sender_name,
      v_lead_id,         -- ✅ VINCULAR LEAD (pode ser NULL se não criou)
      NOW(),
      CASE WHEN p_direction = 'inbound' THEN 1 ELSE 0 END,
      NOW(),
      NOW()
    ) RETURNING id INTO v_conversation_id;
    
    RAISE LOG 'process_webhook_message_safe: Conversa criada com ID % e lead_id %', v_conversation_id, COALESCE(v_lead_id::text, 'NULL');
  ELSE
    -- Atualizar conversa existente
    UPDATE chat_conversations 
    SET 
      contact_name = COALESCE(NULLIF(p_sender_name, ''), contact_name),
      lead_id = COALESCE(lead_id, v_lead_id),  -- ✅ VINCULAR LEAD se ainda não tem
      last_message_at = NOW(),
      unread_count = CASE 
        WHEN p_direction = 'inbound' THEN unread_count + 1 
        ELSE unread_count 
      END,
      updated_at = NOW()
    WHERE id = v_conversation_id;
    
    RAISE LOG 'process_webhook_message_safe: Conversa atualizada com ID % e lead_id %', v_conversation_id, COALESCE(v_lead_id::text, 'NULL');
  END IF;
  
  -- =====================================================
  -- 4. CRIAR MENSAGEM COM SUPORTE A MEDIA_URL
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
  
  RAISE LOG 'process_webhook_message_safe: Mensagem criada com ID % media_url %', v_message_id, COALESCE(p_media_url, 'NULL');
  
  -- =====================================================
  -- 5. RETORNAR RESULTADO (COM LEAD_ID)
  -- =====================================================
  
  v_result := jsonb_build_object(
    'success', true,
    'message', 'Mensagem processada com sucesso via webhook seguro',
    'contact_id', v_contact_id,
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'lead_id', v_lead_id,           -- ✅ RETORNAR LEAD_ID
    'lead_created', v_lead_created, -- ✅ INDICAR SE LEAD FOI CRIADO
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

-- =====================================================
-- SCRIPT DE CORREÇÃO: Vincular leads existentes
-- =====================================================

-- Atualizar conversas que têm lead mas lead_id está NULL
UPDATE chat_conversations cc
SET lead_id = (
  SELECT l.id 
  FROM leads l 
  WHERE l.company_id = cc.company_id 
    AND REGEXP_REPLACE(l.phone, '\D', '', 'g') = cc.contact_phone
    AND l.deleted_at IS NULL
  LIMIT 1
)
WHERE lead_id IS NULL
  AND EXISTS (
    SELECT 1 
    FROM leads l 
    WHERE l.company_id = cc.company_id 
      AND REGEXP_REPLACE(l.phone, '\D', '', 'g') = cc.contact_phone
      AND l.deleted_at IS NULL
  );

-- Comentário explicativo
COMMENT ON FUNCTION public.process_webhook_message_safe IS 
'Função atualizada em 2026-03-24: Agora cria leads automaticamente para mensagens inbound e vincula lead_id em conversas. Resolve problemas de lead_id NULL e leads não sendo criados automaticamente.';
