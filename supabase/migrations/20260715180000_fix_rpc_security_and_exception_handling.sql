-- =====================================================
-- MIGRATION CORRETIVA: fix_rpc_security_and_exception_handling
-- Data: 15/07/2026
--
-- Corrige as duas RPCs criadas nesta etapa de desenvolvimento:
--   - find_paused_awaiting_execution_v2
--   - claim_paused_execution_v1
--
-- Problemas corrigidos:
--   1. PERMISSÕES: anon e authenticated tinham EXECUTE em funções
--      SECURITY DEFINER — risco de contorno de RLS.
--      Corrigido: REVOKE de PUBLIC/anon/authenticated,
--      GRANT EXECUTE exclusivo para service_role.
--
--   2. EXCEPTION WHEN OTHERS (claim): mascarava erros inesperados
--      de banco como claimed=false, impedindo logging e retry.
--      Corrigido: bloco removido — erros propagam como erro da RPC.
--
--   3. EXCEPTION WHEN OTHERS (find): mascarava erros inesperados
--      como found=false, impedindo diagnóstico correto.
--      Corrigido: bloco removido — erros propagam como erro da RPC.
--
--   4. REFERÊNCIAS QUALIFICADAS: tabelas sem prefixo public. poderiam
--      ser resolvidas por schema controlável em configurações distintas.
--      Corrigido: todas as referências usam public.automation_executions.
--
-- NOTA SOBRE AUTORIZAÇÃO:
--   company_id é escopo de dados (defesa em profundidade),
--   NÃO é prova de autorização.
--   Autenticação, validação de empresa e permissões são
--   responsabilidade exclusiva do backend antes de chamar as RPCs.
-- =====================================================


-- =====================================================
-- FUNÇÃO 1: find_paused_awaiting_execution_v2
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
    FROM public.automation_executions ae
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
    FROM public.automation_executions ae
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
    'awaiting_node_id', v_marker ->>'node_id',
    'schedule_id',    v_marker ->>'schedule_id',
    'paused_at',      v_execution.paused_at
  );

  -- Sem EXCEPTION WHEN OTHERS: erros inesperados propagam como
  -- erro da RPC para logging e observabilidade no backend.
END;
$$;

REVOKE ALL ON FUNCTION public.find_paused_awaiting_execution_v2(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_paused_awaiting_execution_v2(uuid, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.find_paused_awaiting_execution_v2(uuid, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_paused_awaiting_execution_v2(uuid, integer, text) TO service_role;

COMMENT ON FUNCTION public.find_paused_awaiting_execution_v2(uuid, integer, text) IS
'Localiza execução pausada aguardando input do lead ou resposta de delay (time_or_response).
Suporta awaiting_type: awaiting_input | delay_response.
Sem side effects — apenas localiza, nunca modifica.
Prioridade: lead_id exato → fallback lead_id IS NULL.
Substitui find_paused_awaiting_input_execution para novos callers; v1 preservada.
Executável somente por service_role. Autenticação e autorização são responsabilidade do backend.';


-- =====================================================
-- FUNÇÃO 2: claim_paused_execution_v1
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
  FROM public.automation_executions ae
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
  -- no executor.js.
  -- -------------------------------------------------------
  UPDATE public.automation_executions
  SET
    status          = 'running',
    paused_at       = NULL,
    resume_at       = NULL,
    timeout_at      = NULL,
    current_node_id = NULL,
    variables       = variables - v_marker_key
  WHERE id = p_execution_id;

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  IF v_affected = 0 THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'already_resumed_or_stale'
    );
  END IF;

  -- -------------------------------------------------------
  -- Retorno — claimed = true
  -- claimed_at: timestamp do banco, apenas para logging
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
      'variables',      v_execution.variables - v_marker_key
    ),
    'marker', v_marker
  );

  -- Sem EXCEPTION WHEN OTHERS.
  -- Erros inesperados de banco (schema, constraint, deadlock) são
  -- propagados como erro da RPC. Isso garante que:
  --   1. o Node.js possa registrar a falha corretamente;
  --   2. o cron aplique política de retry;
  --   3. problemas reais não sejam confundidos com perda de corrida.
END;
$$;

REVOKE ALL ON FUNCTION public.claim_paused_execution_v1(uuid, uuid, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_paused_execution_v1(uuid, uuid, text, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.claim_paused_execution_v1(uuid, uuid, text, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paused_execution_v1(uuid, uuid, text, text, text, uuid) TO service_role;

COMMENT ON FUNCTION public.claim_paused_execution_v1(uuid, uuid, text, text, text, uuid) IS
'Claim atômico de execução pausada. Decide quem venceu a corrida (lead vs. cron).
Valida: company_id, status=paused, marcador, node_id, schedule_id (quando timeout).
Transiciona: paused → running, remove marcador, limpa campos de pausa.
Retorna: claimed=true + marker + execution (pós-remoção) + claimed_at OU claimed=false.
claimed=false: situações operacionais esperadas (corrida perdida, stale).
Erros inesperados: propagados com RAISE — nunca mascarados como claimed=false.
NÃO executa lógica de negócio da automação.
SELECT FOR UPDATE serializa concorrentes no mesmo execution_id.
Executável somente por service_role. Autenticação e autorização são responsabilidade do backend.';
