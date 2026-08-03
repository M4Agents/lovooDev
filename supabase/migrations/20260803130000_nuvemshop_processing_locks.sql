-- =============================================================================
-- Nuvemshop Integration — Migration 3/12
-- Tabela: nuvemshop_processing_locks
--
-- Controle temporário de concorrência por recurso.
-- Impede que dois workers processem o mesmo recurso simultaneamente.
-- Locks possuem TTL (expires_at) e são renovados via heartbeat pelo worker.
-- =============================================================================

CREATE TABLE public.nuvemshop_processing_locks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  store_id        TEXT        NOT NULL,

  -- Identificação do recurso bloqueado
  -- resource_type: 'customer', 'order', 'product', 'category', 'checkout'
  resource_type   TEXT        NOT NULL,
  resource_id     TEXT        NOT NULL,   -- ID externo do recurso na Nuvemshop

  -- Worker que detém o lock
  worker_id       TEXT        NOT NULL,

  -- TTL — lock automaticamente expirado após expires_at
  expires_at      TIMESTAMPTZ NOT NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  renewed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Um lock por recurso por empresa
  CONSTRAINT uq_nuvemshop_processing_locks_resource
    UNIQUE (company_id, resource_type, resource_id)
);

-- Índices de expiração e limpeza
CREATE INDEX idx_nvlock_company
  ON public.nuvemshop_processing_locks(company_id);

CREATE INDEX idx_nvlock_expires
  ON public.nuvemshop_processing_locks(expires_at);

CREATE INDEX idx_nvlock_resource
  ON public.nuvemshop_processing_locks(company_id, resource_type, resource_id);

-- RLS
ALTER TABLE public.nuvemshop_processing_locks ENABLE ROW LEVEL SECURITY;

-- Tabela puramente operacional — sem acesso direto via authenticated.
-- Leitura e escrita exclusivamente via RPCs com SECURITY DEFINER (service_role).
-- Nenhuma policy SELECT é criada intencionalmente.
