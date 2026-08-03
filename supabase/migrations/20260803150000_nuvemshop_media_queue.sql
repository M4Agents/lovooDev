-- =============================================================================
-- Nuvemshop Integration — Migration 5/12
-- Tabela: nuvemshop_media_queue
--
-- Fila independente para processamento de imagens de produtos.
-- Totalmente desacoplada do fluxo principal de webhooks.
-- O upsert do produto nunca bloqueia em espera do download de mídia.
--
-- Idempotência via idempotency_key = company_id + nuvemshop_image_id.
-- =============================================================================

CREATE TABLE public.nuvemshop_media_queue (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  store_id              TEXT        NOT NULL,

  -- Referência interna ao produto (nullable — produto pode não estar criado ainda)
  product_id            UUID        REFERENCES public.products(id) ON DELETE SET NULL,

  -- Identificação externa
  nuvemshop_product_id  TEXT        NOT NULL,
  nuvemshop_image_id    TEXT        NOT NULL,
  source_url            TEXT        NOT NULL,
  position              SMALLINT    NOT NULL DEFAULT 0,

  -- Ciclo de vida
  status                TEXT        NOT NULL DEFAULT 'pending',
  attempts              SMALLINT    NOT NULL DEFAULT 0,
  last_error            TEXT,
  worker_id             TEXT,
  acquired_at           TIMESTAMPTZ,
  processed_at          TIMESTAMPTZ,

  -- Idempotência: uma entrada por imagem por empresa
  idempotency_key       TEXT        NOT NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_nuvemshop_media_queue_idempotency
    UNIQUE (idempotency_key),

  CONSTRAINT chk_nuvemshop_media_queue_status
    CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'dead'))
);

-- Índices de processamento
CREATE INDEX idx_nvmedia_company
  ON public.nuvemshop_media_queue(company_id);

CREATE INDEX idx_nvmedia_status
  ON public.nuvemshop_media_queue(status)
  WHERE status IN ('pending', 'failed');

CREATE INDEX idx_nvmedia_product
  ON public.nuvemshop_media_queue(company_id, nuvemshop_product_id);

-- Trigger updated_at
CREATE TRIGGER update_nuvemshop_media_queue_updated_at
  BEFORE UPDATE ON public.nuvemshop_media_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.nuvemshop_media_queue ENABLE ROW LEVEL SECURITY;

-- Tabela operacional de background — sem acesso direto via authenticated.
-- Gerenciada exclusivamente pelo media worker via service_role.
