-- =====================================================
-- FUNÇÃO SQL: chat_create_message
-- =====================================================
-- Criada: 2025-12-22
-- Propósito: Criar mensagens no chat com suporte a media_url

CREATE OR REPLACE FUNCTION chat_create_message(
  p_conversation_id TEXT,
  p_company_id TEXT,
  p_content TEXT,
  p_message_type TEXT,
  p_direction TEXT,
  p_sent_by TEXT,
  p_media_url TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_message_id TEXT;
  v_result JSON;
BEGIN
  -- Gerar ID único para a mensagem
  v_message_id := gen_random_uuid()::TEXT;
  
  -- Inserir mensagem na tabela chat_messages
  INSERT INTO chat_messages (
    id,
    conversation_id,
    company_id,
    instance_id,
    message_type,
    content,
    media_url,
    direction,
    status,
    is_scheduled,
    sent_by,
    timestamp,
    created_at,
    updated_at
  )
  SELECT 
    v_message_id,
    p_conversation_id,
    p_company_id,
    cc.instance_id,
    p_message_type,
    p_content,
    p_media_url,
    p_direction,
    'sending',
    false,
    p_sent_by,
    NOW(),
    NOW(),
    NOW()
  FROM chat_conversations cc
  WHERE cc.id = p_conversation_id
    AND cc.company_id = p_company_id;
  
  -- Verificar se a inserção foi bem-sucedida
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Conversa não encontrada ou acesso negado',
      'message_id', null
    );
  END IF;
  
  -- Atualizar última mensagem da conversa
  UPDATE chat_conversations 
  SET 
    last_message_at = NOW(),
    last_message_content = p_content,
    last_message_direction = p_direction,
    updated_at = NOW()
  WHERE id = p_conversation_id 
    AND company_id = p_company_id;
  
  -- Retornar sucesso
  RETURN json_build_object(
    'success', true,
    'message_id', v_message_id,
    'error', null
  );
  
EXCEPTION
  WHEN OTHERS THEN
    -- Retornar erro em caso de exceção
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'message_id', null
    );
END;
$$;

-- =====================================================
-- PERMISSÕES E SEGURANÇA
-- =====================================================

-- Garantir que apenas usuários autenticados possam executar
REVOKE ALL ON FUNCTION chat_create_message FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_create_message TO authenticated;

-- Comentário da função
COMMENT ON FUNCTION chat_create_message IS 'Cria uma nova mensagem no chat com suporte completo a media_url para arquivos S3';
