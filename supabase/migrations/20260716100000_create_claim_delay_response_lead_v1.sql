-- =====================================================
-- MIGRATION: CREATE claim_delay_response_lead_v1
-- Data: 16/07/2026
--
-- Objetivo:
--   RPC atômica específica para claim de resposta do lead (lead_response)
--   no caminho delay_response do webhook.
--
--   Elimina a janela irrecuperável existente no webhook entre:
--     1. claim_paused_execution_v1  (execution paused → running)
--     2. cancelamento manual do schedule (pending → processed)
--
--   Uma queda do webhook entre essas duas operações deixava:
--     execution.status = running
--     marcador removido
--     schedule cancelado (processed) ou ainda pending
--     sem âncora de recovery para o cron
--
--   Esta RPC executa atomicamente em uma única transação:
--     a) execution: paused → running, marcador removido, campos de pausa limpos
--     b) response_variable salva em variables (quando configurada)
--     c) schedule: pending → processing, trigger_data.post_claim persistido
--
--   Após o commit, qualquer queda do webhook é recuperável pelo cron:
--     schedule em processing → releaseStuckSchedules (TTL 10min) → pending
--     → handlePostClaimReentry detecta post_claim.resume_reason=lead_response
--     → resume sem nova Claim RPC
--
-- Relação com outras RPCs:
--   claim_paused_execution_v1:        preservada, usada para awaiting_input
--   claim_delay_response_timeout_v1:  preservada, usada pelo cron de timeout
--   claim_delay_response_lead_v1:     específica para webhook de lead_response
--
-- Invariantes fixos (não recebidos como parâmetros):
--   awaiting_type = delay_response
--   resume_reason = lead_response
--   entity_type   = delay_response_timeout
--
-- Ordem de locks (documentada para consistência e evitar deadlocks):
--   1. public.automation_schedules  (schedule) via FOR UPDATE
--   2. public.automation_executions (execution) via FOR UPDATE
--   Idêntica à claim_delay_response_timeout_v1 — sem risco de deadlock cruzado.
--
-- NOTA SOBRE AUTORIZAÇÃO:
--   company_id é escopo de dados (defesa em profundidade),
--   NÃO é prova de autorização.
--   Autenticação, validação de empresa e permissões são
--   responsabilidade exclusiva do backend antes de chamar a RPC.
-- =====================================================

CREATE OR REPLACE FUNCTION public.claim_delay_response_lead_v1(
  p_company_id     uuid,
  p_schedule_id    uuid,
  p_execution_id   uuid,
  p_paused_node_id text,
  p_user_response  text DEFAULT NULL
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
  v_resp_var    text;
  v_affected    integer;
BEGIN
  -- -------------------------------------------------------------------------
  -- Passo 1: bloquear schedule (primeira linha do lock bidirecional).
  -- FOR UPDATE serializa dois processos concorrentes no mesmo schedule.
  -- Cron (pending→processing) e webhook (lead_response) chegando juntos:
  --   O segundo aguarda aqui e encontrará status alterado → claimed=false.
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
      'reason',  'already_claimed_or_stale'
    );
  END IF;

  -- -------------------------------------------------------------------------
  -- Validações do schedule (após lock — estado garantido neste ponto)
  -- -------------------------------------------------------------------------

  -- Tipo fixo: somente delay_response_timeout é válido para esta RPC
  IF v_schedule.entity_type IS DISTINCT FROM 'delay_response_timeout' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'already_claimed_or_stale'
    );
  END IF;

  -- Schedule precisa estar pending (webhook chega antes do cron)
  IF v_schedule.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'already_claimed_or_stale'
    );
  END IF;

  -- execution_id do schedule deve corresponder ao parâmetro
  IF v_schedule.execution_id IS DISTINCT FROM p_execution_id THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'already_claimed_or_stale'
    );
  END IF;

  -- entity_id (node_id) deve corresponder ao parâmetro
  IF v_schedule.entity_id IS DISTINCT FROM p_paused_node_id THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'already_claimed_or_stale'
    );
  END IF;

  -- Verificar se post_claim já existe (idempotência: segundo processo após commit)
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
      'reason',  'already_claimed_or_stale'
    );
  END IF;

  -- -------------------------------------------------------------------------
  -- Validações da execução (após lock)
  -- -------------------------------------------------------------------------

  IF v_execution.status IS DISTINCT FROM 'paused' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'already_claimed_or_stale'
    );
  END IF;

  -- Presença do marcador _awaiting_delay_response
  IF NOT (v_execution.variables ? '_awaiting_delay_response') THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'already_claimed_or_stale'
    );
  END IF;

  v_marker := v_execution.variables -> '_awaiting_delay_response';

  -- marker.node_id deve corresponder ao nó pausado
  IF (v_marker ->> 'node_id') IS DISTINCT FROM p_paused_node_id THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'already_claimed_or_stale'
    );
  END IF;

  -- marker.schedule_id deve corresponder ao schedule (previne schedule stale)
  IF (v_marker ->> 'schedule_id') IS DISTINCT FROM p_schedule_id::text THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason',  'already_claimed_or_stale'
    );
  END IF;

  -- -------------------------------------------------------------------------
  -- Preparar variables pós-claim
  -- -------------------------------------------------------------------------

  v_claimed_at := NOW();

  -- Remover marcador das variables
  v_new_vars := v_execution.variables - '_awaiting_delay_response';

  -- Salvar response_variable quando configurada (Opção A: atomicidade garantida).
  -- A existência desta RPC indica que o lead respondeu — salvar independente
  -- do conteúdo (inclusive null e string vazia são respostas válidas).
  -- Condição: response_variable existe E não é string vazia.
  v_resp_var := v_marker ->> 'response_variable';
  IF v_resp_var IS NOT NULL AND v_resp_var <> '' THEN
    v_new_vars := v_new_vars || jsonb_build_object(v_resp_var, p_user_response);
  END IF;

  -- -------------------------------------------------------------------------
  -- Claim atômico — UPDATE 1: execution
  -- Idêntico aos campos limpos por claim_paused_execution_v1 e executor.js
  -- -------------------------------------------------------------------------
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
      'reason',  'already_claimed_or_stale'
    );
  END IF;

  -- -------------------------------------------------------------------------
  -- Claim atômico — UPDATE 2: schedule
  --
  -- status = processing  → âncora de recovery via releaseStuckSchedules (TTL)
  -- executed_at = NOW()  → necessário para cálculo do TTL pelo cleanup
  -- trigger_data merge   → preserva campos existentes (delay_config, etc.)
  --
  -- NÃO persistido: resposta do lead, variables, marker completo,
  --                 conteúdo da mensagem, dados pessoais.
  -- -------------------------------------------------------------------------
  v_post_claim := jsonb_build_object(
    'paused_node_id',   p_paused_node_id,
    'resume_reason',    'lead_response',
    'awaiting_type',    'delay_response',
    'claimed_at',       v_claimed_at,
    'lock_retry_count', 0
  );

  v_new_trigger := COALESCE(v_schedule.trigger_data, '{}'::jsonb)
               || jsonb_build_object('post_claim', v_post_claim);

  UPDATE public.automation_schedules
  SET
    status       = 'processing',
    executed_at  = v_claimed_at,
    trigger_data = v_new_trigger
  WHERE id = p_schedule_id;

  -- -------------------------------------------------------------------------
  -- Retorno de sucesso
  -- execution reflete estado pós-claim: running, marker removido,
  -- response_variable já salva (quando configurada).
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
  -- O Node.js registra e aplica política de retry.
END;
$$;

-- ---------------------------------------------------------------------------
-- Permissões — somente service_role pode executar
-- Sem acesso de anon ou authenticated — esta RPC é SECURITY DEFINER e
-- deve ser chamada apenas pelo backend (service_role).
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.claim_delay_response_lead_v1(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_delay_response_lead_v1(uuid, uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.claim_delay_response_lead_v1(uuid, uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_delay_response_lead_v1(uuid, uuid, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.claim_delay_response_lead_v1(uuid, uuid, uuid, text, text) IS
'RPC atômica específica para claim de resposta do lead no bloco delay_response do webhook.
Combina em uma única transação:
  1. Claim da execução (paused → running, remoção do marcador, limpeza de campos)
  2. Salvamento atômico de response_variable em execution.variables (quando configurada)
  3. Schedule pending → processing com post_claim em trigger_data
Elimina a janela irrecuperável entre claim e cancelamento manual do schedule.
Após o commit, queda do webhook é recuperável:
  schedule processing → releaseStuckSchedules (TTL) → pending
  → cron detecta post_claim.resume_reason=lead_response → recovery automático
Invariantes fixos: awaiting_type=delay_response, resume_reason=lead_response, entity_type=delay_response_timeout.
Ordem de locks: schedule → execution (idêntica à timeout RPC — sem deadlock cruzado).
Validações: company_id, entity_type, status=pending, execution_id, node_id, marker, schedule_id.
claimed=false: corrida perdida, stale, pós-claim detectado, validações falhadas.
Erros inesperados: propagados — nunca mascarados como claimed=false.
NÃO executa lógica de negócio, não chama executor, não cancela outros schedules.
Executável somente por service_role. Autenticação e autorização são responsabilidade do backend.';
