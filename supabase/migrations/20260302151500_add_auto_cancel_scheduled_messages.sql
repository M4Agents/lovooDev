-- =====================================================
-- SISTEMA DE CANCELAMENTO AUTOMÁTICO DE MENSAGENS AGENDADAS
-- =====================================================
-- Data: 2026-03-02 15:15
-- Descrição: Adiciona funcionalidade de cancelamento automático quando lead responde
--            com opções para mensagens recorrentes (cancelar próxima ou todas)

-- =====================================================
-- FASE 1: ADICIONAR NOVOS CAMPOS
-- =====================================================

ALTER TABLE chat_scheduled_messages
ADD COLUMN IF NOT EXISTS cancel_if_lead_replies BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS cancel_scope VARCHAR(20) DEFAULT 'next_only' 
  CHECK (cancel_scope IN ('next_only', 'all_future')),
ADD COLUMN IF NOT EXISTS recurring_parent_id UUID REFERENCES chat_scheduled_messages(id) ON DELETE SET NULL;

COMMENT ON COLUMN chat_scheduled_messages.cancel_if_lead_replies 
IS 'Se true, cancela automaticamente se lead enviar mensagem antes do horário agendado';

COMMENT ON COLUMN chat_scheduled_messages.cancel_scope 
IS 'Escopo do cancelamento para mensagens recorrentes: next_only (apenas próxima) ou all_future (todas futuras)';

COMMENT ON COLUMN chat_scheduled_messages.recurring_parent_id 
IS 'ID da mensagem original que gerou esta recorrência (para rastreamento de séries)';

-- =====================================================
-- FASE 2: CRIAR ÍNDICES PARA PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_chat_scheduled_messages_auto_cancel 
ON chat_scheduled_messages(conversation_id, status, cancel_if_lead_replies)
WHERE status = 'pending' AND cancel_if_lead_replies = true;

CREATE INDEX IF NOT EXISTS idx_chat_scheduled_messages_recurring_parent 
ON chat_scheduled_messages(recurring_parent_id)
WHERE recurring_parent_id IS NOT NULL;

-- =====================================================
-- FASE 3: FUNÇÃO DE CANCELAMENTO AUTOMÁTICO INTELIGENTE
-- =====================================================

CREATE OR REPLACE FUNCTION auto_cancel_scheduled_messages_on_reply(
  p_conversation_id UUID,
  p_company_id UUID
)
RETURNS TABLE (
  cancelled_count INTEGER,
  cancelled_ids UUID[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cancelled_count INTEGER := 0;
  v_cancelled_ids UUID[] := '{}';
  v_message RECORD;
  v_parent_id UUID;
  v_additional_cancelled INTEGER;
BEGIN
  -- Buscar mensagens pendentes com auto-cancel ativo
  FOR v_message IN
    SELECT id, cancel_scope, recurring_parent_id, recurring_type
    FROM chat_scheduled_messages
    WHERE conversation_id = p_conversation_id
      AND company_id = p_company_id
      AND status = 'pending'
      AND cancel_if_lead_replies = true
      AND scheduled_for > NOW()
    ORDER BY scheduled_for ASC
  LOOP
    -- Cancelar a mensagem atual
    UPDATE chat_scheduled_messages
    SET 
      status = 'cancelled',
      error_message = 'Cancelada automaticamente: lead respondeu antes do horário agendado',
      updated_at = NOW()
    WHERE id = v_message.id;
    
    v_cancelled_count := v_cancelled_count + 1;
    v_cancelled_ids := array_append(v_cancelled_ids, v_message.id);
    
    -- Se escopo for 'all_future' e for mensagem recorrente
    IF v_message.cancel_scope = 'all_future' AND v_message.recurring_type != 'none' THEN
      
      -- Determinar o ID pai (pode ser ela mesma ou o parent)
      v_parent_id := COALESCE(v_message.recurring_parent_id, v_message.id);
      
      -- Cancelar TODAS as futuras mensagens da mesma série recorrente
      WITH cancelled_series AS (
        UPDATE chat_scheduled_messages
        SET 
          status = 'cancelled',
          error_message = 'Cancelada automaticamente: série recorrente cancelada após resposta do lead',
          updated_at = NOW()
        WHERE conversation_id = p_conversation_id
          AND company_id = p_company_id
          AND status = 'pending'
          AND scheduled_for > NOW()
          AND (
            -- Mensagens filhas desta série
            recurring_parent_id = v_parent_id
            OR
            -- A própria mensagem pai (se ainda não foi processada)
            id = v_parent_id
          )
          AND id != v_message.id -- Não cancelar novamente a atual
        RETURNING id
      )
      SELECT array_agg(id), COUNT(*)::INTEGER
      INTO v_cancelled_ids, v_additional_cancelled
      FROM cancelled_series;
      
      -- Adicionar ao contador
      v_cancelled_count := v_cancelled_count + COALESCE(v_additional_cancelled, 0);
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_cancelled_count, v_cancelled_ids;
END;
$$;

COMMENT ON FUNCTION auto_cancel_scheduled_messages_on_reply 
IS 'Cancela mensagens agendadas quando lead responde, respeitando escopo (next_only ou all_future)';

-- =====================================================
-- FASE 4: ATUALIZAR FUNÇÃO create_recurring_message
-- =====================================================

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
  v_parent_id UUID;
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
  
  -- Determinar o parent_id (rastrear série)
  v_parent_id := COALESCE(v_original.recurring_parent_id, v_original.id);
  
  -- Criar nova mensagem agendada COM VÍNCULO AO PAI
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
    status,
    cancel_if_lead_replies,
    cancel_scope,
    recurring_parent_id
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
    'pending',
    COALESCE(v_original.cancel_if_lead_replies, false),
    COALESCE(v_original.cancel_scope, 'next_only'),
    v_parent_id
  )
  RETURNING id INTO v_new_message_id;
  
  RETURN v_new_message_id;
END;
$$;

-- =====================================================
-- FASE 5: ATUALIZAR FUNÇÃO chat_schedule_message
-- =====================================================

CREATE OR REPLACE FUNCTION chat_schedule_message(
  p_conversation_id UUID,
  p_company_id UUID,
  p_instance_id UUID,
  p_created_by UUID,
  p_content TEXT,
  p_scheduled_for TIMESTAMPTZ,
  p_message_type TEXT DEFAULT 'text',
  p_media_url TEXT DEFAULT NULL,
  p_recurring_type TEXT DEFAULT 'none',
  p_recurring_config JSONB DEFAULT '{}'::jsonb,
  p_cancel_if_lead_replies BOOLEAN DEFAULT false,
  p_cancel_scope TEXT DEFAULT 'next_only'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_scheduled_id UUID;
  v_user_id UUID;
BEGIN
  -- Obter user_id do contexto de autenticação
  v_user_id := auth.uid();
  
  -- Validar se usuário pertence à empresa
  IF NOT EXISTS (
    SELECT 1 FROM user_companies 
    WHERE user_id = v_user_id 
    AND company_id = p_company_id
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Usuário não pertence a esta empresa'
    );
  END IF;
  
  -- Validar se conversa existe e pertence à empresa
  IF NOT EXISTS (
    SELECT 1 FROM chat_conversations 
    WHERE id = p_conversation_id 
    AND company_id = p_company_id
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Conversa não encontrada ou não pertence a esta empresa'
    );
  END IF;
  
  -- Inserir mensagem agendada COM NOVOS CAMPOS
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
    status,
    cancel_if_lead_replies,
    cancel_scope
  ) VALUES (
    p_conversation_id,
    p_company_id,
    p_instance_id,
    COALESCE(p_created_by, v_user_id),
    p_content,
    p_message_type,
    p_media_url,
    p_scheduled_for,
    p_recurring_type,
    p_recurring_config,
    'pending',
    p_cancel_if_lead_replies,
    p_cancel_scope
  )
  RETURNING id INTO v_scheduled_id;
  
  RETURN json_build_object(
    'success', true,
    'scheduled_id', v_scheduled_id
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- =====================================================
-- COMENTÁRIOS FINAIS
-- =====================================================

COMMENT ON FUNCTION create_recurring_message IS 'Cria próxima ocorrência de mensagem recorrente baseada na original, preservando configurações de auto-cancel';
COMMENT ON FUNCTION chat_schedule_message IS 'Agendar uma nova mensagem no chat com opções de cancelamento automático';
