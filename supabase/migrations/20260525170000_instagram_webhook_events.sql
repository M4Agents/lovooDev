-- =============================================================================
-- FASE 2 — Integração Instagram (Migration 8/8)
-- Tabela: instagram_webhook_events
--
-- Log técnico de todos os eventos de webhook recebidos do Instagram.
-- Finalidade: debug, replay e observabilidade operacional.
-- ACESSO RESTRITO: somente platform_admin pode visualizar (dados sensíveis).
-- =============================================================================

CREATE TABLE public.instagram_webhook_events (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID        REFERENCES public.companies(id),
  connection_id       UUID        REFERENCES public.instagram_connections(id),
  instagram_user_id   TEXT        NOT NULL,
  event_type          TEXT        NOT NULL,
  ig_object_id        TEXT,
  raw_payload         JSONB       NOT NULL,
  processing_status   TEXT        NOT NULL DEFAULT 'received',
  error_detail        TEXT,
  hmac_valid          BOOLEAN     NOT NULL DEFAULT false,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ,

  CONSTRAINT chk_igwhev_event_type
    CHECK (event_type IN ('dm', 'comment', 'story_mention', 'unknown')),

  CONSTRAINT chk_igwhev_processing_status
    CHECK (processing_status IN ('received', 'processed', 'skipped', 'failed'))
);

-- Índices
CREATE INDEX idx_igwhev_company_time
  ON public.instagram_webhook_events(company_id, received_at DESC);

CREATE INDEX idx_igwhev_ig_user
  ON public.instagram_webhook_events(instagram_user_id);

CREATE INDEX idx_igwhev_status
  ON public.instagram_webhook_events(processing_status);

-- RLS
ALTER TABLE public.instagram_webhook_events ENABLE ROW LEVEL SECURITY;

-- SELECT: somente platform_admin (payloads brutos são sensíveis)
CREATE POLICY "igwhev_select_platform_admin"
  ON public.instagram_webhook_events
  FOR SELECT
  TO authenticated
  USING (public.auth_user_is_platform_admin());

-- INSERT / UPDATE / DELETE: somente service_role (backend de webhook)
