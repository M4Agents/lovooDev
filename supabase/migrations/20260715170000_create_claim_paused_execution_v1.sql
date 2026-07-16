-- =====================================================
-- MIGRATION: claim_paused_execution_v1
-- Data: 15/07/2026
-- Objetivo: Claim atômico de execução pausada.
--
-- Responsabilidade ÚNICA:
--   Decidir quem venceu a corrida (lead vs. cron).
--   Validar condições. Transicionar status. Retornar marcador.
--
-- A RPC NÃO executa lógica de negócio:
--   - não cancela schedule
--   - não salva response_variable
--   - não decide handles
--   - não executa automação
--
-- Toda lógica pós-claim é responsabilidade do Node.js.
--
-- MECANISMO DE ATOMICIDADE:
--   SELECT FOR UPDATE serializa concorrentes no mesmo execution_id.
--   O segundo processo aguarda o primeiro completar e então:
--     - encontra status = 'running'  → retorna claimed: false
--     - sem corrida após serialização
-- =====================================================

CREATE OR REPLACE FUNCTION public.claim_paused_execution_v1(
  p_company_id     uuid,
  p_execution_id   uuid,
  p_paused_node_id text,
  p_awaiting_type  text,
  p_resume_reason  text,
  p_schedule_id    uuid DEFAULT NULL
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
  v_affected    integer;
BEGIN
  -- -------------------------------------------------------
  -- Validar awaiting_type e mapear para chave do marcador
  -- -------------------------------------------------------
  IF p_awaiting_type = 'awaiting_input' THEN
    v_marker_key := '_awaiting_input';
  ELSIF p_awaiting_type = 'delay_response' THEN
    v_marker_key := '_awaiting_delay_response';
  ELSE
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'invalid_awaiting_type: ' || COALESCE(p_awaiting_type, 'null')
    );
  END IF;

  -- -------------------------------------------------------
  -- Validar resume_reason
  -- -------------------------------------------------------
  IF p_resume_reason IS NULL OR p_resume_reason NOT IN ('lead_response', 'timeout') THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'invalid_resume_reason: ' || COALESCE(p_resume_reason, 'null')
    );
  END IF;

  -- -------------------------------------------------------
  -- SELECT FOR UPDATE: adquire lock exclusivo da linha.
  -- Serializa dois processos concorrentes tentando reivindicar
  -- a mesma execução. O segundo aguarda aqui e, ao continuar,
  -- encontrará status != 'paused' → retornará claimed: false.
  -- -------------------------------------------------------
  SELECT
    ae.id,
    ae.flow_id,
    ae.company_id,
    ae.lead_id,
    ae.status,
    ae.variables,
    ae.trigger_data,
    ae.opportunity_id
  INTO v_execution
  FROM automation_executions ae
  WHERE ae.id         = p_execution_id
    AND ae.company_id = p_company_id
  FOR UPDATE;

  -- Execução não encontrada para este company_id
  IF v_execution.id IS NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'already_resumed_or_stale'
    );
  END IF;

  -- Validar status = 'paused'
  IF v_execution.status <> 'paused' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'already_resumed_or_stale'
    );
  END IF;

  -- Validar presença do marcador em variables
  IF NOT (v_execution.variables ? v_marker_key) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'already_resumed_or_stale'
    );
  END IF;

  v_marker := v_execution.variables -> v_marker_key;

  -- Validar node_id do marcador corresponde ao nó pausado
  IF v_marker ->>'node_id' IS DISTINCT FROM p_paused_node_id THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'already_resumed_or_stale'
    );
  END IF;

  -- Quando timeout: validar que o schedule_id corresponde ao marcador.
  -- Previne que um schedule antigo retome uma pausa nova no mesmo nó.
  IF p_resume_reason = 'timeout' THEN
    IF p_schedule_id IS NULL THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'reason',  'already_resumed_or_stale'
      );
    END IF;
    IF v_marker ->>'schedule_id' IS DISTINCT FROM p_schedule_id::text THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'reason',  'already_resumed_or_stale'
      );
    END IF;
  END IF;

  -- -------------------------------------------------------
  -- Claim atômico: transicionar status e remover marcador.
  -- Limpa exatamente os mesmos campos que resumeFromNode faz
  -- no executor.js (linhas 531-544).
  -- -------------------------------------------------------
  UPDATE automation_executions
  SET
    status          = 'running',
    paused_at       = NULL,
    resume_at       = NULL,
    timeout_at      = NULL,
    current_node_id = NULL,
    variables       = variables - v_marker_key
  WHERE id = p_execution_id;

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  -- Safety net: SELECT FOR UPDATE garantiu o lock, mas verificamos
  -- a contagem por segurança defensiva.
  IF v_affected = 0 THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'already_resumed_or_stale'
    );
  END IF;

  -- -------------------------------------------------------
  -- Retorno — claimed = true
  --
  -- execution.variables: pós-remoção do marcador (estado atual do banco)
  -- marker: conteúdo original do marcador, para uso pelo Node.js:
  --   - schedule_id  → para cancelar schedule (lead_response)
  --   - response_variable → para salvar resposta do lead
  --   - node_id      → para logging e auditoria
  -- claimed_at: gerado no banco, apenas para logging (não persistido)
  -- -------------------------------------------------------
  RETURN jsonb_build_object(
    'claimed',      true,
    'claimed_at',   NOW(),
    'execution_id', v_execution.id,
    'company_id',   v_execution.company_id,
    'execution', jsonb_build_object(
      'id',             v_execution.id,
      'flow_id',        v_execution.flow_id,
      'company_id',     v_execution.company_id,
      'lead_id',        v_execution.lead_id,
      'opportunity_id', v_execution.opportunity_id,
      'trigger_data',   v_execution.trigger_data,
      -- variables sem o marcador — estado consistente pós-claim
      'variables',      v_execution.variables - v_marker_key
    ),
    'marker', v_marker
  );

EXCEPTION WHEN OTHERS THEN
  -- Nunca propagar exceção — retornar claimed: false com diagnóstico
  -- para que o Node.js possa logar e não silenciar o erro
  RETURN jsonb_build_object(
    'claimed', false,
    'reason',  'exception: ' || SQLERRM
  );
END;
$$;

-- =====================================================
-- REVOKE de PUBLIC antes dos GRANTs explícitos
-- Garante que apenas os roles listados possam executar
-- =====================================================
REVOKE EXECUTE ON FUNCTION public.claim_paused_execution_v1(uuid, uuid, text, text, text, uuid) FROM PUBLIC;

-- =====================================================
-- GRANTS
-- anon:         webhook usa client anon para chamar esta RPC
-- service_role: process-schedules usa getSupabaseAdmin()
-- =====================================================
GRANT EXECUTE ON FUNCTION public.claim_paused_execution_v1(uuid, uuid, text, text, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.claim_paused_execution_v1(uuid, uuid, text, text, text, uuid) TO service_role;

-- =====================================================
-- COMENTÁRIO
-- =====================================================
COMMENT ON FUNCTION public.claim_paused_execution_v1(uuid, uuid, text, text, text, uuid) IS
'Claim atômico de execução pausada. Decide quem venceu a corrida (lead vs. cron).
Valida: company_id, status=paused, marcador, node_id, schedule_id (quando timeout).
Transiciona: paused → running, remove marcador, limpa campos de pausa.
Retorna: claimed=true + marker + execution (pós-remoção) OU claimed=false.
NÃO executa lógica de negócio da automação.
SELECT FOR UPDATE serializa concorrentes no mesmo execution_id.';
