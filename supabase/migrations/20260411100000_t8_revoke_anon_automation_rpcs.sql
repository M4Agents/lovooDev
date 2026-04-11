-- =====================================================
-- MIGRATION: T8 — REVOGAR GRANT ANON DAS RPCs DE AUTOMAÇÃO
-- Data: 11/04/2026
-- Objetivo: Fechar acesso anônimo às RPCs de retomada de automação
-- =====================================================
--
-- CONTEXTO:
-- As 3 RPCs abaixo foram criadas com GRANT EXECUTE TO anon para
-- suportar chamadas via webhook com client anon. Após esta migration,
-- apenas roles autenticados podem chamá-las diretamente.
-- O backend (resume-execution.js, user-input-response.js) usa
-- service_role, que bypassa grants e continua funcionando normalmente.
--
-- IMPACTO:
--   - anon:          BLOQUEADO (chamadas diretas sem JWT rejeitadas)
--   - authenticated: PERMITIDO  (usuários com JWT válido)
--   - service_role:  SEMPRE PERMITIDO (bypassa grants no PostgreSQL)
--
-- ROLLBACK:
--   GRANT EXECUTE ON FUNCTION public.resume_automation_execution(uuid, text, text) TO anon;
--   GRANT EXECUTE ON FUNCTION public.find_and_resume_paused_automation(uuid, integer, text) TO anon;
--   GRANT EXECUTE ON FUNCTION public.continue_automation_execution(uuid, text) TO anon;
-- =====================================================

-- =====================================================
-- 1. resume_automation_execution
-- =====================================================

REVOKE EXECUTE ON FUNCTION public.resume_automation_execution(uuid, text, text) FROM anon;

GRANT EXECUTE ON FUNCTION public.resume_automation_execution(uuid, text, text) TO authenticated;

-- =====================================================
-- 2. find_and_resume_paused_automation
-- Inclui validação de vínculo do usuário com p_company_id
-- quando chamado por usuário autenticado (auth.uid() IS NOT NULL).
-- Chamadas via service_role (auth.uid() IS NULL) pulam a verificação
-- pois o backend já validou o contexto.
-- =====================================================

REVOKE EXECUTE ON FUNCTION public.find_and_resume_paused_automation(uuid, integer, text) FROM anon;

GRANT EXECUTE ON FUNCTION public.find_and_resume_paused_automation(uuid, integer, text) TO authenticated;

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
  -- Validar vínculo do usuário autenticado com a empresa solicitada.
  -- Quando chamado via service_role (backend), auth.uid() é NULL e
  -- o bloco é ignorado — o backend é responsável pela validação.
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM company_users
      WHERE user_id = auth.uid()
        AND company_id = p_company_id
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Acesso negado: usuário não pertence à empresa'
      );
    END IF;
  END IF;

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
-- 3. continue_automation_execution
-- =====================================================

REVOKE EXECUTE ON FUNCTION public.continue_automation_execution(uuid, text) FROM anon;

GRANT EXECUTE ON FUNCTION public.continue_automation_execution(uuid, text) TO authenticated;
