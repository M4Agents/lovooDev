-- =====================================================
-- MIGRATION: RPCs de controle de agent_contact_schedules
-- Data: 2026-08-01
--
-- RPCs criadas:
--   1. claim_agent_contact_schedules  — claim atômico com FOR UPDATE SKIP LOCKED
--   2. recover_stale_agent_schedules  — recupera schedules presos em processing
--
-- Segurança:
--   SECURITY DEFINER + SET search_path = public.
--   REVOKE de PUBLIC, anon e authenticated — uso exclusivo via service_role.
--
-- Limite do p_limit:
--   Reduzido de 50 para 5 (cap em 10). Pipeline LLM real leva ~5-10s por schedule.
--   Vercel Pro timeout: 300s. Máximo seguro por invocação: 2-5 schedules.
-- =====================================================

-- 1. claim_agent_contact_schedules
--    Transition atômica: pending → processing
--    FOR UPDATE SKIP LOCKED: garante que dois crons simultâneos nunca
--    processem o mesmo schedule.

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
    status       = 'processing',
    processed_at = now(),
    updated_at   = now()
  FROM claimed
  WHERE s.id = claimed.id
  RETURNING s.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_contact_schedules(INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_agent_contact_schedules(INTEGER, TEXT) FROM anon, authenticated;

COMMENT ON FUNCTION public.claim_agent_contact_schedules IS
  'Claim atômico de schedules pendentes com FOR UPDATE SKIP LOCKED. '
  'Transição pending → processing em uma operação. '
  'Garante que dois crons simultâneos nunca processem o mesmo schedule. '
  'p_limit capped em 10 (pipeline LLM ~5-10s por schedule). '
  'p_reason: filtro por reason — null = todos os reasons. '
  'Uso exclusivo do backend (service_role).';

-- =====================================================

-- 2. recover_stale_agent_schedules
--    Recupera schedules presos em 'processing' por timeout.
--    Schedules em processing por mais de p_stale_minutes minutos
--    são considerados abandonados (Vercel timeout, falha de rede, etc).
--
--    Estratégia:
--    - Se retry_count < p_max_retry: volta para 'pending' com backoff exponencial
--    - Se retry_count >= p_max_retry: marca como 'failed'
--
--    Nunca incrementa attempt_number (falha técnica, não comercial).

CREATE OR REPLACE FUNCTION public.recover_stale_agent_schedules(
  p_stale_minutes INTEGER DEFAULT 5,
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
  -- Cutoff conservador: baseado no timeout real da Vercel (Pro: 300s = 5min)
  v_stale_cutoff := now() - (COALESCE(p_stale_minutes, 5) * INTERVAL '1 minute');

  -- Schedules com retries disponíveis → pending com backoff exponencial
  -- Backoff: 2^(retry_count+1) minutos, máximo 60 minutos
  -- Exemplo: 1ª falha = 2min, 2ª = 4min, 3ª = 8min, 4ª = 16min, 5ª = failed
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
  WHERE status       = 'processing'
    AND processed_at < v_stale_cutoff
    AND retry_count  < COALESCE(p_max_retry, 5);

  GET DIAGNOSTICS v_recovered = ROW_COUNT;

  -- Schedules sem retries → failed
  UPDATE public.agent_contact_schedules
  SET
    status        = 'failed',
    retry_count   = retry_count + 1,
    cancel_reason = 'stale_processing_timeout',
    updated_at    = now()
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
  'Recupera schedules presos em processing por timeout (Vercel crash, rede, etc). '
  'Backoff exponencial: 2^(retry_count+1) min, max 60min. '
  'Após p_max_retry (default 5): status = failed. '
  'Nunca incrementa attempt_number — é recuperação técnica, não tentativa comercial. '
  'Uso exclusivo do backend (service_role).';
