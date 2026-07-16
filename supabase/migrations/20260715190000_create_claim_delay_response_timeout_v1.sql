-- =====================================================
-- MIGRATION: CREATE claim_delay_response_timeout_v1
-- Data: 15/07/2026
--
-- Objetivo:
--   RPC atômica que elimina a janela irrecuperável existente entre:
--     1. claim_paused_execution_v1       (atualiza execution)
--     2. persistPostClaimState           (UPDATE manual no schedule — JS)
--
--   Uma queda da Vercel Function entre essas duas operações deixava:
--     execution.status = running
--     marcador removido
--     schedule sem post_claim
--
--   Na reentrada, Claim RPC retornava claimed=false (execution ≠ paused),
--   o schedule era marcado como 'processed' e a execução ficava
--   permanentemente sem continuação — estado irrecuperável.
--
--   Esta RPC executa os dois UPDATEs na mesma transação, garantindo que
--   após o commit o estado seja sempre:
--     execution = running, marcador removido
--     schedule (processing) com trigger_data.post_claim presente
--
-- Relação com claim_paused_execution_v1:
--   Não substitui claim_paused_execution_v1 — esta permanece para o webhook.
--   claim_delay_response_timeout_v1 é específica para o cron de timeout,
--   com tipos fixos (awaiting_type=delay_response, resume_reason=timeout,
--   entity_type=delay_response_timeout) e lock bidirecional (schedule + execution).
--
-- Ordem de locks (documentada para consistência e evitar deadlocks):
--   1. automation_schedules (schedule)
--   2. automation_executions (execution)
--   Toda chamada desta RPC DEVE usar esta ordem.
--
-- NOTA SOBRE AUTORIZAÇÃO:
--   company_id é escopo de dados (defesa em profundidade),
--   NÃO é prova de autorização.
--   Autenticação, validação de empresa e permissões são
--   responsabilidade exclusiva do backend antes de chamar a RPC.
-- =====================================================

CREATE OR REPLACE FUNCTION public.claim_delay_response_timeout_v1(
  p_company_id     uuid,
  p_schedule_id    uuid,
  p_execution_id   uuid,
  p_paused_node_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule    RECORD;
  v_execution   RECORD;
  v_marker      jsonb;
  v_claimed_at  timestamptz;
  v_post_claim  jsonb;
  v_new_trigger jsonb;
  v_new_vars    jsonb;
  v_affected    integer;
BEGIN
  -- -------------------------------------------------------------------------
  -- Passo 1: bloquear schedule (primeira linha do lock bidirecional).
  -- FOR UPDATE garante que dois workers concorrentes sejam serializados.
  -- O segundo aguardará aqui e, ao continuar, encontrará status alterado
  -- ou post_claim já presente → retornará claimed=false.
  -- -------------------------------------------------------------------------
  SELECT
    sch.id,
    sch.company_id,
    sch.entity_type,
    sch.entity_id,
    sch.status,
    sch.execution_id,
    sch.trigger_data
  INTO v_schedule
  FROM public.automation_schedules sch
  WHERE sch.id         = p_schedule_id
    AND sch.company_id = p_company_id
  FOR UPDATE;

  IF v_schedule.id IS NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'schedule_not_found'
    );
  END IF;

  -- -------------------------------------------------------------------------
  -- Validações do schedule (após lock — estado garantido neste ponto)
  -- -------------------------------------------------------------------------

  -- Tipo fixo: somente delay_response_timeout é válido para esta RPC
  IF v_schedule.entity_type IS DISTINCT FROM 'delay_response_timeout' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'invalid_entity_type',
      'detail',  v_schedule.entity_type
    );
  END IF;

  -- Schedule deve estar em 'processing' (já capturado pelo cron)
  IF v_schedule.status IS DISTINCT FROM 'processing' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'schedule_not_processing',
      'detail',  v_schedule.status
    );
  END IF;

  -- execution_id do schedule deve corresponder ao parâmetro
  IF v_schedule.execution_id IS DISTINCT FROM p_execution_id THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'execution_id_mismatch'
    );
  END IF;

  -- entity_id do schedule (node_id) deve corresponder ao parâmetro
  -- Validação via dado do banco (lock) — não apenas do parâmetro do caller
  IF v_schedule.entity_id IS DISTINCT FROM p_paused_node_id THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'schedule_entity_id_mismatch'
    );
  END IF;

  -- Verificar se post_claim já existe (idempotência: segundo worker após commit)
  IF (v_schedule.trigger_data -> 'post_claim') IS NOT NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'already_claimed_or_stale'
    );
  END IF;

  -- -------------------------------------------------------------------------
  -- Passo 2: bloquear execution (segunda linha do lock bidirecional).
  -- -------------------------------------------------------------------------
  SELECT
    ae.id,
    ae.flow_id,
    ae.company_id,
    ae.lead_id,
    ae.opportunity_id,
    ae.status,
    ae.variables,
    ae.trigger_data
  INTO v_execution
  FROM public.automation_executions ae
  WHERE ae.id         = p_execution_id
    AND ae.company_id = p_company_id
  FOR UPDATE;

  IF v_execution.id IS NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'execution_not_found'
    );
  END IF;

  -- -------------------------------------------------------------------------
  -- Validações da execução (após lock)
  -- -------------------------------------------------------------------------

  IF v_execution.status IS DISTINCT FROM 'paused' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'execution_not_paused',
      'detail',  v_execution.status
    );
  END IF;

  -- Presença do marcador _awaiting_delay_response
  IF NOT (v_execution.variables ? '_awaiting_delay_response') THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'marker_not_found'
    );
  END IF;

  v_marker := v_execution.variables -> '_awaiting_delay_response';

  -- marker.node_id deve corresponder a schedule.entity_id (validado via banco)
  -- Previne claim por schedule de pausa diferente no mesmo nó
  IF (v_marker ->> 'node_id') IS DISTINCT FROM v_schedule.entity_id THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'marker_node_id_mismatch'
    );
  END IF;

  -- marker.schedule_id deve corresponder a p_schedule_id
  -- Previne que schedule antigo retome pausa nova no mesmo nó
  IF (v_marker ->> 'schedule_id') IS DISTINCT FROM p_schedule_id::text THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'marker_schedule_id_mismatch'
    );
  END IF;

  -- -------------------------------------------------------------------------
  -- Claim atômico — ambos os UPDATEs na mesma transação.
  -- Nenhum estado intermediário fica visível após commit.
  -- -------------------------------------------------------------------------

  v_claimed_at := NOW();
  v_new_vars   := v_execution.variables - '_awaiting_delay_response';

  -- UPDATE 1: execução paused → running, marcador removido, campos de pausa limpos
  UPDATE public.automation_executions
  SET
    status          = 'running',
    paused_at       = NULL,
    resume_at       = NULL,
    timeout_at      = NULL,
    current_node_id = NULL,
    variables       = v_new_vars
  WHERE id = p_execution_id;

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  IF v_affected = 0 THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'execution_update_failed'
    );
  END IF;

  -- UPDATE 2: persistir post_claim no schedule via merge JSONB seguro.
  --
  -- COALESCE garante que trigger_data IS NULL seja tratado como '{}'::jsonb.
  -- || (jsonb merge) preserva campos existentes (delay_config, etc.)
  -- e substitui apenas 'post_claim'.
  --
  -- Dados NÃO persistidos: variables, marker completo, dados pessoais,
  -- resposta do lead, tokens, stack traces.
  v_post_claim := jsonb_build_object(
    'paused_node_id',   p_paused_node_id,
    'resume_reason',    'timeout',
    'awaiting_type',    'delay_response',
    'claimed_at',       v_claimed_at,
    'lock_retry_count', 0
  );

  v_new_trigger := COALESCE(v_schedule.trigger_data, '{}'::jsonb)
                || jsonb_build_object('post_claim', v_post_claim);

  UPDATE public.automation_schedules
  SET trigger_data = v_new_trigger
  WHERE id = p_schedule_id;

  -- -------------------------------------------------------------------------
  -- Retorno de sucesso
  -- Inclui execução pós-claim, marcador original, claimed_at e post_claim
  -- para uso direto pelo Node.js sem nova consulta ao banco.
  -- -------------------------------------------------------------------------
  RETURN jsonb_build_object(
    'claimed',    true,
    'claimed_at', v_claimed_at,
    'execution',  jsonb_build_object(
      'id',             v_execution.id,
      'flow_id',        v_execution.flow_id,
      'company_id',     v_execution.company_id,
      'lead_id',        v_execution.lead_id,
      'opportunity_id', v_execution.opportunity_id,
      'trigger_data',   v_execution.trigger_data,
      'variables',      v_new_vars
    ),
    'marker',     v_marker,
    'post_claim', v_post_claim
  );

  -- Sem EXCEPTION WHEN OTHERS.
  -- Erros inesperados (deadlock, constraint, schema) propagam como erro da RPC.
  -- O Node.js registra o erro e aplica política de retry (failed).
END;
$$;

-- ---------------------------------------------------------------------------
-- Permissões — somente service_role pode executar
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.claim_delay_response_timeout_v1(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_delay_response_timeout_v1(uuid, uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.claim_delay_response_timeout_v1(uuid, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_delay_response_timeout_v1(uuid, uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.claim_delay_response_timeout_v1(uuid, uuid, uuid, text) IS
'RPC atômica específica para claim de timeout de delay_response_timeout.
Combina em uma única transação:
  1. Claim da execução (paused → running, remoção do marcador)
  2. Persistência de post_claim em automation_schedules.trigger_data
Elimina a janela irrecuperável entre claim_paused_execution_v1 e persistPostClaimState.
Ordem de locks: schedule → execution (consistente, sem deadlock).
Validações: company_id, entity_type, schedule.status=processing, marker, node_id, schedule_id.
Tipos fixos: awaiting_type=delay_response, resume_reason=timeout.
claimed=false: corrida perdida, stale, pós-claim detectado, validações falhadas.
Erros inesperados: propagados — nunca mascarados como claimed=false.
NÃO executa lógica de negócio, não marca processed/failed, não chama executor.
Executável somente por service_role. Autenticação e autorização são responsabilidade do backend.';
