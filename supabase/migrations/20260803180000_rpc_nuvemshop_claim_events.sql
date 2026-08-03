-- =============================================================================
-- Nuvemshop Integration — Migration 8/12
-- RPC: claim_nuvemshop_events
--
-- Reivindica atomicamente eventos pendentes para processamento por um worker.
-- Utiliza FOR UPDATE SKIP LOCKED para garantir que múltiplas instâncias
-- do cron não processem o mesmo evento simultaneamente.
--
-- Segurança:
--   - SECURITY DEFINER com search_path explícito
--   - Acesso restrito a service_role
-- =============================================================================

DROP FUNCTION IF EXISTS public.claim_nuvemshop_events(TEXT, SMALLINT);

CREATE OR REPLACE FUNCTION public.claim_nuvemshop_events(
  p_worker_id   TEXT,
  p_limit       SMALLINT  DEFAULT 10
)
RETURNS SETOF public.nuvemshop_webhook_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_worker_id IS NULL OR p_worker_id = '' THEN
    RAISE EXCEPTION 'worker_id is required';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM public.nuvemshop_webhook_events
    WHERE status          = 'pending'
      AND next_attempt_at <= now()
      AND attempts        < max_attempts
    ORDER BY next_attempt_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.nuvemshop_webhook_events evt
  SET
    status          = 'processing',
    worker_id       = p_worker_id,
    acquired_at     = now(),
    attempts        = attempts + 1,
    last_attempt_at = now(),
    updated_at      = now()
  FROM claimed
  WHERE evt.id = claimed.id
  RETURNING evt.*;
END;
$$;

-- Acesso restrito: somente service_role (cron worker)
REVOKE EXECUTE ON FUNCTION public.claim_nuvemshop_events(TEXT, SMALLINT)
  FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_nuvemshop_events(TEXT, SMALLINT)
  TO service_role;
