-- =====================================================
-- SISTEMA DE AGENDAMENTO DE MENSAGENS DO CHAT
-- =====================================================
-- Data: 2026-02-24 14:57
-- Descrição: Tabela e funções para agendamento de mensagens

-- =====================================================
-- TABELA: chat_scheduled_messages
-- =====================================================

CREATE TABLE IF NOT EXISTS chat_scheduled_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL,
  created_by UUID NOT NULL,
  
  -- Conteúdo da mensagem
  content TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'video', 'audio', 'document')),
  media_url TEXT,
  
  -- Agendamento
  scheduled_for TIMESTAMPTZ NOT NULL,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  
  -- Recorrência
  recurring_type TEXT NOT NULL DEFAULT 'none' CHECK (recurring_type IN ('none', 'daily', 'weekly', 'monthly')),
  recurring_config JSONB DEFAULT '{}'::jsonb,
  
  -- Metadados
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- ÍNDICES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_chat_scheduled_messages_conversation 
  ON chat_scheduled_messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_chat_scheduled_messages_company 
  ON chat_scheduled_messages(company_id);

CREATE INDEX IF NOT EXISTS idx_chat_scheduled_messages_status 
  ON chat_scheduled_messages(status);

CREATE INDEX IF NOT EXISTS idx_chat_scheduled_messages_scheduled_for 
  ON chat_scheduled_messages(scheduled_for) 
  WHERE status = 'pending';

-- =====================================================
-- RLS (Row Level Security)
-- =====================================================

ALTER TABLE chat_scheduled_messages ENABLE ROW LEVEL SECURITY;

-- Política: Usuários podem ver mensagens da própria empresa
CREATE POLICY chat_scheduled_messages_select_policy ON chat_scheduled_messages
  FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM user_companies 
      WHERE user_id = auth.uid()
    )
  );

-- Política: Usuários podem inserir mensagens da própria empresa
CREATE POLICY chat_scheduled_messages_insert_policy ON chat_scheduled_messages
  FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM user_companies 
      WHERE user_id = auth.uid()
    )
  );

-- Política: Usuários podem atualizar mensagens da própria empresa
CREATE POLICY chat_scheduled_messages_update_policy ON chat_scheduled_messages
  FOR UPDATE
  USING (
    company_id IN (
      SELECT company_id FROM user_companies 
      WHERE user_id = auth.uid()
    )
  );

-- Política: Usuários podem deletar mensagens da própria empresa
CREATE POLICY chat_scheduled_messages_delete_policy ON chat_scheduled_messages
  FOR DELETE
  USING (
    company_id IN (
      SELECT company_id FROM user_companies 
      WHERE user_id = auth.uid()
    )
  );

-- =====================================================
-- FUNÇÃO: chat_schedule_message
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
  p_recurring_config JSONB DEFAULT '{}'::jsonb
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
  
  -- Inserir mensagem agendada
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
    'pending'
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
-- FUNÇÃO: chat_get_scheduled_messages
-- =====================================================

CREATE OR REPLACE FUNCTION chat_get_scheduled_messages(
  p_company_id UUID,
  p_conversation_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_messages JSON;
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
  
  -- Buscar mensagens agendadas
  SELECT json_agg(
    json_build_object(
      'id', csm.id,
      'conversation_id', csm.conversation_id,
      'company_id', csm.company_id,
      'instance_id', csm.instance_id,
      'created_by', csm.created_by,
      'content', csm.content,
      'message_type', csm.message_type,
      'media_url', csm.media_url,
      'scheduled_for', csm.scheduled_for,
      'status', csm.status,
      'recurring_type', csm.recurring_type,
      'recurring_config', csm.recurring_config,
      'sent_at', csm.sent_at,
      'error_message', csm.error_message,
      'created_at', csm.created_at,
      'updated_at', csm.updated_at
    )
    ORDER BY csm.scheduled_for ASC
  ) INTO v_messages
  FROM chat_scheduled_messages csm
  WHERE csm.company_id = p_company_id
    AND (p_conversation_id IS NULL OR csm.conversation_id = p_conversation_id)
    AND (p_status IS NULL OR csm.status = p_status);
  
  RETURN json_build_object(
    'success', true,
    'data', COALESCE(v_messages, '[]'::json)
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
-- TRIGGER: Atualizar updated_at
-- =====================================================

CREATE OR REPLACE FUNCTION update_chat_scheduled_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_chat_scheduled_messages_updated_at
  BEFORE UPDATE ON chat_scheduled_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_scheduled_messages_updated_at();

-- =====================================================
-- COMENTÁRIOS
-- =====================================================

COMMENT ON TABLE chat_scheduled_messages IS 'Mensagens agendadas do chat WhatsApp';
COMMENT ON COLUMN chat_scheduled_messages.recurring_type IS 'Tipo de recorrência: none, daily, weekly, monthly';
COMMENT ON COLUMN chat_scheduled_messages.recurring_config IS 'Configuração da recorrência (JSON): end_date, days_of_week, day_of_month';
COMMENT ON FUNCTION chat_schedule_message IS 'Agendar uma nova mensagem no chat';
COMMENT ON FUNCTION chat_get_scheduled_messages IS 'Buscar mensagens agendadas com filtros opcionais';
