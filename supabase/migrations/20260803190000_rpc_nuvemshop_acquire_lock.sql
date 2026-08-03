-- =============================================================================
-- Nuvemshop Integration — Migration 9/12
-- RPC: acquire_nuvemshop_lock
--
-- Adquire um lock por recurso (resource_type + resource_id) para um worker.
-- Permite que o mesmo worker renove seu próprio lock.
-- Locks expirados são substituídos (INSERT ON CONFLICT DO UPDATE).
--
-- Retorno:
--   ok: true  → lock adquirido
--   ok: false → lock pertence a outro worker ativo (não expirado)
--
-- Segurança:
--   - SECURITY DEFINER com search_path explícito
--   - Acesso restrito a service_role
-- =============================================================================

DROP FUNCTION IF EXISTS public.acquire_nuvemshop_lock(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.acquire_nuvemshop_lock(
  p_company_id    UUID,
  p_store_id      TEXT,
  p_resource_type TEXT,
  p_resource_id   TEXT,
  p_worker_id     TEXT,
  p_ttl_seconds   INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now         TIMESTAMPTZ := now();
  v_expires_at  TIMESTAMPTZ := v_now + (p_ttl_seconds || ' seconds')::INTERVAL;
  v_lock_id     UUID;
  v_lock_worker TEXT;
  v_lock_exp    TIMESTAMPTZ;
BEGIN
  -- Validações
  IF p_company_id IS NULL OR p_resource_type = '' OR p_resource_id = '' OR p_worker_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid parameters');
  END IF;

  -- Tentar inserir; em conflito, sobrescrever apenas se lock expirou
  -- ou se o mesmo worker já possui o lock (renovação implícita)
  INSERT INTO public.nuvemshop_processing_locks (
    company_id,
    store_id,
    resource_type,
    resource_id,
    worker_id,
    expires_at,
    renewed_at
  ) VALUES (
    p_company_id,
    p_store_id,
    p_resource_type,
    p_resource_id,
    p_worker_id,
    v_expires_at,
    v_now
  )
  ON CONFLICT (company_id, resource_type, resource_id)
  DO UPDATE SET
    worker_id  = p_worker_id,
    expires_at = v_expires_at,
    renewed_at = v_now
  WHERE
    -- Sobrescreve lock expirado
    nuvemshop_processing_locks.expires_at < v_now
    -- Ou renova próprio lock
    OR nuvemshop_processing_locks.worker_id = p_worker_id
  RETURNING id, worker_id, expires_at
  INTO v_lock_id, v_lock_worker, v_lock_exp;

  -- Se o UPDATE não ocorreu (lock ativo de outro worker)
  IF v_lock_id IS NULL THEN
    SELECT worker_id, expires_at
    INTO v_lock_worker, v_lock_exp
    FROM public.nuvemshop_processing_locks
    WHERE company_id    = p_company_id
      AND resource_type = p_resource_type
      AND resource_id   = p_resource_id;

    RETURN jsonb_build_object(
      'ok',         false,
      'locked_by',  v_lock_worker,
      'expires_at', v_lock_exp
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',         true,
    'lock_id',    v_lock_id,
    'worker_id',  v_lock_worker,
    'expires_at', v_lock_exp
  );
END;
$$;

-- Acesso restrito: somente service_role
REVOKE EXECUTE ON FUNCTION public.acquire_nuvemshop_lock(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER)
  FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.acquire_nuvemshop_lock(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER)
  TO service_role;
