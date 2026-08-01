-- =====================================================
-- MIGRATION: Idempotência de entrega para follow-up schedules
-- Data: 2026-08-01
--
-- Problema que resolve:
--   Se sendBlocks conclui com sucesso mas finalize_followup_schedule falha
--   (rede, timeout da Vercel Function), o schedule permanece em processing.
--   Após 10 min, recover_stale_agent_schedules devolve para pending.
--   Um novo worker faz claim e envia a mesma mensagem novamente.
--
-- Solução:
--   1. Transição atômica processing → sending ANTES de sendBlocks.
--   2. O stale recovery NÃO reverte automaticamente schedules em sending.
--      → Move para delivery_unknown (entrega incerta, sem reenvio automático).
--   3. send_idempotency_key (= runId do LLM) vincula o schedule à mensagem
--      persistida em chat_messages com o mesmo ai_run_id.
--      → Reconciliação: se chat_messages.status='sent' para esse ai_run_id,
--        a mensagem já foi entregue mesmo que finalize não tenha rodado.
--
-- Machine de estados resultante:
--   pending → processing → sending → sent
--                       ↘ delivery_unknown (stale após 15 min em sending)
--   processing → pending (retry técnico, stale após 10 min)
--   processing → cancelled / failed
--   sending → cancelled (ai_state mudou após begin_send, antes de enviar)
--   sending → technical_failure → pending (erro confirmado de rede, 4xx, 5xx)
--
-- Novo estado delivery_unknown:
--   - NÃO é auto-reprocessado.
--   - Exige reconciliação manual ou automática via send_idempotency_key.
--   - Consulta de reconciliação:
--       SELECT * FROM chat_messages
--       WHERE ai_run_id = agent_contact_schedules.send_idempotency_key
--         AND status = 'sent';
--     Se encontrado: mensagem foi entregue → pode marcar como sent manualmente.
--     Se não encontrado: entrega incerta → investigação necessária.
--
-- Arquivos que precisam ser atualizados junto:
--   - api/cron/process-agent-schedules.js (chama begin_send_schedule)
--   - api/lib/agents/whatsappGateway.js (retorna messageIds)
-- =====================================================

-- ─── 1. Novas colunas em agent_contact_schedules ───────────────────────────
ALTER TABLE public.agent_contact_schedules
  ADD COLUMN IF NOT EXISTS send_idempotency_key UUID NULL,
  ADD COLUMN IF NOT EXISTS send_started_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS send_confirmed_at    TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS gateway_message_ids  TEXT[] NULL;

COMMENT ON COLUMN public.agent_contact_schedules.send_idempotency_key IS
  'Chave estável por tentativa comercial. Igual ao run_id do LLM.
   Usada como ai_run_id no gateway — vincula schedule a chat_messages.
   Permanece estável entre retries técnicos. Muda a cada nova tentativa comercial.
   Permite reconciliação: SELECT * FROM chat_messages WHERE ai_run_id = send_idempotency_key.';

COMMENT ON COLUMN public.agent_contact_schedules.send_started_at IS
  'Timestamp de início do envio (status=sending). NULL antes de begin_send_schedule.';

COMMENT ON COLUMN public.agent_contact_schedules.send_confirmed_at IS
  'Timestamp de confirmação pelo Uazapi (status=sent). NULL enquanto não confirmado.';

COMMENT ON COLUMN public.agent_contact_schedules.gateway_message_ids IS
  'IDs de mensagem retornados pelo Uazapi por bloco enviado. '
  'Armazenados para reconciliação futura. NULL até o envio ser confirmado.';

-- ─── 2. Atualizar CHECK constraint de status ────────────────────────────────
-- Adiciona: 'sending' (envio em andamento) e 'delivery_unknown' (entrega incerta)
ALTER TABLE public.agent_contact_schedules
  DROP CONSTRAINT IF EXISTS agent_contact_schedules_status_check;

ALTER TABLE public.agent_contact_schedules
  ADD CONSTRAINT agent_contact_schedules_status_check
  CHECK (status IN (
    'pending',
    'processing',
    'sending',
    'sent',
    'failed',
    'cancelled',
    'delivery_unknown'
  ));

-- ─── 3. begin_send_schedule ─────────────────────────────────────────────────
-- Transição atômica processing → sending antes de chamar sendBlocks.
-- Persiste send_idempotency_key e send_started_at.
-- Mantém processing_token (ownership não muda entre processing e sending).
--
-- Se a Vercel Function morrer durante sendBlocks (timeout):
--   schedule permanece em 'sending'.
--   recover_stale_agent_schedules move para 'delivery_unknown' (não para pending).
--
-- Se sendBlocks retorna erro confirmado (4xx, 5xx, rede):
--   processo ainda vivo → chama finalize(technical_failure) de status='sending'.
--   finalize aceita 'sending' além de 'processing'.

CREATE OR REPLACE FUNCTION public.begin_send_schedule(
  p_schedule_id          UUID,
  p_company_id           UUID,
  p_processing_token     UUID,
  p_send_idempotency_key UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule public.agent_contact_schedules%ROWTYPE;
BEGIN
  -- Lock explícito + validação de ownership
  SELECT *
  INTO v_schedule
  FROM public.agent_contact_schedules
  WHERE id               = p_schedule_id
    AND company_id       = p_company_id
    AND status           = 'processing'
    AND processing_token = p_processing_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'schedule_not_found_or_not_processing'
    );
  END IF;

  UPDATE public.agent_contact_schedules
  SET
    status               = 'sending',
    send_idempotency_key = p_send_idempotency_key,
    send_started_at      = now(),
    updated_at           = now()
  WHERE id = p_schedule_id;

  RETURN jsonb_build_object('success', true, 'status', 'sending');

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.begin_send_schedule(UUID, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_send_schedule(UUID, UUID, UUID, UUID) FROM anon, authenticated;

COMMENT ON FUNCTION public.begin_send_schedule IS
  'Transição atômica: processing → sending. '
  'Persiste send_idempotency_key antes do envio. '
  'Mantém processing_token (ownership não muda). '
  'Se Vercel Function morrer durante sendBlocks: schedule fica em sending → delivery_unknown. '
  'Uso exclusivo do backend (service_role).';

-- ─── 4. Atualizar finalize_followup_schedule ────────────────────────────────
-- Mudanças:
--   a) Aceita status IN ('processing', 'sending') — não apenas 'processing'.
--      Cancelamentos e falhas técnicas confirmadas podem vir de 'sending'.
--   b) Para sucesso: persiste send_confirmed_at e gateway_message_ids.
--   c) Novo parâmetro opcional p_gateway_message_ids TEXT[].
--
-- DROP necessário: assinatura muda de 9 para 10 parâmetros.
-- Nenhum outro código chama esta função além de process-agent-schedules.js.

DROP FUNCTION IF EXISTS public.finalize_followup_schedule(
  UUID, UUID, UUID, TEXT, TEXT, INTEGER, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.finalize_followup_schedule(
  p_schedule_id          UUID,
  p_company_id           UUID,
  p_processing_token     UUID,
  p_outcome              TEXT,           -- 'success' | 'technical_failure' | 'cancel'
  p_cancel_reason        TEXT        DEFAULT NULL,
  p_new_attempt_number   INTEGER     DEFAULT NULL,
  p_create_next          BOOLEAN     DEFAULT false,
  p_next_scheduled_at    TIMESTAMPTZ DEFAULT NULL,
  p_last_inbound_now     TIMESTAMPTZ DEFAULT NULL,
  p_gateway_message_ids  TEXT[]      DEFAULT NULL   -- IDs Uazapi por bloco (reconciliação)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule public.agent_contact_schedules%ROWTYPE;
  v_next_id  UUID;
BEGIN
  -- Lock explícito + validação de ownership.
  -- Aceita 'processing' (cancelamentos/falhas antes do envio) e
  -- 'sending' (resultado de sendBlocks: sucesso, falha confirmada, ai_state_changed).
  SELECT *
  INTO v_schedule
  FROM public.agent_contact_schedules
  WHERE id               = p_schedule_id
    AND company_id       = p_company_id
    AND status           IN ('processing', 'sending')
    AND processing_token = p_processing_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'schedule_not_found_or_not_processable'
    );
  END IF;

  -- CASO 1: Sucesso — envio confirmado pelo gateway
  IF p_outcome = 'success' THEN
    -- UPDATE antes de INSERT: se INSERT falhar (dedup), EXCEPTION reverte ambos.
    UPDATE public.agent_contact_schedules
    SET
      status               = 'sent',
      attempt_number       = COALESCE(p_new_attempt_number, attempt_number + 1),
      last_attempt_at      = now(),
      send_confirmed_at    = now(),
      gateway_message_ids  = COALESCE(p_gateway_message_ids, gateway_message_ids),
      next_attempt_at      = CASE WHEN p_create_next THEN p_next_scheduled_at ELSE NULL END,
      cancel_reason        = NULL,
      processing_token     = NULL,
      updated_at           = now()
    WHERE id = p_schedule_id;

    IF p_create_next AND p_next_scheduled_at IS NOT NULL THEN
      INSERT INTO public.agent_contact_schedules (
        company_id, lead_id, conversation_id, agent_id, assignment_id,
        reason, scheduled_at, attempt_number, max_attempts, interval_hours,
        status, processing_token, last_inbound_snapshot, message_hint,
        retry_count, created_at, updated_at
      ) VALUES (
        v_schedule.company_id, v_schedule.lead_id, v_schedule.conversation_id,
        v_schedule.agent_id, v_schedule.assignment_id,
        v_schedule.reason, p_next_scheduled_at,
        COALESCE(p_new_attempt_number, v_schedule.attempt_number + 1),
        v_schedule.max_attempts, v_schedule.interval_hours,
        'pending', NULL,
        COALESCE(p_last_inbound_now, now()),
        v_schedule.message_hint, 0, now(), now()
      )
      RETURNING id INTO v_next_id;
    END IF;

    RETURN jsonb_build_object(
      'success',          true,
      'status',           'sent',
      'schedule_id',      p_schedule_id,
      'next_schedule_id', v_next_id,
      'attempt_number',   COALESCE(p_new_attempt_number, v_schedule.attempt_number + 1)
    );

  -- CASO 2: Falha técnica confirmada (erro de rede, 4xx, 5xx retornado pelo Uazapi)
  -- Só chamar com 'technical_failure' quando temos CERTEZA de que o gateway não enviou.
  -- Se o processo morre sem certeza: deixar stale recovery agir → delivery_unknown.
  ELSIF p_outcome = 'technical_failure' THEN
    IF v_schedule.retry_count + 1 >= 5 THEN
      UPDATE public.agent_contact_schedules
      SET
        status           = 'failed',
        retry_count      = retry_count + 1,
        processing_token = NULL,
        cancel_reason    = COALESCE(p_cancel_reason, 'max_retries_reached'),
        updated_at       = now()
      WHERE id = p_schedule_id;

      RETURN jsonb_build_object(
        'success', false,
        'status',  'failed',
        'reason',  COALESCE(p_cancel_reason, 'max_retries_reached')
      );
    ELSE
      UPDATE public.agent_contact_schedules
      SET
        status           = 'pending',
        retry_count      = retry_count + 1,
        processing_token = NULL,
        cancel_reason    = NULL,
        scheduled_at     = now() + LEAST(
                             POWER(2, retry_count + 1)::INTEGER * INTERVAL '1 minute',
                             INTERVAL '60 minutes'
                           ),
        updated_at       = now()
      WHERE id = p_schedule_id;

      RETURN jsonb_build_object(
        'success',     false,
        'status',      'pending',
        'reason',      'retry_scheduled',
        'retry_count', v_schedule.retry_count + 1
      );
    END IF;

  -- CASO 3: Cancelamento — sem consumir tentativa comercial
  ELSIF p_outcome = 'cancel' THEN
    UPDATE public.agent_contact_schedules
    SET
      status           = 'cancelled',
      processing_token = NULL,
      cancel_reason    = COALESCE(p_cancel_reason, 'cancelled'),
      updated_at       = now()
    WHERE id = p_schedule_id;

    RETURN jsonb_build_object(
      'success', true,
      'status',  'cancelled',
      'reason',  COALESCE(p_cancel_reason, 'cancelled')
    );

  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error',   'invalid_outcome: expected success|technical_failure|cancel'
    );
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_followup_schedule(UUID, UUID, UUID, TEXT, TEXT, INTEGER, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_followup_schedule(UUID, UUID, UUID, TEXT, TEXT, INTEGER, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[]) FROM anon, authenticated;

COMMENT ON FUNCTION public.finalize_followup_schedule IS
  'Finaliza atomicamente um schedule de follow-up com validação de ownership via processing_token. '
  'Aceita status processing (cancelamentos, falhas antes do envio) e '
  'sending (resultado após begin_send_schedule). '
  'p_processing_token obrigatório: se não corresponder, retorna schedule_not_found_or_not_processable. '
  'FOR UPDATE: previne finalização dupla concorrente. '
  'processing_token = NULL após qualquer finalização. '
  'Para success: persiste send_confirmed_at e gateway_message_ids. '
  'Para technical_failure: APENAS quando certeza de não envio (erro confirmado). '
  '  Se incerteza de envio: deixar stale recovery mover para delivery_unknown. '
  'Uso exclusivo do backend (service_role).';

-- ─── 5. Atualizar recover_stale_agent_schedules ─────────────────────────────
-- Mudanças:
--   - Status 'sending' stale → 'delivery_unknown' (NÃO para pending).
--     Timeout: 15 min (maior que processing, entrega pode ter ocorrido).
--   - Status 'processing' stale → pending ou failed (comportamento anterior).
--
-- Assinatura mantida (INTEGER, INTEGER) → CREATE OR REPLACE sem DROP.

CREATE OR REPLACE FUNCTION public.recover_stale_agent_schedules(
  p_stale_minutes INTEGER DEFAULT 10,
  p_max_retry     INTEGER DEFAULT 5
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processing_cutoff TIMESTAMPTZ;
  v_sending_cutoff    TIMESTAMPTZ;
  v_recovered         INTEGER := 0;
  v_failed_count      INTEGER := 0;
  v_unknown_count     INTEGER := 0;
BEGIN
  v_processing_cutoff := now() - (COALESCE(p_stale_minutes, 10) * INTERVAL '1 minute');
  -- 15 minutos para sending: mais conservador pois não podemos saber se a mensagem chegou.
  -- Deve ser maior que o timeout máximo da Vercel Function (Pro: 300s = 5 min).
  v_sending_cutoff    := now() - INTERVAL '15 minutes';

  -- processing stale → pending com backoff (entrega não iniciada, retry seguro)
  UPDATE public.agent_contact_schedules
  SET
    status           = 'pending',
    retry_count      = retry_count + 1,
    processing_token = NULL,
    cancel_reason    = NULL,
    scheduled_at     = now() + LEAST(
                         POWER(2, retry_count + 1)::INTEGER * INTERVAL '1 minute',
                         INTERVAL '60 minutes'
                       ),
    updated_at       = now()
  WHERE status       = 'processing'
    AND processed_at < v_processing_cutoff
    AND retry_count  < COALESCE(p_max_retry, 5);

  GET DIAGNOSTICS v_recovered = ROW_COUNT;

  -- processing stale → failed (sem retries)
  UPDATE public.agent_contact_schedules
  SET
    status           = 'failed',
    retry_count      = retry_count + 1,
    processing_token = NULL,
    cancel_reason    = 'stale_processing_timeout',
    updated_at       = now()
  WHERE status       = 'processing'
    AND processed_at < v_processing_cutoff
    AND retry_count  >= COALESCE(p_max_retry, 5);

  GET DIAGNOSTICS v_failed_count = ROW_COUNT;

  -- sending stale → delivery_unknown (entrega incerta — NÃO para pending)
  -- processing_token = NULL: invalida worker tardio que tente finalizar.
  -- Não incrementa retry_count nem attempt_number (não é retry técnico nem comercial).
  -- Reconciliar via: SELECT * FROM chat_messages WHERE ai_run_id = send_idempotency_key.
  UPDATE public.agent_contact_schedules
  SET
    status           = 'delivery_unknown',
    processing_token = NULL,
    cancel_reason    = 'send_not_confirmed_before_timeout',
    updated_at       = now()
  WHERE status          = 'sending'
    AND send_started_at < v_sending_cutoff;

  GET DIAGNOSTICS v_unknown_count = ROW_COUNT;

  RETURN v_recovered + v_failed_count + v_unknown_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_stale_agent_schedules(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_stale_agent_schedules(INTEGER, INTEGER) FROM anon, authenticated;

COMMENT ON FUNCTION public.recover_stale_agent_schedules IS
  'Recupera schedules presos por timeout. '
  'processing stale (>10 min default): pending (retry) ou failed (sem retries). '
  'sending stale (>15 min fixo): delivery_unknown — NÃO para pending. '
  '  Entrega pode ter ocorrido; não reenviar automaticamente. '
  '  Reconciliar: SELECT FROM chat_messages WHERE ai_run_id = send_idempotency_key. '
  'Limpa processing_token em todos os casos. '
  'Uso exclusivo do backend (service_role).';
