-- Corrige find_and_resume_paused_automation para NÃO alterar o status
-- prematuramente. O papel do RPC era encontrar a execução e chamar
-- continue-execution; agora o webhook faz a busca diretamente e chama
-- continue-execution, mas mantemos o RPC corrigido como fallback.
--
-- Mudanças:
--   1. Remove o UPDATE que alterava status e variáveis (gerava race condition)
--   2. Apenas retorna o execution_id — quem resume é o continue-execution
--   3. Adiciona fallback: se não encontrar por lead_id, tenta lead_id IS NULL

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
BEGIN
  -- Verificação de acesso (apenas quando há sessão de usuário)
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM company_users
      WHERE user_id = auth.uid() AND company_id = p_company_id
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Acesso negado: usuário não pertence à empresa'
      );
    END IF;
  END IF;

  -- Busca 1: por lead_id exato
  SELECT id, variables INTO v_execution
  FROM automation_executions
  WHERE company_id = p_company_id
    AND lead_id = p_lead_id
    AND status = 'paused'
    AND variables ? '_awaiting_input'
  ORDER BY paused_at DESC NULLS LAST
  LIMIT 1;

  -- Busca 2 (fallback): execução pausada sem lead_id para a empresa
  IF v_execution.id IS NULL THEN
    SELECT id, variables INTO v_execution
    FROM automation_executions
    WHERE company_id = p_company_id
      AND lead_id IS NULL
      AND status = 'paused'
      AND variables ? '_awaiting_input'
    ORDER BY paused_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_execution.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'found', false,
      'message', 'Nenhuma automação pausada encontrada'
    );
  END IF;

  -- Retorna apenas o execution_id; quem efetua o resume é continue-execution.ts
  RETURN jsonb_build_object(
    'success', true,
    'found', true,
    'awaiting_input', true,
    'execution_id', v_execution.id,
    'message', 'Execução pausada encontrada — chame continue-execution para retomar'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;
