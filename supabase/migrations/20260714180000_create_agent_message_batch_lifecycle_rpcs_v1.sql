-- =====================================================
-- MIGRATION: RPCs de ciclo de vida dos lotes — Etapa 6
-- Data: 2026-07-14
-- Funcionalidade: Agrupamento de Mensagens — Lifecycle, Retry e Recovery
--
-- Funções criadas:
--   public.agent_message_batch_mark_processed_v1(UUID, UUID, TIMESTAMPTZ)
--   public.agent_message_batch_mark_retry_v1(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
--   public.agent_message_batch_mark_failed_v1(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
--   public.agent_message_batch_mark_cancelled_v1(UUID, UUID, TIMESTAMPTZ, TEXT)
--   public.agent_message_batches_recover_stale_v1(INTEGER, INTEGER)
--
-- State machine:
--   pending/retry_pending → processing               (claim — etapa anterior)
--   processing            → processed                (mark_processed_v1)
--   processing            → retry_pending            (mark_retry_v1, attempts < 3)
--   processing            → failed                   (mark_failed_v1 | mark_retry_v1 attempts>=3)
--   processing            → cancelled                (mark_cancelled_v1)
--   processing (stale)    → retry_pending | failed   (recover_stale_v1)
--
-- Controle de posse do claim:
--   Todas as RPCs individuais exigem p_locked_at coincidindo com locked_at do lote.
--   Um worker antigo com locked_at obsoleto nunca finaliza um claim mais recente.
--   locked_at é suficiente para V1 (precisão microssegundos, cron Vercel serializado).
--
-- Política de retry (backoff):
--   attempts=1 → 30s | attempts=2 → 120s | attempts>=3 → failed direto
--   attempts já incrementado pela claim RPC (etapa anterior).
--
-- Limites de texto (truncamento explícito documentado):
--   last_error_code      → 100 caracteres
--   last_error           → 2.000 caracteres
--   cancellation_reason  → 1.000 caracteres
--   Entradas acima do limite são truncadas silenciosamente com left().
--   NULL de entrada é preservado como NULL de saída via NULLIF.
--
-- Impacto no banco:
--   Cria apenas 5 funções novas. Nenhuma tabela, índice ou constraint alterados.
--
-- Nenhuma chamada integrada nesta etapa.
-- =====================================================


-- =====================================================
-- FUNÇÃO 1: agent_message_batch_mark_processed_v1
-- Transição: processing → processed
-- =====================================================

CREATE OR REPLACE FUNCTION public.agent_message_batch_mark_processed_v1(
  p_company_id UUID,
  p_batch_id   UUID,
  p_locked_at  TIMESTAMPTZ
)
RETURNS SETOF public.agent_message_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ── Validação de parâmetros obrigatórios ──────────────────────────────────
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_batch_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_locked_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_locked_at e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Transição atômica: processing → processed ─────────────────────────────
  -- Guard: company_id + status = processing + locked_at coincide com claim atual.
  -- last_error e last_error_code são limpos: sucesso não carrega histórico de erro.
  RETURN QUERY
    UPDATE public.agent_message_batches
    SET
      status          = 'processed',
      processed_at    = now(),
      locked_at       = NULL,
      next_attempt_at = NULL,
      last_error      = NULL,
      last_error_code = NULL,
      updated_at      = now()
    WHERE id         = p_batch_id
      AND company_id = p_company_id
      AND status     = 'processing'
      AND locked_at  = p_locked_at
    RETURNING *;

  -- ── Diagnóstico quando nenhuma linha foi atualizada ───────────────────────
  IF NOT FOUND THEN
    -- Verifica se o lote pertence a esta empresa (sem revelar dados de outra empresa).
    PERFORM 1
    FROM public.agent_message_batches
    WHERE id = p_batch_id AND company_id = p_company_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'BATCH_NOT_FOUND: lote nao encontrado para esta empresa'
        USING ERRCODE = 'P0001';
    END IF;

    -- Lote existe para esta empresa, mas as condições do claim não foram atendidas:
    -- status não é 'processing' ou locked_at diverge (claim mismatch).
    RAISE EXCEPTION 'CLAIM_MISMATCH: status ou locked_at incorreto. '
      'O lote pode ja ter sido concluido, recuperado ou reivindicado novamente.'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.agent_message_batch_mark_processed_v1(UUID, UUID, TIMESTAMPTZ) IS
  'Marca um lote como processado. Requer o locked_at do claim atual para evitar atualizacao atrasada. '
  'Transicao permitida: processing → processed.';


-- =====================================================
-- FUNÇÃO 2: agent_message_batch_mark_retry_v1
-- Transição: processing → retry_pending (attempts<3) | processing → failed (attempts>=3)
-- =====================================================

CREATE OR REPLACE FUNCTION public.agent_message_batch_mark_retry_v1(
  p_company_id    UUID,
  p_batch_id      UUID,
  p_locked_at     TIMESTAMPTZ,
  p_error_code    TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS SETOF public.agent_message_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ── Validação de parâmetros obrigatórios ──────────────────────────────────
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_batch_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_locked_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_locked_at e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Transição atômica ─────────────────────────────────────────────────────
  -- attempts já incrementado pelo claim. A decisão retry vs. failed é feita
  -- atomicamente usando o valor de attempts da própria linha no momento do UPDATE.
  --
  -- Política de backoff (attempts refere-se ao valor corrente na linha):
  --   attempts = 1  → retry_pending, next_attempt_at = now() + 30s
  --   attempts = 2  → retry_pending, next_attempt_at = now() + 120s
  --   attempts >= 3 → failed (sem estado inválido intermediário)
  --
  -- p_error_code e p_error_message são truncados (100 / 2.000 chars).
  -- NULL de entrada → NULL armazenado (sem conversão para string vazia).
  RETURN QUERY
    UPDATE public.agent_message_batches
    SET
      status = CASE
        WHEN attempts >= 3 THEN 'failed'
        ELSE 'retry_pending'
      END,
      next_attempt_at = CASE
        WHEN attempts >= 3 THEN NULL
        WHEN attempts = 2  THEN now() + interval '120 seconds'
        ELSE                    now() + interval '30 seconds'
      END,
      locked_at       = NULL,
      last_error_code = NULLIF(left(COALESCE(p_error_code, ''),    100),  ''),
      last_error      = NULLIF(left(COALESCE(p_error_message, ''), 2000), ''),
      updated_at      = now()
    WHERE id         = p_batch_id
      AND company_id = p_company_id
      AND status     = 'processing'
      AND locked_at  = p_locked_at
    RETURNING *;

  -- ── Diagnóstico quando nenhuma linha foi atualizada ───────────────────────
  IF NOT FOUND THEN
    PERFORM 1
    FROM public.agent_message_batches
    WHERE id = p_batch_id AND company_id = p_company_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'BATCH_NOT_FOUND: lote nao encontrado para esta empresa'
        USING ERRCODE = 'P0001';
    END IF;

    RAISE EXCEPTION 'CLAIM_MISMATCH: status ou locked_at incorreto. '
      'O lote pode ja ter sido concluido, recuperado ou reivindicado novamente.'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.agent_message_batch_mark_retry_v1(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT) IS
  'Reagenda ou encerra um lote com falha. '
  'attempts<3 → retry_pending (backoff: 30s/120s). '
  'attempts>=3 → failed direto. '
  'O status resultante pode ser lido na linha retornada. '
  'Transicoes permitidas: processing → retry_pending | failed.';


-- =====================================================
-- FUNÇÃO 3: agent_message_batch_mark_failed_v1
-- Transição: processing → failed
-- =====================================================

CREATE OR REPLACE FUNCTION public.agent_message_batch_mark_failed_v1(
  p_company_id    UUID,
  p_batch_id      UUID,
  p_locked_at     TIMESTAMPTZ,
  p_error_code    TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS SETOF public.agent_message_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ── Validação de parâmetros obrigatórios ──────────────────────────────────
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_batch_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_locked_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_locked_at e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Transição atômica: processing → failed ────────────────────────────────
  -- attempts NÃO é modificado (preservado para auditoria).
  -- failed_at dedicado não existe na tabela; updated_at serve como referência.
  -- processed_at e cancelled_at não são preenchidos.
  RETURN QUERY
    UPDATE public.agent_message_batches
    SET
      status          = 'failed',
      locked_at       = NULL,
      next_attempt_at = NULL,
      last_error_code = NULLIF(left(COALESCE(p_error_code, ''),    100),  ''),
      last_error      = NULLIF(left(COALESCE(p_error_message, ''), 2000), ''),
      updated_at      = now()
    WHERE id         = p_batch_id
      AND company_id = p_company_id
      AND status     = 'processing'
      AND locked_at  = p_locked_at
    RETURNING *;

  -- ── Diagnóstico quando nenhuma linha foi atualizada ───────────────────────
  IF NOT FOUND THEN
    PERFORM 1
    FROM public.agent_message_batches
    WHERE id = p_batch_id AND company_id = p_company_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'BATCH_NOT_FOUND: lote nao encontrado para esta empresa'
        USING ERRCODE = 'P0001';
    END IF;

    RAISE EXCEPTION 'CLAIM_MISMATCH: status ou locked_at incorreto. '
      'O lote pode ja ter sido concluido, recuperado ou reivindicado novamente.'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.agent_message_batch_mark_failed_v1(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT) IS
  'Marca um lote como permanentemente falho. '
  'attempts e preservado. updated_at serve como referencia de tempo do failure. '
  'Transicao permitida: processing → failed.';


-- =====================================================
-- FUNÇÃO 4: agent_message_batch_mark_cancelled_v1
-- Transição: processing → cancelled
-- =====================================================

CREATE OR REPLACE FUNCTION public.agent_message_batch_mark_cancelled_v1(
  p_company_id UUID,
  p_batch_id   UUID,
  p_locked_at  TIMESTAMPTZ,
  p_reason     TEXT DEFAULT NULL
)
RETURNS SETOF public.agent_message_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ── Validação de parâmetros obrigatórios ──────────────────────────────────
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_company_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_batch_id e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_locked_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_locked_at e obrigatorio'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Transição atômica: processing → cancelled ─────────────────────────────
  -- Cancelamento de lotes pending ou retry_pending deve ser projetado separadamente.
  -- p_reason é truncado a 1.000 chars.
  RETURN QUERY
    UPDATE public.agent_message_batches
    SET
      status               = 'cancelled',
      cancelled_at         = now(),
      cancellation_reason  = NULLIF(left(COALESCE(p_reason, ''), 1000), ''),
      locked_at            = NULL,
      next_attempt_at      = NULL,
      updated_at           = now()
    WHERE id         = p_batch_id
      AND company_id = p_company_id
      AND status     = 'processing'
      AND locked_at  = p_locked_at
    RETURNING *;

  -- ── Diagnóstico quando nenhuma linha foi atualizada ───────────────────────
  IF NOT FOUND THEN
    PERFORM 1
    FROM public.agent_message_batches
    WHERE id = p_batch_id AND company_id = p_company_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'BATCH_NOT_FOUND: lote nao encontrado para esta empresa'
        USING ERRCODE = 'P0001';
    END IF;

    RAISE EXCEPTION 'CLAIM_MISMATCH: status ou locked_at incorreto. '
      'O lote pode ja ter sido concluido, recuperado ou reivindicado novamente.'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.agent_message_batch_mark_cancelled_v1(UUID, UUID, TIMESTAMPTZ, TEXT) IS
  'Cancela um lote em processamento. '
  'p_reason truncado a 1.000 chars. '
  'Transicao permitida: processing → cancelled. '
  'Cancelamento de lotes pending/retry_pending deve ser projetado separadamente.';


-- =====================================================
-- FUNÇÃO 5: agent_message_batches_recover_stale_v1
-- Recovery de lotes processing cujo locked_at expirou
-- =====================================================

CREATE OR REPLACE FUNCTION public.agent_message_batches_recover_stale_v1(
  p_stale_after_seconds INTEGER DEFAULT 300,
  p_limit               INTEGER DEFAULT 20
)
RETURNS SETOF public.agent_message_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stale INTEGER;
  v_limit INTEGER;
BEGIN
  -- ── Validação de parâmetros ───────────────────────────────────────────────
  IF p_stale_after_seconds IS NULL OR p_stale_after_seconds < 60 THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_stale_after_seconds deve ser >= 60, recebido: %',
      COALESCE(p_stale_after_seconds::text, 'NULL')
      USING ERRCODE = 'P0001';
  END IF;
  IF p_stale_after_seconds > 3600 THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_stale_after_seconds excede o maximo de 3600, recebido: %',
      p_stale_after_seconds
      USING ERRCODE = 'P0001';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_limit deve ser entre 1 e 100, recebido: %',
      COALESCE(p_limit::text, 'NULL')
      USING ERRCODE = 'P0001';
  END IF;
  IF p_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_PARAM: p_limit excede o maximo de 100, recebido: %',
      p_limit
      USING ERRCODE = 'P0001';
  END IF;

  v_stale := p_stale_after_seconds;
  v_limit := p_limit;

  -- ── Recovery atômico ──────────────────────────────────────────────────────
  -- Localiza lotes stale com FOR UPDATE SKIP LOCKED (dois recoveries simultâneos
  -- recebem subconjuntos disjuntos, sem corrida pela mesma linha).
  --
  -- Decisão retry vs. failed é feita atomicamente usando o valor de attempts
  -- da própria linha, idêntico à política de mark_retry_v1:
  --   attempts < 3  → retry_pending + last_error_code = 'STALE_LOCK_RECOVERED'
  --   attempts >= 3 → failed        + last_error_code = 'STALE_LOCK_MAX_ATTEMPTS'
  --
  -- Retorna apenas os lotes realmente alterados (RETURNING é pós-UPDATE).
  RETURN QUERY
    WITH stale_batches AS (
      SELECT b.id
      FROM public.agent_message_batches b
      WHERE b.status     = 'processing'
        AND b.locked_at  IS NOT NULL
        AND b.locked_at  <= now() - (v_stale || ' seconds')::interval
      ORDER BY b.locked_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT v_limit
    )
    UPDATE public.agent_message_batches
    SET
      status = CASE
        WHEN attempts >= 3 THEN 'failed'
        ELSE 'retry_pending'
      END,
      next_attempt_at = CASE
        WHEN attempts >= 3 THEN NULL
        WHEN attempts = 2  THEN now() + interval '120 seconds'
        ELSE                    now() + interval '30 seconds'
      END,
      locked_at       = NULL,
      last_error_code = CASE
        WHEN attempts >= 3 THEN 'STALE_LOCK_MAX_ATTEMPTS'
        ELSE                    'STALE_LOCK_RECOVERED'
      END,
      last_error = CASE
        WHEN attempts >= 3
          THEN 'Recovery: tentativas maximas atingidas — lote encerrado como failed'
          ELSE 'Recovery: lock expirado — reagendado para retry'
      END,
      updated_at = now()
    FROM stale_batches
    WHERE public.agent_message_batches.id = stale_batches.id
    RETURNING public.agent_message_batches.*;
END;
$$;

COMMENT ON FUNCTION public.agent_message_batches_recover_stale_v1(INTEGER, INTEGER) IS
  'Recupera lotes em processing cujo locked_at expirou (default: 300s). '
  'attempts<3 → retry_pending. attempts>=3 → failed. '
  'FOR UPDATE SKIP LOCKED garante disjuncao entre recoveries concorrentes. '
  'p_stale_after_seconds: [60, 3600]. p_limit: [1, 100].';


-- =====================================================
-- SEGURANÇA: Revoke/Grant para todas as funções
-- =====================================================

-- mark_processed_v1
REVOKE ALL ON FUNCTION public.agent_message_batch_mark_processed_v1(UUID, UUID, TIMESTAMPTZ)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_message_batch_mark_processed_v1(UUID, UUID, TIMESTAMPTZ)
  FROM anon;
REVOKE ALL ON FUNCTION public.agent_message_batch_mark_processed_v1(UUID, UUID, TIMESTAMPTZ)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.agent_message_batch_mark_processed_v1(UUID, UUID, TIMESTAMPTZ)
  TO service_role;

-- mark_retry_v1
REVOKE ALL ON FUNCTION public.agent_message_batch_mark_retry_v1(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_message_batch_mark_retry_v1(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
  FROM anon;
REVOKE ALL ON FUNCTION public.agent_message_batch_mark_retry_v1(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.agent_message_batch_mark_retry_v1(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
  TO service_role;

-- mark_failed_v1
REVOKE ALL ON FUNCTION public.agent_message_batch_mark_failed_v1(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_message_batch_mark_failed_v1(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
  FROM anon;
REVOKE ALL ON FUNCTION public.agent_message_batch_mark_failed_v1(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.agent_message_batch_mark_failed_v1(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
  TO service_role;

-- mark_cancelled_v1
REVOKE ALL ON FUNCTION public.agent_message_batch_mark_cancelled_v1(UUID, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_message_batch_mark_cancelled_v1(UUID, UUID, TIMESTAMPTZ, TEXT)
  FROM anon;
REVOKE ALL ON FUNCTION public.agent_message_batch_mark_cancelled_v1(UUID, UUID, TIMESTAMPTZ, TEXT)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.agent_message_batch_mark_cancelled_v1(UUID, UUID, TIMESTAMPTZ, TEXT)
  TO service_role;

-- recover_stale_v1
REVOKE ALL ON FUNCTION public.agent_message_batches_recover_stale_v1(INTEGER, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_message_batches_recover_stale_v1(INTEGER, INTEGER)
  FROM anon;
REVOKE ALL ON FUNCTION public.agent_message_batches_recover_stale_v1(INTEGER, INTEGER)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.agent_message_batches_recover_stale_v1(INTEGER, INTEGER)
  TO service_role;
