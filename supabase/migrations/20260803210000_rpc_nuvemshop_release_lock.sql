-- =============================================================================
-- Nuvemshop Integration — Migration 11/12
-- RPC: release_nuvemshop_lock
--
-- Libera um lock ao final do processamento.
-- Somente o worker que detém o lock pode liberá-lo.
-- Isso impede que um worker libere o lock de outro worker.
--
-- Retorno:
--   ok: true, released: true  → liberado com sucesso
--   ok: true, released: false → lock não encontrado ou pertence a outro worker
--
-- Segurança:
--   - SECURITY DEFINER com search_path explícito
--   - Acesso restrito a service_role
-- =============================================================================

DROP FUNCTION IF EXISTS public.release_nuvemshop_lock(UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.release_nuvemshop_lock(
  p_company_id    UUID,
  p_resource_type TEXT,
  p_resource_id   TEXT,
  p_worker_id     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_id UUID;
BEGIN
  DELETE FROM public.nuvemshop_processing_locks
  WHERE company_id    = p_company_id
    AND resource_type = p_resource_type
    AND resource_id   = p_resource_id
    AND worker_id     = p_worker_id   -- somente o próprio worker pode liberar
  RETURNING id INTO v_deleted_id;

  RETURN jsonb_build_object(
    'ok',       true,
    'released', (v_deleted_id IS NOT NULL)
  );
END;
$$;

-- Acesso restrito: somente service_role
REVOKE EXECUTE ON FUNCTION public.release_nuvemshop_lock(UUID, TEXT, TEXT, TEXT)
  FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.release_nuvemshop_lock(UUID, TEXT, TEXT, TEXT)
  TO service_role;
