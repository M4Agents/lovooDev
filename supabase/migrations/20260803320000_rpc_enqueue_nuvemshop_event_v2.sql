-- =============================================================================
-- Nuvemshop Integration — Migration (Fase 4 → correção)
-- RPC: enqueue_nuvemshop_event v2 — last_webhook_at atômica
--
-- PROBLEMA anterior:
--   webhook.js atualizava last_webhook_at via fire-and-forget (Promise sem await),
--   criando risco de perda silenciosa da atualização em caso de erro ou cold-start.
--
-- SOLUÇÃO:
--   O UPDATE em nuvemshop_connections.last_webhook_at é executado DENTRO desta
--   função, na mesma transação implícita do PLPGSQL.
--   Isso garante que a atualização ocorre SEMPRE que um webhook válido é recebido,
--   mesmo quando o evento já foi enfileirado antes (idempotency hit).
--
-- Nota: o UPDATE ocorre mesmo em idempotency hit (v_queued = false) porque
--   o webhook FOI recebido — apenas não precisou ser re-enfileirado.
-- =============================================================================

DROP FUNCTION IF EXISTS public.enqueue_nuvemshop_event(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.enqueue_nuvemshop_event(
  p_company_id       UUID,
  p_store_id         TEXT,
  p_topic            TEXT,
  p_idempotency_key  TEXT,
  p_payload          JSONB,
  p_correlation_id   TEXT    DEFAULT NULL,
  p_event_id         TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_id  UUID;
  v_queued  BOOLEAN;
BEGIN
  -- Validações de parâmetros obrigatórios
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'company_id is required');
  END IF;

  IF p_store_id IS NULL OR p_store_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'store_id is required');
  END IF;

  IF p_idempotency_key IS NULL OR p_idempotency_key = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'idempotency_key is required');
  END IF;

  IF p_topic IS NULL OR p_topic = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'topic is required');
  END IF;

  -- Inserção idempotente: ignora duplicatas pelo idempotency_key
  INSERT INTO public.nuvemshop_webhook_events (
    company_id,
    store_id,
    event_id,
    idempotency_key,
    topic,
    payload,
    correlation_id,
    status,
    attempts,
    max_attempts,
    next_attempt_at
  ) VALUES (
    p_company_id,
    p_store_id,
    p_event_id,
    p_idempotency_key,
    p_topic,
    COALESCE(p_payload, '{}'),
    p_correlation_id,
    'pending',
    0,
    5,
    now()
  )
  ON CONFLICT (company_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_new_id;

  v_queued := (v_new_id IS NOT NULL);

  -- Atualizar last_webhook_at atomicamente na mesma transação.
  -- Executado mesmo em idempotency hit: o webhook foi recebido, mesmo que não reenfileirado.
  UPDATE public.nuvemshop_connections
  SET
    last_webhook_at = now(),
    updated_at      = now()
  WHERE company_id         = p_company_id
    AND nuvemshop_store_id = p_store_id
    AND status             = 'active';

  RETURN jsonb_build_object(
    'ok',         true,
    'queued',     v_queued,
    'event_uuid', v_new_id
  );
END;
$$;

-- Acesso restrito: somente service_role (webhook receiver via backend)
REVOKE EXECUTE ON FUNCTION public.enqueue_nuvemshop_event(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT)
  FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_nuvemshop_event(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT)
  TO service_role;
