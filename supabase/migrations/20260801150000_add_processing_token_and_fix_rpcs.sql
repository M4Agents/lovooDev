-- =====================================================
-- MIGRATION: processing_token + RPCs de concorrência
-- Data: 2026-08-01
--
-- Objetivo: Eliminar três riscos de concorrência:
--   1. Stale recovery ativo enquanto worker legítimo ainda processa
--   2. Finalização sem lock explícito ou validação forte de ownership
--   3. Envio usando assignment antigo após mudança na conversa
--
-- O que esta migration faz:
--   1. Adiciona processing_token UUID NULL em agent_contact_schedules
--   2. Atualiza claim_agent_contact_schedules: gera token exclusivo via gen_random_uuid()
--   3. Atualiza recover_stale_agent_schedules: timeout 10 min + limpa processing_token
--   4. Remove assinatura anterior de finalize_followup_schedule (sem token)
--   5. Recria finalize_followup_schedule com p_processing_token (obrigatório)
--      e FOR UPDATE explícito para lock atômico da linha
--
-- Pré-requisito: pgcrypto disponível (confirmado: v1.3 instalada no Supabase)
-- Ordem de deploy: migrations → código JS (nunca o contrário)
-- =====================================================

-- ─── Etapa 1: Coluna processing_token ──────────────────────────────────────
ALTER TABLE public.agent_contact_schedules
  ADD COLUMN IF NOT EXISTS processing_token UUID NULL;

COMMENT ON COLUMN public.agent_contact_schedules.processing_token IS
  'Token exclusivo gerado no claim do schedule.
   Usado para garantir que somente o worker proprietário possa processar e finalizar.
   NULL quando o schedule não está em processing ou após finalização/recovery.';

-- ─── Etapa 2: claim_agent_contact_schedules ─────────────────────────────────
-- Gera processing_token exclusivo (gen_random_uuid()) para cada schedule claimado.
-- Dois workers simultâneos retornam registros distintos (FOR UPDATE SKIP LOCKED).
-- Cada worker recebe token único → finalize valida posse antes de qualquer alteração.

CREATE OR REPLACE FUNCTION public.claim_agent_contact_schedules(
  p_limit  INTEGER DEFAULT 5,
  p_reason TEXT    DEFAULT NULL
)
RETURNS SETOF public.agent_contact_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
BEGIN
  -- Cap defensivo: mínimo 1, máximo 10 (pipeline LLM tem custo temporal)
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 10);

  RETURN QUERY
  WITH claimed AS (
    SELECT schedules.id
    FROM public.agent_contact_schedules schedules
    WHERE schedules.status       = 'pending'
      AND schedules.scheduled_at <= now()
      AND (p_reason IS NULL OR schedules.reason = p_reason)
    ORDER BY schedules.scheduled_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.agent_contact_schedules s
  SET
    status           = 'processing',
    processed_at     = now(),
    processing_token = gen_random_uuid(),
    updated_at       = now()
  FROM claimed
  WHERE s.id = claimed.id
  RETURNING s.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_contact_schedules(INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_agent_contact_schedules(INTEGER, TEXT) FROM anon, authenticated;

COMMENT ON FUNCTION public.claim_agent_contact_schedules IS
  'Claim atômico de schedules pendentes com FOR UPDATE SKIP LOCKED. '
  'Gera processing_token exclusivo por gen_random_uuid() para cada schedule. '
  'Workers concorrentes recebem tokens distintos — finalize valida posse. '
  'p_limit capped em 10 (pipeline LLM ~5-10s por schedule). '
  'p_reason: filtro por reason — null = todos os reasons. '
  'Uso exclusivo do backend (service_role).';

-- ─── Etapa 3: recover_stale_agent_schedules ─────────────────────────────────
-- Timeout alterado de 5 para 10 minutos:
--   Vercel Pro max exec = 300s ≈ 5 min.
--   10 min garante que workers legítimos em execução normal não sejam reclamados.
-- Limpa processing_token ao recuperar: invalida qualquer worker tardio que
--   ainda tenha o token do claim anterior.

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
  v_stale_cutoff TIMESTAMPTZ;
  v_recovered    INTEGER := 0;
  v_failed_count INTEGER := 0;
BEGIN
  -- 10 min default > Vercel Pro max exec (300s). Evita reclamar workers legítimos.
  v_stale_cutoff := now() - (COALESCE(p_stale_minutes, 10) * INTERVAL '1 minute');

  -- Schedules com retries disponíveis → pending com backoff exponencial + token limpo
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
    AND processed_at < v_stale_cutoff
    AND retry_count  < COALESCE(p_max_retry, 5);

  GET DIAGNOSTICS v_recovered = ROW_COUNT;

  -- Schedules sem retries disponíveis → failed com token limpo
  UPDATE public.agent_contact_schedules
  SET
    status           = 'failed',
    retry_count      = retry_count + 1,
    processing_token = NULL,
    cancel_reason    = 'stale_processing_timeout',
    updated_at       = now()
  WHERE status       = 'processing'
    AND processed_at < v_stale_cutoff
    AND retry_count  >= COALESCE(p_max_retry, 5);

  GET DIAGNOSTICS v_failed_count = ROW_COUNT;

  RETURN v_recovered + v_failed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_stale_agent_schedules(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_stale_agent_schedules(INTEGER, INTEGER) FROM anon, authenticated;

COMMENT ON FUNCTION public.recover_stale_agent_schedules IS
  'Recupera schedules presos em processing por timeout. '
  'Default 10 min > Vercel Pro max exec (300s = 5 min). '
  'Limpa processing_token: invalida worker tardio que tenha token antigo. '
  'Backoff exponencial: 2^(retry_count+1) min, max 60 min. '
  'Após p_max_retry (default 5): status = failed. '
  'Nunca incrementa attempt_number — recuperação técnica, não tentativa comercial. '
  'Uso exclusivo do backend (service_role).';

-- ─── Etapa 4: Remover assinatura anterior de finalize_followup_schedule ─────
-- A nova assinatura inclui p_processing_token UUID como 3º parâmetro.
-- CREATE OR REPLACE não pode alterar assinatura — DROP necessário.

DROP FUNCTION IF EXISTS public.finalize_followup_schedule(
  UUID, UUID, TEXT, TEXT, INTEGER, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ
);

-- ─── Etapa 5: finalize_followup_schedule com processing_token + FOR UPDATE ──
-- Garante:
--   a) Lock explícito da linha via FOR UPDATE (previne finalização dupla).
--   b) Validação de ownership: company_id + status='processing' + processing_token.
--   c) Se token não corresponde (stale recovery já limpou), retorna NOT FOUND.
--   d) processing_token = NULL após qualquer finalização (invalida workers tardios).
--   e) Para success+create_next: UPDATE first, depois INSERT.
--      Se INSERT falhar, EXCEPTION externa reverte também o UPDATE (subtransação).

CREATE OR REPLACE FUNCTION public.finalize_followup_schedule(
  p_schedule_id        UUID,
  p_company_id         UUID,
  p_processing_token   UUID,            -- obrigatório: token gerado no claim
  p_outcome            TEXT,            -- 'success' | 'technical_failure' | 'cancel'
  p_cancel_reason      TEXT        DEFAULT NULL,
  p_new_attempt_number INTEGER     DEFAULT NULL,
  p_create_next        BOOLEAN     DEFAULT false,
  p_next_scheduled_at  TIMESTAMPTZ DEFAULT NULL,
  p_last_inbound_now   TIMESTAMPTZ DEFAULT NULL
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
  -- Lock explícito da linha + validação de ownership.
  -- FOR UPDATE: garante que dois workers não finalizam o mesmo schedule.
  -- Filtra por processing_token: se recovery já limpou o token, retorna NOT FOUND.
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

  -- CASO 1: Sucesso — envio confirmado pelo gateway
  IF p_outcome = 'success' THEN
    -- UPDATE primeiro: marca schedule atual como 'sent' com token limpo.
    -- Se INSERT posterior falhar, o EXCEPTION externo reverte AMBOS.
    UPDATE public.agent_contact_schedules
    SET
      status           = 'sent',
      attempt_number   = COALESCE(p_new_attempt_number, attempt_number + 1),
      last_attempt_at  = now(),
      next_attempt_at  = CASE WHEN p_create_next THEN p_next_scheduled_at ELSE NULL END,
      cancel_reason    = NULL,
      processing_token = NULL,
      updated_at       = now()
    WHERE id = p_schedule_id;

    -- INSERT da próxima tentativa (se houver mais tentativas).
    -- processing_token = NULL: próximo schedule começa sem token.
    -- Dedup index impede duplicata de pending para o mesmo (company, conversation, reason).
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
        processing_token,
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
        NULL,
        COALESCE(p_last_inbound_now, now()),
        v_schedule.message_hint,
        0,
        now(),
        now()
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

  -- CASO 2: Falha técnica — LLM, gateway, timeout
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

-- Se UPDATE ou INSERT lançarem exceção, este handler reverte TUDO desde o
-- início do bloco (subtransação implícita criada pela cláusula EXCEPTION).
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   SQLERRM
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_followup_schedule(UUID, UUID, UUID, TEXT, TEXT, INTEGER, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_followup_schedule(UUID, UUID, UUID, TEXT, TEXT, INTEGER, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon, authenticated;

COMMENT ON FUNCTION public.finalize_followup_schedule IS
  'Finaliza atomicamente um schedule de follow-up com validação de ownership via processing_token. '
  'p_processing_token obrigatório: se não corresponder, retorna schedule_not_found_or_not_processing. '
  'FOR UPDATE explícito: dois workers concorrentes não podem finalizar o mesmo schedule. '
  'processing_token = NULL após qualquer finalização: invalida workers tardios. '
  'Para success+create_next: UPDATE primeiro, depois INSERT. '
  '  Se INSERT falhar, EXCEPTION reverte AMBAS as operações (subtransação). '
  'technical_failure: retry_count++ (não attempt_number), backoff ou failed. '
  'cancel: cancelled sem consumir tentativa comercial. '
  'Uso exclusivo do backend (service_role).';
