-- =====================================================
-- WEBHOOK AVANÇADO - SISTEMA DE DISPAROS AUTOMÁTICOS
-- =====================================================
-- Migração para adicionar funcionalidade de webhook avançado
-- sem alterar nenhuma estrutura existente do sistema
-- Data: 2024-11-05 10:36:00

-- Tabela para configurações de webhook avançado
CREATE TABLE IF NOT EXISTS webhook_trigger_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  webhook_url text NOT NULL,
  is_active boolean DEFAULT true,
  trigger_events text[] DEFAULT ARRAY['lead_converted'],
  conditions jsonb DEFAULT '{}',
  payload_fields jsonb DEFAULT '{"lead": ["name", "email", "phone", "status", "origin"], "empresa": [], "analytics": []}',
  timeout_seconds integer DEFAULT 10 CHECK (timeout_seconds >= 5 AND timeout_seconds <= 60),
  retry_attempts integer DEFAULT 3 CHECK (retry_attempts >= 0 AND retry_attempts <= 10),
  headers jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tabela para logs de disparos de webhook avançado
CREATE TABLE IF NOT EXISTS webhook_trigger_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid REFERENCES webhook_trigger_configs(id) ON DELETE CASCADE NOT NULL,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  trigger_event text NOT NULL,
  payload jsonb NOT NULL,
  webhook_url text NOT NULL,
  response_status integer,
  response_body text,
  response_headers jsonb,
  error_message text,
  attempt_number integer DEFAULT 1,
  execution_time_ms integer,
  triggered_at timestamptz DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_webhook_trigger_configs_company ON webhook_trigger_configs(company_id);
CREATE INDEX IF NOT EXISTS idx_webhook_trigger_configs_active ON webhook_trigger_configs(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_webhook_trigger_logs_config ON webhook_trigger_logs(config_id);
CREATE INDEX IF NOT EXISTS idx_webhook_trigger_logs_company ON webhook_trigger_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_webhook_trigger_logs_triggered_at ON webhook_trigger_logs(triggered_at);

-- Trigger para updated_at na tabela webhook_trigger_configs
CREATE TRIGGER update_webhook_trigger_configs_updated_at 
  BEFORE UPDATE ON webhook_trigger_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security) para webhook_trigger_configs
ALTER TABLE webhook_trigger_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their company webhook configs" ON webhook_trigger_configs
  FOR SELECT USING (
    company_id IN (
      SELECT c.id FROM companies c
      WHERE c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert webhook configs for their company" ON webhook_trigger_configs
  FOR INSERT WITH CHECK (
    company_id IN (
      SELECT c.id FROM companies c
      WHERE c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their company webhook configs" ON webhook_trigger_configs
  FOR UPDATE USING (
    company_id IN (
      SELECT c.id FROM companies c
      WHERE c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their company webhook configs" ON webhook_trigger_configs
  FOR DELETE USING (
    company_id IN (
      SELECT c.id FROM companies c
      WHERE c.user_id = auth.uid()
    )
  );

-- RLS para webhook_trigger_logs
ALTER TABLE webhook_trigger_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their company webhook logs" ON webhook_trigger_logs
  FOR SELECT USING (
    company_id IN (
      SELECT c.id FROM companies c
      WHERE c.user_id = auth.uid()
    )
  );

-- =====================================================
-- FUNÇÕES RPC PARA WEBHOOK AVANÇADO
-- =====================================================

-- Função para buscar configurações de webhook
CREATE OR REPLACE FUNCTION get_webhook_trigger_configs(p_company_id uuid)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  name text,
  webhook_url text,
  is_active boolean,
  trigger_events text[],
  conditions jsonb,
  payload_fields jsonb,
  timeout_seconds integer,
  retry_attempts integer,
  headers jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verificar se o usuário tem acesso à empresa
  IF NOT EXISTS (
    SELECT 1 FROM companies c 
    WHERE c.id = p_company_id AND c.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied to company';
  END IF;

  RETURN QUERY
  SELECT 
    wtc.id,
    wtc.company_id,
    wtc.name,
    wtc.webhook_url,
    wtc.is_active,
    wtc.trigger_events,
    wtc.conditions,
    wtc.payload_fields,
    wtc.timeout_seconds,
    wtc.retry_attempts,
    wtc.headers,
    wtc.created_at,
    wtc.updated_at
  FROM webhook_trigger_configs wtc
  WHERE wtc.company_id = p_company_id
  ORDER BY wtc.created_at DESC;
END;
$$;

-- Função para criar configuração de webhook
CREATE OR REPLACE FUNCTION create_webhook_trigger_config(
  p_company_id uuid,
  p_name text,
  p_webhook_url text,
  p_is_active boolean DEFAULT true,
  p_trigger_events text DEFAULT '["lead_converted"]',
  p_conditions text DEFAULT '{}',
  p_payload_fields text DEFAULT '{"lead": ["name", "email", "phone", "status", "origin"], "empresa": [], "analytics": []}',
  p_timeout_seconds integer DEFAULT 10,
  p_retry_attempts integer DEFAULT 3,
  p_headers text DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_config_id uuid;
  parsed_trigger_events text[];
  parsed_conditions jsonb;
  parsed_payload_fields jsonb;
  parsed_headers jsonb;
BEGIN
  -- Verificar se o usuário tem acesso à empresa
  IF NOT EXISTS (
    SELECT 1 FROM companies c 
    WHERE c.id = p_company_id AND c.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied to company';
  END IF;

  -- Validar e parsear JSON
  BEGIN
    parsed_trigger_events := ARRAY(SELECT jsonb_array_elements_text(p_trigger_events::jsonb));
    parsed_conditions := p_conditions::jsonb;
    parsed_payload_fields := p_payload_fields::jsonb;
    parsed_headers := p_headers::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid JSON format in parameters';
  END;

  -- Inserir nova configuração
  INSERT INTO webhook_trigger_configs (
    company_id,
    name,
    webhook_url,
    is_active,
    trigger_events,
    conditions,
    payload_fields,
    timeout_seconds,
    retry_attempts,
    headers
  ) VALUES (
    p_company_id,
    p_name,
    p_webhook_url,
    p_is_active,
    parsed_trigger_events,
    parsed_conditions,
    parsed_payload_fields,
    p_timeout_seconds,
    p_retry_attempts,
    parsed_headers
  ) RETURNING id INTO new_config_id;

  RETURN new_config_id;
END;
$$;

-- Função para atualizar configuração de webhook
CREATE OR REPLACE FUNCTION update_webhook_trigger_config(
  p_id uuid,
  p_company_id uuid,
  p_name text DEFAULT NULL,
  p_webhook_url text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_trigger_events text DEFAULT NULL,
  p_conditions text DEFAULT NULL,
  p_payload_fields text DEFAULT NULL,
  p_timeout_seconds integer DEFAULT NULL,
  p_retry_attempts integer DEFAULT NULL,
  p_headers text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  parsed_trigger_events text[];
  parsed_conditions jsonb;
  parsed_payload_fields jsonb;
  parsed_headers jsonb;
BEGIN
  -- Verificar se o usuário tem acesso à empresa e configuração
  IF NOT EXISTS (
    SELECT 1 FROM webhook_trigger_configs wtc
    JOIN companies c ON wtc.company_id = c.id
    WHERE wtc.id = p_id AND wtc.company_id = p_company_id AND c.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied to webhook configuration';
  END IF;

  -- Parsear JSONs se fornecidos
  IF p_trigger_events IS NOT NULL THEN
    parsed_trigger_events := ARRAY(SELECT jsonb_array_elements_text(p_trigger_events::jsonb));
  END IF;
  
  IF p_conditions IS NOT NULL THEN
    parsed_conditions := p_conditions::jsonb;
  END IF;
  
  IF p_payload_fields IS NOT NULL THEN
    parsed_payload_fields := p_payload_fields::jsonb;
  END IF;
  
  IF p_headers IS NOT NULL THEN
    parsed_headers := p_headers::jsonb;
  END IF;

  -- Atualizar configuração
  UPDATE webhook_trigger_configs SET
    name = COALESCE(p_name, name),
    webhook_url = COALESCE(p_webhook_url, webhook_url),
    is_active = COALESCE(p_is_active, is_active),
    trigger_events = COALESCE(parsed_trigger_events, trigger_events),
    conditions = COALESCE(parsed_conditions, conditions),
    payload_fields = COALESCE(parsed_payload_fields, payload_fields),
    timeout_seconds = COALESCE(p_timeout_seconds, timeout_seconds),
    retry_attempts = COALESCE(p_retry_attempts, retry_attempts),
    headers = COALESCE(parsed_headers, headers),
    updated_at = now()
  WHERE id = p_id;

  RETURN true;
END;
$$;

-- Função para deletar configuração de webhook
CREATE OR REPLACE FUNCTION delete_webhook_trigger_config(
  p_id uuid,
  p_company_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verificar se o usuário tem acesso à empresa e configuração
  IF NOT EXISTS (
    SELECT 1 FROM webhook_trigger_configs wtc
    JOIN companies c ON wtc.company_id = c.id
    WHERE wtc.id = p_id AND wtc.company_id = p_company_id AND c.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied to webhook configuration';
  END IF;

  -- Deletar configuração (logs serão deletados automaticamente por CASCADE)
  DELETE FROM webhook_trigger_configs WHERE id = p_id;

  RETURN true;
END;
$$;

-- Função para buscar logs de webhook
CREATE OR REPLACE FUNCTION get_webhook_trigger_logs(
  p_company_id uuid,
  p_config_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  config_id uuid,
  config_name text,
  trigger_event text,
  webhook_url text,
  response_status integer,
  response_body text,
  error_message text,
  attempt_number integer,
  execution_time_ms integer,
  triggered_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verificar se o usuário tem acesso à empresa
  IF NOT EXISTS (
    SELECT 1 FROM companies c 
    WHERE c.id = p_company_id AND c.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied to company';
  END IF;

  RETURN QUERY
  SELECT 
    wtl.id,
    wtl.config_id,
    wtc.name as config_name,
    wtl.trigger_event,
    wtl.webhook_url,
    wtl.response_status,
    wtl.response_body,
    wtl.error_message,
    wtl.attempt_number,
    wtl.execution_time_ms,
    wtl.triggered_at
  FROM webhook_trigger_logs wtl
  JOIN webhook_trigger_configs wtc ON wtl.config_id = wtc.id
  WHERE wtl.company_id = p_company_id
    AND (p_config_id IS NULL OR wtl.config_id = p_config_id)
  ORDER BY wtl.triggered_at DESC
  LIMIT p_limit;
END;
$$;

-- Comentários para documentação
COMMENT ON TABLE webhook_trigger_configs IS 'Configurações de webhooks avançados que são disparados automaticamente por eventos do sistema';
COMMENT ON TABLE webhook_trigger_logs IS 'Logs de execução dos webhooks avançados para auditoria e debugging';
COMMENT ON FUNCTION get_webhook_trigger_configs(uuid) IS 'Busca configurações de webhook de uma empresa';
COMMENT ON FUNCTION create_webhook_trigger_config(uuid, text, text, boolean, text, text, text, integer, integer, text) IS 'Cria nova configuração de webhook avançado';
COMMENT ON FUNCTION update_webhook_trigger_config(uuid, uuid, text, text, boolean, text, text, text, integer, integer, text) IS 'Atualiza configuração de webhook existente';
COMMENT ON FUNCTION delete_webhook_trigger_config(uuid, uuid) IS 'Remove configuração de webhook';
COMMENT ON FUNCTION get_webhook_trigger_logs(uuid, uuid, integer) IS 'Busca logs de execução de webhooks';
