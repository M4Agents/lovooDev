-- =====================================================
-- MIGRATION: RPC finalize_followup_schedule
-- Data: 2026-08-01
--
-- Propósito:
--   Finalização transacional de um schedule de follow-up.
--   Evita o risco de marcar como 'sent' mas falhar ao criar o próximo
--   (inconsistência entre dois UPDATEs separados no cron).
--
-- Casos cobertos:
--   Sucesso:
--     - Marca schedule atual como 'sent'
--     - Incrementa attempt_number
--     - Cria próximo schedule (se houver tentativas disponíveis)
--     - Usa novo snapshot (last_inbound_at atual) para o próximo
--
--   Falha técnica:
--     - Incrementa retry_count (não attempt_number)
--     - Se retry_count < 5: volta para 'pending' com backoff exponencial
--     - Se retry_count >= 5: marca como 'failed'
--
--   Cancelamento:
--     - Marca como 'cancelled' com motivo
--     - Não incrementa attempt_number nem retry_count
--
-- Garantias:
--   - Valida company_id (multi-tenant)
--   - Só altera schedule com status = 'processing' (evita update duplo)
--   - Toda operação em transação única
-- =====================================================

CREATE OR REPLACE FUNCTION public.finalize_followup_schedule(
  p_schedule_id        UUID,
  p_company_id         UUID,
  p_outcome            TEXT,         -- 'success' | 'technical_failure' | 'cancel'
  p_cancel_reason      TEXT DEFAULT NULL,
  -- Para sucesso: dados da próxima tentativa
  p_new_attempt_number INTEGER      DEFAULT NULL,
  p_create_next        BOOLEAN      DEFAULT false,
  p_next_scheduled_at  TIMESTAMPTZ  DEFAULT NULL,
  p_last_inbound_now   TIMESTAMPTZ  DEFAULT NULL
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
  -- Valida ownership + status (multi-tenant + evita update duplo)
  SELECT * INTO v_schedule
  FROM public.agent_contact_schedules
  WHERE id         = p_schedule_id
    AND company_id = p_company_id
    AND status     = 'processing';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'schedule_not_found_or_not_processing'
    );
  END IF;

  -- CASO 1: Sucesso — envio confirmado pelo gateway
  IF p_outcome = 'success' THEN
    UPDATE public.agent_contact_schedules
    SET
      status          = 'sent',
      attempt_number  = COALESCE(p_new_attempt_number, attempt_number + 1),
      last_attempt_at = now(),
      next_attempt_at = CASE WHEN p_create_next THEN p_next_scheduled_at ELSE NULL END,
      cancel_reason   = NULL,
      updated_at      = now()
    WHERE id         = p_schedule_id
      AND company_id = p_company_id;

    -- Criar próxima tentativa se necessário
    IF p_create_next AND p_next_scheduled_at IS NOT NULL THEN
      INSERT INTO public.agent_contact_schedules (
        company_id,
        lead_id,
        conversation_id,
        agent_id,
        assignment_id,
        reason,
        scheduled_at,
        attempt_number,
        max_attempts,
        interval_hours,
        status,
        last_inbound_snapshot,
        message_hint,
        retry_count,
        created_at,
        updated_at
      ) VALUES (
        v_schedule.company_id,
        v_schedule.lead_id,
        v_schedule.conversation_id,
        v_schedule.agent_id,
        v_schedule.assignment_id,
        v_schedule.reason,
        p_next_scheduled_at,
        COALESCE(p_new_attempt_number, v_schedule.attempt_number + 1),
        v_schedule.max_attempts,
        v_schedule.interval_hours,
        'pending',
        COALESCE(p_last_inbound_now, now()),
        v_schedule.message_hint,
        0,
        now(),
        now()
      )
      RETURNING id INTO v_next_id;

      RETURN jsonb_build_object(
        'success',          true,
        'status',           'sent',
        'schedule_id',      p_schedule_id,
        'next_schedule_id', v_next_id,
        'attempt_number',   COALESCE(p_new_attempt_number, v_schedule.attempt_number + 1)
      );
    END IF;

    RETURN jsonb_build_object(
      'success',          true,
      'status',           'sent',
      'schedule_id',      p_schedule_id,
      'next_schedule_id', null,
      'attempt_number',   COALESCE(p_new_attempt_number, v_schedule.attempt_number + 1)
    );

  -- CASO 2: Falha técnica — LLM, gateway, timeout
  ELSIF p_outcome = 'technical_failure' THEN
    IF v_schedule.retry_count + 1 >= 5 THEN
      -- Limite de retries atingido
      UPDATE public.agent_contact_schedules
      SET
        status        = 'failed',
        retry_count   = retry_count + 1,
        cancel_reason = COALESCE(p_cancel_reason, 'max_retries_reached'),
        updated_at    = now()
      WHERE id         = p_schedule_id
        AND company_id = p_company_id;

      RETURN jsonb_build_object(
        'success', false,
        'status',  'failed',
        'reason',  COALESCE(p_cancel_reason, 'max_retries_reached')
      );
    ELSE
      -- Backoff exponencial: 2^(retry_count+1) min, max 60min
      UPDATE public.agent_contact_schedules
      SET
        status        = 'pending',
        retry_count   = retry_count + 1,
        cancel_reason = NULL,
        scheduled_at  = now() + LEAST(
                          POWER(2, retry_count + 1)::INTEGER * INTERVAL '1 minute',
                          INTERVAL '60 minutes'
                        ),
        updated_at    = now()
      WHERE id         = p_schedule_id
        AND company_id = p_company_id;

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
      status        = 'cancelled',
      cancel_reason = COALESCE(p_cancel_reason, 'cancelled'),
      updated_at    = now()
    WHERE id         = p_schedule_id
      AND company_id = p_company_id;

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
  RETURN jsonb_build_object(
    'success', false,
    'error',   SQLERRM
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_followup_schedule(UUID, UUID, TEXT, TEXT, INTEGER, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_followup_schedule(UUID, UUID, TEXT, TEXT, INTEGER, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon, authenticated;

COMMENT ON FUNCTION public.finalize_followup_schedule IS
  'Finaliza atomicamente um schedule de follow-up. '
  'p_outcome: success | technical_failure | cancel '
  'success: marca sent, incrementa attempt_number, cria próximo se p_create_next. '
  'technical_failure: incrementa retry_count (não attempt_number), backoff ou failed. '
  'cancel: marca cancelled sem consumir tentativa. '
  'Valida company_id e status=processing antes de qualquer alteração. '
  'Uso exclusivo do backend (service_role).';
