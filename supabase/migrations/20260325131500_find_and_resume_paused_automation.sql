-- =====================================================
-- MIGRATION: FIND AND RESUME PAUSED AUTOMATION
-- Data: 25/03/2026
-- Objetivo: Buscar e retomar automação pausada em uma única operação
-- =====================================================

-- =====================================================
-- FUNÇÃO: BUSCAR E RETOMAR AUTOMAÇÃO PAUSADA
-- =====================================================
-- Busca execução pausada para um lead e retoma com resposta do usuário
-- Usa SECURITY DEFINER para bypass do RLS
-- Chamada pelo webhook quando lead responde mensagem
-- =====================================================

CREATE OR REPLACE FUNCTION public.find_and_resume_paused_automation(
  p_company_id uuid,
  p_lead_id integer,
  p_user_response text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_execution RECORD;
  v_variables JSONB;
  v_variable_name TEXT;
BEGIN
  -- Buscar execução pausada mais recente para este lead
  -- CORREÇÃO LOOP: Não retornar execuções já completadas
  SELECT * INTO v_execution
  FROM automation_executions
  WHERE company_id = p_company_id
    AND lead_id = p_lead_id
    AND status = 'paused'
    AND (completed_at IS NULL OR status != 'completed')
  ORDER BY paused_at DESC NULLS LAST
  LIMIT 1;
  
  -- Se não encontrou execução pausada
  IF v_execution.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'found', false,
      'message', 'Nenhuma automação pausada encontrada'
    );
  END IF;
  
  -- Verificar se está aguardando input
  IF v_execution.variables IS NULL OR 
     v_execution.variables->'_awaiting_input' IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'found', true,
      'awaiting_input', false,
      'message', 'Execução pausada mas não aguardando input'
    );
  END IF;
  
  -- Extrair nome da variável
  v_variable_name := v_execution.variables->'_awaiting_input'->>'variable_name';
  
  IF v_variable_name IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'found', true,
      'awaiting_input', true,
      'message', 'Nome da variável não encontrado'
    );
  END IF;
  
  -- Atualizar variáveis com resposta do usuário
  v_variables := v_execution.variables;
  v_variables := jsonb_set(v_variables, ARRAY[v_variable_name], to_jsonb(p_user_response));
  
  -- Remover flag de awaiting_input
  v_variables := v_variables - '_awaiting_input';
  
  -- Atualizar execução para running
  UPDATE automation_executions
  SET 
    status = 'running',
    variables = v_variables
  WHERE id = v_execution.id;
  
  RETURN jsonb_build_object(
    'success', true,
    'found', true,
    'awaiting_input', true,
    'execution_id', v_execution.id,
    'variable_name', v_variable_name,
    'user_response', p_user_response,
    'message', 'Automação retomada com sucesso'
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

-- Permitir execução via anon (webhook usa client anon)
GRANT EXECUTE ON FUNCTION public.find_and_resume_paused_automation(uuid, integer, text) TO anon;

-- Permitir execução via service role (API)
GRANT EXECUTE ON FUNCTION public.find_and_resume_paused_automation(uuid, integer, text) TO service_role;

-- =====================================================
-- COMENTÁRIOS E DOCUMENTAÇÃO
-- =====================================================

COMMENT ON FUNCTION public.find_and_resume_paused_automation(uuid, integer, text) IS 
'Busca execução pausada para um lead e retoma com resposta do usuário. Usa SECURITY DEFINER para bypass do RLS. Chamada pelo webhook quando lead responde mensagem user_input. Operação atômica que evita múltiplas queries bloqueadas pelo RLS.';
