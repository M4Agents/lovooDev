-- Atualizar função get_webhook_trigger_logs para incluir payload
-- Isso permite visualizar o payload enviado em cada webhook

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
  payload jsonb,
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
    JOIN user_companies uc ON c.id = uc.company_id
    WHERE c.id = p_company_id AND uc.user_id = auth.uid()
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
    wtl.payload,
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

-- Comentário para documentação
COMMENT ON FUNCTION get_webhook_trigger_logs(uuid, uuid, integer) IS 'Busca logs de execução de webhooks incluindo payload enviado';
