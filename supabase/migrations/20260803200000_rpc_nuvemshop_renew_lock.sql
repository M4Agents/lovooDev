-- =============================================================================
-- Nuvemshop Integration — Migration 10/12
-- RPC: renew_nuvemshop_lock
--
-- Renova o TTL de um lock existente (heartbeat).
-- Chamada pelo worker em intervalos regulares enquanto processa um evento.
-- Somente o worker que detém o lock pode renová-lo.
--
-- Retorno:
--   ok: true,  renewed: true  → renovado com sucesso
--   ok: true,  renewed: false → lock não encontrado ou pertence a outro worker
--
-- Segurança:
--   - SECURITY DEFINER com search_path explícito
--   - Acesso restrito a service_role
-- =============================================================================

DROP FUNCTION IF EXISTS public.renew_nuvemshop_lock(UUID, TEXT, TEXT, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.renew_nuvemshop_lock(
  p_company_id    UUID,
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
  v_now        TIMESTAMPTZ := now();
  v_expires_at TIMESTAMPTZ := v_now + (p_ttl_seconds || ' seconds')::INTERVAL;
  v_updated_id UUID;
BEGIN
  UPDATE public.nuvemshop_processing_locks
  SET
    expires_at = v_expires_at,
    renewed_at = v_now
  WHERE company_id    = p_company_id
    AND resource_type = p_resource_type
    AND resource_id   = p_resource_id
    AND worker_id     = p_worker_id
    AND expires_at    > v_now   -- apenas locks ainda válidos
  RETURNING id INTO v_updated_id;

  RETURN jsonb_build_object(
    'ok',         true,
    'renewed',    (v_updated_id IS NOT NULL),
    'expires_at', v_expires_at
  );
END;
$$;

-- Acesso restrito: somente service_role
REVOKE EXECUTE ON FUNCTION public.renew_nuvemshop_lock(UUID, TEXT, TEXT, TEXT, INTEGER)
  FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.renew_nuvemshop_lock(UUID, TEXT, TEXT, TEXT, INTEGER)
  TO service_role;
