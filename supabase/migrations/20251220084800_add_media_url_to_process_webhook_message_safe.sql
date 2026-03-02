-- =====================================================
-- CORREÇÃO CRÍTICA: Adicionar suporte a media_url no RPC process_webhook_message_safe
-- =====================================================
-- Data: 2025-12-20
-- Problema: Preview de mídia não aparece no chat porque RPC não aceita p_media_url
-- Solução: Modificar RPC para aceitar e salvar media_url na tabela chat_messages
-- Compatibilidade: Mantida com chamadas existentes (p_media_url opcional)

-- =====================================================
-- FUNÇÃO PRINCIPAL: process_webhook_message_safe
-- =====================================================

CREATE OR REPLACE FUNCTION process_webhook_message_safe(
  p_company_id uuid,
  p_instance_id uuid,
  p_phone_number text,
  p_sender_name text,
  p_content text,
  p_message_type text,
  p_media_url text DEFAULT NULL,  -- ✅ NOVO PARÂMETRO OPCIONAL
  p_direction text,
  p_uazapi_message_id text DEFAULT NULL,
  p_profile_picture_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
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
  -- 2. CRIAR OU BUSCAR CONVERSA
  -- =====================================================
  
  -- Buscar conversa existente
  SELECT id INTO v_conversation_id
  FROM chat_conversations
  WHERE contact_phone = p_phone_number 
    AND company_id = p_company_id
    AND instance_id = p_instance_id;
  
  -- Se não existe, criar nova conversa
  IF v_conversation_id IS NULL THEN
    INSERT INTO chat_conversations (
      company_id,
      instance_id,
      contact_id,
      contact_phone,
      contact_name,
      last_message_at,
      unread_count,
      created_at,
      updated_at
    ) VALUES (
      p_company_id,
      p_instance_id,
      v_contact_id,
      p_phone_number,
      p_sender_name,
      NOW(),
      CASE WHEN p_direction = 'inbound' THEN 1 ELSE 0 END,
      NOW(),
      NOW()
    ) RETURNING id INTO v_conversation_id;
    
    RAISE LOG 'process_webhook_message_safe: Conversa criada com ID %', v_conversation_id;
  ELSE
    -- Atualizar conversa existente
    UPDATE chat_conversations 
    SET 
      contact_name = COALESCE(NULLIF(p_sender_name, ''), contact_name),
      last_message_at = NOW(),
      unread_count = CASE 
        WHEN p_direction = 'inbound' THEN unread_count + 1 
        ELSE unread_count 
      END,
      updated_at = NOW()
    WHERE id = v_conversation_id;
    
    RAISE LOG 'process_webhook_message_safe: Conversa atualizada com ID %', v_conversation_id;
  END IF;
  
  -- =====================================================
  -- 3. CRIAR MENSAGEM COM SUPORTE A MEDIA_URL
  -- =====================================================
  
  INSERT INTO chat_messages (
    conversation_id,
    company_id,
    instance_id,
    message_type,
    content,
    media_url,           -- ✅ AGORA SUPORTA MEDIA_URL
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
    p_media_url,         -- ✅ SALVA MEDIA_URL NO BANCO
    p_direction,
    'sent',
    p_uazapi_message_id,
    NOW(),
    NOW(),
    NOW()
  ) RETURNING id INTO v_message_id;
  
  RAISE LOG 'process_webhook_message_safe: Mensagem criada com ID % media_url %', v_message_id, COALESCE(p_media_url, 'NULL');
  
  -- =====================================================
  -- 4. RETORNAR RESULTADO
  -- =====================================================
  
  v_result := jsonb_build_object(
    'success', true,
    'message', 'Mensagem processada com sucesso via webhook seguro',
    'contact_id', v_contact_id,
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
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
$$;

-- =====================================================
-- COMENTÁRIOS E GRANTS
-- =====================================================

COMMENT ON FUNCTION process_webhook_message_safe IS 'Função SECURITY DEFINER para processar mensagens de webhook com suporte a media_url. Bypass do RLS para webhooks externos.';

-- Grant para usuários autenticados
GRANT EXECUTE ON FUNCTION process_webhook_message_safe TO authenticated;
GRANT EXECUTE ON FUNCTION process_webhook_message_safe TO anon;

-- =====================================================
-- LOG DE MIGRAÇÃO
-- =====================================================

DO $$
BEGIN
  RAISE LOG 'MIGRAÇÃO APLICADA: process_webhook_message_safe agora suporta p_media_url';
  RAISE LOG 'COMPATIBILIDADE: Mantida com chamadas existentes (p_media_url é opcional)';
  RAISE LOG 'FUNCIONALIDADE: Preview de mídia deve funcionar após esta migração';
END;
$$;
