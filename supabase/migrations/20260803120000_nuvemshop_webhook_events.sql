-- =============================================================================
-- Nuvemshop Integration — Migration 2/12
-- Tabela: nuvemshop_webhook_events
--
-- Fila durável de eventos recebidos via webhook.
-- Responsabilidades:
--   - Garantir idempotência (UNIQUE company_id + event_id)
--   - Controlar ciclo de vida: pending → processing → processed | failed | dead
--   - Suportar retry com backoff e limite de tentativas
--   - Servir como dead letter queue (status = 'dead')
--   - Rastrear replays administrativos
-- =============================================================================

CREATE TABLE public.nuvemshop_webhook_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  store_id          TEXT        NOT NULL,

  -- Identificação do evento
  -- event_id: valor do header x-event-id enviado pela Nuvemshop (garante idempotência)
  event_id          TEXT        NOT NULL,
  topic             TEXT        NOT NULL,   -- ex: customer/created, order/paid
  payload           JSONB       NOT NULL DEFAULT '{}',

  -- Rastreabilidade
  correlation_id    TEXT,

  -- Ciclo de vida
  status            TEXT        NOT NULL DEFAULT 'pending',
  attempts          SMALLINT    NOT NULL DEFAULT 0,
  max_attempts      SMALLINT    NOT NULL DEFAULT 5,
  last_attempt_at   TIMESTAMPTZ,
  last_error        TEXT,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,

  -- Controle de worker (prevenção de processamento duplicado)
  worker_id         TEXT,
  acquired_at       TIMESTAMPTZ,

  -- Rastreamento de replay
  replayed_from     UUID        REFERENCES public.nuvemshop_webhook_events(id),
  replay_count      SMALLINT    NOT NULL DEFAULT 0,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Idempotência: um event_id por empresa
  CONSTRAINT uq_nuvemshop_webhook_events_event_id
    UNIQUE (company_id, event_id),

  CONSTRAINT chk_nuvemshop_webhook_events_status
    CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'dead'))
);

-- Índices de processamento
CREATE INDEX idx_nvevt_company
  ON public.nuvemshop_webhook_events(company_id);

CREATE INDEX idx_nvevt_status_next
  ON public.nuvemshop_webhook_events(status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX idx_nvevt_topic
  ON public.nuvemshop_webhook_events(company_id, topic);

CREATE INDEX idx_nvevt_worker
  ON public.nuvemshop_webhook_events(worker_id)
  WHERE worker_id IS NOT NULL;

CREATE INDEX idx_nvevt_store
  ON public.nuvemshop_webhook_events(company_id, store_id);

-- Trigger updated_at
CREATE TRIGGER update_nuvemshop_webhook_events_updated_at
  BEFORE UPDATE ON public.nuvemshop_webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.nuvemshop_webhook_events ENABLE ROW LEVEL SECURITY;

-- SELECT: apenas admins e plataforma (dado operacional interno)
CREATE POLICY "nvevt_select_admin"
  ON public.nuvemshop_webhook_events
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_company_admin(company_id)
    OR public.auth_user_is_parent_admin(company_id)
    OR public.auth_user_is_platform_admin()
  );

-- INSERT / UPDATE / DELETE: exclusivamente service_role
