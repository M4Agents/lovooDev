-- =============================================================================
-- Nuvemshop Integration — Migration Fase 7
-- Infraestrutura do pipeline de mídias
--
-- 1. UNIQUE(company_id, s3_key) em company_media_library
--    Habilita upsert idempotente: mesmo asset uploadado duas vezes
--    retorna o mesmo library_asset_id em vez de criar duplicatas.
--
-- 2. RPC claim_nuvemshop_media_batch
--    Claim atômico com FOR UPDATE SKIP LOCKED para o media worker.
--    Evita processamento duplo da mesma imagem por workers concorrentes.
-- =============================================================================

-- 1. Validar duplicidades antes de criar a constraint ─────────────────────────
DO $$
DECLARE
  v_dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT company_id, s3_key
    FROM public.company_media_library
    WHERE s3_key IS NOT NULL
    GROUP BY company_id, s3_key
    HAVING COUNT(*) > 1
  ) duplicates;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'BLOQUEADO: Existem % grupo(s) com (company_id, s3_key) duplicados em company_media_library. '
      'Resolver antes de aplicar a constraint UNIQUE.',
      v_dup_count;
  END IF;

  RAISE NOTICE 'Sem duplicidades em company_media_library(company_id, s3_key). Constraint segura.';
END $$;

-- 2. UNIQUE(company_id, s3_key) ───────────────────────────────────────────────
ALTER TABLE public.company_media_library
  ADD CONSTRAINT uq_company_media_library_s3_key
    UNIQUE (company_id, s3_key);

-- 3. RPC: claim atômico de batch de mídias ─────────────────────────────────────
-- SECURITY DEFINER: executado como service_role no contexto do worker.
-- NÃO exposta ao authenticated — sem GRANT para authenticated.
CREATE OR REPLACE FUNCTION public.claim_nuvemshop_media_batch(
  p_worker_id  TEXT,
  p_batch_size INT  DEFAULT 5,
  p_max_retries INT DEFAULT 3
)
RETURNS SETOF public.nuvemshop_media_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.nuvemshop_media_queue
  SET
    status      = 'processing',
    worker_id   = p_worker_id,
    acquired_at = now()
  WHERE id IN (
    SELECT id
    FROM public.nuvemshop_media_queue
    WHERE status IN ('pending', 'failed')
      AND attempts < p_max_retries
    ORDER BY position ASC, created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

COMMENT ON FUNCTION public.claim_nuvemshop_media_batch(TEXT, INT, INT) IS
  'Claim atômico de itens da fila de mídia Nuvemshop. '
  'Usa FOR UPDATE SKIP LOCKED para suportar workers concorrentes. '
  'Exclusivo para uso pelo media worker via service_role.';

-- Sem GRANT para authenticated — tabela operacional de background
GRANT EXECUTE ON FUNCTION public.claim_nuvemshop_media_batch(TEXT, INT, INT) TO service_role;
