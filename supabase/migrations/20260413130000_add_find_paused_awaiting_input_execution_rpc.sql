-- RPC para buscar execução pausada aguardando user_input
-- SECURITY DEFINER: bypassa RLS para uso interno nos webhooks
-- Prioridade: lead_id exato → lead_id IS NULL (fallback)

CREATE OR REPLACE FUNCTION public.find_paused_awaiting_input_execution(
  p_company_id uuid,
  p_lead_id integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_execution RECORD;
BEGIN
  -- Busca 1: por lead_id exato (se informado)
  IF p_lead_id IS NOT NULL THEN
    SELECT id, lead_id, current_node_id, paused_at
    INTO v_execution
    FROM automation_executions
    WHERE company_id = p_company_id
      AND status = 'paused'
      AND lead_id = p_lead_id
      AND variables ? '_awaiting_input'
    ORDER BY paused_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  -- Busca 2: fallback por lead_id IS NULL
  IF v_execution.id IS NULL THEN
    SELECT id, lead_id, current_node_id, paused_at
    INTO v_execution
    FROM automation_executions
    WHERE company_id = p_company_id
      AND status = 'paused'
      AND lead_id IS NULL
      AND variables ? '_awaiting_input'
    ORDER BY paused_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_execution.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'execution_id', v_execution.id,
    'lead_id', v_execution.lead_id,
    'current_node_id', v_execution.current_node_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('found', false, 'error', SQLERRM);
END;
$$;
