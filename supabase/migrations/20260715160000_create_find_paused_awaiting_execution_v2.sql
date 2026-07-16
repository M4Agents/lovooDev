-- =====================================================
-- MIGRATION: find_paused_awaiting_execution_v2
-- Data: 15/07/2026
-- Objetivo: Localizar execuções pausadas aguardando:
--   - awaiting_input  → marcador _awaiting_input
--   - delay_response  → marcador _awaiting_delay_response
--
-- Diferença da v1 (find_paused_awaiting_input_execution):
--   - Suporta ambos os tipos de espera via p_awaiting_type
--   - Retorna awaiting_node_id, schedule_id, automation_id
--   - Sem side effects — apenas localiza, nunca modifica
--
-- A v1 NÃO é alterada nem removida (compatibilidade preservada).
-- =====================================================

CREATE OR REPLACE FUNCTION public.find_paused_awaiting_execution_v2(
  p_company_id    uuid,
  p_lead_id       integer DEFAULT NULL,
  p_awaiting_type text    DEFAULT 'awaiting_input'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_marker_key  text;
  v_execution   RECORD;
  v_marker      jsonb;
BEGIN
  -- -------------------------------------------------------
  -- Determinar chave do marcador com base no awaiting_type
  -- -------------------------------------------------------
  IF p_awaiting_type = 'awaiting_input' THEN
    v_marker_key := '_awaiting_input';
  ELSIF p_awaiting_type = 'delay_response' THEN
    v_marker_key := '_awaiting_delay_response';
  ELSE
    RETURN jsonb_build_object(
      'found', false,
      'error', 'awaiting_type inválido: ' || COALESCE(p_awaiting_type, 'null')
    );
  END IF;

  -- -------------------------------------------------------
  -- Busca 1: por lead_id exato (quando informado)
  -- -------------------------------------------------------
  IF p_lead_id IS NOT NULL THEN
    SELECT
      ae.id,
      ae.flow_id,
      ae.company_id,
      ae.lead_id,
      ae.paused_at,
      ae.variables -> v_marker_key AS marker
    INTO v_execution
    FROM automation_executions ae
    WHERE ae.company_id = p_company_id
      AND ae.status     = 'paused'
      AND ae.lead_id    = p_lead_id
      AND ae.variables  ? v_marker_key
    ORDER BY ae.paused_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  -- -------------------------------------------------------
  -- Busca 2: fallback por lead_id IS NULL
  -- (mantém comportamento idêntico à v1)
  -- -------------------------------------------------------
  IF v_execution.id IS NULL THEN
    SELECT
      ae.id,
      ae.flow_id,
      ae.company_id,
      ae.lead_id,
      ae.paused_at,
      ae.variables -> v_marker_key AS marker
    INTO v_execution
    FROM automation_executions ae
    WHERE ae.company_id = p_company_id
      AND ae.status     = 'paused'
      AND ae.lead_id    IS NULL
      AND ae.variables  ? v_marker_key
    ORDER BY ae.paused_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  -- Nenhuma execução encontrada
  IF v_execution.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_marker := v_execution.marker;

  -- -------------------------------------------------------
  -- Retorno — dados suficientes para claim e logging
  -- -------------------------------------------------------
  RETURN jsonb_build_object(
    'found',          true,
    'execution_id',   v_execution.id,
    'automation_id',  v_execution.flow_id,
    'company_id',     v_execution.company_id,
    'awaiting_type',  p_awaiting_type,
    -- node_id está presente em ambos os tipos de marcador
    'awaiting_node_id', v_marker ->>'node_id',
    -- schedule_id existe apenas em _awaiting_delay_response; null para _awaiting_input
    'schedule_id',    v_marker ->>'schedule_id',
    'paused_at',      v_execution.paused_at
  );

EXCEPTION WHEN OTHERS THEN
  -- Fail-safe: nunca lançar exceção — retornar found=false com diagnóstico
  RETURN jsonb_build_object(
    'found', false,
    'error', SQLERRM
  );
END;
$$;

-- =====================================================
-- GRANTS
-- Consistente com as demais RPCs SECURITY DEFINER do projeto.
-- anon:         webhook (client anon) precisa chamar esta RPC
-- service_role: process-schedules (getSupabaseAdmin) e testes
-- =====================================================
GRANT EXECUTE ON FUNCTION public.find_paused_awaiting_execution_v2(uuid, integer, text) TO anon;
GRANT EXECUTE ON FUNCTION public.find_paused_awaiting_execution_v2(uuid, integer, text) TO service_role;

-- =====================================================
-- COMENTÁRIO
-- =====================================================
COMMENT ON FUNCTION public.find_paused_awaiting_execution_v2(uuid, integer, text) IS
'Localiza execução pausada aguardando input do lead ou resposta de delay (time_or_response).
Suporta awaiting_type: awaiting_input | delay_response.
Sem side effects — apenas localiza, nunca modifica.
Prioridade: lead_id exato → fallback lead_id IS NULL.
Substitui find_paused_awaiting_input_execution para novos callers; v1 preservada.';
