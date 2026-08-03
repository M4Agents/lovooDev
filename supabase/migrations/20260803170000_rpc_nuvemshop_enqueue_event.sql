-- =============================================================================
-- Nuvemshop Integration — Migration 7/12
-- RPC: enqueue_nuvemshop_event
--
-- Enfileira um evento de webhook de forma idempotente.
-- Chamada pelo webhook receiver imediatamente após validar a assinatura HMAC.
--
-- Idempotência: se o event_id já existir para a empresa, retorna 'queued: false'
-- sem modificar o registro existente (ON CONFLICT DO NOTHING).
--
-- Segurança:
--   - SECURITY DEFINER com search_path explícito
--   - company_id validado como parâmetro — nunca assumido do contexto
--   - Acesso restrito a service_role
-- =============================================================================

DROP FUNCTION IF EXISTS public.enqueue_nuvemshop_event(
  UUID, TEXT, TEXT, TEXT, JSONB, TEXT
);

CREATE OR REPLACE FUNCTION public.enqueue_nuvemshop_event(
  p_company_id      UUID,
  p_store_id        TEXT,
  p_topic           TEXT,
  p_event_id        TEXT,
  p_payload         JSONB,
  p_correlation_id  TEXT    DEFAULT NULL
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
  -- Validações básicas de parâmetros
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'company_id is required');
  END IF;

  IF p_store_id IS NULL OR p_store_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'store_id is required');
  END IF;

  IF p_event_id IS NULL OR p_event_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_id is required');
  END IF;

  IF p_topic IS NULL OR p_topic = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'topic is required');
  END IF;

  -- Inserção idempotente: ignora duplicatas silenciosamente
  INSERT INTO public.nuvemshop_webhook_events (
    company_id,
    store_id,
    event_id,
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
    p_topic,
    COALESCE(p_payload, '{}'),
    p_correlation_id,
    'pending',
    0,
    5,
    now()
  )
  ON CONFLICT (company_id, event_id) DO NOTHING
  RETURNING id INTO v_new_id;

  v_queued := (v_new_id IS NOT NULL);

  RETURN jsonb_build_object(
    'ok',         true,
    'queued',     v_queued,
    'event_uuid', v_new_id
  );
END;
$$;

-- Acesso restrito: somente service_role (webhook receiver via backend)
REVOKE EXECUTE ON FUNCTION public.enqueue_nuvemshop_event(UUID, TEXT, TEXT, TEXT, JSONB, TEXT)
  FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_nuvemshop_event(UUID, TEXT, TEXT, TEXT, JSONB, TEXT)
  TO service_role;
