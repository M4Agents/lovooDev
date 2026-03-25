-- =====================================================
-- MIGRATION: RESUME AUTOMATION EXECUTION
-- Data: 25/03/2026
-- Objetivo: Permitir retomada de automações pausadas via webhook
-- =====================================================

-- =====================================================
-- FUNÇÃO: RETOMAR EXECUÇÃO DE AUTOMAÇÃO
-- =====================================================
-- Atualiza execução pausada com resposta do usuário e retoma fluxo
-- Chamada pelo webhook quando lead responde mensagem user_input
-- =====================================================

CREATE OR REPLACE FUNCTION public.resume_automation_execution(
  p_execution_id uuid,
  p_user_response text,
  p_variable_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_execution RECORD;
  v_variables JSONB;
BEGIN
  -- Buscar execução pausada
  SELECT * INTO v_execution
  FROM automation_executions
  WHERE id = p_execution_id
    AND status = 'paused';
  
  IF v_execution.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Execução não encontrada ou não está pausada'
    );
  END IF;
  
  -- Atualizar variáveis com resposta do usuário
  v_variables := v_execution.variables;
  v_variables := jsonb_set(v_variables, ARRAY[p_variable_name], to_jsonb(p_user_response));
  
  -- Remover flag de awaiting_input
  v_variables := v_variables - '_awaiting_input';
  
  -- Atualizar execução para running
  UPDATE automation_executions
  SET 
    status = 'running',
    variables = v_variables,
    updated_at = NOW()
  WHERE id = p_execution_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'execution_id', p_execution_id,
    'variable_set', p_variable_name,
    'user_response', p_user_response
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

-- =====================================================
-- GRANTS (Segurança)
-- =====================================================

-- Permitir execução via anon (frontend autenticado via RLS)
GRANT EXECUTE ON FUNCTION public.resume_automation_execution(uuid, text, text) TO anon;

-- Permitir execução via service role (API)
GRANT EXECUTE ON FUNCTION public.resume_automation_execution(uuid, text, text) TO service_role;

-- =====================================================
-- COMENTÁRIOS E DOCUMENTAÇÃO
-- =====================================================

COMMENT ON FUNCTION public.resume_automation_execution(uuid, text, text) IS 
'Retoma execução de automação pausada com resposta do usuário. Atualiza variável especificada e muda status para running. Chamada pelo webhook quando lead responde mensagem user_input.';
