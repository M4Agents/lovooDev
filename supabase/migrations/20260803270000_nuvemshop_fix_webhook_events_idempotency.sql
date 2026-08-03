-- =============================================================================
-- Nuvemshop Integration — Migration R5/6 (revisão fundação)
-- Correção: estratégia de idempotência em nuvemshop_webhook_events
--
-- PROBLEMA IDENTIFICADO:
--   A implementação inicial assumia a existência de um header 'x-event-id'
--   na Nuvemshop. A documentação oficial confirma que esse header NÃO existe.
--
-- EVIDÊNCIA:
--   - Nuvemshop docs: "messages may be sent multiple times with the same content"
--   - Header de autenticação: x-linkedstore-hmac-sha256 (HMAC do body, não ID único)
--   - Payload thin: { store_id, event (=topic), id (=resource_id) }
--   - Recomendação oficial: deduplique por store_id + event + resource id
--
-- CORREÇÃO:
--   - Renomear semântica: event_id passa a ser o ID bruto do recurso Nuvemshop
--     (campo 'id' do payload). Agora nullable — ausente em eventos sintéticos.
--   - Adicionar idempotency_key: chave determinística computada pelo backend.
--     Formato para eventos reais:      "{store_id}:{topic}:{resource_id}"
--     Formato para reconciliação:      "reconcile:{store_id}:{topic}:{resource_id}:{YYYYMMDD}"
--   - Substituir UNIQUE(company_id, event_id) por UNIQUE(company_id, idempotency_key)
--
-- IMPACTO:
--   - Zero dados a migrar (tabela recém-criada, sem registros em produção)
--   - O RPC enqueue_nuvemshop_event é atualizado para usar idempotency_key
--
-- REFERÊNCIA: https://dev.nuvemshop.com.br/docs/developer-tools/nuvemshop-api
-- =============================================================================

-- 1. Remover constraint de idempotência antiga (baseada em event_id)
ALTER TABLE public.nuvemshop_webhook_events
  DROP CONSTRAINT IF EXISTS uq_nuvemshop_webhook_events_event_id;

-- 2. Ajustar event_id: agora armazena o ID bruto do recurso Nuvemshop (campo 'id' do payload)
--    Nullable porque eventos sintéticos da reconciliação não possuem ID de entrega da Nuvemshop
ALTER TABLE public.nuvemshop_webhook_events
  ALTER COLUMN event_id DROP NOT NULL;

COMMENT ON COLUMN public.nuvemshop_webhook_events.event_id IS
  'ID bruto do recurso Nuvemshop (campo id do payload). Nullable para eventos sintéticos de reconciliação.';

-- 3. Adicionar idempotency_key: chave determinística que garante deduplicação
--    Formato real:         "{store_id}:{topic}:{resource_id}"
--    Formato reconciliação: "reconcile:{store_id}:{topic}:{resource_id}:{YYYYMMDD}"
ALTER TABLE public.nuvemshop_webhook_events
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

COMMENT ON COLUMN public.nuvemshop_webhook_events.idempotency_key IS
  'Chave determinística de deduplicação. Formato real: "{store_id}:{topic}:{resource_id}". Formato reconciliação: "reconcile:{store_id}:{topic}:{resource_id}:{YYYYMMDD}".';

-- 4. Tornar idempotency_key NOT NULL (sem dados a migrar — tabela nova)
ALTER TABLE public.nuvemshop_webhook_events
  ALTER COLUMN idempotency_key SET NOT NULL;

-- 5. Adicionar nova constraint de idempotência sobre a chave determinística
ALTER TABLE public.nuvemshop_webhook_events
  ADD CONSTRAINT uq_nuvemshop_webhook_events_idempotency
    UNIQUE (company_id, idempotency_key);

-- 6. Índice parcial para facilitar lookup por idempotency_key
CREATE INDEX IF NOT EXISTS idx_nvevt_idempotency
  ON public.nuvemshop_webhook_events(company_id, idempotency_key);

-- =============================================================================
-- Atualização do RPC enqueue_nuvemshop_event
--
-- O parâmetro p_event_id agora recebe o ID bruto do recurso (campo 'id' do payload).
-- O parâmetro p_idempotency_key recebe a chave determinística computada pelo receiver.
-- =============================================================================

DROP FUNCTION IF EXISTS public.enqueue_nuvemshop_event(UUID, TEXT, TEXT, TEXT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.enqueue_nuvemshop_event(
  p_company_id       UUID,
  p_store_id         TEXT,
  p_topic            TEXT,
  p_idempotency_key  TEXT,
  p_payload          JSONB,
  p_correlation_id   TEXT    DEFAULT NULL,
  p_event_id         TEXT    DEFAULT NULL   -- ID bruto do recurso Nuvemshop (opcional)
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

  RETURN jsonb_build_object(
    'ok',         true,
    'queued',     v_queued,
    'event_uuid', v_new_id
  );
END;
$$;

-- Acesso restrito: somente service_role
REVOKE EXECUTE ON FUNCTION public.enqueue_nuvemshop_event(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT)
  FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_nuvemshop_event(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT)
  TO service_role;
