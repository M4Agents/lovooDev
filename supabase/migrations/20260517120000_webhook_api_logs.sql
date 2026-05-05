-- =============================================================================
-- Migration: Fase 1 de Segurança — webhook_api_logs + rate limiting atômico
--
-- Cria:
--   1. Tabela webhook_api_logs (auditoria técnica)
--   2. RPC check_and_log_webhook_rate_limit (atômica com advisory lock)
--   3. RPC log_webhook_invalid_key (registro de api_key inválida sem company_id)
--   4. RPC update_webhook_log_result (atualiza resultado final pós-auth)
--   5. RPC cleanup_webhook_api_logs (retenção de 90 dias)
--   6. Índices otimizados (incluindo parcial pré-auth)
--   7. pg_cron opcional (não falha se extensão ausente)
--
-- Convenção de isolamento:
--   company_id IS NULL     → linha pré-auth (api_key ainda não validada)
--   company_id IS NOT NULL → linha pós-auth (empresa resolvida pelo backend)
--
-- Segurança:
--   api_key NUNCA armazenada — apenas SHA-256 hex (api_key_hash)
--   REVOKE ALL na tabela para anon/authenticated
--   Escrita exclusiva via RPCs SECURITY DEFINER
-- =============================================================================

-- ── 1. Tabela ────────────────────────────────────────────────────────────────

CREATE TABLE public.webhook_api_logs (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id      TEXT        NOT NULL,
  company_id      UUID        REFERENCES public.companies(id) ON DELETE SET NULL,
  api_key_hash    TEXT        NOT NULL,
  ip_address      TEXT,
  method          TEXT,
  path            TEXT,
  user_agent      TEXT,
  payload_size    INTEGER,
  result          TEXT        NOT NULL CHECK (result IN (
                    'pre_auth_allowed',    -- pré-auth passou (nunca fica como pending)
                    'pending',             -- pós-auth passou; aguarda resultado final
                    'success',
                    'duplicate',
                    'rate_limited_pre',
                    'rate_limited_post',
                    'invalid_key',
                    'validation_error',
                    'plan_limit',
                    'error'
                  )),
  error_code      TEXT,
  lead_id         INTEGER     REFERENCES public.leads(id) ON DELETE SET NULL,
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Sem acesso direto para anon/authenticated — escrita exclusiva via RPCs
REVOKE ALL ON TABLE public.webhook_api_logs FROM PUBLIC;
REVOKE ALL ON TABLE public.webhook_api_logs FROM anon;
REVOKE ALL ON TABLE public.webhook_api_logs FROM authenticated;

ALTER TABLE public.webhook_api_logs ENABLE ROW LEVEL SECURITY;
-- Sem policies de INSERT/UPDATE/DELETE — toda escrita passa pelas RPCs abaixo
-- (SELECT para super_admin poderá ser adicionado em migration futura conforme necessidade)

-- ── 2. Índices ───────────────────────────────────────────────────────────────

-- Pós-auth: rate limit por empresa
CREATE INDEX idx_whl_company_time
  ON public.webhook_api_logs(company_id, created_at DESC)
  WHERE company_id IS NOT NULL;

-- Pré-auth: índice PARCIAL — apenas registros sem company_id (recomendação não-bloqueante)
CREATE INDEX idx_whl_ip_hash_time
  ON public.webhook_api_logs(ip_address, api_key_hash, created_at DESC)
  WHERE company_id IS NULL;

-- Lookup para update_webhook_log_result
CREATE INDEX idx_whl_request_id
  ON public.webhook_api_logs(request_id);

-- Retenção: cleanup periódico de 90 dias
CREATE INDEX idx_whl_created_at
  ON public.webhook_api_logs(created_at);

-- ── 3. RPC check_and_log_webhook_rate_limit ───────────────────────────────────
--
-- Atômica: advisory lock + contagem + decisão + insert em uma transação.
-- Advisory lock elimina race conditions em ambiente serverless paralelo.
-- Usa hashtextextended (64-bit, melhor distribuição) para chave do lock.
--
-- p_company_id NULL  = fase pré-auth (contar por ip+hash, company_id IS NULL)
-- p_company_id UUID  = fase pós-auth (contar por company_id)

CREATE OR REPLACE FUNCTION public.check_and_log_webhook_rate_limit(
  p_request_id    TEXT,
  p_company_id    UUID,
  p_api_key_hash  TEXT,
  p_ip_address    TEXT,
  p_method        TEXT    DEFAULT 'POST',
  p_path          TEXT    DEFAULT '/api/webhook-lead',
  p_user_agent    TEXT    DEFAULT NULL,
  p_payload_size  INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key  BIGINT;
  v_count_1m  INTEGER := 0;
  v_count_1h  INTEGER := 0;
  v_count_1d  INTEGER := 0;
  v_allowed   BOOLEAN;
  v_result    TEXT;
BEGIN
  IF p_company_id IS NULL THEN
    -- Fase pré-auth: serializar por IP + hash
    -- hashtextextended fornece 64-bit hash (melhor distribuição que hashtext/32-bit)
    v_lock_key := hashtextextended(
      COALESCE(p_ip_address, 'unknown') || ':' || COALESCE(p_api_key_hash, ''),
      0
    );
    PERFORM pg_advisory_xact_lock(v_lock_key);

    SELECT COUNT(*) INTO v_count_1m
    FROM public.webhook_api_logs
    WHERE ip_address  = COALESCE(p_ip_address, 'unknown')
      AND api_key_hash = p_api_key_hash
      AND company_id  IS NULL
      AND created_at  > NOW() - INTERVAL '1 minute';

    SELECT COUNT(*) INTO v_count_1h
    FROM public.webhook_api_logs
    WHERE ip_address  = COALESCE(p_ip_address, 'unknown')
      AND api_key_hash = p_api_key_hash
      AND company_id  IS NULL
      AND created_at  > NOW() - INTERVAL '1 hour';

    v_allowed := v_count_1m < 60 AND v_count_1h < 300;
    v_result  := CASE WHEN v_allowed THEN 'pre_auth_allowed' ELSE 'rate_limited_pre' END;

  ELSE
    -- Fase pós-auth: serializar por company_id
    v_lock_key := hashtextextended(p_company_id::TEXT, 0);
    PERFORM pg_advisory_xact_lock(v_lock_key);

    SELECT COUNT(*) INTO v_count_1m
    FROM public.webhook_api_logs
    WHERE company_id = p_company_id
      AND created_at > NOW() - INTERVAL '1 minute';

    SELECT COUNT(*) INTO v_count_1h
    FROM public.webhook_api_logs
    WHERE company_id = p_company_id
      AND created_at > NOW() - INTERVAL '1 hour';

    SELECT COUNT(*) INTO v_count_1d
    FROM public.webhook_api_logs
    WHERE company_id = p_company_id
      AND created_at > NOW() - INTERVAL '1 day';

    v_allowed := v_count_1m < 30 AND v_count_1h < 500 AND v_count_1d < 5000;
    v_result  := CASE WHEN v_allowed THEN 'pending' ELSE 'rate_limited_post' END;
  END IF;

  INSERT INTO public.webhook_api_logs (
    request_id, company_id, api_key_hash, ip_address,
    method, path, user_agent, payload_size,
    result, metadata
  ) VALUES (
    p_request_id,
    p_company_id,
    p_api_key_hash,
    COALESCE(p_ip_address, 'unknown'),
    p_method,
    p_path,
    p_user_agent,
    p_payload_size,
    v_result,
    jsonb_build_object(
      'count_1m', v_count_1m,
      'count_1h', v_count_1h,
      'count_1d', v_count_1d
    )
  );

  RETURN jsonb_build_object(
    'allowed',   v_allowed,
    'count_1m',  v_count_1m,
    'count_1h',  v_count_1h,
    'count_1d',  v_count_1d,
    'phase',     CASE WHEN p_company_id IS NULL THEN 'pre_auth' ELSE 'post_auth' END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_and_log_webhook_rate_limit FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_and_log_webhook_rate_limit TO anon;

-- ── 4. RPC log_webhook_invalid_key ───────────────────────────────────────────
--
-- Insere registro terminal quando api_key não resolve nenhuma empresa.
-- Produz trilha de auditoria: pre_auth_allowed → invalid_key (mesmo request_id).
-- Sem advisory lock: é terminal, não participa de contagem de rate limit.

CREATE OR REPLACE FUNCTION public.log_webhook_invalid_key(
  p_request_id    TEXT,
  p_api_key_hash  TEXT,
  p_ip_address    TEXT,
  p_method        TEXT DEFAULT 'POST',
  p_path          TEXT DEFAULT '/api/webhook-lead'
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.webhook_api_logs (
    request_id, company_id, api_key_hash, ip_address, method, path, result
  ) VALUES (
    p_request_id,
    NULL,
    p_api_key_hash,
    COALESCE(p_ip_address, 'unknown'),
    p_method,
    p_path,
    'invalid_key'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.log_webhook_invalid_key FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.log_webhook_invalid_key TO anon;

-- ── 5. RPC update_webhook_log_result ─────────────────────────────────────────
--
-- Atualiza o registro pós-auth em estado 'pending' com o resultado final.
-- Valida p_result contra lista permitida antes de aplicar.
-- Atualiza o registro mais recente com request_id=x, company_id IS NOT NULL, result='pending'.

CREATE OR REPLACE FUNCTION public.update_webhook_log_result(
  p_request_id  TEXT,
  p_result      TEXT,
  p_lead_id     INTEGER DEFAULT NULL,
  p_error_code  TEXT    DEFAULT NULL
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
    RAISE EXCEPTION 'update_webhook_log_result: p_result inválido: %', p_result;
  END IF;

  UPDATE public.webhook_api_logs
  SET
    result     = p_result,
    lead_id    = p_lead_id,
    error_code = p_error_code
  WHERE id = (
    SELECT id
    FROM   public.webhook_api_logs
    WHERE  request_id  = p_request_id
      AND  company_id  IS NOT NULL
      AND  result      = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_webhook_log_result FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.update_webhook_log_result TO anon;

-- ── 6. RPC cleanup_webhook_api_logs + retenção 90 dias ───────────────────────

CREATE OR REPLACE FUNCTION public.cleanup_webhook_api_logs()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.webhook_api_logs
  WHERE created_at < NOW() - INTERVAL '90 days';
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_webhook_api_logs FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cleanup_webhook_api_logs TO postgres;

-- Tentativa de agendar via pg_cron; silenciosa se extensão não estiver disponível
DO $$
BEGIN
  PERFORM cron.schedule(
    'cleanup-webhook-api-logs',
    '0 3 * * *',
    $cmd$ SELECT public.cleanup_webhook_api_logs() $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponível — agendar cleanup_webhook_api_logs manualmente ou via Edge Function';
END;
$$;
