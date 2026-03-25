-- =====================================================
-- FUNÇÃO: CONTINUAR EXECUÇÃO DE AUTOMAÇÃO
-- =====================================================
-- Busca execução retomada e processa próximos nós
-- Usa SECURITY DEFINER para bypass do RLS
-- Chamada pelo endpoint /api/automation/resume-execution
-- =====================================================

CREATE OR REPLACE FUNCTION public.continue_automation_execution(
  p_execution_id uuid,
  p_user_response text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_execution RECORD;
  v_flow RECORD;
  v_next_nodes jsonb;
  v_current_node jsonb;
  v_result jsonb;
  v_status text;
BEGIN
  -- Buscar execução retomada (bypass RLS)
  SELECT * INTO v_execution
  FROM automation_executions
  WHERE id = p_execution_id
    AND status = 'running';
  
  -- CORREÇÃO LOOP: Verificar se execução já foi completada
  IF v_execution.id IS NULL THEN
    -- Verificar se execução existe mas já foi completada
    SELECT status INTO v_status
    FROM automation_executions
    WHERE id = p_execution_id;
    
    IF v_status = 'completed' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Execução já foi completada anteriormente',
        'execution_id', p_execution_id,
        'already_completed', true
      );
    END IF;
    
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Execução não encontrada ou não está em execução',
      'execution_id', p_execution_id
    );
  END IF;
  
  -- Buscar fluxo da automação
  SELECT 
    id,
    nodes,
    edges
  INTO v_flow
  FROM automation_flows
  WHERE id = v_execution.flow_id;
  
  IF v_flow.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Fluxo de automação não encontrado',
      'flow_id', v_execution.flow_id
    );
  END IF;
  
  -- Encontrar próximos nós a partir do nó atual
  -- O nó atual está em current_node_id
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', n.value->>'id',
      'type', n.value->>'type',
      'data', n.value->'data',
      'position', n.value->'position'
    ) ORDER BY (n.value->'position'->>'y')::numeric
  ) INTO v_next_nodes
  FROM jsonb_array_elements(v_flow.edges) e
  CROSS JOIN LATERAL jsonb_array_elements(v_flow.nodes) n
  WHERE e.value->>'source' = v_execution.current_node_id
    AND n.value->>'id' = e.value->>'target';
  
  -- Se não há próximos nós, marcar como completo
  IF v_next_nodes IS NULL OR jsonb_array_length(v_next_nodes) = 0 THEN
    UPDATE automation_executions
    SET 
      status = 'completed',
      completed_at = NOW()
    WHERE id = p_execution_id;
    
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Execução finalizada - sem próximos nós',
      'execution_id', p_execution_id,
      'next_nodes', 0
    );
  END IF;
  
  -- Retornar informações para processamento no endpoint
  -- O endpoint fará o processamento dos nós (envio de mensagens, etc)
  -- Incluir flow completo para evitar queries adicionais bloqueadas por RLS
  v_result := jsonb_build_object(
    'success', true,
    'execution_id', p_execution_id,
    'flow_id', v_execution.flow_id,
    'company_id', v_execution.company_id,
    'lead_id', v_execution.lead_id,
    'conversation_id', v_execution.trigger_data->'opportunity'->'conversation_id',
    'variables', v_execution.variables,
    'current_node_id', v_execution.current_node_id,
    'next_nodes', v_next_nodes,
    'flow_nodes', v_flow.nodes,
    'flow_edges', v_flow.edges,
    'message', 'Próximos nós encontrados - processar no endpoint'
  );
  
  RETURN v_result;
  
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'execution_id', p_execution_id
  );
END;
$$;

-- =====================================================
-- GRANTS (Segurança)
-- =====================================================

-- Permitir execução via anon (endpoint usa client anon)
GRANT EXECUTE ON FUNCTION public.continue_automation_execution(uuid, text) TO anon;

-- Permitir execução via service role (API)
GRANT EXECUTE ON FUNCTION public.continue_automation_execution(uuid, text) TO service_role;

-- =====================================================
-- COMENTÁRIOS E DOCUMENTAÇÃO
-- =====================================================

COMMENT ON FUNCTION public.continue_automation_execution(uuid, text) IS 
'Busca execução retomada e retorna próximos nós para processamento. Usa SECURITY DEFINER para bypass do RLS. Chamada pelo endpoint /api/automation/resume-execution após webhook retomar execução.';
