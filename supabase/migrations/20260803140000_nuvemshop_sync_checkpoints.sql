-- =============================================================================
-- Nuvemshop Integration — Migration 4/12
-- Tabela: nuvemshop_sync_checkpoints
--
-- Controle de progresso das sincronizações iniciais e incrementais.
-- Permite retomada após falha sem reiniciar do zero (resumable sync).
-- =============================================================================

CREATE TABLE public.nuvemshop_sync_checkpoints (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  store_id          TEXT        NOT NULL,

  -- Tipo de sincronização
  -- sync_type: 'customers' | 'orders' | 'products' | 'categories' | 'checkouts'
  sync_type         TEXT        NOT NULL,

  -- Estado atual
  status            TEXT        NOT NULL DEFAULT 'idle',

  -- Posição de paginação
  current_page      INTEGER     NOT NULL DEFAULT 1,
  cursor_since_id   TEXT,                         -- since_id para paginação por cursor

  -- Contadores de progresso
  total_processed   INTEGER     NOT NULL DEFAULT 0,
  total_errors      INTEGER     NOT NULL DEFAULT 0,
  last_external_id  TEXT,                         -- ID do último item processado na Nuvemshop

  -- Estado flexível adicional
  checkpoint_data   JSONB       NOT NULL DEFAULT '{}',

  -- Timestamps de execução
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  last_activity_at  TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Um checkpoint por tipo de sync por loja por empresa
  CONSTRAINT uq_nuvemshop_sync_checkpoints_type
    UNIQUE (company_id, store_id, sync_type),

  CONSTRAINT chk_nuvemshop_sync_checkpoints_status
    CHECK (status IN ('idle', 'running', 'paused', 'completed', 'failed')),

  CONSTRAINT chk_nuvemshop_sync_checkpoints_type
    CHECK (sync_type IN ('customers', 'orders', 'products', 'categories', 'checkouts'))
);

-- Índices
CREATE INDEX idx_nvcpt_company
  ON public.nuvemshop_sync_checkpoints(company_id);

CREATE INDEX idx_nvcpt_status
  ON public.nuvemshop_sync_checkpoints(company_id, status);

-- Trigger updated_at
CREATE TRIGGER update_nuvemshop_sync_checkpoints_updated_at
  BEFORE UPDATE ON public.nuvemshop_sync_checkpoints
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.nuvemshop_sync_checkpoints ENABLE ROW LEVEL SECURITY;

-- SELECT: admins e plataforma (dado operacional)
CREATE POLICY "nvcpt_select_admin"
  ON public.nuvemshop_sync_checkpoints
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_is_company_admin(company_id)
    OR public.auth_user_is_parent_admin(company_id)
    OR public.auth_user_is_platform_admin()
  );

-- INSERT / UPDATE / DELETE: exclusivamente service_role
