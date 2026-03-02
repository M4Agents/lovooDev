-- =====================================================
-- PROCESSADOR DE MENSAGENS AGENDADAS
-- =====================================================
-- Data: 2026-02-24 15:51
-- Descrição: Funções para processar e enviar mensagens agendadas automaticamente

-- =====================================================
-- FUNÇÃO: get_pending_scheduled_messages
-- =====================================================
-- Retorna mensagens pendentes que devem ser enviadas agora

CREATE OR REPLACE FUNCTION get_pending_scheduled_messages()
RETURNS TABLE (
  id UUID,
  conversation_id UUID,
  company_id UUID,
  instance_id UUID,
  created_by UUID,
  content TEXT,
  message_type TEXT,
  media_url TEXT,
  scheduled_for TIMESTAMPTZ,
  recurring_type TEXT,
  recurring_config JSONB,
  contact_phone TEXT,
  contact_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    csm.id,
    csm.conversation_id,
    csm.company_id,
    csm.instance_id,
    csm.created_by,
    csm.content,
    csm.message_type,
    csm.media_url,
    csm.scheduled_for,
    csm.recurring_type,
    csm.recurring_config,
    cc.contact_phone,
    cc.contact_name
  FROM chat_scheduled_messages csm
  LEFT JOIN chat_conversations cc ON csm.conversation_id = cc.id
  WHERE csm.status = 'pending'
    AND csm.scheduled_for <= NOW()
  ORDER BY csm.scheduled_for ASC
  LIMIT 100; -- Processar no máximo 100 por vez
END;
$$;

-- =====================================================
-- FUNÇÃO: mark_scheduled_message_sent
-- =====================================================
-- Marca mensagem como enviada com sucesso

CREATE OR REPLACE FUNCTION mark_scheduled_message_sent(
  p_message_id UUID,
  p_sent_message_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE chat_scheduled_messages
  SET 
    status = 'sent',
    sent_at = NOW(),
    updated_at = NOW(),
    error_message = NULL
  WHERE id = p_message_id;
  
  RETURN FOUND;
END;
$$;

-- =====================================================
-- FUNÇÃO: mark_scheduled_message_failed
-- =====================================================
-- Marca mensagem como falha com erro

CREATE OR REPLACE FUNCTION mark_scheduled_message_failed(
  p_message_id UUID,
  p_error_message TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE chat_scheduled_messages
  SET 
    status = 'failed',
    error_message = p_error_message,
    updated_at = NOW()
  WHERE id = p_message_id;
  
  RETURN FOUND;
END;
$$;

-- =====================================================
-- FUNÇÃO: create_recurring_message
-- =====================================================
-- Cria próxima ocorrência de mensagem recorrente

CREATE OR REPLACE FUNCTION create_recurring_message(
  p_original_message_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_original RECORD;
  v_next_scheduled_for TIMESTAMPTZ;
  v_new_message_id UUID;
  v_end_date TIMESTAMPTZ;
BEGIN
  -- Buscar mensagem original
  SELECT * INTO v_original
  FROM chat_scheduled_messages
  WHERE id = p_original_message_id;
  
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  
  -- Verificar se é recorrente
  IF v_original.recurring_type = 'none' THEN
    RETURN NULL;
  END IF;
  
  -- Verificar data final de recorrência
  IF v_original.recurring_config ? 'end_date' THEN
    v_end_date := (v_original.recurring_config->>'end_date')::TIMESTAMPTZ;
    IF v_end_date IS NOT NULL AND NOW() >= v_end_date THEN
      RETURN NULL; -- Recorrência finalizada
    END IF;
  END IF;
  
  -- Calcular próxima data de agendamento
  CASE v_original.recurring_type
    WHEN 'daily' THEN
      v_next_scheduled_for := v_original.scheduled_for + INTERVAL '1 day';
      
    WHEN 'weekly' THEN
      v_next_scheduled_for := v_original.scheduled_for + INTERVAL '7 days';
      
    WHEN 'monthly' THEN
      v_next_scheduled_for := v_original.scheduled_for + INTERVAL '1 month';
      
    ELSE
      RETURN NULL;
  END CASE;
  
  -- Verificar se próxima data não ultrapassa data final
  IF v_end_date IS NOT NULL AND v_next_scheduled_for > v_end_date THEN
    RETURN NULL;
  END IF;
  
  -- Criar nova mensagem agendada
  INSERT INTO chat_scheduled_messages (
    conversation_id,
    company_id,
    instance_id,
    created_by,
    content,
    message_type,
    media_url,
    scheduled_for,
    recurring_type,
    recurring_config,
    status
  )
  VALUES (
    v_original.conversation_id,
    v_original.company_id,
    v_original.instance_id,
    v_original.created_by,
    v_original.content,
    v_original.message_type,
    v_original.media_url,
    v_next_scheduled_for,
    v_original.recurring_type,
    v_original.recurring_config,
    'pending'
  )
  RETURNING id INTO v_new_message_id;
  
  RETURN v_new_message_id;
END;
$$;

-- =====================================================
-- COMENTÁRIOS
-- =====================================================

COMMENT ON FUNCTION get_pending_scheduled_messages IS 'Retorna mensagens pendentes que devem ser enviadas agora (scheduled_for <= NOW())';
COMMENT ON FUNCTION mark_scheduled_message_sent IS 'Marca mensagem agendada como enviada com sucesso';
COMMENT ON FUNCTION mark_scheduled_message_failed IS 'Marca mensagem agendada como falha com mensagem de erro';
COMMENT ON FUNCTION create_recurring_message IS 'Cria próxima ocorrência de mensagem recorrente baseada na original';
