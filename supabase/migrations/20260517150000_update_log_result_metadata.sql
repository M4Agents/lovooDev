-- =============================================================================
-- Migration: Fase 5 — p_metadata em update_webhook_log_result
--
-- Adiciona parâmetro opcional p_metadata JSONB para registrar metadados
-- técnicos como ignored_fields_count e ignored_fields_names.
-- Faz merge com metadata existente (não sobrescreve, apenas adiciona chaves).
--
-- A assinatura antiga (4 params) é removida para evitar ambiguidade no
-- resolvedor de overloads do PostgREST com chamadas por nome de parâmetro.
-- =============================================================================

DROP FUNCTION IF EXISTS public.update_webhook_log_result(TEXT, TEXT, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.update_webhook_log_result(
  p_request_id  TEXT,
  p_result      TEXT,
  p_lead_id     INTEGER DEFAULT NULL,
  p_error_code  TEXT    DEFAULT NULL,
  p_metadata    JSONB   DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_result NOT IN (
    'success', 'duplicate', 'invalid_key', 'validation_error',
    'plan_limit', 'error', 'rate_limited_pre', 'rate_limited_post'
  ) THEN
    RAISE EXCEPTION 'invalid result value: %', p_result;
  END IF;

  UPDATE public.webhook_api_logs
  SET
    result     = p_result,
    error_code = COALESCE(p_error_code, error_code),
    lead_id    = COALESCE(p_lead_id,    lead_id),
    metadata   = CASE
                   WHEN p_metadata IS NOT NULL
                   THEN COALESCE(metadata, '{}'::jsonb) || p_metadata
                   ELSE metadata
                 END
  WHERE request_id = p_request_id
    AND result IN ('pending', 'pre_auth_allowed');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_webhook_log_result(TEXT, TEXT, INTEGER, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_webhook_log_result(TEXT, TEXT, INTEGER, TEXT, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_webhook_log_result(TEXT, TEXT, INTEGER, TEXT, JSONB) FROM authenticated;
